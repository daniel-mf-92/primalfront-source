#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aInst0; // x, y, kind, visibility state
layout(location = 2) in vec4 aInst1; // quantity ratio, alpha, death progress, primitive mode

uniform mat3  uCamera;
uniform float uZoom;
uniform float uNodeSize; // pictogram height in tiles
uniform float uMinPx;    // pictogram floor, pixels
uniform float uMaxPx;    // pictogram ceiling, pixels
uniform float uDotPx;    // dot diameter when zoomed far out, pixels
uniform float uDetail;   // 0 = dots (far zoom) .. 1 = pictograms

out vec2 vLocalPos;
flat out float vAlpha;
flat out float vSeed;
flat out float vKind;
flat out float vVisibility;
flat out float vQuantity;
flat out float vDeath;
flat out float vPrimitive;

// The pictogram art fills 92/128 of its atlas cell (scripts/build-badge-atlas.sh),
// the rest is halo; a dot fills 0.6 of the quad (its halo the rest).
const float ART = 92.0 / 128.0;
const float DOT = 0.6;

void main() {
  float worldX = aInst0.x;
  float worldY = aInst0.y;
  vKind = aInst0.z;
  vVisibility = aInst0.w;
  vQuantity = clamp(aInst1.x, 0.0, 1.0);
  vAlpha = aInst1.y;
  vDeath = clamp(aInst1.z, 0.0, 1.0);
  vPrimitive = aInst1.w;

  float seed = fract(sin(dot(vec2(worldX, worldY), vec2(12.9898, 78.233))) * 43758.5453);
  vSeed = seed;

  bool primitive = vPrimitive > 0.5;
  // Icons must stay legible, so depletion shrinks a node only a little
  // (it also dims it, see the fragment shader).
  float quantityScale = primitive ? mix(0.82, 1.06, sqrt(max(vQuantity, 0.0))) : 1.0;
  float deathScale = primitive ? mix(1.0, 0.3, vDeath) : 1.0;
  float sizeJitter = 0.94 + 0.12 * seed;

  float z = max(uZoom, 0.0001);
  float pictoPx = clamp(uNodeSize * z, uMinPx, uMaxPx) / ART;
  float dotPx = uDotPx / DOT;
  float quadPx = mix(dotPx, pictoPx, uDetail) * sizeJitter * quantityScale * deathScale;
  float halfSize = 0.5 * quadPx / z;

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  vec2 worldPos = center + (aPos - 0.5) * halfSize * 2.0;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vLocalPos = aPos - 0.5;
}
