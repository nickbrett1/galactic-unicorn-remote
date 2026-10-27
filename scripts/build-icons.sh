#!/usr/bin/env bash
# Generate Home Display icon assets: master 1024, apple-touch-icon (180),
# PWA icons (192, 512), and favicon (64).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATIC="$ROOT/static"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$STATIC"
cd "$TMP"
S=1024

# 1. Base dark background with slight radial lift (near-black #0b0e0d)
magick -size ${S}x${S} radial-gradient:'#18231f-#080b0a' base.png

# 2. Subtle LED matrix dots (the panel's physical LED array)
magick -size 64x64 xc:none -fill 'rgba(52,201,106,0.10)' \
  -draw 'circle 32,32 32,29' dot.png
magick base.png \( -size ${S}x${S} tile:dot.png \) -compose Over -composite base_grid.png

# 3. Soft ambient glow layer behind the duck (blurred)
magick -size ${S}x${S} xc:black \
  -fill '#34c96a' \
  -draw "polygon 640,540 860,390 760,670" \
  -draw "ellipse 530,620 230,165 0,360" \
  -draw "circle 390,410 390,270" \
  -draw "path 'M 360,395 Q 195,400 135,425 Q 120,435 130,448 Q 185,465 360,460 Z'" \
  glow_raw.png
magick glow_raw.png -blur 0x44 glow_blur.png
magick base_grid.png glow_blur.png -compose Screen -composite canvas_with_glow.png

# 4. Render duck
magick canvas_with_glow.png \
  -stroke none \
  `# --- Bedtime / Galactic stars (top right) ---` \
  -fill 'rgba(255,255,255,0.85)' \
  -draw "path 'M 820,185 Q 820,215 850,215 Q 820,215 820,245 Q 820,215 790,215 Q 820,215 820,185 Z'" \
  -fill 'rgba(52,201,106,0.75)' \
  -draw "path 'M 720,265 Q 720,282 737,282 Q 720,282 720,299 Q 720,282 703,282 Q 720,282 720,265 Z'" \
  -fill 'rgba(255,255,255,0.5)' \
  -draw "circle 890,275 890,271" \
  `# --- Water reflection pool beneath duck ---` \
  -fill 'rgba(52,201,106,0.16)' -draw "ellipse 520,775 270,36 0,360" \
  -fill 'rgba(52,201,106,0.30)' -draw "ellipse 510,770 190,20 0,360" \
  `# --- BEAK (drawn BEFORE head so head circle cleanly masks the root) ---` \
  -fill '#f0b429' \
  -draw "path 'M 360,395 Q 195,400 135,425 Q 120,435 130,448 Q 185,465 360,460 Z'" \
  -fill '#d49b1a' \
  -draw "path 'M 130,448 Q 185,465 360,460 L 360,442 Q 185,448 135,438 Z'" \
  -fill none -stroke '#9b6807' \
  -draw "stroke-linecap round stroke-width 6 path 'M 134,440 Q 200,446 360,432'" \
  -stroke none \
  -fill '#9b6807' -draw "ellipse 225,418 6,4 -10,350" \
  `# --- DUCK SILHOUETTE (solid #34c96a) ---` \
  -fill '#34c96a' \
  -draw "path 'M 620,560 Q 750,560 865,390 Q 815,570 710,685 Z'" \
  -draw "ellipse 530,620 225,160 0,360" \
  -draw "polygon 300,430 460,430 480,570 340,570" \
  -draw "circle 390,410 390,270" \
  `# --- Wing: sleek darker tone with warm highlight ---` \
  -fill '#1c8c49' \
  -draw "path 'M 470,600 Q 610,535 710,580 Q 670,700 550,700 Q 485,675 470,600 Z'" \
  -fill '#27a557' \
  -draw "path 'M 490,610 Q 605,555 680,595 Q 640,680 555,680 Q 505,665 490,610 Z'" \
  `# --- Eye: friendly cartoon eye with dual sparkle ---` \
  -fill '#080b0a' -draw "circle 375,370 375,340" \
  -fill '#ffffff' -draw "circle 364,360 364,351" \
  -fill '#ffffff' -draw "circle 388,382 388,378" \
  master-1024.png

# 5. Export targets into static/
# apple-touch-icon: 180x180, square full-bleed (iOS applies the squircle mask)
magick master-1024.png -resize 180x180 -quality 95 "$STATIC/apple-touch-icon.png"

# PWA icons
magick master-1024.png -resize 192x192 -quality 95 "$STATIC/icon-192.png"
magick master-1024.png -resize 512x512 -quality 95 "$STATIC/icon-512.png"

# Favicon for browser tabs
magick master-1024.png -resize 64x64 "$STATIC/favicon.png"

echo "Generated icons in $STATIC:"
ls -lh "$STATIC"
