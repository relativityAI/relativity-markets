#!/usr/bin/env bash
# Vendor the PDF font TTFs into services/api/fonts/ (checked in — no runtime network).
# A UA with no woff2 support (plain "Mozilla/5.0") makes fonts.googleapis.com
# answer with truetype instead of woff2.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=services/api/fonts
mkdir -p "$OUT"
UA="Mozilla/5.0"

fetch() { # family, weight, italic(0|1), dest-file
  local q="family=${1// /+}:ital,wght@${3},${2}"
  local url
  url=$(curl -sS -A "$UA" "https://fonts.googleapis.com/css2?${q}" | grep -o 'https://[^)]*' | head -1)
  [ -n "$url" ] || { echo "MISS ${1} ${2} ital=${3}"; exit 1; }
  curl -sS -o "$OUT/$4" "$url"
  echo "ok $4"
}

fetch "Newsreader" 400 0 Newsreader-Regular.ttf
fetch "Newsreader" 400 1 Newsreader-Italic.ttf
fetch "Newsreader" 600 0 Newsreader-SemiBold.ttf
fetch "Newsreader" 700 0 Newsreader-Bold.ttf
fetch "Anek Latin" 300 0 AnekLatin-Light.ttf
fetch "Anek Latin" 400 0 AnekLatin-Regular.ttf
fetch "Anek Latin" 500 0 AnekLatin-Medium.ttf
fetch "Anek Latin" 600 0 AnekLatin-SemiBold.ttf
ls -la "$OUT"
