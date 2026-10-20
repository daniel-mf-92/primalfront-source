#version 300 es
precision highp float;

// Unit quad [0,0]→[1,1].
layout(location = 0) in vec2 aPos;

// Per-instance: x (tile), y (tile), size (herd size), alpha (0..1).
layout(location = 1) in vec4 aInst;

uniform mat3  uCamera;
uniform float uZoom;     // pixels per tile
uniform float uNodeSize; // base sprite diameter, in tiles
uniform float uMinPx;    // minimum on-screen diameter, in pixels

out vec2  vLocalPos;     // [-0.5, +0.5] across the quad
flat out float vAlpha;
flat out float vSeed;    // per-herd pseudo-random for shape/size variation

void main() {
  float worldX = aInst.x;
  float worldY = aInst.y;
  float size = aInst.z;
  vAlpha = aInst.w;

  // Stable per-tile hash so each herd gets its own silhouette/jitter.
  float seed = fract(sin(dot(vec2(worldX, worldY), vec2(12.9898, 78.233))) * 43758.5453);
  vSeed = seed;

  // Bigger herds read a bit bigger; jitter so they aren't identical. Pixel floor
  // keeps them visible (uZoom = px/tile).
  float sizeScale = 0.85 + 0.5 * clamp(size / 40.0, 0.0, 1.0);
  float halfTiles = uNodeSize * 0.5 * sizeScale * (0.9 + 0.2 * seed);
  float minHalfTiles = (uMinPx * 0.5) / max(uZoom, 0.0001);
  float halfSize = max(halfTiles, minHalfTiles);

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  vec2 worldPos = center + (aPos - 0.5) * halfSize * 2.0;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vLocalPos = aPos - 0.5;
}
