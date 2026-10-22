#version 300 es
precision highp float;
precision highp usampler2D;
precision highp sampler2DArray;

uniform usampler2D uTileTex;      // R16UI — tile state per cell
uniform sampler2D  uPalette;      // RGBA32F — player colors
uniform sampler2D  uPatternMeta;  // RGBA32F — 1D buffer, 1 px per owner. R=hasPattern, G=width, B=height, A=scale
uniform usampler2D uPatternData;  // R8UI    — 2D buffer, row per owner, bytes for bitmask
uniform sampler2DArray uSkinAtlas; // RGBA8 — per-skin PNG layer, tiled via REPEAT wrap
uniform usampler2D uSkinLayer;    // R8UI — 1D buffer, 1 px per owner. 0=no skin, otherwise layer+1
uniform usampler2D uSkinAnchor;   // RG16UI — 1D buffer, anchor tile (cx, cy) per owner. (0,0) = world origin
uniform int uShowPatterns;
uniform int uIsTeamMode;          // 1 = teams (tint skin by team color), 0 = FFA (raw skin colors)
const float SKIN_DIM = 1024.0;    // atlas cell size in tiles — must match SkinAtlasArray.SKIN_DIM

uniform vec2 uMapSize;
uniform int uAltView;
uniform float uStaleNukeBase;
uniform float uStaleNukeVariation;
uniform float uStaleNukeAlpha;
uniform vec3 uStaleNukeColor;
uniform uint uHighlightOwner;      // 0 = no highlight; otherwise smallID of hovered owner
uniform uint uLocalOwner;          // smallID of the local player; 0 = none (replay/spectate)
uniform float uHighlightBrighten;  // hover contrast boost strength; 0 = disabled
uniform sampler2D uDefenseCoverageTex; // R8 — 1.0 = tile defended by same-owner post
uniform float uDefenseDarken;      // multiplier applied to fill on defended tiles
uniform sampler2D uBorderTex;      // RGBA8 — border flags; R > 0.25 = border tile
uniform float uSaturation;         // 1 = full color, 0 = grayscale
uniform float uTerritoryAlpha;     // absolute fill opacity; 1 = fully opaque
uniform sampler2D uFogTex;         // R8 — primitive-fog byte (0 unseen, ~0.5 remembered, >0.78 lit)
uniform int uFogEnabled;           // 1 = primitive fog active for the local player

in vec2 vWorldPos;
out vec4 fragColor;

// Smoothstep-weighted bilinear coverage of `owner` over the 2x2 nearest tile
// centers. The 0.5 iso-contour of this field rounds convex tile corners, so
// territory reads as an organic blob instead of square pixels. Shrink-only:
// pixels outside owned tiles are never claimed, so fills can't spill onto
// water or wilderness (2026-07-02 owner direction: "amorphous, less square").

float ofHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float ofNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(ofHash(i), ofHash(i + vec2(1.0, 0.0)), u.x),
    mix(ofHash(i + vec2(0.0, 1.0)), ofHash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

// Organic domain warp: displaces where the edge contour is SAMPLED by two
// octaves of value noise (max ~0.9 tiles), so territory outlines undulate
// like hand-drawn map regions instead of following the tile grid (owner
// direction 2026-07-02: "more organic territory map looking").
vec2 organicWarp(vec2 wp) {
  // Low octave: wavelength ~8 tiles, ~0.9-tile swing — big enough to bow the
  // long straight runs of a large blob. High octave: ~2-tile coastline
  // roughness (fresh-eyes retune 2026-07-02).
  float a = ofNoise(wp * 0.13 + vec2(17.0, 3.0)) - 0.5;
  float b = ofNoise(wp * 0.13 + vec2(53.0, 29.0)) - 0.5;
  float c = ofNoise(wp * 0.45 + vec2(91.0, 47.0)) - 0.5;
  float d = ofNoise(wp * 0.45 + vec2(7.0, 71.0)) - 0.5;
  return vec2(a * 1.8 + c * 0.5, b * 1.8 + d * 0.5);
}

float ownerField(uint owner, vec2 worldPos) {
  // 3x3 tent kernel (radius 1.5 tiles): wide enough to smooth diagonal
  // tile staircases into near-45deg contours, not just round single corners.
  ivec2 c = ivec2(floor(worldPos));
  float acc = 0.0;
  float total = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 t = clamp(c + ivec2(dx, dy), ivec2(0), ivec2(uMapSize) - 1);
      vec2 center = vec2(t) + 0.5;
      vec2 d = abs(worldPos - center);
      float w = max(0.0, 1.0 - d.x / 1.5) * max(0.0, 1.0 - d.y / 1.5);
      uint o = texelFetch(uTileTex, t, 0).r & uint(OWNER_MASK);
      acc += (o == owner) ? w : 0.0;
      total += w;
    }
  }
  return total > 0.0 ? acc / total : 0.0;
}

// Nearest owned tile's owner in the 3x3 ring around (warped) worldPos, by
// tent weight — lets edge pixels in UNOWNED tiles join a neighbour blob's
// organic contour so the warp can bulge outward instead of being clipped
// flat against the tile grid (fresh-eyes root cause, 2026-07-02).
uint dominantNeighborOwner(vec2 worldPos) {
  ivec2 c = ivec2(floor(worldPos));
  uint bestOwner = 0u;
  float bestW = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 t = clamp(c + ivec2(dx, dy), ivec2(0), ivec2(uMapSize) - 1);
      uint o = texelFetch(uTileTex, t, 0).r & uint(OWNER_MASK);
      if (o == 0u) continue;
      vec2 center = vec2(t) + 0.5;
      vec2 d = abs(worldPos - center);
      float w = max(0.0, 1.0 - d.x / 1.5) * max(0.0, 1.0 - d.y / 1.5);
      if (w > bestW) {
        bestW = w;
        bestOwner = o;
      }
    }
  }
  return bestOwner;
}

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  // Fog-of-war gate: territory in NEVER-SEEN fog is hidden outright (rivals
  // used to bleed through the shroud as grey squares scattered across the
  // whole world — 2026-07-10 real-GPU audit shot 08); remembered ground shows
  // a ghost of the last-seen empire. The local player's own tiles are glow
  // SEEDS (always fully lit), so this never touches "my" territory. LINEAR
  // sampling on the fog texture fades territory in smoothly at the rim.
  float fogVis = 1.0;
  if (uFogEnabled == 1) {
    float fs = texture(uFogTex, vWorldPos / uMapSize).r;
    float seen = smoothstep(0.10, 0.44, fs);   // 0 unseen -> 1 by remembered
    float cur = smoothstep(0.55, 0.80, fs);    // 0 remembered -> 1 lit
    fogVis = seen * mix(0.45, 1.0, cur);       // remembered = 45% ghost
    if (fogVis < 0.02) discard;
  }

  uint raw = texelFetch(uTileTex, tc, 0).r;
  uint owner = raw & uint(OWNER_MASK);
  bool fallout = (raw & (1u << FALLOUT_BIT)) != 0u;

  // One organic contour, filled AND stroked from the same warped field:
  // owned edge pixels carve back to it, and unowned edge pixels may join the
  // dominant neighbour's blob so the contour can bulge OUTWARD too (otherwise
  // the tile grid clips every outward wave flat — fresh-eyes root cause).
  // Fallout ground keeps its hard gritty tile edge.
  float edgeField = 1.0;
  if (!fallout) {
    if (owner != 0u) {
      ivec2 mx = ivec2(uMapSize) - 1;
      // Interior fast-path: tiles whose whole 8-ring is same-owner skip the
      // edge math (the warp reaches ~1 tile inward at most).
      bool interior = true;
      for (int idy = -1; idy <= 1 && interior; idy++) {
        for (int idx = -1; idx <= 1; idx++) {
          if (idx == 0 && idy == 0) continue;
          uint io = texelFetch(uTileTex, clamp(tc + ivec2(idx, idy), ivec2(0), mx), 0).r & uint(OWNER_MASK);
          if (io != owner) { interior = false; break; }
        }
      }
      if (!interior) {
        edgeField = ownerField(owner, vWorldPos + organicWarp(vWorldPos));
        if (edgeField < 0.5) discard;
      }
    } else {
      // 5-tap early-out: pixels with no owned tile in their orthogonal ring
      // can't reach the 0.5 contour — skip the 9-tap field for the open map.
      ivec2 gmx = ivec2(uMapSize) - 1;
      if ((texelFetch(uTileTex, clamp(tc + ivec2(1, 0), ivec2(0), gmx), 0).r & uint(OWNER_MASK)) == 0u &&
          (texelFetch(uTileTex, clamp(tc - ivec2(1, 0), ivec2(0), gmx), 0).r & uint(OWNER_MASK)) == 0u &&
          (texelFetch(uTileTex, clamp(tc + ivec2(0, 1), ivec2(0), gmx), 0).r & uint(OWNER_MASK)) == 0u &&
          (texelFetch(uTileTex, clamp(tc - ivec2(0, 1), ivec2(0), gmx), 0).r & uint(OWNER_MASK)) == 0u) {
        discard;
      }
      vec2 wp = vWorldPos + organicWarp(vWorldPos);
      uint cand = dominantNeighborOwner(wp);
      if (cand == 0u) discard;
      edgeField = ownerField(cand, wp);
      if (edgeField < 0.5) discard;
      owner = cand;
    }
  } else if (owner == 0u) {
    // unowned fallout: fall through to the fallout ground below
  }

  if (owner == 0u && !fallout) discard;

  // --- Stale-nuke ground (any fallout tile, owned or not) ---
  // Renders for owned tiles too so the player's territory color can't bleed
  // through dim/transparent spots in the fallout bloom above.
  if (fallout) {
    float h = fract(sin(float(tc.x) * 12.9898 + float(tc.y) * 78.233) * 43758.5453);
    float noise = uStaleNukeBase + h * uStaleNukeVariation;
    fragColor = vec4(uStaleNukeColor + vec3(noise), uStaleNukeAlpha * fogVis);
    return;
  }

  // Alt-view: hide owned non-fallout tiles
  if (uAltView != 0) discard;

  // --- Territory fill (owned, not fallout) ---
  float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
  vec4 color = texture(uPalette, vec2(u, 0.25));

  // uShowPatterns gates both skins and patterns — they're the same
  // "decorate the territory fill" feature from the user's perspective.
  uint skinLayerPlus1 =
    uShowPatterns == 1
      ? texelFetch(uSkinLayer, ivec2(int(owner), 0), 0).r
      : 0u;
  if (skinLayerPlus1 > 0u) {
    // Skin overrides pattern entirely (mutually exclusive). The image is a
    // single stamp centered at the player's spawn tile — UVs outside [0,1]
    // are treated as transparent so tiles beyond the image bounds fall back
    // to the regular palette color. (0,0) anchor sentinel = world origin.
    uvec2 anchor = texelFetch(uSkinAnchor, ivec2(int(owner), 0), 0).rg;
    vec2 anchorOffset = (anchor == uvec2(0u)) ? vec2(0.0) : vec2(anchor);

    vec2 skinUV = (vec2(tc) - anchorOffset) / vec2(SKIN_DIM) + vec2(0.5);
    vec4 skin = texture(uSkinAtlas, vec3(skinUV, float(skinLayerPlus1) - 1.0));
    bool inBounds =
      skinUV.x >= 0.0 && skinUV.x <= 1.0 &&
      skinUV.y >= 0.0 && skinUV.y <= 1.0;
    float skinAlpha = inBounds ? skin.a : 0.0;
    // Transparent (or out-of-bounds) pixels fall through to the player color;
    // opaque pixels show the skin (tinted by team color in team games).
    vec3 skinColor = (uIsTeamMode == 1) ? color.rgb * skin.rgb : skin.rgb;
    color.rgb = mix(color.rgb, skinColor, skinAlpha);
  } else if (uShowPatterns == 1) {
    vec4 meta = texelFetch(uPatternMeta, ivec2(int(owner), 0), 0);
    if (meta.r > 0.0) {
      int pWidth = int(meta.g);
      int pHeight = int(meta.b);
      int pScale = int(meta.a);

      int px = tc.x >> pScale;
      int py = tc.y >> pScale;
      int mx = ((px % pWidth) + pWidth) % pWidth;
      int my = ((py % pHeight) + pHeight) % pHeight;
      int bitIndex = my * pWidth + mx;
      int byteIndex = bitIndex >> 3;

      uint patternByte = texelFetch(uPatternData, ivec2(byteIndex, int(owner)), 0).r;
      bool isPrimary = (patternByte & (1u << uint(bitIndex & 7))) == 0u;

      if (!isPrimary) {
        color = texture(uPalette, vec2(u, 0.75));
      }
    }
  }

  // Hover highlight: boost contrast on the hovered player's tiles, pushing
  // channels away from mid-gray. uHighlightBrighten is the strength; 0 disables.
  if (uHighlightOwner != 0u && owner == uHighlightOwner && uHighlightBrighten > 0.0) {
    float contrast = 1.0 + uHighlightBrighten;
    color.rgb = clamp((color.rgb - 0.5) * contrast + 0.5, 0.0, 1.0);
  }

  // Defense bonus: darken the fill on interior tiles defended by a same-owner
  // post. Border tiles are skipped — they get the checkerboard overlay from
  // BorderStampPass instead. Coverage is tested first so the (rarer) defended
  // tiles are the only ones that pay for the extra border fetch (&& short-
  // circuits in GLSL ES 3.00; texelFetch is derivative-free so this is safe).
  if (texelFetch(uDefenseCoverageTex, tc, 0).r > 0.5 &&
      texelFetch(uBorderTex, tc, 0).r <= 0.25) {
    color.rgb *= uDefenseDarken;
  }

  // Own-empire emphasis: the LOCAL player's fill gets a strong saturation
  // push toward full color plus a higher alpha (below), so "my empire" reads
  // first against rivals. Rival/bot territory keeps the plain dusty chart
  // wash. (0.4/1.15 was imperceptible on the live render — 2026-07-10 audit
  // shots 01/04: pale washed-out blob with no pop.)
  bool isLocal = uLocalOwner != 0u && owner == uLocalOwner;
  // Own land is told apart by a stronger wash, not by neon saturation.
  float sat = isLocal ? mix(uSaturation, 1.0, 0.3) : uSaturation;
  float alphaScale = isLocal ? 1.12 : 1.0;

  // Adjust how saturated the fill is by blending toward its luminance.
  if (sat != 1.0) {
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(luma), color.rgb, sat);
  }

  // Pixel-rate anti-aliased edge. The crisp definition now comes from the
  // dark ink outline stroked in border-stamp.frag; the fill itself stays clean
  // and readable instead of the muddy dark rim it used to bake in (2026-07-05
  // owner: "primitive blob looks suck" — the wide 0.62 inner darkening + a
  // same-hue border read as a fuzzy dirty edge). Keep only a whisper of edge
  // depth in a thin band so the fill has body without going muddy.
  float aaW = max(fwidth(edgeField) * 1.2, 0.025);
  color.rgb *= mix(0.9, 1.0, smoothstep(0.0, 0.045, edgeField - 0.5));

  // Hand-tinted atlas wash (Marta 2026-10-22: the flat saturated fill "is not
  // cool"). Old maps lay colour thickest along the border and let it thin out
  // inward, with faint ink hatching over the region. `inner` is a smooth
  // (bilinear) ownership coverage sampled 3 tiles out in 8 directions: 1 deep
  // inside, falling toward the border - no per-tile steps.
  float inner = 0.0;
  for (int k = 0; k < 8; k++) {
    float ang = float(k) * 0.785398;
    vec2 sp = vWorldPos + vec2(cos(ang), sin(ang)) * 3.0 - 0.5;
    ivec2 b0 = ivec2(floor(sp));
    vec2 f = fract(sp);
    ivec2 lim = ivec2(uMapSize) - 1;
    float c00 = (texelFetch(uTileTex, clamp(b0, ivec2(0), lim), 0).r & uint(OWNER_MASK)) == owner ? 1.0 : 0.0;
    float c10 = (texelFetch(uTileTex, clamp(b0 + ivec2(1, 0), ivec2(0), lim), 0).r & uint(OWNER_MASK)) == owner ? 1.0 : 0.0;
    float c01 = (texelFetch(uTileTex, clamp(b0 + ivec2(0, 1), ivec2(0), lim), 0).r & uint(OWNER_MASK)) == owner ? 1.0 : 0.0;
    float c11 = (texelFetch(uTileTex, clamp(b0 + ivec2(1, 1), ivec2(0), lim), 0).r & uint(OWNER_MASK)) == owner ? 1.0 : 0.0;
    inner += mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
  }
  inner /= 8.0;
  float band = 1.0 - smoothstep(0.35, 0.98, inner);
  if (edgeField < 0.999) band = max(band, 1.0 - smoothstep(0.5, 1.0, edgeField));
  // Diagonal hatching in world space, faded out when zoomed far out so it
  // never shimmers into moire.
  float hp = (vWorldPos.x + vWorldPos.y) * 0.85;
  float hw = fwidth(hp);
  float hatch = (1.0 - smoothstep(0.08, 0.08 + hw * 1.5, abs(fract(hp) - 0.5) - 0.38))
      * (1.0 - smoothstep(0.35, 0.9, hw));
  float wash = mix(0.42, 1.0, band) + hatch * 0.22;
  color.rgb = mix(color.rgb, color.rgb * 0.72, band * 0.35);
  color.a =
      min(uTerritoryAlpha * alphaScale * wash, 1.0) *
      smoothstep(0.5, 0.5 + aaW, edgeField) *
      fogVis;

  fragColor = color;
}
