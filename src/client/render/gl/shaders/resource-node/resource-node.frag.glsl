#version 300 es
precision highp float;

in vec2 vLocalPos;
flat in float vAlpha;
flat in float vSeed;
flat in float vKind;
flat in float vVisibility;
flat in float vQuantity;
flat in float vDeath;
flat in float vPrimitive;

uniform float uGlobalAlpha;
uniform float uTime;

out vec4 fragColor;

float blob(vec2 p, vec2 c, float rad, float aa) {
  float d = length(p - c);
  return 1.0 - smoothstep(rad - aa, rad + aa, d);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 rot(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// Angular ore shard (L1 diamond): sharp geologic-map deposit facets instead
// of rounded pebbles (owner direction 2026-07-02: "mineral deposits like a
// geographic map", not "little rabbit shits").
float shard(vec2 p, vec2 c, vec2 r, float ang, float aa) {
  vec2 d = rot(p - c, ang);
  float m = abs(d.x) / r.x + abs(d.y) / r.y;
  return 1.0 - smoothstep(1.0 - aa * 8.0, 1.0 + aa * 8.0, m);
}

// ---- Stone Age pictograms (Marta 2026-10-22: the old blobs "look like a
// turd", and it was not clear which resource is which). Pine trees = wood,
// a stone pile = rock, a fish = fish; each filled and stroked in ink so it
// reads on the parchment map. Coordinates: x right, y UP (local y is flipped).
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-4);
}
// Upright triangle: base on y = 0, apex at (0, h), half-width w.
float sdTriUp(vec2 p, float w, float h) {
  vec2 n = normalize(vec2(h, w));
  float edge = dot(vec2(abs(p.x), p.y) - vec2(0.0, h), n);
  return max(edge, -p.y);
}
float sdPine(vec2 p, vec2 base, float h, float w, out float trunkD) {
  vec2 q = p - base;
  trunkD = sdBox(q - vec2(0.0, h * 0.09), vec2(w * 0.16, h * 0.11));
  float low = sdTriUp(q - vec2(0.0, h * 0.16), w, h * 0.55);
  float high = sdTriUp(q - vec2(0.0, h * 0.42), w * 0.74, h * 0.58);
  return min(low, high);
}

// Returns coverage (fill + ink stroke) and writes the pictogram colour.
float pictogram(vec2 lp, float kind, float seed, float aa, out vec3 col) {
  vec2 p = vec2(lp.x, -lp.y);
  vec3 ink = vec3(0.13, 0.10, 0.07);
  float stroke = 0.032;
  float d;
  vec3 fill;
  if (kind < 1.5) {
    float t0, t1, t2;
    float a = sdPine(p, vec2(0.0, -0.40), 0.80, 0.22, t0);
    float b = sdPine(p, vec2(-0.23, -0.36), 0.56, 0.16, t1);
    float c = sdPine(p, vec2(0.23, -0.37), 0.62, 0.17, t2);
    float crown = min(a, min(b, c));
    float trunk = min(t0, min(t1, t2));
    d = min(crown, trunk);
    vec3 green = mix(vec3(0.20, 0.40, 0.20), vec3(0.30, 0.52, 0.26), step(0.0, -p.x + 0.04 * seed));
    fill = crown <= trunk ? green : vec3(0.45, 0.29, 0.15);
  } else if (kind < 2.5) {
    float s1 = sdEllipse(p - vec2(0.02, -0.14), vec2(0.27, 0.17));
    float s2 = sdEllipse(p - vec2(-0.22, -0.22), vec2(0.14, 0.10));
    float s3 = sdEllipse(p - vec2(0.07, 0.08), vec2(0.16, 0.13));
    d = min(s1, min(s2, s3));
    float lit = smoothstep(-0.10, 0.18, p.y - 0.4 * p.x);
    fill = mix(vec3(0.46, 0.45, 0.43), vec3(0.74, 0.72, 0.68), lit);
  } else {
    float body = sdEllipse(p - vec2(-0.06, 0.0), vec2(0.27, 0.14));
    vec2 tp = vec2(p.y, 0.40 - p.x);
    float tail = sdTriUp(tp, 0.15, 0.20);
    d = min(body, tail);
    fill = mix(vec3(0.30, 0.50, 0.64), vec3(0.62, 0.78, 0.84), smoothstep(0.04, -0.08, p.y));
    float eye = length(p - vec2(-0.22, 0.035)) - 0.028;
    fill = mix(ink, fill, smoothstep(-aa, aa, eye));
  }
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float covered = 1.0 - smoothstep(-aa, aa, d - stroke);
  col = mix(ink, fill, inside);
  return covered;
}

void main() {
  vec2 p = vLocalPos;
  float aa = fwidth(length(p)) + 0.0015;
  float s = vSeed * 6.2831853;
  bool primitive = vPrimitive > 0.5;

  vec2 q = p;
  q.x *= 1.0 + 0.10 * sin(s * 1.7);
  q.y *= 1.12 + 0.10 * cos(s * 1.3);

  bool rockShards = vPrimitive > 0.5 && vKind >= 1.5 && vKind < 2.5;
  float rockAng = s * 0.7;
  float mask;
  if (rockShards) {
    float sMain = shard(q, vec2(0.02 * sin(s), -0.02), vec2(0.30, 0.20), rockAng, aa);
    float sLeft = shard(q, vec2(-0.19, 0.10 + 0.03 * sin(s)), vec2(0.15, 0.10), rockAng + 0.8, aa);
    float sRight = shard(q, vec2(0.20, 0.12 * cos(s)), vec2(0.13, 0.09), rockAng - 0.6, aa);
    mask = max(sMain, max(sLeft, sRight));
  } else {
    float mMain = blob(q, vec2(0.035 * sin(s), -0.025 * cos(s * 1.4)), 0.31 + 0.035 * vSeed, aa);
    float mLeft = blob(q, vec2(-0.17 - 0.03 * cos(s), 0.08 + 0.03 * sin(s)), 0.17, aa);
    float mRight = blob(q, vec2(0.18 + 0.03 * sin(s * 1.2), -0.08), 0.15 + 0.025 * vSeed, aa);
    float mLow = blob(q, vec2(-0.01, -0.21 + 0.02 * cos(s)), 0.13, aa);
    mask = max(max(mMain, mLeft), max(mRight, mLow));
  }

  vec3 pictoCol = vec3(0.0);
  if (primitive) {
    float paa = fwidth(p.x) * 1.2 + 0.004;
    mask = pictogram(p, vKind, vSeed, paa, pictoCol);
  }

  float wipeLine = 1.0 - vDeath;
  float wipe = smoothstep(wipeLine - 0.16, wipeLine + 0.10, p.y + 0.5);
  mask *= primitive ? 1.0 - wipe : 1.0;

  float haloMask = primitive
    ? (1.0 - smoothstep(0.38, 0.56, length(q))) * (1.0 - vDeath)
    : 1.0 - smoothstep(0.39, 0.53, length(q));
  if (max(mask, haloMask) < 0.01) discard;

  if (!primitive) {
    vec3 loam = vec3(0.25, 0.22, 0.15);
    vec3 moss = vec3(0.22, 0.32, 0.19);
    vec3 stone = vec3(0.42, 0.40, 0.33);
    vec3 ochre = vec3(0.36, 0.30, 0.18);

    float stoneMix = 0.5 + 0.5 * sin(s * 1.9);
    float ochreMix = 0.5 + 0.5 * sin(s * 2.7 + p.x * 5.0);
    vec3 color = mix(moss, stone, 0.25 + 0.45 * stoneMix);
    color = mix(loam, color, 0.72);
    color = mix(color, ochre, 0.16 * ochreMix);

    vec2 n = normalize(q + vec2(0.035, -0.02) + 1e-4);
    float light = dot(n, vec2(-0.52, 0.66));
    color *= 0.80 + 0.26 * (0.5 + 0.5 * light);

    float grain =
      0.90 + 0.10 * sin(p.x * 17.0 + p.y * 13.0 + s * 3.0) +
      0.04 * sin(p.x * 31.0 - p.y * 19.0 + s);
    color *= grain;
    float rim = smoothstep(0.30, 0.46, length(p));
    color = mix(color, color * 0.58, rim * 0.62);

    vec3 haloColor = loam * 0.55;
    color = mix(haloColor, color, mask);

    float haloAlpha = max(0.0, haloMask - mask) * 0.26;
    float alpha = max(mask, haloAlpha) * vAlpha * uGlobalAlpha;
    fragColor = vec4(color, alpha);
    return;
  }

  bool isWood = vKind < 1.5;
  bool isRock = vKind >= 1.5 && vKind < 2.5;
  bool isFish = vKind >= 2.5 && vKind < 3.5;

  vec3 loam = vec3(0.24, 0.21, 0.15);
  vec3 moss = vec3(0.16, 0.29, 0.17);
  vec3 twig = vec3(0.31, 0.24, 0.13);
  vec3 stone = vec3(0.43, 0.40, 0.33);
  vec3 arid = vec3(0.46, 0.36, 0.20);
  vec3 river = vec3(0.18, 0.31, 0.32);

  vec3 color = pictoCol;

  // No click-indicator rings (owner direction 2026-07-02). Visible-but-wild
  // nodes get an ALLURING breathing bloom; nodes inside territory smolder
  // with a faster ember shimmer — "being consumed", not "click me".
  float outside = step(1.5, vVisibility);
  float d = length(q);
  float haloAlpha;
  vec3 haloColor;
  if (outside > 0.5) {
    // Wild, visible stands must be OBVIOUS on the map (owner direction
    // 2026-07-04: "not clear where the resources are"). A brighter, larger
    // breathing bloom PLUS a thin pulsing beacon ring mark the node clearly as
    // "resource here" without a minimap.
    float breathe = 0.5 + 0.5 * sin(uTime * 1.1 + vSeed * 6.2831853);
    float rich = mix(0.7, 1.0, sqrt(max(vQuantity, 0.0)));
    float bloom = 1.0 - smoothstep(0.04, 0.66, d);
    haloColor = isFish ? vec3(0.48, 0.82, 0.86) : vec3(0.98, 0.78, 0.42);
    haloAlpha = max(0.0, bloom - mask) * (0.34 + 0.26 * breathe) * rich;
    float ringR = 0.40 + 0.05 * breathe;
    float ring = 1.0 - smoothstep(0.03, 0.075, abs(d - ringR));
    haloAlpha = max(haloAlpha, ring * (0.30 + 0.30 * breathe) * rich * (1.0 - mask));
  } else {
    float chew = 0.5 + 0.5 * sin(uTime * 3.4 + vSeed * 9.7);
    float bloom = 1.0 - smoothstep(0.02, 0.38, d);
    haloColor = vec3(0.95, 0.55, 0.25);
    haloAlpha = max(0.0, bloom - mask) * (0.10 + 0.14 * chew);
    color = mix(color, haloColor, 0.08 + 0.10 * chew);
  }

  color = mix(haloColor, color, mask);
  color = mix(color, color * vec3(0.72, 0.70, 0.64), (1.0 - vQuantity) * 0.42);

  float dust = smoothstep(0.12, 0.92, vDeath) * (1.0 - smoothstep(0.48, 0.68, length(p)));
  color = mix(color, vec3(0.46, 0.39, 0.27), dust * 0.55);

  float alpha = max(mask, haloAlpha) * vAlpha * uGlobalAlpha;
  fragColor = vec4(color, alpha);
}
