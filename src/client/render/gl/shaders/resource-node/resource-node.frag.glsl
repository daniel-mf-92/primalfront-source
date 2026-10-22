#version 300 es
precision highp float;

// Resource nodes as map pictograms printed on the parchment (Marta 2026-10-22:
// at world zoom every icon was the same little ring, troops and resources
// alike). No disc and no ring, so a resource never reads as a unit badge: the
// emblem itself, in its own colour (green pine = wood, grey stone heap = rock, blue
// salmon = fish) with inked detail lines, a thin ink outline and a soft
// parchment halo knocking it out of the terrain. Zoomed far out (uDetail -> 0)
// each node becomes a small inked mark instead: a green triangle (wood), a
// grey diamond (rock), a blue dot (fish).
//
// Atlas cells 9-11 (scripts/build-badge-atlas.sh) carry four masks:
// R icon, G filled silhouette, B outline (silhouette grown), A halo.
// Local units: quad spans +-0.5, y down.

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
uniform float uDetail;

out vec4 fragColor;

const vec3 INK = vec3(0.11, 0.085, 0.06);
const vec3 PARCHMENT = vec3(0.955, 0.915, 0.80);
// Atlas cells (BadgeAtlas.ts).
const float CELL_WOOD = 9.0;
const float CELL_ROCK = 10.0;
const float CELL_FISH = 11.0;

// Crisp edge for a mip-sampled mask.
float crisp(float a) {
  float w = max(fwidth(a), 1e-3);
  return clamp((a - 0.5) / w + 0.5, 0.0, 1.0);
}

vec4 cellSample(vec2 p, float cell) {
  vec2 uv = p + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uAtlas, vec2((cell + uv.x) / uCells, uv.y));
}

void main() {
  vec2 p = vLocalPos;
  bool primitive = vPrimitive > 0.5;
  bool isWood = vKind < 1.5;
  bool isRock = vKind >= 1.5 && vKind < 2.5;
  bool isFish = !isWood && !isRock;

  vec3 hue = isWood ? vec3(0.22, 0.47, 0.17)
           : isRock ? vec3(0.47, 0.46, 0.44)
           : vec3(0.17, 0.44, 0.68);
  float cell = isWood ? CELL_WOOD : isRock ? CELL_ROCK : CELL_FISH;

  // --- Pictogram ---
  vec4 m = cellSample(p, cell);
  float icon = crisp(m.r);
  float solid = crisp(m.g);
  float outline = crisp(m.b);
  float halo = m.a;
  // Light from the top: the fill is a touch lighter at the top of the art.
  vec3 fill = hue * (1.12 - 0.30 * (p.y + 0.5));
  vec3 detail = mix(hue * 0.42, INK, 0.35);
  vec3 picCol = mix(PARCHMENT, INK, outline);
  picCol = mix(picCol, detail, solid);
  picCol = mix(picCol, fill, icon);
  float picA = max(halo * 0.82, outline);
  // Soft shadow down-right of the halo so the print sits on the map.
  float shadow = cellSample(p - vec2(0.035, 0.05), cell).a * 0.30;

  // --- Mark (far zoom): a shape per kind, not just a colour, so wood, rock
  // and fish stay apart even where the hues sink into the terrain: a pine
  // triangle, a stone diamond, a round water dot.
  float r = length(p);
  float sd;
  if (isWood) {
    vec2 q = vec2(abs(p.x), p.y + 0.04);
    sd = max(q.y - 0.26, dot(q, vec2(0.894, -0.447)) - 0.11);
  } else if (isRock) {
    sd = (abs(p.x) + abs(p.y)) * 0.7071 - 0.22;
  } else {
    sd = r - 0.25;
  }
  float aa = max(fwidth(sd), 1e-4);
  float dotIn = 1.0 - smoothstep(-aa, aa, sd);
  float dotRim = smoothstep(-0.06 - aa, -0.06 + aa, sd);
  vec3 dotCol = mix(hue * 1.05, INK, dotRim * 0.85);
  float dotHalo = 1.0 - smoothstep(0.0, 0.12, sd);
  dotCol = mix(PARCHMENT, dotCol, dotIn);
  float dotA = max(dotIn, dotHalo * 0.75);

  vec3 col = mix(dotCol, picCol, uDetail);
  float mask = mix(dotA, picA, uDetail);
  float body = mix(dotIn, max(solid, outline), uDetail);
  float shadowA = mix(0.0, shadow, uDetail) * (1.0 - mask);

  // Felled / emptied nodes wipe away from the top down as they go.
  float wipeLine = 1.0 - vDeath;
  float wipe = smoothstep(wipeLine - 0.16, wipeLine + 0.10, p.y + 0.5);
  if (primitive) mask *= 1.0 - wipe;

  vec3 shadowCol = vec3(0.06, 0.05, 0.03);
  float haloAlpha = shadowA * (1.0 - vDeath);
  vec3 haloColor = shadowCol;
  if (primitive) {
    // Owner direction 2026-07-04: wild, visible stands must be OBVIOUS. They
    // breathe a warm (fish: cool) bloom around the pictogram. Nodes inside the
    // territory smoulder faintly instead: being worked, not "click me".
    float outside = step(1.5, vVisibility);
    float rich = mix(0.7, 1.0, sqrt(max(vQuantity, 0.0)));
    if (outside > 0.5) {
      float breathe = 0.5 + 0.5 * sin(uTime * 1.1 + vSeed * 6.2831853);
      float bloom = 1.0 - smoothstep(0.22, 0.5, r);
      vec3 bc = isFish ? vec3(0.48, 0.82, 0.86) : vec3(0.98, 0.80, 0.45);
      float ba = bloom * (0.26 + 0.22 * breathe) * rich * (1.0 - mask) * (1.0 - vDeath);
      haloColor = mix(shadowCol, bc, ba / max(ba + haloAlpha, 1e-4));
      haloAlpha = max(ba, haloAlpha);
    } else {
      float chew = 0.5 + 0.5 * sin(uTime * 3.4 + vSeed * 9.7);
      col = mix(col, vec3(0.95, 0.60, 0.30), (0.05 + 0.07 * chew) * (1.0 - body));
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
