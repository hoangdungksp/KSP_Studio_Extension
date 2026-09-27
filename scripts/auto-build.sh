#!/usr/bin/env bash
# auto-build.sh — Stop hook của Claude Code.
# Mỗi khi Claude xong một lượt: nếu source mới hơn dist/ thì tự build lại.
# - Build OK   → báo "reload extension" cho Jason.
# - Build lỗi  → chặn Claude dừng lại, đưa log lỗi để Claude tự sửa.

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR" || exit 0

INPUT="$(cat)"
STOP_HOOK_ACTIVE="$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)"

STAMP="dist/manifest.json"
SOURCES=(src public manifest.json package.json vite.config.ts tsconfig.json tailwind.config.js postcss.config.js)

# Không có thay đổi nào kể từ lần build trước → bỏ qua
if [ -f "$STAMP" ] && [ -z "$(find "${SOURCES[@]}" -newer "$STAMP" -type f 2>/dev/null | head -1)" ]; then
  exit 0
fi

LOG="$(mktemp -t ksp-build)"
if npm run build >"$LOG" 2>&1; then
  VERSION="$(jq -r '.version' "$STAMP" 2>/dev/null)"
  jq -n --arg v "$VERSION" '{systemMessage: ("✅ KSP Studio v" + $v + " đã build xong — vào chrome://extensions bấm ↻ để test")}'
  rm -f "$LOG"
  exit 0
fi

ERR="$(grep -v '^\s*$' "$LOG" | tail -40)"
rm -f "$LOG"

if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  # Đã chặn một lần rồi mà vẫn lỗi → không lặp vô hạn, chỉ báo cho Jason
  jq -n '{systemMessage: "❌ KSP Studio build vẫn lỗi — đừng reload extension, bảo Claude sửa tiếp"}'
  exit 0
fi

jq -n --arg e "$ERR" '{decision: "block", reason: ("npm run build thất bại. Sửa lỗi rồi mới kết thúc:\n" + $e)}'
exit 0
