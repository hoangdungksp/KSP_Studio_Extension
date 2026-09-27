/**
 * KSP Image v0.9.0 — Sidebar Editor (NEW)
 *
 * Renders v0.9.0 components vertically (1 column ~380px wide).
 * Replaces v0.8.x Editor.tsx (backed up to Editor.tsx.v0.8.x.backup).
 *
 * Layout matches mockups exactly:
 * - Section 1: PROJECT (Project Setting)
 * - Section 2: ASSETS (Cast — Photos only; Film uses AI character bible since r8.1)
 * - Section 3: PIPELINE (Idea → Script → Pacing → Shot List + per-beat video prompts)
 *   with connector lines between steps
 *
 * Mode-adaptive: pipeline blocks differ per mode (Photos vs Film).
 * r8.0: TVC + Product modes removed; Storyboard / Voice / Music / Bundle hidden —
 * Film pipeline ends at Shot List (video prompts are copied per beat).
 */

import React from "react";
import { useAppStore, createEmptyProject, createEmptyShot } from "../store/useAppStore";
import { saveProject } from "../store/db";
import { migrateProjectToV09 } from "../store/migration";
import type { ProjectModeV2 } from "../types/project";

// v0.9.0 components (built in Phase 1-4)
import { ProjectSettingSection } from "./ProjectSettingSection";
import { FilmIdeaScriptSection } from "./FilmIdeaScriptSection";
import { FilmPacingDashboardSection } from "./FilmPacingDashboardSection";
import { FilmShotListSection } from "./FilmShotListSection";
import { PipelineResumeBanner } from "./PipelineResumeBanner";

// v0.9.1 Photos mode components
import { CastPhotosSection } from "./CastPhotosSection";
import { CameraStyleToggle } from "./CameraStyleToggle";
import { PhotosIdeaSection } from "./PhotosIdeaSection";
import { PhotosImageGenSection } from "./PhotosImageGenSection";

// v0.8.x reused (Idea section legacy)
import { IdeaCard } from "./IdeaCard";  // legacy — kept for non-Film modes if any

// Inject v0.9.0 styles
import "./base.css";
import "./components.css";
import "./pipeline.css";
import "./photos.css";
import "./film.css";
// v0_9_2_product.css removed v0.9.3-r1 (TVC archived)

export function Editor() {
  const { currentProject, setCurrentProject, showToast } = useAppStore();

  const handleNewProject = async () => {
    const empty = createEmptyProject();
    empty.shots = [createEmptyShot(1)];
    await saveProject(empty);
    setCurrentProject(empty);
    showToast("Đã tạo project mới", "success");
  };

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#888", marginBottom: 12 }}>Chưa có project nào.</p>
          <button
            onClick={handleNewProject}
            className="px-4 py-2 bg-ksp-accent text-black font-semibold rounded"
          >
            + Tạo project mới
          </button>
        </div>
      </div>
    );
  }

  const migrated = migrateProjectToV09(currentProject);
  // r8.0: TVC / Product removed — legacy projects saved with those modes render as Film.
  const rawMode = (migrated.settingV2?.mode ?? "photos") as ProjectModeV2;
  const mode: "photos" | "film" = rawMode === "photos" ? "photos" : "film";

  // r5: Shot detail is now an INLINE EXPAND DRAWER inside FilmStoryboardSection
  // (no longer a modal-style route that replaces the sidebar). The focusedShotId
  // pattern from v0.9.0 is gone; per-shot state lives in filmV093.expandedShotId.

  // Connector colors mode-aware: Cast (purple) → next pipeline section
  // Photos: → CAMERA STYLE (cyan #5ecac8)
  // Film: → IDEA (green #5dcaa5)
  const castToNextColor = mode === "photos" ? "#5ecac8" : "#5dcaa5";

  return (
    <div
      className="ksp-sidebar-v09"
      onClick={(e) => {
        // Click on a section header → toggle collapse on the parent .ksp-section
        const target = e.target as HTMLElement;
        const header = target.closest(".ksp-section-header");
        if (!header) return;
        // Don't toggle if clicked on an interactive element inside header
        if (target.closest("button, input, select, a")) return;
        const section = header.closest(".ksp-section");
        if (!section) return;
        section.classList.toggle("ksp-section-collapsed");
      }}
    >
      {/* Section 1: PROJECT */}
      <ProjectSettingSection />
      <Connector colorFrom="#6da9d6" colorTo={mode === "photos" ? "#c490c4" : "#5dcaa5"} />

      {/* Section 2: ASSETS — Photos only.
          r8.1: Film has no Cast step — characters come from the AI character bible
          (auto-chain stage "characters"), shown/edited at the top of Shot List. */}
      {mode === "photos" ? (
        <>
          <CastPhotosSection />
          <Connector colorFrom="#c490c4" colorTo={castToNextColor} />
        </>
      ) : null}

      {/* Section 3: PIPELINE — adaptive per mode */}
      {mode === "photos" && <PhotosPipeline />}
      {mode === "film" && <FilmPipeline />}
    </div>
  );
}

// ============================================================================
// PIPELINE LAYOUTS (per mode)
// ============================================================================

function FilmPipeline() {
  // read settings to conditionally render Pacing Dashboard
  const currentProject = useAppStore((s) => s.currentProject);
  const setting: any = (currentProject as any)?.settingV2;
  const showPacingDashboard = setting?.showPacingDashboard ?? true;

  return (
    <>
      {/* r7.29 Feature 1B: Cross-session resume banner (shows when pipeline incomplete) */}
      <PipelineResumeBanner />

      <FilmIdeaScriptSection />
      <Connector colorFrom="#f0a677" colorTo={showPacingDashboard ? "#534AB7" : "#D4537E"} />

      {/* Pacing Dashboard — conditionally rendered per setting.showPacingDashboard */}
      {showPacingDashboard && (
        <>
          <FilmPacingDashboardSection />
          <Connector colorFrom="#534AB7" colorTo="#D4537E" />
        </>
      )}

      <FilmShotListSection />
    </>
  );
}

// TvcPipeline + ProductPipeline removed v0.9.3-r1; mode options removed r8.0.

function PhotosPipeline() {
  return (
    <>
      <CameraStyleToggle />
      <Connector colorFrom="#5ecac8" colorTo="#e8c874" />

      <PhotosIdeaSection />
      <Connector colorFrom="#e8c874" colorTo="#f09090" />

      <PhotosImageGenSection />
    </>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        color: "#666",
        letterSpacing: "0.12em",
        marginTop: 16,
        marginBottom: 8,
        paddingLeft: 4,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function PipelineStep({
  stepNum,
  icon,
  label,
  color,
  children,
}: {
  stepNum: number;
  icon: string;
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  const colorMap: Record<string, string> = {
    green: "rgba(94, 202, 165, 0.3)",
    orange: "rgba(240, 166, 119, 0.3)",
    "purple-light": "rgba(175, 169, 236, 0.3)",
    "purple-dark": "rgba(196, 144, 196, 0.3)",
    blue: "rgba(133, 183, 235, 0.3)",
  };
  const accentColor: Record<string, string> = {
    green: "#5dcaa5",
    orange: "#f0a677",
    "purple-light": "#afa9ec",
    "purple-dark": "#c490c4",
    blue: "#85b7eb",
  };
  return (
    <div
      style={{
        border: `0.5px solid ${colorMap[color] ?? "#2a2a2c"}`,
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.015)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: `0.5px solid ${colorMap[color] ?? "#2a2a2c"}`,
        }}
      >
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            fontWeight: 500,
            color: accentColor[color] ?? "#ccc",
          }}
        >
          {stepNum}. {label}
        </span>
      </header>
      {children}
    </div>
  );
}

export function Connector({ colorFrom, colorTo }: { colorFrom: string; colorTo: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 0",
      }}
    >
      <div
        style={{
          width: 7,
          height: 7,
          border: `1px solid ${colorFrom}`,
          borderRadius: "50%",
          background: "#0e0e10",
        }}
      />
      <div
        style={{
          width: "0.5px",
          height: 10,
          background: `linear-gradient(to bottom, ${colorFrom}, ${colorTo})`,
        }}
      />
      <div
        style={{
          width: 7,
          height: 7,
          border: `1px solid ${colorTo}`,
          borderRadius: "50%",
          background: "#0e0e10",
        }}
      />
    </div>
  );
}
