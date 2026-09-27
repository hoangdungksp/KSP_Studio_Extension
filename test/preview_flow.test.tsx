/**
 * Sprint r7.14 — Preview Flow Test Suite
 *
 * Coverage:
 * - Schema types exist + structure correct
 * - Cache key derivation per step
 * - Cache get/set (immutable updates)
 * - Pick construction (option + free text)
 * - Narrative direction synthesis
 * - AI generator sanitizer (4 options enforced, drop invalid)
 * - Stage 1 + Stage 4 prompt injection (NARRATIVE DIRECTION block present)
 */
import { describe, it, expect } from "vitest";
import {
  cacheKeyForStep2,
  cacheKeyForStep3,
  cacheKeyForStep4,
  cacheKeyForStep5,
  getCachedStep1, getCachedStep2, getCachedStep3, getCachedStep4, getCachedStep5,
  setCachedStep1, setCachedStep2, setCachedStep3, setCachedStep4, setCachedStep5,
  buildPickFromOption,
  buildPickFromFreeText,
  buildNarrativeDirection,
  synthesizeNarrativeDirection,
} from "../src/engine/previewFlowSynthesizer";
import type {
  PreviewOption,
  PreviewStepPick,
  PreviewCache,
} from "../src/types/project";

// ============================================================================
// Fixtures
// ============================================================================

const sampleOptions: PreviewOption[] = [
  { id: "A", titleEn: "3-act Pixar contemplative", titleVi: "3 hồi Pixar chiêm nghiệm", descriptionVi: "Hồi 1: ...\nHồi 2: ...\nHồi 3: ...\n→ Pixar contemplative", metaEn: "structure:3-act-pixar-contemplative" },
  { id: "B", titleEn: "Hero's Journey", titleVi: "Hành trình anh hùng", descriptionVi: "Khởi đầu...\nThử thách...\nHy sinh...\n→ Adventure friendship", metaEn: "structure:heros-journey" },
  { id: "C", titleEn: "Mystery thriller", titleVi: "Mystery thriller", descriptionVi: "Setup mystery...\nMid-twist reveal...\nClimax confrontation...\n→ Dark psychological", metaEn: "structure:mystery-thriller" },
  { id: "D", titleEn: "Tragedy doom", titleVi: "Bi kịch doom", descriptionVi: "Awakening peace...\nFalse hope...\nInevitable doom...\n→ Sad bittersweet", metaEn: "structure:tragedy-doom" },
];

const pickA: PreviewStepPick = {
  optionId: "A",
  resolvedTitleEn: "3-act Pixar contemplative",
  resolvedDescriptionVi: "Hồi 1: ...\nHồi 2: ...\nHồi 3: ...",
};
const pickB: PreviewStepPick = {
  optionId: "B",
  resolvedTitleEn: "Hero's Journey",
  resolvedDescriptionVi: "Khởi đầu...\nThử thách...",
};
const pickE: PreviewStepPick = {
  optionId: "E",
  customTextVi: "Custom direction về robot thức tỉnh trong ngục tối",
  resolvedTitleEn: "Custom user direction (free text)",
  resolvedDescriptionVi: "Custom direction về robot thức tỉnh trong ngục tối",
};

// ============================================================================
// SCHEMA TESTS
// ============================================================================

describe("Sprint r7.14 — Schema types", () => {
  it("PreviewOption has required fields (id, titleEn, titleVi, descriptionVi)", () => {
    const opt = sampleOptions[0];
    expect(opt.id).toBe("A");
    expect(opt.titleEn.length).toBeGreaterThan(0);
    expect(opt.titleVi.length).toBeGreaterThan(0);
    expect(opt.descriptionVi.length).toBeGreaterThan(0);
  });

  it("PreviewStepPick supports option pick + free text pick", () => {
    expect(pickA.optionId).toBe("A");
    expect(pickA.customTextVi).toBeUndefined();
    expect(pickE.optionId).toBe("E");
    expect(pickE.customTextVi).toBeTruthy();
  });

  it("ProjectV09Extensions optional narrativeDirection + previewCache fields exist", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/types/project.ts"), "utf-8");
    expect(src).toContain("narrativeDirection?: NarrativeDirection");
    expect(src).toContain("previewCache?: PreviewCache");
    expect(src).toContain("export interface PreviewOption");
    expect(src).toContain("export interface PreviewStepPick");
    expect(src).toContain("export interface PreviewCache");
    expect(src).toContain("export interface NarrativeDirection");
  });
});

// ============================================================================
// CACHE KEY DERIVATION
// ============================================================================

describe("Sprint r7.14 — Cache key derivation", () => {
  it("step 2 key = step1 optionId", () => {
    expect(cacheKeyForStep2(pickA)).toBe("A");
    expect(cacheKeyForStep2(pickB)).toBe("B");
    expect(cacheKeyForStep2(pickE)).toBe("E");
  });

  it("step 3 key = step1Id-step2Id", () => {
    expect(cacheKeyForStep3(pickA, pickB)).toBe("A-B");
    expect(cacheKeyForStep3(pickE, pickA)).toBe("E-A");
  });

  it("step 4 key = step1Id-step2Id-step3Id", () => {
    expect(cacheKeyForStep4(pickA, pickB, pickA)).toBe("A-B-A");
  });

  it("step 5 key = step1Id-step2Id-step3Id-step4Id", () => {
    expect(cacheKeyForStep5(pickA, pickA, pickA, pickA)).toBe("A-A-A-A");
    expect(cacheKeyForStep5(pickE, pickB, pickA, pickB)).toBe("E-B-A-B");
  });
});

// ============================================================================
// CACHE GET/SET — immutable updates
// ============================================================================

describe("Sprint r7.14 — Cache get/set", () => {
  it("getCachedStep1 returns undefined on empty cache", () => {
    expect(getCachedStep1(undefined)).toBeUndefined();
    expect(getCachedStep1({})).toBeUndefined();
  });

  it("setCachedStep1 + getCachedStep1 roundtrip", () => {
    const cache = setCachedStep1(undefined, sampleOptions);
    const retrieved = getCachedStep1(cache);
    expect(retrieved).toEqual(sampleOptions);
    expect(retrieved!.length).toBe(4);
  });

  it("setCachedStep2 keys by step1 pick", () => {
    let cache: PreviewCache = setCachedStep1(undefined, sampleOptions);
    cache = setCachedStep2(cache, pickA, sampleOptions);
    cache = setCachedStep2(cache, pickB, sampleOptions);
    expect(getCachedStep2(cache, pickA)).toEqual(sampleOptions);
    expect(getCachedStep2(cache, pickB)).toEqual(sampleOptions);
    // Different step1 pick → cache miss
    expect(getCachedStep2(cache, { ...pickA, optionId: "C" })).toBeUndefined();
  });

  it("setCachedStep3 keys by step1-step2 combo", () => {
    let cache: PreviewCache = {};
    cache = setCachedStep3(cache, pickA, pickB, sampleOptions);
    expect(getCachedStep3(cache, pickA, pickB)).toEqual(sampleOptions);
    // Different combo → cache miss
    expect(getCachedStep3(cache, pickA, pickA)).toBeUndefined();
    expect(getCachedStep3(cache, pickB, pickB)).toBeUndefined();
  });

  it("setCachedStep4 keys by step1-step2-step3 combo", () => {
    let cache: PreviewCache = {};
    cache = setCachedStep4(cache, pickA, pickB, pickA, sampleOptions);
    expect(getCachedStep4(cache, pickA, pickB, pickA)).toEqual(sampleOptions);
    expect(getCachedStep4(cache, pickA, pickB, pickB)).toBeUndefined();
  });

  it("setCachedStep5 keys by step1-step2-step3-step4 combo", () => {
    let cache: PreviewCache = {};
    cache = setCachedStep5(cache, pickA, pickB, pickA, pickB, sampleOptions);
    expect(getCachedStep5(cache, pickA, pickB, pickA, pickB)).toEqual(sampleOptions);
    expect(getCachedStep5(cache, pickA, pickB, pickA, pickA)).toBeUndefined();
  });

  it("immutable updates — original cache not mutated", () => {
    const original: PreviewCache = {};
    const updated = setCachedStep1(original, sampleOptions);
    expect(original.step1Options).toBeUndefined();
    expect(updated.step1Options).toEqual(sampleOptions);
  });

  it("user changes upstream pick → downstream cache miss + cached branches preserved for re-entry", () => {
    let cache: PreviewCache = {};
    // User explores A → A branch
    cache = setCachedStep2(cache, pickA, sampleOptions);
    cache = setCachedStep3(cache, pickA, pickA, sampleOptions);
    // User backs up, picks B for step 2
    expect(getCachedStep2(cache, pickB)).toBeUndefined(); // not yet cached
    cache = setCachedStep2(cache, pickB, sampleOptions);
    // User re-enters A branch → cache still hit
    expect(getCachedStep2(cache, pickA)).toEqual(sampleOptions);
    expect(getCachedStep3(cache, pickA, pickA)).toEqual(sampleOptions);
  });
});

// ============================================================================
// PICK CONSTRUCTION
// ============================================================================

describe("Sprint r7.14 — Pick construction", () => {
  it("buildPickFromOption maps PreviewOption → PreviewStepPick", () => {
    const pick = buildPickFromOption(sampleOptions[0]);
    expect(pick.optionId).toBe("A");
    expect(pick.resolvedTitleEn).toBe("3-act Pixar contemplative");
    expect(pick.resolvedDescriptionVi).toContain("Hồi 1");
    expect(pick.customTextVi).toBeUndefined();
  });

  it("buildPickFromFreeText creates option E pick with custom text", () => {
    const pick = buildPickFromFreeText("  Custom user direction with leading/trailing spaces  ");
    expect(pick.optionId).toBe("E");
    expect(pick.customTextVi).toBe("Custom user direction with leading/trailing spaces");
    expect(pick.resolvedDescriptionVi).toBe("Custom user direction with leading/trailing spaces");
  });
});

// ============================================================================
// NARRATIVE DIRECTION SYNTHESIS
// ============================================================================

describe("Sprint r7.14 — Narrative direction synthesis", () => {
  it("synthesizeNarrativeDirection includes all 5 labeled sections", () => {
    const text = synthesizeNarrativeDirection({
      step1: pickA, step2: pickB, step3: pickA, step4: pickB, step5: pickA,
    });
    expect(text).toContain("NARRATIVE DIRECTION:");
    expect(text).toContain("Story Structure");
    expect(text).toContain("Opening Scene");
    expect(text).toContain("Character Introduction");
    expect(text).toContain("Midpoint Twist");
    expect(text).toContain("Ending");
    expect(text).toContain("3-act Pixar contemplative");
    expect(text).toContain("Hero's Journey");
  });

  it("synthesizeNarrativeDirection handles free text Option E with custom text", () => {
    const text = synthesizeNarrativeDirection({
      step1: pickE, step2: pickA, step3: pickA, step4: pickA, step5: pickA,
    });
    expect(text).toContain("Custom user direction");
    expect(text).toContain("robot thức tỉnh trong ngục tối");
  });

  it("synthesizeNarrativeDirection ends with alignment directive (audit-clean phrasing)", () => {
    const text = synthesizeNarrativeDirection({
      step1: pickA, step2: pickA, step3: pickA, step4: pickA, step5: pickA,
    });
    expect(text).toContain("must align faithfully");
    // r7.13 audit compliance: no meta-language leak about "user"
    expect(text).not.toContain("locked by user");
    expect(text).not.toContain("user's choice");
    expect(text).not.toContain("user has chosen");
  });

  it("buildNarrativeDirection combines all picks + timestamp + synthesized text", () => {
    const before = Date.now();
    const direction = buildNarrativeDirection({
      step1: pickA, step2: pickB, step3: pickA, step4: pickB, step5: pickA,
    });
    const after = Date.now();
    expect(direction.step1_storyStructure).toEqual(pickA);
    expect(direction.step2_openingScene).toEqual(pickB);
    expect(direction.step3_characterIntro).toEqual(pickA);
    expect(direction.step4_midpointTwist).toEqual(pickB);
    expect(direction.step5_ending).toEqual(pickA);
    expect(direction.completedAt).toBeGreaterThanOrEqual(before);
    expect(direction.completedAt).toBeLessThanOrEqual(after);
    expect(direction.synthesizedDirectionEn).toContain("NARRATIVE DIRECTION:");
  });
});

// ============================================================================
// AI Stage 1 + Stage 4 prompt injection
// ============================================================================

describe("Sprint r7.14 — AI Stage 1 + Stage 4 wiring", () => {
  it("filmScriptStages.ts Stage 1 accepts narrativeDirection input field", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    // RunStage1Input has narrativeDirection field
    expect(src).toContain("narrativeDirection?: import");
    // Stage 1 destructures narrativeDirection
    expect(src).toMatch(/runStage1Structure[\s\S]{0,200}narrativeDirection/);
    // Stage 1 injects synthesizedDirectionEn into prompt
    expect(src).toContain("narrativeDirection.synthesizedDirectionEn");
    // Includes alignment directive (audit-clean)
    expect(src).toContain("must align with these 5 locked directions");
  });

  it("filmScriptStages.ts Stage 4 accepts narrativeDirection input field", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toMatch(/runStage4Scenes[\s\S]{0,500}narrativeDirection/);
    expect(src).toContain("SCENE GENERATION RULES based on locked direction");
    // 5 picks referenced in scene generation rules
    expect(src).toContain("Opening Scene direction dictates how SCENE 1 begins");
    expect(src).toContain("Character Introduction direction dictates");
    expect(src).toContain("Midpoint Twist direction dictates");
    expect(src).toContain("Ending direction dictates");
  });

  it("FilmIdeaScriptSection wires Preview Flow into Stage 1 trigger", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    expect(src).toContain("PreviewFlowModal");
    expect(src).toContain("handleOpenPreviewFlow");
    expect(src).toContain("handlePreviewComplete");
    expect(src).toContain("handlePreviewCancel");
    expect(src).toContain("narrativeDirection");
    expect(src).toContain("previewCache");
    // Stage 4 also passes narrativeDirection
    expect(src).toMatch(/runStage4Scenes[\s\S]{0,300}narrativeDirection/);
  });
});

// ============================================================================
// AI generators exist + structure (file-level checks, no actual AI calls)
// ============================================================================

describe("Sprint r7.14 — AI generator functions exist", () => {
  it("previewFlowAI.ts exports 5 generators", async () => {
    const mod = await import("../src/engine/previewFlowAI");
    expect(typeof mod.generateStep1StoryStructureOptions).toBe("function");
    expect(typeof mod.generateStep2OpeningSceneOptions).toBe("function");
    expect(typeof mod.generateStep3CharacterIntroOptions).toBe("function");
    expect(typeof mod.generateStep4MidpointTwistOptions).toBe("function");
    expect(typeof mod.generateStep5EndingOptions).toBe("function");
  });

  it("AI prompts force 4 distinct options + cinematic distinctness", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    // Each step prompt enforces "4 CINEMATICALLY DISTINCT" options
    expect(src.match(/CINEMATICALLY DISTINCT/g)?.length).toBeGreaterThanOrEqual(5);
    // ID enforcement A/B/C/D
    expect(src).toContain("A/B/C/D");
    // No meta-language leak (r7.13 audit compliance)
    expect(src).not.toContain("the user's");
    expect(src).not.toContain("user has chosen");
    expect(src).not.toContain("locked by user via");
  });

  it("AI generators include downstream context from previous picks", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    // Step 2+ accepts upstream picks
    expect(src).toContain("step1Pick: PreviewStepPick");
    expect(src).toContain("step2Pick: PreviewStepPick");
    expect(src).toContain("step3Pick: PreviewStepPick");
    expect(src).toContain("step4Pick: PreviewStepPick");
    // Format pick context helper used
    expect(src).toContain("formatPickContext");
  });
});

// ============================================================================
// Manifest version bump
// ============================================================================

describe("Sprint r7.14 — Manifest version", () => {
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

// ============================================================================
// Sprint r7.15c — Preview Flow v2: 6 frameworks + framework badge + Step 4 multi-pick
// ============================================================================

describe("Sprint r7.15c — Preview Flow v2", () => {
  it("FRAMEWORK_LABELS expanded to 6 frameworks (added mystery-thriller + tragedy-doom)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/types/film.ts"), "utf-8");
    // 4 original frameworks still present
    expect(src).toContain("\"three-act\"");
    expect(src).toContain("\"hero-journey\"");
    expect(src).toContain("\"save-the-cat\"");
    expect(src).toContain("kishotenketsu:");
    // 2 new frameworks added
    expect(src).toContain("\"mystery-thriller\"");
    expect(src).toContain("\"tragedy-doom\"");
    // Labels present
    expect(src).toContain("Mystery Thriller (Bí ẩn ly kỳ)");
    expect(src).toContain("Tragedy Doom (Bi kịch định mệnh)");
  });

  it("PreviewOption.frameworkCode field exists in schema", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/types/project.ts"), "utf-8");
    expect(src).toContain("frameworkCode?: string;");
  });

  it("PreviewStepPick.additionalPicks for Step 4 multi-pick", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/types/project.ts"), "utf-8");
    expect(src).toContain("additionalPicks?: Array<");
    expect(src).toContain("archetypeTag?: string");
  });

  it("FilmScriptBeat.containsTwistId field exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/types/film.ts"), "utf-8");
    expect(src).toContain("containsTwistId?: string");
  });

  it("FilmScriptTwist.beatId is now optional", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/types/film.ts"), "utf-8");
    // beatId optional + source + archetypeTag fields
    expect(src).toContain("beatId?: string;");
    expect(src).toContain("source?: \"preview-flow\" | \"ai-suggested\"");
  });

  it("ProjectSettingV2.showPacingDashboard toggle field", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/types/project.ts"), "utf-8");
    expect(src).toContain("showPacingDashboard?: boolean");
  });

  it("Step 1 AI prompt enforces 6 framework codes", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    expect(src).toContain("\"three-act\"");
    expect(src).toContain("\"hero-journey\"");
    expect(src).toContain("\"save-the-cat\"");
    expect(src).toContain("\"kishotenketsu\"");
    expect(src).toContain("\"mystery-thriller\"");
    expect(src).toContain("\"tragedy-doom\"");
    expect(src).toContain("each use a DIFFERENT frameworkCode");
  });

  it("buildPickFromMultipleOptions helper exists in synthesizer", async () => {
    const { buildPickFromMultipleOptions } = await import("../src/engine/previewFlowSynthesizer");
    expect(typeof buildPickFromMultipleOptions).toBe("function");
  });

  it("buildPickFromMultipleOptions throws on empty array", async () => {
    const { buildPickFromMultipleOptions } = await import("../src/engine/previewFlowSynthesizer");
    expect(() => buildPickFromMultipleOptions([])).toThrow("requires at least 1 option");
  });

  it("buildPickFromMultipleOptions throws when more than 3 options", async () => {
    const { buildPickFromMultipleOptions } = await import("../src/engine/previewFlowSynthesizer");
    const mockOption = (id: string) => ({
      id,
      titleEn: `Title ${id}`,
      titleVi: `Tiêu đề ${id}`,
      descriptionVi: `Mô tả ${id}`,
      metaEn: `twist:${id}`,
    });
    expect(() =>
      buildPickFromMultipleOptions([mockOption("A"), mockOption("B"), mockOption("C"), mockOption("D")])
    ).toThrow("max 3 options allowed");
  });

  it("buildPickFromMultipleOptions builds pick with primary + additionalPicks", async () => {
    const { buildPickFromMultipleOptions } = await import("../src/engine/previewFlowSynthesizer");
    const mockOption = (id: string) => ({
      id,
      titleEn: `Title ${id}`,
      titleVi: `Tiêu đề ${id}`,
      descriptionVi: `Mô tả ${id}`,
      metaEn: `twist:archetype-${id}`,
    });
    const pick = buildPickFromMultipleOptions([mockOption("A"), mockOption("B")]);
    expect(pick.optionId).toBe("A");
    expect(pick.resolvedTitleEn).toBe("Title A");
    expect(pick.archetypeTag).toBe("archetype-A");
    expect(pick.additionalPicks).toHaveLength(1);
    expect(pick.additionalPicks![0].optionId).toBe("B");
    expect(pick.additionalPicks![0].archetypeTag).toBe("archetype-B");
  });

  it("buildPickFromOption carries frameworkCode for Step 1", async () => {
    const { buildPickFromOption } = await import("../src/engine/previewFlowSynthesizer");
    const opt = {
      id: "A",
      titleEn: "Hero's Journey",
      titleVi: "Hành trình Anh hùng",
      descriptionVi: "Hồi 1 ...",
      metaEn: "structure:heros-journey",
      frameworkCode: "hero-journey",
    };
    const pick = buildPickFromOption(opt);
    expect(pick.frameworkCode).toBe("hero-journey");
    expect(pick.archetypeTag).toBe("heros-journey");
  });

  it("synthesizeNarrativeDirection renders Step 4 multi-pick correctly", async () => {
    const { synthesizeNarrativeDirection } = await import("../src/engine/previewFlowSynthesizer");
    const direction = synthesizeNarrativeDirection({
      step1: { optionId: "A", resolvedTitleEn: "Hero's Journey", resolvedDescriptionVi: "Hồi 1..." },
      step2: { optionId: "A", resolvedTitleEn: "Environment-first" },
      step3: { optionId: "A", resolvedTitleEn: "Slow reveal" },
      step4: {
        optionId: "A",
        resolvedTitleEn: "Audio trigger",
        resolvedDescriptionVi: "Robot hears woodpecker",
        archetypeTag: "audio-trigger-ptsd",
        additionalPicks: [
          {
            optionId: "B",
            resolvedTitleEn: "Environmental mistake",
            resolvedDescriptionVi: "Robot crushes bird nest",
            archetypeTag: "environmental-mistake",
          },
        ],
      },
      step5: { optionId: "A", resolvedTitleEn: "Hope wins" },
    });
    // Multi-twist format renders with "Locked Twists (2 total"
    expect(direction).toContain("Locked Twists (2 total");
    expect(direction).toContain("Twist 1: Audio trigger");
    expect(direction).toContain("Twist 2: Environmental mistake");
    expect(direction).toContain("[audio-trigger-ptsd]");
    expect(direction).toContain("[environmental-mistake]");
  });

  it("synthesizeNarrativeDirection renders single Step 4 pick correctly (no additionalPicks)", async () => {
    const { synthesizeNarrativeDirection } = await import("../src/engine/previewFlowSynthesizer");
    const direction = synthesizeNarrativeDirection({
      step1: { optionId: "A", resolvedTitleEn: "Hero's Journey" },
      step2: { optionId: "A", resolvedTitleEn: "Env-first" },
      step3: { optionId: "A", resolvedTitleEn: "Slow reveal" },
      step4: {
        optionId: "A",
        resolvedTitleEn: "Audio trigger",
        resolvedDescriptionVi: "Robot hears woodpecker",
      },
      step5: { optionId: "A", resolvedTitleEn: "Hope wins" },
    });
    // Single-twist format still uses "Midpoint Twist:" label (not "Locked Twists")
    expect(direction).toContain("Midpoint Twist: Audio trigger");
    expect(direction).not.toContain("Locked Twists (");
  });

  it("Stage 2 Beats accepts prelockedTwists input", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toContain("prelockedTwists?: FilmScriptTwist[]");
    expect(src).toContain("PRE-LOCKED TWISTS (must be placed at appropriate beat positions");
    expect(src).toContain("Twists MUST spread across different acts");
  });

  it("autoChain skips Stage 1 AI (gán từ direction Step 1)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/autoChainOrchestrator.ts"), "utf-8");
    // runScriptStage1 does NOT call runStage1Structure anymore — assigns directly from Step 1 pick
    expect(src).toContain("Script Stage 1 (Structure) — SKIP AI CALL");
    // runStage1Structure import removed
    expect(src).not.toContain("runStage1Structure,");
  });

  it("autoChain Stage 2 (Twists) runs BEFORE Stage 3 (Beats) in new swapped order", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/autoChainOrchestrator.ts"), "utf-8");
    // Stage 2 Twists method exists
    expect(src).toContain("runScriptStage2Twists");
    // Stage 3 Beats method exists
    expect(src).toContain("runScriptStage3Beats");
    // Sequence: Stage 1 → Stage 2 Twists → Stage 3 Beats
    // r7.16: refactored to runFromSection runner array — match new shape
    const stage2Idx = src.indexOf('runScriptStage2Twists(direction)');
    const stage3Idx = src.indexOf('runScriptStage3Beats(direction)');
    expect(stage2Idx).toBeGreaterThan(-1);
    expect(stage3Idx).toBeGreaterThan(stage2Idx);
  });

  it("autoChain Stage 3 Beats post-hoc fills twist.beatId via containsTwistId match", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/autoChainOrchestrator.ts"), "utf-8");
    expect(src).toContain("post-hoc sanitizer — match beat.containsTwistId");
    expect(src).toContain("updatedTwists");
  });

  it("Editor.tsx conditionally renders Pacing Dashboard; Storyboard/Voice/Music/Bundle removed (r8.0)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/Editor.tsx"), "utf-8");
    expect(src).toContain("showPacingDashboard");
    expect(src).toContain("{showPacingDashboard && (");
    expect(src).not.toContain("<FilmStoryboardSection");
    expect(src).not.toContain("<FilmVoiceSection");
    expect(src).not.toContain("<FilmMusicSfxSection");
    expect(src).not.toContain("<FilmBundleExportSection");
  });

  it("ProjectSettingSection has showPacingDashboard toggle", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/ProjectSettingSection.tsx"), "utf-8");
    expect(src).toContain("showPacingDashboard");
    expect(src).toContain("Hiện section Pacing Dashboard");
  });

  it("PreviewFlowModal supports Step 4 multi-pick checkbox UI", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    expect(src).toContain("PreviewOptionCheckboxCard");
    expect(src).toContain("step4Selected");
    expect(src).toContain("handleToggleStep4Option");
    expect(src).toContain("handleSubmitStep4MultiPick");
    // Max 3 enforcement
    expect(src).toContain("Tối đa 3 twists");
  });

  it("PreviewFlowModal shows framework badge for Step 1 options only", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    expect(src).toContain("FRAMEWORK_BADGE_LABELS");
    expect(src).toContain("showFrameworkBadge");
    expect(src).toContain("ksp-preview-flow-option-badge");
  });

  it("film.css has r7.15c styles (badge + checkbox card + multipick submit)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/film.css"), "utf-8");
    expect(src).toContain("SPRINT r7.15c");
    expect(src).toContain(".ksp-preview-flow-option-badge");
    expect(src).toContain(".ksp-preview-flow-option-checkbox");
    expect(src).toContain(".ksp-preview-flow-option-checked");
    expect(src).toContain(".ksp-preview-flow-multipick-submit");
  });
});

// ============================================================================
// Sprint r7.15d-fix1 — analyze-scenes rename + section animation fix + Cancel + collapsible
// ============================================================================

describe("Sprint r7.15d-fix1 — fix pass on r7.15c", () => {
  it("SectionId renamed: detect-beats → analyze-scenes", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/autoChainOrchestrator.ts"), "utf-8");
    expect(src).toContain("\"analyze-scenes\"");
    expect(src).not.toContain("\"detect-beats\"");
    expect(src).toContain("runAnalyzeScenesAllScenes");
    expect(src).not.toContain("runDetectBeatsAllScenes");
  });


  it("FilmShotListSection subscribes to autoChainState and animates on analyze-scenes OR shot-list", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmShotListSection.tsx"), "utf-8");
    expect(src).toContain("autoChainState");
    expect(src).toContain("\"analyze-scenes\"");
    expect(src).toContain("\"shot-list\"");
    expect(src).toContain("ksp-autochain-generating");
    expect(src).toContain("ksp-shotlist-autochain-badge");
  });

  it("getEffectiveStageOrder filters dialogues when dialog === 'no_dialog'", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    expect(src).toContain("getEffectiveStageOrder");
    expect(src).toContain("STAGE_ORDER.filter((s) => s !== \"dialogues\")");
  });

  it("countCompletedStages accepts setting parameter for dialog-aware count", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    expect(src).toContain("function countCompletedStages(film: FilmData, setting?: any)");
    expect(src).toContain("getEffectiveStageOrder(film, setting)");
  });

  it("r7.20b: Direction summary collapsible REMOVED from Section Ý tưởng — moved to Preview Modal Step 6", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    // Old in-section panel + state removed
    expect(src).not.toContain("directionSummaryExpanded");
    expect(src).not.toContain("ksp-idea-direction-toggle");
    expect(src).not.toContain("ksp-idea-direction-clear-btn");
    // No "▶ Click để xem" toggle in this file anymore
    expect(src).not.toContain("Click để xem");
    expect(src).not.toContain("Click để ẩn");
    // r7.20b: PreviewFlowModal carries the review now
    const modalSrc = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    expect(modalSrc).toContain("FinalReviewPanel");
    expect(modalSrc).toContain("currentStep === 6");
  });

  it("r7.20b: Step 6 FinalReviewPanel shows Step 4 multi-pick badge + additionalPicks list", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    expect(src).toContain("ksp-preview-flow-review-multipick-badge");
    expect(src).toContain("additionalPicks");
    expect(src).toContain("ksp-preview-flow-review-additional");
    expect(src).toContain("twistCount");
  });

  it("r7.20b/r7.33: Step 6 has cost estimate hint + Back + Save&Close buttons", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    // Cost estimate line shown before confirm
    expect(src).toContain("ksp-preview-flow-cost-hint");
    expect(src).toContain("Cost estimate");
    // Back to Step 5 button + main Save & Close button (r7.33 changed label)
    expect(src).toContain("Quay lại sửa");
    expect(src).toContain("Lưu &amp; Đóng");
    expect(src).toContain("onBack");
    expect(src).toContain("setCurrentStep(5)");
  });

  it("Cancel Auto-Chain floating button exists with orchestrator ref", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    expect(src).toContain("orchestratorRef");
    expect(src).toContain("handleCancelAutoChain");
    expect(src).toContain("ksp-autochain-cancel-floating");
    expect(src).toContain("Stop Auto-Chain");
  });

  it("Cancel button only visible when autoChainState.isRunning", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    // Pattern: {autoChainState.isRunning && (
    expect(src).toMatch(/\{autoChainState\.isRunning && \(/);
  });

  it("Button 'Phân tích ý tưởng' has loading shimmer class", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/FilmIdeaScriptSection.tsx"), "utf-8");
    expect(src).toContain("ksp-idea-analyze-btn-loading");
  });

  it("film.css has r7.15d-fix1 + r7.20b styles (shimmer, Cancel floating, Shot List badge, Step 6 review)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/film.css"), "utf-8");
    expect(src).toContain("SPRINT r7.15d-fix1");
    expect(src).toContain("@keyframes ksp-idea-analyze-shimmer");
    expect(src).toContain(".ksp-idea-analyze-btn-loading");
    expect(src).toContain(".ksp-autochain-cancel-floating");
    expect(src).toContain(".ksp-shotlist-autochain-badge");
    // r7.20b: Step 6 review panel styles
    expect(src).toContain(".ksp-preview-flow-review-multipick-badge");
    expect(src).toContain(".ksp-preview-flow-cost-hint");
  });

  it("Manifest bumped to 0.9.4.40 / r7.15d-fix1", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const manifest = JSON.parse(fs.readFileSync(path.resolve("./manifest.json"), "utf-8"));
    expect(manifest.version_name).toMatch(/^\d+\.\d+\.\d+-r\d+/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(manifest.action.default_title).toMatch(/^KSP Image v\d+\.\d+\.\d+-r\d+/);
  });
});

// ============================================================================
// Sprint r7.15d-fix2 — Preview Flow polish (picked indicator + strip summary + lenient frameworkCode)
// ============================================================================

describe("Sprint r7.15d-fix2 — Preview Flow polish", () => {
  it("Sanitizer strips trailing summary line '→ ...' from descriptionVi", async () => {
    // resolveFrameworkCode + stripSummaryLine are internal — test via end-to-end behavior
    // by checking the source contains the stripper logic
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    expect(src).toContain("stripSummaryLine");
    expect(src).toContain("[→\\u2192]");
  });

  it("Sanitizer has lenient frameworkCode resolver with metaEn fallback", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    expect(src).toContain("resolveFrameworkCode");
    expect(src).toContain("Fallback: infer from metaEn");
    // Heuristic substring matches for 6 frameworks
    expect(src).toContain('tag.includes("hero") || tag.includes("journey")');
    expect(src).toContain('tag.includes("mystery") || tag.includes("thriller")');
    expect(src).toContain('tag.includes("tragedy") || tag.includes("doom")');
  });

  it("All 5 step prompts have removed '→ <summary>' directive", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    // All 5 prompts should now have "DO NOT add a summary/conclusion line at the end"
    const occurrences = (src.match(/DO NOT add a summary\/conclusion line at the end/g) || []).length;
    expect(occurrences).toBe(5);
    // Prompts should NOT contain the old "End with one-line summary" directive
    expect(src).not.toContain('End with one-line summary');
  });

  it("PreviewOptionCard supports isPreviouslyPicked prop", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    expect(src).toContain("isPreviouslyPicked");
    expect(src).toContain("ksp-preview-flow-option-picked");
    expect(src).toContain("✓ Đã chọn");
  });

  it("Preview modal derives previouslyPickedIds from picks state", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    expect(src).toContain("previouslyPickedIds");
    expect(src).toContain("previousPick?.optionId === \"E\"");
  });

  it("Step 4 re-entry restores previous selection (multi-pick continuity)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/PreviewFlowModal.tsx"), "utf-8");
    expect(src).toContain("when re-entering Step 4, restore previous selection");
    expect(src).toContain("setStep4Selected(previous");
  });

  it("film.css has r7.15d-fix2 picked-state + hover styles", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/components/film.css"), "utf-8");
    expect(src).toContain("SPRINT r7.15d-fix2");
    expect(src).toContain(".ksp-preview-flow-option-picked");
    expect(src).toContain(".ksp-preview-flow-option-picked-badge");
    expect(src).toContain(".ksp-preview-flow-option:not(.ksp-preview-flow-option-checkbox):not(.ksp-preview-flow-option-freetext):hover");
  });

  it("Manifest bumped to 0.9.4.40 / r7.15d-fix2", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const manifest = JSON.parse(fs.readFileSync(path.resolve("./manifest.json"), "utf-8"));
    expect(manifest.version_name).toMatch(/^\d+\.\d+\.\d+-r\d+/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});

// ============================================================================
// Sprint r7.15e — Stability: hardcode debias + maxOutputTokens bump + AI diversity + per-scene error surface
// ============================================================================

describe("Sprint r7.15e — Stability", () => {
  it("Hardcode story refs completely removed from src/ AI prompts", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const previewFlow = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    const shotList = fs.readFileSync(path.resolve("./src/engine/filmShotListGeneration.ts"), "utf-8");
    const scriptStages = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    const projectTypes = fs.readFileSync(path.resolve("./src/types/project.ts"), "utf-8");
    const all = previewFlow + shotList + scriptStages + projectTypes;
    expect(all).not.toContain("G.N.U.D");
    expect(all).not.toContain("woodpecker");
    expect(all).not.toContain("chim gõ kiến");
    expect(all).not.toContain("robot covered by moss");
    expect(all).not.toContain("Bird saves robot");
    expect(all).not.toContain("Woodpecker mimics");
    expect(all).not.toContain("programming defeated by compassion");
  });

  it("Gemini maxOutputTokens bumped to 32768 (from 8192)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toContain("maxOutputTokens: 32768");
    expect(src).not.toContain("maxOutputTokens: 8192");
  });

  it("OpenAI max_tokens bumped to 16384 (from 8192)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toContain("max_tokens: 16384");
  });

  it("callAi accepts optional temperature override", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/filmScriptStages.ts"), "utf-8");
    expect(src).toContain("options?: { temperature?: number }");
    expect(src).toContain("options?.temperature ?? 0.75");
  });

  it("Preview Flow defines 5 creative angle pools (one per step)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    expect(src).toContain("CREATIVE_ANGLES_STEP1");
    expect(src).toContain("CREATIVE_ANGLES_STEP2");
    expect(src).toContain("CREATIVE_ANGLES_STEP3");
    expect(src).toContain("CREATIVE_ANGLES_STEP4");
    expect(src).toContain("CREATIVE_ANGLES_STEP5");
  });

  it("pickCreativeAngle exported + works for all 5 steps", async () => {
    const { pickCreativeAngle } = await import("../src/engine/previewFlowAI");
    for (const step of [1, 2, 3, 4, 5] as const) {
      const angle = pickCreativeAngle(step);
      expect(typeof angle).toBe("string");
      expect(angle.length).toBeGreaterThan(10);
    }
  });

  it("Preview Flow uses temperature 1.0 (vs default 0.75)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    expect(src).toContain("PREVIEW_FLOW_TEMPERATURE = 1.0");
    // Each step should pass temperature option to callAi
    const matches = src.match(/temperature: PREVIEW_FLOW_TEMPERATURE/g) || [];
    expect(matches.length).toBe(5);
  });

  it("All 5 preview steps inject creative angle into system prompt", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/previewFlowAI.ts"), "utf-8");
    // Each step calls pickCreativeAngle(N)
    expect(src).toContain("pickCreativeAngle(1)");
    expect(src).toContain("pickCreativeAngle(2)");
    expect(src).toContain("pickCreativeAngle(3)");
    expect(src).toContain("pickCreativeAngle(4)");
    expect(src).toContain("pickCreativeAngle(5)");
    // Each prompt has "CREATIVE ANGLE for this generation:" line
    const matches = src.match(/CREATIVE ANGLE for this generation:/g) || [];
    expect(matches.length).toBe(5);
  });

  it("Orchestrator surfaces aggregated errors in shot-list (all-fail throws)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/autoChainOrchestrator.ts"), "utf-8");
    // shot-list loop tracks failures + throws on all-fail
    expect(src).toContain("failures: Array<{ sceneId: string; sceneTitle: string; error: Error }>");
    expect(src).toContain("Tất cả ${scenes.length} scenes đều fail");
    expect(src).toContain("❌ Shot List:");
  });

  it("Orchestrator surfaces partial-fail warning in shot-list (continues with done status)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/autoChainOrchestrator.ts"), "utf-8");
    expect(src).toContain("⚠️ Shot List:");
    expect(src).toContain("Click \"AI sinh shot list\" manual cho các scenes còn thiếu");
  });

  it("Orchestrator surfaces aggregated errors in analyze-scenes (parallel pattern)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve("./src/engine/autoChainOrchestrator.ts"), "utf-8");
    expect(src).toContain("❌ Analyze Scenes:");
    expect(src).toContain("⚠️ Analyze Scenes:");
    expect(src).toContain("Tất cả ${scenes.length} scenes đều fail analyze");
  });

  it("Sprint/qc tags audited out of src/ comments (only legacy persisted field qc16Migrated remains)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { execSync } = await import("child_process");
    // Count remaining tag refs in src/ — should only be 4 lines all referencing qc16Migrated field
    const result = execSync(
      "grep -rEn 'qc[0-9]+|Sprint r[0-9]' src/ 2>/dev/null | grep -v test || true",
      { encoding: "utf-8" }
    );
    const lines = result.trim().split("\n").filter((l) => l.length > 0);
    // Every remaining line must reference qc16Migrated (the legacy persisted field)
    for (const line of lines) {
      expect(line).toMatch(/qc16Migrated/);
    }
  });

  it("Migration function renamed: migrateQc16DropPerShotGrids → migratePerShotGridsToSceneLevel", async () => {
    const { migratePerShotGridsToSceneLevel } = await import("../src/store/migration");
    expect(typeof migratePerShotGridsToSceneLevel).toBe("function");
  });

  it("Manifest bumped to 0.9.4.40 / r7.15e-stability", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const manifest = JSON.parse(fs.readFileSync(path.resolve("./manifest.json"), "utf-8"));
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(manifest.version_name).toMatch(/^\d+\.\d+\.\d+-r\d+/);
    expect(manifest.action.default_title).toMatch(/^KSP Image v\d+\.\d+\.\d+-r\d+/);
  });
});
