#!/usr/bin/env bash
# Generate the Home Display icon assets.
#
# The icon is a countdown, not a routine: a bright green timer arc that is
# ~72% swept, on the panel's near-black, over a faint LED-matrix texture. The
# green is the house "go" token (--c-go) and the dot grid is the physical
# Pimoroni Galactic Unicorn's matrix. Deliberately no routine symbol — the duck
# / book / toy-box / shoe each stand for one of four routines, so none of them
# can stand for the remote itself (routines.json is the identity source *in the
# UI*; the app icon is the product, not a routine).
#
# Writes: apple-touch-icon-180.png, icon-192.png, icon-512.png, favicon.png.
# The 180px name is deliberately stable: Cloudflare Access bypasses that exact
# path, so renaming it means a new Access application.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATIC="$ROOT/static"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$STATIC"
cd "$TMP"
S=1024

# 1. Base: near-black with a soft lift off-centre
magick -size ${S}x${S} radial-gradient:'#18231f-#080b0a' bg.png

# 2. Faint LED matrix — the panel's physical array
magick -size 64x64 xc:none -fill 'rgba(52,201,106,0.10)' \
  -draw 'circle 32,32 32,29' dot.png
magick bg.png \( -size ${S}x${S} tile:dot.png \) -compose Over -composite base.png

# 3. Timer arc geometry: radius 274, 96px stroke, 72% swept clockwise from 12.
#    The sweep is 72% rather than 75% so the gap reads as deliberate at 60px.
CX=512 CY=512 R=274
SWEEP=259.2   # 0.72 * 360
END_X=$(python3 -c "import math;print(f'{$CX + $R*math.cos(math.radians(-90+$SWEEP)):.1f}')")
END_Y=$(python3 -c "import math;print(f'{$CY + $R*math.sin(math.radians(-90+$SWEEP)):.1f}')")

# 4. Glow: the lit arc, blurred, screened behind the sharp arc
magick -size ${S}x${S} xc:black -stroke '#34c96a' -fill none \
  -draw "stroke-width 96 stroke-linecap round path 'M $CX,$((CY-R)) A $R,$R 0 1 1 $END_X,$END_Y'" \
  arc_glow_raw.png
magick arc_glow_raw.png -blur 0x40 arc_glow.png
magick base.png arc_glow.png -compose Screen -composite canvas.png

# 5. Sharp arc: dim full track, then the lit sweep, then the centre hub
magick canvas.png -stroke none \
  -stroke 'rgba(52,201,106,0.14)' -fill none \
  -draw "stroke-width 96 path 'M $CX,$((CY-R)) A $R,$R 0 1 1 $((CX)),$((CY+R)) A $R,$R 0 0 1 $CX,$((CY-R))'" \
  -stroke '#34c96a' \
  -draw "stroke-width 96 stroke-linecap round path 'M $CX,$((CY-R)) A $R,$R 0 1 1 $END_X,$END_Y'" \
  -stroke none -fill '#34c96a' -draw "circle $CX,$CY $CX,$((CY+40))" \
  master-1024.png

# 6. Export. 8-bit RGB, no alpha: what Apple expects, and much smaller.
magick master-1024.png -resize 180x180 -depth 8 -alpha off -strip \
  "$STATIC/apple-touch-icon-180.png"
magick master-1024.png -resize 192x192 -depth 8 -alpha off -strip "$STATIC/icon-192.png"
magick master-1024.png -resize 512x512 -depth 8 -alpha off -strip "$STATIC/icon-512.png"
magick master-1024.png -resize 64x64 -depth 8 -alpha off -strip "$STATIC/favicon.png"

echo "Generated icons in $STATIC:"
ls -lh "$STATIC"/*.png
