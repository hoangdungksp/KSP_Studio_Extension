/**
 * KSP Image r8.1 — Character Bible (replaces manual Cast step in Film mode)
 *
 * Film mode no longer has a Cast section: Jason only types the idea. After the
 * scenes are planned (Stage 4), one AI call extracts the recurring characters
 * and writes each one a FIXED English appearance text. That text is stored as
 * FilmCharacter.description and copied verbatim into every beat video prompt,
 * so the same character looks the same across separately generated clips.
 *
 * Existing characters (legacy projects that used Cast) are kept untouched —
 * the stage is skipped when film.characters is non-empty.
 *
 * ABSOLUTE RULE (HANDOFF r7.31): no story-specific examples in the prompt.
 */

import type { FilmCharacter, FilmCharacterRole, FilmScriptStructure, FilmScriptIntermediateScene } from "../types/film";
import type { ProjectSettingV2 } from "../types/project";
import { createFilmCharacter } from "../types/film";
import { callAi, parseJsonStrictAsync, type FilmScriptProvider } from "./filmScriptStages";
import { getStyleAdjective } from "./omniShotPromptBuilder";

export interface CharacterBibleInput {
  idea: string;
  setting: ProjectSettingV2;
  structure?: FilmScriptStructure;
  scenes: FilmScriptIntermediateScene[];
  provider: FilmScriptProvider;
}

interface RawCharacter {
  name?: unknown;
  role?: unknown;
  appearanceEn?: unknown;
}

const ROLES: FilmCharacterRole[] = ["protagonist", "antagonist", "companion", "extra"];

export const CHARACTER_BIBLE_SYSTEM_PROMPT = `You are a film's character designer. From the idea and the scene plan, list the characters who appear on screen, and give each one a fixed visual description that a text-to-video model can reproduce identically in every clip.

RULES:
- Include only characters who are actually seen (people, animals, creatures, robots…). Maximum 6, main characters first. Crowds and one-off background figures are not characters.
- "name": the name used in the idea/scenes. If unnamed, a short descriptive English label in the form "<the + key trait + type>".
- "role": one of protagonist | antagonist | companion | extra. Exactly one protagonist when there is a main character.
- "appearanceEn": ONE English paragraph of 35–60 words, visual facts only, in this order: species/body type and apparent age, build and height, face and hair (or fur/skin/surface), eye color, outfit with colors and materials, one or two distinctive marks or accessories. Choose concrete colors and materials. No personality, no backstory, no actions, no camera or lighting words.
- Match the visual style given. Stay faithful to anything the idea or scenes already say about a character's look; invent only what is missing.
- Never add characters, names or traits that contradict the input.

OUTPUT: strict JSON only, no markdown fences:
{ "characters": [ { "name": "<name>", "role": "<role>", "appearanceEn": "<paragraph>" } ] }`;

export function buildCharacterBibleUserPrompt(input: CharacterBibleInput): string {
  const { idea, setting, structure, scenes } = input;
  const sceneLines = scenes
    .map((s) => `${s.order}. ${s.titleEn} — ${s.settings}\n   ${s.actionLinesEn}`)
    .join("\n");
  return `VISUAL STYLE: ${getStyleAdjective(setting.animationStyle)}
GENRE: ${setting.genre ?? "drama"}

IDEA:
${idea.trim() || "(empty)"}
${structure?.contentEn ? `\nSTORY OVERVIEW:\n${structure.contentEn}\n` : ""}
SCENES:
${sceneLines || "(none)"}

Return the character bible as JSON.`;
}

/** Validate + convert AI output into FilmCharacter records. */
export function toFilmCharacters(raw: { characters?: RawCharacter[] } | null | undefined): FilmCharacter[] {
  const list = Array.isArray(raw?.characters) ? raw!.characters! : [];
  const out: FilmCharacter[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const appearance = typeof r.appearanceEn === "string" ? r.appearanceEn.trim().replace(/\s+/g, " ") : "";
    if (!name || !appearance || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const role = ROLES.includes(r.role as FilmCharacterRole) ? (r.role as FilmCharacterRole) : "extra";
    const c = createFilmCharacter(out.length + 1, role);
    out.push({ ...c, id: `${c.id}_${out.length}`, name, description: appearance, descriptionGeneratedAt: Date.now() });
    if (out.length >= 6) break;
  }
  if (out.length > 0 && !out.some((c) => c.role === "protagonist")) out[0] = { ...out[0], role: "protagonist" };
  return out;
}

export async function generateCharacterBible(input: CharacterBibleInput): Promise<FilmCharacter[]> {
  const raw = await callAi(input.provider, CHARACTER_BIBLE_SYSTEM_PROMPT, buildCharacterBibleUserPrompt(input), {
    temperature: 0.5,
  });
  const parsed = await parseJsonStrictAsync<{ characters?: RawCharacter[] }>(raw, "Character bible");
  const characters = toFilmCharacters(parsed);
  if (characters.length === 0) throw new Error("AI không trả về nhân vật nào. Bấm Continue để thử lại.");
  return characters;
}
