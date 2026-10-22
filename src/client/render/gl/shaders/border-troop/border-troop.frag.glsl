#version 300 es
precision highp float;

// Border troops: one small ink-outlined figure, era by era.
//   0 Stone Age     scout with a spear
//   1 Classical     spearman with a round shield
//   2 Imperial      legionary: short sword, tall shield
//   3 Feudal        knight with a pennant
//   4 Enlightened   musketeer, tricorn
//   5 Industrial    rifleman, cap
//   6 Modern        soldier, helmet and rifle
//   7 Alien         a hovering drone
// kind 1 = a clash: two figures facing off with a spark between them.

in vec2 vLocalPos;
flat in float vKind;
flat in float vAge;
flat in vec3 vColor;
flat in float vFacing;
flat in float vSeed;

uniform float uTime;
uniform float uGlobalAlpha;

out vec4 fragColor;

float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdSeg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Signed distance of one figure, in a y-up frame, standing at the origin,
// facing +x, roughly 0.9 units tall. `fill` returns which part is closest:
// 0 body (team colour), 1 metal/wood (neutral), 2 accent.
float figure(vec2 p, int age, out int part) {
  float body = min(sdCircle(p - vec2(0.0, 0.70), 0.085),
                   sdSeg(p, vec2(0.0, 0.58), vec2(0.0, 0.30), 0.065));
  body = min(body, sdSeg(p, vec2(0.0, 0.30), vec2(-0.08, 0.02), 0.045));
  body = min(body, sdSeg(p, vec2(0.0, 0.30), vec2(0.08, 0.02), 0.045));
  float gear = 1e3;
  float accent = 1e3;
  if (age == 0) {
    gear = sdSeg(p, vec2(0.12, 0.05), vec2(0.18, 0.92), 0.022);
    accent = sdSeg(p, vec2(0.18, 0.92), vec2(0.19, 1.02), 0.04);
  } else if (age == 1) {
    gear = sdSeg(p, vec2(0.14, 0.05), vec2(0.18, 0.95), 0.022);
    accent = sdCircle(p - vec2(0.10, 0.42), 0.14);
  } else if (age == 2) {
    accent = sdBox(p - vec2(0.12, 0.40), vec2(0.07, 0.17));
    gear = sdSeg(p, vec2(-0.05, 0.42), vec2(-0.20, 0.55), 0.025);
  } else if (age == 3) {
    gear = sdSeg(p, vec2(-0.12, 0.05), vec2(-0.12, 1.02), 0.022);
    accent = sdBox(p - vec2(0.0, 0.92), vec2(0.12, 0.06));
    body = min(body, sdBox(p - vec2(0.0, 0.79), vec2(0.07, 0.03)));
  } else if (age == 4) {
    gear = sdSeg(p, vec2(-0.10, 0.20), vec2(0.30, 0.62), 0.024);
    accent = sdBox(p - vec2(0.0, 0.78), vec2(0.13, 0.03));
  } else if (age == 5) {
    gear = sdSeg(p, vec2(-0.08, 0.30), vec2(0.34, 0.50), 0.026);
    accent = sdBox(p - vec2(0.02, 0.78), vec2(0.10, 0.035));
  } else if (age == 6) {
    gear = sdSeg(p, vec2(-0.06, 0.36), vec2(0.36, 0.46), 0.03);
    accent = sdCircle(p - vec2(0.0, 0.74), 0.11);
  } else {
    body = sdBox(p - vec2(0.0, 0.55), vec2(0.22, 0.07));
    gear = min(sdSeg(p, vec2(-0.32, 0.66), vec2(-0.12, 0.66), 0.025),
               sdSeg(p, vec2(0.12, 0.66), vec2(0.32, 0.66), 0.025));
    accent = sdCircle(p - vec2(0.0, 0.55), 0.06);
  }
  float d = min(body, min(gear, accent));
  part = d == body ? 0 : (d == accent ? 2 : 1);
  return d;
}

void main() {
  vec2 lp = vLocalPos;
  float aa = fwidth(lp.x) * 1.3 + 0.004;
  vec3 ink = vec3(0.10, 0.08, 0.06);
  int age = int(vAge + 0.5);
  float stroke = 0.045;
  float d;
  int part;
  float spark = 1e3;
  if (vKind < 0.5) {
    vec2 p = vec2(lp.x * vFacing, -lp.y) * 1.1 + vec2(0.0, 0.48);
    // Gentle idle sway so guards read as people, not stamps.
    p.x += 0.015 * sin(uTime * 1.6 + vSeed * 6.28);
    d = figure(p, age, part);
  } else {
    // A clash: two fighters lunging at each other, a spark between them.
    vec2 base = vec2(lp.x, -lp.y) * 1.5 + vec2(0.0, 0.55);
    float lunge = 0.04 * sin(uTime * 9.0 + vSeed * 6.28);
    int pa, pb;
    float a = figure(vec2(base.x + 0.34 - lunge, base.y), age, pa);
    float b = figure(vec2(-(base.x - 0.34 + lunge), base.y), age, pb);
    d = min(a, b);
    part = a < b ? pa : pb;
    float pulse = 0.7 + 0.3 * sin(uTime * 12.0 + vSeed * 9.0);
    vec2 sp = base - vec2(0.0, 0.62);
    float star = max(abs(sp.x) * 0.6 + abs(sp.y), abs(sp.x) + abs(sp.y) * 0.6) - 0.09 * pulse;
    spark = star;
  }
  vec3 metal = vec3(0.58, 0.54, 0.47);
  vec3 team = mix(vColor, ink, 0.18);
  vec3 accentCol = mix(vColor, vec3(1.0), 0.35);
  vec3 fill = part == 0 ? team : (part == 2 ? accentCol : metal);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float covered = 1.0 - smoothstep(-aa, aa, d - stroke);
  vec3 col = mix(ink, fill, inside);
  float alpha = covered;
  if (spark < 1e2) {
    float s = 1.0 - smoothstep(-aa, aa, spark);
    col = mix(col, vec3(0.93, 0.36, 0.16), s);
    alpha = max(alpha, s);
  }
  if (alpha < 0.01) discard;
  fragColor = vec4(col, alpha * uGlobalAlpha);
}
