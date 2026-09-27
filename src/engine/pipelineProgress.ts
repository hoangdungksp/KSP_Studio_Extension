/**
 * KSP Image — Pipeline progress detector (r7.29 Feature 1B)
 *
 * Derives current pipeline progress from PERSISTED project data (Dexie/IndexedDB),
 * NOT from in-memory autoChainState. This makes cross-session resume work:
 * user closes Chrome → reopens → KSP detects pipeline dở dang → shows banner.
 *
 * Status mapping rules (based on what data exists in project.filmV093):
 *   - script-stage-1: done if film.scriptStructure exists, else missing
 *   - script-stage-2: done if film.scriptBeats.length >= 1, else missing
 *   - script-stage-3: done if film.scriptTwistsLocked === true OR scriptTwists exists
 *   - script-stage-4: done if film.scriptIntermediateScenes.length >= 1
 *   - script-stage-5: done if film.script?.scenes.length >= 1
 *   - analyze-scenes: done if all scenes have non-empty beats array
 *   - shot-list: done if all scenes have shots in shotsBySceneId
 */

import type { PromptProject } from "../types";
import type { ProjectV09Extensions } from "../types/project";
import type { SectionId } from "./autoChainOrchestrator";

export type SectionStatus = "done" | "missing";

export interface PipelineProgress {
  /** Ordered status per section */
  sections: Array<{
    id: SectionId;
    label: string;
    status: SectionStatus;
  }>;
  /** First missing section (where user should resume) — null if pipeline complete */
  firstMissing: SectionId | null;
  /** Last completed section — null if pipeline not started */
  lastCompleted: SectionId | null;
  /** Convenience flags */
  isComplete: boolean;
  isInProgress: boolean;
}

const SECTION_ORDER: Array<{ id: SectionId; label: string }> = [
  { id: "script-stage-1", label: "Stage 1 — Structure" },
  { id: "script-stage-2", label: "Stage 2 — Beats" },
  { id: "script-stage-3", label: "Stage 3 — Twists" },
  { id: "script-stage-4", label: "Stage 4 — Scenes" },
  { id: "characters", label: "Nhân vật (AI tạo)" },
  { id: "script-stage-5", label: "Stage 5 — Dialogues" },
  { id: "analyze-scenes", label: "Analyze Scenes (beats per scene)" },
  { id: "shot-list", label: "Shot List" },
];

/** Legacy abort records may still point at removed sections (e.g. "grid-build" pre-r8.0). */
export function isKnownSectionId(id: unknown): id is SectionId {
  return SECTION_ORDER.some((s) => s.id === id);
}

/**
 * Derive pipeline progress from project data. Pure function — no side effects.
 */
export function derivePipelineProgress(project: PromptProject | null | undefined): PipelineProgress {
  const emptyResult: PipelineProgress = {
    sections: SECTION_ORDER.map((s) => ({ ...s, status: "missing" as const })),
    firstMissing: SECTION_ORDER[0].id,
    lastCompleted: null,
    isComplete: false,
    isInProgress: false,
  };
  if (!project) return emptyResult;
  const film = (project as PromptProject & ProjectV09Extensions).filmV093;
  if (!film) return emptyResult;

  const sections = SECTION_ORDER.map((s) => ({ ...s, status: detectStatus(s.id, film) }));
  const firstMissingIdx = sections.findIndex((s) => s.status === "missing");
  const lastCompletedIdx = (() => {
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].status === "done") return i;
    }
    return -1;
  })();

  return {
    sections,
    firstMissing: firstMissingIdx >= 0 ? sections[firstMissingIdx].id : null,
    lastCompleted: lastCompletedIdx >= 0 ? sections[lastCompletedIdx].id : null,
    isComplete: firstMissingIdx === -1,
    // In-progress = at least 1 done AND at least 1 missing
    isInProgress: lastCompletedIdx >= 0 && firstMissingIdx >= 0,
  };
}

function detectStatus(sectionId: SectionId, film: any): SectionStatus {
  switch (sectionId) {
    case "script-stage-1":
      return film.scriptStructure ? "done" : "missing";
    case "script-stage-2":
      return Array.isArray(film.scriptBeats) && film.scriptBeats.length > 0
        ? "done"
        : "missing";
    case "script-stage-3":
      // Stage 3 (Twists) is OPTIONAL — done if locked OR has twists
      return film.scriptTwistsLocked === true ||
        (Array.isArray(film.scriptTwists) && film.scriptTwists.length > 0)
        ? "done"
        : "missing";
    case "script-stage-4":
      return Array.isArray(film.scriptIntermediateScenes) &&
        film.scriptIntermediateScenes.length > 0
        ? "done"
        : "missing";
    case "characters":
      return (film.characters ?? []).some((c: any) => c.name && c.description) ? "done" : "missing";
    case "script-stage-5":
      return film.script?.scenes && film.script.scenes.length > 0 ? "done" : "missing";
    case "analyze-scenes": {
      const scenes = film.script?.scenes;
      if (!scenes || scenes.length === 0) return "missing";
      // All scenes must have beats array of length >= 1
      return scenes.every(
        (s: any) => Array.isArray(s.beats) && s.beats.length > 0
      )
        ? "done"
        : "missing";
    }
    case "shot-list": {
      const scenes = film.script?.scenes;
      if (!scenes || scenes.length === 0) return "missing";
      const shotsBySceneId = film.shotsBySceneId ?? {};
      return scenes.every(
        (s: any) => Array.isArray(shotsBySceneId[s.id]) && shotsBySceneId[s.id].length > 0
      )
        ? "done"
        : "missing";
    }
    default:
      return "missing";
  }
}

/**
 * Get human-readable label for a section ID.
 */
export function getSectionLabel(sectionId: SectionId): string {
  return SECTION_ORDER.find((s) => s.id === sectionId)?.label ?? sectionId;
}
