#!/usr/bin/env bash
# Builds resources/atlases/badge-atlas.png from the game-icons.net SVGs in
# resources/icons/game-icons (CC BY 3.0, credited in CREDITS.md).
# Cell order is load-bearing (src/client/render/gl/BadgeAtlas.ts): 0-7 border
# troops by age, 8 clash, 9 wood, 10 rock, 11 fish. Each cell is 128 px.
# Troop and clash cells are white on clear; their shader reads only alpha.
# Entries marked ":solid" get their inner holes filled (tricorn.svg is the hat
# outline of Delapouite's "pirate-hat" without feather; filling drops the skull).
# Entries marked ":res" are resource pictograms, fitted smaller (92 px) so a
# halo fits around them, and packed as four masks for ResourceNodePass:
#   R = the icon itself (its holes are the inked detail lines)
#   G = the icon's filled silhouette
#   B = the silhouette grown 3 px (the ink outline)
#   A = the silhouette grown ~11 px and softened (the parchment halo)
# Every mask is zero wherever A is zero, so premultiplied decoding loses nothing.
# Troop icons are trimmed and fitted to 112 px so they share one visual weight.
# Needs rsvg-convert and ImageMagick 7.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=resources/icons/game-icons
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ICONS=(
  caveman            # 0 Stone Age (a spear-carrying figure: reads as a person)
  spartan-helmet     # 1 Classical
  centurion-helmet   # 2 Imperial
  black-knight-helm  # 3 Feudal
  tricorn:solid      # 4 Enlightened
  pickelhaube        # 5 Industrial
  brodie-helmet      # 6 Modern
  astronaut-helmet   # 7 Alien
  crossed-swords     # 8 clash
  pine-tree:res      # 9 wood
  stone-pile:res     # 10 rock (a rubble heap; a stacked cairn read as a figure)
  salmon:res         # 11 fish
)

# Fill the holes of a white-on-clear cell: alpha mask in $1, solid mask out $2.
fill_holes() {
  magick "$1" -threshold 50% -fill red -draw "color 0,0 floodfill" \
    -fill white +opaque red -fill black -opaque red "$TMP/m.png"
  magick "$1" "$TMP/m.png" -compose lighten -composite "$2"
}

i=0
for entry in "${ICONS[@]}"; do
  name=${entry%%:*}
  fit=112
  [[ $entry == *:res ]] && fit=92
  # Drop the black background square of game-icons.net downloads; force white.
  sed -e 's#<path d="M0 0h512v512H0z"/>##' -e 's#fill="\#[0-9a-fA-F]*"#fill="\#ffffff"#g' \
    "$SRC/$name.svg" > "$TMP/$name.svg"
  rsvg-convert -w 512 -h 512 -b none "$TMP/$name.svg" -o "$TMP/raw.png"
  magick "$TMP/raw.png" -trim +repage -resize ${fit}x${fit} -background none -gravity center \
    -extent 128x128 +repage "$TMP/cell.png"
  if [[ $entry == *:solid ]]; then
    magick "$TMP/cell.png" -alpha extract "$TMP/a.png"
    fill_holes "$TMP/a.png" "$TMP/a2.png"
    magick -size 128x128 xc:white "$TMP/a2.png" -alpha off -compose copy-opacity -composite "$TMP/cell.png"
  elif [[ $entry == *:res ]]; then
    magick "$TMP/cell.png" -alpha extract "$TMP/e.png"
    fill_holes "$TMP/e.png" "$TMP/s.png"
    magick "$TMP/s.png" -morphology Dilate Disk:3 "$TMP/o.png"
    magick "$TMP/s.png" -morphology Dilate Disk:9 -blur 0x2.5 "$TMP/h0.png"
    magick "$TMP/h0.png" "$TMP/o.png" -compose lighten -composite "$TMP/h.png"
    magick "$TMP/e.png" "$TMP/s.png" "$TMP/o.png" "$TMP/h.png" -channel RGBA -combine \
      -define png:color-type=6 "$TMP/cell.png"
  fi
  cp "$TMP/cell.png" "$TMP/$(printf %02d $i).png"
  i=$((i+1))
done
magick "$TMP"/[0-9][0-9].png -background none +append +repage -strip \
  -define png:color-type=6 resources/atlases/badge-atlas.png
echo "wrote resources/atlases/badge-atlas.png ($i cells)"
