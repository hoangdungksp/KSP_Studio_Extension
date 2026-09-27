/**
 * KSP Image Film Shot List Section (NEW)
 *
 * Pipeline position: SCRIPT → SHOT LIST → STORYBOARD
 *
 * Pure TEXT planning section. Per scene, displays a table of shots with:
 *   #  | Type     | Movement | Duration | Action (VN)
 *   1.1| Wide     | Static   | 4s       | Robot xuất hiện trong rừng
 *   1.2| Close-up | Zoom in  | 3s       | Mắt LED sáng dần lên
 *
 * AI button per scene: "✨ AI sinh shot list từ scene action" → calls
 * runShotListForScene() (Gemini Flash, ~$0). Result populates shotsBySceneId
 * via setShotsForScene action. User then edits inline before moving to
 * STORYBOARD section (visual rendering).
 *
 * Design philosophy:
 * - CHEAP: Pure text → AI cost ~free per scene
 * - REVIEWABLE: User edits shot list TEXT before $$ storyboard renders
 * - REUSED schema: Same `FilmShot[]` written to `shotsBySceneId`
 *   → Storyboard section reads the same data, just adds visual layer
 */

import React, { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import {
  ensureFilmData,
  getShotsForScene,
  addShot,
  removeShot,
  updateShot,
  setShotsForScene,
} from "../store/film_actions";
import type { FilmShot, FilmSceneScript, RhythmRole, Beat } from "../types/project";
import { BEAT_TYPE_LABELS } from "../types/project";
import { RHYTHM_ROLE_LABELS } from "../types/project";
import {
  runShotListForScene,
  regenSingleShot,
  type GeneratedShot,
} from "../engine/filmShotListGeneration";
import type { FilmScriptProvider } from "../engine/filmScriptStages";
import { buildStoryOverviewTxt } from "../engine/filmStoryOverviewExport";

const SHOT_TYPE_OPTIONS: { value: FilmShot["shotType"]; labelVi: string }[] = [
  { value: "wide_establishing", labelVi: "Wide / Toàn cảnh" },
  { value: "medium", labelVi: "Medium / Trung cảnh" },
  { value: "close_up", labelVi: "Close-up / Cận" },
  { value: "insert", labelVi: "Insert / Chèn" },
  { value: "over_shoulder", labelVi: "Over shoulder / Qua vai" },
  { value: "two_shot", labelVi: "Two-shot / 2 người" },
  { value: "pov", labelVi: "POV / Góc nhìn" },
];

const RHYTHM_ROLE_OPTIONS: { value: RhythmRole; labelVi: string }[] = [
  { value: "establish", labelVi: "Mở (establish)" },
  { value: "build",     labelVi: "Leo (build)" },
  { value: "peak",      labelVi: "Đỉnh (peak)" },
  { value: "release",   labelVi: "Thả (release)" },
];

// r7.21: cameraMovement options now imported from single source of truth.
// Was: local 11-value array duplicated with FilmFrameEditModal + filmShotListGeneration.
import { CAMERA_MOVEMENT_OPTIONS } from "../types/cameraMovement";
import { AutoChainRetryBanner } from "./AutoChainRetryBanner";
import { BeatPromptPanel } from "./BeatPromptPanel";
import { CharacterBibleBlock } from "./CharacterBibleBlock";

function formatSceneDuration(secs: number): string {
  if (secs >= 60) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s === 0 ? `${m}m` : `${m}m${s}s`;
  }
  return `${secs}s`;
}

// ============================================================================
// MAIN SECTION
// ============================================================================

export function FilmShotListSection() {
  const project = useAppStore((s) => s.currentProject);
  const updateProject = useAppStore((s) => s.updateCurrentProject);
  const showToast = useAppStore((s) => s.showToast);
  // subscribe to autoChainState for section-level border animation
  // Shot List section animates when analyze-scenes OR shot-list is generating.
  // Sub-progress badge shows "Scene N/M — <title>" during loop.
  const autoChainState = useAppStore((s) => s.autoChainState);

  if (!project) return null;
  const film = ensureFilmData(project);
  const script = film.script;
  const setting = (project as any).settingV2 as
    | import("../types/project").ProjectSettingV2
    | undefined;

  const totalShots = script?.scenes
    ? script.scenes.reduce(
        (sum, sc) => sum + (film.shotsBySceneId?.[sc.id]?.length ?? 0),
        0
      )
    : 0;

  const totalScenes = script?.scenes?.length ?? 0;

  // animate logic + sub-progress aggregation
  const analyzeScenesState = autoChainState.sections["analyze-scenes"];
  const shotListState = autoChainState.sections["shot-list"];
  const shotListStatuses = [analyzeScenesState?.status, shotListState?.status].filter(Boolean) as string[];
  const isShotListGenerating = shotListStatuses.includes("generating");
  const shotListHasError = shotListStatuses.includes("error");
  // Determine which job is currently active + show its sub-progress
  const activeJob = analyzeScenesState?.status === "generating"
    ? analyzeScenesState
    : shotListState?.status === "generating"
      ? shotListState
      : null;
  const activeJobLabel = analyzeScenesState?.status === "generating"
    ? "Analyze Scenes"
    : shotListState?.status === "generating"
      ? "Shot List"
      : null;
  const sectionClass = isShotListGenerating
    ? "ksp-section ksp-shotlist-film ksp-autochain-generating"
    : shotListHasError
      ? "ksp-section ksp-shotlist-film ksp-autochain-error"
      : "ksp-section ksp-shotlist-film";

  /**
   * Sprint 1.0 Feature 1: Download full story overview as .txt
   * Triggered from header download button. Generates Vietnamese text with
   * all scenes + shots + cast + dialog and downloads via Blob link.
   */
  function handleDownloadStoryOverview() {
    if (!script || script.scenes.length === 0) {
      showToast("Chưa có Script — không có gì để xuất", "info");
      return;
    }
    try {
      const text = buildStoryOverviewTxt({
        idea: (project as any).idea,
        script,
        characters: film.characters,
        shotsBySceneId: film.shotsBySceneId ?? {},
        setting,
        framework: (film as any).scriptFramework,
        projectName: (project as any).name,
      });
      // UTF-8 BOM helps Windows Notepad render Vietnamese correctly
      const blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const safeTitle = (script.titleVi || script.titleEn || "story")
        .replace(/[^a-zA-Z0-9\u00C0-\u1EF9_-]/g, "_")
        .slice(0, 60);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}_overview.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Đã xuất story overview (${text.length} ký tự)`, "success");
    } catch (err) {
      showToast(`Xuất overview lỗi: ${(err as Error).message}`, "error");
    }
  }

  return (
    <section className={sectionClass}>
      <header className="ksp-section-header">
        <span className="ksp-section-icon">🎯</span>
        <h2 className="ksp-section-title">4. SHOT LIST</h2>
        <span className="ksp-section-meta">
          {totalScenes > 0
            ? `${totalShots} shots · ${totalScenes} scenes`
            : "chưa có script"}
        </span>
        {/* r7.15d-fix1: sub-progress badge when auto-chain is filling shots */}
        {activeJob && activeJobLabel && (
          <span className="ksp-shotlist-autochain-badge" title={`Auto-chain: ${activeJobLabel}`}>
            ⚡ {activeJobLabel}
            {activeJob.subProgress && (
              <> · {activeJob.subProgress.current}/{activeJob.subProgress.total}
                {activeJob.subProgress.currentSceneTitle && (
                  <> — {activeJob.subProgress.currentSceneTitle}</>
                )}
              </>
            )}
          </span>
        )}
        {/* r7.8 Feature 1: download full story overview button (right corner) */}
        {script && totalScenes > 0 && (
          <button
            type="button"
            className="ksp-shotlist-download-overview-btn"
            onClick={handleDownloadStoryOverview}
            title="📥 Tải về toàn bộ mô tả phim (scenes + shots + cast) dạng text tiếng Việt dễ đọc"
            aria-label="Download story overview"
          >
            📥 Story Overview
          </button>
        )}
      </header>

      {/* r7.29 Feature 1A: Retry button when analyze-scenes or shot-list errors */}
      <AutoChainRetryBanner
        sectionIds={["analyze-scenes", "shot-list"]}
        sectionLabel="Phân tích Scenes / Shot List"
      />

      {/* r8.1: AI character bible (replaces Cast section in Film mode) */}
      <CharacterBibleBlock characters={film.characters} />

      {!script && (
        <div className="ksp-shotlist-film-empty">
          <p>
            ⚠ Chưa có Script. Hãy generate Script ở section trên trước, rồi quay lại đây để AI sinh shot list cho từng phân cảnh.
          </p>
          <p style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
            ℹ Shot list = bảng text mô tả từng góc quay (type, movement, duration, action). Cheap, review trước khi tốn tiền render storyboard visual ở section dưới.
          </p>
        </div>
      )}

      {script &&
        script.scenes.map((scene) => (
          <SceneShotListCard
            key={scene.id}
            scene={scene}
            shots={getShotsForScene(project, scene.id)}
            characters={film.characters}
            setting={setting}
            onAIGenerate={async () => {
              if (!setting) {
                showToast("Project setting missing", "error");
                return;
              }
              const existing = getShotsForScene(project, scene.id);
              if (existing.length > 0) {
                const ok = confirm(
                  `Scene "${scene.titleVi || scene.titleEn}" đã có ${existing.length} shots. Sinh lại sẽ tốn 1 AI call và ghi đè toàn bộ shots hiện tại.\n\nClick OK để tiếp tục, Cancel để giữ nguyên.`
                );
                if (!ok) return;
              }

              try {
                const provider: FilmScriptProvider =
                  (setting.aiProviders?.scriptWriter ?? "gemini-flash") as FilmScriptProvider;
                const generated = await runShotListForScene({
                  scene,
                  characters: film.characters,
                  setting,
                  provider,
                  // Grid + provider duration constraints (Jason Q1 + Q2)
                  gridFormat: (scene as any).gridFormat ?? "3x3",
                  videoProviderId: (setting as any).defaultVideoProvider ?? "seedance-2-pro",
                  // Sprint 1.0 r7: pass beats so AI must cover them all
                  beats: (scene as any).beats,
                });
                // Map GeneratedShot → FilmShot
                const newShots: FilmShot[] = generated.map((gs, idx) => ({
                  id: `shot_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
                  order: idx + 1,
                  titleEn: gs.titleEn,
                  titleVi: gs.titleVi,
                  shotType: gs.shotType,
                  durationSeconds: gs.durationSeconds,
                  gridFormat: "3x3",
                  cameraMovement: gs.cameraMovement as any,
                  purpose: gs.purposeVi, // legacy field for downstream prompts
                  purposeVi: gs.purposeVi,
                  // Sprint 1.0 r7: Q1 VI leak fix
                  purposeEn: gs.purposeEn,
                  actionVi: gs.actionVi,
                  actionEn: gs.actionEn,
                  status: "draft",
                  // Sprint 1.0 r1 (Phase 1B)
                  rhythmRole: gs.rhythmRole,
                  // Sprint 1.0 r7: per-shot mood + beat mapping
                  lightingHintEn: gs.lightingHintEn,
                  coveredBeatIds: gs.coveredBeatIds,
                  // Sprint G1e2 Phase 2B: inner emotional state per shot
                  innerStateVi: gs.innerStateVi,
                } as any));
                updateProject((p) => setShotsForScene(p, scene.id, newShots));
                showToast(
                  `Đã sinh ${newShots.length} shots cho Scene ${scene.order}`,
                  "success"
                );
              } catch (err) {
                showToast(`AI sinh shot list lỗi: ${(err as Error).message}`, "error");
              }
            }}
            onAddShot={() => updateProject((p) => addShot(p, scene.id))}
            onUpdateShot={(shotId, updates) =>
              updateProject((p) => updateShot(p, scene.id, shotId, updates))
            }
            onRemoveShot={(shotId) =>
              updateProject((p) => removeShot(p, scene.id, shotId))
            }
            onRegenShot={async (shotIndex) => {
              if (!setting) {
                showToast("Project setting missing", "error");
                return;
              }
              const currentShots = getShotsForScene(project, scene.id);
              if (shotIndex < 0 || shotIndex >= currentShots.length) {
                showToast("Shot index không hợp lệ", "error");
                return;
              }
              const targetShot = currentShots[shotIndex];
              try {
                const provider: FilmScriptProvider =
                  (setting.aiProviders?.scriptWriter ?? "gemini-flash") as FilmScriptProvider;
                const newContent = await regenSingleShot({
                  scene,
                  allShots: currentShots,
                  indexToRegen: shotIndex,
                  characters: film.characters,
                  setting,
                  provider,
                  // clamp duration to provider's supported values
                  videoProviderId: (setting as any).defaultVideoProvider ?? "seedance-2-pro",
                });
                // Replace content but KEEP original id (per Jason Q-A confirmation)
                updateProject((p) =>
                  updateShot(p, scene.id, targetShot.id, {
                    titleEn: newContent.titleEn,
                    titleVi: newContent.titleVi,
                    shotType: newContent.shotType,
                    cameraMovement: newContent.cameraMovement as any,
                    durationSeconds: newContent.durationSeconds,
                    purpose: newContent.purposeVi,
                    purposeVi: newContent.purposeVi,
                    actionVi: newContent.actionVi,
                    actionEn: newContent.actionEn,
                    // Sprint 1.0 r1 (Phase 1B)
                    rhythmRole: newContent.rhythmRole,
                  })
                );
                showToast(
                  `Đã regen shot ${scene.order}.${targetShot.order}`,
                  "success"
                );
              } catch (err) {
                showToast(`AI regen shot lỗi: ${(err as Error).message}`, "error");
              }
            }}
          />
        ))}

      {script && (
        <div className="ksp-shotlist-film-footer">
          <span className="ksp-shotlist-film-footer-text">
            ⓘ Shot list là TEXT planning. Review/edit xong → mở từng scene, dùng panel <strong>🎬 BEATS → VIDEO PROMPT</strong> để tạo prompt video.
          </span>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// SCENE CARD — collapsible, contains shots table
// ============================================================================

interface SceneShotListCardProps {
  scene: FilmSceneScript;
  shots: FilmShot[];
  /** r8.0: for per-beat video prompts */
  characters: import("../types/film").FilmCharacter[];
  setting?: import("../types/project").ProjectSettingV2;
  onAIGenerate: () => Promise<void>;
  onAddShot: () => void;
  onUpdateShot: (shotId: string, updates: Partial<FilmShot>) => void;
  onRemoveShot: (shotId: string) => void;
  onRegenShot: (shotIndex: number) => Promise<void>;
}

function SceneShotListCard({
  scene,
  shots,
  characters,
  setting,
  onAIGenerate,
  onAddShot,
  onUpdateShot,
  onRemoveShot,
  onRegenShot,
}: SceneShotListCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  // Sprint 1.0 r7: coverage modal toggle
  const [coverageModalOpen, setCoverageModalOpen] = useState(false);

  const totalShotDuration = shots.reduce((s, sh) => s + (sh.durationSeconds ?? 0), 0);
  const durationMismatch =
    shots.length > 0 && Math.abs(totalShotDuration - scene.durationSeconds) > 3;

  // Sprint 1.0 r7: compute beat coverage
  const sceneBeats = (scene as any).beats as Beat[] | undefined;
  const totalBeats = sceneBeats?.length ?? 0;
  const coveredBeatIds = new Set<string>();
  for (const shot of shots) {
    const covered = (shot as any).coveredBeatIds as string[] | undefined;
    if (covered) {
      for (const bid of covered) coveredBeatIds.add(bid);
    }
  }
  const coveredCount = sceneBeats
    ? sceneBeats.filter((b) => coveredBeatIds.has(b.id)).length
    : 0;
  const missingCount = totalBeats - coveredCount;

  async function handleAIClick() {
    setIsGenerating(true);
    try {
      await onAIGenerate();
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="ksp-shotlist-film-scene-card">
      <div className="ksp-shotlist-film-scene-header" onClick={() => setExpanded(!expanded)}>
        <span className="ksp-shotlist-film-scene-toggle">{expanded ? "▼" : "▶"}</span>
        <strong className="ksp-shotlist-film-scene-order">Scene {scene.order}</strong>
        <span className="ksp-shotlist-film-scene-title">
          {scene.titleVi || scene.titleEn}
        </span>
        <span className="ksp-shotlist-film-scene-meta">
          {shots.length} shots · {formatSceneDuration(scene.durationSeconds)}
        </span>
      </div>

      {expanded && (
        <div className="ksp-shotlist-film-scene-body">
          {/* Scene action preview */}
          <div className="ksp-shotlist-film-scene-action">
            {(scene as any).actionLinesVi || scene.actionLinesEn}
          </div>

          {/* Sprint 1.0 r7: Beat coverage indicator */}
          {totalBeats > 0 && shots.length > 0 && (
            <div className="ksp-coverage-banner">
              <span className="ksp-coverage-banner-text">
                📊 Beat coverage:{" "}
                <span className="ksp-coverage-banner-stat">
                  {coveredCount}/{totalBeats}
                </span>
                {missingCount > 0 && (
                  <>
                    {" · "}
                    <span className="ksp-coverage-banner-stat ksp-coverage-banner-stat-missing">
                      {missingCount} missing
                    </span>
                  </>
                )}
              </span>
              <button
                type="button"
                className="ksp-coverage-banner-btn"
                onClick={() => setCoverageModalOpen(true)}
              >
                🎯 View beats
              </button>
            </div>
          )}

          {shots.length === 0 ? (
            <div className="ksp-shotlist-film-empty-shots">
              <p>Chưa có shots cho scene này.</p>
              <div className="ksp-shotlist-film-empty-shots-actions">
                <button
                  type="button"
                  className="ksp-step-primary-btn"
                  onClick={handleAIClick}
                  disabled={isGenerating}
                >
                  {isGenerating ? "⏳ Đang sinh..." : "✨ AI sinh shot list"}
                </button>
                <button
                  type="button"
                  className="ksp-step-secondary-btn"
                  onClick={onAddShot}
                >
                  + Thêm shot manual
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Shot rows table */}
              <div className="ksp-shotlist-film-table">
                <div className="ksp-shotlist-film-row ksp-shotlist-film-row-head">
                  <span className="ksp-shotlist-film-col-num">#</span>
                  <span className="ksp-shotlist-film-col-title">Title</span>
                  <span className="ksp-shotlist-film-col-type">Type</span>
                  <span className="ksp-shotlist-film-col-mov">Movement</span>
                  <span className="ksp-shotlist-film-col-dur">Dur</span>
                  <span className="ksp-shotlist-film-col-regen" title="Regen single shot">🔄</span>
                  <span className="ksp-shotlist-film-col-rm">×</span>
                </div>

                {shots.map((shot, idx) => (
                  <ShotRow
                    key={shot.id}
                    shot={shot}
                    sceneOrder={scene.order}
                    onUpdate={(updates) => onUpdateShot(shot.id, updates)}
                    onRemove={() => {
                      if (confirm(`Xóa shot ${scene.order}.${shot.order}?`)) {
                        onRemoveShot(shot.id);
                      }
                    }}
                    onRegen={() => onRegenShot(idx)}
                  />
                ))}
              </div>

              <div className="ksp-shotlist-film-scene-actions">
                <span className={`ksp-shotlist-film-duration-info ${durationMismatch ? "warn" : ""}`}>
                  Tổng: {totalShotDuration}s
                  {durationMismatch && ` (lệch ${totalShotDuration - scene.durationSeconds > 0 ? "+" : ""}${totalShotDuration - scene.durationSeconds}s so với scene)`}
                </span>
                <button
                  type="button"
                  className="ksp-step-secondary-btn"
                  onClick={onAddShot}
                >
                  + Thêm shot
                </button>
                <button
                  type="button"
                  className="ksp-step-primary-btn ksp-step-primary-btn-sm"
                  onClick={handleAIClick}
                  disabled={isGenerating}
                  title="Sinh lại toàn bộ shot list (sẽ ghi đè)"
                >
                  {isGenerating ? "⏳ Đang sinh..." : "✨ Sinh lại"}
                </button>
              </div>

              {/* r8.0: per-beat video prompts (Omni Flash / Seedance 2.5 / Grok) */}
              {setting && (
                <BeatPromptPanel scene={scene} shots={shots} characters={characters} setting={setting} />
              )}
            </>
          )}
        </div>
      )}

      {/* Sprint 1.0 r7: Coverage modal */}
      {coverageModalOpen && (
        <div
          className="ksp-coverage-modal-backdrop"
          onClick={() => setCoverageModalOpen(false)}
        >
          <div className="ksp-coverage-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              🎯 Beat coverage — Scene {scene.order}: {scene.titleVi || scene.titleEn}
            </h3>
            <p style={{ fontSize: 12, color: "#888780", margin: "0 0 12px 0" }}>
              {coveredCount}/{totalBeats} beats được cover bởi {shots.length} shots.
              {missingCount > 0 && ` ${missingCount} beats chưa có shot.`}
            </p>
            <ul className="ksp-coverage-modal-list">
              {sceneBeats?.map((b) => {
                const isCovered = coveredBeatIds.has(b.id);
                const typeInfo = BEAT_TYPE_LABELS[b.type];
                return (
                  <li
                    key={b.id}
                    className={`ksp-coverage-beat ${
                      isCovered ? "ksp-coverage-beat-covered" : "ksp-coverage-beat-missing"
                    }`}
                  >
                    <span className="ksp-coverage-beat-check">
                      {isCovered ? "✓" : "✗"}
                    </span>
                    <span
                      className="ksp-coverage-beat-check"
                      style={{ color: typeInfo.color }}
                      title={typeInfo.vi}
                    >
                      {typeInfo.emoji}
                    </span>
                    <span>
                      <strong>{b.order}.</strong> {b.label}
                    </span>
                    {!isCovered && (
                      <button
                        type="button"
                        className="ksp-coverage-beat-generate"
                        disabled
                        title="Coming in Sprint G1c: AI generate shot for this beat"
                      >
                        + shot
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button
                type="button"
                className="ksp-btn ksp-btn-secondary ksp-btn-sm"
                onClick={() => setCoverageModalOpen(false)}
              >
                ✓ Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SHOT ROW — single shot with editable fields
// ============================================================================

interface ShotRowProps {
  shot: FilmShot;
  sceneOrder: number;
  onUpdate: (updates: Partial<FilmShot>) => void;
  onRemove: () => void;
  onRegen: () => Promise<void>;
}

function ShotRow({ shot, sceneOrder, onUpdate, onRemove, onRegen }: ShotRowProps) {
  const [showAction, setShowAction] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Sprint 1.0 r7 (Q4 migration): detect VI-only purpose (legacy data pre-r7).
  // Heuristic: shot.purpose exists but purposeEn missing → likely Vietnamese-only data.
  // Show warning badge prompting user to regenerate via ✨ Sinh lại.
  const hasLegacyVietnamesePurpose =
    !!shot.purpose?.trim() && !((shot as any).purposeEn?.trim());

  async function handleRegenClick() {
    const ok = confirm(
      `Sinh lại shot ${sceneOrder}.${shot.order}?\n\nAI sẽ tạo shot mới khác với shot hiện tại (khác shotType / cameraMovement / hoặc action focus).\n\nTốn 1 AI call.\n\nClick OK để regen.`
    );
    if (!ok) return;
    setIsRegenerating(true);
    try {
      await onRegen();
    } finally {
      setIsRegenerating(false);
    }
  }

  return (
    <>
      <div className="ksp-shotlist-film-row">
        <span
          className="ksp-shotlist-film-col-num"
          onClick={() => setShowAction(!showAction)}
          title={showAction ? "Ẩn action" : "Hiện action"}
        >
          {sceneOrder}.{shot.order}
        </span>
        <input
          type="text"
          className="ksp-shotlist-film-col-title ksp-shotlist-film-title-input"
          value={shot.titleVi || shot.titleEn}
          onChange={(e) => onUpdate({ titleVi: e.target.value })}
          placeholder="Tiêu đề shot"
        />
        <select
          className="ksp-shotlist-film-col-type ksp-shotlist-film-select"
          value={shot.shotType}
          onChange={(e) =>
            onUpdate({ shotType: e.target.value as FilmShot["shotType"] })
          }
        >
          {SHOT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.labelVi}
            </option>
          ))}
        </select>
        <select
          className="ksp-shotlist-film-col-mov ksp-shotlist-film-select"
          value={shot.cameraMovement as string}
          onChange={(e) => onUpdate({ cameraMovement: e.target.value as any })}
        >
          {CAMERA_MOVEMENT_OPTIONS.map((o) => {
            // r7.21: badge indicates which AI model recognizes this term natively
            const badge = o.veo3Compatible && o.omniCompatible
              ? ""  // universal — no badge needed
              : o.omniCompatible
                ? " 🎯"  // Omni-only
                : " 🎬";  // Veo3-only
            return (
              <option key={o.value} value={o.value}>
                {o.labelVi}{badge}
              </option>
            );
          })}
        </select>
        <input
          type="number"
          className="ksp-shotlist-film-col-dur ksp-shotlist-film-dur-input"
          min={1}
          max={30}
          value={shot.durationSeconds}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0 && v <= 30) onUpdate({ durationSeconds: v });
          }}
        />
        <select
          className="ksp-shotlist-film-rhythm ksp-rhythm-pill"
          data-role={shot.rhythmRole ?? "neutral"}
          value={shot.rhythmRole ?? ""}
          onChange={(e) => {
            const v = e.target.value as RhythmRole | "";
            if (v) onUpdate({ rhythmRole: v });
          }}
          title="Vai trò nhịp (rhythm role) — cinematic micro-arc trong scene"
        >
          {!shot.rhythmRole && <option value="">·</option>}
          {RHYTHM_ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {RHYTHM_ROLE_LABELS[o.value].emoji} {RHYTHM_ROLE_LABELS[o.value].vi}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ksp-shotlist-film-col-regen ksp-shotlist-film-regen-btn"
          onClick={handleRegenClick}
          disabled={isRegenerating}
          title="🔄 Sinh lại shot này (giữ id cũ, AI tạo content khác)"
        >
          {isRegenerating ? "⏳" : "🔄"}
        </button>
        <button
          type="button"
          className="ksp-shotlist-film-col-rm ksp-shotlist-film-remove-btn"
          onClick={onRemove}
          title="Xóa shot"
        >
          ×
        </button>
      </div>

      {showAction && (
        <div className="ksp-shotlist-film-row-detail">
          {hasLegacyVietnamesePurpose && (
            <div
              className="ksp-shotlist-film-purpose"
              style={{
                background: "#FAEEDA",
                color: "#854F0B",
                padding: "6px 8px",
                borderRadius: 4,
                marginBottom: 6,
                fontSize: 11,
              }}
            >
              ⚠ Shot này có "purpose" tiếng Việt từ phiên bản cũ. Prompt EN có thể leak Vietnamese. Click <strong>✨ Sinh lại</strong> để AI sinh lại với <code>purposeEn</code>.
            </div>
          )}
          {shot.purposeVi && (
            <div className="ksp-shotlist-film-purpose">
              <span className="ksp-shotlist-film-detail-label">Mục đích:</span>{" "}
              {shot.purposeVi}
            </div>
          )}
          <textarea
            className="ksp-shotlist-film-action-edit"
            placeholder="Hành động cụ thể trong shot..."
            value={shot.actionVi || ""}
            onChange={(e) => onUpdate({ actionVi: e.target.value })}
            rows={2}
          />
          {/* r7.23: Audio direction (Omni only — optional) + Copy Omni quick button */}
          <div className="ksp-shotlist-film-omni-row">
            <input
              type="text"
              className="ksp-shotlist-film-audio-input"
              placeholder='🔊 Audio direction (Omni only, optional) — e.g. "soft footsteps + wind"'
              value={(shot as any).audioDirection || ""}
              onChange={(e) =>
                onUpdate({ audioDirection: e.target.value || undefined } as any)
              }
              maxLength={200}
            />
            <button
              type="button"
              className="ksp-shotlist-film-copy-omni-btn"
              onClick={async () => {
                try {
                  // Lazy load to keep main chunk lean
                  const { buildOmniShotPrompt, formatReferenceManifest } = await import(
                    "../engine/omniShotPromptBuilder"
                  );
                  // Build needs scene + cast + setting — pulled from store context
                  const proj = useAppStore.getState().currentProject;
                  if (!proj) return;
                  const setting = (proj as any).settingV2;
                  const film = (proj as any).filmV093 || (proj as any).film;
                  const cast = film?.characters ?? [];
                  // Find scene by walking shot → sceneId
                  const scene = (film?.script?.scenes ?? []).find((s: any) =>
                    (film?.shotsBySceneId?.[s.id] ?? []).some((sh: any) => sh.id === shot.id)
                  );
                  if (!setting) {
                    useAppStore.getState().showToast?.("Project setting missing", "error");
                    return;
                  }
                  const { promptText, references } = buildOmniShotPrompt({
                    shot,
                    scene,
                    cast,
                    setting,
                  });
                  const refManifest =
                    references.length > 0
                      ? `# REFERENCE IMAGES (upload to Gemini app in this order):\n${formatReferenceManifest(references)}\n\n`
                      : "";
                  await navigator.clipboard.writeText(refManifest + promptText);
                  useAppStore.getState().showToast?.(
                    `Copied Omni prompt (${references.length} refs needed)`,
                    "success"
                  );
                } catch (err) {
                  useAppStore.getState().showToast?.(
                    `Copy Omni lỗi: ${(err as Error).message}`,
                    "error"
                  );
                }
              }}
              title="📋 Copy Omni prompt (concise) — paste vào Gemini app"
            >
              📋 Omni 🎯
            </button>
          </div>
        </div>
      )}
    </>
  );
}
