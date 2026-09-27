# KSP Studio (KSP Image Extension)

Chrome extension (Manifest V3, side panel) dùng để làm phim bằng AI. 2 mode: **Photos** (prompt ảnh Banana Pro) và **Film**.
Film pipeline: Project → Idea → Script (AI tự tạo nhân vật — không còn Cast) → Pacing → Shot List → **video prompt theo beat** (Gemini Omni Flash / Seedance 2.5 / Grok Imagine).
Storyboard ẩn (code còn, không render); Voice / Music / Bundle / TVC / Product đã bỏ (r8.0).
Trọng tâm hiện tại: chất lượng prompt video — `src/engine/beatVideoPrompt.ts` (thông số model ở `VIDEO_MODEL_SPECS`).
Đây là dự án **làm phim độc lập**, KHÔNG liên quan kênh YouTube DungThichVar hay KSP AutoFlow.

## Tài liệu dự án

- `HANDOFF.md` — trạng thái hiện tại, quy tắc, sprint gần nhất. **Đọc trước khi làm việc**; cập nhật cuối mỗi phiên.
- `CHANGELOG.md` — lịch sử các phiên bản/sprint.
- `README.md` — hướng dẫn cài đặt cũ (theo luồng zip ~/Downloads, nay đã chuyển sang git).

## Stack

- Vite 5 + `@crxjs/vite-plugin` + React 18 + TypeScript + Tailwind
- State: zustand; lưu trữ local: IndexedDB qua Dexie
- AI provider: Gemini, OpenAI (GPT Image), Imagen, Omni… — gọi từ `src/engine/*`
- Test: vitest + happy-dom (`test/`)

## Cấu trúc

- `src/sidepanel.tsx`, `src/editor.tsx`, `src/background.ts`, `src/snipper.ts` — entry points
- `src/components/` — UI React (Film*Section.tsx cho từng bước pipeline, `BeatPromptPanel.tsx` cho video prompt)
- `src/engine/` — logic prompt/AI (film*, omni*, grid*, themes, magicPhrases…)
- `src/store/`, `src/types/`, `src/styles/`

## Lệnh

```bash
npm install          # lần đầu
npm run build        # tsc + vite build → dist/
npm run dev          # build --watch
npx vitest run       # chạy test
```

Load vào Chrome: `chrome://extensions` → Developer mode → Load unpacked → chọn `dist/`.
Sau khi build lại chỉ cần bấm ↻ trên card extension.

Git: repo `hoangdungksp/KSP_Studio_Extension`, nhánh `main`. Dùng git trực tiếp thay cho `update.sh` / `git-upload.sh` (hai script đó thuộc luồng zip cũ).

## Quy trình làm việc với Jason

Jason KHÔNG tự chạy lệnh build/test. Việc của Jason chỉ là bấm ↻ trên `chrome://extensions` rồi test.
Nên mỗi task Claude phải tự làm trọn: sửa code → `npx vitest run` → `npm run build` pass → mới báo xong.
Hook `Stop` trong `.claude/settings.json` (`scripts/auto-build.sh`) là lưới an toàn: cuối mỗi lượt nếu source mới hơn `dist/` thì tự build; build lỗi sẽ chặn Claude kết thúc và đưa log lỗi để sửa.
Khi báo xong task: nói rõ Jason cần test gì trên extension. Nếu đổi `manifest.json` (permissions, entry mới) thì nhắc Jason có thể phải gỡ và Load unpacked lại.

## Quy tắc bất di bất dịch

1. **KHÔNG hardcode nội dung của một câu chuyện cụ thể** (tên nhân vật, địa điểm, scene) vào AI prompt. Dùng abstract pattern, `<placeholder>`, hoặc ≥3 ví dụ từ genre khác nhau. Chi tiết + lệnh grep kiểm tra: xem đầu `HANDOFF.md`.
2. Build (`npm run build`) và test (`npx vitest run`) phải pass trước khi commit.
3. Cuối phiên làm việc → cập nhật `HANDOFF.md` + `CHANGELOG.md`.
