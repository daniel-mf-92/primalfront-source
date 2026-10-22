import fs from "fs/promises";
import path from "path";
import { describe, expect, test } from "vitest";

const readRepoFile = (relativePath: string) =>
  fs.readFile(path.join(process.cwd(), relativePath), "utf8");

describe("in-game UX contract", () => {
  test("keeps the first mobile objective actionable and visible", async () => {
    const controlPanel = await readRepoFile(
      "src/client/hud/layers/ControlPanel.ts",
    );

    expect(controlPanel).toContain('"control_panel.first_move"');
    expect(controlPanel).toContain("tc-objective-card--first-turn");
    expect(controlPanel).toContain("tc-objective-detail");
    expect(controlPanel).toContain("private isFirstTurnObjective()");
    expect(controlPanel).toContain("tc-control-panel--first-turn");
    expect(controlPanel).toContain(
      "isFirstTurn ? html`` : this.renderAgePanel()",
    );
    expect(controlPanel).not.toContain(
      'class="text-xs text-text-mid truncate hidden lg:block mt-0.5"',
    );
    expect(controlPanel).toContain("this._dramaEvents.slice(0, 1)");
    expect(
      controlPanel.match(/this\._objective\?\.id === "find_resources"/g),
    ).toHaveLength(2);
    const agePanel = controlPanel.slice(
      controlPanel.indexOf("private renderAgePanel()"),
      controlPanel.indexOf("private renderArmageddonClock()"),
    );
    expect(agePanel).toContain("tc-era-runway");
    expect(agePanel).toContain("this.renderEraTriumphs()");
    expect(agePanel).toContain("this.renderTransitionTempo()");
    expect(agePanel).not.toContain("this._hasPermanentSettlement");
    expect(agePanel).not.toContain("this.game.");
  });

  test("enforces mobile-sized HUD controls and attack slider targets", async () => {
    const styles = await readRepoFile("src/client/styles.css");
    const controlPanel = await readRepoFile(
      "src/client/hud/layers/ControlPanel.ts",
    );

    expect(styles).toMatch(
      /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*?\.tc-hud-icon-btn\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
    );
    expect(styles).toMatch(/\.tc-attack-slider\s*\{[\s\S]*?height:\s*32px;/);
    expect(styles).toMatch(
      /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*?\.tc-attack-slider\s*\{[\s\S]*?height:\s*44px;/,
    );
    expect(controlPanel.match(/class="tc-attack-slider/g)).toHaveLength(2);
  });

  test("keeps the mobile command surface from becoming a second map", async () => {
    const styles = await readRepoFile("src/client/styles.css");

    expect(styles).toMatch(
      /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*?\.tc-hud-main\s*\{[\s\S]*?max-height:\s*28vh;/,
    );
  });

  test("gives touch players objective detail and radial action labels", async () => {
    const controlPanel = await readRepoFile(
      "src/client/hud/layers/ControlPanel.ts",
    );
    const radialMenu = await readRepoFile(
      "src/client/hud/layers/RadialMenu.ts",
    );

    // The next action shows on every screen size (it was desktop-hidden behind
    // a native tooltip; real-screen audit 2026-10-22).
    expect(controlPanel).toContain('<div class="tc-objective-detail');
    expect(controlPanel).not.toContain("tc-objective-detail--mobile");
    expect(radialMenu).toContain("private menuItemLabel");
    expect(radialMenu).toContain('class", "menu-item-label"');
    expect(radialMenu).toContain('attr("data-menu-label"');
  });

  test("explains disabled actions without covering nameplates", async () => {
    const radialMenu = await readRepoFile(
      "src/client/hud/layers/RadialMenu.ts",
    );
    const renderer = await readRepoFile("src/client/render/gl/Renderer.ts");
    const styles = await readRepoFile("src/client/styles.css");
    const translations = await readRepoFile("resources/lang/en.json");

    expect(radialMenu).toContain("showDisabledReason");
    expect(radialMenu).toContain("data-disabled-reason");
    expect(radialMenu).toContain('classList.add("radial-menu-open")');
    expect(renderer).toContain('classList.contains("radial-menu-open")');
    expect(styles).toContain(".radial-tooltip-disabled-message");
    expect(translations).toContain('"disabled_spawn"');
    expect(translations).toContain('"disabled_attack"');
  });

  test("keeps the first-five-minutes roadmap and result actions explicit", async () => {
    const controlPanel = await readRepoFile(
      "src/client/hud/layers/ControlPanel.ts",
    );
    const winModal = await readRepoFile("src/client/hud/layers/WinModal.ts");
    const styles = await readRepoFile("src/client/styles.css");
    const translations = await readRepoFile("resources/lang/en.json");

    expect(controlPanel).toContain("renderPrimitiveRoadmap");
    expect(controlPanel).toContain("tc-objective-roadmap");
    expect(controlPanel).toContain("data-roadmap-step");
    expect(controlPanel).toContain("control_panel.roadmap_label");
    expect(controlPanel).toContain(".tc-objective-roadmap");
    expect(winModal).toContain("renderResultSummary");
    expect(winModal).toContain("_handlePractice");
    expect(winModal).toContain('key: "win_modal.practice"');
    expect(styles).toContain(".win-modal-summary");
    expect(translations).toContain('"roadmap_label"');
    expect(translations).toContain('"result_summary_win"');
  });

  test("keeps player nameplates subordinate to the map", async () => {
    const settings = JSON.parse(
      await readRepoFile("src/client/render/gl/render-settings.json"),
    );

    expect(settings.name.nameScaleFactor).toBeLessThanOrEqual(0.25);
    expect(settings.name.nameScaleCap).toBeLessThanOrEqual(1.8);
  });

  test("keeps the map treatment vivid instead of washing out the battlefield", async () => {
    const styles = await readRepoFile("src/client/styles.css");

    expect(styles).toMatch(
      /body\.in-game #webgl-debug-canvas\s*\{[\s\S]*?saturate\(1\.14\)[\s\S]*?brightness\(0\.97\)[\s\S]*?contrast\(1\.1\)/,
    );
    expect(styles).toMatch(/\.tc-map-bloom\s*\{[\s\S]*?opacity:\s*0\.34;/);
  });

  test("keeps the era runway inside narrow HUD widths", async () => {
    const styles = await readRepoFile("src/client/styles.css");

    const eraStyles = styles.slice(
      styles.indexOf(".tc-era-runway {", styles.indexOf("/* Era runway:")),
      styles.indexOf("/* Gold cell", styles.indexOf("/* Era runway:")),
    );
    expect(eraStyles).toContain(
      "grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);",
    );
    expect(eraStyles).not.toMatch(/minmax\(\d+(?:\.\d+)?rem,/);
    expect(eraStyles).toMatch(
      /\.tc-triumph\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/,
    );
    expect(eraStyles).toMatch(
      /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*?\.tc-era-runway\s*\{/,
    );
  });

  test("does not auto-open or stack secondary HUD surfaces", async () => {
    const leftSidebar = await readRepoFile(
      "src/client/hud/layers/GameLeftSidebar.ts",
    );
    const playerInfo = await readRepoFile(
      "src/client/hud/layers/PlayerInfoOverlay.ts",
    );
    const rightSidebar = await readRepoFile(
      "src/client/hud/layers/GameRightSidebar.ts",
    );

    expect(leftSidebar).not.toContain("_shownOnInit");
    expect(leftSidebar).not.toContain("this.isLeaderboardShow = true");
    expect(playerInfo).not.toContain("ContextMenuEvent");
    expect(playerInfo).not.toContain("TouchEvent");
    expect(rightSidebar).toContain("tc-game-controls");
    expect(rightSidebar.match(/aria-label=/g)?.length).toBeGreaterThanOrEqual(
      5,
    );
  });
});
