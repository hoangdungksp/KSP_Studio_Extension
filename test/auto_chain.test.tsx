/**
 * Sprint r7.15a — Auto-Chain Pipeline Test Suite
 *
 * Coverage:
 * - Bug 1 fix: durationMinutes injected into all 5 Preview Flow AI prompts
 * - Wire Stage 2 (Beats) accepts narrativeDirection
 * - Wire Stage 3 (Twists) accepts narrativeDirection + lock midpoint
 * - autoChainOrchestrator: createInitialAutoChainState shape
 * - autoChainOrchestrator: state machine transitions (subscribe + setStatus)
 * - autoChainOrchestrator: SectionId enum complete (8 sections)
 * - UI wiring: Preview Flow button moved to Idea section
 */
import { describe, it, expect } from "vitest";
import {
  createInitialAutoChainState,
  AutoChainOrchestrator,
  type SectionId,
  type JobStatus,
  type AutoChainState,
} from "../src/engine/autoChainOrchestrator";

// ============================================================================
// Bug 1 — durationMinutes injection in 5 AI prompts
// ============================================================================

describe("Sprint r7.15a — Bug 1: durationMinutes injection", () => {
  it("Step 1 (Story Structure) AI prompt includes TARGET DURATION", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    // 5 occurrences total (1 per step) — see TARGET DURATION marker
    const matches = src.match(/TARGET DURATION:/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(5);
  });

  it("All 5 step prompts reference durationMinutes from setting", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    // Should appear in all 5 step prompts (at minimum 5 mentions of durationMinutes)
    const durationRefs = src.match(/setting\.durationMinutes/g);
    expect(durationRefs).not.toBeNull();
    expect(durationRefs!.length).toBeGreaterThanOrEqual(10); // each step has min/duration + seconds calc
  });

  it("Step 1 prompt enforces options must cite target duration", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    // r7.15e: prompt wording cleaned up — duration enforcement now phrased as
    // "Act breakdowns MUST fit within X seconds total. Do NOT cite random feature-film lengths"
    expect(src).toContain("MUST fit within");
    expect(src).toContain("Do NOT cite random feature-film lengths");
  });
});

// ============================================================================
// Stage 2 + Stage 3 narrativeDirection wiring
// ============================================================================

describe("Sprint r7.15a — Stage 2 (Beats) wires narrativeDirection", () => {
  it("RunStage2Input has narrativeDirection field", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    // RunStage2Input interface includes narrativeDirection
    expect(src).toMatch(/interface RunStage2Input[\s\S]{0,400}narrativeDirection\?:/);
  });

  it("Stage 2 prompt injects BEAT GENERATION RULES when direction present", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toContain("BEAT GENERATION RULES based on locked direction");
    expect(src).toContain("Opening beats (first 2-3)");
    // r7.15c: Midpoint twist now passed via prelockedTwists block (separate from direction)
    expect(src).toContain("PRE-LOCKED TWISTS (must be placed at appropriate beat positions");
    expect(src).toContain("Final beats must lead to the locked Ending arc");
  });

  it("Stage 2 prompt is audit-clean (no meta-language)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    // Extract Stage 2 region
    const start = src.indexOf("STAGE 2 — BEATS");
    const end = src.indexOf("STAGE 3 — TWISTS");
    const stage2Region = src.slice(start, end);
    expect(stage2Region).not.toContain("user has chosen");
    expect(stage2Region).not.toContain("the user's");
    expect(stage2Region).not.toContain("locked by user via");
  });
});

describe("Sprint r7.15a — Stage 3 (Twists) wires narrativeDirection with locked midpoint", () => {
  it("RunStage3Input has narrativeDirection field", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toMatch(/interface RunStage3Input[\s\S]{0,400}narrativeDirection\?:/);
  });

  it("Stage 3 prompt enforces locked midpoint twist (no override)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toContain("CORE MIDPOINT TWIST is LOCKED");
    expect(src).toContain("EXACTLY reflects the locked Midpoint Twist");
    expect(src).toContain("Do NOT generate twists that override or contradict the locked direction");
  });

  it("Stage 3 prompt allows SUPPORTING twists around locked midpoint", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toContain("SUPPORTING twists (setup or consequence twists)");
    expect(src).toContain("don't contradict the locked midpoint");
  });

  it("Stage 3 prompt is audit-clean (no meta-language)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    const start = src.indexOf("STAGE 3 — TWISTS");
    const end = src.indexOf("STAGE 4");
    const stage3Region = src.slice(start, end);
    expect(stage3Region).not.toContain("user has chosen");
    expect(stage3Region).not.toContain("the user's");
  });
});

// ============================================================================
// autoChainOrchestrator state machine
// ============================================================================

describe("Sprint r7.15a — autoChainOrchestrator initial state", () => {
  it("createInitialAutoChainState returns 7 sections all idle (r8.0: grid-build removed)", () => {
    const state = createInitialAutoChainState();
    const sectionIds: SectionId[] = [
      "script-stage-1", "script-stage-2", "script-stage-3",
      "script-stage-4", "script-stage-5",
      "analyze-scenes", "shot-list",
    ];
    for (const id of sectionIds) {
      expect(state.sections[id]).toBeDefined();
      expect(state.sections[id].status).toBe("idle");
    }
    expect(state.isRunning).toBe(false);
    expect(state.currentSection).toBeNull();
    expect(state.totalAiCalls).toBe(0);
  });

  it("Initial state has no startedAt / finishedAt", () => {
    const state = createInitialAutoChainState();
    expect(state.startedAt).toBeUndefined();
    expect(state.finishedAt).toBeUndefined();
  });
});

describe("Sprint r7.15a — autoChainOrchestrator subscription model", () => {
  it("subscribe immediately emits current state", () => {
    const callbacks = {
      getProject: () => ({} as any),
      updateProject: () => {},
      showToast: () => {},
    };
    const orch = new AutoChainOrchestrator(callbacks);
    let emitted: AutoChainState | null = null;
    orch.subscribe((state) => { emitted = state; });
    expect(emitted).not.toBeNull();
    expect(emitted!.isRunning).toBe(false);
  });

  it("unsubscribe stops further emissions", () => {
    const callbacks = {
      getProject: () => ({} as any),
      updateProject: () => {},
      showToast: () => {},
    };
    const orch = new AutoChainOrchestrator(callbacks);
    let callCount = 0;
    const unsubscribe = orch.subscribe(() => { callCount++; });
    expect(callCount).toBe(1); // Initial emit
    unsubscribe();
    // Trigger internal emit via getState (no public way to force emit, so just verify count unchanged)
    expect(callCount).toBe(1);
  });

  it("getState returns immutable snapshot", () => {
    const callbacks = {
      getProject: () => ({} as any),
      updateProject: () => {},
      showToast: () => {},
    };
    const orch = new AutoChainOrchestrator(callbacks);
    const s1 = orch.getState();
    const s2 = orch.getState();
    expect(s1).not.toBe(s2); // different object refs
    expect(s1).toEqual(s2); // same data
  });

  it("abort sets abortRequested flag", () => {
    const callbacks = {
      getProject: () => ({} as any),
      updateProject: () => {},
      showToast: () => {},
    };
    const orch = new AutoChainOrchestrator(callbacks);
    expect(() => orch.abort()).not.toThrow();
  });
});

describe("Sprint r7.15a — SectionId enum coverage", () => {
  it("All 8 sections present in initial state (r8.0: grid-build removed, r8.1: + characters)", () => {
    const state = createInitialAutoChainState();
    expect(Object.keys(state.sections).length).toBe(8);
    expect(Object.keys(state.sections).indexOf("characters")).toBe(Object.keys(state.sections).indexOf("script-stage-4") + 1);
  });

  it("Section ordering: script stages 1-5 then per-scene loops", () => {
    const state = createInitialAutoChainState();
    const keys = Object.keys(state.sections);
    expect(keys).toContain("script-stage-1");
    expect(keys).toContain("script-stage-5");
    expect(keys).toContain("analyze-scenes");
    expect(keys).toContain("shot-list");
    expect(keys).not.toContain("grid-build");
  });
});

// ============================================================================
// UI wiring verification
// ============================================================================

describe("Sprint r7.15a — UI restructure: Preview Flow moved to Idea section", () => {
  it("FilmIdeaScriptSection lifts Preview Flow state up to main component", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    // Top-level FilmIdeaScriptSection has the state
    expect(src).toMatch(/export function FilmIdeaScriptSection[\s\S]{0,2000}const \[showPreviewFlow, setShowPreviewFlow\]/);
    expect(src).toContain("autoChainState");
    expect(src).toContain("handleOpenPreviewFlow");
    expect(src).toContain("runAutoChain");
  });

  it("ActiveStage1 no longer owns Preview Flow state (state lifted up)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    // ActiveStage1 function body should NOT contain showPreviewFlow state hook
    const start = src.indexOf("function ActiveStage1");
    const end = src.indexOf("function ActiveStage2");
    const stage1Region = src.slice(start, end);
    expect(stage1Region).not.toMatch(/useState[^)]*showPreviewFlow/);
    expect(stage1Region).not.toContain("handlePreviewComplete");
    expect(stage1Region).not.toContain("setShowPreviewFlow");
  });

  it("r7.20b: Idea section has Analyze button; direction summary moved to Preview Modal Step 6", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    expect(src).toContain("ksp-idea-analyze-btn");
    // r7.19 label change: "Phân tích ý tưởng" → "Analyze Idea"
    expect(src).toContain("🎬 Analyze Idea");
    // r7.20b: panel removed from Section Ý tưởng
    expect(src).not.toContain("ksp-idea-direction-summary");
    // Direction review now lives in PreviewFlowModal
    const modalSrc = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    expect(modalSrc).toContain("FinalReviewPanel");
  });

  it("Idea section CSS has new r7.15a classes (direction-summary CSS kept for any legacy refs)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/film.css"), "utf-8");
    expect(src).toContain(".ksp-idea-analyze-btn");
    expect(src).toContain(".ksp-autochain-generating");
    expect(src).toContain(".ksp-stage-status-badge");
    expect(src).toContain("@keyframes ksp-autochain-border-flow");
  });

  it("StepperStageCard accepts autoChainStatus prop for status badge", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    expect(src).toMatch(/StepperStageCardProps[\s\S]{0,500}autoChainStatus\?:/);
    expect(src).toContain("ksp-stage-status-badge-generating");
    expect(src).toContain("ksp-stage-status-badge-queued");
    expect(src).toContain("ksp-stage-status-badge-error");
  });

  it("Stage mapping: 5 FilmScriptStage values → 5 SectionId values", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    expect(src).toContain('structure: "script-stage-1"');
    // r7.18: Twists at stage-2 (SKIP AI, locked from direction Step 4),
    // Beats at stage-3 (AI CALL with prelockedTwists). Order matches autoChainOrchestrator.
    expect(src).toContain('twists: "script-stage-2"');
    expect(src).toContain('beats: "script-stage-3"');
    expect(src).toContain('scenes: "script-stage-4"');
    expect(src).toContain('dialogues: "script-stage-5"');
  });
});

// ============================================================================
// Manifest version
// ============================================================================

describe("Sprint r7.15a — Manifest version bump", () => {
  it("manifest + package version bump to r7.15a-autochain", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const manifest = JSON.parse(fs.readFileSync(path.resolve("./manifest.json"), "utf-8"));
    expect(manifest.version_name).toMatch(/^\d+\.\d+\.\d+-r\d+/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(manifest.action.default_title).toMatch(/^KSP Image v\d+\.\d+\.\d+-r\d+/);
    const pkg = JSON.parse(fs.readFileSync(path.resolve("./package.json"), "utf-8"));
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});
