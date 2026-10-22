#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
// x, y (tile, eased and patrolled on the CPU), kind (0 guard, 1 clash), atlas cell
layout(location = 1) in vec4 aInst0;
// team r, g, b, alpha (fade in / out)
layout(location = 2) in vec4 aInst1;
// seed (stable per troop), appear (0..1 pop-in scale; 1 while fading out),
// facing (+1 right, -1 left: toward the outside of the territory), unused
layout(location = 3) in vec4 aInst2;

uniform mat3 uCamera;
uniform float uZoom;    // pixels per tile
uniform float uSize;    // badge diameter in tiles
uniform float uMinPx;   // badge diameter floor, pixels (close zoom)
uniform float uMaxPx;   // badge diameter ceiling, pixels
uniform float uTime;

out vec2 vLocalPos;
flat out float vKind;
flat out float vCell;
flat out vec3 vColor;
flat out float vAlpha;
flat out float vSeed;
flat out float vFacing;
flat out float vPx;

// The quad is 1.5x the badge so the soft shadow and the clash spark ring fit.
const float QUAD = 1.5;

void main() {
  vKind = aInst0.z;
  vCell = aInst0.w;
  vColor = aInst1.rgb;
  vAlpha = aInst1.a;
  vSeed = aInst2.x;
  vFacing = aInst2.z < 0.0 ? -1.0 : 1.0;
  float appear = aInst2.y;
  bool clash = vKind > 0.5;

  float z = max(uZoom, 0.0001);
  // Zoomed far out the floor drops, so a world view is a scatter of small team
  // tokens rather than a carpet of full badges (the emblem fades out below
  // ~20 px in the fragment shader). Mirrors troopFloorPx in BorderTroopPass.
  float floorPx = uMinPx * clamp(0.3 + 0.35 * z, 0.5, 1.0);
  float px = clamp(uSize * z, floorPx, uMaxPx) * (clash ? 1.18 : 1.0);
  vPx = px;
  float size = px / z;

  float ph = vSeed * 6.2831853;
  // Idle: a bob of about 2-3 px, a gentle breath and a slow sway, each troop
  // on its own phase, so a border reads as people standing watch.
  float scale = mix(0.55, 1.0, appear) * (1.0 + 0.03 * sin(uTime * 1.7 + ph + 1.3));
  vec2 offset = vec2(0.0, -0.085 * size * (0.5 + 0.5 * sin(uTime * 2.2 + ph)));
  float sway = 0.10 * sin(uTime * 1.25 + ph * 1.7);
  if (clash) {
    // Clash: a hard heartbeat and a shake, about 2 px each way.
    float beat = pow(0.5 + 0.5 * sin(uTime * 5.5 + ph), 3.0);
    scale *= 1.0 + 0.13 * beat;
    offset.x += 0.06 * size * sin(uTime * 23.0 + ph * 7.0) * (0.35 + 0.65 * beat);
    offset.y += 0.035 * size * sin(uTime * 19.0 + ph * 3.0) * beat;
    sway = 0.06 * sin(uTime * 11.0 + ph);
  }

  vec2 local = (aPos - 0.5) * QUAD; // badge radius = 0.5 in these units
  float c = cos(sway);
  float s = sin(sway);
  vec2 turned = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 center = aInst0.xy + 0.5 + offset;
  vec2 worldPos = center + turned * size * scale;
  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vLocalPos = local;
}
