/**
 * KSP Image r8.1 — Character bible block (Film mode, top of Shot List)
 *
 * Replaces the Cast section: characters are created by AI from the idea
 * (auto-chain stage "characters"). Jason can read and tweak each fixed
 * appearance text here — it is copied verbatim into every video prompt,
 * so edits apply to all clips generated afterwards.
 */

import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { updateCharacter } from "../store/film_actions";
import type { FilmCharacter } from "../types/film";
import "./beatPrompt.css";

const ROLE_VI: Record<FilmCharacter["role"], string> = {
  protagonist: "Chính",
  antagonist: "Phản diện",
  companion: "Đồng hành",
  extra: "Phụ",
};

export function CharacterBibleBlock({ characters = [] }: { characters?: FilmCharacter[] }) {
  const updateProject = useAppStore((s) => s.updateCurrentProject);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (characters.length === 0) return null;

  return (
    <div className="ksp-beatprompt ksp-charbible">
      <button type="button" className="ksp-charbible-head" onClick={() => setOpen(!open)}>
        <span className="ksp-beatprompt-title">👥 NHÂN VẬT ({characters.length})</span>
        <span className="ksp-beatprompt-meta">{open ? "▴ thu gọn" : "▾ xem / sửa"}</span>
      </button>
      {open && (
        <>
          <p className="ksp-beatprompt-hint">
            AI tạo từ ý tưởng. Mô tả ngoại hình được chép nguyên văn vào mọi video prompt để nhân vật giống nhau giữa các clip — sửa ở đây rồi Generate lại prompt.
          </p>
          {characters.map((c) => (
            <div key={c.id} className="ksp-charbible-item">
              <div className="ksp-beatprompt-label">
                <strong>{c.name || "(chưa đặt tên)"}</strong>{" "}
                <span className="ksp-beatprompt-meta">· {ROLE_VI[c.role]}</span>
              </div>
              <textarea
                className="ksp-beatprompt-textarea"
                rows={3}
                value={drafts[c.id] ?? c.description}
                onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })}
                onBlur={() => {
                  const d = drafts[c.id];
                  if (d !== undefined && d !== c.description) {
                    updateProject((p) => updateCharacter(p, c.id, { description: d }));
                  }
                  const { [c.id]: _, ...rest } = drafts;
                  setDrafts(rest);
                }}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
