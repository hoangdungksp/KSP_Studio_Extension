import { useEffect, useState } from "react";
import { useAppStore, createEmptyProject } from "../store/useAppStore";
import { listProjects, saveProject, processPendingImports } from "../store/db";
import { Editor } from "./Editor";
import { Library } from "./Library";
import { Projects } from "./Projects";
import { Settings } from "./Settings";
import { Toast } from "./Toast";

export function App() {
  const { activeView, setActiveView, currentProject, setCurrentProject, showToast } = useAppStore();
  const [projectCount, setProjectCount] = useState(0);

  useEffect(() => {
    (async () => {
      const imported = await processPendingImports();
      if (imported > 0) {
        showToast(`📥 Đã nhập ${imported} ảnh từ Pinterest`, "success");
      }

      const projects = await listProjects();
      setProjectCount(projects.length);
      if (projects.length > 0) {
        setCurrentProject(projects[0]);
      } else {
        const empty = createEmptyProject();
        await saveProject(empty);
        setCurrentProject(empty);
        setProjectCount(1);
      }
    })();
  }, []);

  // Update project count when changes
  useEffect(() => {
    listProjects().then((p) => setProjectCount(p.length));
  }, [currentProject?.id]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const handler = async (msg: any) => {
      if (msg?.type === "PENDING_IMPORT_ADDED") {
        const imported = await processPendingImports();
        if (imported > 0) {
          showToast(`📥 Đã nhập ${imported} ảnh từ Pinterest`, "success");
        }
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [showToast]);

  useEffect(() => {
    if (currentProject) {
      const timer = setTimeout(() => {
        saveProject(currentProject);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentProject]);

  return (
    <div className="flex flex-col h-screen bg-ksp-bg">
      <header className="flex items-center justify-between px-4 py-3 border-b border-ksp-border bg-ksp-panel">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-ksp-accent to-purple-600 flex items-center justify-center text-base font-extrabold text-black shadow-lg">
            K
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">KSP Image</h1>
            <div className="text-[10px] text-ksp-muted leading-tight">v0.9.4-r8.1 · Film + Photos</div>
          </div>
        </div>
      </header>

      <nav className="flex items-center gap-1 px-2 py-1.5 border-b border-ksp-border bg-ksp-panel/50">
        <TabButton active={activeView === "editor"} onClick={() => setActiveView("editor")}>
          ✏️ Editor
        </TabButton>
        <TabButton active={activeView === "history"} onClick={() => setActiveView("history")}>
          📁 Projects ({projectCount})
        </TabButton>
        <TabButton active={activeView === "library"} onClick={() => setActiveView("library")}>
          📚 Library
        </TabButton>
        <button
          onClick={() => setActiveView("settings")}
          className={`px-2 py-1.5 text-xs rounded transition-colors flex-shrink-0 ${
            activeView === "settings"
              ? "bg-ksp-accent text-black font-semibold"
              : "text-ksp-muted hover:text-ksp-text hover:bg-ksp-bg"
          }`}
          title="Settings"
        >
          ⚙️
        </button>
      </nav>

      <main className="flex-1 overflow-y-auto">
        {activeView === "editor" && <Editor />}
        {activeView === "library" && <Library />}
        {activeView === "history" && <Projects />}
        {activeView === "settings" && <Settings />}
      </main>

      <Toast />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
        active
          ? "bg-ksp-accent text-black font-semibold"
          : "text-ksp-muted hover:text-ksp-text hover:bg-ksp-bg"
      }`}
    >
      {children}
    </button>
  );
}
