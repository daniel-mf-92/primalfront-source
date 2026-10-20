#version 300 es
precision highp float;

uniform sampler2D uFog;
uniform float uTime;

in vec2 vUV;
in vec2 vWorld;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// Smooth value noise (quintic-ish smoothstep interp) — low frequency so it reads
// as soft haze, never the checker grain that a raw hash gives.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  // Per-tile visibility byte (see GameView fog constants): ~1.0 lit core,
  // 0.78..0.96 graded falloff edge, ~0.50 remembered, ~0.0 never-seen.
  float state = texture(uFog, vUV).r;

  // Wider visible ramp than before so the reveal boundary FEATHERS softly
  // instead of reading as a torn crust.
  float visible = smoothstep(0.72, 0.96, state);
  if (visible > 0.985) discard;

  // Remembered plateau (byte 128 ≈ 0.50). Tight ramp so it snaps to ~1 on
  // remembered land and the alpha tiers stay distinct.
  float remembered = smoothstep(0.28, 0.50, state) * (1.0 - visible);

  // Very slow, low-contrast warm haze, world-anchored so the shroud breathes
  // faintly instead of being dead flat — but calm, NEVER the busy teal banks
  // + pulsing shimmer that fought the warm atlas (2026-07-05 owner: reveal
  // "looks suck shit"). No frontier shimmer, no cold teal.
  vec2 w = vWorld;
  float haze = vnoise(w * 0.035 + vec2(uTime * 0.006, uTime * -0.004));
  // Broad second octave so mid-zoom fog keeps gentle tonal variation instead
  // of reading as a flat khaki wash (fresh-eyes polish note, 2026-07-10).
  haze = haze * 0.6 + vnoise(w * 0.009 + vec2(uTime * 0.003, 0.0)) * 0.4;
  haze = 0.5 + (haze - 0.5) * 0.75;

  // KEY CHANGE 2026-07-10: unexplored ground reads as an AGED CHART, not dusk
  // murk. A pale parchment wash PRESERVES land/ocean luminance contrast, so
  // continents and coastlines stay legible at every zoom — where the previous
  // warm-DARK dim crushed the whole world into flat brown sludge (owner: "ux
  // sucks", real-GPU audit shots 02/08). Revealed ground shows the atlas at
  // full saturation, so the reveal reads as "true colors on a faded chart".
  // Rival territory is hidden/ghosted underneath by territory.frag's fog gate,
  // so this wash lays over clean terrain, not over enemy blobs.
  vec3 chartPale = vec3(0.590, 0.548, 0.452);
  vec3 chartDeep = vec3(0.436, 0.404, 0.336);
  vec3 fogColor = mix(chartDeep, chartPale, haze);

  // Alpha carries the tiering: never-seen washes hardest (but keeps ~half the
  // underlying contrast); remembered ground is clearly lighter — "walked it,
  // remember the lay of the land"; the falloff edge feathers via (1 - visible).
  const float UNSEEN_A = 0.54;
  const float REMEMBER_A = 0.26;
  float alpha = mix(UNSEEN_A, REMEMBER_A, remembered) * (1.0 - visible);

  fragColor = vec4(clamp(fogColor, 0.0, 1.0), alpha);
}
