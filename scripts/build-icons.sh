#!/usr/bin/env bash
# Generate the Home Display icon assets.
#
# The icon is a countdown drawn as the panel's own LEDs: 28 discrete dots
# arranged in a ring, the first 21 lit in the house green (--c-go) and the last
# 7 left dim, on the panel's near-black over a faint LED-matrix texture.
# It reads as "the Galactic Unicorn is counting down" rather than as any one
# routine — the duck / book / toy-box / shoe each stand for a single routine,
# so none of them can stand for the remote itself.
#
# Writes: apple-touch-icon-180.png, icon-192.png, icon-512.png, favicon.png.
# The path is deliberately stable: a Cloudflare Access bypass is scoped to it.
# Bump `?v=` in src/app.html to bust device/edge caches when the art changes.
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

# 3. Ring geometry: 16 dots on a 300px radius, 40px dots (80px diameter against
#    a 118px pitch, so the gaps stay open at 180px and at 64px). 12 of 16 lit =
#    75%, swept clockwise from 12 o'clock. Discrete dots, not an arc: the
#    countdown reads in the panel's own LED vocabulary.
R=300
DOT=40
N=16
LIT=12

python3 - "$R" "$DOT" "$N" "$LIT" > ring.all <<'PY'
import math, sys
R, dot, n, lit = (float(a) for a in sys.argv[1:5])
R = int(R); dot = int(dot); n = int(n); lit = int(lit)
cx = cy = 512
rows = []
for i in range(n):
    a = math.radians(-90 + i * 360 / n)
    x, y = cx + R * math.cos(a), cy + R * math.sin(a)
    rows.append((i < lit, x, y))
print('ALL')
for on, x, y in rows:
    col = '#34c96a' if on else 'rgba(52,201,106,0.20)'
    print(f'fill "{col}" circle {x:.1f},{y:.1f} {x:.1f},{y-dot:.1f}')
print('LIT')
for on, x, y in rows:
    if on:
        print(f'fill "#34c96a" circle {x:.1f},{y:.1f} {x:.1f},{y-dot:.1f}')
PY

sed -n '/^ALL$/,/^LIT$/p' ring.all | sed '1d;$d' > ring.draw
sed -n '/^LIT$/,$p' ring.all | sed '1d' > ring_lit.draw

# 4. Glow: the lit dots, blurred, screened behind the sharp ones
magick -size ${S}x${S} xc:black -stroke none \
  -draw "$(cat ring_lit.draw)" ring_glow_raw.png
magick ring_glow_raw.png -blur 0x18 ring_glow.png
magick base.png ring_glow.png -compose Screen -composite canvas.png

# 5. Sharp ring
magick canvas.png -stroke none -draw "$(cat ring.draw)" master-1024.png

# 6. Export. 8-bit RGB, no alpha: what Apple expects, and much smaller.
magick master-1024.png -resize 180x180 -depth 8 -alpha off -strip \
  "$STATIC/apple-touch-icon-180.png"
magick master-1024.png -resize 192x192 -depth 8 -alpha off -strip "$STATIC/icon-192.png"
magick master-1024.png -resize 512x512 -depth 8 -alpha off -strip "$STATIC/icon-512.png"
magick master-1024.png -resize 64x64 -depth 8 -alpha off -strip "$STATIC/favicon.png"

echo "Generated icons in $STATIC:"
ls -lh "$STATIC"/*.png
