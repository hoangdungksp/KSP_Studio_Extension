/**
 * Runtime smoke test — render Editor.tsx in jsdom, catch crashes.
 *
 * This is what we should have run BEFORE shipping each phase.
 * It catches:
 * - Missing imports
 * - Migration crashes
 * - Component render errors
 * - Hook initialization issues
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Editor } from "../src/components/Editor";
import { useAppStore } from "../src/store/useAppStore";

describe("Editor sidebar v0.9.0 — runtime smoke tests", () => {
  beforeEach(() => {
    cleanup();
    // Reset store
    useAppStore.setState({ currentProject: null });
  });

  it("renders without project (empty state)", () => {
    const { container } = render(<Editor />);
    // Should show "no project" empty state, not crash
    expect(container.textContent).toContain("project");
  });

  it("renders with empty v0.8.x project (Photos mode after migration)", () => {
    const project: any = {
      id: "test-1",
      name: "Test Project",
      mode: "lifestyle",
      shots: [],
      createdAt: Date.now(),
    };
    useAppStore.setState({ currentProject: project });
    const { container } = render(<Editor />);
    expect(container.innerHTML).toContain("ksp-sidebar-v09");
  });

  it("renders TVC mode", () => {
    const project: any = {
      id: "test-2",
      name: "TVC test",
      mode: "tvc_commercial",
      industry: "skincare",
      idea: { raw: "Test idea" },
      shots: [],
      createdAt: Date.now(),
      schemaVersion: "v0.9",
      settingV2: {
        name: "TVC test",
        mode: "tvc_commercial",
        industry: "skincare",
        aspectRatio: "9:16",
        timeFormat: "integer",
        aiProviders: {
          scriptWriter: "gemini-flash",
          conceptWriter: "gemini-flash",
          storyboardFrames: "gemini-flash",
          imageGen: "imagen-4-standard",
          voiceTts: "elevenlabs",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
    useAppStore.setState({ currentProject: project });
    const { container } = render(<Editor />);
    expect(container.innerHTML).toContain("ksp-sidebar-v09");
  });

  it("renders Film mode with all sections", () => {
    const project: any = {
      id: "test-3",
      name: "Film test",
      mode: "film",
      idea: { raw: "Robot in forest" },
      shots: [],
      createdAt: Date.now(),
      schemaVersion: "v0.9",
      settingV2: {
        name: "Film test",
        mode: "film",
        genre: "drama",
        animationStyle: "live_action",
        aspectRatio: "21:9",
        durationMinutes: 5,
        timeFormat: "integer",
        aiProviders: {
          scriptWriter: "gemini-flash",
          conceptWriter: "gemini-flash",
          storyboardFrames: "gemini-flash",
          imageGen: "imagen-4-standard",
          voiceTts: "elevenlabs",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      filmCharactersV2: [],
      filmStructureV2: { totalDurationMinutes: 5, scenes: [] },
    };
    useAppStore.setState({ currentProject: project });
    const { container } = render(<Editor />);
    const html = container.innerHTML;
    expect(html).toContain("ksp-sidebar-v09");
    // v0.9.1 r10: separators "━━━ PROJECT/ASSETS/PIPELINE ━━━" removed.
    // Verify Project Setting renders. r8.1: Film mode has NO Cast section (AI character bible).
    expect(html).toContain("ksp-project-setting");
    expect(html).not.toContain("ksp-cast-photos");
  });

  it("renders v0.8.x legacy project without crashing (migration path)", () => {
    // Simulate an unmigrated v0.8.1 project
    const project: any = {
      id: "legacy-1",
      name: "Old project",
      mode: "lifestyle",
      idea: { raw: "Cô gái cafe Đà Lạt" },
      industry: "fnb",
      shots: [],
      createdAt: Date.now() - 1000000,
      // No schemaVersion, no settingV2 — must auto-migrate
    };
    useAppStore.setState({ currentProject: project });
    const { container } = render(<Editor />);
    expect(container.innerHTML).toContain("ksp-sidebar-v09");
  });
});
