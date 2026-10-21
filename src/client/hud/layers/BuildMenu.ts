import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  Age,
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { Controller } from "../../Controller";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { renderNumber } from "../../Utils";
import { GameView } from "../../view";
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
// Primitive settlements have dedicated glyphs: a rustic hut for the temporary
// Hut, and a single friendly house for the permanent Settlement (the "first
// house" you build to advance the era — never the multi-tower apartments glyph).
const hutIcon = assetUrl("images/HutIconWhite.svg");
const settlementIcon = assetUrl("images/SettlementIconWhite.svg");
// Gold laurel wreath framing the permanent-settlement "prize" build option.
const laurelIcon = assetUrl("flags/custom/laurel_wreath.svg");
// Temporary Primitive-only economy/scouting structures (mirror the Hut: era-
// gated, decaying, not upgradeable).
const tradeOutpostIcon = assetUrl("images/TradeOutpostIconWhite.svg");
const scoutLookoutIcon = assetUrl("images/ScoutLookoutIconWhite.svg");
const primitiveFarmIcon = assetUrl("images/PrimitiveFarmIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samlauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");

// HUD era labels, indexed by RAW Age integer (Game.ts Age). AI-NOTE: keep aligned
// with the Age enum — Classical was inserted at index 1. | evidence: tests/ClassicalEra.test.ts
export const ageNames = [
  "Primitive",
  "Classical",
  "Imperial",
  "Feudal",
  "Enlightened",
  "Industrial",
  "Modern",
  "Alien",
] as const;

export interface BuildItemDisplay {
  unitType: PlayerBuildableUnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

export const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      key: "unit_type.warship",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
    {
      unitType: UnitType.Hut,
      icon: hutIcon,
      description: "build_menu.desc.hut",
      key: "unit_type.hut",
      countable: true,
    },
    {
      unitType: UnitType.TradeOutpost,
      icon: tradeOutpostIcon,
      description: "build_menu.desc.trade_outpost",
      key: "unit_type.trade_outpost",
      countable: true,
    },
    {
      unitType: UnitType.ScoutLookout,
      icon: scoutLookoutIcon,
      description: "build_menu.desc.scout_lookout",
      key: "unit_type.scout_lookout",
      countable: true,
    },
    {
      unitType: UnitType.PrimitiveFarm,
      icon: primitiveFarmIcon,
      description: "build_menu.desc.primitive_farm",
      key: "unit_type.primitive_farm",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: settlementIcon,
      description: "build_menu.desc.permanent_settlement",
      key: "unit_type.permanent_settlement",
      countable: true,
    },
    {
      unitType: UnitType.Factory,
      icon: factoryIcon,
      description: "build_menu.desc.factory",
      key: "unit_type.factory",
      countable: true,
    },
  ],
];

export const flattenedBuildTable = buildTable.flat();

// The permanent settlement (City) is the era-advancing PRIZE, not a routine
// structure. It is pulled OUT of the normal build grid (see getBuildableUnits)
// and rendered on its own laurel-framed pedestal so it reads as the aspirational
// objective (owner direction 2026-07-04). Keep it in buildTable so cost/count/
// BuildMenus.types still resolve it — only the GRID rendering excludes it.
const settlementBuildItem = flattenedBuildTable.find(
  (i) => i.unitType === UnitType.City,
);

@customElement("build-menu")
export class BuildMenu extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private clickedTile: TileRef;
  public playerBuildables: BuildableUnit[] | null = null;
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;
  public transformHandler: TransformHandler;

  init() {
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      if (!this.game.myPlayer()?.isAlive()) {
        return;
      }
      if (!this._hidden) {
        // Players sometimes hold control while building a unit,
        // so if the menu is already open, ignore the event.
        return;
      }
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.game.ref(clickedCell.x, clickedCell.y);
      this.showMenu(tile);
    });
    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
    this.eventBus.on(ShowEmojiMenuEvent, () => this.hideMenu());
    this.eventBus.on(MouseDownEvent, () => this.hideMenu());
  }

  tick() {
    if (!this._hidden) {
      this.refresh();
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    /* Tactical Command: in-game build menu = forged glass command surface.
       Custom properties (--surface-*, --age-accent, etc.) inherit into this
       shadow root from :root, so the menu tracks the live age-accent. */
    .build-menu {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background: var(
        --glass-bg,
        color-mix(in srgb, var(--surface-1, #11161f) 82%, transparent)
      );
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
      padding: 15px;
      border: 1px solid var(--hairline, rgba(230, 235, 242, 0.1));
      box-shadow:
        inset 0 1px 0 var(--bevel-hi, rgba(230, 235, 242, 0.06)),
        var(--shadow-2, 0 12px 48px rgba(0, 0, 0, 0.75));
      border-radius: var(--radius-lg, 14px);
      color: var(--text, #e6ebf2);
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 95vw;
      max-height: 95vh;
      overflow-y: auto;
    }
    .build-description {
      font-size: 0.6rem;
      color: var(--text-dim, #9aa7b8);
    }
    /* Featured permanent-settlement pedestal: laurel wreaths flanking a gold-
       framed build button, set apart from the routine grid as the aspirational
       era-advancing goal. */
    .settlement-feature {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
    }
    .settlement-laurel {
      width: 34px;
      height: 34px;
      flex-shrink: 0;
      opacity: 0.95;
      /* remap the asset's fixed red fill to warm gold + a soft glow */
      filter: brightness(0) saturate(100%) invert(78%) sepia(52%) saturate(560%)
        hue-rotate(1deg) brightness(100%) contrast(92%)
        drop-shadow(0 0 5px rgba(217, 180, 74, 0.6));
    }
    .settlement-laurel--r {
      transform: scaleX(-1);
    }
    .settlement-button {
      width: 168px;
      height: 150px;
      margin: 4px 8px;
      border-color: color-mix(in srgb, #d9b44a 60%, var(--hairline, #333));
      background-color: color-mix(in srgb, #d9b44a 12%, transparent);
      box-shadow:
        inset 0 0 0 1px color-mix(in srgb, #d9b44a 22%, transparent),
        0 0 18px color-mix(in srgb, #d9b44a 22%, transparent);
    }
    .settlement-button:not(:disabled):hover {
      border-color: #e7c65a;
      background-color: color-mix(in srgb, #d9b44a 22%, transparent);
      box-shadow: 0 0 22px color-mix(in srgb, #d9b44a 45%, transparent);
    }
    .settlement-button .build-name {
      color: #f0d488;
    }
    .settlement-divider {
      width: 78%;
      height: 1px;
      margin: 10px 0 4px;
      background: linear-gradient(
        90deg,
        transparent,
        color-mix(in srgb, #d9b44a 55%, transparent),
        transparent
      );
    }
    .build-row {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      width: 100%;
    }
    .build-button {
      position: relative;
      width: 120px;
      height: 140px;
      border: 1px solid var(--hairline, rgba(230, 235, 242, 0.1));
      background-color: color-mix(
        in srgb,
        var(--surface-2, #1a2230) 55%,
        transparent
      );
      color: var(--text, #e6ebf2);
      border-radius: var(--radius, 10px);
      cursor: pointer;
      transition:
        background-color var(--dur-micro, 120ms) var(--ease, ease),
        border-color var(--dur-micro, 120ms) var(--ease, ease),
        box-shadow var(--dur-micro, 120ms) var(--ease, ease),
        transform var(--dur-micro, 120ms) var(--ease, ease);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      margin: 8px;
      padding: 10px;
      gap: 5px;
    }
    .build-button:not(:disabled):hover {
      background-color: color-mix(
        in srgb,
        var(--surface-2, #1a2230) 85%,
        transparent
      );
      transform: translateY(-1px);
      border-color: var(--age-accent, #e8743b);
      box-shadow: 0 0 14px var(--age-glow, rgba(232, 116, 59, 0.3));
    }
    .build-button:not(:disabled):active {
      background-color: var(--surface-3, #232d3d);
      transform: scale(0.97);
    }
    .build-button:disabled {
      background-color: color-mix(
        in srgb,
        var(--surface-1, #11161f) 50%,
        transparent
      );
      border-color: var(--hairline, rgba(230, 235, 242, 0.1));
      cursor: not-allowed;
      opacity: 0.6;
    }
    .build-button:disabled img {
      opacity: 0.5;
    }
    .build-button:disabled .build-cost {
      color: var(--loss, #f87171);
    }
    .build-reason {
      display: block;
      margin-top: 2px;
      font-size: 11px;
      line-height: 1.2;
      font-weight: 700;
      color: var(--loss, #f87171);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    }
    .build-icon {
      font-size: 40px;
      margin-bottom: 5px;
    }
    .build-name {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 5px;
      text-align: center;
      font-family: var(--font-display, sans-serif);
      letter-spacing: 0.02em;
    }
    .build-cost {
      font-size: 14px;
      font-family: var(--font-mono, monospace);
      font-variant-numeric: tabular-nums;
      color: var(--faction-you, #e8a23b);
    }
    .hidden {
      display: none !important;
    }
    .build-count-chip {
      position: absolute;
      top: -10px;
      right: -10px;
      background-color: var(--surface-3, #232d3d);
      color: var(--text, #e6ebf2);
      padding: 2px 10px;
      border-radius: 10000px;
      transition:
        background-color var(--dur-micro, 120ms) var(--ease, ease),
        border-color var(--dur-micro, 120ms) var(--ease, ease);
      font-size: 12px;
      display: flex;
      justify-content: center;
      align-content: center;
      border: 1px solid var(--hairline-strong, rgba(230, 235, 242, 0.18));
    }
    .build-button:not(:disabled):hover > .build-count-chip {
      border-color: var(--age-accent, #e8743b);
    }
    .build-button:not(:disabled):active > .build-count-chip {
      background-color: var(--surface-2, #1a2230);
    }
    .build-button:disabled > .build-count-chip {
      background-color: var(--surface-1, #11161f);
      border-color: var(--hairline, rgba(230, 235, 242, 0.1));
      cursor: not-allowed;
    }
    .build-count {
      font-weight: 700;
      font-size: 14px;
      font-family: var(--font-mono, monospace);
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 768px) {
      .build-menu {
        padding: 10px;
        max-height: 80vh;
        width: 80vw;
      }
      .build-button {
        width: 140px;
        height: 120px;
        margin: 4px;
        padding: 6px;
        gap: 5px;
      }
      .build-icon {
        font-size: 28px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 3px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 10px;
      }
      .build-count-chip {
        padding: 1px 5px;
      }
    }

    @media (max-width: 480px) {
      .build-menu {
        padding: 8px;
        max-height: 70vh;
      }
      .build-button {
        width: calc(50% - 6px);
        height: 100px;
        margin: 3px;
        padding: 4px;
        border-width: 1px;
      }
      .build-icon {
        font-size: 24px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 2px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 10px;
      }
      .build-count-chip {
        padding: 0 3px;
      }
      .build-button img {
        width: 24px;
        height: 24px;
      }
      .build-cost img {
        width: 10px;
        height: 10px;
      }
    }
  `;

  @state()
  private _hidden = true;

  public canBuildOrUpgrade(item: BuildItemDisplay): boolean {
    if (this.game?.myPlayer() === null || this.playerBuildables === null) {
      return false;
    }
    const unit = this.playerBuildables.find((u) => u.type === item.unitType);
    return unit ? unit.canBuild !== false || unit.canUpgrade !== false : false;
  }

  // Era gate: an item belongs in the menu only when the player's current Age
  // falls within the unit's [minAge, maxAge] window. Out-of-era items are
  // OMITTED entirely (not greyed out) — Huts vanish past Primitive, and
  // Nukes/Airbase/Silo never appear to a Primitive tribe. This is distinct from
  // affordability: a unit that is merely too expensive right now stays visible.
  public isInEra(item: BuildItemDisplay): boolean {
    const player = this.game?.myPlayer();
    if (!player) {
      return false;
    }
    const info = this.game.unitInfo(item.unitType);
    const age = player.age();
    if (info.minAge !== undefined && age < info.minAge) {
      return false;
    }
    if (info.maxAge !== undefined && age > info.maxAge) {
      return false;
    }
    return true;
  }

  // Why a button is greyed, in the player's words. A disabled button with no
  // reason reads as broken (real-screen audit 2026-10-21: every item grey,
  // nothing said why). Touch has no hover, so this is rendered, not a tooltip.
  public disabledReason(buildableUnit: BuildableUnit): string {
    const player = this.game?.myPlayer();
    if (!player) return translateText("build_menu.reason_place");
    if (
      buildableUnit.type === UnitType.City &&
      player.age() === Age.Primitive
    ) {
      const cfg = this.game.config();
      const meltTick = Math.ceil(
        cfg.climateMeltTicks() * (1 - cfg.settlementMaxIceFraction()),
      );
      const left = meltTick - this.game.ticks();
      if (left > 0) {
        return translateText("build_menu.reason_ice", {
          seconds: String(Math.ceil(left / 10)),
        });
      }
    }
    const gold = player.gold();
    if (buildableUnit.cost > gold) {
      return translateText("build_menu.reason_gold", {
        gold: renderNumber(buildableUnit.cost - gold),
      });
    }
    const config = this.game.config();
    if (buildableUnit.type === UnitType.Hut) {
      const minDist = config.hutMinSpacing();
      const tooClose = player
        .units(UnitType.Hut)
        .some(
          (hut) =>
            this.game.euclideanDistSquared(hut.tile(), this.clickedTile) <
            minDist * minDist,
        );
      if (tooClose) return translateText("build_menu.reason_hut_spacing");
    }
    if (
      buildableUnit.type === UnitType.TradeOutpost &&
      player.units(UnitType.TradeOutpost).length >=
        config.tradeOutpostMaxCount()
    ) {
      return translateText("build_menu.reason_outpost_cap", {
        n: String(config.tradeOutpostMaxCount()),
      });
    }
    return translateText("build_menu.reason_place");
  }

  public cost(item: BuildItemDisplay): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item.unitType) {
        return bu.cost;
      }
    }
    return 0n;
  }

  public count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }

    return player.totalUnitLevels(item.unitType).toString();
  }

  public sendBuildOrUpgrade(buildableUnit: BuildableUnit, tile: TileRef): void {
    if (buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          buildableUnit.canUpgrade,
          buildableUnit.type,
        ),
      );
    } else if (buildableUnit.canBuild) {
      const rocketDirectionUp =
        buildableUnit.type === UnitType.AtomBomb ||
        buildableUnit.type === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      this.eventBus.emit(
        new BuildUnitIntentEvent(buildableUnit.type, tile, rocketDirectionUp),
      );
    }
    this.hideMenu();
  }

  // The permanent settlement gets its own laurel-framed pedestal at the top of
  // the menu — set apart from the routine buildings as the aspirational,
  // era-advancing goal (owner direction 2026-07-04).
  private renderFeaturedSettlement() {
    const item = settlementBuildItem;
    if (
      item === undefined ||
      !this.isInEra(item) ||
      this.game?.config()?.isUnitDisabled(item.unitType)
    ) {
      return html``;
    }
    const buildableUnit = this.playerBuildables?.find(
      (bu) => bu.type === item.unitType,
    );
    if (buildableUnit === undefined) {
      return html``;
    }
    const enabled =
      buildableUnit.canBuild !== false || buildableUnit.canUpgrade !== false;
    return html`
      <div class="settlement-feature">
        <img
          class="settlement-laurel"
          src=${laurelIcon}
          alt=""
          aria-hidden="true"
          width="34"
          height="34"
        />
        <button
          class="build-button settlement-button"
          @click=${() =>
            this.sendBuildOrUpgrade(buildableUnit, this.clickedTile)}
          ?disabled=${!enabled}
          title=${!enabled ? this.disabledReason(buildableUnit) : ""}
        >
          <img src=${item.icon} alt="${item.unitType}" width="44" height="44" />
          <span class="build-name">${item.key && translateText(item.key)}</span>
          <span class="build-description"
            >${item.description && translateText(item.description)}</span
          >
          <span class="build-cost" translate="no">
            ${renderNumber(
              this.game && this.game.myPlayer() ? this.cost(item) : 0,
            )}
            <img
              src=${goldCoinIcon}
              alt="gold"
              width="12"
              height="12"
              class="align-middle"
            />
          </span>
          ${!enabled
            ? html`<span class="build-reason"
                >${this.disabledReason(buildableUnit)}</span
              >`
            : ""}
          ${item.countable
            ? html`<div class="build-count-chip">
                <span class="build-count">${this.count(item)}</span>
              </div>`
            : ""}
        </button>
        <img
          class="settlement-laurel settlement-laurel--r"
          src=${laurelIcon}
          alt=""
          aria-hidden="true"
          width="34"
          height="34"
        />
      </div>
      <div class="settlement-divider" aria-hidden="true"></div>
    `;
  }

  render() {
    return html`
      <div
        class="build-menu ${this._hidden ? "hidden" : ""}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this.renderFeaturedSettlement()}
        ${this.filteredBuildTable.map(
          (row) => html`
            <div class="build-row">
              ${row.map((item) => {
                const buildableUnit = this.playerBuildables?.find(
                  (bu) => bu.type === item.unitType,
                );
                if (buildableUnit === undefined) {
                  return html``;
                }
                const enabled =
                  buildableUnit.canBuild !== false ||
                  buildableUnit.canUpgrade !== false;
                return html`
                  <button
                    class="build-button"
                    @click=${() =>
                      this.sendBuildOrUpgrade(buildableUnit, this.clickedTile)}
                    ?disabled=${!enabled}
                    title=${!enabled ? this.disabledReason(buildableUnit) : ""}
                  >
                    <img
                      src=${item.icon}
                      alt="${item.unitType}"
                      width="40"
                      height="40"
                    />
                    <span class="build-name"
                      >${item.key && translateText(item.key)}</span
                    >
                    <span class="build-description"
                      >${item.description &&
                      translateText(item.description)}</span
                    >
                    <span class="build-cost" translate="no">
                      ${renderNumber(
                        this.game && this.game.myPlayer() ? this.cost(item) : 0,
                      )}
                      <img
                        src=${goldCoinIcon}
                        alt="gold"
                        width="12"
                        height="12"
                        class="align-middle"
                      />
                    </span>
                    ${!enabled
                      ? html`<span class="build-reason"
                          >${this.disabledReason(buildableUnit)}</span
                        >`
                      : ""}
                    ${item.countable
                      ? html`<div class="build-count-chip">
                          <span class="build-count">${this.count(item)}</span>
                        </div>`
                      : ""}
                  </button>
                `;
              })}
            </div>
          `,
        )}
      </div>
    `;
  }

  hideMenu() {
    this._hidden = true;
    this.requestUpdate();
  }

  showMenu(clickedTile: TileRef) {
    this.clickedTile = clickedTile;
    this._hidden = false;
    this.refresh();
  }

  private refresh() {
    this.game
      .myPlayer()
      ?.buildables(this.clickedTile, BuildMenus.types)
      .then((buildables) => {
        this.playerBuildables = buildables;
        this.requestUpdate();
      });

    // remove disabled buildings from the buildtable
    this.filteredBuildTable = this.getBuildableUnits();
  }

  private getBuildableUnits(): BuildItemDisplay[][] {
    return buildTable.map((row) =>
      row.filter(
        (item) =>
          // The permanent settlement is featured on its own pedestal, never in
          // the routine grid (see renderFeaturedSettlement).
          item.unitType !== UnitType.City &&
          !this.game?.config()?.isUnitDisabled(item.unitType) &&
          // Era gate: hide (omit) anything outside the player's current era.
          this.isInEra(item),
      ),
    );
  }

  get isVisible() {
    return !this._hidden;
  }
}
