#version 300 es
precision highp float;

uniform sampler2D uTerrain;

// Ice-age caps: latitude fraction (from each pole) currently under ice. 0 = no
// ice (fully receded), up to the shared climateIcePoleReach at full ice. Driven
// by the climate clock and pushed per tick. vUV.y is the normalized latitude
// (0 = top pole, 1 = bottom pole).
uniform float uIceExtent;

// Camera zoom in screen pixels per world tile. Drives the high-zoom paper
// stipple below; 0/unset (e.g. before first camera push) = no stipple.
uniform float uZoom;

const vec3 ICE_TINT = vec3(0.56, 0.68, 0.74);
const float ICE_EDGE = 0.08;
const float ICE_MAX_OPACITY = 0.32;

in vec2 vUV;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
      mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y);
}

float chartLine(float value, float width) {
  float d = abs(fract(value) - 0.5);
  return 1.0 - smoothstep(width, width + 0.006, d);
}

float terrainTone(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 base = texture(uTerrain, vUV);
  vec3 color = base.rgb;

  // Alpha carries terrain-class metadata from ColorUtils.ts. LINEAR filtering
  // makes this a soft land/shore mask at coastlines.
  float meta = base.a;
  float land = smoothstep(0.58, 0.82, meta);
  float water = 1.0 - land;

  vec2 texel = vec2(1.0 / float(MAP_W), 1.0 / float(MAP_H));
  float centerTone = terrainTone(base.rgb);
  float eastTone = terrainTone(texture(uTerrain, vUV + vec2(texel.x, 0.0)).rgb);
  float westTone = terrainTone(texture(uTerrain, vUV - vec2(texel.x, 0.0)).rgb);
  float southTone = terrainTone(texture(uTerrain, vUV + vec2(0.0, texel.y)).rgb);
  float northTone = terrainTone(texture(uTerrain, vUV - vec2(0.0, texel.y)).rgb);
  float terrainSlope = clamp(
      length(vec2(eastTone - westTone, southTone - northTone)) * 5.0,
      0.0,
      1.0);
  float highGround =
      smoothstep(0.50, 0.82, centerTone + terrainSlope * 0.20) * land;

  // Paper grain/staining. Keep it deterministic in UV space so it is stable
  // across frames and map loads.
  float fine = hash21(floor(vUV * vec2(1400.0, 1020.0)));
  float coarse = hash21(floor(vUV * vec2(180.0, 132.0)));
  float grain = (fine - 0.5) * 0.04 + (coarse - 0.5) * 0.026;
  color *= 1.0 + grain;

  // High-zoom paper stipple: LINEAR filtering turns close-ups into soft mush
  // once a tile spans more than a few screen pixels. A world-space sub-tile
  // hash grain fades in past ~2.5 px/tile so zoomed-in terrain reads as
  // toothy paper. Amplitude capped at ±0.04 so it stays texture, not noise.
  float stippleAmp = 0.04 * smoothstep(2.5, 6.0, uZoom);
  if (stippleAmp > 0.001) {
    vec2 worldPos = vUV * vec2(float(MAP_W), float(MAP_H));
    float stippleA = hash21(floor(worldPos * 5.0)) - 0.5;
    float stippleB = hash21(floor(worldPos * 13.0) + vec2(7.0, 3.0)) - 0.5;
    color *= 1.0 + (stippleA * 0.7 + stippleB * 0.3) * 2.0 * stippleAmp;
  }

  vec3 parchment = vec3(0.86, 0.73, 0.48);
  vec3 seaPaper = vec3(0.62, 0.72, 0.63);
  color = mix(color, parchment, 0.18 + water * 0.08);
  color = mix(color, seaPaper, water * 0.12);

  float chartLuma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(chartLuma), color, 0.82);

  // Faint navigational chart lines, mostly visible at sea. They are dark-brown
  // ink rather than bright UI grid lines.
  float rhumbA = chartLine((vUV.x + vUV.y * 0.72) * 9.0, 0.012);
  float rhumbB = chartLine((vUV.x - vUV.y * 0.68) * 8.0, 0.011);
  float latlon =
    max(chartLine(vUV.x * 7.0, 0.009), chartLine(vUV.y * 5.0, 0.009));
  float inkLines = min(1.0, rhumbA * 0.55 + rhumbB * 0.45 + latlon * 0.38);
  vec3 ink = vec3(0.22, 0.14, 0.065);
  color = mix(color, ink, inkLines * (0.018 + water * 0.052));

  // Old paper edge falloff.
  vec2 edgeVec = abs(vUV - vec2(0.5));
  float paperEdge = smoothstep(0.34, 0.72, length(edgeVec));
  color = mix(color, color * vec3(0.82, 0.77, 0.66), paperEdge * 0.32);

  float continentLobes = noise21(vUV * vec2(6.2, 2.6) + vec2(3.0, 1.0)) - 0.5;
  float shelfWarp = noise21(vUV * vec2(14.0, 6.0) + vec2(11.0, 5.0)) - 0.5;
  float frontBites = noise21(vUV * vec2(38.0, 18.0) + vec2(7.0, 3.0)) - 0.5;
  float fractureWarp = noise21(vUV * vec2(92.0, 45.0) + vec2(19.0, 13.0)) - 0.5;
  float terrainReach = highGround * 0.028 - water * 0.018;
  float localExtent = clamp(
      uIceExtent +
        continentLobes * 0.070 +
        shelfWarp * 0.046 +
        frontBites * 0.020 +
        fractureWarp * 0.010 +
        terrainReach,
      0.0,
      0.495);

  // Distance from the nearer pole; highest, roughest ice at the pole, with an
  // irregular terrain-shaped melt front instead of a straight latitude band.
  float distFromPole = min(vUV.y, 1.0 - vUV.y);
  float ice = 1.0 - smoothstep(localExtent - ICE_EDGE, localExtent, distFromPole);
  float frontZone = 1.0 - smoothstep(0.12, 0.82, ice);
  float scallop = noise21(vUV * vec2(74.0, 29.0) + vec2(23.0, 41.0));
  ice = clamp(
      ice - smoothstep(0.62, 0.95, scallop) * frontZone * 0.48 +
        smoothstep(0.18, 0.42, scallop) * frontZone * 0.18,
      0.0,
      1.0);

  float sheet = smoothstep(0.08, 0.95, ice);
  float ridgeNoise = noise21(
      vUV * vec2(115.0, 44.0) + vec2(terrainSlope * 6.0, centerTone * 4.0));
  float ridges =
      smoothstep(0.58, 0.86, ridgeNoise + terrainSlope * 0.28) * sheet * land;
  float crevasses = smoothstep(
      0.18,
      0.68,
      terrainSlope + (1.0 - ridgeNoise) * 0.26) * sheet * land;

  // Muted, terrain-dependent ice. Sea ice stays thinner/bluer, high ground gets
  // denser snowpack, and ridges/crevasses give the sheet visible height.
  vec3 seaIce = mix(color * 0.88, ICE_TINT, 0.32);
  vec3 landIce = mix(color * 0.78, ICE_TINT, 0.48 + highGround * 0.18);
  vec3 iceSurface = mix(landIce, seaIce, water);
  float blueShadow = noise21(vUV * vec2(28.0, 16.0) + vec2(5.0, 29.0));
  iceSurface = mix(iceSurface, vec3(0.68, 0.78, 0.82), ridges * 0.28);
  iceSurface = mix(iceSurface, vec3(0.42, 0.56, 0.64), crevasses * 0.12);
  iceSurface = mix(iceSurface, vec3(0.50, 0.64, 0.70), blueShadow * sheet * 0.08);
  iceSurface *= 1.0 - crevasses * 0.08;

  float terrainOpacity = mix(0.62, 1.12, highGround) * mix(1.0, 0.58, water);
  float opacity =
      clamp(sheet * ICE_MAX_OPACITY * terrainOpacity + ridges * 0.060, 0.0, 0.40);
  color = mix(color, iceSurface, opacity);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
