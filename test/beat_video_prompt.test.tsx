import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  resolveShotsForBeats,
  scaleLengths,
  planForModel,
  toTimeline,
  selectDialogue,
  buildBeatPromptPlan,
  fingerprintGroup,
  isGroupStale,
  findPresentCharacters,
  buildReferenceImages,
  generateBeatVideoPrompts,
  BEAT_VIDEO_SYSTEM_PROMPT,
  VIDEO_MODEL_SPECS,
} from "../src/engine/beatVideoPrompt";
import { upsertBeatPromptGroup, editBeatPromptText, removeBeatPromptGroup } from "../src/store/film_actions";
import { BeatPromptPanel } from "../src/components/BeatPromptPanel";
import { useAppStore } from "../src/store/useAppStore";

vi.mock("../src/engine/filmScriptStages", async (orig) => {
  const actual: any = await orig();
  return { ...actual, callAi: vi.fn() };
});
import { callAi } from "../src/engine/filmScriptStages";

// ---------------------------------------------------------------------------
// fixtures (generic placeholders — no story content)
// ---------------------------------------------------------------------------

function shot(id: string, order: number, dur: number, beats: string[], extra: any = {}): any {
  return {
    id,
    order,
    titleEn: `Shot ${order}`,
    shotType: "medium",
    durationSeconds: dur,
    gridFormat: "3x3",
    cameraMovement: "static",
    status: "draft",
    actionEn: `Action ${order}`,
    coveredBeatIds: beats,
    ...extra,
  };
}

const beats: any[] = [
  { id: "b1", order: 1, label: "Beat one", type: "action", detectedAt: 0 },
  { id: "b2", order: 2, label: "Beat two", type: "action", detectedAt: 0 },
  { id: "b3", order: 3, label: "Beat three", type: "action", detectedAt: 0 },
  { id: "b4", order: 4, label: "Beat four", type: "action", detectedAt: 0 },
];

const shots = [
  shot("s1", 1, 3, ["b1"]),
  shot("s2", 2, 4, ["b2", "b3"]), // shared shot
  shot("s3", 3, 2, ["b3"]),
  shot("s4", 4, 5, ["b3"]),
];

const scene: any = {
  id: "sc1",
  order: 2,
  titleEn: "Scene title",
  settings: "EXT. <place> - DAY",
  durationSeconds: 14,
  act: "setup",
  actionLinesEn: "x",
  dialog: [],
  sfx: ["wind"],
  musicBrief: "",
  beats,
};

const setting: any = {
  mode: "film",
  aspectRatio: "16:9",
  animationStyle: "live_action",
  dialog: "no_dialog",
  aiProviders: { scriptWriter: "gemini-flash" },
};

const cast: any[] = [
  { id: "c1", order: 1, name: "Hero", role: "protagonist", description: "tall", faceRefs: [], bodyRefs: [], conceptSheet: { dataUrl: "data:image/png;base64,AAAA" } },
  { id: "c2", order: 2, name: "Other", role: "companion", description: "small", faceRefs: [], bodyRefs: [] },
];

// ---------------------------------------------------------------------------

describe("r8.0 beat → shot resolution", () => {
  it("dedupes a shot shared by two beats and keeps shot order", () => {
    const r = resolveShotsForBeats(["b2", "b3"], shots);
    expect(r.map((s) => s.id)).toEqual(["s2", "s3", "s4"]);
  });

  it("returns empty for an uncovered beat", () => {
    expect(resolveShotsForBeats(["b4"], shots)).toEqual([]);
  });
});

describe("r8.0 timeline math", () => {
  it("toTimeline builds contiguous ranges", () => {
    expect(toTimeline(["a", "b", "c"], [3, 4, 2])).toEqual([
      { shotId: "a", start: 0, end: 3 },
      { shotId: "b", start: 3, end: 7 },
      { shotId: "c", start: 7, end: 9 },
    ]);
  });

  it("scaleLengths hits the target exactly, each ≥1s", () => {
    for (const [lens, target] of [
      [[3, 4, 2, 5], 10],
      [[6, 6, 6], 10],
      [[1, 1, 9], 4],
      [[2], 5],
    ] as Array<[number[], number]>) {
      const out = scaleLengths(lens, target);
      expect(out.reduce((a, b) => a + b, 0)).toBe(target);
      expect(out.every((x) => x >= 1)).toBe(true);
    }
  });

  it("planForModel compresses Omni above 10s, keeps Seedance, stretches below min", () => {
    const all = resolveShotsForBeats(["b1", "b2", "b3"], shots); // 3+4+2+5 = 14s
    const omni = planForModel("omni", all, false);
    expect(omni.fit).toBe("compressed");
    expect(omni.targetSeconds).toBe(10);
    expect(omni.timeline[omni.timeline.length - 1].end).toBe(10);
    expect(planForModel("seedance", all, false)).toMatchObject({ fit: "ok", targetSeconds: 14 });

    const short = resolveShotsForBeats(["b1"], shots); // 3s
    expect(planForModel("seedance", short, false)).toMatchObject({ fit: "stretched", targetSeconds: 4 });
    expect(planForModel("omni", short, false)).toMatchObject({ fit: "ok", targetSeconds: 3 });
  });

  it("Grok caps at 10s with reference images, 15s without", () => {
    const all = resolveShotsForBeats(["b1", "b2", "b3"], shots); // 14s
    expect(planForModel("grok", all, false).fit).toBe("ok");
    expect(planForModel("grok", all, true)).toMatchObject({ fit: "compressed", targetSeconds: 10 });
  });

  it("flags too_many_shots when shots outnumber seconds", () => {
    const many = Array.from({ length: 12 }, (_, i) => shot(`m${i}`, i + 1, 2, ["b1"]));
    const p = planForModel("omni", many, false);
    expect(p.fit).toBe("too_many_shots");
    expect(p.timeline.every((s) => s.end - s.start === 1)).toBe(true);
  });
});

describe("r8.0 dialogue window", () => {
  const dScene = {
    ...scene,
    dialog: [
      { characterId: "c1", characterName: "Hero", lineEn: "Line A", timingSeconds: { start: 0, end: 2 } },
      { characterId: "c2", characterName: "Other", lineEn: "Line B", timingSeconds: { start: 8, end: 9 } },
    ],
  };

  it("uses timingSeconds to pick lines inside the chosen shots", () => {
    const chosen = resolveShotsForBeats(["b1"], shots); // scene 0-3s
    const r = selectDialogue(dScene, shots, chosen, true);
    expect(r.exact).toBe(true);
    expect(r.lines.map((l: any) => l.lineEn)).toEqual(["Line A"]);
  });

  it("falls back to whole-scene candidates when timing is missing", () => {
    const noTiming = { ...dScene, dialog: dScene.dialog.map(({ timingSeconds, ...l }: any) => l) };
    const r = selectDialogue(noTiming, shots, shots, true);
    expect(r.exact).toBe(false);
    expect(r.lines.length).toBe(2);
  });

  it("returns nothing when dialogue is disabled", () => {
    expect(selectDialogue(dScene, shots, shots, false).lines).toEqual([]);
  });
});

describe("r8.0 cast + references", () => {
  it("finds characters named in shot text, falls back to protagonist", () => {
    const named = [shot("x", 1, 3, ["b1"], { actionEn: "Other walks in" })];
    expect(findPresentCharacters(named, cast, []).map((c) => c.id)).toEqual(["c2"]);
    expect(findPresentCharacters([shot("y", 1, 3, ["b1"])], cast, []).map((c) => c.id)).toEqual(["c1"]);
  });

  it("only characters with an image become numbered references", () => {
    const refs = buildReferenceImages(cast);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ index: 0, characterName: "Hero", filename: "01_Hero.png" });
    expect(VIDEO_MODEL_SPECS.omni.refLabel(0)).toBe("image_0");
    expect(VIDEO_MODEL_SPECS.seedance.refLabel(0)).toBe("Image 1");
  });
});

describe("r8.0 plan + stale fingerprint", () => {
  it("context lists shots, timeline per model and refs", () => {
    const plan = buildBeatPromptPlan({ scene, sceneShots: shots, beats: [beats[1], beats[2]], cast, setting });
    expect(plan.shots.map((s) => s.id)).toEqual(["s2", "s3", "s4"]);
    expect(plan.contextText).toContain("PER-MODEL TIMELINE");
    expect(plan.contextText).toContain("- omni → total 10s (compressed from 11s");
    expect(plan.contextText).toContain("- seedance → total 11s: 0–4s = shot 1, 4–6s = shot 2, 6–11s = shot 3");
    expect(plan.contextText).toContain("DIALOGUE: none — this project has no spoken dialogue.");
  });

  it("group becomes stale when a covered shot changes duration or a beat disappears", () => {
    const fp = fingerprintGroup([beats[0]], resolveShotsForBeats(["b1"], shots));
    const group: any = { id: "g", beatIds: ["b1"], prompts: {}, sourceFingerprint: fp };
    expect(isGroupStale(group, beats, shots)).toBe(false);
    const changed = shots.map((s) => (s.id === "s1" ? { ...s, durationSeconds: 6 } : s));
    expect(isGroupStale(group, beats, changed)).toBe(true);
    expect(isGroupStale(group, beats.slice(1), shots)).toBe(true);
  });

  it("system prompt has no story-specific examples (HANDOFF r7.31 rule)", () => {
    expect(BEAT_VIDEO_SYSTEM_PROMPT).toContain("<character>");
    expect(BEAT_VIDEO_SYSTEM_PROMPT).not.toMatch(/\bvd:|Ví dụ:/i);
  });
});

describe("r8.0 AI call", () => {
  beforeEach(() => vi.mocked(callAi).mockReset());

  it("parses the 3 prompts from JSON", async () => {
    vi.mocked(callAi).mockResolvedValue(JSON.stringify({ omni: "O", seedance: "S", grok: "G" }));
    const r = await generateBeatVideoPrompts({ scene, sceneShots: shots, beats: [beats[0]], cast, setting }, "gemini-flash");
    expect(r.prompts).toEqual({ omni: "O", seedance: "S", grok: "G" });
    const userPrompt = vi.mocked(callAi).mock.calls[0][2];
    expect(userPrompt).toContain("SHOTS (in order");
  });

  it("throws a readable error when a model prompt is missing", async () => {
    vi.mocked(callAi).mockResolvedValue(JSON.stringify({ omni: "O", seedance: "" }));
    await expect(
      generateBeatVideoPrompts({ scene, sceneShots: shots, beats: [beats[0]], cast, setting }, "gemini-flash")
    ).rejects.toThrow(/Seedance/);
  });

  it("refuses beats with no shots", async () => {
    await expect(
      generateBeatVideoPrompts({ scene, sceneShots: shots, beats: [beats[3]], cast, setting }, "gemini-flash")
    ).rejects.toThrow(/chưa có shot/);
    expect(callAi).not.toHaveBeenCalled();
  });
});

describe("r8.0 store actions", () => {
  const project: any = {
    id: "p",
    filmV093: {
      schemaVersion: "v0.9.3-film",
      characters: [],
      script: { scenes: [{ ...scene, beatPrompts: [{ id: "g1", beatIds: ["b1"], prompts: { omni: "x" } }, { id: "g2", beatIds: ["b2"], prompts: {} }] }] },
      createdAt: 0,
      updatedAt: 0,
    },
  };
  const groupsOf = (patch: any) => patch.filmV093.script.scenes[0].beatPrompts;

  it("merging beats replaces overlapping single-beat groups", () => {
    const patch = upsertBeatPromptGroup(project, "sc1", { id: "g3", beatIds: ["b1", "b2"], prompts: {} });
    expect(groupsOf(patch).map((g: any) => g.id)).toEqual(["g3"]);
  });

  it("editing marks the model as hand-edited", () => {
    const patch = editBeatPromptText(project, "sc1", "g1", "omni", "edited");
    expect(groupsOf(patch)[0]).toMatchObject({ prompts: { omni: "edited" }, editedModels: ["omni"] });
  });

  it("split removes the group", () => {
    expect(groupsOf(removeBeatPromptGroup(project, "sc1", "g1")).map((g: any) => g.id)).toEqual(["g2"]);
  });
});

describe("r8.0 BeatPromptPanel", () => {
  it("renders one row per beat, disables uncovered beats, shows merge bar on select", () => {
    useAppStore.setState({ currentProject: { id: "p" } as any });
    const { container, getByText } = render(
      <BeatPromptPanel scene={scene} shots={shots} characters={cast} setting={setting} />
    );
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(4);
    expect(boxes[3].disabled).toBe(true); // b4 uncovered
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(getByText(/Đã chọn 2 beat · 7s/)).toBeTruthy();
    expect(getByText("✨ Ghép & Generate")).toBeTruthy();
  });

  it("blocks merging non-adjacent beats", () => {
    const { container, getByText } = render(
      <BeatPromptPanel scene={scene} shots={shots} characters={cast} setting={setting} />
    );
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[2]);
    expect(getByText("Chỉ ghép được các beat liền nhau.")).toBeTruthy();
    expect((getByText("✨ Ghép & Generate") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("r8.1 dialogue language", () => {
  const dScene = {
    ...scene,
    dialog: [{ characterId: "c1", characterName: "Hero", lineEn: "Line EN", lineVi: "Câu VI", timingSeconds: { start: 0, end: 2 } }],
  };
  const withDialog = { ...setting, dialog: "has_dialog" };

  it("defaults to English lines", () => {
    const plan = buildBeatPromptPlan({ scene: dScene, sceneShots: shots, beats: [beats[0]], cast, setting: withDialog });
    expect(plan.contextText).toContain('DIALOGUE (spoken in English');
    expect(plan.contextText).toContain('"Line EN"');
  });

  it("uses Vietnamese lines when dialogueLanguage = vi, falls back to EN when missing", () => {
    const vi = { ...withDialog, dialogueLanguage: "vi" };
    const plan = buildBeatPromptPlan({ scene: dScene, sceneShots: shots, beats: [beats[0]], cast, setting: vi });
    expect(plan.contextText).toContain("spoken in Vietnamese");
    expect(plan.contextText).toContain('"Câu VI"');
    const noVi = { ...dScene, dialog: [{ ...dScene.dialog[0], lineVi: undefined }] };
    expect(buildBeatPromptPlan({ scene: noVi, sceneShots: shots, beats: [beats[0]], cast, setting: vi }).contextText).toContain('"Line EN"');
  });

  it("system prompt tells AI to copy the character bible verbatim", () => {
    expect(BEAT_VIDEO_SYSTEM_PROMPT).toMatch(/word for word/);
  });
});

describe("r8.1 character bible", () => {
  it("toFilmCharacters validates, dedupes, caps at 6 and guarantees a protagonist", async () => {
    const { toFilmCharacters } = await import("../src/engine/characterBible");
    const out = toFilmCharacters({
      characters: [
        { name: "A", role: "companion", appearanceEn: "  look   a " },
        { name: "a", role: "extra", appearanceEn: "dup" },
        { name: "", role: "extra", appearanceEn: "no name" },
        { name: "B", role: "villain", appearanceEn: "look b" },
        ...Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, role: "extra", appearanceEn: "x" })),
      ],
    });
    expect(out).toHaveLength(6);
    expect(out[0]).toMatchObject({ name: "A", role: "protagonist", description: "look a" });
    expect(out[1]).toMatchObject({ name: "B", role: "extra" });
    expect(new Set(out.map((c) => c.id)).size).toBe(6);
    expect(toFilmCharacters(null)).toEqual([]);
  });

  it("system prompt uses placeholders only (HANDOFF r7.31 rule)", async () => {
    const { CHARACTER_BIBLE_SYSTEM_PROMPT } = await import("../src/engine/characterBible");
    expect(CHARACTER_BIBLE_SYSTEM_PROMPT).not.toMatch(/\bvd:|Ví dụ:|e\.g\./i);
  });

  it("generateCharacterBible parses AI JSON", async () => {
    vi.mocked(callAi).mockResolvedValue(JSON.stringify({ characters: [{ name: "A", role: "protagonist", appearanceEn: "look" }] }));
    const { generateCharacterBible } = await import("../src/engine/characterBible");
    const out = await generateCharacterBible({ idea: "<idea>", setting, scenes: [], provider: "gemini-flash" });
    expect(out.map((c) => c.name)).toEqual(["A"]);
  });
});
