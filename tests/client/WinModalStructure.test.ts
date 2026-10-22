import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * The end-of-match modal is the only screen a player has a reason to show
 * someone else, so a few things about it are load-bearing and easy to undo by
 * accident. These assert on the executable source, with comments stripped
 * first so a comment mentioning a rule can never satisfy the rule.
 */
const SRC = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "client",
  "hud",
  "layers",
  "WinModal.ts",
);

function executableSource(): string {
  return fs
    .readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("WinModal structure", () => {
  const src = executableSource();

  it("never renders the store block when there is nothing to sell", () => {
    // Without this early return the modal shows "Support Primalfront!" over an
    // empty box on any build whose cosmetics API returns nothing.
    expect(src).toMatch(
      /if\s*\(this\.patternContent === null\)\s*return null;/,
    );
  });

  it("offers a share action wired to the share handler", () => {
    expect(src).toContain("win-modal-share");
    expect(src).toMatch(/@click=\$\{this\._handleShare\}/);
  });

  // Audit 2026-10-22: Share was the biggest button and Exit the smallest. The
  // one accent button is now the likely next step (play again / back to
  // menu); share sits with the secondary actions.
  it("makes play-again / back-to-menu the one accent CTA, share secondary", () => {
    const variants = Array.from(
      src.matchAll(/variant="(primary|secondary)"/g),
    ).map((m) => m[1]);
    expect(variants.filter((v) => v === "primary")).toHaveLength(1);
    expect(
      variants.filter((v) => v === "secondary").length,
    ).toBeGreaterThanOrEqual(3);
    const primary = src.slice(src.indexOf('variant="primary"') - 60);
    expect(primary.slice(0, 400)).toContain("win-modal-primary");
    expect(primary.slice(0, 400)).not.toContain("win-modal-share");
    expect(src).toContain('key: "win_modal.requeue"');
    expect(src).toContain('key: "win_modal.exit"');
  });

  it("shows the result strip above the buttons", () => {
    expect(src.indexOf("renderResultStrip()")).toBeLessThan(
      src.indexOf("win-modal-primary"),
    );
  });

  it("does not make the player wait out a long lockout before acting", () => {
    const delay = /this\.showButtons = true;[\s\S]*?\},\s*(\d+)\);/.exec(src);
    expect(delay).not.toBeNull();
    expect(Number(delay![1])).toBeLessThanOrEqual(1500);
  });
});
