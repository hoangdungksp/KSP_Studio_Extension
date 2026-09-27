# KSP Image Chrome Extension — Handoff Document

## Status: `v0.9.4-r8.1-idea-only-film` (build + tests pass, chưa test tay trên Chrome)

**Last updated:** 2026-09-26 (Sprint r8.1 — bỏ Cast ở Film, character bible AI, ngôn ngữ thoại)

**Project state:** Extension còn 2 mode: **Photos** và **Film**. Film chỉ cần **Idea** (không còn Cast). Film pipeline dừng ở **Shot List**: Idea → Script (stage 1-4 → **characters** → stage 5) → Pacing → Shot List → **video prompt theo beat** (Gemini Omni Flash / Seedance 2.5 / Grok Imagine). Storyboard ẩn (code còn, không render, auto-chain không chạy grid-build). Voice / Music+SFX / Bundle Export đã xoá. TVC + Product đã xoá khỏi UI (project cũ mode đó render như Film).

**Note:** KSP Image là dự án **làm phim độc lập**, KHÔNG liên quan kênh YouTube DungThichVar hay project KSP AutoFlow.

**Dev setup (từ 2026-09-25):** source ở `~/Documents/KSP_Studio`, git repo `hoangdungksp/KSP_Studio_Extension` (branch main). Claude tự build/test; Stop hook `scripts/auto-build.sh` build lại `dist/` cuối mỗi lượt. Jason chỉ bấm ↻ ở chrome://extensions. Các mục "Source code locations" / zip / update.sh bên dưới là luồng cũ.

---

## Sprint r8.1 summary (current) — Film chỉ cần Idea

- **Bỏ Cast section ở Film** (Photos vẫn giữ CastPhotosSection). Bỏ 2 guard "phải có character".
- **Character bible** `src/engine/characterBible.ts`: auto-chain stage mới `"characters"` giữa script-stage-4 và script-stage-5 → 1 AI call rút nhân vật từ idea + scenes, mỗi nhân vật 1 đoạn ngoại hình tiếng Anh cố định (35–60 từ) lưu vào `FilmCharacter.description`. Stage bị skip nếu project đã có nhân vật (project cũ dùng Cast). Luồng wizard thủ công Stage 5 cũng tự tạo bible nếu thiếu.
- Beat prompt chép **nguyên văn** mô tả nhân vật vào mọi clip → nhân vật đồng nhất giữa các clip.
- `CharacterBibleBlock` ở đầu Shot List: xem/sửa mô tả (sửa xong phải Generate lại prompt — fingerprint không tính mô tả nhân vật).
- **Ngôn ngữ thoại**: `settingV2.dialogueLanguage` ("en" mặc định | "vi"), Project Setting hiện khi Dialog = Có thoại. Prompt vẫn viết tiếng Anh, chỉ câu thoại dùng lineVi, và prompt nêu "dialogue spoken in <language>".
- Không còn ảnh concept sheet cho project mới → prompt không có ảnh ref (Grok được 15s). Project cũ có conceptSheet vẫn dùng.

---

## Sprint r8.0 summary (previous) — Beats → Video Prompt

**Ý tưởng:** mỗi *scene beat* (beat nhỏ trong scene, nút 🎯 View beats) có prompt video để copy. Beat ngắn (2-3s) → tick nhiều beat liền nhau → "Ghép & Generate" thành 1 clip.

**Engine `src/engine/beatVideoPrompt.ts`:**
- Beat → shots lấy live từ `shot.coveredBeatIds` (dedupe shot phủ 2 beat).
- Timeline giây nguyên liên tục tính bằng code, fit theo từng model trong `VIDEO_MODEL_SPECS` (một chỗ duy nhất): Omni 3–10s (`image_0`), Seedance 4–30s (`Image 1`), Grok ≤15s / ≤10s khi có ảnh ref (`reference image 1`). Vượt → nén, thiếu → giãn, quá nhiều shot → gộp.
- Thoại: dùng `dialog.timingSeconds` nếu mọi câu có timing, không thì đưa cả scene cho AI lọc. Tắt khi setting dialog = no_dialog.
- Ảnh ref: nhân vật có tên trong shot (fallback protagonist) và có conceptSheet → đánh số theo thứ tự, nút ⬇ Refs tải ZIP đúng thứ tự.
- 1 AI call (`callAi`, provider = scriptWriter) → JSON `{omni, seedance, grok}`. System prompt `BEAT_VIDEO_SYSTEM_PROMPT` chỉ dùng `<placeholder>`.
- `sourceFingerprint` → prompt hiện "⚠ shot đã đổi" khi shot list / beat thay đổi.

**Data:** `FilmSceneScript.beatPrompts?: BeatPromptGroup[]` (`beatIds`, `prompts`, `editedModels`, `sourceFingerprint`). Ghép beat → xoá group cũ chồng beat. Sửa tay → `editedModels`, Generate lại hỏi xác nhận.

**UI `src/components/BeatPromptPanel.tsx`** (trong mỗi scene card của Shot List, dưới bảng shot): checkbox từng beat, thanh ghép hiện tổng giây + độ vừa từng model, 3 tab prompt, textarea sửa được, Copy / Generate lại / ⬇ Refs / ✂ Tách.

**Removals:** grid-build khỏi auto-chain (`AUTO_CHAIN_SECTION_ORDER`), abort record cũ "grid-build" bị banner bỏ qua (`isKnownSectionId`). Xoá FilmVoiceSection / FilmMusicSfxSection / FilmBundleExportSection / filmBundleExporter + test của chúng. Project Setting bỏ Industry, Concept Writer, Storyboard frames, Voice TTS, key ElevenLabs/Google TTS/Suno.

**Chưa làm / cần Jason test:** chất lượng prompt thật từ AI (key nằm trong extension, CLI không gọi được); thông số model lấy từ guide bên thứ ba 09/2026 — sai thì sửa `VIDEO_MODEL_SPECS`. Ghép beat chỉ trong 1 scene.

---

## ⚠️ RULE TUYỆT ĐỐI — KHÔNG hardcode story-specific content vào AI prompts

**Lý do**: Ngày 21/5/2026, Jason phát hiện 6 chỗ trong codebase có hardcoded examples về câu chuyện cụ thể của anh (Robot N.A.M.O / forest / moss / woodpecker / "Optical sensor" / "claws on moss"). Khi anh đổi sang câu chuyện khác (Gấu Bự mùa đông, bãi biển, samurai...), AI vẫn bias output theo template robot/forest cũ.

**Rule**:
1. **KHÔNG được hardcode** tên character, tên địa điểm, tên scene cụ thể của bất kỳ câu chuyện nào vào AI system prompts.
2. **KHÔNG được dùng examples concrete** kiểu `(vd: "Robot tỉnh dậy", "Mắt LED sáng dần")` trong field descriptions của AI prompt — vì AI sẽ bias bắt chước.
3. **Cách đúng** — chọn 1 trong 3:
   - **Abstract pattern**: mô tả format không có nội dung cụ thể (e.g. `"3-5 từ tiếng Việt, đặc tả hành động chính của shot — phải PHÙ HỢP với scene action + cast nhập"`)
   - **Format pattern with placeholders**: dùng `<placeholder>` để chỉ shape (e.g. `"<color/material> <body-part>"`)
   - **Multiple diverse examples** ≥3 từ genre/setting KHÁC NHAU để show variety, không bias 1 type (e.g. 3 film references: Wall-E sci-fi + Princess Mononoke anime fantasy + Blade Runner 2049 noir)
4. **Template literal placeholders như `${sceneSettings}`, `${characterName}` là HỢP LỆ** — chúng render dynamic theo data project, không phải hardcode.
5. **Negative examples warning AI hợp lệ** (e.g. `"Nếu story là sóc, ĐỪNG bịa robot/human"`) — đây là constraint, không phải bias.

**Audit toàn bộ codebase Sprint r7.31 đã verify 6 chỗ fixed** (filmShotListGeneration.ts:220, filmScriptStages.ts:1650-1651/1798-1803/1871-1874, filmCastGeneration.ts:357, filmShotListGeneration.ts:162).

**Khi review code prompt mới: chạy command này verify**:
```bash
grep -nE "vd:|VD:|Example:|Examples:|ví dụ:|Ví dụ:|e\.g\." src/engine/*.ts | grep -v "test\|@deprecated"
```
Nếu có example trong AI prompt body → phải kiểm tra có bias 1 câu chuyện cụ thể không. Nếu có → fix ngay theo 3 cách ở rule #3 trên.

---

## Sprint r7.31 summary (current) — Audit + remove hardcoded story-specific examples

### Bug

Jason phát hiện em fix Bug 1 r7.30 đã hardcode example `"EXT. TROPICAL FOREST — DAY"` trong prompt mẫu em show ở message thảo luận. Em clarify đó là OUTPUT RENDERED từ `${sceneSettings}` placeholder (KHÔNG hardcode trong code), nhưng Jason yêu cầu audit TOÀN BỘ codebase phòng các chỗ khác cũng có bias.

### Audit phát hiện 6 chỗ hardcode THẬT trong AI prompts:

| # | File:line | Bug |
|---|---|---|
| 1 | `filmShotListGeneration.ts:220` | `(vd: "Robot tỉnh dậy", "Mắt LED sáng dần", "Tay rỉ sét cử động")` — AI bias tạo title về robot |
| 2 | `filmScriptStages.ts:1650-1651` | `"Mật mã 3-5 nhịp", "Cảm biến quang học"` / `"3-5 tap code", "Optical sensor"` — setup/payoff labels bias robot/tech |
| 3 | `filmScriptStages.ts:1798-1803` | 6 beat examples: "Wide forest sweep", "Tilt down reveals robot", "Woodpecker lands on head"... |
| 4 | `filmScriptStages.ts:1871-1874` | Color script example "Scene Robot Awakening in Ancient Forest" với colors forest green/orange rust/electric blue |
| 5 | `filmCastGeneration.ts:357` | anchorTokens example "moss-covered grey-green metal body", "single glowing blue right sensor"... |
| 6 | `filmShotListGeneration.ts:162` | beat merge example "claws on moss" + "tiny grip texture" |

### Fix strategy

Cả 6 chỗ → đổi sang **1 trong 3 cách** theo rule mới:
- **Abstract pattern**: `"3-5 từ TIẾNG VIỆT, đặc tả hành động chính — phải PHÙ HỢP với scene action + cast"`
- **Format placeholder**: `"<color/material> <body-part>"`, `"<state-A> → <state-B>"`
- **Multiple diverse examples** từ genre KHÁC NHAU (chỉ giữ 1 chỗ ở line 1841 với 3 film references đa dạng: Wall-E sci-fi + Princess Mononoke fantasy + Blade Runner 2049 noir)

### Files changed

| File | Hardcode → Fix |
|---|---|
| `src/engine/filmShotListGeneration.ts` | Line 220 + line 162: abstract pattern descriptions |
| `src/engine/filmScriptStages.ts` | Line 1650-1651: abstract labelVi/labelEn format; Line 1798-1803: 5 abstract beat patterns; Line 1871-1874: format pattern guide với 5 environment categories thay vì 2 concrete examples |
| `src/engine/filmCastGeneration.ts` | Line 357: abstract format pattern + explicit "NEVER copy tokens from this instruction" |
| `HANDOFF.md` | New **RULE TUYỆT ĐỐI** section với 5 rules + verification grep command |
| `manifest.json` + `package.json` | Bump 0.9.4.47 → 0.9.4.48, r7.30 → r7.31-no-hardcode-prompts |

### Build state

- Version: `0.9.4.48` / `0.9.4-r7.31-no-hardcode-prompts`
- TypeScript: 0 errors
- Vitest: 626/638 PASS (no test changes — pure prompt refactor)
- Vite build: pending
- `grep require dist/*` = 0 ✓ (pending verify)

---

## Sprint r7.30 summary (previous) — Scene boundary fix + Regen UI reposition

### Bug 1 — Scene grid cross-scene hallucination

Jason báo: gen storyboard grid Scene 1 (rừng nhiệt đới). PNG output có 9 cells nhưng 3-4 cells là **cánh đồng cỏ vàng** — setting của Scene 2/3, không phải Scene 1.

**Diagnosis**: Em đọc 9 per-shot prompts trong zip Jason upload + đọc code `buildSceneGridImagePrompt()`. Tất cả prompts ĐÚNG Scene 1. Code KSP không inject cross-scene content.

→ Root cause: **AI image gen hallucinate** vì prompt cũ có keyword `"Cinematic storyboard grid (GRID 1 of N)"` + `"Story context:"` → AI tự suy luận phải show progression cả câu chuyện.

### Fix Bug 1 — Siết Scene Boundary trong grid prompt

6 thay đổi trong `sceneImagePromptBuilder.ts:buildSceneGridImagePrompt`:

| Vị trí | Trước | Sau |
|---|---|---|
| Header | "Cinematic storyboard grid" | "Cinematic storyboard panel — single scene only" |
| Tier 1 NEW | — | **SCENE BOUNDARY block (CRITICAL)** với 5 directives |
| Tier 2 | "Story context: ..." | "This scene's action (ALL cells stay within these events, NO events from other scenes): ..." |
| Tier 3 | "Per cell: vary ..." | + "LOCATION stays "{sceneSettings}" — NEVER drifts" |
| Tier 4 | "must not override Tier 2" | + "or Tier 1 scene boundary" |
| AVOID | (no location rule) | + "cells depicting any location other than "{sceneSettings}"" |

Prompt length +~92 chars (~1% — token budget bump 8500 → 8800).

### Bug 2 — Regen button bị che bởi "Bỏ qua"

Jason báo: nút 🔄 Regen của r7.29 Feature 2A nằm trong `.ksp-preview-flow-title` (header), bị nút "Bỏ qua" ở góc phải header che → click nhầm sẽ thoát modal.

### Fix Bug 2 — Move Regen inline cạnh hint

- Remove khỏi header
- Wrap `.ksp-preview-flow-hint` + Regen button vào container mới `.ksp-preview-flow-hint-row` (flex layout)
- Button label rõ ràng hơn: "🔄 Regen" → "🔄 Regen 4 options"
- CSS đổi style background neutral → orange tint (consistent với theme KSP)

### Files changed

| File | Change |
|---|---|
| `src/engine/sceneImagePromptBuilder.ts` | 6 thay đổi siết scene boundary |
| `src/components/PreviewFlowModal.tsx` | Move Regen khỏi header → inline cạnh hint, new flex wrapper |
| `src/components/film.css` | New `.ksp-preview-flow-hint-row` + Regen restyle |
| `test/film_mode.test.tsx` | +4 tests, token budget bump 8500 → 8800 |
| `manifest.json` + `package.json` | Bump 0.9.4.46 → 0.9.4.47 |

### How Jason tests fix Bug 1

1. Apply zip → reload extension
2. Mở project Robot N.A.M.O → Storyboard section → Scene 1 ("Awakening in the Ancient Forest")
3. Bấm "🔄 Sinh lại grid" (regenerate)
4. Verify: TẤT CẢ 9 cells phải trong rừng nhiệt đới (KHÔNG có cánh đồng cỏ vàng / KHÔNG có thành phố / KHÔNG có robot xác chết)
5. Nếu output VẪN có cells từ scene khác → AI provider hallucinate quá mạnh, em sẽ iterate (e.g. all-caps SCENE BOUNDARY repeat 2x trong Tier 1)

### Build state

- Version: `0.9.4.47` / `0.9.4-r7.30-scene-boundary`
- TypeScript: 0 errors
- Vitest: 626/638 PASS (+4 new tests)
- Vite build: 11.53s
- `grep require dist/*` = 0 ✓

---

## Sprint r7.29 summary (previous) — Resume from error + Regen options per step

### Goal

Jason đề xuất 2 UX feature critical sau khi gặp bug Stage 5 (r7.28-fix):
1. Khi auto-chain bị lỗi ở Stage N → có nút Continue/Re-Generate **TẠI VỊ TRÍ LỖI** để resume xuống cuối — không phải chạy lại từ đầu (tiết kiệm AI cost).
2. Trong Preview Modal mỗi Step → nút Regen để AI tạo 4 options mới nếu không hài lòng.

### Feature 1A — AutoChainRetryBanner (in-section error UX)

`orchestrator.retryFromSection()` backend đã có sẵn từ Sprint 1.0 r7.x, nhưng chỉ wire vào 5 Script Stages trong `FilmIdeaScriptSection`. 3 section còn lại (analyze-scenes, shot-list, grid-build) chưa có UI.

New reusable component `<AutoChainRetryBanner sectionIds={[...]} sectionLabel="..." />`:
- Đọc `autoChainState.sections[id]?.status === "error"` → render banner đỏ với error message + nút "🔄 Retry từ đây"
- Click → `retryFromSection()` với direction lấy từ `project.narrativeDirection` (persisted, không phải local ref)
- Wired vào `FilmShotListSection` (monitors `analyze-scenes` + `shot-list`) + `FilmStoryboardSection` (monitors `grid-build`)

### Feature 1B — PipelineResumeBanner (cross-session resume)

User đóng Chrome → mở lại → `autoChainState` (Zustand) reset → mất state in-memory. Nhưng project data (Dexie/IndexedDB) vẫn còn.

New engine `pipelineProgress.ts` với `derivePipelineProgress(project)` — pure function detect status 8 sections từ PERSISTED DATA:
| Section | "done" khi |
|---|---|
| script-stage-1 | `film.scriptStructure` exists |
| script-stage-2 | `film.scriptBeats.length >= 1` |
| script-stage-3 | `film.scriptTwistsLocked === true` HOẶC `scriptTwists` exists |
| script-stage-4 | `film.scriptIntermediateScenes.length >= 1` |
| script-stage-5 | `film.script.scenes.length >= 1` |
| analyze-scenes | ALL scenes có `beats[]` populated |
| shot-list | ALL scenes có shots trong `shotsBySceneId` |
| grid-build | ALL scenes có grids với `image` populated |

New component `<PipelineResumeBanner />` render ở top Editor:
- Show khi: `isInProgress === true` + có `narrativeDirection` + auto-chain không running + user chưa dismiss session
- UI: banner cam với "✓ Đã xong: {lastCompleted}" + "→ Tiếp theo: {firstMissing}" + nút "▶ Continue" + nút "✕ Dismiss" (sessionStorage)

### Feature 2A — Regen icon in Preview Modal step header

Cache PreviewOption[] hiện active → revisit step → instant return cached. Không có cách gen lại 4 options mới.

- New helper `invalidateCacheForStep(cache, step, picks)` trong `previewFlowSynthesizer.ts` — remove CỤ THỂ entry cho step + pick combination hiện tại (preserves branches khác)
- Modify `loadOptionsForStep(step, opts?: { skipCache?: boolean })` — `skipCache=true` → invalidate + bypass cache lookup → AI gen fresh
- New UI button "🔄 Regen" trong step header (Step 1-5, không có Step 6 Review)
- Tooltip: *"Tạo lại 4 options mới (AI sẽ gen lại với góc nhìn sáng tạo khác)"*
- Loading: spinner "⟳" + disable button
- Cost: ~$0.005 per regen (Gemini Flash)

### Files changed

| File | Type | Change |
|---|---|---|
| `src/components/AutoChainRetryBanner.tsx` | NEW | 95 LOC reusable error banner |
| `src/components/PipelineResumeBanner.tsx` | NEW | 137 LOC cross-session resume banner |
| `src/engine/pipelineProgress.ts` | NEW | 147 LOC `derivePipelineProgress()` |
| `src/engine/previewFlowSynthesizer.ts` | EDIT | +`invalidateCacheForStep()` (60 LOC) |
| `src/components/FilmShotListSection.tsx` | EDIT | +import + render banner |
| `src/components/FilmStoryboardSection.tsx` | EDIT | +import + render banner |
| `src/components/PreviewFlowModal.tsx` | EDIT | +skipCache option + Regen button |
| `src/components/Editor.tsx` | EDIT | +PipelineResumeBanner at top |
| `src/components/film.css` | EDIT | +143 LOC CSS cho 3 banner |
| `test/film_mode.test.tsx` | EDIT | +10 tests cho r7.29 features |
| `manifest.json` + `package.json` | EDIT | Bump 0.9.4.45 → 0.9.4.46 |

### How Jason benefits

**Scenario 1 — Lỗi giữa session**:
Auto-chain run, Stage 7 (Shot List) lỗi → banner đỏ "Phân tích Scenes / Shot List bị lỗi" + nút Retry. Click → resume từ shot-list xuống cuối → Stage 1-6 không bị chạy lại → tiết kiệm 6 AI calls.

**Scenario 2 — Đóng Chrome mở lại**:
User chạy đến Storyboard rồi đóng tab → mở lại → mở project → banner cam ở top: *"⏸️ Pipeline dở dang. ✓ Đã xong: Shot List → Tiếp theo: Storyboard (Grid Build)"* → click Continue.

**Scenario 3 — Preview Modal options không hay**:
Step 2 thấy 4 options không thích → click 🔄 Regen → AI gen 4 options mới với creative angle khác. Steps khác vẫn cache cũ.

### Build state

- Version: `0.9.4.46` / `0.9.4-r7.29-resume-regen`
- TypeScript: 0 errors
- Vitest: 622/634 PASS (+10 new tests)
- Vite build: 11.29s
- `grep require dist/*` = 0 ✓

---

## Sprint r7.28-fix summary (previous) — Critical bug fix: Stage 5 stale film.script leak

### Bug

Jason báo: hôm qua tạo project "Gấu Bự" → chạy auto-chain → OK. Hôm nay đổi idea sang Robot N.A.M.O → re-run → Stage 1-4 hiển thị Robot đúng, **NHƯNG** Section "Phân cảnh" + Shot List + Storyboard vẫn hiển thị Gấu Bự cũ.

### Root cause: 2 bug compound

**Bug A — `Projects.tsx` duplicate handler giữ stale script**: Comment cũ ghi *"Other Film data preserved: characters, script, structure, beats, etc."* — chủ ý sai. Duplicate chỉ reset `shotsBySceneId: {}`, các stage output khác (script, structure, beats, twists, intermediateScenes, narrativeDirection) đều kế thừa từ template.

**Bug B — `runScriptStage5` no_dialog mode SKIP không clear `film.script`**: Robot N.A.M.O là no_dialog (không thoại) → Stage 5 early-return → `film.script` cũ (kế thừa từ duplicate Bug A) không bị thay thế. Downstream (Shot List, Storyboard) đọc `film.script.scenes` cũ.

### Fix 1 — Stage 5 no_dialog REBUILD script no-AI

Thay vì SKIP, build `FilmScript` no-AI từ `scriptIntermediateScenes` mới. Đảm bảo `film.script` luôn fresh khớp intermediateScenes. New helpers `buildNoDialogScript()` + `deriveActFromIndex()`. Set `aiProvider: "manual"` để phân biệt.

### Fix 2 — Duplicate clear all generated data (defensive)

`handleDuplicate` clear: `script`, `scriptStructure`, `scriptBeats`, `scriptTwists`, `scriptTwistsLocked`, `scriptIntermediateScenes`, `scriptScenesLocked`, `scriptStage`, `narrativeDirection`, `sceneGrids`, `shotsBySceneId`. Preserved: `characters`, `settingV2`, `idea`.

### Side effect

Sau r7.28-fix, duplicate project sẽ **clear narrativeDirection** → user phải re-confirm Preview Modal khi mở project mới (intentional vì direction phụ thuộc idea).

### Files changed

| File | Change | LOC |
|---|---|---|
| `src/engine/autoChainOrchestrator.ts` | Stage 5 no_dialog rebuild + 2 helpers | +94 |
| `src/components/Projects.tsx` | Duplicate clear 11 fields + comment + toast | ~30 |
| `test/film_mode.test.tsx` | +3 regression tests | +60 |
| `manifest.json` + `package.json` | Bump 0.9.4.44 → 0.9.4.45 | — |

### Build state

- Version: `0.9.4.45` / `0.9.4-r7.28-fix-stage5-leak`
- TypeScript: 0 errors
- Vitest: 612/624 PASS (+3 new)
- Vite build: 11.38s
- `grep require dist/*` = 0 ✓

---

## Sprint r7.27 summary (previous) — Cinematographer role upgrade

**Goal:** AI shot list generation đang chọn camera mode-agnostic + style-agnostic. Cụ thể trước r7.27: AI có thể pick `dolly_zoom` cho cảnh `chase`, `handheld` cho cảnh `whisper`, `push_in` cho `wide_establishing`. Cũng không filter camera theo animation style (Pixar CGI nên avoid handheld, stop-motion physical constraint không support tracking).

**Solution:** 2 layer constraints inject vào AI shot list system prompt:

### Layer A — FORBIDDEN COMBINATIONS (hard constraints, action-camera)

4 nhóm:
- High-energy keywords (`run, sprint, chase, ...`) → AVOID slow contemplative cameras (`dolly_zoom, push_in, ...`)
- Intimate keywords (`whisper, breathe, tear, ...`) → AVOID motion cameras (`handheld, tracking, oner, ...`)
- `wide_establishing` shot type → AVOID close-up moves (`push_in, dolly_zoom, ...`)
- Static object scenes → AVOID `handheld, tracking`

### Layer B — STYLE-SPECIFIC CAMERA SIGNATURE filter

`buildStyleCameraConstraints(animationStyle)` returns PREFER/AVOID/REASON block per `AnimationStyleV2`:
- `live_action`: full vocab, no AVOID
- `cgi_3d_cinematic` (Pixar/DreamWorks): PREFER `static, oner, push_in, dolly_in, tracking`; AVOID `handheld` (CGI shake reads low-budget)
- `anime_2d` (Ghibli): PREFER `pan, tilt, static`; AVOID `dolly_zoom` (drawn-cel limitation)
- `cartoon_2d`: PREFER simple `static, pan, tilt`; AVOID specialty Omni moves
- `stop_motion` (Wes Anderson/Aardman): PREFER `static, locked_off, pan, push_in`; AVOID `tracking, oner, handheld` (physical rig)
- `film_noir`: PREFER `static, dolly_zoom (Hitchcock vertigo), push_in`; AVOID modern styles
- Unknown style → empty string (graceful)

### Wire-up

Both AI shot list system prompts now get `buildAiPromptRules() + buildStyleCameraConstraints(setting.animationStyle)`:
1. `generateShotListForScene` (line 215-217)
2. `regenSingleShot` (cũ chỉ có 11-value camera list inline → fix luôn dùng `CAMERA_MOVEMENT_VALUES` đầy đủ 19 values + apply r7.27 rules)

### Files changed

| File | Change | LOC delta |
|---|---|---|
| `src/types/cameraMovement.ts` | +FORBIDDEN section, +buildStyleCameraConstraints() | +103 |
| `src/engine/filmShotListGeneration.ts` | Import + inject 2 places + fix regenSingleShot | +3, prompt rewrite |
| `test/film_mode.test.tsx` | +8 tests | +98 |
| `manifest.json` + `package.json` | Bump 0.9.4.43 → 0.9.4.44 | — |

### Build state

- Version: `0.9.4.44` / `0.9.4-r7.27-camera-rules`
- TypeScript: 0 errors
- Vitest: 609/621 PASS (+8 new tests)
- Vite build: 10.15s
- `grep require dist/*` = 0 ✓

---

## Sprint r7.26 summary (previous) — Omni Prose mode rewrite

**Goal:** Integrate Gemini Omni prompt format theo guide official DeepMind (https://deepmind.google/models/gemini-omni/prompt-guide/). r7.22 Omni builders đang dùng Veo3-style **structured** (label "Setting:", "Camera:", "Lighting:", "Audio:", "Style:", "Negative:") trong khi guide official chỉ ra Omni cần **flowing prose** đan 5 element (Shot framing, Style, Lighting, Location, Action) trong 1 câu duy nhất.

**Decision:** REWRITE Omni builders in-place (KHÔNG tách 2 phiên bản). Veo3 builder giữ nguyên — Veo3 vẫn cần prescriptive.

### Single-shot output format

Pattern: `"A {shotType} {motionPhrase} {subject anchor}, {action}, in {settings}, lit by {lighting}, creating {article} {styleAdj} ambiance{audio inline}."`

Sample:
> "A close-up pushing into Maya as shown in `<image_0>` — preserve face, hair, and wardrobe exactly, sips coffee slowly, in Saigon coffee shop, lit by warm tungsten, creating a cinematic ambiance underscored by faint piano notes."

### Multi-shot output format (storyboard-driven)

Per DeepMind official 18-word example: *"Show me in this story. Follow the story exactly in order starting top left. Entire story in 10 seconds. Cinematic"*

Sample (với storyboard image):
> "Maya as shown in `<image_0>` — preserve face, hair, and wardrobe EXACTLY across all shots.
>
> Show this story in `<image_1>` — follow the visual progression exactly in order, starting top-left, set in Saigon coffee shop, lit by warm tungsten.
>
> Audio cues — shot 1: door bell; shot 3: piano notes.
>
> Entire story in 12 seconds. Cinematic."

Fallback (không có storyboard image): output ngắn timeline `"shot 1 (0-3s, static): action; shot 2 (3-7s, tracking): action"`.

### Files changed

| File | Change | LOC |
|---|---|---|
| `src/engine/omniShotPromptBuilder.ts` | REWRITE structured → prose | 237 → 339 |
| `src/engine/omniMultiShotPromptBuilder.ts` | REWRITE verbose timeline → 18-word template + fallback | 222 → 257 |
| `test/omni_prompts.test.tsx` | UPDATE 16 assertions + 3 new tests | 346 → 407 |
| `manifest.json` + `package.json` | Bump 0.9.4.42 → 0.9.4.43, r7.25 → r7.26 | — |

### UI behavior (unchanged signature)

- `FilmFrameEditModal.tsx` button "📋 Copy Omni 🎯" giờ output prose
- `FilmStoryboardSection.tsx` button "🎯 Multi Shot Prompt" giờ output prose
- Veo3 button "📋 Copy Veo3 🎬" KHÔNG động — vẫn structured

### Build state

- Version: `0.9.4.43` / `0.9.4-r7.26-omni-prose`
- TypeScript: 0 errors
- Vitest: 601/613 PASS (+3 new tests)
- Vite build: 10.47s
- `grep require dist/*` = 0 ✓

---

## Sprint r7.25 summary (previous) — Documentation cleanup

**Goal:** HANDOFF.md and CHANGELOG.md had grown to 2648 + 8784 lines (over 11k LOC of historical sprint summaries). Risk of hitting Claude Project knowledge token limits → loss of context in future sessions.

**Action:**
- Trim `HANDOFF.md` from 2648 → ~215 lines (92% reduction). Keep current sprint detail + last 4 sprint summaries + pending roadmap + tech debt + architecture locks + working style reminders.
- Trim `CHANGELOG.md` from 8784 → ~358 lines (96% reduction). Keep last ~10 sprints (r7.17 through r7.24).
- Old content moved to `HANDOFF_ARCHIVE.md` (149 KB) + `CHANGELOG_ARCHIVE.md` (505 KB) — kept locally for reference but NOT uploaded to Project knowledge.

**No code changes.** Only documentation refactor + version bump for tracking.

### Build state

- Version: `0.9.4.42` / `0.9.4-r7.25-doc-trim`
- TypeScript: 0 errors (no source changes)
- Vitest: 598/610 PASS (no test changes)
- Vite build: 9.87s
- `grep require dist/*` = 0 ✓

---

## Sprint r7.24 summary (previous) — Throttling + tech debt + Omni test coverage

### E — Rate limit throttling (quota safety)

Addresses Jason's `Error code 253` on labs.google. KSP was sending 5 calls/sec (20× Gemini Flash free tier 15/min) — shared quota exhaustion blocking other Google services.

**Solution: 4-layer defense**

1. **New `ProjectSettingV2.rateLimitMode`**: `"free" | "tier1" | "aggressive"`. Default `"free"` for new + existing projects (auto-fallback safe). Old projects without field default to "free".

2. **`autoChainOrchestrator.getDelayMs()`** — reads mode from project setting:
   - `free` → 4000ms gap (~15 calls/min)
   - `tier1` → 1000ms gap (~60 calls/min)
   - `aggressive` → 200ms gap (~5 calls/sec — old behavior)
   - Callback `interJobDelayMs` override wins (test forcing).

3. **`withRetry()` exponential backoff** — detects rate-limit errors (429, "rate limit", "quota", "resource_exhausted") → retry with delays 2s → 4s → 8s. Shows user toast each attempt. Defined but NOT yet wired into stage calls — defer based on whether rate-mode alone fixes quota.

4. **Settings UI** "RATE LIMITS (Quota safety)" collapsible block in `ProjectSettingSection.tsx` with 3-mode dropdown + explainer about Labs Flow shared quota.

8 sleep sites updated from `interJobDelayMs ?? 200` → `getDelayMs()`.

### C — Manifest version pin refactor

15 hard-pinned version assertions across 3 test files → regex format pattern.
- `manifest.version` → `/^\d+\.\d+\.\d+\.\d+$/`
- `manifest.version_name` → `/^\d+\.\d+\.\d+-r\d+/`
- `default_title` → `/^KSP Image v\d+\.\d+\.\d+-r\d+/`

Future version bumps only touch `manifest.json` + `package.json` (was 5+ files).

### D — Omni test coverage (NEW)

`test/omni_prompts.test.tsx` — 16 unit tests:
- **omniShotPromptBuilder (7)**: 6-element formula, Omni vocab rendering (`oner` → "one continuous shot"), audio direction conditional, fix1 regression (FilmImageRef.dataUrl extraction), no-character case, formatter, empty case.
- **omniMultiShotPromptBuilder (9)**: cumulative timeline, character anchor with `<image_N>`, storyboard reference conditional, audio per-shot inline, fix1 regression in multi-shot, global style suffix, character detection by action text.

`gridImageMerger.ts` skipped — happy-dom no canvas backend.

### Files changed

| File | Change |
|---|---|
| `src/types/project.ts` | +rateLimitMode field on ProjectSettingV2 |
| `src/engine/autoChainOrchestrator.ts` | +getDelayMs() + withRetry() + 8 sleep sites updated |
| `src/components/ProjectSettingSection.tsx` | +RATE LIMITS block + rateLimits in expanded state |
| `test/{preview_flow,auto_chain,film_mode}.test.tsx` | 15 version pins → regex |
| `test/omni_prompts.test.tsx` | NEW — 16 tests |
| `manifest.json` + `package.json` | bump 0.9.4.40 → 0.9.4.41 |

### Build state

- Version: `0.9.4.41` / `0.9.4-r7.24-throttling-cleanup-tests`
- TypeScript: 0 errors
- Vitest: 598/610 PASS (+16 new)
- Vite build: 8.79s
- Pre-ship gate `grep require dist/*` = **0** ✓

---

## Recent sprints (summary only — see CHANGELOG.md for full details)

### r7.23 — A+B+C+D batch (2026-05-20)

4 small wins gộp 1 ship:
- **A**: "+ New" Project button in Projects header (was buried in Editor empty state)
- **B**: Audio direction + Copy Omni button in shot list expandable detail (close r7.22 gaps — Frame Edit Modal-only previously)
- **C**: Cost Tracker live label — wire `setCostTrackerStage()` at 8 stage start points + clear on complete
- **D**: Deprecate `musicVoiceImage.ts:buildShotImagePrompt` dead code with @deprecated JSDoc

### r7.22 — Gemini Omni full prompt integration (combined a/b/c, 2026-05-20)

3 sub-sprints shipped together:

**Engines created:**
- `src/engine/omniShotPromptBuilder.ts` — single-shot Omni prompt (~210 LOC) with `[Subject] + [Action] + [Setting] + [Camera] + [Lighting] + [Audio] + [Style] + [Negative]` format. Multimodal `<image_N>` reference placeholders. Identity anchor "preserve face, hair, wardrobe exactly".
- `src/engine/omniMultiShotPromptBuilder.ts` — multi-shot scene (~195 LOC). Pattern: "Generate N connected shots, same character throughout: 1) 0-Xs: ... 2) X-Ys: ...".
- `src/engine/gridImageMerger.ts` — vertical stack merge multiple grid PNGs into one (~105 LOC). Smart fast-path for single grid.

**UI changes:**
- `FilmFrameEditModal.tsx` — 2 buttons side-by-side: "📋 Copy Veo3 🎬" + "📋 Copy Omni 🎯" + Audio direction input row
- `FilmStoryboardSection.tsx` — "🎯 Multi Shot Prompt" button in `.ksp-storyboard-grid-header-downloads` BEFORE Animation/Image buttons. Downloads ZIP `scene-N_omni_multi-shot.zip` with prompt.txt + concept sheets + merged storyboard PNG + Vietnamese README.

**Schema:** Added `FilmShot.audioDirection?: string` (optional, max 200 chars).

**Fix1 (later):** Bug `H.dataUrl.replace is not a function`. Root cause: `character.conceptSheet` is `FilmImageRef` object with `.dataUrl` field, not raw string. Both omni builders now extract `.dataUrl` properly with type-guarded fallback. Defensive type check in handler before `.replace()`.

### r7.21 — Camera Movement single source of truth + Omni vocab (2026-05-20)

Tech debt fix + Omni prep:

**Before:** `cameraMovement` defined in 4 files NOT in sync. Type in `project.ts:699-706` had 7 obsolete values; UI/AI used 11 different values. Code bypassed with `as any` casts.

**Solution:** `src/types/cameraMovement.ts` (NEW, ~260 LOC) is single source of truth with **19 values categorized**:
- **Universal (3)**: `static`, `handheld`, `tracking`
- **Veo3-only (8)**: `pan_left/right`, `tilt_up/down`, `zoom_in/out`, `dolly_in/out`
- **Omni-only (8)**: `oner`, `locked_off`, `push_in`, `punch_in`, `dolly_zoom`, `smartphone_zoom`, `film_camera`, `webcam_style`

Each value tagged with `veo3Compatible: boolean`, `omniCompatible: boolean`, category, AI hint, EN/VI labels.

**Helpers**: `getOptionsForMode`, `getLabel`, `getEnglishTerm` (`oner` → "one continuous shot"), `buildAiPromptRules` (generates categorized AI prompt block), `CAMERA_MOVEMENT_VALUES` (readonly for JSON schema).

**Architecture decision**: AI is mode-agnostic at gen time — sees all 19 values. Mode-specific rendering happens at prompt render time (Veo3 vs Omni Copy buttons).

**UI**: Dropdowns in `FilmShotListSection` + `FilmFrameEditModal` now render with badges: `🎯` for Omni-only, `🎬` for Veo3-only, no badge for universal.

**Backward compat**: Legacy projects with pre-r7.21 values (`steadicam_smooth`, `drone_aerial`) handled gracefully — `getLabel()` returns raw value, `getEnglishTerm()` does snake_case → space fallback.

### r7.20a/b — Pipeline Cost Tracker + Direction Summary moved (2026-05-20)

**Cost Tracker (r7.20a + fix1):**
- New `src/engine/costTracker.ts` — pub/sub emitter pattern (avoid refactoring ~50 `callAi` callsites)
- `PROVIDER_PRICING` constants (Gemini Flash $0.075/$0.30/1M, Pro $1.25/$10, OpenAI 4o $2.50/$10, GPT Image 2 $0.21 high / $0.04 low)
- USD→VND rate hard-coded `25500`
- `PipelineCostRun` field on `ProjectV09Extensions.pipelineCost` (single-slot record per Analyze Idea click)
- UI: Variant B+C — running shows orange border + pulsing dot, done shows snapshot + 2 categories text/image with %
- **fix1**: Replaced 4 `require()` calls (CommonJS) with static ES imports — browser has no `require` runtime. Added pre-ship gate: `grep -c "require(" dist/assets/index-*.js` MUST = 0.

**Direction Summary (r7.20b):**
- Removed collapsible panel from `FilmIdeaScriptSection` (~50 LOC), moved to PreviewFlowModal Step 6 "Review & Confirm"
- Step 6 polished: 6 progress dots, edit per pick, Step 4 multi-pick badge "N PICKS" with additionalPicks listed, cost estimate hint, 2-button CTA (Quay lại sửa + Lưu & Phân tích)

---

## Pending sprints / roadmap

- **Long-form text input → film** (r8.x) — Jason defer. 4 hướng discussed (A upload+chunk / B Story Bible 2-pass / C direct-to-shotlist / D Hybrid scene-level paste).
- **`withRetry()` wiring** — helper exists in orchestrator but not yet called at stage call sites. Defer based on whether rate-mode "free" default fixes Jason's quota issue. If 429 still hits → wire wrapper into all 8 stage calls.
- **`gridImageMerger.ts` test coverage** — needs happy-dom canvas backend or node-canvas mock. Defer.
- **Voice + Music + SFX stages** (future r8.x) — will plug into cost emitter same as text/image (no infra changes needed).

---

## Architecture locks (DO NOT REVISIT)

- Sidebar 380px vertical
- AI prompts EN (international cinema English)
- Time format: integer default
- Versioning: last-10 revert
- Auto-migration silent v0.8.x → v0.9.0 → v0.9.1 → v0.9.4
- Photos Cast: 5 Subject Types (Female/Male/Couple/Family/Friends Group)
- Photos face refs: dynamic 1-6, slot 0 = "front" LOCKED
- Photos outfit: 1 slot optional
- Camera Style toggle: BOKEH (default) / DOCUMENTARY
- Image Gen layout: list view (KHÔNG grid)
- Connector line height: 10px global
- AI Provider per-task
- Magic phrases verbatim from 18 source docs (Skin Paradox, Identity Lock, BOKEH/DOC bifurcation)

## Tech debt tracked (carried, low priority)

- Manual Twists regen handler in `FilmIdeaScriptSection.tsx` ~line 1818 — legacy gate on beats + AI call. Defer.
- `musicVoiceImage.ts:buildShotImagePrompt` dead code with @deprecated JSDoc (safe to remove future).
- `qc16Migrated` persisted schema field — DO NOT RENAME (migration tracking).
- Some `(char as any).conceptSheet` casts remain in omni builders — could refactor with proper FilmCharacter type assertions.

## UI decisions locked (current state)

- `ksp-sidebar-v09 .ksp-form-row-2` CSS override preserved (380px sidebar 2-column grid)
- Avatar circles permanently removed from Cast cards (only `border-top` separator)
- Dialog control uses `<select>` dropdown (not segmented buttons)
- Aspect Ratio labels short format ("16:9 landscape")
- Idea/Script sections zero outer padding; inner blocks self-manage 12px margins
- Connector component (`colorFrom="#1D9E75"` `colorTo="#D85A30"`) exported from `Editor.tsx`
- Generate button solid orange `#D85A30`
- Provider toggle 50/50, no label text
- 4 status badge colors locked: rendered `#EAF3DE/#3B6D11`, rendering `#FAEEDA/#854F0B`, pending `#2a2a2a/#888`, locked `#E6F1FB/#0C447C`

---

## Test suite state

- **598 passed | 12 skipped (610 total)** as of r7.24
- Suite breakdown: 49 Photos regression + 14 Film + 8 components + 5 Editor + 277+ refactor + ~250 Film features + 16 NEW Omni tests (r7.24)
- Pre-ship gate: `grep -c "require(" dist/assets/index-*.js` MUST = 0 (since r7.20a-fix1)

## Source code locations

- **Source (r8.0+)**: `~/Documents/KSP_Studio` — git `hoangdungksp/KSP_Studio_Extension`
- **Source (old)**: `/Users/jasonnguyen/Downloads/ksp-image-ext/`
- **Distribution zips**: `~/Downloads/ksp-image-ext-v*.zip`
- **GitHub**: https://github.com/hoangdungksp/KSP_Image_Prompt (private)
- **Update cmd**: `bash ~/Downloads/ksp-image-ext/update.sh` (rsync --delete — ship FULL zip only, never patch)

## Working style reminders for Claude

- Vietnamese primary, English code/comment OK. Address Jason as "anh".
- **Discuss design** trước khi build feature mới (format Hướng A/B/C/D)
- **Self-test runtime** với vitest TRƯỚC khi ship (tsc + build pass KHÔNG ĐỦ — đã có precedent bug compile-pass-runtime-fail)
- Bug → diagnose → 1 fix targeted, KHÔNG rewrite cả module
- Format minimal: ít bullet, ít heading lồng nhau, ít emoji decoration
- Reference file path đầy đủ khi đề xuất chỉnh sửa
- Bump version chậm, mỗi version 1 step có review
- Ship FULL source zip only (rsync --delete sẽ wipe files thiếu)

## Pre-ship checklist

1. `npx tsc --noEmit` → 0 errors
2. `npx vitest run` → all pass (current baseline 598)
3. `npm run build` → success
4. `grep -c "require(" dist/assets/index-*.js` → MUST be **0** (browser no CommonJS)
5. Verify zip integrity (`unzip -l`)

---

**Historical sprints (r7.20b and earlier) archived in `HANDOFF_ARCHIVE.md` if needed.** Current state above is sufficient for continuing development.
