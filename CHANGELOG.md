# Changelog

> Older entries (pre-r7.15) archived in `CHANGELOG_ARCHIVE.md`. Only last ~10 sprints kept here for active reference.

## [0.9.4-r8.1-idea-only-film] — 2026-09-26 — Sprint r8.1: Film chỉ cần Idea

### Added
- Auto-chain stage `characters` (AI character bible) + `src/engine/characterBible.ts`, `setCharacters` action, `CharacterBibleBlock` ở đầu Shot List.
- Setting `dialogueLanguage` (English / Tiếng Việt) cho lời thoại trong video prompt.
- Beat prompt: chép nguyên văn mô tả nhân vật để đồng nhất giữa các clip.

### Removed
- Cast section trong Film mode + guard "phải add character".

---

## [0.9.4-r8.0-beat-video-prompts] — 2026-09-25 — Sprint r8.0: đơn giản hoá + video prompt theo beat

### Added
- Panel "🎬 BEATS → VIDEO PROMPT" trong mỗi scene của Shot List: prompt riêng cho Gemini Omni Flash, Seedance 2.5, Grok Imagine; ghép nhiều beat liền nhau thành 1 clip; sửa tay, copy, tải ảnh ref.
- `src/engine/beatVideoPrompt.ts` + `test/beat_video_prompt.test.tsx` (23 tests).
- `FilmSceneScript.beatPrompts`, store actions `upsertBeatPromptGroup` / `editBeatPromptText` / `removeBeatPromptGroup`.

### Removed
- Storyboard ẩn khỏi Editor; auto-chain không còn stage grid-build (dừng ở Shot List).
- Voice, Music+SFX, Bundle Export (component + exporter + tests).
- TVC / Product: placeholder + các field Project Setting riêng (Industry, Concept Writer), Storyboard frames provider, Voice TTS, key ElevenLabs / Google TTS / Suno.

### Notes
- Version theo quy ước cũ: 0.9.4.57 / 0.9.4-r8.0 (test pin 0.9.4-r*).
- Sprint r7.35–r7.38 (Omni provider, ESC đóng Preview, banner abort mới, di chuyển nút Refs) đã có trong code từ commit 1b193a9 nhưng chưa ghi changelog.

---

## [0.9.4-r7.34-omni-ab-test] — 2026-05-21 — Sprint r7.34: Omni A/B prompt comparison feature

### Goal

Jason muốn so sánh empirically chất lượng video output giữa 2 prompt strategies:
- **KSP Hybrid**: per-cell timestamps + lighting override + identity anchor + audio cues (detailed control, ~600-1200 chars)
- **DeepMind Strict**: 18-word official pattern + identity anchor only (trust Omni reasoning, ~150-300 chars)

### Research basis

Em đối chiếu 7 nguồn (DeepMind official + community github 293★ + Pollo + PixVerse + Storyboard18 + Kingy AI + Vidmuse) trước khi design.

Key insight em ban đầu MISS: Tip #4 từ Anil-matcha github (293★, community official) — "Use explicit durations and timestamps — 0–4s wide shot, 4–8s push-in, 8–12s close-up gives Omni a cut list to follow". DeepMind 18-word là MINIMAL không phải MAXIMUM.

### Code changes

**Modified `src/engine/omniMultiShotPromptBuilder.ts`** (r7.34 Hybrid mode):
- Add per-cell cut list: `N) X-Ys: <camera>, <action>. [lighting override]`
- Per-cell lighting ONLY when shot.lightingHintEn ≠ scene.lightingHintEn (avoid noise)
- Keep: identity anchor, storyboard reference, audio cues inline, closing duration

**NEW `src/engine/omniDeepMindPurePromptBuilder.ts`** (~210 LOC):
- Strict 18-word DeepMind pattern
- Identity anchor only addition (per Pattern "Keep your scene consistent")
- NO per-cell, NO timestamps, NO audio, NO camera vocab per cell
- ~150-300 chars total

**Modified `src/components/FilmStoryboardSection.tsx`**:
- DELETE old nút "🎯 Multi Shot Prompt" + handler `handleDownloadMultiShotOmniPrompt`
- ADD nút "📋 KSP Prompt" + handler `handleDownloadKspPromptZip` → ZIP `scene-N_omni_KSP.zip`
- ADD nút "📋 DeepMind Prompt" + handler `handleDownloadDeepMindPromptZip` → ZIP `scene-N_omni_DeepMind.zip`
- Mỗi ZIP có README giải thích strategy + A/B compare workflow Vietnamese

### A/B compare workflow (cho user)

1. Click cả 2 nút → tải 2 ZIPs
2. Mở 2 Gemini chat sessions riêng biệt
3. Mỗi session: upload cùng bộ images (concept sheets + storyboard grid) + paste prompt khác nhau
4. Generate → so sánh video:
   - Identity consistency (face/wardrobe drift?)
   - Timing per-cell (Omni distribute đúng không?)
   - Camera movement specific (push_in/oner/dolly_zoom)
   - Audio direction (DeepMind miss hoàn toàn)
   - Overall narrative arc

### Files changed

| File | Type | Detail |
|---|---|---|
| `src/engine/omniMultiShotPromptBuilder.ts` | MODIFIED | Header comment r7.26 → r7.34, add per-cell cut list + lighting override |
| `src/engine/omniDeepMindPurePromptBuilder.ts` | NEW | ~210 LOC strict DeepMind builder |
| `src/components/FilmStoryboardSection.tsx` | MODIFIED | Replace 1 button → 2 A/B buttons + 2 new handlers, delete old handler |
| `test/film_mode.test.tsx` | +5 tests | Per-cell timestamps, lighting override, DeepMind strict, identity anchor, length ratio |
| `test/omni_prompts.test.tsx` | 1 updated | r7.26 test expected NO timestamps → r7.34 adds them back per Tip #4 |
| `manifest.json` + `package.json` | bump | 0.9.4.50 → 0.9.4.51 |

### Build state

- Version: `0.9.4.51` / `0.9.4-r7.34-omni-ab-test`
- TypeScript: 0 errors
- Vitest: 637/649 PASS (+5 new tests, 1 updated)
- Vite build: 10.83s
- `grep require dist/*` = 0 ✓

### Note quan trọng

Per ABSOLUTE RULE r7.31: KHÔNG hardcode story-specific content trong prompt builders. Tất cả examples trong builders + tests dùng template `${variable}` hoặc placeholders generic.

---

## [0.9.4-r7.33-cleanup-cache] — 2026-05-21 — Sprint r7.33: Preview Modal cleanup (lock-in flow + incremental cache + START/Preview UI)

### 5 sub-features (gộp 1 sprint theo Jason approve)

**2A — Remove nút "Bỏ qua" Preview Modal**

User báo cần đọc kỹ Direction Summary → quyết định kỹ → buộc complete 6 steps. Nên remove cửa thoát hoàn toàn:
- Bỏ button "✕ Bỏ qua" khỏi `.ksp-preview-flow-header`
- Chặn ESC key: `onKeyDown` backdrop → `e.preventDefault()` nếu key = "Escape"
- Chặn click outside modal: `onClick` backdrop → skip nếu click target ≠ modal child
- Exit ONLY via Step 6 "Lưu & Đóng"

**2B — Confirm dialog trước khi mở modal**

`handleOpenPreviewFlow` thêm `window.confirm(...)` cảnh báo user trước khi mở. Skip confirm nếu đã có existingCache (user đang re-enter flow → natural, không cần warning).

**2C — Cache persist INCREMENTAL**

New `onCachePersist?: (cache: PreviewCache) => void` prop của `PreviewFlowModal`. Mỗi lần AI gen step thành công (Step 1-5), local `setCache(newCache)` đồng thời emit `onCachePersist(newCache)` → callback ở parent `FilmIdeaScriptSection` save ngay vào Dexie qua `updateProject({ previewCache: newCache })`.

Hậu quả: user reload tab giữa chừng → cache đã trên Dexie → mở lại modal → step đã gen hit cache → KHÔNG tốn AI cost.

**2D — Step 6 button: "Lưu & Đóng" thay vì "Lưu & Phân tích"**

`handlePreviewComplete` không còn call `runAutoChain(direction)` nữa. Chỉ save direction + cache + đóng modal + show toast "Direction đã lưu. Bấm START để chạy auto-chain."

Cost hint Step 6 cập nhật: giải thích flow 2-step (Lưu & Đóng → sau đó bấm START/Preview).

**2E — UI section Ý tưởng: 2-button khi đã có direction**

State machine UI:
| State | UI |
|---|---|
| No direction | 1 nút `🎬 Analyze Idea` (gradient green→orange) |
| Has direction | 2 nút: `▶ START` (orange to, flex:1) + `👁 Preview` (ghost, 110px) |

Behavior:
- `START` → `handleStartAutoChain()` → chạy auto-chain với `existingDirection`
- `Preview` → `handleReopenPreview()` → mở lại Preview Modal (initialCache + picks pre-filled)
- Modal lần 2 lúc Preview reopen sẽ NHẢY THẲNG vào Step 6 review nếu picks đã đủ (current behavior của modal)

### Files changed

| File | Change |
|---|---|
| `src/components/PreviewFlowModal.tsx` | Remove Bỏ qua button + chặn ESC + chặn click outside + add `onCachePersist` prop + wire 5 step gens + Step 6 button label + cost hint update |
| `src/components/FilmIdeaScriptSection.tsx` | Confirm dialog + handlePreviewComplete no-auto-chain + new handleStartAutoChain + handleReopenPreview + 2-button UI conditional |
| `src/components/film.css` | New `.ksp-idea-direction-actions` flex container + `.ksp-idea-start-btn` + `.ksp-idea-preview-btn` + shimmer animation |
| `test/film_mode.test.tsx` | +5 tests cho r7.33 |
| `test/preview_flow.test.tsx` | Update old r7.20b test (button label + cost hint changed) |
| `manifest.json` + `package.json` | Bump 0.9.4.49 → 0.9.4.50, r7.32 → r7.33-cleanup-cache |

### How Jason uses

1. Nhập idea → bấm `🎬 Analyze Idea` → confirm dialog "Mở 6-step wizard? OK?" → click OK → modal mở Step 1
2. Đi qua 6 steps. Mỗi step AI gen → cache persist incremental (reload tab không mất)
3. Step 6 Review → bấm `✓ Lưu & Đóng` → modal đóng
4. Section Ý tưởng giờ có 2 nút: `▶ START` (to) + `👁 Preview` (nhỏ)
5. Đọc kỹ Direction Summary. Nếu OK → bấm START → auto-chain chạy. Nếu cần edit → bấm Preview → modal mở lại Step 6 → có thể click "← Quay lại sửa" → edit step bất kỳ → Lưu & Đóng lần nữa.

### Build state

- Version: `0.9.4.50` / `0.9.4-r7.33-cleanup-cache`
- TypeScript: 0 errors
- Vitest: 632/644 PASS (+5 new tests + 1 updated old test)
- Vite build: 11.47s
- `grep require dist/*` = 0 ✓

### Note

- Bug B4 "Pipeline running…" stuck → SKIP vì nút "Bỏ qua" đã bị remove (Option A), không còn handler nào để fix.
- Bug B5 narrativeDirection null → FALSE POSITIVE (em viết script export DevTools sai path, đọc từ `filmV093.narrativeDirection` thay vì `project.narrativeDirection` root). Skip hoàn toàn.

---

## [0.9.4-r7.32-fix-banner-stuck] — 2026-05-21 — Sprint r7.32-fix: PipelineResumeBanner stuck bug (wrong field name)

### Bug

Jason báo: đã gen lại Storyboard đầy đủ, load lại extension nhưng banner "Pipeline dở dang. ✓ Đã xong: Shot List → Tiếp theo: Storyboard (Grid Build)" vẫn còn → click "Continue" nó re-run grid build dù đã có đủ.

### Root cause

`pipelineProgress.ts:detectStatus('grid-build')` em viết ở r7.29 dùng SAI tên field:

```ts
// SAI (r7.29):
return grids.length > 0 && grids.every((g: any) => !!g.image);
//                                                  ^^^^^ field không tồn tại
```

Real schema `SceneGrid` (project.ts:469) có field `gridImageDataUrl: string`, KHÔNG có field `image`. Vì TypeScript cast `g as any` → bypass type check → `g.image` luôn = `undefined` → `!!undefined === false` → `grid-build` luôn return `"missing"` cho mọi project.

→ Banner luôn hiện. Click "Continue" → orchestrator re-run grid build → tốn AI cost.

Test r7.29 (case isComplete=true) cũng dùng `image` field sai cùng cách trong fixture → cả 2 sai đối xứng → test pass nhưng KHÔNG catch bug thực.

### Fix

```ts
// ĐÚNG (r7.32):
return grids.length > 0 && grids.every((g: any) => !!g.gridImageDataUrl);
```

+ Update test fixture cũ dùng `gridImageDataUrl` field đúng.
+ Add NEW regression test với 3 case:
  - Case 1: `gridImageDataUrl` populated → expect `"done"`
  - Case 2: legacy/wrong field `image` → expect `"missing"` (proves we read specific field)
  - Case 3: `gridImageDataUrl` empty string → expect `"missing"`

### Files changed

| File | Change |
|---|---|
| `src/engine/pipelineProgress.ts` | Line ~123: `g.image` → `g.gridImageDataUrl` |
| `test/film_mode.test.tsx` | Update existing test fixture + add 3-case regression test |
| `manifest.json` + `package.json` | Bump 0.9.4.48 → 0.9.4.49 |

### Audit luôn 3 detector khác (analyze-scenes, shot-list, các stage 1-5)

- `script-stage-1`: `film.scriptStructure` ✓ field tồn tại
- `script-stage-2`: `film.scriptBeats[]` ✓ field tồn tại
- `script-stage-3`: `film.scriptTwistsLocked` + `film.scriptTwists[]` ✓
- `script-stage-4`: `film.scriptIntermediateScenes[]` ✓
- `script-stage-5`: `film.script.scenes[]` ✓
- `analyze-scenes`: `scene.beats[]` ✓ (FilmSceneScript:382)
- `shot-list`: `film.shotsBySceneId[sceneId][]` ✓ (FilmData:159)
- `grid-build`: ❌ → ✅ FIXED

### Build state

- Version: `0.9.4.49` / `0.9.4-r7.32-fix-banner-stuck`
- TypeScript: 0 errors
- Vitest: 627/639 PASS (+1 new regression test)
- Vite build: 11.68s
- `grep require dist/*` = 0 ✓

---

## [0.9.4-r7.31-no-hardcode-prompts] — 2026-05-21 — Sprint r7.31: Audit + remove story-specific hardcodes from AI prompts

### Bug

Jason phát hiện em fix r7.30 đã show example `"EXT. TROPICAL FOREST — DAY"` trong message thảo luận → tưởng em hardcode trong code (thực ra đó là output rendered từ `${sceneSettings}` placeholder). Jason yêu cầu audit TOÀN BỘ codebase để verify không còn chỗ nào bias 1 câu chuyện cụ thể.

### Audit phát hiện 6 chỗ HARDCODE THẬT về story Robot N.A.M.O của Jason

| # | File:line | Content hardcode |
|---|---|---|
| 1 | `filmShotListGeneration.ts:220` | `(vd: "Robot tỉnh dậy", "Mắt LED sáng dần", "Tay rỉ sét cử động")` |
| 2 | `filmScriptStages.ts:1650-1651` | `"Mật mã 3-5 nhịp", "Cảm biến quang học", "Hệ thống cảnh báo"` / `"3-5 tap code", "Optical sensor", "Warning system"` |
| 3 | `filmScriptStages.ts:1798-1803` | 6 beat examples: "Wide forest sweep", "Tilt down reveals robot", "Woodpecker lands on head", "Pecks 3 times, pause, 5 times", "Blue light flickers", "Light fades" |
| 4 | `filmScriptStages.ts:1871-1874` | Color script "Scene Robot Awakening in Ancient Forest" với forest green/orange rust/electric blue |
| 5 | `filmCastGeneration.ts:357` | anchorTokens "moss-covered grey-green metal body", "single glowing blue right sensor", "rust-streaked chest plates", "3.5m hulking humanoid" |
| 6 | `filmShotListGeneration.ts:162` | beat merge example "claws on moss" + "tiny grip texture" |

→ Bias: khi Jason đổi sang câu chuyện khác (Gấu Bự mùa đông / bãi biển / samurai...), AI vẫn output theo template robot/forest cũ vì các example trong system prompt làm AI suy luận genre.

### Fix strategy (3 cách abstract)

**Cách 1 — Abstract pattern** (no concrete content):
```
- "titleVi": tiêu đề ngắn TIẾNG VIỆT (3-5 từ, đặc tả hành động chính của shot — phải PHÙ HỢP với scene action + cast nhập, không bịa nội dung khác)
```

**Cách 2 — Format placeholder** với `<placeholder>` shape:
```
anchorTokens: [Format pattern: "<color/material> <body-part>", "<distinguishing-feature> <noun>", "<size/age-marker> <body-type>". NEVER copy tokens from this instruction]
```

**Cách 3 — Multiple diverse examples** (≥3 từ genre khác nhau, không bias 1 type) — chỉ giữ ở line 1841 cho film references:
- Wall-E (sci-fi)
- Princess Mononoke (anime fantasy)
- Blade Runner 2049 (noir)

### Files changed

| File | Fix |
|---|---|
| `src/engine/filmShotListGeneration.ts` | Line 220 + line 162 → abstract patterns |
| `src/engine/filmScriptStages.ts` | Line 1650-1651, 1798-1803, 1871-1874 → 3 chỗ refactor sang abstract format guides |
| `src/engine/filmCastGeneration.ts` | Line 357 → format placeholder pattern với explicit "NEVER copy tokens from this instruction" |
| `HANDOFF.md` | NEW section "RULE TUYỆT ĐỐI — KHÔNG hardcode story-specific content vào AI prompts" với 5 rules + verification command |
| `manifest.json` + `package.json` | Bump 0.9.4.47 → 0.9.4.48 |

### Verification command cho sprint tương lai

```bash
grep -nE "vd:|VD:|Example:|Examples:|ví dụ:|Ví dụ:|e\.g\." src/engine/*.ts | grep -v "test\|@deprecated"
```

Mọi example trong AI prompt body phải PASS 1 trong 3 cách abstract ở rule HANDOFF, hoặc là verification command sẽ flag.

### Build state

- Version: `0.9.4.48` / `0.9.4-r7.31-no-hardcode-prompts`
- TypeScript: 0 errors
- Vitest: 626/638 PASS (no test changes — pure prompt refactor)
- Vite build: 11.45s
- `grep require dist/*` = 0 ✓

---

## [0.9.4-r7.30-scene-boundary] — 2026-05-21 — Sprint r7.30: Scene boundary fix + Regen button UX reposition

### Bug 1 — Scene grid cross-scene hallucination

Jason báo: gen storyboard grid Scene 1 ("Awakening in the Ancient Forest" — rừng nhiệt đới). Output PNG có 9 cells nhưng nhìn rõ ràng 3-4 cells là **cánh đồng cỏ vàng** — đó là setting Scene 2 ("Old Command — Forgotten Mission") + Scene 3 ("War's Legacy").

**Diagnosis**: Em đọc 9 per-shot prompts trong zip Jason upload + đọc code `buildSceneGridImagePrompt()`. Tất cả prompts đều mô tả ĐÚNG Scene 1 (rừng, robot phủ rêu, chim gõ vào mắt). Không có inject content cross-scene từ KSP code.

→ Root cause: **AI image gen (Banana Pro / GPT Image 2) hallucinate**. Prompt cũ có cụm `"Cinematic storyboard grid (GRID 1 of N)"` + `"Story context:"` → AI nhìn thấy keywords "storyboard" + "story" + "GRID 1 of N" → tự suy ra phải show progression của câu chuyện đầy đủ → render cells từ scene khác.

### Fix Bug 1 — Siết Scene Boundary trong grid prompt

3 thay đổi trong `sceneImagePromptBuilder.ts:buildSceneGridImagePrompt`:

**A**: Header đổi `"Cinematic storyboard grid"` → `"Cinematic storyboard panel — single scene only"`.

**B**: Tier 1 add **SCENE BOUNDARY block (CRITICAL)**:
```
SCENE BOUNDARY (CRITICAL — prevent cross-scene hallucination):
- ALL N filled cells depict events WITHIN ONE SINGLE SCENE only.
- Setting locked: "{sceneSettings}". EVERY cell takes place in this exact location.
- DO NOT depict any setting outside "{sceneSettings}" — no other locations from any larger story arc.
- DO NOT add narrative progression beyond this scene's action — no cells showing future events, no cells showing past events.
- If a cell's described action seems to require a different location, REINTERPRET it within "{sceneSettings}" instead.
```

**C**: Tier 2 đổi `"Story context: <action>"` → `"This scene's action (ALL cells stay within these events, NO events from other scenes): <action>"`. Bỏ keyword "Story" làm AI nghĩ rộng.

**D**: Tier 3 add `"LOCATION stays "{sceneSettings}" — NEVER drifts to another setting"`.

**E**: AVOID block add `"cells depicting any location other than "{sceneSettings}""`.

**F**: OUTPUT closing reminder `"Each cell = finished cinematic frame WITHIN THIS SINGLE SCENE"`.

Prompt length tăng ~92 chars (~1% — vẫn xa AI provider limit). Test token budget bump 8500 → 8800.

### Bug 2 — Regen button UI bị che bởi "Bỏ qua"

Jason báo: nút 🔄 Regen của r7.29 Feature 2A nằm trong `.ksp-preview-flow-title` (header), bị nút "Bỏ qua" ở góc phải header che → click nhầm sẽ thoát modal.

### Fix Bug 2 — Move Regen button inline cạnh hint

- Remove Regen button khỏi `.ksp-preview-flow-title` (header)
- Wrap `.ksp-preview-flow-hint` + Regen button vào container mới `.ksp-preview-flow-hint-row` (flex layout, hint flex:1, button flex-shrink:0)
- Button đổi label `"🔄 Regen"` → `"🔄 Regen 4 options"` (rõ ràng hơn)
- CSS đổi background từ neutral gray → orange tint (`rgba(216, 90, 48, 0.15)` + orange border) cho consistent với theme KSP

### Files changed

| File | Type | Change |
|---|---|---|
| `src/engine/sceneImagePromptBuilder.ts` | EDIT | SCENE BOUNDARY block + Tier 2/3/4/AVOID reinforce single-location boundary |
| `src/components/PreviewFlowModal.tsx` | EDIT | Move Regen button khỏi header → inline cạnh hint |
| `src/components/film.css` | EDIT | New `.ksp-preview-flow-hint-row` flex container + Regen button restyle (orange tint) |
| `test/film_mode.test.tsx` | EDIT | +4 tests cho r7.30 (button position, scene boundary block, this scene's action wording, Tier 3/4/AVOID checks) + adjust token budget 8500 → 8800 |
| `manifest.json` + `package.json` | EDIT | Bump 0.9.4.46 → 0.9.4.47, r7.29 → r7.30-scene-boundary |

### Build state

- Version: `0.9.4.47` / `0.9.4-r7.30-scene-boundary`
- TypeScript: 0 errors
- Vitest: 626/638 PASS (+4 new tests)
- Vite build: 11.53s
- `grep require dist/*` = 0 ✓

### Note for Jason — test fix Bug 1

Sau khi apply r7.30, gen lại Scene 1 storyboard grid:
1. Vào Storyboard section → Scene 1 → bấm "🔄 Sinh lại grid"
2. Verify: TẤT CẢ 9 cells phải trong rừng nhiệt đới (không có cánh đồng cỏ vàng)
3. Nếu vẫn còn cells cánh đồng → AI provider hallucinate quá mạnh, có thể cần bump SCENE BOUNDARY warning level (e.g. all-caps repeat 2x). Em sẽ iterate.

---

## [0.9.4-r7.29-resume-regen] — 2026-05-21 — Sprint r7.29: Resume from error + Regen options per step (UX critical)

### Goal

Jason đề xuất 2 UX feature critical sau khi gặp bug Stage 5 (r7.28-fix):
1. **Feature 1**: Khi auto-chain bị lỗi ở Stage N, có nút Continue/Re-Generate **TẠI VỊ TRÍ LỖI** để chạy tiếp xuống các stage sau — KHÔNG phải chạy lại từ đầu (tiết kiệm AI cost).
2. **Feature 2**: Trong Preview Modal, mỗi Step (1-5) hiện sinh 4 options. Khi không hài lòng, cần nút Regen để AI tạo 4 options mới.

### Feature 1A — AutoChainRetryBanner (in-section error UX)

Backend `orchestrator.retryFromSection()` đã tồn tại từ Sprint 1.0 r7.x, nhưng chỉ wire vào 5 Script Stages trong `FilmIdeaScriptSection`. 3 section còn lại (analyze-scenes, shot-list, grid-build) CHƯA có retry UI.

**Solution**: New reusable component `<AutoChainRetryBanner sectionIds={[...]} sectionLabel="..." />`. Đọc `autoChainState.sections[id]?.status === "error"` → hiển thị banner đỏ với error message + nút "🔄 Retry từ đây". Click → call `retryFromSection()` với direction lấy từ `project.narrativeDirection` (persisted, không phải ref).

Wired vào:
- `FilmShotListSection` — monitors `["analyze-scenes", "shot-list"]`
- `FilmStoryboardSection` — monitors `["grid-build"]`

### Feature 1B — PipelineResumeBanner (cross-session resume)

User đóng Chrome → mở lại → `autoChainState` (Zustand) reset về initial → mất state in-memory về việc pipeline đang dở. Nhưng project data (Dexie/IndexedDB) vẫn còn.

**Solution**: New engine `pipelineProgress.ts` với `derivePipelineProgress(project)` — pure function detect status 8 sections từ PERSISTED DATA:
- script-stage-1: `done` nếu `film.scriptStructure` exists
- script-stage-2: `done` nếu `film.scriptBeats.length >= 1`
- script-stage-3: `done` nếu `film.scriptTwistsLocked === true` HOẶC `scriptTwists` exists
- script-stage-4: `done` nếu `film.scriptIntermediateScenes.length >= 1`
- script-stage-5: `done` nếu `film.script.scenes.length >= 1`
- analyze-scenes: `done` nếu ALL scenes có `beats[]` populated
- shot-list: `done` nếu ALL scenes có shots trong `shotsBySceneId`
- grid-build: `done` nếu ALL scenes có grids với `image` populated

New component `<PipelineResumeBanner />` render ở top Editor (sau khi mở project):
- Show khi: có ≥1 section done + ≥1 section missing (i.e. `isInProgress === true`)
- + có `narrativeDirection` saved
- + auto-chain không đang running
- + user chưa dismiss session này (sessionStorage)
- UI: orange banner với "✓ Đã xong: {lastCompleted}" + "→ Tiếp theo: {firstMissing}" + nút "▶ Continue" + nút "✕ Dismiss"

### Feature 2A — Regen icon in Preview Modal step header

Hiện tại cache PreviewOption[] active → nếu user click qua step → revisit → instant return cached options. Không cách nào gen lại 4 options mới.

**Solution**: 
- New helper `invalidateCacheForStep(cache, step, picks)` trong `previewFlowSynthesizer.ts` — remove cache entry CỤ THỂ cho step + pick combination hiện tại (không clear cache cho branches khác đã explore)
- Modify `loadOptionsForStep(step, opts?: { skipCache?: boolean })` — khi `skipCache=true`, invalidate cache + bypass cache lookup → AI gen fresh
- New UI button "🔄 Regen" trong step header (Step 1-5, không có ở Step 6 Review)
- Tooltip: *"Tạo lại 4 options mới (AI sẽ gen lại với góc nhìn sáng tạo khác)"*
- Loading state: spinner "⟳" + disable button

Cost: ~$0.005 per regen (Gemini Flash 1 call).

### Files changed

| File | Type | Change |
|---|---|---|
| `src/components/AutoChainRetryBanner.tsx` | NEW | 95 LOC — reusable error banner |
| `src/components/PipelineResumeBanner.tsx` | NEW | 137 LOC — cross-session resume banner |
| `src/engine/pipelineProgress.ts` | NEW | 147 LOC — `derivePipelineProgress()` + section status detection |
| `src/engine/previewFlowSynthesizer.ts` | EDIT | +`invalidateCacheForStep()` (60 LOC) |
| `src/components/FilmShotListSection.tsx` | EDIT | +import + render banner after header |
| `src/components/FilmStoryboardSection.tsx` | EDIT | +import + render banner after header |
| `src/components/PreviewFlowModal.tsx` | EDIT | +skipCache option + Regen button in header |
| `src/components/Editor.tsx` | EDIT | +import + render PipelineResumeBanner at top |
| `src/components/film.css` | EDIT | +143 LOC CSS cho 3 banner |
| `test/film_mode.test.tsx` | EDIT | +10 tests cho r7.29 features |
| `manifest.json` + `package.json` | EDIT | Bump 0.9.4.45 → 0.9.4.46, r7.28-fix → r7.29-resume-regen |

### How Jason benefits

Scenario 1 — **Lỗi giữa session**:
- Auto-chain run, Stage 7 (Shot List) lỗi → border đỏ + banner "Phân tích Scenes / Shot List bị lỗi" + nút Retry
- Click Retry → resume từ shot-list xuống cuối → Stage 1-6 không bị chạy lại → tiết kiệm 6 AI calls

Scenario 2 — **Đóng Chrome rồi mở lại**:
- User chạy đến Storyboard rồi đóng tab → mở lại → mở project → banner cam ở top: *"⏸️ Pipeline dở dang. ✓ Đã xong: Shot List → Tiếp theo: Storyboard (Grid Build)"*
- Click "Continue từ grid-build" → resume luôn

Scenario 3 — **Preview Modal options không hay**:
- Vào Step 2 thấy 4 options không thích → click 🔄 Regen → AI gen 4 options mới với creative angle khác
- Steps khác (cache cũ) vẫn nguyên — chỉ step hiện tại được regen

### Build state

- Version: `0.9.4.46` / `0.9.4-r7.29-resume-regen`
- TypeScript: 0 errors
- Vitest: 622/634 PASS (+10 new tests)
- Vite build: 11.29s
- `grep require dist/*` = 0 ✓

---

## [0.9.4-r7.28-fix-stage5-leak] — 2026-05-21 — Sprint r7.28-fix: Critical bug fix — Stage 5 stale film.script leak

### Bug report (Jason, May 21 evening)

Workflow: hôm qua tạo project "Gấu Bự chia sẻ thức ăn" → chạy auto-chain → output đúng. Hôm nay đổi sang ý tưởng Robot N.A.M.O → re-run auto-chain → Stage 1-4 hiển thị nội dung Robot mới, NHƯNG Section "Phân cảnh" + Shot List + Storyboard vẫn hiển thị nội dung Gấu Bự cũ.

### Diagnosis (qua IndexedDB export)

JSON dump cho thấy:
- `idea`, `cast`, `scriptStructure`, `scriptBeats`, `scriptTwists`, `scriptIntermediateScenes` = đều là Robot N.A.M.O đúng ✓
- `film.script.scenes` (final) = vẫn là Gấu Bự cũ ("Nỗi Buồn Giấu Kín", "Phản Chiếu Chân Thực", "Hành Trình Qua Bão Tuyết") ✗

UI Section "Phân cảnh" render `film.script.scenes` (Stage 5 final output) — không phải `scriptIntermediateScenes` (Stage 4 output) → user thấy Gấu Bự ở Stage 4 UI.

### Root cause: 2 bug compound

**Bug A — `Projects.tsx:73-101` duplicate handler giữ stale script data**:
Comment Sprint 1.0 r4.1 ghi *"Other Film data preserved: characters, script, structure, beats, etc."* — chủ ý sai. Duplicate project chỉ reset `shotsBySceneId: {}` → `script`, `scriptStructure`, `scriptBeats`, `scriptTwists`, `scriptIntermediateScenes`, `narrativeDirection`, `sceneGrids` đều được kế thừa từ template.

**Bug B — `autoChainOrchestrator.ts:669-673` Stage 5 skip không clear `film.script`**:
```ts
if (setting.dialog === "no_dialog") {
  this.setStatus("script-stage-5", "done");
  return;  // ← early return, KHÔNG override film.script cũ
}
```
Phim Robot N.A.M.O là `no_dialog` (robot không thoại). Stage 5 SKIP → `film.script` cũ Gấu Bự (kế thừa từ duplicate Bug A) không bị thay thế.

**Compound effect**: A tạo data ô nhiễm + B không xóa → output downstream toàn Gấu Bự.

### Fix 1 — `runScriptStage5` no_dialog mode REBUILD script no-AI

Thay vì SKIP, build `FilmScript` mới TRỰC TIẾP từ `scriptIntermediateScenes` mới — không cần AI call (dialog rỗng trong no_dialog mode anyway). Đảm bảo `film.script` luôn fresh khớp với intermediateScenes.

New helpers `buildNoDialogScript()` + `deriveActFromIndex()`:
- Map `FilmScriptIntermediateScene[]` → `FilmSceneScript[]` với `dialog: []`, `sfx: []`, `musicBrief: ""`
- Derive `titleEn/Vi` từ `project.name`
- Derive `logline` từ câu đầu tiên của `project.idea.raw`
- Derive `synopsisEn/Vi` từ concat `actionLinesEn/Vi` của tất cả scene (80 char each, joined " → ")
- Map scene position → act label (setup/inciting/rising/climax/resolution)
- Set `aiProvider: "manual"` để phân biệt với AI-generated script

### Fix 2 — `Projects.tsx` duplicate clear all generated data (defensive)

Khi clone project, clear: `script`, `scriptStructure`, `scriptBeats`, `scriptTwists`, `scriptTwistsLocked`, `scriptIntermediateScenes`, `scriptScenesLocked`, `scriptStage`, `narrativeDirection`, `sceneGrids`, `shotsBySceneId`.

Preserved on duplicate: `characters` (concept sheets reusable), `settingV2`, `idea`. Toast message updated.

### Files changed

| File | Change |
|---|---|
| `src/engine/autoChainOrchestrator.ts` | +`FilmScript` import, replace early-return Stage 5 with no-AI build, +`buildNoDialogScript()` + `deriveActFromIndex()` helpers (94 LOC) |
| `src/components/Projects.tsx` | Duplicate handler clear 11 fields (was 1) + updated comment + updated toast |
| `test/film_mode.test.tsx` | +3 tests (r7.28-fix coverage) |
| `manifest.json` + `package.json` | Bump 0.9.4.44 → 0.9.4.45, r7.27 → r7.28-fix-stage5-leak |

### Side effects

- Khi anh duplicate project sau r7.28-fix, **PHẢI re-confirm Preview Modal** (narrativeDirection bị clear). Đây là intentional — direction phụ thuộc idea, idea có thể đổi.
- `aiProvider: "manual"` trong script no_dialog mode — Cost Tracker sẽ không count AI cost cho Stage 5 (vì không call AI thực sự).

### Build state

- Version: `0.9.4.45` / `0.9.4-r7.28-fix-stage5-leak`
- TypeScript: 0 errors
- Vitest: 612/624 PASS (+3 new regression tests)
- Vite build: 11.38s
- `grep require dist/*` = 0 ✓

---

## [0.9.4-r7.27-camera-rules] — 2026-05-21 — Sprint r7.27: Cinematographer role upgrade (camera-action constraints + style filter)

### Goal

r7.21 đã có rule mapping rhythm role → camera (`buildAiPromptRules()` cuối với "ACTION shots: handheld/tracking"), nhưng đây là **soft suggestion**. AI có thể vẫn pick `dolly_zoom` cho cảnh chase vì rule không cấm explicitly. Hơn nữa, KSP chưa có **style-aware camera filter** — AI thấy 19 camera values bất kể style của project là `cgi_3d_cinematic` (Pixar) hay `stop_motion` (Wes Anderson) — dẫn đến output camera vocabulary không match studio signature.

### Changes

**`src/types/cameraMovement.ts`** — extend `buildAiPromptRules()` + add new `buildStyleCameraConstraints()`.

1. **Hướng A — FORBIDDEN COMBINATIONS** (hard constraints): thêm 4 nhóm "action → camera AVOID" vào cuối `buildAiPromptRules()`:
   - `[run, sprint, chase, race, flee, dash, leap, jump, rush]` → AVOID `[dolly_zoom, push_in, punch_in, dolly_in]` (slow camera + fast action mismatch)
   - `[whisper, breathe, tear, gaze, intimate, sigh, kiss, hug, hold, weep, breath, stare]` → AVOID `[handheld, tracking, oner, smartphone_zoom]` (intimate needs stability)
   - `shotType = "wide_establishing"` → AVOID `[push_in, punch_in, dolly_zoom, dolly_in]` (close-up moves on wide = no impact)
   - Static object/environment (no character movement) → AVOID `[handheld, tracking]` (no motion to follow = shaky for no reason)

2. **Hướng B — STYLE-SPECIFIC CAMERA SIGNATURE** filter: new function `buildStyleCameraConstraints(animationStyle)` returns block với PREFER/AVOID/REASON tailored per `AnimationStyleV2` value:

   | Style | PREFER | AVOID |
   |---|---|---|
   | `live_action` | tracking, handheld, smartphone_zoom, static, push_in | (none) |
   | `cgi_3d_cinematic` (Pixar) | static, oner, push_in, dolly_in, tracking | handheld, smartphone_zoom, webcam_style |
   | `anime_2d` (Ghibli) | pan_left/right, tilt_up/down, static, tracking | dolly_zoom, smartphone_zoom, webcam_style |
   | `cartoon_2d` | static, pan_left/right, tilt_up/down | dolly_zoom, smartphone_zoom, webcam_style, oner, punch_in |
   | `stop_motion` | static, locked_off, pan_left/right, push_in | tracking, oner, handheld, smartphone_zoom |
   | `film_noir` | static, dolly_zoom, push_in, locked_off, dolly_in | smartphone_zoom, webcam_style, handheld |

   Unknown/legacy style values → returns empty string (graceful degradation).

**`src/engine/filmShotListGeneration.ts`** — inject `buildStyleCameraConstraints(setting.animationStyle)` sau `buildAiPromptRules()` vào CẢ 2 system prompts:
- `generateShotListForScene` (line 217)
- `regenSingleShot` system prompt (cũ chỉ dùng 11-value camera list inline, em fix luôn để dùng `CAMERA_MOVEMENT_VALUES` đầy đủ 19 values + apply r7.27 rules — đồng bộ với generateShotListForScene)

**`test/film_mode.test.tsx`** — add 8 tests cho r7.27:
- FORBIDDEN section assertions (high-energy, intimate, wide_establishing, static-object)
- Style filter per `cgi_3d_cinematic`, `anime_2d`, `stop_motion`, `film_noir`, `live_action`
- Graceful unknown/legacy style fallback
- Wire-up verification: `filmShotListGeneration.ts` import + 2 injection points

### Files changed

| File | Change | LOC |
|---|---|---|
| `src/types/cameraMovement.ts` | +FORBIDDEN section, +buildStyleCameraConstraints() | 308 → 411 |
| `src/engine/filmShotListGeneration.ts` | Import + inject 2 places + fix regenSingleShot camera list | +3, regenSingleShot prompt updated |
| `test/film_mode.test.tsx` | +8 tests after r7.21 block | +98 |
| `manifest.json` + `package.json` | Bump 0.9.4.43 → 0.9.4.44, r7.26 → r7.27 | — |

### Impact

AI shot list sẽ tự né các combination kém chất lượng. Cụ thể nếu Jason chọn `animationStyle = cgi_3d_cinematic`:
- Trước r7.27: AI có thể pick `handheld` cho cảnh chase → output Pixar-style nhưng camera rung như indie movie
- Sau r7.27: AI ưu tiên `tracking` hoặc `oner` cho cảnh chase → match Pixar's "Up" balloon chase signature

### Build state

- Version: `0.9.4.44` / `0.9.4-r7.27-camera-rules`
- TypeScript: 0 errors
- Vitest: 609/621 PASS (+8 new tests)
- Vite build: 10.15s
- `grep require dist/*` = 0 ✓

---

## [0.9.4-r7.26-omni-prose] — 2026-05-21 — Sprint r7.26: Omni Prose mode (rewrite per official DeepMind guide)

### Goal

Jason hỏi cách integrate Gemini Omni prompt theo guide official DeepMind (https://deepmind.google/models/gemini-omni/prompt-guide/). Phân tích cho thấy r7.22 Omni builders đang dùng Veo3-style **structured** format (label "Setting:", "Camera:", "Lighting:", "Audio:", "Style:", "Negative:") trong khi guide official chỉ ra Omni cần **flowing prose** đan 5 element (Shot framing, Style, Lighting, Location, Action) trong 1 câu. Multi-shot guide chỉ 18 từ: *"Show me in this story. Follow the story exactly in order starting top left. Entire story in 10 seconds. Cinematic"*.

### Decision (Jason confirm)

REWRITE Omni builders in-place (KHÔNG tách 2 phiên bản). Veo3 builder (`filmShotPromptBuilder.ts`) giữ nguyên — Veo3 vẫn cần prescriptive. Omni builders đổi sang prose theo guide official.

### Changes

**`src/engine/omniShotPromptBuilder.ts`** — REWRITE từ 237 → 339 LOC.
- Output 1 câu prose duy nhất đan 5 element DeepMind, BỎ "Setting:", "Camera:", "Lighting:", "Audio:", "Style:", "Negative:" labels
- Audio inline trong ambiance clause: *"...creating a cinematic ambiance underscored by [audio]"*
- Identity anchor "preserve face, hair, and wardrobe exactly" GIỮ (KSP-specific cho cross-shot consistency)
- New helpers: `buildCameraOpening()` map 19 camera values → opening phrase (prefix/suffix/preposition); `getStyleAdjective()` map AnimationStyleV2 → mood adjective; `asContinuation()` normalize action clause
- Pattern: `"A {shotType} {motionPhrase} {subject anchor}, {action}, in {settings}, lit by {lighting}, creating {article} {styleAdj} ambiance{audio inline}."`

**`src/engine/omniMultiShotPromptBuilder.ts`** — REWRITE từ 222 → 257 LOC.
- Storyboard-driven pattern (official DeepMind 18-word): *"Show this story in <image_N> — follow the visual progression exactly in order, starting top-left"*
- BỎ "1) 0-Xs:... 2) X-Ys:..." verbose timeline (khi có storyboard)
- BỎ "Generate N connected shots" instruction
- BỎ "Negative:" block
- Fallback timeline khi `hasStoryboardImage=false`: format ngắn "shot 1 (0-3s, static): action; shot 2 (3-7s, tracking): action"
- Audio cues gộp 1 dòng "Audio cues — shot 1: X; shot 3: Y."
- Closing match guide official: "Entire story in N seconds. Cinematic."
- Plural agreement "faces, hair, wardrobes" khi 2+ characters

**`test/omni_prompts.test.tsx`** — UPDATE 16 → 19 tests (+3 new).
- Update assertions match prose format
- New tests: "the scene" fallback when no character, lighting integration clause, plural "faces/wardrobes" with 2+ chars

**UI** — KHÔNG động.
- `FilmFrameEditModal.tsx` button "📋 Copy Omni 🎯" giờ output prose (function signature giữ nguyên)
- `FilmStoryboardSection.tsx` button "🎯 Multi Shot Prompt" giờ output prose

### Sample output

**Single shot (Copy Omni)**:
> "A close-up pushing into Maya as shown in `<image_0>` — preserve face, hair, and wardrobe exactly, Maya sips cà phê sữa đá slowly, eyes drift to the rain, in Saigon coffee shop interior, wooden tables, rain on awning at dusk, lit by warm tungsten from pendant lamps overhead, creating a cinematic ambiance underscored by faint piano notes and rain pattering on awning."

**Multi-shot (Multi Shot Prompt, có storyboard)**:
> "Maya as shown in `<image_0>` — preserve face, hair, and wardrobe EXACTLY across all shots.
>
> Show this story in `<image_1>` — follow the visual progression exactly in order, starting top-left, set in Saigon coffee shop interior, wooden tables, rain on awning at dusk, lit by warm tungsten from pendant lamps overhead.
>
> Audio cues — shot 1: door bell + rain outside; shot 3: piano notes.
>
> Entire story in 12 seconds. Cinematic."

### Build state

- Version: `0.9.4.43` / `0.9.4-r7.26-omni-prose`
- TypeScript: 0 errors
- Vitest: 601/613 PASS (+3 new tests)
- Vite build: 10.47s
- `grep require dist/*` = 0 ✓

---

## [0.9.4-r7.25-doc-trim] — 2026-05-21 — Sprint r7.25: Documentation cleanup

### Goal

HANDOFF.md + CHANGELOG.md grew to 2648 + 8784 lines (over 11k LOC of sprint history). Risk of exceeding Claude Project knowledge token limits in future sessions.

### Action

- HANDOFF.md trimmed 2648 → ~215 lines (92% reduction). Keep current + last 4 sprints + roadmap + tech debt + architecture locks + working style.
- CHANGELOG.md trimmed 8784 → ~358 lines (96% reduction). Keep last ~10 sprints (r7.17+).
- Old content moved to local `HANDOFF_ARCHIVE.md` + `CHANGELOG_ARCHIVE.md`. NOT uploaded to Project knowledge.

### No code changes

Only documentation refactor. Version bumped for tracking purposes (0.9.4.41 → 0.9.4.42).

### Build state

- Version: `0.9.4.42` / `0.9.4-r7.25-doc-trim`
- TypeScript: 0 errors
- Vitest: 598/610 PASS
- `grep require dist/*` = 0 ✓

---

## [0.9.4-r7.24-throttling-cleanup-tests] — 2026-05-21 — Sprint r7.24: E+C+D batch

### E — Rate limit throttling (quota safety)

Addresses Jason's `Error code 253` on labs.google. KSP was sending 5 calls/sec (20× Gemini Flash free tier 15/min) — shared quota exhaustion blocking other Google services.

- **ProjectSettingV2.rateLimitMode**: `"free" | "tier1" | "aggressive"`. Default `free` (4000ms gap, ~15/min). Existing projects without field fall back to free.
- **autoChainOrchestrator.getDelayMs()**: reads setting + returns delay. Callback override wins.
- **autoChainOrchestrator.withRetry()**: exponential backoff helper (2s/4s/8s) for 429 errors. Defined but not yet wired.
- **Settings UI**: RATE LIMITS collapsible block with 3-mode dropdown + explainer.

8 sleep sites updated from `interJobDelayMs ?? 200` → `getDelayMs()`.

### C — Manifest version pin refactor

15 hard-pinned version assertions across 3 test files → regex format pattern. Future version bumps only touch manifest.json + package.json.

### D — Omni test coverage (NEW)

`test/omni_prompts.test.tsx` — 16 unit tests for `omniShotPromptBuilder` (7) + `omniMultiShotPromptBuilder` (9). Includes r7.22-fix1 regression test (FilmImageRef.dataUrl extraction).

### Build state

- Version: `0.9.4.41` / `0.9.4-r7.24-throttling-cleanup-tests`
- TypeScript: 0 errors
- Vitest: 598/610 PASS (+16 new)
- Vite build: 8.79s
- `grep require dist/*` = 0 ✓

---

## [0.9.4-r7.23-new-project-omni-gaps-cost-label] — 2026-05-20 — Sprint r7.23: A+B+C+D batched

### A — + New Project button

Pain point from r7.21: "không có nút tạo mới project trừ khi phải xoá hết". Added "+ New" button in `Projects.tsx` header. Click → create + open Editor.

### B — Close Omni gaps in shot list

Audio direction + Copy Omni were only in Frame Edit Modal. Now also in shot list expandable detail with `.ksp-shotlist-film-omni-row`.

### C — Cost Tracker live label wiring

`autoChainOrchestrator.ts`: new `setCostTrackerStage(label)` method updates `project.pipelineCost.currentStage`. Wired at 8 stage start points + cleared at grid-build completion.

### D — Deprecate dead code

`musicVoiceImage.ts:buildShotImagePrompt` confirmed 0 callers. Added `@deprecated` JSDoc.

### Build state

- Version: `0.9.4.40` / `0.9.4-r7.23-new-project-omni-gaps-cost-label`
- TypeScript: 0 errors
- Vitest: 582/594 PASS
- Build: 11.41s

---

## [0.9.4-r7.22-omni-prompts-fix1] — 2026-05-20 — Sprint r7.22 fix1: `H.dataUrl.replace is not a function`

### Bug

Jason clicked "🎯 Multi Shot Prompt" → toast error `Multi Shot Prompt lỗi: H.dataUrl.replace is not a function`.

### Root cause

`omniShotPromptBuilder` + `omniMultiShotPromptBuilder` treated `character.conceptSheet` as raw base64 string. Actually it's a `FilmImageRef` object with structure `{ id, filename, mimeType, dataUrl: "..." }`. The reference manifest stored the whole object as `dataUrl`. When handler called `.replace()` for base64 stripping, it crashed because object has no `.replace` method.

`(char as any).conceptSheet` cast had hidden the type mismatch.

### Fix

Both omni builders extract `.dataUrl` with type-guarded fallback:
```ts
const conceptDataUrl: string | undefined =
  (typeof conceptSheetRef === "string" ? conceptSheetRef : conceptSheetRef?.dataUrl) ||
  (typeof faceRef === "string" ? faceRef : faceRef?.dataUrl);
if (conceptDataUrl && typeof conceptDataUrl === "string") { ... }
```

Plus defensive type-guard in `FilmStoryboardSection` handler before `.replace()`.

---

## [0.9.4-r7.22-omni-prompts] — 2026-05-20 — Sprint r7.22 Gemini Omni full prompt integration (combined a/b/c)

### Background

Per Jason research request (May 19 announcement of Gemini Omni Flash), KSP supports outputting Omni-friendly prompts + multimodal reference bundles. Omni API chưa public — KSP serves as prompt assembler, user pastes/uploads vào Gemini app/Flow.

### r7.22a — Single-shot Omni prompt builder + 2 Copy buttons

**New `src/engine/omniShotPromptBuilder.ts` (~210 LOC):**

Format:
```
<character_names> as shown in <image_0> — preserve face, hair, and wardrobe exactly,
<action>.
Setting: <scene_settings>.
Camera: <shot_type>, <camera_movement>.
Lighting: <lighting_hint>.
Audio: <audio_direction> (if set).
Style: <animation_style>, <duration>s, <aspect_ratio>.
Negative: no cuts to other characters, no morphing faces, no wardrobe changes,
no captions, no watermarks.
```

Features:
- Multimodal `<image_N>` placeholders (per DeepMind official guide)
- Character detection: protagonist + cast names appearing in shot action text
- Identity anchor "preserve exactly"
- Camera vocabulary from r7.21 single source of truth via `getEnglishTerm()`
- Audio direction inline (if `FilmShot.audioDirection` set)
- Style as suffix (NOT verbose Tier 1-4 lock) — trust Omni reasoning
- Returns `{ promptText, references[] }`

**`FilmFrameEditModal.tsx`:** 2 Copy buttons side-by-side ("📋 Copy Veo3 🎬" + "📋 Copy Omni 🎯") + Audio direction input row (200 char limit).

### r7.22b — Multi-shot scene prompt + grid merge

**New `src/engine/omniMultiShotPromptBuilder.ts` (~195 LOC)** — multi-shot Pattern 2 from DeepMind:
```
Characters: <names> as shown in <image_0>, <image_1>. Preserve face exactly.
Visual reference: <image_2> shows storyboard grid. Follow visual progression top-left.
Setting: <scene_settings>.
Lighting: <scene_lighting>.

Generate <N> connected shots, same character throughout, no cuts to other characters:
1) 0-Xs: <shot_type>, <movement> — <action> [audio: <cue>].
2) X-Ys: <shot_type>, <movement> — <action>.
...
Global style: <style>, <total>s, <aspect>.
Negative: no cuts, no morphing, no wardrobe changes, no jitter.
```

**New `src/engine/gridImageMerger.ts` (~105 LOC):** smart vertical stack merge — 1 grid → return as-is; 2+ grids → load via Image API, draw to canvas top-to-bottom, max-width × sum-height + 8px gaps.

**`FilmStoryboardSection.tsx`:** "🎯 Multi Shot Prompt" button in `.ksp-storyboard-grid-header-downloads` BEFORE Animation + Image buttons. Downloads ZIP `scene-N_omni_multi-shot.zip` with prompt.txt + concept sheets + merged storyboard PNG + Vietnamese README.

### r7.22c — Bundle export adaptive (merged into r7.22b)

The Multi Shot Prompt button IS the bundle exporter. Adaptive: all character concept sheets (filtered to chars present in scene) + merged storyboard grid (auto vertical stack) + Vietnamese README. Future-ready for audio/video refs.

### Files changed

| File | Type | LOC |
|---|---|---|
| `src/engine/omniShotPromptBuilder.ts` | NEW | +210 |
| `src/engine/omniMultiShotPromptBuilder.ts` | NEW | +195 |
| `src/engine/gridImageMerger.ts` | NEW | +105 |
| `src/types/project.ts` | +`FilmShot.audioDirection?: string` | +9 |
| `src/components/FilmFrameEditModal.tsx` | +Copy Omni button + audio direction row + state + save | +60 |
| `src/components/FilmStoryboardSection.tsx` | +Multi Shot Prompt button + handler (110 LOC) + allGrids prop wiring | +130 |
| `manifest.json` + `package.json` | bump 0.9.4.37 → 0.9.4.38 |

### Backward compat

- `audioDirection` optional → old shots have undefined → Omni prompt skips Audio line
- Existing Veo3 prompt buttons untouched
- Scenes without uploaded storyboard grid still show Multi Shot Prompt button → bundle skips storyboard image, ZIP still useful with concept sheets + prompt
- Single-grid scenes: merger fast-path returns unchanged dataURL

---

## [0.9.4-r7.21-camera-movement-centralize] — 2026-05-20 — Sprint r7.21 Camera Movement single source of truth

### Background

Tech debt: `cameraMovement` defined in 4 files NOT in sync. Type in project.ts had 7 obsolete values; UI/AI used 11 different values. Code bypassed with `as any` casts. Adding new values required editing 4 files with risk of forgetting one.

Trigger: Sprint r7.22+ needs to add 8 Omni-friendly camera vocab terms from DeepMind's Gemini Omni prompt guide.

### Solution

New file `src/types/cameraMovement.ts` is single source of truth — **19 values total**, each tagged with `veo3Compatible: boolean`, `omniCompatible: boolean`, category, AI hint, English label, Vietnamese label.

### 19 values categorized

- **Universal (3, both modes)**: `static`, `handheld`, `tracking`
- **Veo3-only (8)**: `pan_left`, `pan_right`, `tilt_up`, `tilt_down`, `zoom_in`, `zoom_out`, `dolly_in`, `dolly_out`
- **Omni-only (8, per DeepMind official guide)**: `oner`, `locked_off`, `push_in`, `punch_in`, `dolly_zoom`, `smartphone_zoom`, `film_camera`, `webcam_style`

### Architecture decision

**AI is mode-agnostic at gen time** — picks from all 19 values regardless of project setting. Mode-specific rendering happens at Copy Prompt time. AI can creatively suggest `dolly_zoom` for a Hitchcock-style scene.

### Helper functions

- `getOptionsForMode(mode)` — filter for UI dropdown
- `getLabel(value)` — Vietnamese label, falls back gracefully for legacy values
- `getEnglishTerm(value)` — English label for prompts. `oner` → "one continuous shot", `smartphone_zoom` → "natural smartphone zoom"
- `isKnownValue(value)` — detect legacy values
- `buildAiPromptRules()` — generates the categorized AI prompt block
- `CAMERA_MOVEMENT_VALUES` — readonly string[] for JSON schema enum

### Files changed

| File | Change |
|---|---|
| `src/types/cameraMovement.ts` | NEW (+260 LOC) |
| `src/types/project.ts` | FilmCameraMovement re-exports CameraMovementValue |
| `src/components/FilmShotListSection.tsx` | Remove local array, import + badge |
| `src/components/FilmFrameEditModal.tsx` | Same |
| `src/engine/filmShotListGeneration.ts` | Import + use buildAiPromptRules() |
| `src/engine/sceneImagePromptBuilder.ts` | Use getEnglishTerm() |
| `src/engine/filmShotPromptBuilder.ts` | Use getEnglishTerm() ×2 |
| `src/engine/chunkPlanner.ts` | Use getEnglishTerm() ×2 |
| `src/components/FilmAnimaticPlayerModal.tsx` | Use getLabel() |
| `test/film_mode.test.tsx` | +3 tests (19 values, getEnglishTerm, UI imports) |

### Backward compat

Pre-r7.21 projects with legacy values (`steadicam_smooth`, `drone_aerial`, `handheld_documentary`):
- `getLabel()` returns raw value
- `getEnglishTerm()` does snake_case → space fallback
- TS type accepts via `CameraMovementValue | string` union

---

## [0.9.4-r7.20b-direction-summary-moved] — 2026-05-20 — Sprint r7.20b Direction Summary → Preview Modal Step 6

Move Direction Summary panel khỏi Section Ý tưởng vào Preview Modal Step 6 (Review & Confirm). Section Ý tưởng giảm clutter, review direction tự nhiên hơn trong modal flow.

**Section Ý tưởng REMOVED:** collapsible panel `.ksp-idea-direction-summary` (~50 LOC) + state `directionSummaryExpanded`.

**Preview Modal Step 6 POLISHED:**
- Header "Step 6/6 — Review & Confirm" + 6 progress dots
- Each pick item: header with label + Edit button + bold title + description
- Step 4 multi-pick: orange border + "N PICKS" badge + additionalPicks list (clipped 120 chars)
- Cost estimate hint: "~$0.03 (~750 VND) với Gemini Flash"
- 2-button CTA: "← Quay lại sửa" + "✓ Lưu & Phân tích →"
- New prop `onBack: () => void` wired to `setCurrentStep(5)`

---

## [0.9.4-r7.20a-cost-tracker-fix1] — 2026-05-20 — Sprint r7.20a fix1: `require is not defined` browser runtime crash

### Bug

Jason reported `Uncaught ReferenceError: require is not defined` in `src/sidepanel.html` after applying r7.20a. Extension crashed silently on click "Analyze Idea".

### Root cause

r7.20a `FilmIdeaScriptSection.tsx` used CommonJS `require()` syntax in 3 places (handleOpenPreviewFlow + runAutoChain success + runAutoChain error) to lazy-import `pipelineCost_actions`. Browser Chrome extension has no CommonJS runtime. Vite bundles ES modules only. TypeScript compiler accepted `require()` (probably from `@types/node`), and tests passed (vitest uses Node which has `require`), so this slipped past `tsc --noEmit` + `vitest run` checks.

### Fix

Convert all 4 `require()` calls to static ES imports (including 1 pre-existing legacy in `filmScriptStages.ts:289` that would have broken eventually).

### Lesson + new pre-ship gate

`grep -c "require(" dist/assets/index-*.js` must equal **0**. If non-zero → browser will crash at runtime regardless of TS/test passes.

---

## [0.9.4-r7.20a-cost-tracker] — 2026-05-20 — Sprint r7.20a Pipeline cost tracker

### Background

Jason hỏi mỗi pipeline run tốn bao nhiêu. Realistic 10 scenes: ~$0.031 Gemini Flash, ~$0.886 Gemini Pro, ~$1.40 OpenAI 4o, $0.21/char GPT Image 2. Jason reports actual "mấy ngàn đồng" — likely GPT Image 2 concept sheets or Pro provider.

### Architecture: pub/sub emitter

~50 `callAi` callsites. Module-level emitter avoids refactoring signature:
```
[AI call sites] → emitTextCost() / emitImageCost()
                        ↓
              [costTracker.ts listeners Set]
                        ↓
   [PipelineCostTracker subscribes in useEffect]
                        ↓
       updateProject(p => ({ pipelineCost: ... }))
```

### Pricing constants (May 2026)

- Gemini 2.5 Flash: $0.075/1M input, $0.30/1M output
- Gemini 2.5 Pro: $1.25/1M input, $10.0/1M output (~30× Flash)
- OpenAI 4o: $2.50/1M input, $10.0/1M output (~33× Flash)
- GPT Image 2 high: $0.21/call (~5.500 VND)
- GPT Image 2 low: $0.04/call (~1.000 VND)
- USD→VND rate hard-coded `25500`

### Data model — PipelineCostRun

Single-slot record on `project.pipelineCost`:
```ts
{
  runId, startedAt, completedAt?, status: "running"|"done"|"aborted",
  textCostUsd, imageCostUsd, textCalls, imageCalls, currentStage?
}
```

`startPipelineCostRun()` replaces previous record. Regen calls after `status === "done"` continue accumulating per Jason's confirmation.

### UI state machine (PipelineCostTracker.tsx)

- `pipelineCost === undefined` → render `null`
- `status === "running"` → orange border, pulsing dot, "Pipeline running..."
- `status === "done"` → gray border, "Pipeline cost", Reset button visible
- `status === "aborted"` → red-tinted border

Visual layout fits 380px sidebar. Text/Image split row with dashed divider. Image AI value turns orange when >80% of total.

### Files

| File | Change | LOC |
|---|---|---|
| `src/engine/costTracker.ts` | NEW: calculator + emitter + formatters | +140 |
| `src/types/project.ts` | Add PipelineCostRun + field | +35 |
| `src/store/pipelineCost_actions.ts` | NEW: state mutators | +115 |
| `src/components/PipelineCostTracker.tsx` | NEW: UI component | +110 |
| `src/engine/filmScriptStages.ts` | Hook emit after API response parse | +25 |
| `src/engine/gptImageApi.ts` | Hook emit after image gen | +4 |
| `src/components/FilmIdeaScriptSection.tsx` | Wire start/complete/abort + render | +18 |
| `src/components/film.css` | Tracker styles + pulse animation | +140 |

---

## [0.9.4-r7.19-idea-section-polish] — 2026-05-20 — Sprint r7.19 Idea Section UI polish

### Changes

**Textarea Ý tưởng** — `min-height: 80px → 200px`, `rows={4} → 8`. `resize: vertical` for user drag.

**Label đổi**: Gộp 2 state ("Phân tích ý tưởng" + "Phân tích lại") → single **"🎬 Analyze Idea"** (English). Loading: "⏳ Analyzing...".

**Idea mismatch warning** (Hướng B): New optional `NarrativeDirection.ideaSnapshot: string` captures `project.idea` text at direction approval time. When current idea no longer matches snapshot (normalized trim+lowercase+collapse-whitespace), warning banner appears with 2 actions:
- **Giữ direction cũ**: dismiss for session via `setIdeaMismatchDismissed(true)`
- **Xóa direction**: clear `narrativeDirection` + `previewCache`

Backward-compat: Legacy direction records without `ideaSnapshot` → skip warning.

---

## [0.9.4-r7.18-bugfix-batch] — 2026-05-20 — Sprint r7.18 5 bugs gộp

5 bugs fixed:

1. **Description AI trả JSON wrap** → `filmCastGeneration.ts` add JSON.parse + extract `visual_description`/`character_description`/`description`/`text`/`content`/`value` field
2. **No-text image directive weak** — `characterSheetPrompt.ts` strict NO TEXT/LABELS/LOGOS/WATERMARKS all-caps + `sceneImagePromptBuilder.ts` promote no-text from Tier 4 → Tier 1 ABSOLUTE LOCK
3. **Version markers in runtime logs** — `autoChainOrchestrator.ts:505` `[AutoChain r7.15c]` → `[AutoChain]`
4. **Bundle export thiếu concept sheet** — `filmBundleExporter.ts` add export `c.conceptSheet` → `cast/{name}_concept.{ext}`
5. **Stage 2/3 swap mismatch** — backend swapped (stage-2=Twists SKIP, stage-3=Beats AI) but frontend `FilmIdeaScriptSection.tsx` not. Fix: `STAGE_ORDER` → `["structure","twists","beats","scenes","dialogues"]`

---

## [0.9.4-r7.17-cast-linear-layout] — 2026-05-19 — Sprint r7.17 Cast Section Linear Layout

Replaced r7.16 Variant C tabs (Info/Sheet/Actions) with flat linear layout. Concept sheet always visible, border red when not uploaded. Layout: header → sheet panel → manual row (Copy Prompt orange + Upload) → mô tả label → textarea → AI row (Generate Concept Image + Generate Character Description). Avatar always emoji from `ROLE_EMOJI[role]`. -203 LOC tabs CSS, +80 LOC linear.

---

> **Pre-r7.17 sprints (r7.15a through r7.16) and Photos mode history (v0.7-v0.9.1) archived in `CHANGELOG_ARCHIVE.md`** if needed for historical reference.
