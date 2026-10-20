#version 300 es
precision highp float;

// uColor.rgb = wash color, uColor.a = intensity (already envelope-shaped and
// hard-capped CPU-side). Drawn with additive blending (SRC_ALPHA, ONE).

uniform vec4 uColor;

out vec4 fragColor;

void main() {
  if (uColor.a < 0.002) discard;
  fragColor = uColor;
}
