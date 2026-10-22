#version 300 es
precision highp float;

// Border troop badge: a medallion with an ink rim, a broad team-colour ring
// (the main cue: whose people stand here) and the era emblem in ink on a
// team-tinted parchment face (atlas cells 0-7: spear-carrying caveman, Spartan
// helm, legion helm, great helm, tricorn, pickelhaube, Brodie helmet, space
// helmet). The emblem faces outward and drops away when the badge is tiny.
// kind 1 = a clash: ember ring, crossed swords, a spark ring breathing out.
// Local units: badge radius 0.5, y down (screen), quad spans +-0.75.

in vec2 vLocalPos;
flat in float vKind;
flat in float vCell;
flat in vec3 vColor;
flat in float vAlpha;
flat in float vSeed;
flat in float vFacing;
flat in float vPx;

uniform sampler2D uAtlas;
uniform float uCells;
uniform float uTime;
uniform float uGlobalAlpha;

out vec4 fragColor;

const vec3 INK = vec3(0.11, 0.085, 0.06);
const vec3 PARCHMENT = vec3(0.955, 0.905, 0.775);
const vec3 EMBER = vec3(0.80, 0.24, 0.10);

// Emblem coverage from the atlas. The icon art fills 112/128 of its cell;
// `half` is the half-extent of the whole cell in badge units.
float emblem(vec2 p, float cell, float halfCell) {
  vec2 uv = p / (2.0 * halfCell) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float a = texture(uAtlas, vec2((cell + uv.x) / uCells, uv.y)).a;
  // Firm up the mip-softened edge a little so the ink reads crisp.
  return clamp((a - 0.5) * 1.5 + 0.5, 0.0, 1.0);
}

void main() {
  vec2 p = vLocalPos;
  float r = length(p);
  float aa = max(fwidth(r), 1e-4);
  bool clash = vKind > 0.5;
  float ph = vSeed * 6.2831853;

  const float R = 0.5;        // outer edge of the medallion
  const float RIM = 0.055;    // ink rim width
  const float RING_IN = 0.335; // inner edge of the colour ring

  float disc = 1.0 - smoothstep(R - aa, R + aa, r);

  // Soft drop shadow, down and right, under the disc only.
  float sh = 1.0 - smoothstep(0.40, 0.60, length(p - vec2(0.04, 0.08)));
  float shadowA = sh * 0.32 * (1.0 - disc);

  vec3 ringCol;
  if (clash) {
    float beat = pow(0.5 + 0.5 * sin(uTime * 5.5 + ph), 3.0);
    ringCol = mix(EMBER, vec3(0.97, 0.52, 0.20), beat * 0.6);
  } else {
    // Team colour at a fixed mid lightness with its chroma boosted, so pale
    // pastel teams still show a clear ring and dark teams do not go black.
    float l = dot(vColor, vec3(0.299, 0.587, 0.114));
    vec3 chroma = vColor - vec3(l);
    float c = max(max(abs(chroma.r), abs(chroma.g)), abs(chroma.b));
    vec3 rich = vec3(0.42) + chroma * (0.22 / max(c, 0.06));
    ringCol = clamp(rich, 0.0, 1.0);
  }
  // Parchment face, tinted toward the ring, a touch darker toward the rim.
  vec3 col = mix(PARCHMENT, ringCol, clash ? 0.06 : 0.14) *
    (1.0 - 0.10 * smoothstep(0.1, RING_IN, r));
  float ring = smoothstep(RING_IN - aa, RING_IN + aa, r);
  col = mix(col, ringCol, ring);
  // Hairline between ring and face.
  float hair = 1.0 - smoothstep(0.008, 0.008 + aa * 1.2, abs(r - RING_IN));
  col = mix(col, INK, hair * 0.85);
  // Outer ink rim.
  float rim = smoothstep(R - RIM - aa, R - RIM + aa, r);
  col = mix(col, INK, rim);

  // Emblem in ink (dark ember ink on a clash).
  float e = emblem(vec2(p.x * vFacing, p.y), vCell, 0.262 * 128.0 / 112.0) * (1.0 - ring);
  e *= smoothstep(17.0, 21.0, vPx);
  vec3 emblemInk = clash ? vec3(0.36, 0.07, 0.03) : INK;
  col = mix(col, emblemInk, e);

  float alpha = disc;
  vec3 outCol = col;

  if (clash) {
    // A spark ring breathing outward from the rim, then fading.
    float t = fract(uTime * 0.75 + vSeed);
    float rr = R + 0.02 + 0.20 * t;
    float w = 0.022 * (1.0 - 0.5 * t);
    float sparkRing = (1.0 - smoothstep(w, w + aa, abs(r - rr))) * (1.0 - t) * (1.0 - disc);
    // Break it into short dashes so it reads as sparks, not a halo.
    float ang = atan(p.y, p.x);
    float dash = step(0.35, fract(ang * 1.9099 + vSeed * 3.0 + t * 0.5));
    sparkRing *= dash;
    vec3 sparkCol = vec3(0.98, 0.62, 0.22);
    outCol = mix(outCol, sparkCol, sparkRing);
    alpha = max(alpha, sparkRing * 0.9);
  }

  // Shadow below everything else.
  outCol = mix(vec3(0.05, 0.04, 0.03), outCol, alpha / max(alpha + shadowA, 1e-4));
  alpha = max(alpha, shadowA);

  alpha *= vAlpha * uGlobalAlpha;
  if (alpha < 0.004) discard;
  fragColor = vec4(outCol, alpha);
}
