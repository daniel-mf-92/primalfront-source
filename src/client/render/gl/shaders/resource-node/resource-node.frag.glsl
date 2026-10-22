#version 300 es
precision highp float;

// Resource nodes as small parchment discs with an ink emblem from the shared
// badge atlas (Marta 2026-10-22: the old pictograms "look like a turd" and it
// was not clear which resource is which): a pine tree = wood, a stone cairn =
// rock, a salmon = fish. Same medallion language as the border troop badges,
// but no team ring, so a resource never reads as a unit. Each emblem is inked
// in its own muted hue (forest, slate, river) so the kinds also differ at a
// glance. Local units: quad spans +-0.5, y down.

in vec2 vLocalPos;
flat in float vAlpha;
flat in float vSeed;
flat in float vKind;
flat in float vVisibility;
flat in float vQuantity;
flat in float vDeath;
flat in float vPrimitive;

uniform sampler2D uAtlas;
uniform float uCells;
uniform float uGlobalAlpha;
uniform float uTime;

out vec4 fragColor;

const vec3 INK = vec3(0.11, 0.085, 0.06);
const vec3 PARCHMENT = vec3(0.945, 0.90, 0.78);
// Atlas cells (BadgeAtlas.ts).
const float CELL_WOOD = 9.0;
const float CELL_ROCK = 10.0;
const float CELL_FISH = 11.0;

float emblem(vec2 p, float cell, float halfCell) {
  vec2 uv = p / (2.0 * halfCell) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float a = texture(uAtlas, vec2((cell + uv.x) / uCells, uv.y)).a;
  return clamp((a - 0.5) * 1.5 + 0.5, 0.0, 1.0);
}

void main() {
  vec2 p = vLocalPos;
  float r = length(p);
  float aa = max(fwidth(r), 1e-4);
  bool primitive = vPrimitive > 0.5;
  bool isWood = vKind < 1.5;
  bool isRock = vKind >= 1.5 && vKind < 2.5;
  bool isFish = !isWood && !isRock;

  const float R = 0.40;
  const float RIM = 0.035;
  float disc = 1.0 - smoothstep(R - aa, R + aa, r);

  vec3 face = PARCHMENT * (1.0 - 0.08 * smoothstep(0.05, R, r));
  vec3 inkHue = isWood ? vec3(0.10, 0.27, 0.11)
              : isRock ? vec3(0.22, 0.21, 0.20)
              : vec3(0.07, 0.22, 0.36);
  float cell = isWood ? CELL_WOOD : isRock ? CELL_ROCK : CELL_FISH;
  float e = emblem(p, cell, 0.285 * 128.0 / 112.0);
  vec3 col = mix(face, inkHue, e);
  float rim = smoothstep(R - RIM - aa, R - RIM + aa, r);
  col = mix(col, INK, rim);

  // Felled / emptied nodes wipe away from the top down as they go.
  float wipeLine = 1.0 - vDeath;
  float wipe = smoothstep(wipeLine - 0.16, wipeLine + 0.10, p.y + 0.5);
  float mask = disc * (primitive ? 1.0 - wipe : 1.0);

  // Soft shadow so the disc sits on the map instead of floating.
  float sh = (1.0 - smoothstep(0.34, 0.48, length(p - vec2(0.03, 0.05)))) * (1.0 - disc);
  float shadowA = sh * 0.28 * (1.0 - vDeath);
  vec3 shadowCol = vec3(0.06, 0.05, 0.03);

  float haloAlpha = shadowA;
  vec3 haloColor = shadowCol;
  if (primitive) {
    // Owner direction 2026-07-04: wild, visible stands must be OBVIOUS. They
    // breathe a warm (fish: cool) bloom around the disc. Nodes inside the
    // territory smoulder faintly instead: being worked, not "click me".
    float outside = step(1.5, vVisibility);
    float rich = mix(0.7, 1.0, sqrt(max(vQuantity, 0.0)));
    if (outside > 0.5) {
      float breathe = 0.5 + 0.5 * sin(uTime * 1.1 + vSeed * 6.2831853);
      float bloom = 1.0 - smoothstep(0.30, 0.56, r);
      vec3 bc = isFish ? vec3(0.48, 0.82, 0.86) : vec3(0.98, 0.80, 0.45);
      float ba = bloom * (0.30 + 0.24 * breathe) * rich * (1.0 - disc) * (1.0 - vDeath);
      haloColor = mix(shadowCol, bc, ba / max(ba + shadowA, 1e-4));
      haloAlpha = max(ba, shadowA);
    } else {
      float chew = 0.5 + 0.5 * sin(uTime * 3.4 + vSeed * 9.7);
      col = mix(col, vec3(0.95, 0.60, 0.30), (0.05 + 0.07 * chew) * (1.0 - e));
    }
    // Depleted stands fade toward dust.
    col = mix(col, col * vec3(0.80, 0.78, 0.72), (1.0 - vQuantity) * 0.35);
    float dust = smoothstep(0.12, 0.92, vDeath);
    col = mix(col, vec3(0.46, 0.39, 0.27), dust * 0.55);
  }

  float alpha = max(mask, haloAlpha);
  vec3 outCol = mix(haloColor, col, mask / max(alpha, 1e-4));
  alpha *= vAlpha * uGlobalAlpha;
  if (alpha < 0.004) discard;
  fragColor = vec4(outCol, alpha);
}
