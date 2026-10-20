#version 300 es
precision highp float;

uniform float uRingWidth;

in vec2  vLocalPos;
flat in float vAlpha;
flat in vec3 vColor;

out vec4 fragColor;

void main() {
  float dist = length(vLocalPos);
  float ringDist = abs(dist - 1.0);
  // Crisp core line (nuke/SAM look) ...
  float core = 1.0 - smoothstep(0.0, uRingWidth, ringDist);
  // ... plus a soft glow band so the shockwave reads as a BOLD energy ring and
  // stays visible even when the hairline core is barely a pixel wide.
  float glow = 1.0 - smoothstep(0.0, 0.34, ringDist);
  float a = max(core, glow * 0.5) * vAlpha;
  if (a < 0.01) discard;
  fragColor = vec4(vColor, a);
}
