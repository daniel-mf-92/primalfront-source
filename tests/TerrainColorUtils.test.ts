import { describe, expect, test } from "vitest";
import {
  buildTerrainRGBA,
  encodeTerrainTile,
} from "../src/client/render/gl/utils/ColorUtils";

function encode(tb: number): Uint8Array {
  const out = new Uint8Array(4);
  encodeTerrainTile(tb, out, 0);
  return out;
}

describe("terrain chart color encoding", () => {
  test("stores terrain-class metadata in alpha bands", () => {
    const deepWater = encode(0x00);
    const shallowWater = encode(0x40);
    const landShore = encode(0x80 | 0x40);
    const land = encode(0x80);

    expect(deepWater[3]).toBeGreaterThanOrEqual(32);
    expect(deepWater[3]).toBeLessThan(96);
    expect(shallowWater[3]).toBeGreaterThanOrEqual(96);
    expect(shallowWater[3]).toBeLessThan(160);
    expect(landShore[3]).toBeGreaterThanOrEqual(160);
    expect(landShore[3]).toBeLessThan(224);
    expect(land[3]).toBeGreaterThanOrEqual(224);
  });

  test("uses muted chart colors instead of bright satellite colors", () => {
    const shallowWater = encode(0x40);
    const lowland = encode(0x80);
    const shore = encode(0x80 | 0x40);

    expect(shallowWater[1]).toBeGreaterThanOrEqual(shallowWater[2] - 12);
    expect(lowland[0]).toBeGreaterThan(135);
    expect(lowland[1]).toBeGreaterThan(145);
    expect(shore[0]).toBeGreaterThan(shore[1]);
    expect(shore[1]).toBeGreaterThan(shore[2]);
  });

  test("inks land and water along coastlines", () => {
    const water = 0x40;
    const shore = 0x80 | 0x40 | 4;
    const terrain = new Uint8Array([
      water,
      water,
      water,
      water,
      shore,
      water,
      water,
      water,
      water,
    ]);

    const encodedShore = encode(shore);
    const rgba = buildTerrainRGBA(terrain, 3, 3);
    const center = rgba.slice(4 * 4, 4 * 4 + 4);

    expect(center[0]).toBeLessThan(encodedShore[0]);
    expect(center[1]).toBeLessThan(encodedShore[1]);
    expect(center[2]).toBeLessThan(encodedShore[2]);

    const encodedWater = encode(water);
    const edgeWater = rgba.slice(1 * 4, 1 * 4 + 4);
    expect(edgeWater[0]).toBeLessThan(encodedWater[0]);
    expect(edgeWater[1]).toBeLessThan(encodedWater[1]);
  });
});
