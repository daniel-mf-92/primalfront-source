#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
// x, y (tile, eased on the CPU), kind (0 guard, 1 clash), atlas cell
layout(location = 1) in vec4 aInst0;
// team r, g, b, alpha (fade in / out)
layout(location = 2) in vec4 aInst1;
// seed (stable per troop), appear (0..1 pop-in scale; 1 while fading out)
layout(location = 3) in vec2 aInst2;

uniform mat3 uCamera;
uniform float uZoom;    // pixels per tile
uniform float uSize;    // badge diameter in tiles
uniform float uMinPx;   // badge diameter floor, pixels
uniform float uMaxPx;   // badge diameter ceiling, pixels
uniform float uTime;

out vec2 vLocalPos;
flat out float vKind;
flat out float vCell;
flat out vec3 vColor;
flat out float vAlpha;
flat out float vSeed;

// The quad is 1.5x the badge so the soft shadow and the clash spark ring fit.
const float QUAD = 1.5;

void main() {
  vKind = aInst0.z;
  vCell = aInst0.w;
  vColor = aInst1.rgb;
  vAlpha = aInst1.a;
  vSeed = aInst2.x;
  float appear = aInst2.y;
  bool clash = vKind > 0.5;

  float z = max(uZoom, 0.0001);
  float px = clamp(uSize * z, uMinPx, uMaxPx) * (clash ? 1.18 : 1.0);
  float size = px / z;

  float ph = vSeed * 6.2831853;
  // Idle: a slow breath and a small bob, each troop on its own phase.
  float scale = mix(0.55, 1.0, appear) * (1.0 + 0.025 * sin(uTime * 1.7 + ph + 1.3));
  vec2 offset = vec2(0.0, -0.05 * size * (0.5 + 0.5 * sin(uTime * 1.7 + ph)));
  if (clash) {
    float beat = pow(0.5 + 0.5 * sin(uTime * 5.5 + ph), 3.0);
    scale *= 1.0 + 0.07 * beat;
    offset.x += 0.022 * size * sin(uTime * 23.0 + ph * 7.0) * (0.4 + 0.6 * beat);
  }

  vec2 center = aInst0.xy + 0.5 + offset;
  vec2 worldPos = center + (aPos - 0.5) * size * QUAD * scale;
  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vLocalPos = (aPos - 0.5) * QUAD; // badge radius = 0.5 in these units
}
