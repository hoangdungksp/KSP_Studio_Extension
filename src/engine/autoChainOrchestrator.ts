/**
 * KSP Image Auto-Chain Orchestrator
 *
 * Sequential execution engine that runs full pipeline after user confirms
 * narrativeDirection in Preview Flow modal:
 *
 *   Stage 1 → Stage 2 → Stage 3 → Stage 4 → Stage 5
 *     → Detect Beats per scene → Shot List per scene → Grid build per scene
 *     → [STOP at Storyboard ready]
 *
 * State per job:
 *   - "idle"        : not yet queued
 *   - "queued"      : in queue, waiting turn
 *   - "generating"  : currently running (UI shows border animation)
 *   - "done"        : completed successfully
 *   - "stale"       : completed but upstream changed (Phase B feature, ignored in Phase A)
 *   - "error"       : failed
 *
 * Events emitted to React UI via subscribe callback. UI updates section borders
 * + Stage card status badges in real-time.
 *
 * Phase A (): sequential execution, no cascade. User edits = manual rerun.
 * Phase B (): smart cascade on edit, debounced re-queue.
 */

import type {
  NarrativeDirection,
  ProjectV09Extensions,
  ProjectSettingV2,
  FilmSceneScript,
  FilmScript,
} from "../types/project";
import type { PromptProject } from "../types/index";
import type { FilmCharacter, FilmData } from "../types/film";
import {
  // runStage1Structure removed (now skip-AI gán từ direction Step 1)
  // runStage3Twists removed (now skip-AI gán từ direction Step 4 multi-pick)
  runStage2Beats,
  runStage4Scenes,
  runStage5FromStages,
  runDetectBeatsForScene,
  type FilmScriptProvider,
} from "./filmScriptStages";

// ============================================================================
// Types
// ============================================================================

export type SectionId =
  | "script-stage-1"     // Script Stage 1: Structure
  | "script-stage-2"     // Script Stage 2: Beats
  | "script-stage-3"     // Script Stage 3: Twists
  | "script-stage-4"     // Script Stage 4: Scenes (intermediate)
  | "characters"         // r8.1: AI character bible (replaces manual Cast in Film mode)
  | "script-stage-5"     // Script Stage 5: Dialogues
  | "analyze-scenes"       // All scenes Analyze Scenes loop (per-scene moments + physical lock + color script)
  | "shot-list";         // All scenes Shot List generation (r8.0: last stage — storyboard grid-build removed)

/** Canonical section order. r8.0: pipeline ends at Shot List. */
export const AUTO_CHAIN_SECTION_ORDER: readonly SectionId[] = [
  "script-stage-1", "script-stage-2", "script-stage-3", "script-stage-4", "characters", "script-stage-5",
  "analyze-scenes", "shot-list",
];


export type JobStatus = "idle" | "queued" | "generating" | "done" | "stale" | "error";

export interface SectionState {
  sectionId: SectionId;
  status: JobStatus;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  /** Sub-progress for per-scene loops (Detect Beats, Shot List) */
  subProgress?: { current: number; total: number; currentSceneTitle?: string };
}

export interface AutoChainState {
  isRunning: boolean;
  currentSection: SectionId | null;
  sections: Record<SectionId, SectionState>;
  startedAt?: number;
  finishedAt?: number;
  /** Total AI calls made during this run (cost tracking) */
  totalAiCalls: number;
}

/**
 * Initial state: all sections idle.
 */
export function createInitialAutoChainState(): AutoChainState {
  const sections: Partial<Record<SectionId, SectionState>> = {};
  for (const id of AUTO_CHAIN_SECTION_ORDER) {
    sections[id] = { sectionId: id, status: "idle" };
  }
  return {
    isRunning: false,
    currentSection: null,
    sections: sections as Record<SectionId, SectionState>,
    totalAiCalls: 0,
  };
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Subscriber callback — UI calls this to get current state.
 */
export type AutoChainSubscriber = (state: AutoChainState) => void;

/**
 * Input handlers passed by UI — orchestrator calls these to persist results.
 */
export interface AutoChainCallbacks {
  /** Get current project (latest snapshot, after each persist). */
  getProject: () => PromptProject;
  /** Update project (persists to IDB). Callback returns Partial<PromptProject> patch. */
  updateProject: (updater: (p: PromptProject) => Partial<PromptProject>) => void;
  /** Show toast to user. */
  showToast: (msg: string, kind?: "success" | "error" | "info") => void;
  /** Sleep duration ms between jobs (for UI to render). Default 200ms. */
  interJobDelayMs?: number;
}

/**
 * AutoChainOrchestrator: sequential pipeline execution + state tracking.
 *
 * Lifecycle:
 *   1. UI creates orchestrator with callbacks
 *   2. UI calls .subscribe(callback) to receive state updates
 *   3. UI calls .start(direction) after Preview Flow confirm
 *   4. Orchestrator runs all jobs sequentially, emits state per transition
 *   5. UI updates border animations + status badges
 *   6. On complete, UI shows Storyboard ready
 */
export class AutoChainOrchestrator {
  private state: AutoChainState;
  private subscribers: Set<AutoChainSubscriber>;
  private callbacks: AutoChainCallbacks;
  private abortRequested: boolean;

  constructor(callbacks: AutoChainCallbacks) {
    this.state = createInitialAutoChainState();
    this.subscribers = new Set();
    this.callbacks = callbacks;
    this.abortRequested = false;
  }

  /**
   * Subscribe to state changes. Returns unsubscribe function.
   */
  subscribe(callback: AutoChainSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.state); // Send initial state
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get current state snapshot (immutable view).
   */
  getState(): AutoChainState {
    return { ...this.state, sections: { ...this.state.sections } };
  }

  /**
   * Request abort. Orchestrator stops after current job completes.
   */
  abort(): void {
    this.abortRequested = true;
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const subscriber of this.subscribers) {
      try {
        subscriber(snapshot);
      } catch (err) {
        console.error("[AutoChain] subscriber error:", err);
      }
    }
  }

  private setStatus(sectionId: SectionId, status: JobStatus, opts?: { errorMessage?: string; subProgress?: SectionState["subProgress"] }): void {
    const now = Date.now();
    const prev = this.state.sections[sectionId];
    this.state.sections[sectionId] = {
      ...prev,
      status,
      startedAt: status === "generating" && !prev.startedAt ? now : prev.startedAt,
      finishedAt: (status === "done" || status === "error") ? now : prev.finishedAt,
      errorMessage: opts?.errorMessage,
      subProgress: opts?.subProgress ?? prev.subProgress,
    };
    if (status === "generating") {
      this.state.currentSection = sectionId;
    } else if (this.state.currentSection === sectionId && (status === "done" || status === "error")) {
      // Don't clear currentSection here — will be set when next job starts
    }
    this.emit();
  }

  /**
   * r7.24: Update the cost tracker's live label ("Currently: Stage 3 Beats" / "Shot List · Scene 5 of 8").
   * Pure UI label — does not affect pipeline state. Tolerates missing pipelineCost gracefully.
   */
  private setCostTrackerStage(stageLabel: string | undefined): void {
    try {
      const proj: any = this.callbacks.getProject?.();
      if (!proj?.pipelineCost) return; // no active run, skip
      this.callbacks.updateProject((p: any) => {
        if (!p.pipelineCost) return {} as any;
        return {
          pipelineCost: {
            ...p.pipelineCost,
            currentStage: stageLabel,
          },
        } as any;
      });
    } catch {
      // Never let cost tracker label fail the pipeline
    }
  }

  /**
   * r7.24: Compute inter-job delay based on project's rateLimitMode setting.
   * Falls back to callbacks.interJobDelayMs if explicit override given.
   * Default mode: "free" (4000ms) — matches Gemini Flash free tier 15/min.
   *
   * Modes:
   *   - free: 4000ms gap (~15 calls/min) — safest, default
   *   - tier1: 1000ms gap (~60 calls/min) — paid tier 1
   *   - aggressive: 200ms gap (~5 calls/sec) — risks quota
   */
  private getDelayMs(): number {
    // Explicit callback override wins (tests can force any value)
    if (typeof this.callbacks.interJobDelayMs === "number") {
      return this.callbacks.interJobDelayMs;
    }
    try {
      const proj: any = this.callbacks.getProject?.();
      const mode = proj?.settingV2?.rateLimitMode ?? "free";
      switch (mode) {
        case "aggressive":
          return 200;
        case "tier1":
          return 1000;
        case "free":
        default:
          return 4000;
      }
    } catch {
      return 4000; // safe default
    }
  }

  /**
   * r7.24: Exponential backoff retry wrapper for AI calls hitting 429 rate limit.
   * Tries operation up to 3 times: immediate, after 2s, after 4s, after 8s.
   * Only retries on errors matching rate limit patterns (429, "rate limit", "quota").
   */
  private async withRetry<T>(operation: () => Promise<T>, opLabel: string): Promise<T> {
    const delays = [0, 2000, 4000, 8000];
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        await this.sleep(delays[attempt]);
        this.callbacks.showToast(
          `⏳ Rate limit gặp ở ${opLabel}, retry sau ${delays[attempt] / 1000}s (lần ${attempt + 1}/${delays.length})...`,
          "info"
        );
      }
      try {
        return await operation();
      } catch (err) {
        lastErr = err as Error;
        const msg = lastErr.message.toLowerCase();
        const isRateLimit =
          msg.includes("429") ||
          msg.includes("rate limit") ||
          msg.includes("quota") ||
          msg.includes("resource_exhausted");
        if (!isRateLimit || attempt === delays.length - 1) {
          throw lastErr; // not a rate limit error, or last attempt — propagate
        }
        // else: fall through, will sleep + retry next iteration
      }
    }
    throw lastErr ?? new Error(`${opLabel}: unknown failure after retries`);
  }

  /**
   * Start full pipeline execution. Sequential, top-to-bottom.
   * Stops at Storyboard ready (no auto image gen).
   *
   * Reordered + skip-AI pipeline:
   *   Stage 1 Structure  → SKIP AI, gán từ direction.step1_storyStructure
   *   Stage 2 Twists     → SKIP AI, gán từ direction.step4_midpointTwist (multi-pick)
   *   Stage 3 Beats      → AI call, receives prelocked twists → places via containsTwistId
   *   Stage 4 Scenes     → AI call (unchanged)
   *   Stage 5 Dialogues  → AI call OR skip if no_dialog
   *   Detect Beats / Shot List / Grid build (unchanged)
   *
   * NOTE: SectionId enum labels still use "script-stage-2" for Twists step and
   * "script-stage-3" for Beats step in the new order (semantics matter, not naming).
   *
   * Throws on critical failure (preserves partial state for retry).
   */
  async start(direction: NarrativeDirection): Promise<void> {
    if (this.state.isRunning) {
      throw new Error("AutoChain already running");
    }
    this.abortRequested = false;
    this.state = createInitialAutoChainState();
    this.state.isRunning = true;
    this.state.startedAt = Date.now();
    this.emit();

    await this.runFromSection("script-stage-1", direction);
  }

  /**
   * Retry from a specific section onward. Used by UI retry button when a
   * section fails — instead of restarting the entire pipeline, resume from
   * the failed section forward.
   *
   * Sections already done before this point are preserved.
   * The target section's status resets to queued, then runs.
   */
  async retryFromSection(sectionId: SectionId, direction: NarrativeDirection): Promise<void> {
    if (this.state.isRunning) {
      throw new Error("AutoChain already running — đợi sprint hiện tại xong");
    }
    this.abortRequested = false;
    // Don't reset state — preserve completed sections.
    // Reset target + downstream sections to queued so retry continues clean.
    const ORDER = AUTO_CHAIN_SECTION_ORDER;
    const startIdx = ORDER.indexOf(sectionId);
    if (startIdx < 0) throw new Error(`Unknown section: ${sectionId}`);
    for (let i = startIdx; i < ORDER.length; i++) {
      this.state.sections[ORDER[i]].status = "queued";
      this.state.sections[ORDER[i]].errorMessage = undefined;
    }
    this.state.isRunning = true;
    this.state.startedAt = Date.now();
    this.emit();

    this.callbacks.showToast(`🔄 Retry từ ${sectionId}...`, "info");
    await this.runFromSection(sectionId, direction);
  }

  /**
   * Shared runner used by both start() and retryFromSection().
   * Executes sections in canonical order starting from the given section.
   */
  private async runFromSection(startSection: SectionId, direction: NarrativeDirection): Promise<void> {
    try {
      const runners: Array<[SectionId, () => Promise<void>]> = [
        ["script-stage-1", () => this.runScriptStage1(direction)],
        ["script-stage-2", () => this.runScriptStage2Twists(direction)],
        ["script-stage-3", () => this.runScriptStage3Beats(direction)],
        ["script-stage-4", () => this.runScriptStage4(direction)],
        ["characters", () => this.runCharacterBible()],
        ["script-stage-5", () => this.runScriptStage5()],
        ["analyze-scenes", () => this.runAnalyzeScenesAllScenes()],
        ["shot-list", () => this.runShotListAllScenes()],
      ];
      const startIdx = runners.findIndex(([id]) => id === startSection);
      if (startIdx < 0) throw new Error(`Unknown start section: ${startSection}`);

      // r7.36: track which section we're about to run (for accurate abort reporting)
      let currentRunningSection: SectionId = runners[startIdx][0];

      for (let i = startIdx; i < runners.length; i++) {
        // r7.36: detect user-cancelled abort BEFORE running next section
        if (this.abortRequested) {
          this.callbacks.updateProject({
            autoChainAbort: {
              abortedAtSection: currentRunningSection,
              reason: "user_cancelled",
              abortedAt: new Date().toISOString(),
            },
          } as any);
          return;
        }
        currentRunningSection = runners[i][0];
        const [, runner] = runners[i];
        await runner();
      }

      this.state.finishedAt = Date.now();
      this.state.isRunning = false;
      this.state.currentSection = null;
      this.emit();

      // r7.36: clear abort record on successful complete run — banner won't show
      this.callbacks.updateProject({
        autoChainAbort: null,
      } as any);

      const durationSec = ((this.state.finishedAt - (this.state.startedAt ?? 0)) / 1000).toFixed(1);
      this.callbacks.showToast(
        `Auto-chain hoàn thành (${durationSec}s, ${this.state.totalAiCalls} AI calls). Shot list sẵn sàng — mở "🎬 Beats & video prompt" ở từng scene để tạo prompt.`,
        "success"
      );
    } catch (err) {
      this.state.isRunning = false;
      this.emit();

      // r7.36: record abort with error reason — banner will show until user dismisses
      const currentSection = this.state.currentSection || startSection;
      this.callbacks.updateProject({
        autoChainAbort: {
          abortedAtSection: currentSection,
          reason: "error",
          errorMessage: (err as Error).message,
          abortedAt: new Date().toISOString(),
        },
      } as any);

      this.callbacks.showToast(`Auto-chain lỗi: ${(err as Error).message}`, "error");
      throw err;
    }
  }


  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // Per-stage execution methods (privte, sequential)
  // ==========================================================================

  /**
   * Script Stage 1 (Structure) — SKIP AI CALL.
   * Gán framework + overview trực tiếp từ direction.step1_storyStructure.
   * - frameworkCode: lấy từ pick.frameworkCode (Option A/B/C/D) hoặc fallback "three-act" (Option E free text)
   * - contentVi: lấy từ pick.resolvedDescriptionVi hoặc customTextVi
   * - contentEn: lấy từ pick.resolvedTitleEn (short label — Stage Beats will use contentVi for context)
   * 0 AI calls.
   */
  private async runScriptStage1(direction: NarrativeDirection): Promise<void> {
    this.setStatus("script-stage-1", "generating"); this.setCostTrackerStage("Stage 1 — Structure");
    try {
      const project = this.callbacks.getProject();
      const film = (project as PromptProject & ProjectV09Extensions).filmV093;
      const setting = (project as PromptProject & ProjectV09Extensions).settingV2;
      if (!film || !setting) throw new Error("Missing filmV093 or settingV2 in project");

      const step1 = direction.step1_storyStructure;
      // Validate framework code; fallback "three-act" for free text (Option E) or invalid codes
      const VALID_CODES = new Set([
        "three-act", "hero-journey", "save-the-cat",
        "kishotenketsu", "mystery-thriller", "tragedy-doom",
      ]);
      const framework: import("../types/film").FilmStoryFramework =
        step1.frameworkCode && VALID_CODES.has(step1.frameworkCode)
          ? step1.frameworkCode as import("../types/film").FilmStoryFramework
          : "three-act";

      const contentVi = step1.resolvedDescriptionVi || step1.customTextVi || "(no overview)";
      const contentEn = step1.resolvedTitleEn || "Custom user direction";

      const result = {
        framework,
        contentEn,
        contentVi,
      };

      // No AI call → totalAiCalls NOT incremented (cost: 0)

      const { setScriptStructure, setScriptStage } = await import("../store/film_actions");
      this.callbacks.updateProject((p) => {
        const structPatch = setScriptStructure(p, result);
        // After Stage 1 done, next stage in NEW ORDER is "twists" (not "beats")
        const stagePatch = setScriptStage({ ...p, ...structPatch } as PromptProject, "twists");
        return { ...structPatch, ...stagePatch };
      });

      this.setStatus("script-stage-1", "done");
      await this.sleep(this.getDelayMs());
    } catch (err) {
      this.setStatus("script-stage-1", "error", { errorMessage: (err as Error).message });
      throw err;
    }
  }

  /**
   * Script Stage 2 (Twists) — SKIP AI CALL. NEW POSITION (before Beats).
   *
   * Lấy 1-3 twists từ direction.step4_midpointTwist (multi-pick):
   * - Primary pick → twist #1 (description = resolvedDescriptionVi, archetypeTag = step4.archetypeTag)
   * - additionalPicks[] → twist #2, #3 (max 3 total via UI checkbox enforcement)
   *
   * beatId is LEFT UNDEFINED — will be filled later by Stage Beats AI via
   * containsTwistId field on beats. Post-hoc sanitizer matches beat.containsTwistId
   * → twist.id and fills twist.beatId.
   *
   * 0 AI calls.
   */
  private async runScriptStage2Twists(direction: NarrativeDirection): Promise<void> {
    this.setStatus("script-stage-2", "generating"); this.setCostTrackerStage("Stage 2 — Twists");
    try {
      const project = this.callbacks.getProject();
      const film = (project as PromptProject & ProjectV09Extensions).filmV093;
      const setting = (project as PromptProject & ProjectV09Extensions).settingV2;
      if (!film || !setting) throw new Error("Missing filmV093 or settingV2");

      const step4 = direction.step4_midpointTwist;

      // Build twist list from primary pick + additionalPicks
      const allPicksData = [
        {
          desc: step4.resolvedDescriptionVi || step4.customTextVi || "(no description)",
          tag: step4.archetypeTag,
        },
        ...(step4.additionalPicks ?? []).map((p) => ({
          desc: p.resolvedDescriptionVi || "(no description)",
          tag: p.archetypeTag,
        })),
      ];

      // each twist gets a stable id (used later by Stage Beats containsTwistId)
      const twists: import("../types/film").FilmScriptTwist[] = allPicksData.map((p) => ({
        id: `twist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        // beatId intentionally undefined — filled by Stage Beats placement
        beatId: undefined,
        description: p.desc,
        accepted: true, // auto-accepted (user already picked in Preview Flow)
        source: "preview-flow",
        archetypeTag: p.tag,
      }));

      // No AI call

      const { setScriptTwists, lockScriptTwists, setScriptStage } = await import("../store/film_actions");
      this.callbacks.updateProject((p) => {
        const twistsPatch = setScriptTwists(p, twists);
        const lockPatch = lockScriptTwists({ ...p, ...twistsPatch } as PromptProject);
        // After Stage 2 (Twists) done, next stage is "beats" (NEW ORDER: Stage 3)
        const stagePatch = setScriptStage(
          { ...p, ...twistsPatch, ...lockPatch } as PromptProject,
          "beats"
        );
        return { ...twistsPatch, ...lockPatch, ...stagePatch };
      });

      this.setStatus("script-stage-2", "done");
      await this.sleep(this.getDelayMs());
    } catch (err) {
      this.setStatus("script-stage-2", "error", { errorMessage: (err as Error).message });
      throw err;
    }
  }

  /**
   * Script Stage 3 (Beats) — AI CALL with prelockedTwists. NEW POSITION (after Twists).
   *
   * Receives pre-locked twists from Stage 2 → passes to runStage2Beats as prelockedTwists.
   * AI places each twist at appropriate beat position via containsTwistId field.
   * Post-hoc: this method matches beat.containsTwistId → twist.id and fills twist.beatId,
   * persisting both updated beats AND updated twists.
   */
  private async runScriptStage3Beats(direction: NarrativeDirection): Promise<void> {
    this.setStatus("script-stage-3", "generating"); this.setCostTrackerStage("Stage 3 — Beats");
    try {
      const project = this.callbacks.getProject();
      const film = (project as PromptProject & ProjectV09Extensions).filmV093;
      const setting = (project as PromptProject & ProjectV09Extensions).settingV2;
      if (!film || !setting) throw new Error("Missing filmV093 or settingV2");
      if (!film.scriptStructure) throw new Error("Stage 1 missing before Stage 3 (Beats)");

      // Get prelocked twists from Stage 2 (Twists ran first)
      const prelockedTwists = film.scriptTwists ?? [];

      const result = await runStage2Beats({
        idea: project.idea?.raw ?? "",
        setting,
        characters: film.characters,
        structure: film.scriptStructure,
        provider: getProviderFromSetting(setting, "scriptWriter"),
        narrativeDirection: direction,
        prelockedTwists,
      });
      this.state.totalAiCalls++;

      // post-hoc sanitizer — match beat.containsTwistId → twist.id and fill twist.beatId
      // Also validate twist spread (warn if 2 twists in same/adjacent beats)
      const updatedTwists: import("../types/film").FilmScriptTwist[] = prelockedTwists.map((t) => {
        const beat = result.find((b) => b.containsTwistId === t.id);
        return beat ? { ...t, beatId: beat.id } : t;
      });

      // Sanity check: warn if any twist failed to get a beat assignment (AI didn't place it)
      const unassignedTwists = updatedTwists.filter((t) => !t.beatId);
      if (unassignedTwists.length > 0) {
        // Fallback: assign unassigned twists to evenly-spaced beats
        const beatCount = result.length;
        unassignedTwists.forEach((t, i) => {
          // Spread across acts: idx ~ (i+1) / (n+1) of beatCount
          const targetIdx = Math.min(
            beatCount - 1,
            Math.floor((beatCount * (i + 1)) / (unassignedTwists.length + 1))
          );
          // Find first beat not already containing a twist
          let fallbackBeat = result[targetIdx];
          if (fallbackBeat.containsTwistId) {
            // Walk forward to find empty slot
            for (let k = targetIdx + 1; k < beatCount; k++) {
              if (!result[k].containsTwistId) {
                fallbackBeat = result[k];
                break;
              }
            }
          }
          if (!fallbackBeat.containsTwistId) {
            fallbackBeat.containsTwistId = t.id;
            const idx = updatedTwists.findIndex((x) => x.id === t.id);
            if (idx >= 0) updatedTwists[idx] = { ...t, beatId: fallbackBeat.id };
          }
        });
        console.warn(`[AutoChain] ${unassignedTwists.length} twist(s) needed fallback beat placement.`);
      }

      const { setScriptBeats, setScriptTwists, lockScriptTwists, setScriptStage } = await import("../store/film_actions");
      this.callbacks.updateProject((p) => {
        const beatsPatch = setScriptBeats(p, result);
        const twistsPatch = setScriptTwists({ ...p, ...beatsPatch } as PromptProject, updatedTwists);
        // Re-lock twists (setScriptTwists clears the lock; re-apply since user picked these via Preview Flow)
        const lockPatch = lockScriptTwists({ ...p, ...beatsPatch, ...twistsPatch } as PromptProject);
        const stagePatch = setScriptStage(
          { ...p, ...beatsPatch, ...twistsPatch, ...lockPatch } as PromptProject,
          "scenes"
        );
        return { ...beatsPatch, ...twistsPatch, ...lockPatch, ...stagePatch };
      });

      this.setStatus("script-stage-3", "done");
      await this.sleep(this.getDelayMs());
    } catch (err) {
      this.setStatus("script-stage-3", "error", { errorMessage: (err as Error).message });
      throw err;
    }
  }

  private async runScriptStage4(direction: NarrativeDirection): Promise<void> {
    this.setStatus("script-stage-4", "generating"); this.setCostTrackerStage("Stage 4 — Scenes");
    try {
      const project = this.callbacks.getProject();
      const film = (project as PromptProject & ProjectV09Extensions).filmV093;
      const setting = (project as PromptProject & ProjectV09Extensions).settingV2;
      if (!film || !setting) throw new Error("Missing filmV093 or settingV2");
      if (!film.scriptStructure) throw new Error("Stage 1 missing");
      const beats = film.scriptBeats ?? [];
      const twists = film.scriptTwists ?? [];

      const result = await runStage4Scenes({
        idea: project.idea?.raw ?? "",
        setting,
        characters: film.characters,
        structure: film.scriptStructure,
        beats,
        acceptedTwists: twists,
        provider: getProviderFromSetting(setting, "scriptWriter"),
        narrativeDirection: direction,
      });
      this.state.totalAiCalls++;

      const { setScriptIntermediateScenes, lockScriptScenes, setScriptStage } = await import("../store/film_actions");
      this.callbacks.updateProject((p) => {
        const interPatch = setScriptIntermediateScenes(p, result);
        const lockPatch = lockScriptScenes({ ...p, ...interPatch } as PromptProject);
        const stagePatch = setScriptStage(
          { ...p, ...interPatch, ...lockPatch } as PromptProject,
          "dialogues"
        );
        return { ...interPatch, ...lockPatch, ...stagePatch };
      });

      this.setStatus("script-stage-4", "done");
      await this.sleep(this.getDelayMs());
    } catch (err) {
      this.setStatus("script-stage-4", "error", { errorMessage: (err as Error).message });
      throw err;
    }
  }

  /**
   * r8.1: Character bible — AI derives on-screen characters + fixed English
   * appearance text from idea + Stage 4 scenes. Runs before Stage 5 so
   * dialogue, shot list and video prompts all use the same names.
   * Skipped when the project already has characters (legacy Cast data).
   */
  private async runCharacterBible(): Promise<void> {
    this.setStatus("characters", "generating"); this.setCostTrackerStage("Characters");
    try {
      const project = this.callbacks.getProject();
      const film = (project as PromptProject & ProjectV09Extensions).filmV093;
      const setting = (project as PromptProject & ProjectV09Extensions).settingV2;
      if (!film || !setting) throw new Error("Missing filmV093 or settingV2");
      if ((film.characters ?? []).some((c) => c.name && c.description)) {
        this.setStatus("characters", "done");
        return;
      }
      const { generateCharacterBible } = await import("./characterBible");
      const characters = await generateCharacterBible({
        idea: project.idea?.raw ?? "",
        setting,
        structure: film.scriptStructure,
        scenes: film.scriptIntermediateScenes ?? [],
        provider: getProviderFromSetting(setting, "scriptWriter"),
      });
      this.state.totalAiCalls++;
      const { setCharacters } = await import("../store/film_actions");
      this.callbacks.updateProject((p) => setCharacters(p, characters));
      this.setStatus("characters", "done");
      await this.sleep(this.getDelayMs());
    } catch (err) {
      this.setStatus("characters", "error", { errorMessage: (err as Error).message });
      throw err;
    }
  }

  private async runScriptStage5(): Promise<void> {
    this.setStatus("script-stage-5", "generating"); this.setCostTrackerStage("Stage 5 — Dialogues");
    try {
      const project = this.callbacks.getProject();
      const film = (project as PromptProject & ProjectV09Extensions).filmV093;
      const setting = (project as PromptProject & ProjectV09Extensions).settingV2;
      if (!film || !setting) throw new Error("Missing filmV093 or settingV2");

      if (!film.scriptStructure) throw new Error("Stage 1 missing");
      const beats = film.scriptBeats ?? [];
      const twists = film.scriptTwists ?? [];
      const interScenes = film.scriptIntermediateScenes ?? [];
      if (interScenes.length === 0) throw new Error("Stage 4 scenes missing");

      const { setScript } = await import("../store/film_actions");

      // r7.28-fix: no_dialog mode — build FilmScript directly from intermediateScenes
      // WITHOUT calling AI (saves ~$0.005). Critical: this also OVERRIDES any stale
      // film.script from previous project (e.g. after duplicate). Previous code did
      // `setStatus("done"); return;` early-return which left film.script untouched,
      // causing Gấu Bự → Robot N.A.M.O bug where downstream (Shot List + Storyboard)
      // read old project's film.script instead of the fresh intermediateScenes.
      if (setting.dialog === "no_dialog") {
        const noDialogScript = buildNoDialogScript({
          project,
          intermediateScenes: interScenes,
        });
        this.callbacks.updateProject((p) => setScript(p, noDialogScript));
        this.setStatus("script-stage-5", "done");
        await this.sleep(this.getDelayMs());
        return;
      }

      const result = await runStage5FromStages({
        idea: project.idea?.raw ?? "",
        setting,
        characters: film.characters,
        structure: film.scriptStructure,
        beats,
        acceptedTwists: twists,
        intermediateScenes: interScenes,
        provider: getProviderFromSetting(setting, "scriptWriter"),
      });
      this.state.totalAiCalls++;

      // Apply Stage 5 result via existing setScript action
      this.callbacks.updateProject((p) => setScript(p, result));

      this.setStatus("script-stage-5", "done");
      await this.sleep(this.getDelayMs());
    } catch (err) {
      this.setStatus("script-stage-5", "error", { errorMessage: (err as Error).message });
      throw err;
    }
  }

  private async runAnalyzeScenesAllScenes(): Promise<void> {
    this.setStatus("analyze-scenes", "generating"); this.setCostTrackerStage("Analyzing scenes");
    try {
      const project = this.callbacks.getProject();
      const film = (project as PromptProject & ProjectV09Extensions).filmV093;
      const setting = (project as PromptProject & ProjectV09Extensions).settingV2;
      if (!film || !setting) throw new Error("Missing filmV093 or settingV2");
      const scenes = film.script?.scenes ?? [];
      if (scenes.length === 0) throw new Error("No scenes from Stage 4/5 to process");

      const { applyBeatsAndPhysicalLock } = await import("../store/film_actions");

      // Track failures across scenes to surface aggregated error UI when loop ends.
      const failures: Array<{ sceneId: string; sceneTitle: string; error: Error }> = [];

      for (let i = 0; i < scenes.length; i++) {
        if (this.abortRequested) return;
        const scene = scenes[i];
        this.setStatus("analyze-scenes", "generating", {
          subProgress: { current: i + 1, total: scenes.length, currentSceneTitle: scene.titleEn || scene.titleVi || `Scene ${scene.order}` },
        });

        try {
          const result = await runDetectBeatsForScene({
            scene: {
              id: scene.id,
              order: scene.order,
              titleVi: scene.titleVi,
              titleEn: scene.titleEn,
              actionLinesVi: scene.actionLinesVi,
              actionLinesEn: scene.actionLinesEn,
              settings: scene.settings,
            },
            provider: getProviderFromSetting(setting, "scriptWriter"),
          });
          this.state.totalAiCalls++;

          this.callbacks.updateProject((p) => applyBeatsAndPhysicalLock(p, { [scene.id]: result }));
        } catch (perSceneErr) {
          const sceneTitle = scene.titleVi || scene.titleEn || `Scene ${scene.order}`;
          console.warn(`[AutoChain] Analyze Scenes scene ${scene.id} (${sceneTitle}) failed:`, perSceneErr);
          failures.push({ sceneId: scene.id, sceneTitle, error: perSceneErr as Error });
        }
      }

      // All-fail: hard error. Partial-fail: warning toast, continue.
      if (failures.length === scenes.length && scenes.length > 0) {
        const firstReason = failures[0].error.message;
        const aggregateMsg = `Tất cả ${scenes.length} scenes đều fail analyze. Lỗi đầu tiên: ${firstReason}`;
        this.setStatus("analyze-scenes", "error", { errorMessage: aggregateMsg });
        this.callbacks.showToast(`❌ Analyze Scenes: ${aggregateMsg}`, "error");
        throw new Error(aggregateMsg);
      }
      if (failures.length > 0) {
        const failedTitles = failures.map((f) => f.sceneTitle).join(", ");
        const warnMsg = `${failures.length}/${scenes.length} scenes failed analyze: ${failedTitles}. Scenes này sẽ thiếu beats + physical lock + color script.`;
        console.warn(`[AutoChain] Analyze Scenes partial fail:`, warnMsg);
        this.callbacks.showToast(`⚠️ Analyze Scenes: ${warnMsg}`, "info");
      }

      this.setStatus("analyze-scenes", "done", { subProgress: undefined });
      await this.sleep(this.getDelayMs());
    } catch (err) {
      this.setStatus("analyze-scenes", "error", { errorMessage: (err as Error).message });
      throw err;
    }
  }

  private async runShotListAllScenes(): Promise<void> {
    this.setStatus("shot-list", "generating"); this.setCostTrackerStage("Shot List generation");
    try {
      const project = this.callbacks.getProject();
      const film = (project as PromptProject & ProjectV09Extensions).filmV093;
      const setting = (project as PromptProject & ProjectV09Extensions).settingV2;
      if (!film || !setting) throw new Error("Missing filmV093 or settingV2");
      const scenes = film.script?.scenes ?? [];
      if (scenes.length === 0) throw new Error("No scenes to process");

      // Import dynamically (avoids circular deps)
      const { runShotListForScene } = await import("./filmShotListGeneration");
      const { setShotsForScene } = await import("../store/film_actions");

      // Track failures across scenes to surface aggregated error UI when loop ends.
      // Silent per-scene catches led to "0 shots, no error toast" bug when AI consistently
      // hits MAX_TOKENS or returns invalid JSON across all scenes.
      const failures: Array<{ sceneId: string; sceneTitle: string; error: Error }> = [];

      for (let i = 0; i < scenes.length; i++) {
        if (this.abortRequested) return;
        const scene = scenes[i];
        this.setStatus("shot-list", "generating", {
          subProgress: { current: i + 1, total: scenes.length, currentSceneTitle: scene.titleEn || scene.titleVi || `Scene ${scene.order}` },
        });

        try {
          const generated = await runShotListForScene({
            scene,
            characters: film.characters,
            setting,
            provider: getProviderFromSetting(setting, "scriptWriter"),
            videoProviderId: (setting as any).defaultVideoProvider ?? "seedance-2-pro",
            beats: (scene as any).beats,
          });
          this.state.totalAiCalls++;

          // Map GeneratedShot → FilmShot (same as FilmShotListSection does)
          const newShots = generated.map((gs, idx) => ({
            id: `shot_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
            order: idx + 1,
            titleEn: gs.titleEn,
            titleVi: gs.titleVi,
            shotType: gs.shotType,
            durationSeconds: gs.durationSeconds,
            gridFormat: "3x3" as const,
            cameraMovement: gs.cameraMovement as any,
            purpose: gs.purposeVi,
            purposeVi: gs.purposeVi,
            purposeEn: gs.purposeEn,
            actionVi: gs.actionVi,
            actionEn: gs.actionEn,
            status: "draft" as const,
            rhythmRole: gs.rhythmRole,
            lightingHintEn: gs.lightingHintEn,
            coveredBeatIds: gs.coveredBeatIds,
            innerStateVi: gs.innerStateVi,
          } as any));

          // Persist via existing action
          this.callbacks.updateProject((p) => setShotsForScene(p, scene.id, newShots));
        } catch (perSceneErr) {
          const sceneTitle = scene.titleVi || scene.titleEn || `Scene ${scene.order}`;
          console.warn(`[AutoChain] Shot List scene ${scene.id} (${sceneTitle}) failed:`, perSceneErr);
          failures.push({ sceneId: scene.id, sceneTitle, error: perSceneErr as Error });
        }
      }

      // Aggregate result: all-fail → error status, partial-fail → done + warning, all-ok → done
      if (failures.length === scenes.length && scenes.length > 0) {
        const firstReason = failures[0].error.message;
        const aggregateMsg = `Tất cả ${scenes.length} scenes đều fail. Lỗi đầu tiên: ${firstReason}`;
        this.setStatus("shot-list", "error", { errorMessage: aggregateMsg });
        this.callbacks.showToast(`❌ Shot List: ${aggregateMsg}`, "error");
        throw new Error(aggregateMsg);
      }
      if (failures.length > 0) {
        const failedTitles = failures.map((f) => f.sceneTitle).join(", ");
        const warnMsg = `${failures.length}/${scenes.length} scenes failed shot generation: ${failedTitles}. Click "AI sinh shot list" manual cho các scenes còn thiếu.`;
        console.warn(`[AutoChain] Shot List partial fail:`, warnMsg);
        this.callbacks.showToast(`⚠️ Shot List: ${warnMsg}`, "info");
        // Continue with status=done since some scenes have shots — user can manual-fill the rest
      }

      this.setStatus("shot-list", "done", { subProgress: undefined });
      this.setCostTrackerStage(undefined); // r8.0: shot-list is the last stage — clear live cost label
    } catch (err) {
      this.setStatus("shot-list", "error", { errorMessage: (err as Error).message });
      throw err;
    }
  }

}

// ============================================================================
// Helpers
// ============================================================================

function getProviderFromSetting(setting: ProjectSettingV2, task: "scriptWriter"): FilmScriptProvider {
  return (setting.aiProviders?.[task] ?? "gemini-flash") as FilmScriptProvider;
}

/**
 * r7.28-fix: Build FilmScript directly from intermediate scenes WITHOUT AI call.
 *
 * Used in no_dialog mode to ensure film.script is freshly built from the current
 * project's intermediateScenes — preventing stale film.script from leaking when
 * user duplicates a project then changes idea (root cause of "Gấu Bự → Robot
 * N.A.M.O" bug reported on May 21, 2026).
 *
 * Derives required FilmScript fields (titleEn, logline, synopsisEn) from project
 * idea + scenes. Maps intermediate scene fields → FilmSceneScript with empty
 * dialog/sfx/musicBrief (no_dialog mode constraints).
 */
function buildNoDialogScript(input: {
  project: PromptProject;
  intermediateScenes: import("../types/film").FilmScriptIntermediateScene[];
}): FilmScript {
  const { project, intermediateScenes } = input;
  const ideaText = (project.idea?.raw ?? "").trim();
  const projectName = project.name?.trim() || "Untitled Film";

  // Derive logline (first sentence or first 200 chars of idea)
  const firstSentenceMatch = ideaText.match(/^[^.!?]+[.!?]/);
  const logline = firstSentenceMatch
    ? firstSentenceMatch[0].trim().slice(0, 200)
    : ideaText.slice(0, 200);

  // Derive synopsis: concat first 80 chars of each scene's actionLinesEn
  const synopsisEn = intermediateScenes
    .map((s) => (s.actionLinesEn || "").slice(0, 80))
    .filter((s) => s.length > 0)
    .join(" → ");
  const synopsisVi = intermediateScenes
    .map((s) => (s.actionLinesVi || "").slice(0, 80))
    .filter((s) => s.length > 0)
    .join(" → ");

  // Map intermediate scenes → FilmSceneScript with empty dialog/sfx
  const scenes: FilmSceneScript[] = intermediateScenes.map((s, idx) => ({
    id: s.id,
    order: s.order,
    titleEn: s.titleEn,
    titleVi: s.titleVi,
    settings: s.settings,
    durationSeconds: s.durationSeconds,
    act: deriveActFromIndex(idx, intermediateScenes.length),
    actionLinesEn: s.actionLinesEn,
    actionLinesVi: s.actionLinesVi,
    dialog: [],
    sfx: [],
    musicBrief: "",
    tensionLevel: s.tensionLevel,
    emotionalTone: s.emotionalTone,
  }));

  return {
    titleEn: projectName,
    titleVi: projectName,
    logline,
    loglineVi: logline,
    synopsisEn,
    synopsisVi,
    scenes,
    aiProvider: "manual",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Derive act label from scene position in narrative arc.
 * Heuristic: scene 1 = setup, last scene = resolution, middle scenes follow
 * standard 3-act distribution (inciting → rising → climax).
 */
function deriveActFromIndex(idx: number, total: number): FilmSceneScript["act"] {
  if (total <= 1) return "setup";
  if (idx === 0) return "setup";
  if (idx === total - 1) return "resolution";
  const pct = idx / (total - 1);
  if (pct < 0.3) return "inciting";
  if (pct < 0.7) return "rising";
  return "climax";
}
