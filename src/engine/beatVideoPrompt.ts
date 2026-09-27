/**
 * KSP Image r8.0 — Per-beat video prompts (Gemini Omni Flash / Seedance 2.5 / Grok Imagine)
 *
 * Workflow: Jason picks 1+ consecutive scene beats → the shots covering them
 * (via shot.coveredBeatIds) become ONE video clip → AI writes 3 prompts, one per
 * model, which Jason copies (and edits) into each video tool.
 *
 * Split of responsibilities:
 *   - DETERMINISTIC (this file, unit-tested): beat → shot resolution, dedupe,
 *     contiguous whole-second timeline, per-model duration fit (compress/stretch),
 *     reference-image manifest, dialogue window, stale fingerprint.
 *   - AI (one JSON call): turns that fixed plan into prose per model's syntax.
 *     The AI never does timing arithmetic — timelines are passed in pre-computed.
 *
 * Model specs come from public prompting guides (Sep 2026): Google Omni Flash
 * guide + atlabs, docs.seedance.tv 2.5 guide, grok-imagine-prompt-1.5-guide.
 * Specs live in VIDEO_MODEL_SPECS only — change them in one place.
 *
 * ABSOLUTE RULE (HANDOFF r7.31): no story-specific examples in AI prompts.
 * All formats below use <placeholders>.
 */

import type {
  Beat,
  BeatPromptGroup,
  FilmSceneScript,
  FilmShot,
  ProjectSettingV2,
  ScriptDialog,
  VideoPromptModel,
} from "../types/project";
import type { FilmCharacter } from "../types/film";
import { getEnglishTerm } from "../types/cameraMovement";
import { getShotTypeProse, getStyleAdjective } from "./omniShotPromptBuilder";
import { callAi, parseJsonStrictAsync, type FilmScriptProvider } from "./filmScriptStages";

// ============================================================================
// MODEL SPECS — single source of truth
// ============================================================================

export interface VideoModelSpec {
  id: VideoPromptModel;
  label: string;
  minSeconds: number;
  maxSeconds: number;
  /** Lower cap when reference images are attached (Grok reference-to-video ≤10s). */
  maxSecondsWithRefs?: number;
  /** How the prompt names the Nth attached image (0-based index). */
  refLabel: (index: number) => string;
}

export const VIDEO_MODEL_SPECS: Record<VideoPromptModel, VideoModelSpec> = {
  omni: {
    id: "omni",
    label: "Gemini Omni Flash",
    minSeconds: 3,
    maxSeconds: 10,
    refLabel: (i) => `image_${i}`,
  },
  seedance: {
    id: "seedance",
    label: "Seedance 2.5",
    minSeconds: 4,
    maxSeconds: 30,
    refLabel: (i) => `Image ${i + 1}`,
  },
  grok: {
    id: "grok",
    label: "Grok Imagine",
    minSeconds: 1,
    maxSeconds: 15,
    maxSecondsWithRefs: 10,
    refLabel: (i) => `reference image ${i + 1}`,
  },
};

export const VIDEO_MODELS: VideoPromptModel[] = ["omni", "seedance", "grok"];

// ============================================================================
// BEAT → SHOT RESOLUTION
// ============================================================================

/** Shots covering any of the given beats, deduped, in shot order. */
export function resolveShotsForBeats(beatIds: string[], shots: FilmShot[]): FilmShot[] {
  const wanted = new Set(beatIds);
  const seen = new Set<string>();
  const out: FilmShot[] = [];
  for (const shot of [...shots].sort((a, b) => a.order - b.order)) {
    const covered = ((shot as any).coveredBeatIds as string[] | undefined) ?? [];
    if (covered.some((id) => wanted.has(id)) && !seen.has(shot.id)) {
      seen.add(shot.id);
      out.push(shot);
    }
  }
  return out;
}

/** Whole-second duration of a shot (min 1s). */
export function shotSeconds(shot: FilmShot): number {
  return Math.max(1, Math.round(shot.durationSeconds || 0));
}

export function totalSeconds(shots: FilmShot[]): number {
  return shots.reduce((sum, s) => sum + shotSeconds(s), 0);
}

// ============================================================================
// TIMELINE (contiguous integer ranges)
// ============================================================================

export interface TimelineSegment {
  shotId: string;
  start: number;
  end: number;
}

/** Contiguous 0-based whole-second ranges from segment lengths. */
export function toTimeline(shotIds: string[], lengths: number[]): TimelineSegment[] {
  let t = 0;
  return shotIds.map((shotId, i) => {
    const seg = { shotId, start: t, end: t + lengths[i] };
    t = seg.end;
    return seg;
  });
}

/**
 * Scale integer segment lengths to sum to `target`, each ≥1s, preserving
 * proportions (largest-remainder rounding). If there are more segments than
 * seconds, every segment gets 1s and the sum exceeds target (caller flags it).
 */
export function scaleLengths(lengths: number[], target: number): number[] {
  const n = lengths.length;
  if (n === 0) return [];
  if (target <= n) return lengths.map(() => 1);
  const total = lengths.reduce((a, b) => a + b, 0) || n;
  const raw = lengths.map((l) => (l / total) * target);
  const out = raw.map((r) => Math.max(1, Math.floor(r)));
  let diff = target - out.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; diff > 0; k = (k + 1) % n, diff--) out[byFraction[k].i]++;
  while (diff < 0) {
    const i = out.indexOf(Math.max(...out));
    if (out[i] <= 1) break;
    out[i]--;
    diff++;
  }
  return out;
}

export type DurationFit = "ok" | "compressed" | "stretched" | "too_many_shots";

export interface ModelPlan {
  model: VideoPromptModel;
  sourceSeconds: number;
  targetSeconds: number;
  fit: DurationFit;
  timeline: TimelineSegment[];
}

/** Max clip length for a model given whether reference images are attached. */
export function modelMaxSeconds(model: VideoPromptModel, hasRefs: boolean): number {
  const spec = VIDEO_MODEL_SPECS[model];
  return hasRefs && spec.maxSecondsWithRefs ? spec.maxSecondsWithRefs : spec.maxSeconds;
}

/** Fit the shots' natural timeline into a model's min/max duration. */
export function planForModel(model: VideoPromptModel, shots: FilmShot[], hasRefs: boolean): ModelPlan {
  const spec = VIDEO_MODEL_SPECS[model];
  const lengths = shots.map(shotSeconds);
  const source = lengths.reduce((a, b) => a + b, 0);
  const max = modelMaxSeconds(model, hasRefs);
  let target = source;
  let fit: DurationFit = "ok";
  if (source > max) {
    target = max;
    fit = "compressed";
  } else if (source < spec.minSeconds) {
    target = spec.minSeconds;
    fit = "stretched";
  }
  const scaled = fit === "ok" ? lengths : scaleLengths(lengths, target);
  const scaledSum = scaled.reduce((a, b) => a + b, 0);
  if (scaledSum > target) fit = "too_many_shots";
  return {
    model,
    sourceSeconds: source,
    targetSeconds: fit === "too_many_shots" ? scaledSum : target,
    fit,
    timeline: toTimeline(
      shots.map((s) => s.id),
      scaled
    ),
  };
}

// ============================================================================
// CAST + REFERENCES
// ============================================================================

function shotText(shot: FilmShot): string {
  const s = shot as any;
  return [s.actionEn, s.actionVi, s.titleEn, s.titleVi, s.purposeEn, s.purposeVi].filter(Boolean).join(" ");
}

function conceptDataUrl(c: FilmCharacter): string | undefined {
  const sheet = (c as any).conceptSheet;
  const face = (c as any).faceRefs?.[0];
  const url =
    (typeof sheet === "string" ? sheet : sheet?.dataUrl) || (typeof face === "string" ? face : face?.dataUrl);
  return typeof url === "string" && url ? url : undefined;
}

/** Characters appearing in these shots (by name) or speaking in the chosen lines. */
export function findPresentCharacters(
  shots: FilmShot[],
  cast: FilmCharacter[],
  dialog: ScriptDialog[]
): FilmCharacter[] {
  const text = shots.map(shotText).join(" ").toLowerCase();
  const speakers = new Set(dialog.map((d) => d.characterId));
  const present = cast.filter(
    (c) => speakers.has(c.id) || (c.name && text.includes(c.name.toLowerCase()))
  );
  if (present.length > 0) return present;
  // Fallback: nobody named — assume the protagonist carries the shots.
  return cast.filter((c) => c.role === "protagonist").slice(0, 1);
}

export interface ReferenceImage {
  index: number;
  characterId: string;
  characterName: string;
  dataUrl: string;
  filename: string;
}

export function buildReferenceImages(present: FilmCharacter[]): ReferenceImage[] {
  const refs: ReferenceImage[] = [];
  for (const c of present) {
    const dataUrl = conceptDataUrl(c);
    if (!dataUrl) continue;
    const index = refs.length;
    const safe = (c.name || `character_${index + 1}`).replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
    refs.push({
      index,
      characterId: c.id,
      characterName: c.name,
      dataUrl,
      filename: `${String(index + 1).padStart(2, "0")}_${safe || "character"}.png`,
    });
  }
  return refs;
}

// ============================================================================
// DIALOGUE WINDOW
// ============================================================================

export interface DialogueSelection {
  lines: ScriptDialog[];
  /** true = lines matched by timing; false = whole-scene candidates (AI must filter). */
  exact: boolean;
}

/**
 * Lines spoken during the chosen shots. Uses dialog.timingSeconds (scene-relative)
 * when every line has it; otherwise returns all scene lines as candidates.
 */
export function selectDialogue(
  scene: FilmSceneScript,
  allSceneShots: FilmShot[],
  chosenShots: FilmShot[],
  dialogEnabled: boolean
): DialogueSelection {
  const lines = scene.dialog ?? [];
  if (!dialogEnabled || lines.length === 0 || chosenShots.length === 0) return { lines: [], exact: true };
  if (!lines.every((l) => l.timingSeconds)) return { lines, exact: false };

  const ordered = [...allSceneShots].sort((a, b) => a.order - b.order);
  const chosen = new Set(chosenShots.map((s) => s.id));
  const windows: Array<[number, number]> = [];
  let t = 0;
  for (const s of ordered) {
    const d = shotSeconds(s);
    if (chosen.has(s.id)) windows.push([t, t + d]);
    t += d;
  }
  const hit = lines.filter((l) =>
    windows.some(([a, b]) => l.timingSeconds!.start < b && l.timingSeconds!.end > a)
  );
  return { lines: hit, exact: true };
}

// ============================================================================
// STALE FINGERPRINT
// ============================================================================

function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function fingerprintGroup(beats: Beat[], shots: FilmShot[]): string {
  const b = beats.map((x) => `${x.id}:${x.label}`).join("|");
  const s = shots
    .map((x) => `${x.id}:${shotSeconds(x)}:${x.shotType}:${x.cameraMovement}:${(x as any).actionEn ?? (x as any).actionVi ?? ""}`)
    .join("|");
  return hash(`${b}#${s}`);
}

export function isGroupStale(group: BeatPromptGroup, beats: Beat[], shots: FilmShot[]): boolean {
  if (!group.sourceFingerprint) return false;
  const groupBeats = beats.filter((b) => group.beatIds.includes(b.id));
  if (groupBeats.length !== group.beatIds.length) return true; // a beat was re-detected / removed
  return fingerprintGroup(groupBeats, resolveShotsForBeats(group.beatIds, shots)) !== group.sourceFingerprint;
}

// ============================================================================
// CONTEXT BLOCK (user prompt for the AI)
// ============================================================================

export interface BeatPromptInput {
  scene: FilmSceneScript;
  /** All shots of the scene (for dialogue timing offsets). */
  sceneShots: FilmShot[];
  /** Beats chosen for this clip (ordered). */
  beats: Beat[];
  cast: FilmCharacter[];
  setting: ProjectSettingV2;
}

export interface BeatPromptPlan {
  shots: FilmShot[];
  references: ReferenceImage[];
  dialogue: DialogueSelection;
  plans: Record<VideoPromptModel, ModelPlan>;
  fingerprint: string;
  contextText: string;
}

/** r8.1: spoken language for video dialogue (prompt prose stays English). */
export function dialogueLanguageName(setting: ProjectSettingV2): string {
  return setting.dialogueLanguage === "vi" ? "Vietnamese" : "English";
}

export function dialogueText(d: ScriptDialog, setting: ProjectSettingV2): string {
  return setting.dialogueLanguage === "vi" ? d.lineVi?.trim() || d.lineEn : d.lineEn;
}

function describeCharacter(c: FilmCharacter): string {
  const desc = ((c as any).aiGenDescription || c.description || "").trim().replace(/\s+/g, " ");
  return `${c.name} (${c.role})${desc ? ` — ${desc}` : ""}`;
}

function shotLine(shot: FilmShot): string {
  const s = shot as any;
  const action = (s.actionEn || s.actionVi || s.titleEn || s.titleVi || "").trim();
  const parts = [
    `framing: ${getShotTypeProse(shot.shotType)}`,
    `camera: ${getEnglishTerm(shot.cameraMovement as any)}`,
    `action: ${action}`,
  ];
  if (s.lightingHintEn) parts.push(`lighting: ${s.lightingHintEn}`);
  if (s.innerStateVi) parts.push(`inner state (Vietnamese, convey visually): ${s.innerStateVi}`);
  if (s.audioDirection) parts.push(`audio: ${s.audioDirection}`);
  return parts.join(" | ");
}

export function buildBeatPromptPlan(input: BeatPromptInput): BeatPromptPlan {
  const { scene, sceneShots, beats, cast, setting } = input;
  const beatIds = beats.map((b) => b.id);
  const shots = resolveShotsForBeats(beatIds, sceneShots);
  const dialogEnabled = setting.dialog === "has_dialog";
  const dialogue = selectDialogue(scene, sceneShots, shots, dialogEnabled);
  const present = findPresentCharacters(shots, cast, dialogue.exact ? dialogue.lines : []);
  const references = buildReferenceImages(present);
  const hasRefs = references.length > 0;
  const plans = {
    omni: planForModel("omni", shots, hasRefs),
    seedance: planForModel("seedance", shots, hasRefs),
    grok: planForModel("grok", shots, hasRefs),
  } as Record<VideoPromptModel, ModelPlan>;

  const lines: string[] = [];
  lines.push(`VISUAL STYLE: ${getStyleAdjective(setting.animationStyle)}`);
  lines.push(`ASPECT RATIO: ${setting.aspectRatio}`);
  if (setting.genre) lines.push(`GENRE: ${setting.genre}`);
  lines.push(`SCENE ${scene.order}: ${scene.titleEn}${scene.titleVi ? ` (${scene.titleVi})` : ""}`);
  lines.push(`SETTING: ${scene.settings}`);
  if (scene.emotionalTone) lines.push(`SCENE MOOD: ${scene.emotionalTone}, tension ${scene.tensionLevel ?? "?"}/10`);
  if ((scene as any).physicalConsistencyLockEn) {
    lines.push(`CONSISTENCY LOCK (must stay identical): ${(scene as any).physicalConsistencyLockEn}`);
  }
  const cs = (scene as any).colorScript;
  if (cs) lines.push(`COLOR PALETTE: ${cs.dominantEn}; ${cs.accent1En}; ${cs.accent2En}`);
  lines.push("");
  lines.push(`BEATS IN THIS CLIP: ${beats.map((b) => `${b.order}. ${b.label}`).join(" / ")}`);
  lines.push("");
  lines.push("CHARACTERS ON SCREEN (appearance text is the project's fixed character bible — copy it verbatim):");
  if (present.length === 0) lines.push("- (none identified — describe only what the shots show)");
  for (const c of present) lines.push(`- ${describeCharacter(c)}`);
  lines.push("");
  lines.push("SHOTS (in order, natural durations):");
  shots.forEach((s, i) => lines.push(`${i + 1}. [${shotSeconds(s)}s] ${shotLine(s)}`));
  lines.push("");

  if (!dialogEnabled) {
    lines.push("DIALOGUE: none — this project has no spoken dialogue.");
  } else if (dialogue.lines.length === 0) {
    lines.push("DIALOGUE: none in these shots.");
  } else {
    const spoken = dialogueLanguageName(setting);
    lines.push(
      dialogue.exact
        ? `DIALOGUE (spoken in ${spoken} during these shots, keep wording exact):`
        : `DIALOGUE CANDIDATES (spoken in ${spoken}; whole scene — include ONLY lines that belong to these shots' actions; if none fit, use no dialogue):`
    );
    for (const d of dialogue.lines) {
      lines.push(`- ${d.characterName}${d.parenthetical ? ` ${d.parenthetical}` : ""}: "${dialogueText(d, setting)}"`);
    }
  }
  const sfx = (scene.sfx ?? []).filter(Boolean);
  if (sfx.length) lines.push(`SCENE SOUND EFFECTS: ${sfx.join(", ")}`);
  if (scene.musicBrief) lines.push(`SCORE MOOD (optional, keep subtle): ${scene.musicBrief}`);
  lines.push("");

  lines.push("REFERENCE IMAGES (attached by the user in this order):");
  if (!hasRefs) lines.push("- none — describe characters' appearance in words");
  references.forEach((r) => {
    lines.push(
      `- #${r.index + 1}: ${r.characterName} concept sheet → Omni "${VIDEO_MODEL_SPECS.omni.refLabel(r.index)}", Seedance "${VIDEO_MODEL_SPECS.seedance.refLabel(r.index)}", Grok "${VIDEO_MODEL_SPECS.grok.refLabel(r.index)}"`
    );
  });
  lines.push("");

  lines.push("PER-MODEL TIMELINE (use EXACTLY these ranges; shot numbers refer to SHOTS above):");
  for (const m of VIDEO_MODELS) {
    const p = plans[m];
    const note =
      p.fit === "compressed"
        ? ` (compressed from ${p.sourceSeconds}s — tighten actions, keep every shot)`
        : p.fit === "stretched"
        ? ` (stretched from ${p.sourceSeconds}s — let actions breathe, no new events)`
        : p.fit === "too_many_shots"
        ? ` (too many shots for this length — merge adjacent shots into continuous moves where needed)`
        : "";
    const ranges = p.timeline
      .map((seg) => `${seg.start}–${seg.end}s = shot ${shots.findIndex((s) => s.id === seg.shotId) + 1}`)
      .join(", ");
    lines.push(`- ${m} → total ${p.targetSeconds}s${note}: ${ranges}`);
  }

  return {
    shots,
    references,
    dialogue,
    plans,
    fingerprint: fingerprintGroup(beats, shots),
    contextText: lines.join("\n"),
  };
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const BEAT_VIDEO_SYSTEM_PROMPT = `You are a film director's assistant who writes text-to-video prompts. You receive a fixed shot plan for ONE clip and write three prompts for three different video models. Each prompt must fully describe the clip on its own: who is on screen and what they look like, where we are, what happens second by second, how the camera moves, the light, and the sound.

HARD RULES (all three prompts):
- Write the prompt in English. Dialogue lines stay exactly as given (in their own language), in double quotes, attributed to the speaker, and the prompt states the spoken language once (for example "dialogue spoken in <language>").
- Use EXACTLY the per-model timeline ranges given. Never invent timestamps, never change the total length.
- Do not invent new events, characters, props or locations beyond the shot plan. You may add sensory and physical detail that makes the given action visible (texture, weight, body language, light behavior).
- Describe what the camera SEES — concrete, visible nouns and verbs. No abstract mood words without a visible cause.
- Inner states given in Vietnamese must become visible acting (eyes, posture, breath, hands), never stated as feelings.
- Every character on screen: reuse the appearance text from CHARACTERS ON SCREEN word for word (it is shared by every clip of the film, so identical wording keeps the character consistent between clips). Do not paraphrase or add new traits. If a reference image exists, also name it and say it controls identity (face, hair, outfit) only — not background, pose or framing.
- Always describe sound: ambience + effects + dialogue (or explicitly "no dialogue"). Music only if a score mood is given, and keep it subtle.
- Respect the CONSISTENCY LOCK and COLOR PALETTE if given.
- Never write story content that is not in the input. No example characters, no placeholder names.

MODEL 1 — "omni" (Gemini Omni Flash, 3–10 s per generation):
- Name attached images as image_0, image_1…, written like "Keep <character> from image_0 (face, hair, outfit)".
- Structure: one opening line with style + setting + light; then the timed cut list, one line per range "<start>–<end>s: <framing>, <camera move>, <action>"; then one audio sentence; then "No subtitles, no on-screen text."
- If the clip is a single shot, say "one continuous shot" so Omni does not add cuts. If multiple shots, write "hard cut" between ranges.
- Precise camera and lens language (dolly-in, orbit, handheld, locked-off, 35mm, shallow depth of field) works well. Keep it under ~170 words.

MODEL 2 — "seedance" (Seedance 2.5, 4–30 s):
- Four parts, in this order, separated by blank lines:
  1) Asset mapping: "Image 1: <character>'s appearance (face, hair, outfit) only." one line per reference; skip if none.
  2) One-sentence brief: subject + location + event + genre + camera treatment.
  3) Timeline: "<start>–<end> seconds: <framing>, <camera move>. <action>. <dialogue/sound for this range>." — continuous whole-second ranges, no gaps.
  4) Global constraints: consistency ("keep <character>'s appearance identical across all shots"), style, sound mix (format: "Only <ambience> and <effects>"), "No subtitles, no text, no watermark."
- Around 150–250 words. Plain descriptive sentences, no adjective piles.

MODEL 3 — "grok" (Grok Imagine, ≤15 s, ≤10 s with reference images):
- Front-load: first sentence = camera (shot type + move) + subject doing the first action.
- Then remaining actions strictly in time order, using the given ranges ("At <n>s, cut to <framing>: …").
- Environment + light sentence.
- A separate "Sound:" line with comma-separated material + spatial cues and any dialogue ("<speaker> says: \\"<line>\\"").
- End with "<N> seconds, <aspect ratio>."
- State things positively — Grok often ignores negations, so avoid "no/don't". For a clip without dialogue write the Sound line as ambience and effects only.
- Refer to references as "reference image 1", "reference image 2"… Keep it under ~130 words.

OUTPUT: strict JSON only, no markdown fences:
{ "omni": "<prompt>", "seedance": "<prompt>", "grok": "<prompt>" }`;

// ============================================================================
// AI CALL
// ============================================================================

export async function generateBeatVideoPrompts(
  input: BeatPromptInput,
  provider: FilmScriptProvider
): Promise<{ prompts: Record<VideoPromptModel, string>; plan: BeatPromptPlan }> {
  const plan = buildBeatPromptPlan(input);
  if (plan.shots.length === 0) {
    throw new Error("Các beat đã chọn chưa có shot nào phủ. Sinh shot list cho scene trước.");
  }
  const userPrompt = `${plan.contextText}\n\nWrite the three prompts now. Return JSON only.`;
  const raw = await callAi(provider, BEAT_VIDEO_SYSTEM_PROMPT, userPrompt, { temperature: 0.6 });
  const parsed = await parseJsonStrictAsync<Partial<Record<VideoPromptModel, unknown>>>(raw, "Beat video prompts");
  const prompts = {} as Record<VideoPromptModel, string>;
  for (const m of VIDEO_MODELS) {
    const v = parsed?.[m];
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`AI không trả prompt cho ${VIDEO_MODEL_SPECS[m].label}. Bấm Generate lại.`);
    }
    prompts[m] = v.trim();
  }
  return { prompts, plan };
}
