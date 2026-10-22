#!/usr/bin/env bash
# Builds resources/atlases/badge-atlas.png from the game-icons.net SVGs in
# resources/icons/game-icons (CC BY 3.0, credited in CREDITS.md).
# Cell order is load-bearing (src/client/render/gl/BadgeAtlas.ts): 0-7 border
# troops by age, 8 clash, 9 wood, 10 rock, 11 fish. Each cell is 128 px,
# white on clear; the shaders only read the alpha.
# Entries marked ":solid" get their inner holes filled (tricorn.svg is the hat
# outline of Delapouite's "pirate-hat" without feather; filling drops the skull).
# Every icon is trimmed and fitted to 112 px so they share one visual weight.
# Needs rsvg-convert and ImageMagick 7.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=resources/icons/game-icons
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ICONS=(
  stone-spear        # 0 Stone Age
  spartan-helmet     # 1 Classical
  centurion-helmet   # 2 Imperial
  black-knight-helm  # 3 Feudal
  tricorn:solid      # 4 Enlightened
  pickelhaube        # 5 Industrial
  brodie-helmet      # 6 Modern
  astronaut-helmet   # 7 Alien
  crossed-swords     # 8 clash
  pine-tree          # 9 wood
  stone-stack        # 10 rock
  salmon             # 11 fish
)
i=0
for entry in "${ICONS[@]}"; do
  name=${entry%%:*}
  # Drop the black background square of game-icons.net downloads; force white.
  sed -e 's#<path d="M0 0h512v512H0z"/>##' -e 's#fill="\#[0-9a-fA-F]*"#fill="\#ffffff"#g' \
    "$SRC/$name.svg" > "$TMP/$name.svg"
  rsvg-convert -w 512 -h 512 -b none "$TMP/$name.svg" -o "$TMP/raw.png"
  magick "$TMP/raw.png" -trim +repage -resize 112x112 -background none -gravity center \
    -extent 128x128 +repage "$TMP/cell.png"
  if [[ $entry == *:solid ]]; then
    magick "$TMP/cell.png" -alpha extract "$TMP/a.png"
    magick "$TMP/a.png" -threshold 50% -fill red -draw "color 0,0 floodfill" \
      -fill white +opaque red -fill black -opaque red "$TMP/m.png"
    magick "$TMP/a.png" "$TMP/m.png" -compose lighten -composite "$TMP/a2.png"
    magick -size 128x128 xc:white "$TMP/a2.png" -alpha off -compose copy-opacity -composite "$TMP/cell.png"
  fi
  cp "$TMP/cell.png" "$TMP/$(printf %02d $i).png"
  i=$((i+1))
done
magick "$TMP"/[0-9][0-9].png +append +repage -define png:color-type=6 resources/atlases/badge-atlas.png
echo "wrote resources/atlases/badge-atlas.png ($i cells)"
