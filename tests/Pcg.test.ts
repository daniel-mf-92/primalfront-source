import {
  fbm,
  isPoissonSample,
  rand2,
  valueNoise,
  worley,
} from "../src/core/pcg";

const SEED = 0x12345678;

describe("PCG core — determinism (lockstep-safe)", () => {
  it("rand2 is pure: same input ⇒ same output, output ∈ [0,1)", () => {
    for (let i = 0; i < 1000; i++) {
      const x = (i * 31) % 257;
      const y = (i * 17) % 193;
      const a = rand2(x, y, SEED);
      const b = rand2(x, y, SEED);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it("rand2 is roughly uniform (mean ≈ 0.5 over a grid)", () => {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        sum += rand2(x, y, SEED);
        n++;
      }
    }
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("valueNoise / fbm are deterministic and in [0,1)", () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.7;
      const y = i * 1.3;
      const v1 = valueNoise(x, y, SEED, 0.1);
      const v2 = valueNoise(x, y, SEED, 0.1);
      expect(v1).toBe(v2);
      expect(v1).toBeGreaterThanOrEqual(0);
      expect(v1).toBeLessThan(1);
      const f = fbm(x, y, SEED, 0.05, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("different seeds give different fields (per-game variation)", () => {
    let differ = 0;
    for (let x = 0; x < 50; x++) {
      if (rand2(x, 0, SEED) !== rand2(x, 0, SEED ^ 0xabcdef)) differ++;
    }
    expect(differ).toBeGreaterThan(45); // almost all tiles differ between games
  });
});

describe("PCG core — Worley clustering", () => {
  it("tiles within one cell share the same patch id + value (coherent stands)", () => {
    const cellSize = 12;
    // Sample a small block well inside a single cell's interior.
    const base = worley(50, 50, SEED, cellSize);
    let sameCell = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const w = worley(50 + dx, 50 + dy, SEED, cellSize);
        if (w.cellX === base.cellX && w.cellY === base.cellY) {
          expect(w.value).toBe(base.value); // same cell ⇒ identical richness value
          sameCell++;
        }
      }
    }
    expect(sameCell).toBeGreaterThan(0);
    expect(base.dist).toBeGreaterThanOrEqual(0);
  });

  it("richness gating yields clustered (not uniform) acceptance", () => {
    // A gated field should have high neighbour-correlation vs an independent roll.
    const cellSize = 10;
    const thr = 0.4;
    const gated = (x: number, y: number) =>
      worley(x, y, SEED, cellSize).value < thr;
    let neighbourAgree = 0;
    let pairs = 0;
    for (let y = 1; y < 60; y++) {
      for (let x = 1; x < 60; x++) {
        const c = gated(x, y);
        if (c === gated(x - 1, y)) neighbourAgree++;
        pairs++;
      }
    }
    // Independent salt-and-pepper would agree ~ (thr²+(1-thr)²) ≈ 0.52; clustered
    // Worley patches agree far more often.
    expect(neighbourAgree / pairs).toBeGreaterThan(0.85);
  });
});

describe("PCG core — Poisson blue-noise spacing", () => {
  it("no two accepted samples are closer than minDist", () => {
    const minDist = 3;
    const pts: Array<[number, number]> = [];
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        if (isPoissonSample(x, y, SEED, minDist)) pts.push([x, y]);
      }
    }
    expect(pts.length).toBeGreaterThan(10); // it actually places samples
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0];
        const dy = pts[i][1] - pts[j][1];
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(minDist);
      }
    }
  });

  it("minDist ≤ 1 accepts every tile", () => {
    for (let x = 0; x < 20; x++) {
      expect(isPoissonSample(x, 0, SEED, 1)).toBe(true);
    }
  });
});
