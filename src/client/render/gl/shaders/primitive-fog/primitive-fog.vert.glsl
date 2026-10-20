#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;

uniform mat3 uCamera;

out vec2 vUV;
out vec2 vWorld;

void main() {
  vec3 clip = uCamera * vec3(aPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vUV = aPos / vec2(float(MAP_W), float(MAP_H));
  // World tile position — lets the fog frag anchor its drifting mist to the map
  // so the murk pans/zooms WITH the terrain instead of swimming over the screen.
  vWorld = aPos;
}
