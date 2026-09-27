/**
 * KSP Image — Gemini Omni single-shot prompt builder (r7.26 — Prose mode)
 *
 * REWRITE từ structured (r7.22) → flowing prose theo guide official DeepMind:
 *   https://deepmind.google/models/gemini-omni/prompt-guide/
 *
 * DeepMind Tab 0 nêu rõ 5 element đan xen trong MỘT câu prose, KHÔNG dùng label:
 *   1. Shot framing and motion  (wide/medium/close-up + glide/rush)
 *   2. Style                    (cinematic/grounded/majestic)
 *   3. Lighting                 (sun/streetlamp; crisp/warm/ethereal)
 *   4. Location                 (overall intention, không kê khai)
 *   5. Action                   (character/object + movement/interaction)
 *
 * Khác với r7.22 structured:
 *   - 1 câu duy nhất, đan xen 5 element — không có "Setting:", "Camera:", "Lighting:" labels
 *   - Audio inline trong câu Style/ambiance — không có "Audio:" line riêng
 *   - Bỏ Negative prompt — guide DeepMind không nhắc đến negative
 *   - Bỏ duration + aspect suffix dạng "5s, 16:9" — không trong example DeepMind
 *
 * Identity anchor "preserve face, hair, and wardrobe exactly" GIỮ NGUYÊN — đây
 * là KSP-specific cho cross-shot consistency với character recurring, không có
 * trong guide DeepMind (guide focus single-shot from-scratch).
 *
 * Function signature KHÔNG đổi → UI không cần thay đổi.
 */

import type { FilmShot, FilmSceneScript, ProjectSettingV2 } from "../types/project";
import type { FilmCharacter } from "../types/film";
import { getEnglishTerm } from "../types/cameraMovement";

export interface BuildOmniShotPromptInput {
  shot: FilmShot;
  scene?: FilmSceneScript;
  cast: FilmCharacter[];
  setting: ProjectSettingV2;
}

export interface OmniReferenceSpec {
  /** Slot number in prompt: <image_0>, <image_1>, etc. */
  slot: number;
  /** Suggested filename for bundle export */
  filename: string;
  /** Human-readable description shown in UI / README */
  description: string;
  /** Source URL/dataUrl if KSP has the asset, else undefined (user supplies) */
  dataUrl?: string;
}

export interface OmniPromptResult {
  /** Full prompt text with <image_N> placeholders */
  promptText: string;
  /** Ordered list of references — caller can bundle these alongside prompt */
  references: OmniReferenceSpec[];
}

// ============================================================================
// PROSE BUILDERS — map FilmShot/FilmSceneScript fields → natural English clauses
// ============================================================================

/**
 * Shot type → natural English noun phrase used in opening.
 * Different from r7.22 SHOT_TYPE_OMNI to support "extreme close-up" reading
 * naturally as adjective+noun.
 */
const SHOT_TYPE_PROSE: Record<string, string> = {
  extreme_close_up: "extreme close-up",
  close_up: "close-up",
  medium_close_up: "medium close-up",
  medium: "medium shot",
  medium_wide: "medium wide shot",
  wide: "wide shot",
  wide_establishing: "wide establishing shot",
  extreme_wide: "extreme wide establishing shot",
  over_shoulder: "over-the-shoulder shot",
  pov: "POV shot",
  insert: "insert detail shot",
  two_shot: "two-shot",
  cowboy: "cowboy shot",
};

export function getShotTypeProse(shotType: string): string {
  return SHOT_TYPE_PROSE[shotType] ?? shotType.replace(/_/g, " ");
}

/**
 * Camera movement → opening pattern.
 *
 * Pattern chosen for natural prose flow at sentence start:
 *   "A {shotType} {motionPhrase} on/of/across {subject}"
 *
 * For each camera value we return:
 *   - prefix: word(s) before the shotType noun phrase, e.g. "static"
 *             ("A static close-up on Maya...")
 *   - suffix: phrase after shotType, e.g. "pushing into"
 *             ("A close-up pushing into Maya...")
 *   - preposition: linking word to subject, e.g. "on", "of", "across"
 *
 * Camera vocabulary aligns with r7.21 cameraMovement.ts single source of truth.
 * Legacy/unknown values fall back to getEnglishTerm() suffix + "of".
 */
interface CameraOpening {
  prefix?: string;
  suffix?: string;
  preposition: string;
}

const CAMERA_OPENING: Record<string, CameraOpening> = {
  // Universal
  static: { prefix: "static", preposition: "on" },
  handheld: { prefix: "handheld", preposition: "follows" },
  tracking: { suffix: "tracking across", preposition: "" },
  // Veo3-only
  pan_left: { suffix: "panning left across", preposition: "" },
  pan_right: { suffix: "panning right across", preposition: "" },
  tilt_up: { suffix: "tilting up over", preposition: "" },
  tilt_down: { suffix: "tilting down over", preposition: "" },
  zoom_in: { suffix: "zooming into", preposition: "" },
  zoom_out: { suffix: "pulling back from", preposition: "" },
  dolly_in: { suffix: "dollying into", preposition: "" },
  dolly_out: { suffix: "dollying back from", preposition: "" },
  // Omni-only (per DeepMind guide tab 2 Direct your camera)
  oner: { prefix: "one continuous", preposition: "on" },
  locked_off: { prefix: "locked-off", preposition: "on" },
  push_in: { suffix: "pushing into", preposition: "" },
  punch_in: { suffix: "punching into", preposition: "" },
  dolly_zoom: { suffix: "with dolly zoom on", preposition: "" },
  smartphone_zoom: { prefix: "natural smartphone-zoom", preposition: "on" },
  film_camera: { prefix: "film-camera", preposition: "of" },
  webcam_style: { prefix: "webcam-style", preposition: "of" },
};

/**
 * Build the opening clause "A {shotType} ..." up to before the subject.
 *
 * Examples:
 *   shot=close_up, camera=push_in  → "A close-up pushing into"
 *   shot=wide, camera=static       → "A static wide shot on"
 *   shot=medium, camera=oner       → "A one continuous medium shot on"
 *   shot=close_up, camera=tracking → "A close-up tracking across"
 */
function buildCameraOpening(shotType: string, cameraMovement: string): string {
  const shotTypeProse = getShotTypeProse(shotType);
  const opt = CAMERA_OPENING[cameraMovement];

  if (opt) {
    const parts: string[] = ["A"];
    if (opt.prefix) parts.push(opt.prefix);
    parts.push(shotTypeProse);
    if (opt.suffix) parts.push(opt.suffix);
    if (opt.preposition) parts.push(opt.preposition);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  // Fallback: unknown/legacy camera value → use getEnglishTerm
  const cameraEn = getEnglishTerm(cameraMovement);
  if (cameraEn === "static" || !cameraEn) {
    return `A static ${shotTypeProse} on`;
  }
  return `A ${shotTypeProse} ${cameraEn} of`;
}

/**
 * Animation style → mood adjective for the ambiance clause.
 * Maps to natural-language description used in:
 *   "...creating ${article} ${adjective} ambiance..."
 */
const STYLE_ADJ: Record<string, string> = {
  // Current v0.9.3+ values (AnimationStyleV2)
  live_action: "cinematic",
  cgi_3d_cinematic: "Pixar-style 3D cinematic",
  anime_2d: "Studio Ghibli-style anime",
  cartoon_2d: "stylised 2D cartoon",
  stop_motion: "claymation stop-motion",
  film_noir: "noir black-and-white cinematic",
  // Legacy values from pre-r7.21 projects + tests
  pixar_3d: "Pixar 3D animated",
  ghibli: "Studio Ghibli anime",
  anime: "anime",
  comic_book: "comic-book illustrated",
  watercolor: "watercolour-painted",
  claymation: "claymation stop-motion",
  noir: "noir black-and-white",
  documentary: "documentary photorealistic",
};

export function getStyleAdjective(style?: string): string {
  if (!style) return "cinematic";
  return STYLE_ADJ[style] ?? style.replace(/_/g, " ");
}

/** Choose "a" or "an" article matching the next word's first sound. */
function article(adj: string): string {
  if (!adj) return "a";
  return /^[aeiouAEIOU]/.test(adj.trim()) ? "an" : "a";
}

/** Normalize a clause: trim, strip trailing punctuation, lowercase first letter if continuing. */
function asContinuation(text: string): string {
  if (!text) return "";
  const trimmed = text.trim().replace(/\.$/, "");
  // Lowercase first letter if it's a regular word (not proper noun starting with capital)
  // Heuristic: only lowercase if entire phrase starts with capital + lowercase letters
  // (e.g. "Looking up" → "looking up"; "Maya runs" preserves "Maya")
  if (/^[A-Z][a-z]/.test(trimmed) && !/^[A-Z][a-z]+ [A-Z]/.test(trimmed)) {
    // Only lowercase first word if it's not a name followed by another capital
    const firstSpace = trimmed.indexOf(" ");
    if (firstSpace === -1) {
      // single word: leave as-is to be safe (could be a name like "Maya")
      return trimmed;
    }
    // Don't lowercase if the first word looks like a proper noun
    // (We can't reliably detect — safest is to keep as-is for now)
  }
  return trimmed;
}

// ============================================================================
// MAIN BUILDER
// ============================================================================

/**
 * Build flowing-prose Omni prompt + reference manifest for one shot.
 *
 * Output format (1 sentence, ~50-90 words):
 *   "A {shotType} {cameraMotion} {subject anchor} {action},
 *    {lighting/setting integrated},
 *    creating {article} {styleAdj} ambiance{audio inline}."
 *
 * Example (Maya scene):
 *   "A close-up pushing into Maya as shown in <image_0> — preserve face, hair,
 *    and wardrobe exactly, looking up through the rain in a rainy alley,
 *    lit by honey-amber tungsten from a flickering bulb above, creating an
 *    intimate cinematic ambiance underscored by faint piano notes."
 *
 * Reference numbering convention (unchanged from r7.22):
 *   <image_0> = primary character concept sheet (protagonist)
 *   <image_1>, <image_2>, ... = supporting characters in this shot
 */
export function buildOmniShotPrompt(input: BuildOmniShotPromptInput): OmniPromptResult {
  const { shot, scene, cast, setting } = input;

  // -------- IDENTIFY characters in this shot --------
  const actionTextLower = (
    (shot as any).actionEn ||
    (shot as any).actionVi ||
    scene?.actionLinesEn ||
    ""
  ).toLowerCase();
  const presentChars = cast.filter((c) => {
    if ((c as any).isProtagonist) return true;
    return actionTextLower.includes((c.name || "").toLowerCase());
  });

  // -------- BUILD reference manifest --------
  // r7.22-fix1: conceptSheet is FilmImageRef object with .dataUrl, not raw string.
  const references: OmniReferenceSpec[] = [];
  let slot = 0;
  presentChars.forEach((char) => {
    const conceptSheetRef = (char as any).conceptSheet;
    const faceRef = (char as any).faceRefs?.[0];
    const conceptDataUrl: string | undefined =
      (typeof conceptSheetRef === "string" ? conceptSheetRef : conceptSheetRef?.dataUrl) ||
      (typeof faceRef === "string" ? faceRef : faceRef?.dataUrl);
    if (conceptDataUrl && typeof conceptDataUrl === "string") {
      const safeName = (char.name || `char${slot}`).replace(/\s+/g, "_").toLowerCase();
      references.push({
        slot,
        filename: `image_${slot}_${safeName}.png`,
        description: `${char.name} (${(char as any).role || "character"}) concept sheet`,
        dataUrl: conceptDataUrl,
      });
      slot++;
    }
  });

  // -------- BUILD prose sentence parts --------

  // (1) OPENING — shot framing + camera motion (ends with preposition)
  const opening = buildCameraOpening(shot.shotType, shot.cameraMovement || "static");

  // (2) SUBJECT ANCHOR — character with <image_N> identity reference
  //     OR fallback to character names without anchor OR neutral "the scene"
  let subject: string;
  if (references.length > 0) {
    const refList = references.map((r) => `<image_${r.slot}>`).join(", ");
    const charNames = presentChars
      .slice(0, references.length)
      .map((c) => c.name)
      .join(" and ");
    subject = `${charNames} as shown in ${refList} — preserve face, hair, and wardrobe exactly`;
  } else if (presentChars.length > 0) {
    subject = presentChars.map((c) => c.name).join(" and ");
  } else {
    subject = "the scene";
  }

  // (3) ACTION — what's happening (continuation of sentence after subject)
  const actionRaw =
    (shot as any).actionEn?.trim() ||
    (shot as any).actionVi?.trim() ||
    scene?.actionLinesEn?.trim() ||
    "";
  const actionClause = actionRaw ? `, ${asContinuation(actionRaw)}` : "";

  // (4) LOCATION + LIGHTING — combined into "in {settings}, lit by {lighting}"
  const sceneSettings = scene?.settings?.trim();
  const lighting =
    (shot as any).lightingHintEn?.trim() ||
    (scene as any)?.lightingHintEn?.trim();
  const locationParts: string[] = [];
  if (sceneSettings) locationParts.push(`in ${asContinuation(sceneSettings)}`);
  if (lighting) locationParts.push(`lit by ${asContinuation(lighting)}`);
  const locationClause = locationParts.length > 0 ? `, ${locationParts.join(", ")}` : "";

  // (5) STYLE + AUDIO — ambiance closing clause
  const styleAdj = getStyleAdjective((setting as any).animationStyle);
  const audioDirection = (shot as any).audioDirection?.trim();
  let ambianceClause = `, creating ${article(styleAdj)} ${styleAdj} ambiance`;
  if (audioDirection) {
    ambianceClause += ` underscored by ${asContinuation(audioDirection)}`;
  }

  // -------- ASSEMBLE prose sentence --------
  // Pattern: "{opening} {subject}{action}{location}{ambiance}."
  const promptText = `${opening} ${subject}${actionClause}${locationClause}${ambianceClause}.`;

  return { promptText, references };
}

/**
 * Format reference manifest as a human-readable bullet list (for README / UI hint).
 * Unchanged from r7.22 — UI relies on this signature.
 */
export function formatReferenceManifest(references: OmniReferenceSpec[]): string {
  if (references.length === 0) return "No reference images required.";
  return references
    .map((r) => `  <image_${r.slot}> — ${r.filename}: ${r.description}`)
    .join("\n");
}
