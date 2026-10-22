import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { ToggleStructureEvent } from "../../InputHandler";
import { UIState } from "../../UIState";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/SettlementIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const hutIcon = assetUrl("images/HutIconWhite.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const primitiveFarmIcon = assetUrl("images/PrimitiveFarmIconWhite.svg");
const samLauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const scoutLookoutIcon = assetUrl("images/ScoutLookoutIconWhite.svg");
const defensePostIcon = assetUrl("images/ShieldIconWhite.svg");
const tradeOutpostIcon = assetUrl("images/TradeOutpostIconWhite.svg");

// Short names shown under the build icons (full names are in the hover card).
const SHORT_NAME_KEYS: Record<string, string> = {
  permanent_settlement: "unit_display.short_permanent_settlement",
  hut: "unit_display.short_hut",
  trade_outpost: "unit_display.short_trade_outpost",
  scout_lookout: "unit_display.short_scout_lookout",
  primitive_farm: "unit_display.short_primitive_farm",
};
function shortUnitName(structureKey: string): string {
  const key = SHORT_NAME_KEYS[structureKey];
  return key !== undefined
    ? translateText(key)
    : translateText("unit_type." + structureKey);
}

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private _cities = 0;
  private _huts = 0;
  private _primitiveFarms = 0;
  private _tradeOutposts = 0;
  private _scoutLookouts = 0;
  private _warships = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private allDisabled = false;
  private _hoveredUnit: PlayerBuildableUnitType | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    const userSettings = new UserSettings();

    this.keybinds = userSettings.parsedUserKeybinds();

    this.allDisabled = BuildMenus.types.every((u) => config.isUnitDisabled(u));
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  // Era gate (mirrors BuildMenu.isInEra): a unit belongs in this dock only when
  // the player's current Age falls within the unit's [minAge, maxAge] window.
  // Out-of-era items are OMITTED entirely (see renderUnitItem) — never shown as
  // a locked/greyed entry. This replaces the legacy age-lock "show-locked" path
  // removed per the primitive-era redesign (§5).
  private isInEra(item: UnitType): boolean {
    const player = this.game?.myPlayer();
    if (!player) {
      return false;
    }
    const info = this.game.unitInfo(item);
    const age = player.age();
    if (info.minAge !== undefined && age < info.minAge) {
      return false;
    }
    if (info.maxAge !== undefined && age > info.maxAge) {
      return false;
    }
    return true;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    if (!this.isInEra(item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, BuildMenus.types).then((buildables) => {
      this.playerBuildables = buildables;
    });
    this._cities = player.totalUnitLevels(UnitType.City);
    this._huts = player.totalUnitLevels(UnitType.Hut);
    this._primitiveFarms = player.totalUnitLevels(UnitType.PrimitiveFarm);
    this._tradeOutposts = player.totalUnitLevels(UnitType.TradeOutpost);
    this._scoutLookouts = player.totalUnitLevels(UnitType.ScoutLookout);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }

    return html`
      <div class="border-t border-white/10 p-0.5 w-full">
        <div
          class="grid grid-rows-1 auto-cols-max grid-flow-col gap-0.5 w-fit mx-auto items-center"
        >
          <!-- "BUILD" prefix: without it new players read these hotkey chips
               as cryptic zero score-counters (2026-07-13 audit P1). -->
          <span
            class="text-[11px] font-bold tracking-widest text-text-lo uppercase pr-1 select-none"
            >${translateText("unit_display.build_label")}</span
          >
          ${this.renderUnitItem(
            cityIcon,
            this._cities,
            UnitType.City,
            "permanent_settlement",
            this.keybinds["buildCity"]?.key ?? "1",
          )}
          ${this.renderUnitItem(
            hutIcon,
            this._huts,
            UnitType.Hut,
            "hut",
            this.keybinds["buildHut"]?.key ?? "2",
          )}
          ${this.renderUnitItem(
            tradeOutpostIcon,
            this._tradeOutposts,
            UnitType.TradeOutpost,
            "trade_outpost",
            this.keybinds["buildTradeOutpost"]?.key ?? "3",
          )}
          ${this.renderUnitItem(
            scoutLookoutIcon,
            this._scoutLookouts,
            UnitType.ScoutLookout,
            "scout_lookout",
            this.keybinds["buildScoutLookout"]?.key ?? "4",
          )}
          ${this.renderUnitItem(
            primitiveFarmIcon,
            this._primitiveFarms,
            UnitType.PrimitiveFarm,
            "primitive_farm",
            this.keybinds["buildPrimitiveFarm"]?.key ?? "5",
          )}
          ${this.renderUnitItem(
            factoryIcon,
            this._factories,
            UnitType.Factory,
            "factory",
            this.keybinds["buildFactory"]?.key ?? "2",
          )}
          ${this.renderUnitItem(
            portIcon,
            this._port,
            UnitType.Port,
            "port",
            this.keybinds["buildPort"]?.key ?? "3",
          )}
          ${this.renderUnitItem(
            defensePostIcon,
            this._defensePost,
            UnitType.DefensePost,
            "defense_post",
            this.keybinds["buildDefensePost"]?.key ?? "4",
          )}
          ${this.renderUnitItem(
            missileSiloIcon,
            this._missileSilo,
            UnitType.MissileSilo,
            "missile_silo",
            this.keybinds["buildMissileSilo"]?.key ?? "5",
          )}
          ${this.renderUnitItem(
            samLauncherIcon,
            this._samLauncher,
            UnitType.SAMLauncher,
            "sam_launcher",
            this.keybinds["buildSamLauncher"]?.key ?? "6",
          )}
          ${this.renderUnitItem(
            warshipIcon,
            this._warships,
            UnitType.Warship,
            "warship",
            this.keybinds["buildWarship"]?.key ?? "7",
          )}
          ${this.renderUnitItem(
            atomBombIcon,
            null,
            UnitType.AtomBomb,
            "atom_bomb",
            this.keybinds["buildAtomBomb"]?.key ?? "8",
          )}
          ${this.renderUnitItem(
            hydrogenBombIcon,
            null,
            UnitType.HydrogenBomb,
            "hydrogen_bomb",
            this.keybinds["buildHydrogenBomb"]?.key ?? "9",
          )}
          ${this.renderUnitItem(
            mirvIcon,
            null,
            UnitType.MIRV,
            "mirv",
            this.keybinds["buildMIRV"]?.key ?? "0",
          )}
        </div>
      </div>
    `;
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }
    // Era gate: omit out-of-era units entirely (no locked/greyed entry).
    if (!this.isInEra(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const hovered = this._hoveredUnit === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${() => {
          this._hoveredUnit = unitType;
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnit = null;
          this.requestUpdate();
        }}
      >
        ${hovered
          ? html`
              <div
                class="tc-hud-dock absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-text text-center w-max text-xs rounded-md p-1 z-[100] pointer-events-none"
              >
                <div class="font-bold text-sm mb-1">
                  ${translateText(
                    "unit_type." + structureKey,
                  )}${` [${displayHotkey}]`}
                </div>
                <div class="p-2">
                  ${translateText("build_menu.desc." + structureKey)}
                </div>
                ${unitType === UnitType.Warship
                  ? html`<div
                      class="mt-1 px-2 py-1 text-[11px] text-age-accent border-t border-hairline"
                    >
                      ⇧ ${translateText("build_menu.warship_shift_hint")}
                    </div>`
                  : null}
                <div class="flex items-center justify-center gap-1">
                  <img src=${goldCoinIcon} width="13" height="13" />
                  <span class="tc-num text-faction-you"
                    >${renderNumber(this.cost(unitType))}</span
                  >
                </div>
              </div>
            `
          : null}
        <div
          class="${this.canBuild(unitType)
            ? ""
            : "opacity-40"} border rounded-md px-0.5 pb-0.5 flex items-center gap-0.5 cursor-pointer transition-colors duration-[120ms]
             ${selected
            ? "border-age-accent bg-age-accent/15 hover:bg-age-accent/20"
            : "border-hairline hover:border-hairline-strong hover:bg-surface-2/60"}
             text-text"
          @click=${() => {
            if (selected) {
              this.uiState.ghostStructure = null;
            } else if (this.canBuild(unitType)) {
              this.uiState.ghostStructure = unitType;
            }
            this.requestUpdate();
          }}
          @mouseenter=${() => {
            switch (unitType) {
              case UnitType.AtomBomb:
              case UnitType.HydrogenBomb:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.MissileSilo,
                    UnitType.SAMLauncher,
                  ]),
                );
                break;
              case UnitType.Warship:
                this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }}
          @mouseleave=${() =>
            this.eventBus?.emit(new ToggleStructureEvent(null))}
        >
          ${html`<div class="ml-0.5 text-[11px] relative -top-1 text-gray-300">
            ${displayHotkey}
          </div>`}
          <div class="flex items-center gap-0.5 pt-0.5">
            <img src=${icon} alt=${structureKey} class="align-middle size-5" />
            ${number !== null
              ? html`<span class="text-xs">${renderNumber(number)}</span>`
              : null}
          </div>
        </div>
        <!-- Name under the icon: hover-only names were never found by a new
             player (real-screen playtest 2026-10-22). -->
        <span
          class="text-[11px] leading-none mt-0.5 text-text-dim whitespace-nowrap select-none"
          >${shortUnitName(structureKey)}</span
        >
      </div>
    `;
  }
}
