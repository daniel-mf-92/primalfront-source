import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { pinnedOrRecommended } from "../../src/client/GameModeSelector";
import { SPAWN_MAX_COVER, spawnFit } from "../../src/client/hud/GameRenderer";
import { formatClock, isLandLoss } from "../../src/client/hud/layers/LandWatch";

// Real-screen audit 2026-10-22 (HUD, onboarding and home page lane): pins the
// behaviours that fixed each finding so a later redesign cannot quietly undo
// them.

const ROOT = path.join(__dirname, "..", "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("land watch (item 2)", () => {
  it("calls a real drop a loss, not border noise", () => {
    expect(isLandLoss(600, 590)).toBe(false); // 10 tiles
    expect(isLandLoss(2000, 1950)).toBe(false); // 2.5 %
    expect(isLandLoss(600, 560)).toBe(true);
    expect(isLandLoss(100, 80)).toBe(true);
  });

  it("counts the Hut down in m:ss", () => {
    expect(formatClock(1200)).toBe("2:00");
    expect(formatClock(95)).toBe("0:10");
    expect(formatClock(0)).toBe("0:00");
  });

  it("is mounted and the Hut shows its time left in the build bar", () => {
    expect(read("index.html")).toContain("<land-watch></land-watch>");
    expect(read("src/client/hud/GameRenderer.ts")).toContain("landWatch,");
    expect(read("src/client/hud/layers/UnitDisplay.ts")).toContain(
      "hutWearFor(this.game)",
    );
  });
});

describe("spawn view (item 8)", () => {
  it("fills a desktop screen with a wide map", () => {
    // World is 2:1; a 16:9 screen needs ~1.125x over "fits" to fill.
    const fit = spawnFit({ width: 1920, height: 1080 }, 2000, 1000);
    expect(fit).toBeCloseTo(1.125, 3);
  });

  it("caps the zoom on a tall phone so the map is not mostly cut away", () => {
    expect(spawnFit({ width: 390, height: 844 }, 2000, 1000)).toBe(
      SPAWN_MAX_COVER,
    );
  });

  it("keeps the spawn prompt in one strip with the pick-for-me button inside", () => {
    const src = read("src/client/hud/layers/HeadsUpMessage.ts");
    expect(src).toContain("tc-spawn-strip");
    expect(src).not.toContain("top-[15%] mt-14");
  });
});

describe("home page (item 9)", () => {
  const lobby = (gameID: string) => ({ gameID }) as never;

  it("keeps the featured battle under the pointer while it is joinable", () => {
    const lobbies = {
      games: { ffa: [lobby("a"), lobby("b")], team: [lobby("c")] },
    } as never;
    expect(pinnedOrRecommended(lobbies, null)).toEqual({ gameID: "a" });
    expect(pinnedOrRecommended(lobbies, "c")).toEqual({ gameID: "c" });
    // The pinned one started and left the list: fall back.
    expect(pinnedOrRecommended(lobbies, "gone")).toEqual({ gameID: "a" });
  });

  it("puts a Practice button in the pitch row above the featured battle", () => {
    const src = read("src/client/GameModeSelector.ts");
    expect(src).toContain("pf-pitch__practice");
    expect(src).toContain("mode_selector.play_solo_now");
  });
});

describe("result screen (item 10)", () => {
  it("silences the match when the result shows and keeps the menu quiet after", () => {
    const win = read("src/client/hud/layers/WinModal.ts");
    expect(win).toContain("new MusicSuspendEvent(true)");
    expect(win).toContain("markQuietMenu()");
    expect(read("src/client/Main.ts")).toContain("consumeQuietMenu()");
    expect(read("src/client/ClientGameRunner.ts")).toContain(
      "this.soundManager.suspendMusic()",
    );
  });
});

describe("goal panel tip (item 7)", () => {
  it("shows the next action as wrapped text, not a native title tooltip on the card", () => {
    const src = read("src/client/hud/layers/ControlPanel.ts");
    expect(src).not.toContain("title=${detail}");
    expect(src).toContain('class="tc-objective-detail');
  });
});

describe("structures zoomed out (item 6)", () => {
  it("caps a structure icon to a map footprint", () => {
    const settings = JSON.parse(
      read("src/client/render/gl/render-settings.json"),
    );
    expect(settings.structure.maxWorldTiles).toBeGreaterThan(0);
    expect(
      read("src/client/render/gl/shaders/structure/structure.vert.glsl"),
    ).toContain("uMaxWorldTiles");
  });
});
