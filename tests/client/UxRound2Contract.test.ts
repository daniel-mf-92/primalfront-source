import fs from "fs/promises";
import path from "path";
import { describe, expect, test } from "vitest";
import {
  MAX_INCOMING_ATTACK_ROWS,
  pickIncomingAttacks,
} from "../../src/client/hud/layers/AttacksDisplay";

// Round 2 of the 2026-10-21 UX audit. Each test pins one of the seven items
// that were found half-done or untouched, so a later cleanup cannot quietly
// put the old behaviour back.
const readRepoFile = (relativePath: string) =>
  fs.readFile(path.join(process.cwd(), relativePath), "utf8");
const readEn = async () =>
  JSON.parse(await readRepoFile("resources/lang/en.json"));

describe("UX audit round 2", () => {
  test("item 3: attacks from tribes are listed, biggest first, capped", async () => {
    const attacks = [
      { id: "a", troops: 100, retreating: false },
      { id: "b", troops: 900, retreating: false },
      { id: "c", troops: 500, retreating: false },
      { id: "d", troops: 50, retreating: false },
      { id: "e", troops: 700, retreating: false },
    ];
    const picked = pickIncomingAttacks(attacks);
    expect(picked.map((a) => a.id)).toEqual(
      ["b", "e", "c", "a", "d"].slice(0, MAX_INCOMING_ATTACK_ROWS),
    );
    expect(picked.length).toBeLessThanOrEqual(MAX_INCOMING_ATTACK_ROWS);

    const alertFrame = await readRepoFile(
      "src/client/hud/layers/AlertFrame.ts",
    );
    const attacksDisplay = await readRepoFile(
      "src/client/hud/layers/AttacksDisplay.ts",
    );
    expect(alertFrame).not.toContain("PlayerType.Bot");
    expect(attacksDisplay).not.toContain("PlayerType.Bot");
    expect(alertFrame).toContain('"under-attack"');
    expect(alertFrame).toContain("heads_up_message.under_attack");
    expect((await readEn()).heads_up_message.under_attack).toContain("{name}");
  });

  test("item 6: a raid is announced to both sides and troops at the limit say so", async () => {
    const raid = await readRepoFile("src/core/execution/RaidExecution.ts");
    for (const key of [
      "events_display.raided_by",
      "events_display.raid_success",
      "events_display.raid_failed",
      "events_display.raid_repelled",
    ]) {
      expect(raid).toContain(key);
    }
    const en = await readEn();
    expect(en.events_display.raided_by).toContain("{gold}");
    const controlPanel = await readRepoFile(
      "src/client/hud/layers/ControlPanel.ts",
    );
    expect(controlPanel).toContain('"control_panel.troops_full"');
    expect(controlPanel).toContain('"control_panel.troops_full_hint"');
    expect(en.control_panel.troops_full).toBeTruthy();
  });

  test("item 7: nothing in the phone HUD drops below 11px and labels get a brighter ink", async () => {
    for (const file of [
      "src/client/hud/layers/ControlPanel.ts",
      "src/client/hud/layers/UnitDisplay.ts",
      "src/client/hud/layers/GameLeftSidebar.ts",
      "src/client/hud/layers/PlayerInfoOverlay.ts",
    ]) {
      const src = await readRepoFile(file);
      expect(src, file).not.toMatch(/text-\[(?:[6-9]|10)px\]/);
    }
    const styles = await readRepoFile("src/client/styles.css");
    expect(styles).toMatch(
      /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*?--fz-label:\s*0\.78rem;/,
    );
    const buildMenu = await readRepoFile("src/client/hud/layers/BuildMenu.ts");
    expect(buildMenu).not.toMatch(/font-size:\s*[6-9]px;/);
  });

  test("item 8: the help explains the Stone Age, not nukes and warships", async () => {
    const help = await readRepoFile("src/client/HelpModal.ts");
    for (const gone of [
      "help_modal.build_mirv",
      "help_modal.build_warship",
      "help_modal.build_silo",
      "help_modal.action_warship_selectall",
      "help_modal.bomb_direction",
      "help_modal.radial_boat",
    ]) {
      expect(help).not.toContain(gone);
    }
    expect(help).toContain("STONE_AGE_BUILDS");
    expect(help).toContain("unit_type.hut");
    expect(help).toContain("unit_type.permanent_settlement");
    expect(help).toContain("help_modal.radial_raid");
  });

  test("item 9: leaving a match opens the result screen instead of a confirm()", async () => {
    const sidebar = await readRepoFile(
      "src/client/hud/layers/GameRightSidebar.ts",
    );
    const settings = await readRepoFile(
      "src/client/hud/layers/SettingsModal.ts",
    );
    const winModal = await readRepoFile("src/client/hud/layers/WinModal.ts");
    expect(sidebar).toContain("new LeaveGameIntentEvent()");
    expect(settings).toContain("new LeaveGameIntentEvent()");
    expect(sidebar).not.toContain("confirm(");
    expect(settings).not.toContain('window.location.href = "/"');
    expect(winModal).toContain("showLeaveScreen");
    expect(winModal).toContain("win_modal.result_summary_left");
    const en = await readEn();
    expect(en.win_modal.left).toBeTruthy();
    expect(en.win_modal.keep).toBeTruthy();
  });

  test("item 10: the practice form folds everything after map and difficulty", async () => {
    const single = await readRepoFile("src/client/SinglePlayerModal.ts");
    const config = await readRepoFile(
      "src/client/components/GameConfigSettings.ts",
    );
    expect(single).toContain('labelKey: "single_modal.more_options"');
    expect(config).toContain('class="pf-advanced"');
    expect(config).toContain("?open=${settings.advanced.open ?? false}");
    // The host lobby keeps its flat form.
    const host = await readRepoFile("src/client/HostLobbyModal.ts");
    expect(host).not.toContain("advanced:");
  });

  test("item 11: one word for the ladder (Age), one for solo play (Practice), both AI sliders explained", async () => {
    const en = await readEn();
    for (const section of ["win_modal", "control_panel", "mode_selector"]) {
      for (const [key, value] of Object.entries(en[section])) {
        expect(String(value), `${section}.${key}`).not.toMatch(/\bEra\b/);
      }
    }
    expect(en.main.solo).toBe("Practice");
    expect(en.player_stats_tree.solo).toBe("Practice");
    expect(en.mode_selector.play_solo_now).not.toMatch(/solo/i);
    for (const section of ["single_modal", "host_modal"]) {
      expect(en[section].bots).toMatch(/tribes/i);
      expect(en[section].nations).toMatch(/nations/i);
      expect(en[section].bots).not.toBe("Tribes: ");
      expect(en[section].nations).not.toBe("Nations: ");
    }
    const share = await readRepoFile("src/client/hud/layers/MatchResult.ts");
    expect(share).not.toContain("at Era ");
    const preview = await readRepoFile("src/server/ChallengePreview.ts");
    expect(preview).not.toContain("`Era ");
  });
});
