/**
 * KSP Image v0.9.3-r3 — Film Idea + Script Section (Mockup 2 implementation)
 *
 * Single section combining Idea textarea + Stage 5 quick path Script generation.
 * Replaces deprecated FilmScriptSection.tsx.
 *
 * Spec per MOCKUPS_FILM.md Mockup 2:
 *   - Idea card (green border) — textarea cho idea VN
 *   - Script section (orange border) — AI generated full script
 *   - Provider toggle: Gemini Flash | OpenAI 4o
 *   - "AI viết Script từ idea" primary action
 *   - Scene cards với SFX/MUSIC/TRANSITION inline color-coded
 *   - Variation / Versions / Add Scene / Export PDF
 *   - r3 ships Stage 5 ONLY (1-cú generation). r7 adds multi-stage wizard.
 */

import React, { useState, useRef, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { Connector } from "./Editor";
import {
  ensureFilmData,
  setScript,
  clearScript,
  revertScriptToVersion,
  addEmptyScene,
  removeScene,
  updateSceneInScript,
  // r7 +
  setScriptStage,
  setScriptStructure,
  setScriptBeats,
  updateScriptBeat,
  addScriptBeat,
  removeScriptBeat,
  setScriptTwists,
  updateScriptTwist,
  removeScriptTwist,
  addScriptTwist,
  lockScriptTwists,
  setScriptIntermediateScenes,
  setScriptTargetSceneCount,
  // Sprint 1.0 r1
  updateScriptIntermediateScene,
  revertToStage,
  clearStageData,
  applySceneSplit,
  dismissSceneComplexityWarning,
  lockScriptScenes,
  // Sprint 1.0 r7
  applyBeatsAndPhysicalLock,
  setSceneBeats,
} from "../store/film_actions";
import {
  runStage1Structure,
  runStage2Beats,
  runStage3Twists,
  runStage4Scenes,
  runStage5FromStages,
  runSplitSceneSuggestion,
  type SceneSplitSuggestion,
  type FilmScriptProvider,
  // Sprint 1.0 r1
  runReannotateEmotions,
  // Sprint 1.0 r7
  runDetectBeatsForAllScenes,
  runDetectBeatsForScene,
} from "../engine/filmScriptStages";
// Preview Flow modal
import { PreviewFlowModal } from "./PreviewFlowModal";
import { PipelineCostTracker } from "./PipelineCostTracker";
import { startPipelineCostRun, completePipelineCostRun, abortPipelineCostRun } from "../store/pipelineCost_actions";
import type { NarrativeDirection, PreviewCache, ProjectV09Extensions } from "../types/project";
import type { PromptProject } from "../types/index";
// Scene shot count estimator + complexity classification
import {
  estimateSceneShotCount,
  classifySceneComplexity,
  type SceneComplexity,
} from "../engine/sceneShotEstimator";
import {
  FRAMEWORK_LABELS,
  type FilmScriptStage,
  type FilmStoryFramework,
  type FilmData,
} from "../types/film";
import type { FilmScript, FilmSceneScript, EmotionalTone, Beat } from "../types/project";
import {
  EMOTIONAL_TONE_LABELS,
  BEAT_TYPE_LABELS,
  clampTension,
  getTensionColor,
} from "../types/project";

// ============================================================================
// MAIN SECTION
// ============================================================================

export function FilmIdeaScriptSection() {
  const project = useAppStore((s) => s.currentProject);
  const updateProject = useAppStore((s) => s.updateCurrentProject);
  const showToast = useAppStore((s) => s.showToast);

  if (!project) return null;
  const film = ensureFilmData(project);
  const setting = (project as any).settingV2 as import("../types/project").ProjectSettingV2 | undefined;
  const idea = project.idea?.raw ?? "";
  const projectV09 = project as PromptProject & ProjectV09Extensions;
  const existingDirection = projectV09.narrativeDirection;
  const existingCache = projectV09.previewCache;

  const [isGenerating, setIsGenerating] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // Sprint 1.0 track which scenes currently have AI re-detecting beats (Bug 3 fix)
  const [detectingSceneIds, setDetectingSceneIds] = useState<Set<string>>(new Set());
  // Preview Flow modal state — lifted UP from ActiveStage1 to Idea section
  const [showPreviewFlow, setShowPreviewFlow] = useState(false);
  // r7.20b: collapsible direction summary state removed — panel moved to Preview Modal Step 6.
  // hold reference to active orchestrator so Cancel button can call abort()
  const orchestratorRef = useRef<import("../engine/autoChainOrchestrator").AutoChainOrchestrator | null>(null);
  // hold last used direction so retry-from-section can re-run without re-prompting Preview Flow
  const lastDirectionRef = useRef<import("../types/project").NarrativeDirection | null>(null);
  // r7.19: idea mismatch dismissal — user clicked "Giữ direction cũ" → suppress warning for this session.
  // Reset to false when direction changes (new direction approved or cleared).
  const [ideaMismatchDismissed, setIdeaMismatchDismissed] = useState(false);

  // r7.36 PROJECT ISOLATION: abort any running auto-chain when project id changes.
  // Without this, switching from project A (with running auto-chain) to project B
  // would let the orchestrator continue and call updateProject() — which now points
  // to project B! → data of project A would leak into project B's fields.
  useEffect(() => {
    return () => {
      // Cleanup runs both on unmount AND when project.id deps changes (before new effect)
      if (orchestratorRef.current) {
        orchestratorRef.current.abort();
        orchestratorRef.current = null;
      }
      // Close any open Preview Modal (data from project A no longer relevant)
      setShowPreviewFlow(false);
      // Reset session-only dismissal — fresh start per project
      setIdeaMismatchDismissed(false);
    };
  }, [project.id]);

  /**
   * r7.19: Detect when current idea text no longer matches the snapshot
   * captured at direction approval time. Normalized compare: trim + lowercase.
   * Older direction records (pre-r7.19) without ideaSnapshot field skip the
   * warning (treat as compatible — no backward-compat noise).
   */
  const ideaMismatch = (() => {
    if (!existingDirection || ideaMismatchDismissed) return false;
    const snapshot = existingDirection.ideaSnapshot;
    if (!snapshot) return false; // legacy record — no warning
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    return norm(idea) !== norm(snapshot);
  })();

  /**
   * Stop the currently running auto-chain orchestrator.
   * Cancellation is cooperative — orchestrator finishes the current section's
   * AI call (if any) then halts before next section. Already-spent AI calls
   * cannot be refunded.
   */
  function handleCancelAutoChain() {
    if (orchestratorRef.current) {
      orchestratorRef.current.abort();
      showToast("Đã dừng Auto-Chain. AI calls đã dùng không refund được.", "info");
    }
  }

  /**
   * Retry from a specific section after a JSON parse / AI error.
   * Preserves all completed sections — only re-runs the failed section
   * and everything downstream. Uses the last direction the user picked
   * via Preview Flow, so they don't have to re-confirm direction.
   */
  async function handleRetrySection(
    sectionId: import("../engine/autoChainOrchestrator").SectionId
  ) {
    const direction = lastDirectionRef.current;
    if (!direction) {
      showToast("Không có narrative direction để retry. Chạy lại từ đầu bằng 'Phân tích ý tưởng'.", "error");
      return;
    }
    const { AutoChainOrchestrator } = await import("../engine/autoChainOrchestrator");
    const orch = new AutoChainOrchestrator({
      getProject: () => useAppStore.getState().currentProject!,
      updateProject: (updater) => updateProject(updater),
      showToast,
    });
    orchestratorRef.current = orch;
    const unsubscribe = orch.subscribe((state) => setAutoChainState(state));
    try {
      setIsGenerating(true);
      await orch.retryFromSection(sectionId, direction);
    } catch (err) {
      console.error("[AutoChain retry] error:", err);
    } finally {
      unsubscribe();
      setIsGenerating(false);
      orchestratorRef.current = null;
    }
  }

  /**
   * Clear narrativeDirection + previewCache from project.
   * User confirmation required since this is destructive.
   * Does NOT clear downstream stage data (structure/beats/twists/scenes/script)
   * — user can re-run preview flow to overwrite, or manually edit stages.
   */
  function handleClearDirection() {
    const ok = window.confirm(
      "Xóa direction câu chuyện đã chốt?\n\nĐiều này KHÔNG xóa các stages đã sinh (Structure, Beats, Twists, Scenes, Script). Chỉ xóa 5 picks Preview Flow để có thể chạy lại với picks khác.\n\nClick OK để xóa, Cancel để giữ."
    );
    if (!ok) return;
    updateProject(() => ({
      narrativeDirection: undefined,
      previewCache: undefined,
    } as Partial<PromptProject>));
    // r7.19: reset mismatch dismissal — no direction means no warning to suppress
    setIdeaMismatchDismissed(false);
    showToast("Đã xóa direction. Click 'Analyze Idea' để phân tích lại.", "success");
  }
  // Auto-chain orchestrator state — from store (shared with Storyboard section)
  const autoChainState = useAppStore((s) => s.autoChainState);
  const setAutoChainState = useAppStore((s) => s.setAutoChainState);

  function handleSetIdea(newIdea: string) {
    updateProject({ idea: { raw: newIdea } } as any);
  }

  function handleOpenPreviewFlow() {
    if (!idea.trim()) {
      showToast("Hãy nhập idea trước khi phân tích", "info");
      return;
    }
    if (!setting) {
      showToast("Project setting chưa đầy đủ", "info");
      return;
    }
    // r8.1: no Cast step in Film mode — characters are derived by AI (character bible).

    // r7.33: Confirm dialog — user must acknowledge they'll need to complete all 6 steps
    // (no "Bỏ qua" button anymore). Skip confirm if user already has cached steps
    // (they're returning to flow they previously started — natural re-entry, no warning needed).
    const hasExistingCache = existingCache && Object.keys(existingCache).length > 0;
    if (!hasExistingCache) {
      const confirmed = window.confirm(
        "🎬 Mở 6-step wizard phân tích ý tưởng?\n\n" +
        "Bạn sẽ trả lời 6 câu hỏi về story structure, opening, character, twist, ending, review.\n\n" +
        "⚠️ Modal KHÔNG có nút Bỏ qua — bạn cần hoàn thành đủ 6 step để thoát.\n" +
        "(Cache lưu incrementally — nếu reload tab giữa chừng, không mất AI cost đã gen).\n\n" +
        "Tiếp tục?"
      );
      if (!confirmed) return;
    }

    // r7.20a: start new pipeline cost run — resets accumulated cost.
    // Pipeline begins when user opens Preview Modal; Preview Step AI calls
    // are counted as part of this run.
    updateProject((p) => startPipelineCostRun(p) as any);
    setShowPreviewFlow(true);
  }

  /**
   * r7.33: Step 6 "Lưu & Đóng" handler — save direction + cache, close modal.
   * Does NOT auto-run auto-chain. User must click "▶ START" button separately.
   * This gives user a chance to review the Direction Summary before paying AI cost.
   */
  function handlePreviewComplete(
    direction: import("../types/project").NarrativeDirection,
    finalCache: import("../types/project").PreviewCache
  ) {
    updateProject(() => ({
      narrativeDirection: direction,
      previewCache: finalCache,
    } as Partial<PromptProject>));
    setShowPreviewFlow(false);
    // r7.19: reset mismatch dismissal — new direction supersedes old snapshot warning
    setIdeaMismatchDismissed(false);
    showToast("✓ Direction đã lưu. Bấm START để chạy auto-chain.", "success");
  }

  function handlePreviewCancel() {
    // r7.33: This handler is now ONLY called via emergency exit paths
    // (component unmount, etc.) — the "Bỏ qua" button has been removed from UI.
    // Kept for backward compat with PreviewFlowModal's `onCancel` prop signature.
    setShowPreviewFlow(false);
  }

  /**
   * r7.33: START button handler — runs auto-chain with existing direction.
   * Called when user clicks "▶ START" in Idea section (after direction is saved).
   */
  async function handleStartAutoChain() {
    if (!existingDirection) {
      showToast("Chưa có direction. Bấm Analyze Idea trước.", "info");
      return;
    }
    await runAutoChain(existingDirection);
  }

  /**
   * r7.33: Preview button handler — re-open Preview Modal in Step 6 review state.
   * User can review picks + edit any step then re-save.
   */
  function handleReopenPreview() {
    if (!existingDirection) {
      showToast("Chưa có direction để preview", "info");
      return;
    }
    setShowPreviewFlow(true);
  }

  async function runAutoChain(direction: import("../types/project").NarrativeDirection) {
    lastDirectionRef.current = direction; // save for potential retry-from-section
    const { AutoChainOrchestrator } = await import("../engine/autoChainOrchestrator");
    const orch = new AutoChainOrchestrator({
      getProject: () => useAppStore.getState().currentProject!,
      updateProject: (updater) => updateProject(updater),
      showToast,
    });
    orchestratorRef.current = orch; // expose to Cancel button
    const unsubscribe = orch.subscribe((state) => setAutoChainState(state));
    try {
      setIsGenerating(true);
      await orch.start(direction);
      // r7.20a: mark pipeline cost run as completed (Storyboard reached)
      updateProject((p) => completePipelineCostRun(p as any) as any);
    } catch (err) {
      // Toast already emitted by orchestrator
      console.error("[AutoChain] error:", err);
      // r7.20a: mark pipeline cost run as aborted on error (kept costs accumulated)
      updateProject((p) => abortPipelineCostRun(p as any) as any);
    } finally {
      unsubscribe();
      setIsGenerating(false);
      orchestratorRef.current = null;
    }
  }

  return (
    <>
      {/* IDEA SECTION (Mockup 2 — green border) */}
      <section className="ksp-section ksp-idea-film">
        <header className="ksp-section-header">
          <span className="ksp-section-icon">💡</span>
          <h2 className="ksp-section-title">1. Ý TƯỞNG</h2>
        </header>

        <textarea
          className="ksp-textarea ksp-idea-film-textarea"
          placeholder="VD: Một con robot bị bỏ rơi trong rừng sau chiến tranh, tỉnh dậy sau 50 năm và kết bạn với một chú chim sẻ. Câu chuyện về việc tìm lại ý nghĩa sống..."
          value={idea}
          onChange={(e) => handleSetIdea(e.target.value)}
          rows={8}
        />

        {/* r7.19: Idea mismatch warning — direction was approved from a different idea text */}
        {existingDirection && ideaMismatch && (
          <div className="ksp-idea-mismatch-warning" role="alert">
            <div className="ksp-idea-mismatch-text">
              ⚠ Direction hiện tại được tạo từ idea cũ. Idea mới đã thay đổi — direction có thể không còn phù hợp.
            </div>
            <div className="ksp-idea-mismatch-actions">
              <button
                type="button"
                className="ksp-btn ksp-idea-mismatch-keep"
                onClick={() => setIdeaMismatchDismissed(true)}
                title="Giữ direction cũ — tiếp tục dùng dù idea đã đổi"
              >
                Giữ direction cũ
              </button>
              <button
                type="button"
                className="ksp-btn ksp-idea-mismatch-clear"
                onClick={handleClearDirection}
                title="Xóa direction — sẽ phải Analyze Idea lại với idea mới"
              >
                Xóa direction
              </button>
            </div>
          </div>
        )}

        {/* r7.33: 2-button UI when direction exists, else single Analyze Idea button.
            STATE MACHINE:
            - No direction → 1 button "🎬 Analyze Idea" (opens Preview Modal)
            - Has direction → 2 buttons:
              * [▶ START] (large, orange, primary) → runs auto-chain
              * [👁 Preview] (small, ghost) → re-opens Preview Modal at Step 6 review
            Logic gives user a chance to review Direction Summary BEFORE paying AI cost,
            and allows editing any step via Preview without losing other picks. */}
        {existingDirection ? (
          <div className="ksp-idea-direction-actions">
            <button
              type="button"
              className={`ksp-idea-start-btn${isGenerating ? " ksp-idea-start-btn-loading" : ""}`}
              onClick={handleStartAutoChain}
              disabled={isGenerating || !idea.trim() || !setting || (film.characters?.length ?? 0) === 0}
              title="Chạy auto-chain với direction đã lưu — Stages 1-5 + Analyze Scenes + Shot List + Storyboard"
            >
              {isGenerating ? "⏳ Đang chạy auto-chain..." : "▶ START"}
            </button>
            <button
              type="button"
              className="ksp-idea-preview-btn"
              onClick={handleReopenPreview}
              disabled={isGenerating}
              title="Mở lại Preview Modal — review Step 6 + edit từng step nếu cần"
            >
              👁 Preview
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`ksp-idea-analyze-btn${isGenerating ? " ksp-idea-analyze-btn-loading" : ""}`}
            onClick={handleOpenPreviewFlow}
            disabled={isGenerating || !idea.trim() || !setting || (film.characters?.length ?? 0) === 0}
          >
            {isGenerating
              ? "⏳ Analyzing..."
              : "🎬 Analyze Idea"}
          </button>
        )}

        {/* r7.20a: Pipeline cost tracker — only renders when project.pipelineCost exists */}
        <PipelineCostTracker />

        {/* r7.20b: Direction summary panel REMOVED from Section Ý tưởng.
            Moved to Preview Modal Step 6 (FinalReviewPanel) where review happens
            right before confirm — more natural in the modal flow.
            User can re-open Preview Modal anytime by clicking "Analyze Idea"
            (pre-fills with existing direction picks). */}

        {/* r7.15d-fix1: Floating Cancel button — visible only when auto-chain is running.
            Fixed bottom-right corner so it's always reachable while user scrolls. */}
        {autoChainState.isRunning && (
          <button
            type="button"
            className="ksp-autochain-cancel-floating"
            onClick={handleCancelAutoChain}
            title="Dừng Auto-Chain ngay lập tức (AI calls đã dùng không refund được)"
          >
            🛑 Stop Auto-Chain
          </button>
        )}

        {/* Preview Flow modal */}
        {showPreviewFlow && setting && (
          <PreviewFlowModal
            idea={idea}
            setting={setting}
            characters={film.characters}
            provider={(setting.aiProviders?.scriptWriter ?? "gemini-flash") as any}
            initialCache={existingCache}
            onComplete={handlePreviewComplete}
            onCancel={handlePreviewCancel}
            showToast={showToast}
            // r7.33: persist cache to Dexie after every successful AI gen — prevents AI cost
            // waste when user reloads tab mid-flow.
            onCachePersist={(newCache) => {
              updateProject({ previewCache: newCache } as any);
            }}
          />
        )}
      </section>

      {/* Connector Idea → Script (Mockup 2 spec) */}
      <Connector colorFrom="#1D9E75" colorTo="#D85A30" />

      {/* SCRIPT SECTION (Mockup new — orange border, stepper wizard) */}
      {(() => {
        // Script section animates when any of Stage 1-5 is generating
        const scriptStageStatuses: string[] = [
          autoChainState.sections["script-stage-1"]?.status,
          autoChainState.sections["script-stage-2"]?.status,
          autoChainState.sections["script-stage-3"]?.status,
          autoChainState.sections["script-stage-4"]?.status,
          autoChainState.sections["script-stage-5"]?.status,
        ].filter(Boolean) as string[];
        const isScriptGenerating = scriptStageStatuses.includes("generating");
        const scriptHasError = scriptStageStatuses.includes("error");
        const sectionClass = isScriptGenerating
          ? "ksp-section ksp-script-film ksp-autochain-generating"
          : scriptHasError
            ? "ksp-section ksp-script-film ksp-autochain-error"
            : "ksp-section ksp-script-film";
        return (
      <section className={sectionClass}>
        <header className="ksp-section-header">
          <span className="ksp-section-icon">📜</span>
          <h2 className="ksp-section-title">2. SCRIPT</h2>
          <span className="ksp-section-meta-stepper">
            {countCompletedStages(film, setting)}/{getEffectiveStageOrder(film, setting).length} stages
            {film.script && ` · ${film.script.scenes.length} scenes`}
          </span>
        </header>

        {/* NEW: Vertical stepper wizard — dialog-aware (skips dialogues when no_dialog) */}
        <ScriptStepperWizard
          film={film}
          idea={idea}
          setting={setting}
          isGenerating={isGenerating}
          onSetGenerating={setIsGenerating}
          onUpdateProject={updateProject}
          onShowToast={showToast}
          project={project}
          autoChainState={autoChainState}
          onRetrySection={handleRetrySection}
          hasLastDirection={!!lastDirectionRef.current}
        />

        {/* Footer info — progress meta */}
        <div className="ksp-script-stepper-footer">
          <span className="ksp-script-stepper-footer-icon">ⓘ</span>
          <span>Progress: {countCompletedStages(film, setting)}/{getEffectiveStageOrder(film, setting).length} stages · Sau khi xong → script feed vào Storyboard</span>
        </div>

        {/* Versions panel (common to both quick + multi-stage modes) */}
        {versionsOpen && film.script?.versions && film.script.versions.length > 0 && (
          <div className="ksp-script-film-versions">
            <h4>Past versions (newest first)</h4>
            <ol>
              {[...film.script.versions].reverse().map((v, revIdx) => {
                const origIdx = (film.script!.versions!.length - 1) - revIdx;
                const snap = v.scriptSnapshot;
                return (
                  <li key={v.id}>
                    <span>{snap.titleVi || snap.titleEn || v.label}</span>
                    <span className="ksp-script-film-versions-meta">
                      {snap.scenes.length} scenes · {new Date(v.timestamp).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      className="ksp-btn ksp-btn-sm ksp-btn-ghost"
                      onClick={() => {
                        if (confirm("Revert to this version? Current script sẽ archived.")) {
                          updateProject(revertScriptToVersion(project, origIdx));
                          showToast("Đã revert", "info");
                        }
                      }}
                    >
                      Revert
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Script content (common to both quick + multi-stage modes — B6 fix) */}
        {film.script && (
          <div className="ksp-script-film-content">
            <div className="ksp-script-film-meta">
              <div><strong>Title:</strong> {film.script.titleVi || film.script.titleEn}</div>
              <div><strong>Logline:</strong> {film.script.loglineVi || film.script.logline}</div>
            </div>

            {film.script.scenes.map((scene, idx) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                index={idx}
                isDetectingBeats={detectingSceneIds.has(scene.id)}
                onUpdate={(updates) =>
                  updateProject(updateSceneInScript(project, scene.id, updates))
                }
                onRemove={() => {
                  if (confirm(`Xóa scene ${scene.order}?`)) {
                    updateProject(removeScene(project, scene.id));
                  }
                }}
                onRedetectBeats={() => {
                  // Sprint 1.0 r7 J3 + (Bug 3): re-detect beats with loading state + toast feedback
                  const sceneProvider = (film.scriptProvider ?? "gemini-flash") as FilmScriptProvider;
                  setDetectingSceneIds((prev) => {
                    const next = new Set(prev);
                    next.add(scene.id);
                    return next;
                  });
                  showToast(`🔄 Đang phân tích beats cho Scene ${scene.order}...`, "info");
                  (async () => {
                    try {
                      const result = await runDetectBeatsForScene({
                        scene: scene as any,
                        provider: sceneProvider,
                      });
                      updateProject(
                        applyBeatsAndPhysicalLock(project, {
                          [scene.id]: result,
                        })
                      );
                      if (result.beats.length > 0) {
                        showToast(
                          `✅ Scene ${scene.order}: detected ${result.beats.length} beats`,
                          "success"
                        );
                      } else {
                        showToast(
                          `⚠ Scene ${scene.order}: AI returned 0 beats. Scene action quá ngắn?`,
                          "info"
                        );
                      }
                    } catch (err) {
                      console.error("Re-detect failed:", err);
                      showToast(
                        `❌ Scene ${scene.order} detection lỗi: ${(err as Error).message}`,
                        "error"
                      );
                    } finally {
                      setDetectingSceneIds((prev) => {
                        const next = new Set(prev);
                        next.delete(scene.id);
                        return next;
                      });
                    }
                  })();
                }}
              />
            ))}

            <div className="ksp-script-film-actions">
              <button
                type="button"
                className="ksp-btn ksp-btn-secondary ksp-btn-sm"
                onClick={() => updateProject(addEmptyScene(project))}
              >
                + Add Scene
              </button>
              <button
                type="button"
                className="ksp-btn ksp-btn-ghost ksp-btn-sm"
                disabled={isGenerating || !film.script || film.script.scenes.length === 0}
                onClick={async () => {
                  if (!film.script || film.script.scenes.length === 0) return;
                  const scriptScenes = film.script.scenes;
                  setIsGenerating(true);
                  try {
                    const annotations = await runReannotateEmotions({
                      scenes: scriptScenes.map((s) => ({
                        id: s.id,
                        order: s.order,
                        titleEn: s.titleEn,
                        titleVi: s.titleVi,
                        actionLinesEn: s.actionLinesEn,
                        actionLinesVi: s.actionLinesVi,
                        durationSeconds: s.durationSeconds,
                      })),
                      provider:
                        (film.scriptProvider ?? "gemini-flash") as FilmScriptProvider,
                    });
                    const count = Object.keys(annotations).length;
                    if (count === 0) {
                      showToast("AI không trả annotation nào — thử lại", "error");
                    } else {
                      updateProject((p) => {
                        let next = p;
                        for (const sceneId of Object.keys(annotations)) {
                          const patch = updateSceneInScript(next, sceneId, annotations[sceneId]);
                          next = { ...next, ...patch };
                        }
                        return next;
                      });
                      showToast(`Đã re-annotate ${count} phân cảnh`, "success");
                    }
                  } catch (err) {
                    showToast(`Re-annotate lỗi: ${(err as Error).message}`, "error");
                  } finally {
                    setIsGenerating(false);
                  }
                }}
                title="Sinh lại tension + cảm xúc cho tất cả phân cảnh (AI call nhỏ, ~$0)"
              >
                🎭 Re-annotate
              </button>
              <button
                type="button"
                className="ksp-btn ksp-btn-ghost ksp-btn-sm"
                onClick={() => setVersionsOpen(!versionsOpen)}
                disabled={(film.script.versions?.length ?? 0) === 0}
              >
                📚 Versions ({film.script.versions?.length ?? 0})
              </button>
              <button
                type="button"
                className="ksp-btn ksp-btn-ghost ksp-btn-sm"
                onClick={() => {
                  if (film.script) exportScriptAsText(film.script);
                  showToast("Đã download script.txt", "success");
                }}
                title="Export script as plain text (PDF defer 0.9.4)"
              >
                📥 Export .txt
              </button>
              <button
                type="button"
                className="ksp-btn ksp-btn-ghost ksp-btn-sm"
                onClick={() => {
                  if (confirm("Xóa toàn bộ script + versions?")) {
                    updateProject(clearScript(project));
                  }
                }}
              >
                🗑 Clear all
              </button>
            </div>

            <div className="ksp-script-film-feed-note">
              ⓘ Script feed: Storyboard (action lines → frames) · SFX list · Music briefs
            </div>
          </div>
        )}
      </section>
        );
      })()}
    </>
  );
}

// ============================================================================
// PACING BADGES (Sprint 1.0 r1 — Phase 1A)
// Reusable component for SceneCard + SceneCardWithWarning.
// Displays tension + emotion badges with click-to-edit popover.
// ============================================================================

interface PacingBadgesProps {
  tensionLevel?: number;
  emotionalTone?: EmotionalTone;
  /** Sprint 1.0 r7: scene beats for badge display + click-popover */
  beats?: Beat[];
  /* * Sprint 1.0 true when AI is currently detecting beats for this scene */
  isDetectingBeats?: boolean;
  /* * Sprint 1.0 callback to manually re-detect beats (for failed/empty scenes) */
  onRedetectBeats?: () => void;
  onUpdate: (updates: { tensionLevel?: number; emotionalTone?: EmotionalTone }) => void;
  /** Compact mode for SceneCardWithWarning (smaller header). */
  compact?: boolean;
}

function PacingBadges({
  tensionLevel,
  emotionalTone,
  beats,
  isDetectingBeats,
  onRedetectBeats,
  onUpdate,
  compact,
}: PacingBadgesProps) {
  const [openPopup, setOpenPopup] = useState<"tension" | "emotion" | "beats" | null>(null);

  const tension = clampTension(tensionLevel);
  const tensionColors = getTensionColor(tension);
  const hasTension = typeof tensionLevel === "number";
  const tone = emotionalTone ?? "neutral";
  const toneInfo = EMOTIONAL_TONE_LABELS[tone];
  const hasTone = emotionalTone !== undefined;
  const hasBeats = beats && beats.length > 0;

  return (
    <span className={`ksp-pacing-badges${compact ? " ksp-pacing-badges-compact" : ""}`}>
      <button
        type="button"
        className="ksp-pacing-badge ksp-pacing-tension"
        style={{
          background: hasTension ? tensionColors.bg : "#F1EFE8",
          color: hasTension ? tensionColors.color : "#888780",
        }}
        onClick={(e) => {
          e.stopPropagation();
          setOpenPopup(openPopup === "tension" ? null : "tension");
        }}
        title={hasTension ? `Tension ${tension}/10 — click chỉnh` : "Chưa annotate — click chỉnh tension"}
      >
        🔥 {hasTension ? `${tension}/10` : "·"}
      </button>
      <button
        type="button"
        className="ksp-pacing-badge ksp-pacing-emotion"
        style={{ background: toneInfo.bg, color: toneInfo.color }}
        onClick={(e) => {
          e.stopPropagation();
          setOpenPopup(openPopup === "emotion" ? null : "emotion");
        }}
        title={hasTone ? `Cảm xúc: ${toneInfo.vi} — click đổi` : "Chưa annotate — click chọn cảm xúc"}
      >
        {toneInfo.emoji} {hasTone ? toneInfo.vi : "·"}
      </button>
      {/* Sprint 1.0 r7: Beats badge — click to popover beats list.
          r7.1: shows loading icon when AI is detecting, retry button when 0 beats. */}
      <button
        type="button"
        className="ksp-pacing-badge ksp-pacing-beats"
        style={{
          background: isDetectingBeats ? "#534AB7" : hasBeats ? "#3B6D11" : "#F1EFE8",
          color: isDetectingBeats ? "#EAF3DE" : hasBeats ? "#EAF3DE" : "#888780",
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (isDetectingBeats) return;
          setOpenPopup(openPopup === "beats" ? null : "beats");
        }}
        title={
          isDetectingBeats
            ? "AI đang phân tích beats..."
            : hasBeats
            ? `${beats!.length} beats — click xem chi tiết`
            : "Chưa detect beats — click để xem hoặc tạo lại"
        }
      >
        {isDetectingBeats
          ? "⏳ Đang detect..."
          : hasBeats
          ? `🎯 ${beats!.length} beats`
          : "🎯 ·"}
      </button>

      {openPopup === "tension" && (
        <div
          className="ksp-pacing-popup"
          onClick={(e) => e.stopPropagation()}
        >
          <label className="ksp-pacing-popup-label">
            Tension level: <strong>{tension}/10</strong>
          </label>
          <input
            type="range"
            className="ksp-pacing-popup-slider"
            min={0}
            max={10}
            step={1}
            value={tension}
            onChange={(e) => onUpdate({ tensionLevel: parseInt(e.target.value, 10) })}
          />
          <div className="ksp-pacing-popup-hint">
            0-2 calm · 3-4 mild · 5-6 rising · 7-8 high · 9-10 climax
          </div>
          <div className="ksp-pacing-popup-actions">
            <button type="button" className="ksp-pacing-popup-btn" onClick={() => setOpenPopup(null)}>
              ✓ Xong
            </button>
          </div>
        </div>
      )}

      {openPopup === "beats" && (
        <div
          className="ksp-pacing-popup ksp-pacing-popup-beats"
          onClick={(e) => e.stopPropagation()}
        >
          <label className="ksp-pacing-popup-label">
            🎯 Atomic beats <span className="ksp-pacing-popup-sub">(scan từ scene action)</span>
          </label>
          {hasBeats ? (
            <ol className="ksp-pacing-popup-beats-list">
              {beats!.map((b) => {
                const typeInfo = BEAT_TYPE_LABELS[b.type];
                return (
                  <li key={b.id} className="ksp-pacing-popup-beat-item">
                    <span
                      className="ksp-pacing-popup-beat-type"
                      style={{ background: typeInfo.color + "33", color: typeInfo.color }}
                      title={typeInfo.vi}
                    >
                      {typeInfo.emoji}
                    </span>
                    <span className="ksp-pacing-popup-beat-label">
                      <strong>{b.order}.</strong> {b.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="ksp-pacing-popup-empty">
              Scene này chưa có beats. AI có thể đã thất bại hoặc scene action quá ngắn để phân tích.
            </div>
          )}
          <div className="ksp-pacing-popup-actions">
            {/* Sprint 1.0 r7.1: Retry button — visible for both empty AND populated scenes */}
            {onRedetectBeats && (
              <button
                type="button"
                className="ksp-pacing-popup-btn"
                style={{ background: "#534AB7", color: "#FAF8F2", marginRight: "auto" }}
                onClick={() => {
                  onRedetectBeats();
                  setOpenPopup(null);
                }}
                disabled={isDetectingBeats}
              >
                {isDetectingBeats ? "⏳ Đang detect..." : "🔄 Tạo lại beats"}
              </button>
            )}
            <button type="button" className="ksp-pacing-popup-btn" onClick={() => setOpenPopup(null)}>
              ✓ Đóng
            </button>
          </div>
        </div>
      )}

      {openPopup === "emotion" && (
        <div
          className="ksp-pacing-popup"
          onClick={(e) => e.stopPropagation()}
        >
          <label className="ksp-pacing-popup-label">Cảm xúc:</label>
          <div className="ksp-pacing-popup-emotions">
            {(Object.keys(EMOTIONAL_TONE_LABELS) as EmotionalTone[]).map((k) => {
              const info = EMOTIONAL_TONE_LABELS[k];
              const isActive = tone === k;
              return (
                <button
                  key={k}
                  type="button"
                  className="ksp-pacing-popup-emotion-chip"
                  data-active={isActive}
                  style={
                    isActive
                      ? { background: info.bg, color: info.color, borderColor: info.color }
                      : undefined
                  }
                  onClick={() => {
                    onUpdate({ emotionalTone: k });
                    setOpenPopup(null);
                  }}
                >
                  {info.emoji} {info.vi}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

// ============================================================================
// SCENE CARD (collapsible)
// ============================================================================

interface SceneCardProps {
  scene: FilmSceneScript;
  index: number;
  onUpdate: (updates: Partial<FilmSceneScript>) => void;
  onRemove: () => void;
  /** Sprint 1.0 r7 (J3): re-detect beats when scene action edited. */
  onRedetectBeats?: () => void;
  /* * Sprint 1.0 true when AI is currently detecting beats for this scene */
  isDetectingBeats?: boolean;
}

function SceneCard({ scene, index, onUpdate, onRemove, onRedetectBeats, isDetectingBeats }: SceneCardProps) {
  const [expanded, setExpanded] = useState(index === 0); // first scene expanded
  const [editingAction, setEditingAction] = useState(false);
  // Sprint 1.0 r7 (J3): track if user actually changed action to avoid spurious re-detect on click-out
  const [actionDirty, setActionDirty] = useState(false);

  const durationFmt = formatDuration(scene.durationSeconds);

  return (
    <div className="ksp-scene-card" data-expanded={expanded}>
      <div className="ksp-scene-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="ksp-scene-card-arrow">{expanded ? "▼" : "▶"}</span>
        <strong>Scene {scene.order}</strong>
        <span className="ksp-scene-card-settings">{scene.settings} — {durationFmt}</span>
        <button
          type="button"
          className="ksp-scene-card-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className="ksp-scene-card-body">
          {/* Title (EN/VI) */}
          <div className="ksp-scene-card-title">
            <em>{scene.titleVi || scene.titleEn}</em>
          </div>

          {/* Sprint 1.0 r1 (Phase 1A): pacing badges; r7: + beats badge; r7.1: + loading + retry */}
          <div className="ksp-scene-card-pacing">
            <PacingBadges
              tensionLevel={scene.tensionLevel}
              emotionalTone={scene.emotionalTone}
              beats={(scene as any).beats}
              isDetectingBeats={isDetectingBeats}
              onRedetectBeats={onRedetectBeats}
              onUpdate={(updates) => onUpdate(updates)}
            />
          </div>

          {/* Action lines (editable) */}
          <div className="ksp-scene-card-block">
            <label className="ksp-scene-card-block-label">Action:</label>
            {editingAction ? (
              <textarea
                className="ksp-textarea ksp-textarea-sm"
                value={scene.actionLinesVi || scene.actionLinesEn}
                onChange={(e) => {
                  onUpdate({ actionLinesVi: e.target.value });
                  setActionDirty(true);
                }}
                onBlur={() => {
                  setEditingAction(false);
                  // Sprint 1.0 r7 J3: auto-trigger beats re-detection in background.
                  // Only if user actually changed text (not just clicked then clicked out).
                  if (actionDirty && onRedetectBeats) {
                    onRedetectBeats();
                    setActionDirty(false);
                  }
                }}
                autoFocus
                rows={3}
              />
            ) : (
              <p
                className="ksp-scene-card-action"
                onClick={() => setEditingAction(true)}
              >
                {scene.actionLinesVi || scene.actionLinesEn}
              </p>
            )}
          </div>

          {/* Dialog */}
          {scene.dialog && scene.dialog.length > 0 && (
            <div className="ksp-scene-card-block ksp-scene-block-dialog">
              <label className="ksp-scene-card-block-label">Dialog:</label>
              {scene.dialog.map((d, di) => (
                <div key={di} className="ksp-scene-card-dialog-line">
                  <strong>{d.characterName}:</strong> {d.lineVi || d.lineEn}
                  {d.parenthetical && (
                    <span className="ksp-scene-card-paren"> ({d.parenthetical})</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* SFX */}
          {scene.sfx && scene.sfx.length > 0 && (
            <div className="ksp-scene-card-block ksp-scene-block-sfx">
              <label className="ksp-scene-card-block-label">SFX:</label>
              <span>{scene.sfx.join(" · ")}</span>
            </div>
          )}

          {/* Music brief */}
          {scene.musicBrief && (
            <div className="ksp-scene-card-block ksp-scene-block-music">
              <label className="ksp-scene-card-block-label">Music:</label>
              <span>{scene.musicBrief}</span>
            </div>
          )}

          {/* Transition */}
          {scene.transitionToNext && (
            <div className="ksp-scene-card-block ksp-scene-block-transition">
              <label className="ksp-scene-card-block-label">Transition:</label>
              <span>{scene.transitionToNext}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m${s.toString().padStart(2, "0")}s` : `${m}m`;
}

function exportScriptAsText(script: FilmScript) {
  const lines: string[] = [];
  lines.push(`TITLE: ${script.titleVi || script.titleEn}`);
  lines.push(`LOGLINE: ${script.loglineVi || script.logline}`);
  lines.push(`SYNOPSIS: ${script.synopsisVi || script.synopsisEn}`);
  lines.push("");
  lines.push("=".repeat(60));
  lines.push("");
  for (const scene of script.scenes) {
    lines.push(`SCENE ${scene.order}: ${scene.titleVi || scene.titleEn}`);
    lines.push(`Setting: ${scene.settings} — ${formatDuration(scene.durationSeconds)}`);
    lines.push("");
    lines.push(`Action:`);
    lines.push(scene.actionLinesVi || scene.actionLinesEn);
    lines.push("");
    if (scene.dialog && scene.dialog.length > 0) {
      lines.push("Dialog:");
      for (const d of scene.dialog) {
        lines.push(`  ${d.characterName}: ${d.lineVi || d.lineEn}`);
      }
      lines.push("");
    }
    if (scene.sfx && scene.sfx.length > 0) {
      lines.push(`SFX: ${scene.sfx.join(" · ")}`);
    }
    if (scene.musicBrief) {
      lines.push(`Music: ${scene.musicBrief}`);
    }
    if (scene.transitionToNext) {
      lines.push(`Transition: ${scene.transitionToNext}`);
    }
    lines.push("");
    lines.push("-".repeat(40));
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(script.titleVi || script.titleEn || "script").replace(/[^a-z0-9]/gi, "_")}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// STEPPER WIZARD HELPERS
// ============================================================================

// r7.18: Stage order is structure → twists → beats → scenes → dialogues.
// Twists run BEFORE Beats because they're locked from Preview Modal's
// Step 4 multi-pick (SKIP AI), then passed to Beats stage as prelockedTwists
// (AI CALL). Backend autoChainOrchestrator already uses this ordering at the
// script-stage-2 / script-stage-3 SectionIds; frontend matches here.
const STAGE_ORDER: FilmScriptStage[] = ["structure", "twists", "beats", "scenes", "dialogues"];

/**
 * Resolve the effective stage list based on project setting.
 * When setting.dialog === "no_dialog", skip Stage 5 "dialogues" (Voice + SFX + Music).
 * - Stepper UI uses this to render only relevant stages
 * - countCompletedStages + getCurrentActiveStage use this for accurate progress
 */
function getEffectiveStageOrder(film: FilmData | undefined, setting: any): FilmScriptStage[] {
  const noDialog = setting?.dialog === "no_dialog";
  return noDialog
    ? STAGE_ORDER.filter((s) => s !== "dialogues")
    : STAGE_ORDER;
}

const STAGE_LABELS: Record<FilmScriptStage, string> = {
  structure: "Khung kể chuyện (Structure)",
  beats: "Cột mốc câu chuyện (Beats)",
  twists: "Tình tiết bất ngờ (Twists)",
  scenes: "Phân cảnh (Scenes)",
  dialogues: "Lời thoại + SFX + Nhạc",
};

const STAGE_NUMBERS: Record<FilmScriptStage, string> = {
  structure: "1",
  twists: "2",
  beats: "3",
  scenes: "4",
  dialogues: "5",
};

const STAGE_HINTS: Record<FilmScriptStage, string> = {
  structure: "AI chọn khung kể chuyện (3-act, Hero's Journey, Save the Cat, Kishōtenketsu)",
  beats: "AI sinh 4-15 cột mốc narrative (Mở đầu, Khủng hoảng, Cao trào, Kết...)",
  twists: "AI gợi ý 1-3 tình tiết bất ngờ để câu chuyện hấp dẫn hơn",
  scenes: "Gộp các beats + twists đã chọn thành scenes cụ thể",
  dialogues: "AI fill lời thoại, SFX, brief nhạc nền, transition cho từng scene",
};

function countCompletedStages(film: FilmData, setting?: any): number {
  // use isStageDone as single source of truth so footer count matches
  // stepper green-check display (including Hướng B lock semantics for twists).
  // skip "dialogues" stage when setting.dialog === "no_dialog"
  const effectiveStages = getEffectiveStageOrder(film, setting);
  let count = 0;
  for (const s of effectiveStages) {
    if (isStageDone(film, s)) count++;
  }
  return count;
}

function isStageDone(film: FilmData, stage: FilmScriptStage): boolean {
  if (stage === "structure") return !!film.scriptStructure;
  if (stage === "beats") return !!film.scriptBeats?.length;
  if (stage === "twists") {
    // explicit lock via "Tiếp: ④ Phân cảnh →" button.
    if (film.scriptTwistsLocked === true) return true;
    // Backward-compat: projects don't have scriptTwistsLocked. If they
    // have twists data AND any downstream stage has data, the user must have
    // already passed Stage 2 (Twists) → treat as locked.
    if (
      film.scriptTwists !== undefined &&
      (film.scriptIntermediateScenes !== undefined || film.script !== undefined)
    ) {
      return true;
    }
    return false;
  }
  if (stage === "scenes") {
    // (parallel Twist lock): explicit lock via "Tiếp: ⑤ Lời thoại →" button.
    if (film.scriptScenesLocked === true) return true;
    // Backward-compat: projects don't have scriptScenesLocked. If they
    // have scenes data AND downstream script (dialogues) has data, the user
    // must have already passed Stage 4 → treat as locked.
    if (
      film.scriptIntermediateScenes !== undefined &&
      film.scriptIntermediateScenes.length > 0 &&
      film.script !== undefined
    ) {
      return true;
    }
    return false;
  }
  if (stage === "dialogues") return !!film.script;
  return false;
}

function getCurrentActiveStage(film: FilmData): FilmScriptStage | null {
  // fix: If user explicitly navigated to a stage AND that stage is not
  // yet done, honor the navigation. If the stage IS done, ignore it (treat
  // as "all done, no active") — handles existing projects where scriptStage
  // was persisted as "dialogues" but Stage 5 is actually complete.
  if (film.scriptStage && !isStageDone(film, film.scriptStage)) {
    return film.scriptStage;
  }
  // Otherwise, first incomplete stage
  for (const s of STAGE_ORDER) {
    if (!isStageDone(film, s)) return s;
  }
  // All done → no active stage (all render done previews including Stage 5)
  return null;
}

function isStageLocked(film: FilmData, stage: FilmScriptStage): boolean {
  // A stage is locked if any upstream stage is not done
  const idx = STAGE_ORDER.indexOf(stage);
  for (let i = 0; i < idx; i++) {
    if (!isStageDone(film, STAGE_ORDER[i])) return true;
  }
  return false;
}

// ============================================================================
// MAIN STEPPER WIZARD
// ============================================================================

interface ScriptStepperWizardProps {
  film: FilmData;
  idea: string;
  setting: import("../types/project").ProjectSettingV2 | undefined;
  isGenerating: boolean;
  onSetGenerating: (v: boolean) => void;
  onUpdateProject: ReturnType<typeof useAppStore.getState>["updateCurrentProject"];
  onShowToast: ReturnType<typeof useAppStore.getState>["showToast"];
  project: any;
  /* * auto-chain state for per-stage status badges + border animation. */
  autoChainState?: import("../engine/autoChainOrchestrator").AutoChainState;
  /* * retry handler when a stage fails — resumes auto-chain from that section */
  onRetrySection?: (
    sectionId: import("../engine/autoChainOrchestrator").SectionId
  ) => Promise<void>;
  /* * whether last narrative direction is available for retry (gates the button) */
  hasLastDirection?: boolean;
}

function ScriptStepperWizard({
  film,
  idea,
  setting,
  isGenerating,
  onSetGenerating,
  onUpdateProject,
  onShowToast,
  project,
  autoChainState,
  onRetrySection,
  hasLastDirection,
}: ScriptStepperWizardProps) {
  if (!setting) return <p style={{ padding: 12, color: "#888", fontSize: 11 }}>Project setting missing.</p>;

  const activeStage = getCurrentActiveStage(film);

  // Provider read from global settings.aiProviders.scriptWriter
  const provider: FilmScriptProvider =
    (setting.aiProviders?.scriptWriter ?? "gemini-flash") as FilmScriptProvider;

  // Guard for any AI run
  function guardInputs(): boolean {
    if (!idea.trim()) {
      onShowToast("Hãy nhập Idea trước khi chạy wizard", "info");
      return false;
    }
    return true;
  }

  // Revert if downstream has data (with confirm)
  function safeNavToStage(target: FilmScriptStage) {
    const targetIdx = STAGE_ORDER.indexOf(target);
    const downstream = STAGE_ORDER.slice(targetIdx + 1);
    const hasDownstreamData = downstream.some((s) => isStageDone(film, s));
    const targetIsDone = isStageDone(film, target);

    if (hasDownstreamData) {
      // Clicking a done stage that has downstream data → revert + clear downstream
      const ok = confirm(
        `Revert về stage "${STAGE_LABELS[target]}"?\n\nCác stage phía sau (${downstream
          .map((s) => STAGE_LABELS[s])
          .join(", ")}) sẽ bị clear và bạn cần re-run lại.\n\nClick OK để revert, Cancel để stay.`
      );
      if (!ok) return;
      onUpdateProject((p) => revertToStage(p, target));
    } else if (targetIsDone) {
      // fix: Clicking the LAST stage that is done (no downstream) — e.g., Stage 5
      // when script exists. To re-enter active mode for regen, clear this stage's data.
      const ok = confirm(
        `Regen stage "${STAGE_LABELS[target]}"?\n\nDữ liệu hiện tại của stage này sẽ bị clear để regen lại từ đầu.\n\nClick OK để tiếp tục, Cancel để giữ nguyên.`
      );
      if (!ok) return;
      onUpdateProject((p) => clearStageData(p, target));
    } else {
      onUpdateProject((p) => setScriptStage(p, target));
    }
  }

  // r7.18: Map FilmScriptStage → auto-chain SectionId. Twists are at script-stage-2
  // (SKIP AI, locked from Preview Modal Step 4), Beats are at script-stage-3 (AI CALL
  // with prelockedTwists). This matches autoChainOrchestrator.ts backend ordering.
  const stageToSectionId: Record<FilmScriptStage, import("../engine/autoChainOrchestrator").SectionId> = {
    structure: "script-stage-1",
    twists: "script-stage-2",
    beats: "script-stage-3",
    scenes: "script-stage-4",
    dialogues: "script-stage-5",
  };

  return (
    <div className="ksp-script-stepper">
      {/* r7.15d-fix1: Skip "dialogues" stage when setting.dialog === "no_dialog" */}
      {getEffectiveStageOrder(film, setting).map((stage) => (
        <StepperStageCard
          key={stage}
          stage={stage}
          film={film}
          isActive={stage === activeStage}
          isLocked={isStageLocked(film, stage)}
          isGenerating={isGenerating}
          provider={provider}
          onClick={() => safeNavToStage(stage)}
          renderActiveContent={() => (
            <StageActiveContent
              stage={stage}
              film={film}
              idea={idea}
              setting={setting}
              provider={provider}
              isGenerating={isGenerating}
              onSetGenerating={onSetGenerating}
              onUpdateProject={onUpdateProject}
              onShowToast={onShowToast}
              project={project}
              guardInputs={guardInputs}
            />
          )}
          onUpdateProject={onUpdateProject}
          project={project}
          autoChainStatus={autoChainState?.sections[stageToSectionId[stage]]?.status}
          autoChainError={autoChainState?.sections[stageToSectionId[stage]]?.errorMessage}
          onRetry={
            onRetrySection && hasLastDirection
              ? () => onRetrySection(stageToSectionId[stage])
              : undefined
          }
        />
      ))}
    </div>
  );
}

// ============================================================================
// STEPPER STAGE CARD (1 row per stage with 3 states: done / active / pending)
// ============================================================================

interface StepperStageCardProps {
  stage: FilmScriptStage;
  film: FilmData;
  isActive: boolean;
  isLocked: boolean;
  isGenerating: boolean;
  provider: FilmScriptProvider;
  onClick: () => void;
  renderActiveContent: () => React.ReactNode;
  onUpdateProject: ReturnType<typeof useAppStore.getState>["updateCurrentProject"];
  project: any;
  /* * optional auto-chain section status for this stage. */
  autoChainStatus?: import("../engine/autoChainOrchestrator").JobStatus;
  /* * error message from orchestrator (shown when status === "error") */
  autoChainError?: string;
  /* * retry handler — when defined and status === "error", shows Retry button */
  onRetry?: () => void;
}

function StepperStageCard({
  stage,
  film,
  isActive,
  isLocked,
  isGenerating,
  onClick,
  renderActiveContent,
  autoChainStatus,
  autoChainError,
  onRetry,
}: StepperStageCardProps) {
  const done = isStageDone(film, stage);

  // State class
  let stateClass = "ksp-step-pending";
  if (done && !isActive) stateClass = "ksp-step-done";
  if (isActive) stateClass = "ksp-step-active";
  if (isLocked && !done && !isActive) stateClass = "ksp-step-locked";

  // border animation moved to parent SECTION — cards only show status badges

  return (
    <div className={`ksp-step-card ${stateClass}`}>
      {/* Circle indicator */}
      <button
        type="button"
        className="ksp-step-indicator"
        onClick={() => !isLocked && onClick()}
        disabled={isLocked}
        title={isLocked ? "Stage phía trước chưa xong" : `Stage ${STAGE_NUMBERS[stage]}: ${STAGE_LABELS[stage]}`}
      >
        {done && !isActive ? "✓" : STAGE_NUMBERS[stage]}
      </button>

      {/* Content area */}
      <div className="ksp-step-body">
        <div className="ksp-step-header">
          <span className="ksp-step-label">{STAGE_LABELS[stage]}</span>
          {/* r7.15a auto-chain status badge takes priority (non-idle states only) */}
          {autoChainStatus === "generating" && (
            <span className="ksp-stage-status-badge ksp-stage-status-badge-generating">⚡ generating</span>
          )}
          {autoChainStatus === "queued" && (
            <span className="ksp-stage-status-badge ksp-stage-status-badge-queued">⏳ queued</span>
          )}
          {autoChainStatus === "error" && (
            <span className="ksp-stage-status-badge ksp-stage-status-badge-error">⚠ error</span>
          )}
          {/* Legacy pills (when auto-chain is idle for this section) */}
          {(!autoChainStatus || autoChainStatus === "idle" || autoChainStatus === "done") && done && !isActive && (
            <span className="ksp-step-status-pill ksp-step-status-done">done</span>
          )}
          {(!autoChainStatus || autoChainStatus === "idle") && isActive && !done && (
            <span className="ksp-step-status-pill ksp-step-status-active">đang làm</span>
          )}
        </div>

        {/* Error message + retry button when section failed in auto-chain */}
        {autoChainStatus === "error" && (
          <div className="ksp-stage-error-panel">
            {autoChainError && (
              <div className="ksp-stage-error-message" title={autoChainError}>
                ⚠ {autoChainError.length > 200 ? autoChainError.slice(0, 200) + "..." : autoChainError}
              </div>
            )}
            {onRetry && !isGenerating && (
              <button
                type="button"
                className="ksp-stage-retry-btn"
                onClick={onRetry}
                title="Resume auto-chain từ section này (preserve sections đã done trước đó)"
              >
                🔄 Thử lại section này
              </button>
            )}
          </div>
        )}

        {/* Active state: full panel — Pending: hint — Done: preview */}
        {isActive ? (
          renderActiveContent()
        ) : done ? (
          <StageDonePreview stage={stage} film={film} onClick={onClick} />
        ) : (
          <div className="ksp-step-hint">{STAGE_HINTS[stage]}</div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DONE PREVIEW (collapsed view per stage)
// ============================================================================

function StageDonePreview({
  stage,
  film,
  onClick,
}: {
  stage: FilmScriptStage;
  film: FilmData;
  onClick: () => void;
}) {
  let preview: React.ReactNode = null;

  if (stage === "structure" && film.scriptStructure) {
    preview = (
      <>
        <span className="ksp-step-preview-pill">
          {FRAMEWORK_LABELS[film.scriptStructure.framework].name}
        </span>
        <div className="ksp-step-preview-text">{film.scriptStructure.contentVi || film.scriptStructure.contentEn}</div>
      </>
    );
  } else if (stage === "beats" && film.scriptBeats?.length) {
    preview = (
      <>
        <span className="ksp-step-preview-pill">{film.scriptBeats.length} milestones</span>
        <ul className="ksp-step-preview-list">
          {film.scriptBeats.slice(0, 3).map((b) => (
            <li key={b.id}>
              <span className="ksp-step-preview-list-num">{b.order}.</span> {b.title}
            </li>
          ))}
          {film.scriptBeats.length > 3 && (
            <li className="ksp-step-preview-list-more">+ {film.scriptBeats.length - 3} beats khác...</li>
          )}
        </ul>
      </>
    );
  } else if (stage === "twists" && film.scriptTwists !== undefined) {
    const accepted = film.scriptTwists.filter((t) => t.accepted === true).length;
    const total = film.scriptTwists.length;
    preview = (
      <>
        <span className="ksp-step-preview-pill">
          {accepted}/{total} accepted
        </span>
        {total === 0 ? (
          <div className="ksp-step-preview-text">No twists generated yet</div>
        ) : (
          <ul className="ksp-step-preview-list">
            {film.scriptTwists.slice(0, 2).map((t, i) => (
              <li key={t.id} className={t.accepted === false ? "ksp-step-preview-list-rejected" : ""}>
                <span className="ksp-step-preview-list-num">{i + 1}.</span> {t.description.slice(0, 60)}
                {t.description.length > 60 ? "..." : ""}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else if (stage === "scenes" && film.scriptIntermediateScenes?.length) {
    const totalSec = film.scriptIntermediateScenes.reduce((s, sc) => s + sc.durationSeconds, 0);
    preview = (
      <>
        <span className="ksp-step-preview-pill">
          {film.scriptIntermediateScenes.length} scenes · {totalSec}s
        </span>
        <ul className="ksp-step-preview-list">
          {film.scriptIntermediateScenes.slice(0, 3).map((s) => (
            <li key={s.id}>
              <span className="ksp-step-preview-list-num">{s.order}.</span> {s.titleVi || s.titleEn}
            </li>
          ))}
        </ul>
      </>
    );
  } else if (stage === "dialogues" && film.script) {
    preview = (
      <>
        <span className="ksp-step-preview-pill">{film.script.scenes.length} scenes ready</span>
        <div className="ksp-step-preview-text">
          {film.script.titleVi || film.script.titleEn}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="ksp-step-preview-content">{preview}</div>
      <div className="ksp-step-done-actions">
        <button
          type="button"
          className="ksp-step-done-btn"
          onClick={onClick}
          title="Click để mở lại stage này (downstream stages sẽ clear)"
        >
          🔄 Regen / Edit
        </button>
      </div>
    </>
  );
}

// ============================================================================
// ACTIVE STAGE CONTENT (per-stage full UI)
// ============================================================================

interface StageActiveContentProps {
  stage: FilmScriptStage;
  film: FilmData;
  idea: string;
  setting: import("../types/project").ProjectSettingV2;
  provider: FilmScriptProvider;
  isGenerating: boolean;
  onSetGenerating: (v: boolean) => void;
  onUpdateProject: ReturnType<typeof useAppStore.getState>["updateCurrentProject"];
  onShowToast: ReturnType<typeof useAppStore.getState>["showToast"];
  project: any;
  guardInputs: () => boolean;
}

function StageActiveContent(props: StageActiveContentProps) {
  const { stage } = props;
  if (stage === "structure") return <ActiveStage1 {...props} />;
  if (stage === "beats") return <ActiveStage2 {...props} />;
  if (stage === "twists") return <ActiveStage3 {...props} />;
  if (stage === "scenes") return <ActiveStage4 {...props} />;
  return <ActiveStage5 {...props} />;
}

// --- STAGE 1 active: Structure ----------------------------------------------
function ActiveStage1({
  film,
  idea,
  setting,
  provider,
  isGenerating,
  onSetGenerating,
  onUpdateProject,
  onShowToast,
  project,
  guardInputs,
}: StageActiveContentProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pickedFramework, setPickedFramework] = useState<FilmStoryFramework | undefined>(
    film.scriptStructure?.framework
  );
  const projectV09 = project as PromptProject & ProjectV09Extensions;
  const existingDirection = projectV09.narrativeDirection;

  async function runStage1Core(
    preferred?: FilmStoryFramework,
    direction?: import("../types/project").NarrativeDirection
  ) {
    onSetGenerating(true);
    try {
      const result = await runStage1Structure({
        idea,
        setting,
        characters: film.characters,
        preferredFramework: preferred,
        provider,
        narrativeDirection: direction,
      });
      onUpdateProject((p) => setScriptStructure(p, result));
      onShowToast(
        direction
          ? `Đã chọn khung: ${FRAMEWORK_LABELS[result.framework].name} (theo direction)`
          : `Đã chọn khung: ${FRAMEWORK_LABELS[result.framework].name}`,
        "success"
      );
      onUpdateProject((p) => setScriptStage(p, "beats"));
    } catch (err) {
      onShowToast(`Stage 1 lỗi: ${(err as Error).message}`, "error");
    } finally {
      onSetGenerating(false);
    }
  }

  async function handleManualRerun(preferred?: FilmStoryFramework) {
    if (!guardInputs()) return;
    if (film.scriptStructure) {
      const ok = confirm(
        `Stage 1 đã có data. Sinh lại sẽ tốn 1 AI call và clear các stage phía sau.\n\nClick OK để tiếp tục, Cancel để giữ nguyên.`
      );
      if (!ok) return;
    }
    runStage1Core(preferred, existingDirection);
  }

  return (
    <div className="ksp-step-active-body">
      <p className="ksp-step-active-hint">
        AI chọn khung kể chuyện và viết overview 3-5 câu. Mặc định 3-Act. Nhấn "Chọn manual" để tự chọn.
      </p>

      <button
        type="button"
        className="ksp-step-advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? "▼" : "▶"} Chọn manual khung kể chuyện
      </button>

      {showAdvanced && (
        <div className="ksp-step-framework-list">
          {(Object.keys(FRAMEWORK_LABELS) as FilmStoryFramework[]).map((fw) => (
            <label key={fw} className="ksp-step-framework-row">
              <input
                type="radio"
                name={`framework-${film.characters[0]?.id ?? "x"}`}
                value={fw}
                checked={pickedFramework === fw}
                onChange={() => setPickedFramework(fw)}
                className="ksp-step-framework-radio"
              />
              <div className="ksp-step-framework-text">
                <strong>{FRAMEWORK_LABELS[fw].name}</strong>
                <p>{FRAMEWORK_LABELS[fw].description}</p>
              </div>
            </label>
          ))}
        </div>
      )}

      <button
        type="button"
        className="ksp-step-primary-btn"
        disabled={isGenerating}
        onClick={() => handleManualRerun(pickedFramework)}
      >
        {isGenerating
          ? "⏳ Đang chọn khung..."
          : film.scriptStructure
            ? "🔄 Regen Stage 1 (sinh lại)"
            : existingDirection
              ? "✨ AI chọn khung (theo direction)"
              : "✨ AI chọn khung kể chuyện"}
      </button>

      {!existingDirection && !film.scriptStructure && (
        <p className="ksp-step-active-hint" style={{ marginTop: 8, fontSize: 11, color: "#888" }}>
          ⓘ Click "🎬 Phân tích ý tưởng" trong section Ý TƯỞNG để chạy auto-chain (Preview Flow + tất cả stages tự động).
        </p>
      )}
    </div>
  );
}

// --- STAGE 2 active: Beats --------------------------------------------------
function ActiveStage2({
  film,
  idea,
  setting,
  provider,
  isGenerating,
  onSetGenerating,
  onUpdateProject,
  onShowToast,
  project,
  guardInputs,
}: StageActiveContentProps) {
  const beats = film.scriptBeats ?? [];

  async function handleRun() {
    if (!guardInputs()) return;
    if (!film.scriptStructure) {
      onShowToast("Stage 1 (Structure) chưa xong", "info");
      return;
    }
    // cache confirm
    if (beats.length > 0) {
      const ok = confirm(
        `Stage 3 (Beats) đã có ${beats.length} cột mốc. Sinh lại sẽ tốn 1 AI call và clear các stage phía sau.\n\nClick OK để tiếp tục, Cancel để giữ nguyên.`
      );
      if (!ok) return;
    }
    onSetGenerating(true);
    try {
      const result = await runStage2Beats({
        idea,
        setting,
        characters: film.characters,
        structure: film.scriptStructure,
        provider,
      });
      onUpdateProject((p) => setScriptBeats(p, result));
      onShowToast(`Đã sinh ${result.length} cột mốc`, "success");
    } catch (err) {
      onShowToast(`Stage 3 (Beats) lỗi: ${(err as Error).message}`, "error");
    } finally {
      onSetGenerating(false);
    }
  }

  return (
    <div className="ksp-step-active-body">
      <p className="ksp-step-active-hint">
        AI sinh các cột mốc câu chuyện theo khung đã chọn. Nhấn vào từng beat để chỉnh sửa.
      </p>

      <button
        type="button"
        className="ksp-step-primary-btn"
        disabled={isGenerating}
        onClick={handleRun}
      >
        {isGenerating
          ? "⏳ Đang sinh các cột mốc..."
          : beats.length
          ? "✨ Sinh lại cột mốc"
          : "✨ AI sinh cột mốc câu chuyện"}
      </button>

      {beats.length > 0 && (
        <>
          <div className="ksp-step-beats-list">
            {beats.map((b) => (
              <div key={b.id} className="ksp-step-beat-row">
                <span className="ksp-step-beat-order">{b.order}</span>
                <div className="ksp-step-beat-content">
                  <input
                    type="text"
                    className="ksp-input ksp-input-sm ksp-step-beat-title"
                    value={b.title}
                    onChange={(e) =>
                      onUpdateProject((p) => updateScriptBeat(p, b.id, { title: e.target.value }))
                    }
                    placeholder="Tiêu đề beat"
                  />
                  <textarea
                    className="ksp-step-beat-desc"
                    value={b.description}
                    onChange={(e) =>
                      onUpdateProject((p) =>
                        updateScriptBeat(p, b.id, { description: e.target.value })
                      )
                    }
                    placeholder="Mô tả những gì xảy ra ở beat này..."
                    rows={2}
                  />
                </div>
                <button
                  type="button"
                  className="ksp-step-beat-remove"
                  onClick={() => {
                    if (confirm("Xóa beat này?"))
                      onUpdateProject((p) => removeScriptBeat(p, b.id));
                  }}
                  title="Xóa beat"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="ksp-step-active-row">
            <button
              type="button"
              className="ksp-step-secondary-btn"
              onClick={() => {
                onUpdateProject((p) =>
                  addScriptBeat(p, {
                    title: "Beat mới",
                    description: "Mô tả những gì xảy ra.",
                  })
                );
              }}
            >
              + Thêm beat
            </button>
            <button
              type="button"
              className="ksp-step-primary-btn ksp-step-primary-btn-sm"
              onClick={() => onUpdateProject((p) => setScriptStage(p, "twists"))}
            >
              Tiếp: ③ Twists →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- STAGE 3 active: Twists -------------------------------------------------
function ActiveStage3({
  film,
  idea,
  setting,
  provider,
  isGenerating,
  onSetGenerating,
  onUpdateProject,
  onShowToast,
  project,
  guardInputs,
}: StageActiveContentProps) {
  const twists = film.scriptTwists ?? [];
  const beats = film.scriptBeats ?? [];
  // editable twists state — track which twist is being edited inline
  // (click description → textarea autoFocus, blur → save + exit edit mode).
  const [editingTwistId, setEditingTwistId] = useState<string | null>(null);
  const [twistDraft, setTwistDraft] = useState("");
  // manual "add twist" form — open beat picker before creating
  const [addBeatId, setAddBeatId] = useState<string | null>(null);

  async function handleRun() {
    if (!guardInputs()) return;
    // r7.18 tech debt: manual Twists regen still requires beats. Auto-chain
    // path SKIPS this and pulls twists from direction.step4_midpointTwist
    // (locked at Stage 2). Manual regen here is legacy fallback only — keep
    // beats gate so it doesn't break old projects. Refactor in future sprint.
    if (!film.scriptStructure || beats.length === 0) {
      onShowToast("Stage 3 (Beats) chưa xong — manual Twists regen cần Beats trước. Auto-chain dùng direction.", "info");
      return;
    }
    // cache confirm
    if (twists.length > 0) {
      const ok = confirm(
        `Stage 2 (Twists) đã có ${twists.length} tình tiết. Sinh lại sẽ tốn 1 AI call và clear lại accept/reject.\n\nClick OK để tiếp tục, Cancel để giữ nguyên.`
      );
      if (!ok) return;
    }
    onSetGenerating(true);
    try {
      const result = await runStage3Twists({
        idea,
        setting,
        characters: film.characters,
        structure: film.scriptStructure,
        beats,
        provider,
      });
      onUpdateProject((p) => setScriptTwists(p, result));
      onShowToast(`Đã gợi ý ${result.length} tình tiết`, "success");
    } catch (err) {
      onShowToast(`Stage 2 (Twists) lỗi: ${(err as Error).message}`, "error");
    } finally {
      onSetGenerating(false);
    }
  }

  // blur-to-save handler. Only commit if description actually changed.
  function commitTwistEdit(twistId: string, original: string) {
    const trimmed = twistDraft;
    if (trimmed !== original) {
      onUpdateProject((p) => updateScriptTwist(p, twistId, { description: trimmed }));
    }
    setEditingTwistId(null);
  }

  function handleRemoveTwist(twistId: string, descPreview: string) {
    const preview = descPreview.length > 40 ? descPreview.slice(0, 40) + "…" : descPreview;
    if (!confirm(`Xóa tình tiết "${preview || "(trống)"}" ?`)) return;
    onUpdateProject((p) => removeScriptTwist(p, twistId));
    if (editingTwistId === twistId) setEditingTwistId(null);
  }

  function handleAddNewTwist() {
    if (!addBeatId || beats.length === 0) return;
    onUpdateProject((p) => addScriptTwist(p, addBeatId, ""));
    onShowToast("Đã thêm tình tiết mới — click vào text để viết", "success");
    setAddBeatId(null);
  }

  return (
    <div className="ksp-step-active-body">
      <p className="ksp-step-active-hint">
        AI gợi ý 1-3 tình tiết bất ngờ để câu chuyện hấp dẫn hơn. Click vào mô tả để chỉnh sửa (blur để lưu). Chấp nhận ✓ / từ chối ✗ / xóa ✕ từng cái.
      </p>

      <button
        type="button"
        className="ksp-step-primary-btn"
        disabled={isGenerating}
        onClick={handleRun}
      >
        {isGenerating
          ? "⏳ Đang gợi ý tình tiết..."
          : twists.length
          ? "✨ Gợi ý lại tình tiết"
          : "✨ AI gợi ý tình tiết bất ngờ"}
      </button>

      {twists.length > 0 && (
        <>
          <div className="ksp-step-twists-list">
            {twists.map((t, i) => {
              const beat = beats.find((b) => b.id === t.beatId);
              const isEditing = editingTwistId === t.id;
              return (
                <div
                  key={t.id}
                  className={`ksp-step-twist-card ${
                    t.accepted === true ? "accepted" : t.accepted === false ? "rejected" : ""
                  }`}
                >
                  <div className="ksp-step-twist-header">
                    <strong>Tình tiết {i + 1}</strong>
                    <span className="ksp-step-twist-beat">
                      gắn vào Beat {beat?.order ?? "?"}: {beat?.title ?? "(?)"}
                    </span>
                    <button
                      type="button"
                      className="ksp-step-twist-remove-btn"
                      onClick={() => handleRemoveTwist(t.id, t.description)}
                      title="Xóa tình tiết này"
                      aria-label="Xóa tình tiết"
                    >
                      ✕
                    </button>
                  </div>
                  {isEditing ? (
                    <textarea
                      className="ksp-step-twist-edit"
                      autoFocus
                      value={twistDraft}
                      onChange={(e) => setTwistDraft(e.target.value)}
                      onBlur={() => commitTwistEdit(t.id, t.description)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setEditingTwistId(null); // discard draft
                        }
                      }}
                      placeholder="Mô tả tình tiết bất ngờ..."
                      rows={3}
                    />
                  ) : (
                    <p
                      className="ksp-step-twist-desc ksp-step-twist-desc-editable"
                      onClick={() => {
                        setTwistDraft(t.description);
                        setEditingTwistId(t.id);
                      }}
                      title="Click để chỉnh sửa"
                    >
                      {t.description.trim() ? (
                        t.description
                      ) : (
                        <em className="ksp-step-twist-desc-empty">
                          (Trống — click để viết tình tiết)
                        </em>
                      )}
                    </p>
                  )}
                  <div className="ksp-step-twist-actions">
                    <button
                      type="button"
                      className={`ksp-step-twist-btn ${t.accepted === true ? "active-accept" : ""}`}
                      onClick={() => onUpdateProject((p) => updateScriptTwist(p, t.id, { accepted: true }))}
                    >
                      ✓ Chấp nhận
                    </button>
                    <button
                      type="button"
                      className={`ksp-step-twist-btn ${t.accepted === false ? "active-reject" : ""}`}
                      onClick={() => onUpdateProject((p) => updateScriptTwist(p, t.id, { accepted: false }))}
                    >
                      ✗ Từ chối
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* r7.6: + Add new twist with beat picker */}
          {beats.length > 0 && (
            addBeatId === null ? (
              <button
                type="button"
                className="ksp-step-twist-add-btn"
                onClick={() => setAddBeatId(beats[0].id)}
              >
                + Thêm tình tiết mới
              </button>
            ) : (
              <div className="ksp-step-twist-add-form">
                <label className="ksp-step-twist-add-label">Gắn vào beat:</label>
                <select
                  className="ksp-select ksp-select-sm"
                  value={addBeatId}
                  onChange={(e) => setAddBeatId(e.target.value)}
                >
                  {beats.map((b) => (
                    <option key={b.id} value={b.id}>
                      Beat {b.order}: {b.title}
                    </option>
                  ))}
                </select>
                <div className="ksp-step-twist-add-actions">
                  <button
                    type="button"
                    className="ksp-btn ksp-btn-primary ksp-btn-sm"
                    onClick={handleAddNewTwist}
                  >
                    Tạo
                  </button>
                  <button
                    type="button"
                    className="ksp-btn ksp-btn-ghost ksp-btn-sm"
                    onClick={() => setAddBeatId(null)}
                  >
                    Hủy
                  </button>
                </div>
              </div>
            )
          )}

          <button
            type="button"
            className="ksp-step-primary-btn"
            onClick={() =>
              onUpdateProject((p) => {
                // lock twists + advance stage in one update.
                // Compose: apply lock first, then setScriptStage on locked project.
                const lockPatch = lockScriptTwists(p);
                const pLocked = { ...p, ...lockPatch };
                return setScriptStage(pLocked, "scenes");
              })
            }
          >
            Tiếp: ④ Phân cảnh →
          </button>
        </>
      )}
    </div>
  );
}

// --- STAGE 4 active: Scenes (preliminary) ------------------------------------
function ActiveStage4({
  film,
  idea,
  setting,
  provider,
  isGenerating,
  onSetGenerating,
  onUpdateProject,
  onShowToast,
  project,
  guardInputs,
}: StageActiveContentProps) {
  const interScenes = film.scriptIntermediateScenes ?? [];
  const beats = film.scriptBeats ?? [];
  const totalSecondsTarget = (setting.durationMinutes ?? 5) * 60;
  const suggestedSceneCount = Math.max(4, Math.round(totalSecondsTarget / 75));
  const targetSceneCount = film.scriptTargetSceneCount;

  async function handleRun() {
    if (!guardInputs()) return;
    if (!film.scriptStructure || beats.length === 0) {
      onShowToast("Stage 3 (Beats) chưa xong", "info");
      return;
    }
    // cache confirm
    if (interScenes.length > 0) {
      const ok = confirm(
        `Stage 4 đã có ${interScenes.length} phân cảnh. Sinh lại sẽ tốn 1 AI call và clear Stage 5 (lời thoại).\n\nClick OK để tiếp tục, Cancel để giữ nguyên.`
      );
      if (!ok) return;
    }
    onSetGenerating(true);
    try {
      const acceptedTwists = (film.scriptTwists ?? []).filter((t) => t.accepted === true);
      // pass narrativeDirection from project (if user completed Preview Flow)
      const projectV09 = project as PromptProject & ProjectV09Extensions;
      const narrativeDirection = projectV09.narrativeDirection;
      const result = await runStage4Scenes({
        idea,
        setting,
        characters: film.characters,
        structure: film.scriptStructure,
        beats,
        acceptedTwists,
        provider,
        targetSceneCount,
        narrativeDirection,
      });
      onUpdateProject((p) => setScriptIntermediateScenes(p, result));
      onShowToast(
        narrativeDirection
          ? `Đã sinh ${result.length} phân cảnh (theo Preview Flow direction)`
          : `Đã sinh ${result.length} phân cảnh`,
        "success"
      );
    } catch (err) {
      onShowToast(`Stage 4 lỗi: ${(err as Error).message}`, "error");
    } finally {
      onSetGenerating(false);
    }
  }

  const totalSec = interScenes.reduce((s, sc) => s + sc.durationSeconds, 0);

  return (
    <div className="ksp-step-active-body">
      <p className="ksp-step-active-hint">
        Gộp các beats + tình tiết đã chọn thành phân cảnh cụ thể (bối cảnh + action + thời lượng).
      </p>

      {/* Target scene count control */}
      <div className="ksp-step-scene-count-control">
        <label className="ksp-step-scene-count-label">
          Số lượng phân cảnh mong muốn:
        </label>
        <div className="ksp-step-scene-count-row">
          <input
            type="number"
            min={2}
            max={50}
            step={1}
            className="ksp-step-scene-count-input"
            value={targetSceneCount ?? ""}
            placeholder={`Auto (gợi ý ${suggestedSceneCount})`}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "") {
                onUpdateProject((p) => setScriptTargetSceneCount(p, undefined));
              } else {
                const n = parseInt(val, 10);
                if (!isNaN(n) && n >= 2 && n <= 50) {
                  onUpdateProject((p) => setScriptTargetSceneCount(p, n));
                }
              }
            }}
          />
          {targetSceneCount !== undefined && (
            <button
              type="button"
              className="ksp-step-scene-count-clear"
              onClick={() => onUpdateProject((p) => setScriptTargetSceneCount(p, undefined))}
              title="Reset về auto"
            >
              ✕ Auto
            </button>
          )}
        </div>
        <div className="ksp-step-scene-count-hint">
          Phim {setting.durationMinutes ?? 5} phút · AI gợi ý {suggestedSceneCount} phân cảnh.
          {" "}Bỏ trống để AI tự quyết, hoặc nhập số cụ thể để có chi tiết hơn.
        </div>
      </div>

      <button
        type="button"
        className="ksp-step-primary-btn"
        disabled={isGenerating}
        onClick={handleRun}
      >
        {isGenerating
          ? "⏳ Đang sinh phân cảnh..."
          : interScenes.length
          ? "✨ Sinh lại phân cảnh"
          : "✨ AI sinh phân cảnh"}
      </button>

      {interScenes.length > 0 && (
        <>
          <div className="ksp-step-scenes-list">
            {interScenes.map((s) => (
              <SceneCardWithWarning
                key={s.id}
                scene={s}
                beats={beats}
                provider={provider}
                onUpdateProject={onUpdateProject}
                onShowToast={onShowToast}
              />
            ))}
          </div>
          <div className="ksp-step-active-row">
            <span className="ksp-step-scenes-summary">
              Tổng: <strong>{totalSec}s</strong> ({Math.round(totalSec / 60)} phút) · {interScenes.length} phân cảnh
            </span>
            <button
              type="button"
              className="ksp-step-secondary-btn ksp-step-secondary-btn-sm"
              disabled={isGenerating}
              onClick={async () => {
                if (interScenes.length === 0) return;
                onSetGenerating(true);
                try {
                  const annotations = await runReannotateEmotions({
                    scenes: interScenes.map((s) => ({
                      id: s.id,
                      order: s.order,
                      titleEn: s.titleEn,
                      titleVi: s.titleVi,
                      actionLinesEn: s.actionLinesEn,
                      actionLinesVi: s.actionLinesVi,
                      durationSeconds: s.durationSeconds,
                    })),
                    provider,
                  });
                  const count = Object.keys(annotations).length;
                  if (count === 0) {
                    onShowToast("AI không trả annotation nào — thử lại", "error");
                  } else {
                    onUpdateProject((p) => {
                      let next = p;
                      for (const sceneId of Object.keys(annotations)) {
                        const patch = updateScriptIntermediateScene(next, sceneId, annotations[sceneId]);
                        next = { ...next, ...patch };
                      }
                      return next;
                    });
                    onShowToast(`Đã re-annotate ${count} phân cảnh`, "success");
                  }
                } catch (err) {
                  onShowToast(`Re-annotate lỗi: ${(err as Error).message}`, "error");
                } finally {
                  onSetGenerating(false);
                }
              }}
              title="Sinh lại tension + cảm xúc cho tất cả phân cảnh (AI call nhỏ, ~$0)"
            >
              🎭 Re-annotate
            </button>
            <button
              type="button"
              className="ksp-step-primary-btn ksp-step-primary-btn-sm"
              onClick={() =>
                onUpdateProject((p) => {
                  // (parallel Twist lock): lock scenes + advance in one update.
                  const lockPatch = lockScriptScenes(p);
                  const pLocked = { ...p, ...lockPatch };
                  return setScriptStage(pLocked, "dialogues");
                })
              }
            >
              Tiếp: ⑤ Lời thoại →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// -- Stage 4 Scene Card with complexity warning -------------------------
function SceneCardWithWarning({
  scene,
  beats,
  provider,
  onUpdateProject,
  onShowToast,
}: {
  scene: import("../types/film").FilmScriptIntermediateScene;
  beats: import("../types/film").FilmScriptBeat[];
  provider: FilmScriptProvider;
  onUpdateProject: (fn: (p: any) => any) => void;
  onShowToast: (msg: string, type?: "info" | "success" | "error") => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [splitSuggestion, setSplitSuggestion] = React.useState<SceneSplitSuggestion | null>(null);
  const [isLoadingSplit, setIsLoadingSplit] = React.useState(false);

  const estimatedShots = estimateSceneShotCount(scene);
  const complexity = classifySceneComplexity(estimatedShots);
  const dismissed = scene.complexityWarningDismissed === true;
  const showWarning = complexity !== "ok" && !dismissed;

  async function handleRequestSplit() {
    setIsLoadingSplit(true);
    try {
      const suggestion = await runSplitSceneSuggestion({ scene, beats, provider });
      setSplitSuggestion(suggestion);
    } catch (err) {
      onShowToast(`Lỗi gợi ý tách scene: ${(err as Error).message}`, "error");
    } finally {
      setIsLoadingSplit(false);
    }
  }

  function handleConfirmSplit() {
    if (!splitSuggestion) return;
    onUpdateProject((p) =>
      applySceneSplit(p, scene.id, splitSuggestion.subScenes[0], splitSuggestion.subScenes[1])
    );
    onShowToast(`Đã tách "${scene.titleVi || scene.titleEn}" thành 2 sub-scenes`, "success");
    setSplitSuggestion(null);
    setExpanded(false);
  }

  function handleDismiss() {
    onUpdateProject((p) => dismissSceneComplexityWarning(p, scene.id));
    setExpanded(false);
    onShowToast("Đã giữ nguyên scene. Storyboard sẽ dùng grid lớn hơn (4×3 / 4×4).", "info");
  }

  return (
    <div className="ksp-step-scene-card">
      <div className="ksp-step-scene-header">
        <strong>Cảnh {scene.order}</strong>
        <span className="ksp-step-scene-title">{scene.titleVi || scene.titleEn}</span>
        <span className="ksp-step-scene-duration">{scene.durationSeconds}s</span>
        {showWarning && (
          <button
            type="button"
            className="ksp-step-scene-warn-badge"
            onClick={() => setExpanded((e) => !e)}
            title={
              complexity === "over_hard"
                ? `Ước tính ${estimatedShots} shots — VƯỢT cap 16. Khuyến cáo tách scene.`
                : `Ước tính ${estimatedShots} shots — vượt sweet spot 9.`
            }
          >
            ⚠ ~{estimatedShots} shots {expanded ? "▲" : "▼"}
          </button>
        )}
      </div>
      {/* Sprint 1.0 r1 (Phase 1A): pacing badges for intermediate scenes */}
      <div className="ksp-step-scene-pacing">
        <PacingBadges
          tensionLevel={scene.tensionLevel}
          emotionalTone={scene.emotionalTone}
          onUpdate={(updates) => onUpdateProject((p) => updateScriptIntermediateScene(p, scene.id, updates))}
          compact
        />
      </div>
      <div className="ksp-step-scene-settings">{scene.settings}</div>
      <div className="ksp-step-scene-action">{scene.actionLinesVi || scene.actionLinesEn}</div>

      {expanded && showWarning && (
        <div className="ksp-step-scene-warn-panel">
          <p className="ksp-step-scene-warn-hint">
            {complexity === "over_hard"
              ? `Scene này quá phức tạp (${estimatedShots} shots ước tính, cap cứng = 16). Khuyến cáo tách thành 2 sub-scenes để giữ chất lượng cinematic.`
              : `Scene này vượt sweet spot 9 shots (ước tính ${estimatedShots}). Storyboard sẽ phải dùng grid lớn hơn (cell size giảm). Chọn:`}
          </p>

          {!splitSuggestion && (
            <div className="ksp-step-scene-warn-actions">
              <button
                type="button"
                className="ksp-step-primary-btn ksp-step-primary-btn-sm"
                disabled={isLoadingSplit}
                onClick={handleRequestSplit}
              >
                {isLoadingSplit ? "⏳ AI đang gợi ý..." : "🪓 Tách thành 2 scenes"}
              </button>
              <button
                type="button"
                className="ksp-step-secondary-btn ksp-step-secondary-btn-sm"
                onClick={handleDismiss}
              >
                ✔ Giữ nguyên (grid lớn hơn)
              </button>
              <button
                type="button"
                className="ksp-step-secondary-btn ksp-step-secondary-btn-sm"
                onClick={() => setExpanded(false)}
              >
                ✕ Hủy
              </button>
            </div>
          )}

          {splitSuggestion && (
            <div className="ksp-step-scene-split-preview">
              <p className="ksp-step-scene-split-reason">
                <strong>💡 Lý do tách:</strong> {splitSuggestion.reasonVi}
              </p>
              <div className="ksp-step-scene-split-sub">
                <strong>Sub-scene 1 ({splitSuggestion.subScenes[0].durationSeconds}s):</strong>
                <div>{splitSuggestion.subScenes[0].titleVi}</div>
                <div className="ksp-step-scene-split-action">
                  {splitSuggestion.subScenes[0].actionLinesVi}
                </div>
              </div>
              <div className="ksp-step-scene-split-sub">
                <strong>Sub-scene 2 ({splitSuggestion.subScenes[1].durationSeconds}s):</strong>
                <div>{splitSuggestion.subScenes[1].titleVi}</div>
                <div className="ksp-step-scene-split-action">
                  {splitSuggestion.subScenes[1].actionLinesVi}
                </div>
              </div>
              <div className="ksp-step-scene-warn-actions">
                <button
                  type="button"
                  className="ksp-step-primary-btn ksp-step-primary-btn-sm"
                  onClick={handleConfirmSplit}
                >
                  ✓ Đồng ý tách
                </button>
                <button
                  type="button"
                  className="ksp-step-secondary-btn ksp-step-secondary-btn-sm"
                  onClick={() => setSplitSuggestion(null)}
                >
                  ↺ Gợi ý lại
                </button>
                <button
                  type="button"
                  className="ksp-step-secondary-btn ksp-step-secondary-btn-sm"
                  onClick={() => {
                    setSplitSuggestion(null);
                    setExpanded(false);
                  }}
                >
                  ✕ Hủy
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- STAGE 5 active: Dialogues ----------------------------------------------
function ActiveStage5({
  film,
  idea,
  setting,
  provider,
  isGenerating,
  onSetGenerating,
  onUpdateProject,
  onShowToast,
  project,
  guardInputs,
}: StageActiveContentProps) {
  async function handleRun() {
    if (!guardInputs()) return;
    if (
      !film.scriptStructure ||
      !film.scriptBeats?.length ||
      !film.scriptIntermediateScenes?.length
    ) {
      onShowToast("Stage 1-4 chưa xong — vui lòng quay lại stage trước", "info");
      return;
    }
    // cache confirm
    if (film.script) {
      const ok = confirm(
        `Stage 5 đã có script với ${film.script.scenes.length} cảnh. Sinh lại sẽ tốn 1 AI call và overwrite script hiện tại (version cũ được archive).\n\nClick OK để tiếp tục, Cancel để giữ nguyên.`
      );
      if (!ok) return;
    }
    onSetGenerating(true);
    try {
      const acceptedTwists = (film.scriptTwists ?? []).filter((t) => t.accepted === true);
      // r8.1: manual path — build the character bible first if the project has none.
      let characters = film.characters;
      if (!characters.some((c) => c.name && c.description)) {
        const { generateCharacterBible } = await import("../engine/characterBible");
        characters = await generateCharacterBible({
          idea,
          setting,
          structure: film.scriptStructure,
          scenes: film.scriptIntermediateScenes,
          provider,
        });
        const { setCharacters } = await import("../store/film_actions");
        onUpdateProject((p) => setCharacters(p, characters));
      }
      const newScript = await runStage5FromStages({
        idea,
        setting,
        characters,
        structure: film.scriptStructure,
        beats: film.scriptBeats,
        acceptedTwists,
        intermediateScenes: film.scriptIntermediateScenes,
        provider,
      });
      onUpdateProject((p) => setScript(p, newScript));
      onShowToast(`Đã viết script ${newScript.scenes.length} cảnh — tiếp theo là Shot List`, "success");

      // Sprint 1.0 r7 (Q-A): Auto-detect beats + physical consistency lock for all scenes.
      // Runs in background — user can proceed without waiting. Toast notifies completion.
      // Failure is non-blocking: beats stay undefined, UI shows "·" placeholder in badge.
      // Sprint 1.0 (Bug 2 fix): track failures per-scene + warn user with retry option.
      (async () => {
        try {
          onShowToast(`🎯 Đang phân tích beats cho ${newScript.scenes.length} scenes...`, "info");
          const bulkResult = await runDetectBeatsForAllScenes({
            scenes: newScript.scenes,
            provider,
          });
          onUpdateProject((p) => applyBeatsAndPhysicalLock(p, bulkResult.results));
          const totalBeats = Object.values(bulkResult.results).reduce(
            (sum, r) => sum + (r.beats?.length ?? 0),
            0
          );
          const scenesWithLock = Object.values(bulkResult.results).filter(
            (r) => !!r.physicalConsistencyLockEn
          ).length;
          const failedCount = bulkResult.failedSceneIds.length;
          const emptyCount = bulkResult.emptySceneIds.length;
          if (failedCount > 0 || emptyCount > 0) {
            // Partial success — warn user with detail
            const sceneOrderOf = (id: string) =>
              newScript.scenes.find((s) => s.id === id)?.order ?? "?";
            const failedOrders = bulkResult.failedSceneIds.map(sceneOrderOf).join(", ");
            const emptyOrders = bulkResult.emptySceneIds.map(sceneOrderOf).join(", ");
            const detail = [
              failedCount > 0 && `${failedCount} scene lỗi (${failedOrders})`,
              emptyCount > 0 && `${emptyCount} scene trống beats (${emptyOrders})`,
            ]
              .filter(Boolean)
              .join(" · ");
            onShowToast(
              `⚠ Beats: ${totalBeats}/${
                newScript.scenes.length * 8
              } target. ${detail}. Click badge "🎯" trên Scene Card để retry.`,
              "info"
            );
          } else {
            onShowToast(
              `✅ Đã detect ${totalBeats} beats trên ${newScript.scenes.length} scenes${
                scenesWithLock > 0 ? ` + physical lock cho ${scenesWithLock} scenes` : ""
              }`,
              "success"
            );
          }
        } catch (err) {
          onShowToast(`Beats detection lỗi (không blocking): ${(err as Error).message}`, "info");
        }
      })();
    } catch (err) {
      onShowToast(`Stage 5 lỗi: ${(err as Error).message}`, "error");
    } finally {
      onSetGenerating(false);
    }
  }

  return (
    <div className="ksp-step-active-body">
      <p className="ksp-step-active-hint">
        Tầng cuối — AI điền lời thoại, SFX, brief nhạc nền, transition cho từng phân cảnh dựa trên các bước trên.
      </p>

      <button
        type="button"
        className="ksp-step-primary-btn"
        disabled={isGenerating}
        onClick={handleRun}
      >
        {isGenerating
          ? "⏳ Đang viết lời thoại..."
          : film.script
          ? "✨ Viết lại lời thoại"
          : "✨ AI viết lời thoại + SFX + nhạc"}
      </button>
    </div>
  );
}
