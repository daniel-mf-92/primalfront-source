#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
// x, y (tile), kind (0 guard, 1 clash), age
layout(location = 1) in vec4 aInst0;
// r, g, b, facing (+1 right / -1 left)
layout(location = 2) in vec4 aInst1;

uniform mat3 uCamera;
uniform float uZoom;    // pixels per tile
uniform float uSize;    // sprite size in tiles
uniform float uMinPx;   // minimum on-screen size in pixels

out vec2 vLocalPos;
flat out float vKind;
flat out float vAge;
flat out vec3 vColor;
flat out float vFacing;
flat out float vSeed;

void main() {
  vKind = aInst0.z;
  vAge = aInst0.w;
  vColor = aInst1.rgb;
  vFacing = aInst1.a;
  vSeed = fract(sin(dot(aInst0.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float size = max(uSize * (vKind > 0.5 ? 1.5 : 1.0), uMinPx / max(uZoom, 0.0001));
  vec2 center = aInst0.xy + 0.5;
  vec2 worldPos = center + (aPos - 0.5) * size;
  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vLocalPos = aPos - 0.5;
}
