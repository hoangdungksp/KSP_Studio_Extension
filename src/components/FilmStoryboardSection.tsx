/**
 * r8.0: HIDDEN — no longer rendered in Editor (pipeline ends at Shot List). Kept for possible revival.
 * KSP Image Film Storyboard Section (visual grid rewrite)
 *
 * Paradigm shift from replaced shot list (text rows) with VISUAL GRIDS.
 * Each scene contains 1+ SceneGrid (packed via Option A).
 * Each cell = 1 shot snapshot, with 4 per-cell action buttons.
 *
 * Migration A: old per-shot grid data was dropped at load (migration.ts ).
 */

import React, { useState, useMemo } from "react";
import JSZip from "jszip";
import { useAppStore } from "../store/useAppStore";
import {
  ensureFilmData,
  getShotsForScene,
  ensureSceneGrids,
  setSceneGridFormat,
  resetSceneGridFormatToAuto,
  setSceneGridImage,
  applyCroppedFramesToGrid,
  clearSceneGridImage,
  toggleSceneGridCellLock,
  setSceneGridCellVideo,
  clearSceneGridCellVideo,
  regenerateSceneGridImagePrompt,
  setSceneGridCellDataUrl,
  updateShot,
} from "../store/film_actions";
import type {
  SceneGrid,
  SceneGridCell,
  SceneGridFormat,
  FilmSceneScript,
  FilmShot,
  ShotCropSettings,
} from "../types/project";
import { parseGridFormat, gridStats, pickOptimalGridFormat } from "../engine/sceneGridPacker";
import { buildSceneGridImagePrompt } from "../engine/sceneImagePromptBuilder";
import {
  buildSingleShotImagePrompt,
  buildAnimationPrompt,
} from "../engine/filmShotPromptBuilder";
import { resolveVideoProvider } from "../types/film";
import { cropGridIntoFrames } from "../engine/gridImageCrop";
import { buildGridTemplateImage } from "../engine/gridTemplateImage";
import { GridCropPreviewModal } from "./GridCropPreviewModal";
import { FilmFrameEditModal } from "./FilmFrameEditModal";
import { FilmAnimaticPlayerModal } from "./FilmAnimaticPlayerModal";

const GRID_FORMAT_OPTIONS: { value: SceneGridFormat; label: string; cells: number }[] = [
  { value: "2x2", label: "2×2", cells: 4 },
  { value: "2x3", label: "2×3", cells: 6 },
  { value: "3x2", label: "3×2", cells: 6 },
  { value: "2x4", label: "2×4", cells: 8 },
  { value: "4x2", label: "4×2", cells: 8 },
  { value: "3x3", label: "3×3", cells: 9 },
  { value: "4x3", label: "4×3", cells: 12 },
  { value: "3x4", label: "3×4", cells: 12 },
  { value: "4x4", label: "4×4", cells: 16 },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function FilmStoryboardSection() {
  const project = useAppStore((s) => s.currentProject);
  // read autoChainState for section-level border animation
  const autoChainState = useAppStore((s) => s.autoChainState);
  if (!project) return null;
  const film = ensureFilmData(project);
  const scenes = film.script?.scenes ?? [];
  const totalShots = scenes.reduce(
    (acc, s) => acc + getShotsForScene(project, s.id).length,
    0
  );
  const totalGrids = scenes.reduce((acc, s) => acc + (s.grids?.length ?? 0), 0);

  // r8.0: section HIDDEN (not rendered in Editor) and grid-build stage removed
  // from auto-chain — storyboard no longer animates on auto-chain progress.
  const storyboardStatuses: string[] = [];
  void autoChainState;
  const isStoryboardGenerating = storyboardStatuses.includes("generating");
  const storyboardHasError = storyboardStatuses.includes("error");
  const sectionClass = isStoryboardGenerating
    ? "ksp-section ksp-storyboard-film ksp-autochain-generating"
    : storyboardHasError
      ? "ksp-section ksp-storyboard-film ksp-autochain-error"
      : "ksp-section ksp-storyboard-film";

  return (
    <section className={sectionClass}>
      <header className="ksp-section-header">
        <span className="ksp-section-icon">🎬</span>
        <h2 className="ksp-section-title">5. STORYBOARD</h2>
        <span className="ksp-storyboard-stats">
          {scenes.length} scene{scenes.length !== 1 ? "s" : ""} · {totalShots} shot
          {totalShots !== 1 ? "s" : ""} · {totalGrids} grid{totalGrids !== 1 ? "s" : ""}
        </span>
      </header>


      {scenes.length === 0 && (
        <div className="ksp-storyboard-empty">
          <p>Chưa có scene. Quay lại Script section, hoàn thành Stage 5 (Dialogues) trước.</p>
        </div>
      )}

      {scenes.map((scene) => (
        <SceneBlock key={scene.id} scene={scene} />
      ))}
    </section>
  );
}

interface SceneBlockProps {
  scene: FilmSceneScript;
}

function SceneBlock({ scene }: SceneBlockProps) {
  const project = useAppStore((s) => s.currentProject)!;
  const updateProject = useAppStore((s) => s.updateCurrentProject);
  const [expanded, setExpanded] = useState(false);
  // Advanced override panel toggle (default collapsed)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [animaticPlayerOpen, setAnimaticPlayerOpen] = useState(false);

  const shots = getShotsForScene(project, scene.id);
  const grids = scene.grids ?? [];
  const stats = gridStats(grids);
  const gridFormat: SceneGridFormat = scene.gridFormat ?? "3x3";
  // aspect ratio from project setting
  const aspectRatio = (project as any).settingV2?.aspectRatio ?? "16:9";
  // optimal format that WOULD be auto-picked for current shot count + aspect
  const optimalFormat = pickOptimalGridFormat(shots.length, aspectRatio);

  // Distinguish auto-picked vs manual override.
  // gridFormatManual === true: explicit user override → show "↺ Reset to Auto"
  // gridFormatManual === false: explicit auto-picked → show "(auto)"
  // gridFormatManual === undefined: legacy from /→ migration hint
  const isManualOverride = scene.gridFormatManual === true;
  const isExplicitAuto = scene.gridFormatManual === false;
  const isLegacy = scene.gridFormatManual === undefined && scene.gridFormat !== undefined;
  // migration hint only when legacy AND current format differs from auto-optimal
  const showMigrationHint = isLegacy && scene.gridFormat !== optimalFormat;

  function handleExpand() {
    if (!expanded && grids.length === 0) {
      updateProject((p) => ensureSceneGrids(p, scene.id));
    }
    setExpanded(!expanded);
  }

  function handleChangeFormat(newFormat: SceneGridFormat) {
    if (newFormat === gridFormat) return;
    const ok = confirm(
      `Đổi grid format từ ${gridFormat} sang ${newFormat}?\n\nGrids sẽ re-pack. Cropped frames được giữ nếu shot vị trí khớp.\n\nĐây là MANUAL override — sẽ không tự đổi khi shot count thay đổi.`
    );
    if (!ok) return;
    updateProject((p) => setSceneGridFormat(p, scene.id, newFormat));
  }

  function handleResetToAuto() {
    const ok = confirm(
      `Reset về Auto?\n\nSẽ pick lại grid format optimal theo shot count (${shots.length} shots → ${optimalFormat}).\n\nCropped frames giữ nếu shot vị trí khớp.`
    );
    if (!ok) return;
    updateProject((p) => resetSceneGridFormatToAuto(p, scene.id));
    setAdvancedOpen(false);
  }

  return (
    <div className="ksp-storyboard-scene">
      <div className="ksp-storyboard-scene-header" onClick={handleExpand}>
        <span className="ksp-storyboard-arrow">{expanded ? "▼" : "▶"}</span>
        <strong className="ksp-storyboard-scene-title">Scene {scene.order}</strong>
        <span className="ksp-storyboard-scene-subtitle">
          {scene.titleVi || scene.titleEn}
        </span>
        <span className="ksp-storyboard-scene-meta">
          <strong>{gridFormat}</strong> · {aspectRatio} ·{" "}
          {shots.length} shot{shots.length !== 1 ? "s" : ""} ·{" "}
          {Math.floor(scene.durationSeconds / 60)}m{scene.durationSeconds % 60}s
          {isManualOverride && <span className="ksp-sb-meta-manual"> · manual</span>}
        </span>
      </div>

      {expanded && (
        <div className="ksp-storyboard-scene-body">
          {/* Advanced toggle + Play Animatic button (default collapsed). No dropdown by default. */}
          <div className="ksp-storyboard-grid-format-row">
            <button
              type="button"
              className={`ksp-sb-grid-advanced-toggle ${
                advancedOpen ? "ksp-sb-grid-advanced-toggle-active" : ""
              }`}
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              ⚙ Advanced {advancedOpen ? "▲" : "▼"}
            </button>
            <button
              type="button"
              className="ksp-sb-play-animatic-btn"
              onClick={() => setAnimaticPlayerOpen(true)}
              disabled={shots.length === 0}
              title={
                shots.length === 0
                  ? "Cần có shots trong scene để play animatic"
                  : "Play animatic preview of scene"
              }
            >
              ▶ Play Animatic
            </button>
            {/* Reset to Auto button visible only when manual override (or legacy mismatch) */}
            {(isManualOverride || showMigrationHint) && (
              <button
                type="button"
                className="ksp-sb-grid-reset-btn"
                onClick={handleResetToAuto}
                title={`Reset về auto: ${optimalFormat}`}
              >
                ↺ Reset to Auto ({optimalFormat})
              </button>
            )}
            {stats.emptyCells > 0 && (
              <span className="ksp-storyboard-grid-stats">
                {stats.gridCount} grid{stats.gridCount !== 1 ? "s" : ""} · {stats.emptyCells} empty
              </span>
            )}
          </div>

          {/* Inline dropdown shown only when Advanced toggle is open */}
          {advancedOpen && (
            <div className="ksp-sb-grid-advanced-panel">
              <label>Grid format override:</label>
              <select
                value={gridFormat}
                onChange={(e) => handleChangeFormat(e.target.value as SceneGridFormat)}
              >
                {GRID_FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.cells} cells)
                    {opt.value === optimalFormat ? " ← auto" : ""}
                  </option>
                ))}
              </select>
              <span className="ksp-storyboard-grid-stats">
                {stats.gridCount} grid{stats.gridCount !== 1 ? "s" : ""} ·{" "}
                {stats.filledCells} filled
                {stats.emptyCells > 0 ? ` · ${stats.emptyCells} empty` : ""}
              </span>
            </div>
          )}

          {shots.length === 0 && (
            <div className="ksp-storyboard-empty">
              <p>Chưa có shot. Quay lại Shot List section để generate shots trước.</p>
            </div>
          )}

          {/* Sprint 1.0 r7.5 (Hướng A): Multi-grid seamless cells + prompts side-by-side below.
              Single-grid path: render GridDisplay (cells only) + GridPromptPanel inline.
              Multi-grid path: render all GridDisplay (cells only) stacked seamless,
              then MultiGridPromptTabs at the bottom for prompt access.
              GridDisplay no longer renders the prompt panel — that's lifted out so cells
              flow directly into the next grid's cells with no DOM separator. */}
          <div className="ksp-storyboard-multigrid-container">
            {grids.map((grid, gridIdx) => {
              // Cumulative cell offset = sum of cell counts of all previous grids
              const cellOffset = grids
                .slice(0, gridIdx)
                .reduce((sum, g) => sum + g.cells.length, 0);
              return (
                <GridDisplay
                  key={grid.id}
                  grid={grid}
                  scene={scene}
                  cellNumberOffset={cellOffset}
                  hideHeader={gridIdx > 0}
                  allGrids={grids}
                />
              );
            })}
            {/* Prompt panels — separated from grid blocks so cells flow seamlessly */}
            {grids.length === 1 ? (
              <GridPromptPanel
                grid={grids[0]}
                scene={scene}
                allGrids={grids}
                hideToggleRow={false}
              />
            ) : grids.length > 1 ? (
              <MultiGridPromptTabs grids={grids} scene={scene} />
            ) : null}
          </div>
        </div>
      )}

      {/* Animatic Player Modal — per-scene preview */}
      {animaticPlayerOpen && (
        <FilmAnimaticPlayerModal
          scene={scene}
          shotsInScene={shots}
          cellAssetsByShotId={(() => {
            const map: Record<
              string,
              { dataUrl?: string; video?: { dataUrl: string; filename: string } } | undefined
            > = {};
            for (const g of grids) {
              for (const c of g.cells) {
                if (c.shotId) {
                  map[c.shotId] = {
                    dataUrl: c.dataUrl,
                    video: c.video
                      ? { dataUrl: c.video.dataUrl, filename: c.video.filename }
                      : undefined,
                  };
                }
              }
            }
            return map;
          })()}
          setting={(project as any).settingV2}
          onClose={() => setAnimaticPlayerOpen(false)}
        />
      )}
    </div>
  );
}

interface GridDisplayProps {
  grid: SceneGrid;
  scene: FilmSceneScript;
  /** Sprint 1.0 r7: cumulative cell number offset from previous grids (multi-grid seamless display).
   *  E.g., Grid 2 in a 3x3 multi-grid scene → offset = 9 → cells display "10", "11", ... */
  cellNumberOffset?: number;
  /** Sprint 1.0 r7: hide the grid header (used for Grid 2+ in seamless display).
   *  When true, only renders cells visually + the prompt panel below. */
  hideHeader?: boolean;
  /** Sprint 1.0 r7: all grids in this scene (for prompt builder to detect multi-grid + Grid 2 ref Grid 1). */
  allGrids?: SceneGrid[];
}

function GridDisplay({ grid, scene, cellNumberOffset = 0, hideHeader = false, allGrids }: GridDisplayProps) {
  const project = useAppStore((s) => s.currentProject)!;
  const updateProject = useAppStore((s) => s.updateCurrentProject);
  const showToast = useAppStore((s) => s.showToast);
  const film = ensureFilmData(project);
  const setting = (project as any).settingV2;
  // Edit Frame Modal state (cell-level, kept in GridDisplay since cells are rendered here)
  const [editingCellOrder, setEditingCellOrder] = useState<number | null>(null);

  const { cols } = parseGridFormat(grid.gridFormat);
  const shots = getShotsForScene(project, scene.id);
  const aspectRatio = setting?.aspectRatio ?? "16:9";

  /**
   * Trigger hidden file input for video upload. Reads video as dataURL,
   * optionally probes duration via <video> element, then stores on cell.
   */
  function handleUploadVideoForCell(cellOrder: number) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // Soft size limit: 50 MB. Larger files may slow IndexedDB persist.
      if (file.size > 50 * 1024 * 1024) {
        const ok = confirm(
          `Video ${(file.size / 1024 / 1024).toFixed(1)} MB khá lớn. Vẫn upload? (Có thể chậm khi save project)`
        );
        if (!ok) return;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("File read failed"));
          reader.readAsDataURL(file);
        });
        // Probe duration (best-effort, non-blocking)
        let durationSeconds: number | undefined;
        try {
          durationSeconds = await new Promise<number>((resolve, reject) => {
            const v = document.createElement("video");
            v.preload = "metadata";
            v.onloadedmetadata = () => resolve(v.duration);
            v.onerror = () => reject(new Error("Cannot read video metadata"));
            v.src = dataUrl;
          });
        } catch {
          /* ignore — duration is optional metadata */
        }
        updateProject((p) =>
          setSceneGridCellVideo(p, scene.id, grid.id, cellOrder, {
            dataUrl,
            filename: file.name,
            durationSeconds,
          })
        );
        showToast(
          `Đã upload video cho shot ${cellOrder}${
            durationSeconds ? ` (${durationSeconds.toFixed(1)}s)` : ""
          }`,
          "success"
        );
      } catch (err) {
        showToast(`Upload lỗi: ${(err as Error).message}`, "error");
      }
    };
    input.click();
  }

  /**
   * Sprint 1.0 Feature 2 — Bulk download Animation Prompts for ALL shots in this scene.
   * ZIP filename: scene-N_animation_prompts.zip
   * Inner files: prompt_shot_N.txt (N = shot.order, ALL shots in scene regardless of grid)
   *
   * Each shot's prompt resolves: shot.animationPromptR5 (AI re-prompt override) → fallback
   * to deterministic buildAnimationPrompt. Bulk mode uses simple builder (no advanced
   * first/last frame mode, which is per-modal local state).
   */
  async function handleDownloadAnimationPrompts() {
    const sceneShots = getShotsForScene(project, scene.id);
    if (sceneShots.length === 0) {
      showToast("Scene chưa có shot nào", "info");
      return;
    }
    if (!setting) {
      showToast("Project setting missing", "error");
      return;
    }
    try {
      const zip = new JSZip();
      // G1e2 Phase 1 fix: setting.timeFormat stored as 'integer' but TimeFormat enum is
      // 'integer_seconds'. Mapping legacy values → enum to prevent formatTimeRange
      // returning undefined → 'undefined–undefined' in TIMING BREAKDOWN block.
      const rawTimeFormat = (setting as any).timeFormat ?? "integer_seconds";
      const timeFormatMap: Record<string, "decimal_seconds" | "timecode" | "integer_seconds" | "percentage"> = {
        "integer": "integer_seconds",
        "decimal": "decimal_seconds",
        "timecode": "timecode",
        "percentage": "percentage",
        "integer_seconds": "integer_seconds",
        "decimal_seconds": "decimal_seconds",
      };
      const timeFormat = timeFormatMap[rawTimeFormat] ?? "integer_seconds";
      const allScenes = film.script?.scenes;
      const setupPayoffPairs = film.setupPayoffPairs;
      sceneShots.forEach((s) => {
        const overridePrompt = (s as any).animationPromptR5 as string | undefined;
        const provider = resolveVideoProvider((s as any).videoProviderId, undefined);
        const promptText = overridePrompt
          ? overridePrompt
          : buildAnimationPrompt({
              shot: s,
              scene,
              cast: film.characters,
              setting,
              provider,
              timeFormat,
              allScenes,
              setupPayoffPairs,
            });
        zip.file(`prompt_shot_${s.order}.txt`, promptText);
      });
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scene-${scene.order}_animation_prompts.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(
        `Đã tải ${sceneShots.length} animation prompts (scene ${scene.order})`,
        "success"
      );
    } catch (err) {
      showToast(`Animation prompts ZIP lỗi: ${(err as Error).message}`, "error");
    }
  }

  /**
   * Sprint 1.0 Feature 3 — Bulk download Image Prompts for ALL shots in this scene.
   * Same filename convention as Animation (prompt_shot_N.txt) but inside a different ZIP.
   *
   * Uses buildSingleShotImagePrompt — single-frame generation prompt (Edit Frame modal).
   * Resolves shot.imagePromptR5 (AI re-prompt) → fallback to deterministic build.
   */
  async function handleDownloadImagePrompts() {
    const sceneShots = getShotsForScene(project, scene.id);
    if (sceneShots.length === 0) {
      showToast("Scene chưa có shot nào", "info");
      return;
    }
    if (!setting) {
      showToast("Project setting missing", "error");
      return;
    }
    try {
      const zip = new JSZip();
      const allScenes = film.script?.scenes;
      const setupPayoffPairs = film.setupPayoffPairs;
      sceneShots.forEach((s) => {
        const overridePrompt = (s as any).imagePromptR5 as string | undefined;
        const promptText = overridePrompt
          ? overridePrompt
          : buildSingleShotImagePrompt({
              shot: s,
              scene,
              cast: film.characters,
              setting,
              allScenes,
              setupPayoffPairs,
            });
        zip.file(`prompt_shot_${s.order}.txt`, promptText);
      });
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scene-${scene.order}_image_prompts.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(
        `Đã tải ${sceneShots.length} image prompts (scene ${scene.order})`,
        "success"
      );
    } catch (err) {
      showToast(`Image prompts ZIP lỗi: ${(err as Error).message}`, "error");
    }
  }

  /**
   * r7.38: moved into GridDisplay (was in GridPromptPanel) — Refs ZIP button
   * now lives in the grid header next to KSP/DeepMind prompt buttons.
   * Bundles: grid template image, all cast face+body refs, cropped cells.
   */
  async function handleDownloadRefs() {
    const filledCells = grid.cells.filter((c) => c.shotId);
    const croppedCells = grid.cells.filter((c) => c.dataUrl);
    if (film.characters.length === 0 && croppedCells.length === 0 && filledCells.length === 0) {
      showToast("Chưa có cast + chưa crop — ZIP rỗng", "info");
      return;
    }
    try {
      const zip = new JSZip();
      // IMAGE #1 — grid template (blank labeled layout)
      try {
        const template = buildGridTemplateImage({
          gridFormat: grid.gridFormat,
          targetAspect: setting?.aspectRatio ?? "16:9",
          filledCellOrders: filledCells.map((c) => c.order),
        });
        zip.file("image-01_grid-template.png", dataUrlToBlob(template.dataUrl));
      } catch (err) {
        console.warn("[Storyboard] grid template image generation failed", err);
      }
      // IMAGE #2+ — cast refs (face + body per character).
      let imageNum = 2;
      for (const c of film.characters) {
        const safeName = (c.name || `char${c.order}`).replace(/[^a-zA-Z0-9_-]/g, "_");
        c.faceRefs.forEach((ref, i) => {
          const numStr = String(imageNum).padStart(2, "0");
          const slotStr = String(i + 1).padStart(2, "0");
          const ext = (ref.filename.split(".").pop() || "png").toLowerCase();
          zip.file(
            `image-${numStr}_cast-${safeName}_face-${slotStr}.${ext}`,
            dataUrlToBlob(ref.dataUrl)
          );
          imageNum++;
        });
        c.bodyRefs.forEach((ref, i) => {
          const numStr = String(imageNum).padStart(2, "0");
          const slotStr = String(i + 1).padStart(2, "0");
          const ext = (ref.filename.split(".").pop() || "png").toLowerCase();
          zip.file(
            `image-${numStr}_cast-${safeName}_body-${slotStr}.${ext}`,
            dataUrlToBlob(ref.dataUrl)
          );
          imageNum++;
        });
      }
      // Supplemental — cropped cells, named by SHOT order
      croppedCells.forEach((cell) => {
        if (cell.dataUrl) {
          const cellShot = cell.shotId ? shots.find((s) => s.id === cell.shotId) : undefined;
          const name = cellShot ? `shot-${cellShot.order}.png` : `cell-${cell.order}.png`;
          zip.file(`cropped-cells/${name}`, dataUrlToBlob(cell.dataUrl));
        }
      });
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scene-${scene.order}_grid-${grid.order}_refs.zip`;
      a.click();
      URL.revokeObjectURL(url);
      const parts: string[] = ["template"];
      if (film.characters.length > 0) parts.push(`${film.characters.length} cast`);
      if (croppedCells.length > 0) parts.push(`${croppedCells.length} crops`);
      showToast(`Refs ZIP downloaded — ${parts.join(" + ")}`, "success");
    } catch (err) {
      showToast(`ZIP error: ${(err as Error).message}`, "error");
    }
  }

  /**
   * r7.38: KSP Prompt handler — copy to clipboard (was download ZIP in r7.34).
   * Builds Omni multi-shot prompt with KSP HYBRID pattern, then writes plain text
   * to clipboard. User pastes into Gemini chat; reference images come from the
   * separate "Refs ZIP" button next to this one in the header.
   */
  async function handleCopyKspPrompt() {
    const sceneShots = getShotsForScene(project, scene.id);
    if (sceneShots.length === 0) {
      showToast("Scene chưa có shot nào", "info");
      return;
    }
    if (!setting) {
      showToast("Project setting missing", "error");
      return;
    }

    try {
      const { buildOmniMultiShotPrompt } = await import(
        "../engine/omniMultiShotPromptBuilder"
      );

      const sceneGrids = allGrids ?? [grid];
      const hasStoryboardImage = sceneGrids.some((g) => !!g.gridImageDataUrl);

      const result = buildOmniMultiShotPrompt({
        scene,
        shots: sceneShots,
        cast: film.characters,
        setting,
        hasStoryboardImage,
      });

      await navigator.clipboard.writeText(result.promptText);

      showToast(
        `Đã copy KSP Prompt vào clipboard (${sceneShots.length} shots, ${result.promptText.length} chars)`,
        "success"
      );
    } catch (err) {
      showToast(`KSP Prompt lỗi: ${(err as Error).message}`, "error");
    }
  }

  /**
   * r7.38: DeepMind Prompt handler — copy to clipboard (was download ZIP in r7.34).
   * Builds Omni prompt with STRICT DeepMind 18-word pattern + identity anchor only.
   * User pastes into Gemini chat; reference images via separate "Refs ZIP" button.
   */
  async function handleCopyDeepMindPrompt() {
    const sceneShots = getShotsForScene(project, scene.id);
    if (sceneShots.length === 0) {
      showToast("Scene chưa có shot nào", "info");
      return;
    }
    if (!setting) {
      showToast("Project setting missing", "error");
      return;
    }

    try {
      const { buildOmniDeepMindPurePrompt } = await import(
        "../engine/omniDeepMindPurePromptBuilder"
      );

      const sceneGrids = allGrids ?? [grid];
      const hasStoryboardImage = sceneGrids.some((g) => !!g.gridImageDataUrl);

      const result = buildOmniDeepMindPurePrompt({
        scene,
        shots: sceneShots,
        cast: film.characters,
        setting,
        hasStoryboardImage,
      });

      await navigator.clipboard.writeText(result.promptText);

      showToast(
        `Đã copy DeepMind Prompt vào clipboard (${sceneShots.length} shots, ${result.promptText.length} chars)`,
        "success"
      );
    } catch (err) {
      showToast(`DeepMind Prompt lỗi: ${(err as Error).message}`, "error");
    }
  }

  return (
    <div className="ksp-storyboard-grid-block">
      {/* Sprint 1.0 r7: hide header for Grid 2+ in seamless multi-grid display.
          User sees a single continuous grid visually; Grid 1 header still shows
          since it carries the format + filled-count info for the scene.
      {/* Sprint 1.0 r7.5 (Hướng A): prompt panel lifted OUT of GridDisplay so
          cells of Grid 1 and Grid 2 flow into each other with no DOM break.
          r7.8: Grid header renamed "Grid - Scene N" (Jason: 2 grids gom 1 visual block).
          Header is rendered ONLY for first grid (hideHeader=false). Right side:
          download buttons for bulk animation/image prompt export per scene. */}
      {!hideHeader && (
        <div className="ksp-storyboard-grid-header">
          <strong>Grid - Scene {scene.order}</strong>
          <span className="ksp-storyboard-grid-info">
            ({grid.gridFormat} ·{" "}
            {grid.cells.filter((c) => c.shotId).length} filled
            {grid.cells.filter((c) => !c.shotId).length > 0
              ? ` · ${grid.cells.filter((c) => !c.shotId).length} empty`
              : ""}
            {grid.gridImageDataUrl ? " · ✓ cropped" : " · 📤 needs upload"})
          </span>
          {/* r7.8 Feature 2+3: per-scene bulk prompt download buttons
              r7.34: A/B comparison — 2 buttons replace old Multi Shot.
              r7.38: 2 prompt buttons now COPY clipboard (not ZIP). Refs ZIP
              moved here (was under upload row) — group all download buttons
              in one header bar. */}
          <div className="ksp-storyboard-grid-header-downloads">
            <button
              type="button"
              className="ksp-btn ksp-btn-ghost ksp-btn-sm"
              onClick={() => handleCopyKspPrompt()}
              title="📋 KSP Prompt — Copy prompt theo pattern KSP Hybrid (per-cell timestamps + lighting override + identity anchor + audio cues). Detailed control, ~600-1200 chars. Click → copy vào clipboard. Reference images lấy qua nút 'Refs ZIP' bên cạnh."
            >
              📋 KSP Prompt
            </button>
            <button
              type="button"
              className="ksp-btn ksp-btn-ghost ksp-btn-sm"
              onClick={() => handleCopyDeepMindPrompt()}
              title="📋 DeepMind Prompt — Copy prompt theo DeepMind official strict (18-word pattern + identity anchor only). Trust Omni's reasoning, ~150-300 chars. Click → copy vào clipboard. Dùng để A/B compare với KSP Prompt."
            >
              📋 DeepMind Prompt
            </button>
            <button
              type="button"
              className="ksp-btn ksp-btn-ghost ksp-btn-sm ksp-btn-icon-only"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadRefs();
              }}
              title="📥 Refs ZIP — Download cast concept sheets + cropped grid frames để upload kèm prompt (KSP hoặc DeepMind) lên Gemini chat."
            >
              📥<span className="ksp-btn-label-fluid"> Refs ZIP</span>
            </button>
            <button
              type="button"
              className="ksp-btn ksp-btn-ghost ksp-btn-sm ksp-btn-icon-only"
              onClick={() => handleDownloadAnimationPrompts()}
              title="📥 Tải về tất cả Animation Prompts của shots trong scene này (ZIP với prompt_shot_N.txt)"
              aria-label="Download animation prompts"
            >
              🎬<span className="ksp-btn-label-fluid"> Animation</span>
            </button>
            <button
              type="button"
              className="ksp-btn ksp-btn-ghost ksp-btn-sm ksp-btn-icon-only"
              onClick={() => handleDownloadImagePrompts()}
              title="📥 Tải về tất cả Image Prompts (single-frame) của shots trong scene này (ZIP với prompt_shot_N.txt)"
              aria-label="Download image prompts"
            >
              📸<span className="ksp-btn-label-fluid"> Image</span>
            </button>
          </div>
        </div>
      )}

      <div
        className={`ksp-storyboard-grid ksp-storyboard-grid-cells-aspect`}
        style={(() => {
          const parts = aspectRatio.split(":").map(Number);
          const w = parts[0] || 16;
          const h = parts[1] || 9;
          const isVertical = w < h;
          // Vertical aspects: cap container width so cells stay reasonable size
          // (else grid 2x3 in 9:16 would render cells 350×622px = giant column).
          const maxWidth = isVertical ? `${cols * 130}px` : undefined;
          return {
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            ["--ksp-cell-aspect" as any]: `${w} / ${h}`,
            maxWidth,
          };
        })()}
      >
        {grid.cells.map((cell) => {
          const shot = cell.shotId
            ? shots.find((s) => s.id === cell.shotId)
            : undefined;
          // forward cellNumberOffset to the cell so cell number displays cumulatively
          // (Grid 2 cell #1 shows "10" when offset=9). Falls back to cell.order if not used.
          void cellNumberOffset;
          return (
            <GridCell
              key={cell.order}
              cell={cell}
              shot={shot}
              hasGridImage={!!grid.gridImageDataUrl}
              onToggleLock={() =>
                updateProject((p) =>
                  toggleSceneGridCellLock(p, scene.id, grid.id, cell.order)
                )
              }
              onRegen={() => {
                showToast(
                  `Regen shot ${shot?.order ?? cell.order}: single-frame Nano Banana API sẽ wire khi API ready`,
                  "info"
                );
              }}
              onDownload={() => {
                if (!cell.dataUrl) {
                  showToast("Chưa có ảnh để download", "info");
                  return;
                }
                const a = document.createElement("a");
                a.href = cell.dataUrl;
                // Unified naming: shot-N.png (matches prompt references)
                a.download = shot ? `shot-${shot.order}.png` : `cell-${cell.order}.png`;
                a.click();
                showToast(`Đã download shot ${shot?.order ?? cell.order}`, "success");
              }}
              onEdit={() => {
                setEditingCellOrder(cell.order);
              }}
              onUploadVideo={() => {
                handleUploadVideoForCell(cell.order);
              }}
            />
          );
        })}
      </div>

      {/* Edit Frame Modal — opens when user clicks ✏ on a cell */}
      {editingCellOrder !== null && (() => {
        const cell = grid.cells.find((c) => c.order === editingCellOrder);
        if (!cell || !cell.shotId) return null;
        const shot = shots.find((s) => s.id === cell.shotId);
        if (!shot || !setting) return null;
        return (
          <FilmFrameEditModal
            cell={cell}
            grid={grid}
            scene={scene}
            shot={shot}
            allShotsInScene={shots}
            cast={film.characters}
            setting={setting}
            allScenes={film.script?.scenes}
            setupPayoffPairs={film.setupPayoffPairs}
            onCancel={() => setEditingCellOrder(null)}
            showToast={showToast}
            onSave={(updates) => {
              updateProject((p) =>
                updateShot(p, scene.id, shot.id, updates as any)
              );
              setEditingCellOrder(null);
            }}
            onUploadReplace={(dataUrl) => {
              updateProject((p) =>
                setSceneGridCellDataUrl(p, scene.id, grid.id, cell.order, dataUrl)
              );
              // Keep modal open so user can verify
            }}
            onUploadVideo={(video) => {
              updateProject((p) =>
                setSceneGridCellVideo(p, scene.id, grid.id, cell.order, video)
              );
            }}
            onClearVideo={() => {
              updateProject((p) =>
                clearSceneGridCellVideo(p, scene.id, grid.id, cell.order)
              );
            }}
          />
        );
      })()}
    </div>
  );
}

/**
 * Sprint 1.0 (Hướng A) — GridPromptPanel
 *
 * Standalone prompt panel for ONE grid. Owns:
 * - imagePromptText computation (rebuilds from current shots + scene + pacing)
 * - Upload/Recrop/Download Refs/Clear handlers
 * - pendingUpload state + GridCropPreviewModal
 *
 * Two render modes:
 * - Default (`hideToggleRow=false`): renders own toggle row with inline action buttons.
 *   Used for single-grid scenes (1 grid → 1 inline collapsible).
 * - `hideToggleRow=true` + `expanded` controlled: parent owns toggle UI (tabs).
 *   Used inside MultiGridPromptTabs — action buttons render INSIDE the body
 *   (top of body) instead of the toggle row since tabs don't have space for them.
 */
interface GridPromptPanelProps {
  grid: SceneGrid;
  scene: FilmSceneScript;
  allGrids?: SceneGrid[];
  /** When false (default): self-managed expand state + toggle row visible.
   *  When true: controlled mode, parent renders the toggle externally. */
  hideToggleRow?: boolean;
  /** Controlled expanded state. Required when hideToggleRow=true. */
  expanded?: boolean;
}

function GridPromptPanel({
  grid,
  scene,
  allGrids,
  hideToggleRow = false,
  expanded: controlledExpanded,
}: GridPromptPanelProps) {
  const project = useAppStore((s) => s.currentProject)!;
  const updateProject = useAppStore((s) => s.updateCurrentProject);
  const showToast = useAppStore((s) => s.showToast);
  const film = ensureFilmData(project);
  const setting = (project as any).settingV2;
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{
    dataUrl: string;
    initialSettings?: ShotCropSettings;
  } | null>(null);

  const shots = getShotsForScene(project, scene.id);
  const aspectRatio = setting?.aspectRatio ?? "16:9";
  // When tab-controlled (hideToggleRow=true), use the `expanded` prop. Otherwise own state.
  const isExpanded = hideToggleRow ? !!controlledExpanded : internalExpanded;

  const imagePromptText = useMemo(() => {
    // Sprint 1.0 r6 (BUG #5 fix): always rebuild from current shots + scene + pacing.
    // Old behavior cached grid.imagePrompt and never invalidated → stale after shot regen.
    // No user-facing "Save prompt" button exists (textarea is readonly), so dropping
    // the cache loses no user data. Rebuild cost is negligible (~3-5ms).
    if (!setting) return "(missing project setting)";
    const previousGrid =
      allGrids && grid.order > 1 ? allGrids[grid.order - 2] : undefined;
    const previousGridGenerated =
      !!previousGrid && previousGrid.cells.some((c) => !!c.dataUrl);
    return buildSceneGridImagePrompt({
      grid,
      scene,
      shots,
      cast: film.characters,
      setting,
      allScenes: film.script?.scenes,
      setupPayoffPairs: film.setupPayoffPairs,
      allGrids,
      previousGridGenerated,
    });
  }, [
    grid,
    scene,
    shots,
    film.characters,
    film.script?.scenes,
    film.setupPayoffPairs,
    setting,
    allGrids,
  ]);

  function handleCopyPrompt() {
    navigator.clipboard.writeText(imagePromptText);
    showToast(`Copied prompt grid ${grid.order} (${imagePromptText.length} chars)`, "success");
  }

  function handleRegenPrompt() {
    updateProject((p) => regenerateSceneGridImagePrompt(p, scene.id, grid.id));
    showToast(`Đã regen prompt grid ${grid.order}`, "success");
  }

  async function handleUploadFile(file: File) {
    try {
      const dataUrl = await fileToDataUrl(file);
      setPendingUpload({ dataUrl, initialSettings: grid.cropSettings });
    } catch (err) {
      showToast(`Upload lỗi: ${(err as Error).message}`, "error");
    }
  }

  function handleRecrop() {
    if (!grid.gridImageDataUrl) {
      showToast("Chưa có grid để re-crop", "info");
      return;
    }
    setPendingUpload({
      dataUrl: grid.gridImageDataUrl,
      initialSettings: grid.cropSettings,
    });
  }

  function handleClear() {
    if (!grid.gridImageDataUrl) return;
    if (!confirm(`Xóa grid ${grid.order} và tất cả cropped cells?`)) return;
    updateProject((p) => clearSceneGridImage(p, scene.id, grid.id));
  }

  // r7.38: handleDownloadRefs moved into GridDisplay (header button location).



  // Action buttons element — reused in toggle row (inline mode) OR body (tab mode)
  const actionButtonsInline = (
    <div className="ksp-storyboard-prompt-actions-inline">
      <label
        className="ksp-btn ksp-btn-primary ksp-btn-sm ksp-btn-icon-only"
        title={grid.gridImageDataUrl ? "Re-upload Grid" : "Upload Grid PNG"}
        onClick={(e) => e.stopPropagation()}
      >
        📤
        <span className="ksp-btn-label-fluid">
          {grid.gridImageDataUrl ? " Re-upload" : " Upload Grid"}
        </span>
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUploadFile(f);
          }}
        />
      </label>
      {grid.gridImageDataUrl && (
        <button
          type="button"
          className="ksp-btn ksp-btn-ghost ksp-btn-sm ksp-btn-icon-only"
          onClick={(e) => {
            e.stopPropagation();
            handleRecrop();
          }}
          title="Re-crop với settings mới"
        >
          🔧<span className="ksp-btn-label-fluid"> Re-crop</span>
        </button>
      )}
      {grid.gridImageDataUrl && (
        <button
          type="button"
          className="ksp-btn ksp-btn-ghost ksp-btn-sm ksp-btn-icon-only"
          onClick={(e) => {
            e.stopPropagation();
            handleClear();
          }}
          title="Clear grid + cropped cells"
        >
          ✕<span className="ksp-btn-label-fluid"> Clear</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="ksp-storyboard-prompt-collapsible">
      {/* Toggle row — only rendered in inline mode (single grid scene).
          Tab mode: parent MultiGridPromptTabs renders tabs; action buttons move into body. */}
      {!hideToggleRow && (
        <div className="ksp-storyboard-prompt-toggle-row">
          <button
            type="button"
            className="ksp-storyboard-prompt-toggle"
            onClick={() => setInternalExpanded(!internalExpanded)}
          >
            {internalExpanded ? "▼" : "▶"} 📝 Image Prompt — Grid {grid.order} (cho{" "}
            {grid.cells.filter((c) => c.shotId).length} shots)
            <span className="ksp-storyboard-prompt-chars">
              · {imagePromptText.length} chars
            </span>
          </button>
          {actionButtonsInline}
        </div>
      )}
      {isExpanded && (
        <div className="ksp-storyboard-prompt-body">
          {/* Grid 2+ continuity note when previous grid has been uploaded */}
          {grid.order > 1 &&
            allGrids &&
            allGrids[grid.order - 2]?.cells.some((c) => !!c.dataUrl) && (
              <div className="ksp-storyboard-grid2-note">
                ⓘ Grid {grid.order} auto-references Grid {grid.order - 1} generated image for visual continuity. Attach <code>grid-{String(grid.order - 1).padStart(2, "0")}-generated.png</code> from Refs ZIP.
              </div>
            )}
          {/* Tab mode: action buttons render in body since tabs don't have inline slot */}
          {hideToggleRow && (
            <div className="ksp-storyboard-prompt-tab-actions">{actionButtonsInline}</div>
          )}
          <div className="ksp-storyboard-prompt-actions">
            <button
              type="button"
              className="ksp-btn ksp-btn-primary ksp-btn-sm"
              onClick={handleCopyPrompt}
            >
              📋 Copy → Banana Pro
            </button>
            <button
              type="button"
              className="ksp-btn ksp-btn-ghost ksp-btn-sm"
              onClick={handleRegenPrompt}
            >
              🔄 Regen prompt
            </button>
          </div>
          <textarea
            className="ksp-storyboard-prompt-textarea"
            readOnly
            value={imagePromptText}
          />
        </div>
      )}

      {pendingUpload && (
        <GridCropPreviewModal
          gridDataUrl={pendingUpload.dataUrl}
          gridFormat={grid.gridFormat}
          projectAspectRatio={aspectRatio}
          initialSettings={pendingUpload.initialSettings}
          onCancel={() => setPendingUpload(null)}
          onApprove={async (settings, finalGridFormat) => {
            const dataUrl = pendingUpload.dataUrl;
            setPendingUpload(null);
            try {
              if (finalGridFormat !== grid.gridFormat) {
                updateProject((p) =>
                  setSceneGridFormat(p, scene.id, finalGridFormat as SceneGridFormat)
                );
                showToast(
                  `Grid format override: ${grid.gridFormat} → ${finalGridFormat}`,
                  "info"
                );
              }
              updateProject((p) =>
                setSceneGridImage(p, scene.id, grid.id, dataUrl, settings)
              );
              showToast("Đang crop...", "info");
              const aspectParts = aspectRatio.split(":").map(Number);
              const targetCellAspect = (aspectParts[0] || 16) / (aspectParts[1] || 9);
              const cropResult = await cropGridIntoFrames(dataUrl, finalGridFormat, {
                totalWidth: settings.totalWidth,
                totalHeight: settings.totalHeight,
                gutterPx: settings.gutterPx,
                targetCellAspect,
              });
              updateProject((p) =>
                applyCroppedFramesToGrid(p, scene.id, grid.id, cropResult.frameDataUrls)
              );
              showToast(
                `Đã crop ${cropResult.count} cells (${cropResult.cellW}×${cropResult.cellH})`,
                "success"
              );
            } catch (err) {
              showToast(`Crop lỗi: ${(err as Error).message}`, "error");
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Sprint 1.0 (Hướng A) — MultiGridPromptTabs
 *
 * Renders a tab bar (one tab per grid) followed by an expanded body for the
 * currently active tab. Only ONE tab can be expanded at a time — clicking
 * the active tab collapses it (activeIdx = null).
 *
 * Default state: both tabs collapsed (activeIdx = null) — matches Q-b decision.
 * Used only when scene.grids.length > 1. Single-grid scenes use GridPromptPanel
 * inline (no tabs).
 */
interface MultiGridPromptTabsProps {
  grids: SceneGrid[];
  scene: FilmSceneScript;
}

function MultiGridPromptTabs({ grids, scene }: MultiGridPromptTabsProps) {
  const project = useAppStore((s) => s.currentProject)!;
  const film = ensureFilmData(project);
  const setting = (project as any).settingV2;
  // default Grid 1 active (index 0) when scene has multiple grids.
  // User can click active tab to collapse (sets back to null).
  const [activeIdx, setActiveIdx] = useState<number | null>(0);

  // Compute char counts per grid for tab labels (cheap, re-runs on grid change)
  const charCounts = useMemo(
    () =>
      grids.map((g) => {
        if (!setting) return 0;
        const previousGrid = g.order > 1 ? grids[g.order - 2] : undefined;
        const previousGridGenerated =
          !!previousGrid && previousGrid.cells.some((c) => !!c.dataUrl);
        try {
          return buildSceneGridImagePrompt({
            grid: g,
            scene,
            shots: getShotsForScene(project, scene.id),
            cast: film.characters,
            setting,
            allScenes: film.script?.scenes,
            setupPayoffPairs: film.setupPayoffPairs,
            allGrids: grids,
            previousGridGenerated,
          }).length;
        } catch {
          return 0;
        }
      }),
    [grids, scene, film.characters, film.script?.scenes, film.setupPayoffPairs, setting, project]
  );

  return (
    <div className="ksp-storyboard-multigrid-prompts">
      <div className="ksp-storyboard-prompt-tabs" role="tablist">
        {grids.map((g, idx) => {
          const isActive = activeIdx === idx;
          const filled = g.cells.filter((c) => c.shotId).length;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`ksp-storyboard-prompt-tab ${
                isActive ? "ksp-storyboard-prompt-tab-active" : ""
              }`}
              onClick={() => setActiveIdx(isActive ? null : idx)}
            >
              <span className="ksp-storyboard-prompt-tab-arrow">
                {isActive ? "▼" : "▶"}
              </span>
              <span className="ksp-storyboard-prompt-tab-label">
                📝 Grid {g.order}
                <span className="ksp-storyboard-prompt-tab-shots"> · {filled} shots</span>
              </span>
              <span className="ksp-storyboard-prompt-tab-chars">
                {charCounts[idx]} chars
              </span>
            </button>
          );
        })}
      </div>
      {/* Body for active tab only. Rendered as a controlled GridPromptPanel with
          hideToggleRow=true so it shows action buttons + Copy/Regen + textarea
          without re-rendering its own toggle (the tab IS the toggle). */}
      {activeIdx !== null && grids[activeIdx] && (
        <GridPromptPanel
          key={grids[activeIdx].id}
          grid={grids[activeIdx]}
          scene={scene}
          allGrids={grids}
          hideToggleRow={true}
          expanded={true}
        />
      )}
    </div>
  );
}


interface GridCellProps {
  cell: {
    order: number;
    shotId?: string;
    dataUrl?: string;
    locked?: boolean;
    video?: { dataUrl: string; filename: string; durationSeconds?: number };
  };
  shot?: { id: string; order: number; titleVi?: string; titleEn?: string };
  hasGridImage: boolean;
  onToggleLock: () => void;
  onRegen: () => void;
  onDownload: () => void;
  onEdit: () => void;
  onUploadVideo: () => void;
}

function GridCell({
  cell,
  shot,
  hasGridImage,
  onToggleLock,
  onRegen,
  onDownload,
  onEdit,
  onUploadVideo,
}: GridCellProps) {
  if (!cell.shotId || !shot) {
    return (
      <div className="ksp-storyboard-cell ksp-storyboard-cell-empty">
        <span className="ksp-storyboard-cell-empty-label">—</span>
      </div>
    );
  }

  if (!hasGridImage) {
    return (
      <div
        className="ksp-storyboard-cell ksp-storyboard-cell-no-upload"
        onClick={onEdit}
        role="button"
        tabIndex={0}
        title="Click to edit shot"
        style={{ cursor: "pointer" }}
      >
        <span className="ksp-storyboard-cell-shot-num">Shot {shot.order}</span>
        <span className="ksp-storyboard-cell-no-upload-label">chưa có ảnh</span>
      </div>
    );
  }

  return (
    <div
      className="ksp-storyboard-cell ksp-storyboard-cell-filled"
      onClick={onEdit}
      role="button"
      tabIndex={0}
      title="Click to edit shot"
      style={{ cursor: "pointer" }}
    >
      {cell.dataUrl ? (
        <img
          src={cell.dataUrl}
          alt={`Shot ${shot.order}`}
          className="ksp-storyboard-cell-img"
        />
      ) : (
        <span className="ksp-storyboard-cell-loading">crop...</span>
      )}
      <span className="ksp-storyboard-cell-shot-num">Shot {shot.order}</span>
      {/* Video uploaded badge */}
      {cell.video?.dataUrl && (
        <span
          className="ksp-storyboard-cell-video-badge"
          title={`Video uploaded: ${cell.video.filename}`}
        >
          ▶
        </span>
      )}
      <div className="ksp-storyboard-cell-actions">
        <button
          type="button"
          className="ksp-storyboard-cell-btn"
          onClick={(e) => {
            e.stopPropagation();
            onUploadVideo();
          }}
          title={cell.video ? "Replace uploaded video" : "Upload video for this shot"}
        >
          🎬
        </button>
        <button
          type="button"
          className={`ksp-storyboard-cell-btn ${cell.locked ? "locked" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          title={cell.locked ? "Unlock" : "Lock"}
        >
          {cell.locked ? "🔒" : "🔓"}
        </button>
        <button
          type="button"
          className="ksp-storyboard-cell-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRegen();
          }}
          title="Regen frame"
          disabled={cell.locked}
        >
          🔄
        </button>
        <button
          type="button"
          className="ksp-storyboard-cell-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDownload();
          }}
          title="Download PNG"
          disabled={!cell.dataUrl}
        >
          📥
        </button>
      </div>
    </div>
  );
}
