import { describe, expect, it } from "vitest";
import {
  buildChallengeUrl,
  Challenge,
  encodeChallenge,
  parseChallenge,
} from "../../src/client/HomeChallenge";

const sample: Challenge = {
  era: 3,
  tiles: 1284,
  outlasted: 173,
  rivals: 205,
  seconds: 862,
};

describe("parseChallenge", () => {
  it("reads a well-formed challenge", () => {
    expect(parseChallenge("?c=3.1284.173.205.862")).toEqual(sample);
  });

  it("survives the query string it will actually be handed", () => {
    expect(
      parseChallenge("?utm_source=chat&c=3.1284.173.205.862#modal=help"),
    ).toEqual(sample);
    expect(parseChallenge("c=3.1284.173.205.862")).toEqual(sample);
  });

  it("returns null when there is no challenge at all", () => {
    expect(parseChallenge("")).toBeNull();
    expect(parseChallenge("?")).toBeNull();
    expect(parseChallenge("?requeue")).toBeNull();
  });

  it("rejects anything that is not five plain integers", () => {
    for (const bad of [
      "?c=",
      "?c=3.1284.173.205",
      "?c=3.1284.173.205.862.9",
      "?c=-3.1284.173.205.862",
      "?c=3.1284.173.205.86.2e3",
      "?c=a.b.c.d.e",
      "?c=3,1284,173,205,862",
      "?c=3.1284.173.205.862abc",
      "?c=999999999999.1.1.1.1",
      "?c=NaN.NaN.NaN.NaN.NaN",
    ]) {
      expect(parseChallenge(bad), bad).toBeNull();
    }
  });

  it("never lets a hostile string through as content", () => {
    for (const bad of [
      "?c=<script>alert(1)</script>",
      "?c=3.1284.173.205.862<img src=x onerror=alert(1)>",
      "?c=" + "9".repeat(400),
      "?c=%3Cscript%3E",
      "?c=../../etc/passwd",
    ]) {
      expect(parseChallenge(bad), bad).toBeNull();
    }
  });

  it("rejects era zero, which is not a rung on the ladder", () => {
    expect(parseChallenge("?c=0.100.1.2.30")).toBeNull();
  });

  it("clamps an era past the numeral table instead of rendering nonsense", () => {
    expect(parseChallenge("?c=99.100.1.2.30")?.era).toBe(12);
  });

  it("never reports outlasting more tribes than were in the game", () => {
    const c = parseChallenge("?c=3.100.900.5.30");
    expect(c?.outlasted).toBe(5);
    expect(c!.outlasted).toBeLessThanOrEqual(c!.rivals);
  });

  it("accepts an honest zero result", () => {
    expect(parseChallenge("?c=1.0.0.0.0")).toEqual({
      era: 1,
      tiles: 0,
      outlasted: 0,
      rivals: 0,
      seconds: 0,
    });
  });
});

describe("encodeChallenge / buildChallengeUrl", () => {
  it("round-trips through parse", () => {
    expect(parseChallenge(`?${encodeChallenge(sample)}`)).toEqual(sample);
  });

  it("builds a link that is a plain, pasteable URL", () => {
    const url = buildChallengeUrl("https://primalfront.com", sample);
    expect(url).toBe("https://primalfront.com/?c=3.1284.173.205.862");
    expect(url).not.toMatch(/[<>"'\s]/);
  });

  it("does not double the slash when the origin carries one", () => {
    expect(buildChallengeUrl("https://primalfront.com/", sample)).toBe(
      "https://primalfront.com/?c=3.1284.173.205.862",
    );
  });

  it("clamps on the way out too, so a bad outcome cannot mint a bad link", () => {
    const url = buildChallengeUrl("https://primalfront.com", {
      era: 999,
      tiles: -5,
      outlasted: 900,
      rivals: 5,
      seconds: 12.7,
    });
    expect(url).toBe("https://primalfront.com/?c=12.0.5.5.12");
  });
});
