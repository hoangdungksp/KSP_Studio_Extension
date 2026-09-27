/**
 * KSP Image r8.0 — Beats → Video Prompt panel (inside each Shot List scene card)
 *
 * One row per scene beat (or per merged clip). Each clip has 3 prompt tabs:
 * Gemini Omni Flash / Seedance 2.5 / Grok Imagine. Tick consecutive beats →
 * "Ghép & Generate" merges them into one clip (e.g. short 2-3s beats → one
 * 12-15s Seedance clip). Prompts are editable and saved on the scene.
 *
 * Beat → shots is resolved live from shot.coveredBeatIds (engine/beatVideoPrompt).
 */

import { useState } from "react";
import JSZip from "jszip";
import { useAppStore } from "../store/useAppStore";
import { upsertBeatPromptGroup, editBeatPromptText, removeBeatPromptGroup } from "../store/film_actions";
import type {
  Beat,
  BeatPromptGroup,
  FilmSceneScript,
  FilmShot,
  ProjectSettingV2,
  VideoPromptModel,
} from "../types/project";
import type { FilmCharacter } from "../types/film";
import type { FilmScriptProvider } from "../engine/filmScriptStages";
import {
  VIDEO_MODELS,
  VIDEO_MODEL_SPECS,
  buildBeatPromptPlan,
  generateBeatVideoPrompts,
  isGroupStale,
  resolveShotsForBeats,
  totalSeconds,
  type BeatPromptPlan,
  type ModelPlan,
} from "../engine/beatVideoPrompt";
import "./beatPrompt.css";

interface Props {
  scene: FilmSceneScript;
  shots: FilmShot[];
  characters: FilmCharacter[];
  setting: ProjectSettingV2;
}

/** A row = an existing group, or a single ungrouped beat. */
interface Unit {
  key: string;
  beats: Beat[];
  group?: BeatPromptGroup;
}

function buildUnits(beats: Beat[], groups: BeatPromptGroup[]): Unit[] {
  const units: Unit[] = [];
  const done = new Set<string>();
  for (const b of beats) {
    if (done.has(b.id)) continue;
    const g = groups.find((x) => x.beatIds.includes(b.id));
    if (g) {
      const gBeats = beats.filter((x) => g.beatIds.includes(x.id));
      gBeats.forEach((x) => done.add(x.id));
      units.push({ key: g.id, beats: gBeats, group: g });
    } else {
      done.add(b.id);
      units.push({ key: b.id, beats: [b] });
    }
  }
  return units;
}

function shotRange(unitShots: FilmShot[]): string {
  if (unitShots.length === 0) return "chưa có shot";
  const orders = unitShots.map((s) => s.order);
  const min = Math.min(...orders);
  const max = Math.max(...orders);
  return min === max ? `shot ${min}` : `shot ${min}–${max}`;
}

function fitLabel(p: ModelPlan): { text: string; cls: string } {
  switch (p.fit) {
    case "ok":
      return { text: `${p.targetSeconds}s`, cls: "ok" };
    case "compressed":
      return { text: `${p.sourceSeconds}→${p.targetSeconds}s`, cls: "warn" };
    case "stretched":
      return { text: `${p.sourceSeconds}→${p.targetSeconds}s`, cls: "warn" };
    default:
      return { text: `${p.targetSeconds}s!`, cls: "bad" };
  }
}

const FIT_HINT: Record<ModelPlan["fit"], string> = {
  ok: "",
  compressed: "Dài hơn giới hạn của model → prompt đã nén thời gian. Nên tách clip hoặc dùng Extend.",
  stretched: "Ngắn hơn mức tối thiểu của model → prompt kéo giãn hành động. Nên ghép thêm beat kế bên.",
  too_many_shots: "Quá nhiều shot cho độ dài này → AI gộp shot liền nhau thành chuyển động liên tục.",
};

const SHORT_NAME: Record<VideoPromptModel, string> = { omni: "Omni", seedance: "Seedance", grok: "Grok" };

export function BeatPromptPanel({ scene, shots, characters, setting }: Props) {
  const updateProject = useAppStore((s) => s.updateCurrentProject);
  const showToast = useAppStore((s) => s.showToast);
  const [selected, setSelected] = useState<string[]>([]); // beat ids
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [tab, setTab] = useState<VideoPromptModel>("seedance");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const beats = [...(scene.beats ?? [])].sort((a, b) => a.order - b.order);
  const groups = scene.beatPrompts ?? [];
  const units = buildUnits(beats, groups);
  const provider = (setting.aiProviders?.scriptWriter ?? "gemini-flash") as FilmScriptProvider;

  if (beats.length === 0) {
    return (
      <div className="ksp-beatprompt">
        <div className="ksp-beatprompt-title">🎬 BEATS → VIDEO PROMPT</div>
        <p className="ksp-beatprompt-empty">
          Scene chưa có beat. Beat được phân tích tự động sau khi viết kịch bản (bước Analyze Scenes).
        </p>
      </div>
    );
  }

  const planFor = (unitBeats: Beat[]): BeatPromptPlan =>
    buildBeatPromptPlan({ scene, sceneShots: shots, beats: unitBeats, cast: characters, setting });

  // ---------- selection ----------
  const selectedBeats = beats.filter((b) => selected.includes(b.id));
  const selectedOrders = selectedBeats.map((b) => beats.indexOf(b));
  const contiguous =
    selectedOrders.length > 0 &&
    Math.max(...selectedOrders) - Math.min(...selectedOrders) + 1 === selectedOrders.length;
  const selectedShots = resolveShotsForBeats(selected, shots);
  const selectedPlan = selectedBeats.length > 0 && selectedShots.length > 0 ? planFor(selectedBeats) : null;

  function toggleUnit(u: Unit) {
    const ids = u.beats.map((b) => b.id);
    const allOn = ids.every((id) => selected.includes(id));
    setSelected(allOn ? selected.filter((id) => !ids.includes(id)) : Array.from(new Set([...selected, ...ids])));
  }

  // ---------- generate ----------
  async function generate(unitBeats: Beat[], existing?: BeatPromptGroup) {
    const edited = existing?.editedModels ?? [];
    if (edited.length > 0) {
      const ok = confirm(
        `Anh đã sửa tay prompt ${edited.map((m) => SHORT_NAME[m]).join(", ")}. Generate lại sẽ ghi đè. Tiếp tục?`
      );
      if (!ok) return;
    }
    const key = existing?.id ?? unitBeats.map((b) => b.id).join("+");
    setBusyKey(key);
    try {
      const { prompts, plan } = await generateBeatVideoPrompts(
        { scene, sceneShots: shots, beats: unitBeats, cast: characters, setting },
        provider
      );
      const group: BeatPromptGroup = {
        id: existing?.id ?? `bp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        beatIds: unitBeats.map((b) => b.id),
        prompts,
        editedModels: [],
        sourceFingerprint: plan.fingerprint,
        generatedAt: Date.now(),
      };
      updateProject((p) => upsertBeatPromptGroup(p, scene.id, group));
      setOpenKey(group.id);
      setSelected([]);
      showToast(`✨ Đã tạo prompt cho ${unitBeats.length} beat (${plan.plans.seedance.sourceSeconds}s)`, "success");
    } catch (e) {
      showToast(`❌ ${(e as Error).message}`, "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function copy(text: string, model: VideoPromptModel) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`📋 Đã copy prompt ${VIDEO_MODEL_SPECS[model].label}`, "success");
    } catch {
      showToast("Không copy được — bôi đen rồi Cmd+C", "error");
    }
  }

  async function downloadRefs(plan: BeatPromptPlan, label: string) {
    const zip = new JSZip();
    for (const r of plan.references) {
      const base64 = r.dataUrl.split(",")[1] ?? "";
      zip.file(r.filename, base64, { base64: true });
    }
    zip.file(
      "README.txt",
      [
        `Scene ${scene.order} — ${label}`,
        "Upload ảnh theo đúng thứ tự số ở đầu tên file:",
        ...plan.references.map(
          (r) =>
            `${r.filename}: ${r.characterName} → Omni ${VIDEO_MODEL_SPECS.omni.refLabel(r.index)} / Seedance ${VIDEO_MODEL_SPECS.seedance.refLabel(r.index)} / Grok ${VIDEO_MODEL_SPECS.grok.refLabel(r.index)}`
        ),
      ].join("\n")
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scene-${scene.order}_${label.replace(/\s+/g, "-")}_refs.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- render ----------
  return (
    <div className="ksp-beatprompt">
      <div className="ksp-beatprompt-title">🎬 BEATS → VIDEO PROMPT</div>
      <p className="ksp-beatprompt-hint">
        Tick các beat liền nhau rồi bấm Ghép để gộp thành 1 clip (Omni ≤10s · Seedance 4–30s · Grok ≤15s, ≤10s khi có ảnh ref).
      </p>

      <ul className="ksp-beatprompt-list">
        {units.map((u) => {
          const unitShots = resolveShotsForBeats(
            u.beats.map((b) => b.id),
            shots
          );
          const secs = totalSeconds(unitShots);
          const covered = unitShots.length > 0;
          const isOn = u.beats.every((b) => selected.includes(b.id));
          const isOpen = openKey === u.key;
          const stale = u.group ? isGroupStale(u.group, beats, shots) : false;
          const hasPrompt = !!u.group && VIDEO_MODELS.some((m) => u.group!.prompts[m]);
          const busy = busyKey === (u.group?.id ?? u.beats.map((b) => b.id).join("+"));
          const label =
            u.beats.length === 1 ? `beat-${u.beats[0].order}` : `beats-${u.beats[0].order}-${u.beats[u.beats.length - 1].order}`;

          return (
            <li key={u.key} className={`ksp-beatprompt-unit${u.beats.length > 1 ? " merged" : ""}`}>
              <div className="ksp-beatprompt-row">
                <input
                  type="checkbox"
                  checked={isOn}
                  disabled={!covered}
                  onChange={() => toggleUnit(u)}
                  title={covered ? "Chọn để ghép" : "Beat chưa có shot phủ"}
                />
                <div className="ksp-beatprompt-label">
                  {u.beats.map((b) => (
                    <div key={b.id}>
                      <strong>{b.order}.</strong> {b.label}
                    </div>
                  ))}
                  <span className="ksp-beatprompt-meta">
                    {shotRange(unitShots)}
                    {covered && ` · ${secs}s`}
                    {stale && <span className="ksp-beatprompt-stale"> · ⚠ shot đã đổi</span>}
                  </span>
                </div>
                <button
                  type="button"
                  className={`ksp-beatprompt-toggle${hasPrompt ? " has" : ""}`}
                  disabled={!covered}
                  onClick={() => setOpenKey(isOpen ? null : u.key)}
                >
                  {hasPrompt ? "Prompt" : "+ Prompt"} {isOpen ? "▴" : "▾"}
                </button>
              </div>

              {isOpen && covered && (
                <UnitPrompt
                  plan={planFor(u.beats)}
                  group={u.group}
                  stale={stale}
                  busy={busy}
                  tab={tab}
                  setTab={setTab}
                  onGenerate={() => generate(u.beats, u.group)}
                  onEdit={(m, text) => u.group && updateProject((p) => editBeatPromptText(p, scene.id, u.group!.id, m, text))}
                  onCopy={copy}
                  onRefs={(plan) => downloadRefs(plan, label)}
                  onSplit={
                    u.group && u.beats.length > 1
                      ? () => {
                          if (confirm("Tách clip này về từng beat riêng? Prompt đã ghép sẽ bị xoá.")) {
                            updateProject((p) => removeBeatPromptGroup(p, scene.id, u.group!.id));
                            setOpenKey(null);
                          }
                        }
                      : undefined
                  }
                />
              )}
            </li>
          );
        })}
      </ul>

      {selectedBeats.length > 0 && (
        <div className="ksp-beatprompt-selbar">
          <div className="ksp-beatprompt-selinfo">
            Đã chọn {selectedBeats.length} beat · {totalSeconds(selectedShots)}s
            {selectedPlan && (
              <span className="ksp-beatprompt-fits">
                {VIDEO_MODELS.map((m) => {
                  const f = fitLabel(selectedPlan.plans[m]);
                  return (
                    <span key={m} className={`ksp-beatprompt-fit ${f.cls}`} title={FIT_HINT[selectedPlan.plans[m].fit]}>
                      {SHORT_NAME[m]} {f.text}
                    </span>
                  );
                })}
              </span>
            )}
            {!contiguous && <div className="ksp-beatprompt-warn">Chỉ ghép được các beat liền nhau.</div>}
          </div>
          <div className="ksp-beatprompt-selactions">
            <button type="button" className="ksp-step-secondary-btn" onClick={() => setSelected([])}>
              Bỏ chọn
            </button>
            <button
              type="button"
              className="ksp-step-primary-btn ksp-step-primary-btn-sm"
              disabled={!contiguous || selectedShots.length === 0 || busyKey !== null}
              onClick={() => generate(selectedBeats)}
            >
              {busyKey ? "⏳ Đang viết..." : selectedBeats.length > 1 ? "✨ Ghép & Generate" : "✨ Generate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PROMPT EDITOR (3 tabs)
// ============================================================================

function UnitPrompt({
  plan,
  group,
  stale,
  busy,
  tab,
  setTab,
  onGenerate,
  onEdit,
  onCopy,
  onRefs,
  onSplit,
}: {
  plan: BeatPromptPlan;
  group?: BeatPromptGroup;
  stale: boolean;
  busy: boolean;
  tab: VideoPromptModel;
  setTab: (m: VideoPromptModel) => void;
  onGenerate: () => void;
  onEdit: (m: VideoPromptModel, text: string) => void;
  onCopy: (text: string, m: VideoPromptModel) => void;
  onRefs: (plan: BeatPromptPlan) => void;
  onSplit?: () => void;
}) {
  const text = group?.prompts[tab] ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? text;
  const modelPlan = plan.plans[tab];
  const f = fitLabel(modelPlan);

  return (
    <div className="ksp-beatprompt-editor">
      <div className="ksp-beatprompt-tabs">
        {VIDEO_MODELS.map((m) => {
          const fm = fitLabel(plan.plans[m]);
          return (
            <button
              key={m}
              type="button"
              className={`ksp-beatprompt-tab${tab === m ? " active" : ""}`}
              onClick={() => {
                setDraft(null);
                setTab(m);
              }}
            >
              {SHORT_NAME[m]} <span className={`ksp-beatprompt-fit ${fm.cls}`}>{fm.text}</span>
            </button>
          );
        })}
      </div>

      {modelPlan.fit !== "ok" && <div className="ksp-beatprompt-warn">{FIT_HINT[modelPlan.fit]}</div>}
      {stale && <div className="ksp-beatprompt-warn">Shot list hoặc beat đã thay đổi sau khi tạo prompt → nên Generate lại.</div>}

      {group && text ? (
        <textarea
          className="ksp-beatprompt-textarea"
          value={value}
          rows={10}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null && draft !== text) onEdit(tab, draft);
            setDraft(null);
          }}
        />
      ) : (
        <p className="ksp-beatprompt-empty">
          Chưa có prompt. Bấm Generate — AI viết 1 lần cho cả 3 model ({VIDEO_MODEL_SPECS[tab].label}: {f.text}).
        </p>
      )}

      {plan.references.length > 0 && (
        <div className="ksp-beatprompt-refs">
          Ảnh ref cần upload theo thứ tự:{" "}
          {plan.references.map((r) => `${VIDEO_MODEL_SPECS[tab].refLabel(r.index)} = ${r.characterName}`).join(" · ")}
        </div>
      )}

      <div className="ksp-beatprompt-actions">
        {group && text && (
          <button type="button" className="ksp-step-primary-btn ksp-step-primary-btn-sm" onClick={() => onCopy(value, tab)}>
            📋 Copy {SHORT_NAME[tab]}
          </button>
        )}
        <button type="button" className="ksp-step-secondary-btn" disabled={busy} onClick={onGenerate}>
          {busy ? "⏳ Đang viết..." : group ? "✨ Generate lại" : "✨ Generate"}
        </button>
        {plan.references.length > 0 && (
          <button type="button" className="ksp-step-secondary-btn" onClick={() => onRefs(plan)}>
            ⬇ Refs ({plan.references.length})
          </button>
        )}
        {onSplit && (
          <button type="button" className="ksp-step-secondary-btn" onClick={onSplit}>
            ✂ Tách
          </button>
        )}
      </div>
    </div>
  );
}
