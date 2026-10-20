import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const shader = readFileSync(
  join(process.cwd(), "src/client/render/gl/shaders/terrain/terrain.frag.glsl"),
  "utf8",
);

function floatConstant(name: string): number {
  const match = shader.match(
    new RegExp(`const\\s+float\\s+${name}\\s*=\\s*([0-9.]+)\\s*;`),
  );
  if (!match) throw new Error(`Missing float constant ${name}`);
  return Number(match[1]);
}

function vec3Constant(name: string): number[] {
  const match = shader.match(
    new RegExp(`const\\s+vec3\\s+${name}\\s*=\\s*vec3\\(([^)]+)\\)\\s*;`),
  );
  if (!match) throw new Error(`Missing vec3 constant ${name}`);
  return match[1].split(",").map((part) => Number(part.trim()));
}

test("terrain ice overlay stays muted instead of painting white bands", () => {
  expect(floatConstant("ICE_MAX_OPACITY")).toBeLessThanOrEqual(0.4);
  expect(Math.max(...vec3Constant("ICE_TINT"))).toBeLessThan(0.85);
  expect(shader).toContain("float water =");
  expect(shader).toContain("float highGround =");
  expect(shader).toContain("continentLobes");
  expect(shader).toContain("frontBites");
  expect(shader).toContain("scallop");
  expect(shader).toContain("float terrainSlope =");
  expect(shader).toContain("localExtent");
  expect(shader).toContain("texture(uTerrain, vUV + vec2(texel.x, 0.0))");
  expect(shader).not.toContain("vec3(0.93, 0.96, 1.0)");
  expect(shader).not.toContain("* 0.97");
});
