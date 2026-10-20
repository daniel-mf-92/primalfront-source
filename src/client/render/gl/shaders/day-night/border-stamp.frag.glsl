#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;
uniform sampler2D uPalette;
uniform sampler2D uBorderTex;     // RGBA8 — border flags from BorderComputePass
uniform sampler2D uDefenseCoverageTex; // R8 — 1.0 = defended by same-owner post
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — affiliation colors (row 0 = border)
uniform vec2 uMapSize;
uniform int uAltView;
uniform float uHighlightBrighten;
uniform float uDefenseCheckerDarken;
uniform float uEmbargoTintRatio;
uniform float uFriendlyTintRatio;
uniform vec3 uEmbargoTint;
uniform vec3 uFriendlyTint;
uniform float uZoom;              // camera zoom (screen px per world tile)
uniform sampler2D uFogTex;        // R8 — primitive-fog byte (0 unseen, ~0.5 remembered, >0.78 lit)
uniform int uFogEnabled;          // 1 = primitive fog active for the local player
uniform uint uLocalOwner;         // smallID of the local player; 0 = none

in vec2 vWorldPos;
out vec4 fragColor;

// Same smoothstep-bilinear owner coverage as territory.frag: border stamps are
// clipped to the rounded fill contour so they hug the organic edge instead of
// poking out as square tiles at corners.

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
  // Must match territory.frag exactly so fill and border share one contour.
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

// Must match territory.frag: nearest owned tile's owner around the warped
// position, so the stroke can ride the contour on BOTH sides of the raw
// ownership boundary.
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
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  // Fog-of-war gate — must match territory.frag so fill and ink hide/ghost
  // together (rival borders used to punch through the shroud as hard square
  // outlines — 2026-07-10 real-GPU audit shot 08). Own borders sit on glow
  // seeds, always lit.
  float fogVis = 1.0;
  if (uFogEnabled == 1) {
    float fs = texture(uFogTex, vWorldPos / uMapSize).r;
    float seen = smoothstep(0.10, 0.44, fs);
    float cur = smoothstep(0.55, 0.80, fs);
    fogVis = seen * mix(0.45, 1.0, cur);
    if (fogVis < 0.02) discard;
  }

  uint raw = texelFetch(uTileTex, tc, 0).r;
  uint owner = raw & uint(OWNER_MASK);

  // Read pre-computed border flags from BorderComputePass
  vec4 borderData = texelFetch(uBorderTex, tc, 0);
  float borderType = borderData.r;      // 0=interior, ~0.5=normal, ~1.0=highlight
  bool defense = texelFetch(uDefenseCoverageTex, tc, 0).r > 0.5; // same-owner defense post nearby
  float relation = borderData.a;        // 0.0=neutral, ~0.5=friendly, ~1.0=embargo

  bool isHighlightBorder = borderType > 0.75;

  // --- Border STROKE: a band riding the same warped organic contour the
  // territory fill uses ("one path — fill it, stroke it"). Whole-tile border
  // stamps produced a square inner moat around the organic fill
  // (fresh-eyes root cause, 2026-07-02).
  {
    ivec2 gmx = ivec2(uMapSize) - 1;
    if (owner == 0u &&
        (texelFetch(uTileTex, clamp(tc + ivec2(1, 0), ivec2(0), gmx), 0).r & uint(OWNER_MASK)) == 0u &&
        (texelFetch(uTileTex, clamp(tc - ivec2(1, 0), ivec2(0), gmx), 0).r & uint(OWNER_MASK)) == 0u &&
        (texelFetch(uTileTex, clamp(tc + ivec2(0, 1), ivec2(0), gmx), 0).r & uint(OWNER_MASK)) == 0u &&
        (texelFetch(uTileTex, clamp(tc - ivec2(0, 1), ivec2(0), gmx), 0).r & uint(OWNER_MASK)) == 0u) {
      discard;
    }
    vec2 wp = vWorldPos + organicWarp(vWorldPos);
    uint cand = owner != 0u ? owner : dominantNeighborOwner(wp);
    if (cand == 0u) discard;
    float f = ownerField(cand, wp);
    // Gradient-normalized stroke: |f - iso| / |grad f| = distance in PIXELS,
    // so the ink line keeps constant screen width — no pooling into blobs at
    // tight concavities, no dashed dropout on flat runs (fresh-eyes round 3).
    float grad = max(fwidth(f), 1e-4);
    float distPx = abs(f - 0.56) / grad;
    // Zoom-scaled ink weight: at working zoom the stroke keeps its current
    // ~3px falloff, but zoomed far out a constant-px line disappears against
    // the shrinking territories — widen toward a ~4.5px political-map line
    // and lift its alpha so the world view still reads bordered. Both ends
    // clamp via the smoothstep range (uZoom 0.35..1.6 px/tile).
    float far = 1.0 - smoothstep(0.35, 1.6, uZoom);
    float widthScale = mix(1.0, 1.45, far); // 3.2px → ~4.6px outer falloff
    float stroke = 1.0 - smoothstep(1.6 * widthScale, 3.2 * widthScale, distPx);
    // Never stroke outside the fill contour's own AA edge.
    stroke *= smoothstep(0.5 - grad, 0.5 + grad, f);
    stroke = min(stroke * mix(1.0, 1.25, far), 1.0);
    if (stroke < 0.02) discard;
    owner = cand;
    vec3 bc;
    if (uAltView != 0) {
      // Alt-view: pure affiliation color from palette row 0
      bc = texelFetch(uAffiliation, ivec2(int(owner), 0), 0).rgb;
    } else {
      float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
      bc = texture(uPalette, vec2(u, 0.75)).rgb;
      // Crisp map-ink outline: pull the border toward a warm-dark ink so every
      // territory gets a defined, high-contrast edge on the parchment atlas
      // instead of a low-contrast same-hue line that read as a fuzzy dirty rim
      // (2026-07-05 owner: "primitive blob looks suck"). A hint of the player
      // hue survives so you can still tell whose border it is. Applied before
      // highlight/relationship tint so those still shift the line. The LOCAL
      // player's outline keeps noticeably more of their color so "my empire"
      // pops against rivals (2026-07-10 audit: own blob had no pop).
      float inkMix = (uLocalOwner != 0u && owner == uLocalOwner) ? 0.40 : 0.58;
      bc = mix(bc, vec3(0.055, 0.045, 0.050), inkMix);
      if (isHighlightBorder) {
        bc = mix(bc, vec3(1.0), uHighlightBrighten);
      }
      // Relationship tint (applied BEFORE defense checkerboard, matching game)
      if (relation > 0.75) {
        bc = mix(bc, uEmbargoTint, uEmbargoTintRatio);
      } else if (relation > 0.25) {
        bc = mix(bc, uFriendlyTint, uFriendlyTintRatio);
      }
      // Defense bonus: checkerboard darken (applied AFTER tint, matching game)
      if (defense) {
        bool checker = ((tc.x + tc.y) & 1) == 1;
        if (checker) bc *= uDefenseCheckerDarken;
      }
    }
    fragColor = vec4(bc, stroke * fogVis);
    return;
  }
}
