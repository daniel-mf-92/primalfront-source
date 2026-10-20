#version 300 es
precision highp float;

in vec2  vLocalPos;   // [-0.5, +0.5] across the quad
flat in float vAlpha;
flat in float vSeed;

// Woolly brown tint pushed from the pass.
uniform vec3 uHerdColor;
uniform float uGlobalAlpha;

out vec4 fragColor;

void main() {
  vec2 p = vLocalPos;
  float ang = atan(p.y, p.x);
  float s = vSeed * 6.2831853;

  // Body: a hunched ellipse, a little wider than tall.
  vec2 e = vec2(p.x / 0.46, (p.y - 0.02) / 0.40);
  float r = length(e);
  float aa = fwidth(r) + 0.0001;

  // Shaggy outline — low-frequency fur clumps.
  float boundary = 1.0
    + 0.10 * sin(ang * 6.0 + s)
    + 0.06 * sin(ang * 11.0 - s * 1.5);
  float mask = 1.0 - smoothstep(boundary - aa, boundary, r);
  if (mask < 0.01) discard;

  vec3 color = uHerdColor;
  // Lighter shaggy back (top), darker belly/legs (bottom).
  color *= 0.70 + 0.45 * clamp(0.5 + p.y, 0.0, 1.0);
  // Coarse fur mottle.
  color *= 0.9 + 0.1 * sin(p.x * 38.0 + s * 3.0);

  // Pale tusks — two short bright marks near the lower front.
  float tusk = smoothstep(0.07, 0.0, abs(p.y + 0.27)) *
               smoothstep(0.24, 0.10, abs(p.x));
  color = mix(color, vec3(0.93, 0.90, 0.78), tusk * 0.7);

  // Ground the form so it sits on the terrain rather than floating.
  float rim = smoothstep(boundary - 0.18, boundary, r);
  color = mix(color, color * 0.5, rim * 0.8);

  fragColor = vec4(color, mask * vAlpha * uGlobalAlpha);
}
