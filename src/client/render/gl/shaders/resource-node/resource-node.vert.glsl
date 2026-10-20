#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aInst0; // x, y, kind, visibility state
layout(location = 2) in vec4 aInst1; // quantity ratio, alpha, death progress, primitive mode

uniform mat3  uCamera;
uniform float uZoom;
uniform float uNodeSize;
uniform float uMinPx;

out vec2 vLocalPos;
flat out float vAlpha;
flat out float vSeed;
flat out float vKind;
flat out float vVisibility;
flat out float vQuantity;
flat out float vDeath;
flat out float vPrimitive;

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
  float quantityScale = primitive ? mix(0.32, 1.14, sqrt(max(vQuantity, 0.0))) : 1.0;
  float deathScale = primitive ? mix(1.0, 0.18, vDeath) : 1.0;
  float sizeJitter = primitive ? 0.72 + 0.42 * seed : 0.78 + 0.44 * seed;
  float halfTiles = uNodeSize * 0.5 * sizeJitter * quantityScale * deathScale;
  float minHalfTiles = primitive
    ? (uMinPx * 0.5 / max(uZoom, 0.0001)) * mix(0.34, 1.0, quantityScale) * deathScale
    : (uMinPx * 0.5) / max(uZoom, 0.0001);
  float halfSize = max(halfTiles, minHalfTiles);

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  vec2 worldPos = center + (aPos - 0.5) * halfSize * 2.0;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vLocalPos = aPos - 0.5;
}
