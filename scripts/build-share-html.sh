#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_FILE="$ROOT_DIR/Power-Analyzer-share.html"
TMP_BODY="$(mktemp)"

# Extract body content and remove local app.js reference.
sed -n '/<body>/,/<\/body>/p' "$ROOT_DIR/index.html" | sed '1d;$d' | sed '/<script src="\.\/app\.js"><\/script>/d' > "$TMP_BODY"

{
  cat <<'HTML_HEAD'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>电池摄像头功耗计算器 - 项目版</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
HTML_HEAD
  cat "$ROOT_DIR/styles.css"
  cat <<'HTML_MID'
  </style>
</head>
<body>
HTML_MID
  cat "$TMP_BODY"
  cat <<'HTML_SCRIPT'
  <script>
HTML_SCRIPT
  cat "$ROOT_DIR/app.js"
  cat <<'HTML_TAIL'
  </script>
</body>
</html>
HTML_TAIL
} > "$OUT_FILE"

rm -f "$TMP_BODY"
echo "Generated: $OUT_FILE"
