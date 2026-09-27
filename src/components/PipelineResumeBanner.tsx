/**
 * KSP Image — Pipeline abort recovery banner (r7.36 rewrite)
 *
 * Banner hiện ONLY khi auto-chain bị abort/error (user_cancelled hoặc error throw).
 * KHÔNG hiện khi user chỉ chạy partial pipeline bình thường (đến Shot List rồi dừng).
 * KHÔNG hiện khi user đã dismiss (X) — persist vào project.autoChainAbort.dismissedByUser.
 *
 * Visibility (single source of truth):
 *   - SHOW if project.autoChainAbort truthy AND dismissedByUser !== true
 *   - HIDE otherwise (no abort recorded, user dismissed, or no project)
 *
 * Lifecycle:
 *   - Orchestrator sets project.autoChainAbort = {section, reason, ...} on cancel/error
 *   - Orchestrator clears project.autoChainAbort = null on successful complete
 *   - User clicks "Continue" → retryFromSection() → on success clears flag
 *   - User clicks X → sets dismissedByUser = true (banner won't re-appear)
 */

import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { getSectionLabel, isKnownSectionId } from "../engine/pipelineProgress";
import type { AutoChainAbortRecord } from "../types/project";

export function PipelineResumeBanner() {
  const project = useAppStore((s) => s.currentProject);
  const autoChainState = useAppStore((s) => s.autoChainState);
  const updateProject = useAppStore((s) => s.updateCurrentProject);
  const showToast = useAppStore((s) => s.showToast);
  const setAutoChainState = useAppStore((s) => s.setAutoChainState);
  const [isResuming, setIsResuming] = useState(false);

  // r7.36: single source of truth — only abort record matters
  const abort = project ? ((project as any).autoChainAbort as AutoChainAbortRecord | null | undefined) : null;
  const narrativeDirection = project ? (project as any).narrativeDirection : null;

  // Hide if no project, no abort record, user dismissed, or auto-chain currently running
  if (!project) return null;
  if (!abort) return null;
  if (abort.dismissedByUser) return null;
  if (autoChainState.isRunning) return null;
  if (!narrativeDirection) return null; // need direction to retry
  if (!isKnownSectionId(abort.abortedAtSection)) return null; // r8.0: legacy "grid-build" abort — stage removed

  async function handleResume() {
    if (!abort || !narrativeDirection) return;
    setIsResuming(true);
    try {
      const { AutoChainOrchestrator } = await import("../engine/autoChainOrchestrator");
      const orch = new AutoChainOrchestrator({
        getProject: () => useAppStore.getState().currentProject!,
        updateProject: (updater) => updateProject(updater),
        showToast,
      });
      const unsubscribe = orch.subscribe((state) => setAutoChainState(state));
      try {
        await orch.retryFromSection(abort.abortedAtSection as any, narrativeDirection);
        // Success cleared by orchestrator (sets autoChainAbort = null)
      } finally {
        unsubscribe();
      }
    } catch (err) {
      console.error("[PipelineResumeBanner] resume error:", err);
      // Orchestrator already set new autoChainAbort with error reason on throw
    } finally {
      setIsResuming(false);
    }
  }

  function handleDismiss() {
    // r7.36: persist dismiss to project DB (survives reload)
    updateProject({
      autoChainAbort: { ...abort, dismissedByUser: true },
    } as any);
  }

  const isError = abort.reason === "error";
  const reasonLabel = isError
    ? "Auto-chain bị lỗi"
    : "Auto-chain bị dừng";
  const iconText = isError ? "⚠️" : "⏸️";

  return (
    <div className={`ksp-pipeline-resume-banner${isError ? " ksp-pipeline-resume-banner-error" : ""}`} role="status">
      <div className="ksp-pipeline-resume-icon">{iconText}</div>
      <div className="ksp-pipeline-resume-body">
        <div className="ksp-pipeline-resume-title">{reasonLabel}</div>
        <div className="ksp-pipeline-resume-detail">
          → Bị dừng tại: <strong>{getSectionLabel(abort.abortedAtSection as any)}</strong>
          {isError && abort.errorMessage && (
            <>
              <br />
              <span className="ksp-pipeline-resume-error-msg">Lỗi: {abort.errorMessage}</span>
            </>
          )}
        </div>
      </div>
      <div className="ksp-pipeline-resume-actions">
        <button
          type="button"
          className="ksp-pipeline-resume-btn-primary"
          onClick={handleResume}
          disabled={isResuming}
          title={`Chạy tiếp pipeline từ ${getSectionLabel(abort.abortedAtSection as any)}. Các stage đã xong sẽ KHÔNG bị gọi AI lại.`}
        >
          {isResuming ? "⏳ Đang chạy..." : `▶ Continue từ ${abort.abortedAtSection.replace("script-", "")}`}
        </button>
        <button
          type="button"
          className="ksp-pipeline-resume-btn-dismiss"
          onClick={handleDismiss}
          title="Đóng banner. Sẽ KHÔNG hiện lại cho lần abort này. Chạy pipeline mới hoặc bấm Continue lần sau sẽ tự reset."
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
