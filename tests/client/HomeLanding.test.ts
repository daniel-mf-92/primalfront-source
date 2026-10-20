import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * A previous redesign (0cec1e3 "Redesign play home around live battles")
 * silently deleted the home page's pitch line, leaving a first-time visitor with
 * a lobby list and no statement of what the game is. A shared result link now
 * lands here, so that regression is expensive: these assert the landing copy and
 * the challenge read survive the next redesign, or fail loudly.
 *
 * Comments are stripped first so the file cannot satisfy its own assertions.
 */
const ROOT = path.join(__dirname, "..", "..");

function executable(file: string): string {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("home landing", () => {
  const src = executable("src/client/GameModeSelector.ts");

  it("still tells a first-time visitor what the game is", () => {
    expect(src).toContain("renderPitch()");
    expect(src).toContain("mode_selector.pitch");
    expect(src).toContain("mode_selector.pitch_kicker");
  });

  it("shows the pitch above the match browser, not below it", () => {
    expect(src.indexOf("${this.renderPitch()}")).toBeGreaterThan(-1);
    expect(src.indexOf("${this.renderPitch()}")).toBeLessThan(
      src.indexOf("${this.renderFeaturedMatch("),
    );
  });

  it("reads a shared result off the URL", () => {
    expect(src).toContain("parseChallenge(window.location.search)");
    expect(src).toContain("mode_selector.challenge_line");
    expect(src).toContain("mode_selector.challenge_line_solo");
  });

  it("keeps the share link pointed at a challenge URL", () => {
    const win = executable("src/client/hud/layers/WinModal.ts");
    expect(win).toContain("buildChallengeUrl(window.location.origin");
  });

  it("ships the landing copy in en.json, free of the dashes we never send", () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(ROOT, "resources/lang/en.json"), "utf8"),
    );
    const keys = [
      "pitch",
      "pitch_kicker",
      "challenge_kicker",
      "challenge_line",
      "challenge_line_solo",
    ];
    for (const key of keys) {
      const value = en.mode_selector[key];
      expect(typeof value, key).toBe("string");
      expect(value.length, key).toBeGreaterThan(0);
      expect(value, key).not.toMatch(/[—–]/);
    }
    // The challenge line must never imply the result was verified by us.
    expect(en.mode_selector.challenge_line).toContain("{era}");
    expect(en.mode_selector.challenge_line_solo).not.toContain("{rivals}");
  });
});
