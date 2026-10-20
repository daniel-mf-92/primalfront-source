#version 300 es
precision highp float;

// Full-screen wash: a single clip-space triangle that covers the viewport.
// No camera — the flash tints whatever is on screen.

void main() {
  // Oversized triangle trick: 3 vertices cover the whole clip space.
  vec2 pos = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
