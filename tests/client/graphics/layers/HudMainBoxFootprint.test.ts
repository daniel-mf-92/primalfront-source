import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { UserSettings } from "../../../../src/core/game/UserSettings";

// The bottom-centre HUD box sits over the battlefield. It regressed once into a
// near-opaque, unbounded slab of prose that buried what the player was doing
// (2026-07-31). These guards are cheap and structural: they assert the two
// properties that kept it playable, so a future change that removes either one
// fails here instead of silently re-burying the map.
//
// Deliberately NOT phrase-matching the source — comments in the very files under
// test would match themselves. Everything below parses declarations/attributes.

const repoRoot = path.resolve(__dirname, "../../../..");

/** Strip CSS/HTML comments so prose can never satisfy a structural assertion. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function ruleBody(css: string, selector: string): string {
  // Match `selector {` only at a rule start, then take up to the closing brace.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`,
    "m",
  ).exec(css);
  expect(match, `no CSS rule found for ${selector}`).not.toBeNull();
  return match![1];
}

function declaration(body: string, property: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(
    body,
  );
  return match ? match[1].trim() : null;
}

describe("main HUD box footprint", () => {
  const css = stripComments(
    fs.readFileSync(path.join(repoRoot, "src/client/styles.css"), "utf8"),
  );
  const indexHtml = stripComments(
    fs.readFileSync(path.join(repoRoot, "index.html"), "utf8"),
  );

  it("caps its height so no future block can grow it without bound", () => {
    const body = ruleBody(css, ".tc-hud-main");

    const maxHeight = declaration(body, "max-height");
    expect(maxHeight, ".tc-hud-main must declare a max-height").not.toBeNull();

    // Must be a viewport-relative cap, and must leave the majority of the
    // screen to the map.
    const vh = /^([\d.]+)vh$/.exec(maxHeight!);
    expect(
      vh,
      `max-height must be a vh cap, got "${maxHeight}"`,
    ).not.toBeNull();
    expect(Number(vh![1])).toBeLessThanOrEqual(40);
  });

  it("scrolls the readouts, never the build buttons", () => {
    // The cap is only safe if the element that gives way is the control panel.
    // Putting overflow on the wrapper scrolls unit-display — the build row —
    // off-screen, which hides a primary control behind a scroll.
    expect(declaration(ruleBody(css, ".tc-hud-main"), "overflow-y")).toBeNull();

    const panel = ruleBody(css, ".tc-hud-main > control-panel");
    expect(declaration(panel, "overflow-y")).toBe("auto");
    // A flex child only shrinks below its content size with min-height:0.
    expect(declaration(panel, "min-height")).toBe("0");

    const build = ruleBody(css, ".tc-hud-main > unit-display");
    const flex = declaration(build, "flex");
    expect(flex, "unit-display must declare flex").not.toBeNull();
    expect(
      flex!.startsWith("0 0"),
      `build row must not shrink, got "${flex}"`,
    ).toBe(true);
  });

  it("keeps a translucent fill so the map reads through it", () => {
    const body = ruleBody(css, ".tc-hud-main");

    const background = declaration(body, "background");
    expect(background, ".tc-hud-main must declare a background").not.toBeNull();

    // color-mix(... N%, transparent) — N is the opaque share of the fill.
    const mix = /(\d+)%\s*,\s*transparent/.exec(background!);
    expect(
      mix,
      `background must mix toward transparent, got "${background}"`,
    ).not.toBeNull();
    expect(Number(mix![1])).toBeLessThanOrEqual(70);

    // Blur is what buys legibility once the fill is translucent.
    expect(declaration(body, "backdrop-filter")).toMatch(/blur\(/);
  });

  it("is not re-opaqued by a utility class in the markup", () => {
    // Find the element that owns the box and check its class list directly,
    // rather than scanning the whole file for a string.
    const el = /<div\s+class="([^"]*\btc-hud-main\b[^"]*)"/.exec(indexHtml);
    expect(el, "no element carries tc-hud-main").not.toBeNull();

    const classes = el![1].split(/\s+/);
    const opaqueFill = classes.filter((c) =>
      /^(bg-\w+-\d+\/(7[1-9]|[89]\d|100)|bg-\w+-\d+)$/.test(c),
    );
    expect(
      opaqueFill,
      `opaque background utilities on the main HUD box: ${opaqueFill.join(", ")}`,
    ).toEqual([]);
  });
});

describe("era reference copy", () => {
  it("starts collapsed, so prose is opt-in rather than permanent", () => {
    localStorage.clear();
    expect(new UserSettings().eraDetailsOpen()).toBe(false);
  });

  it("round-trips the player's choice", () => {
    localStorage.clear();
    const settings = new UserSettings();
    settings.setEraDetailsOpen(true);
    expect(settings.eraDetailsOpen()).toBe(true);
    settings.setEraDetailsOpen(false);
    expect(settings.eraDetailsOpen()).toBe(false);
  });
});
