import { EventBus } from "../../core/EventBus";
import { UserSettings } from "../../core/game/UserSettings";
import { Controller } from "../Controller";
import { AttackingTroopsController } from "../controllers/AttackingTroopsController";
import { BuildPreviewController } from "../controllers/BuildPreviewController";
import { CameraDirectorController } from "../controllers/CameraDirectorController";
import { CameraShakeController } from "../controllers/CameraShakeController";
import { HarvestController } from "../controllers/HarvestController";
import { HoverHighlightController } from "../controllers/HoverHighlightController";
import { JuiceController } from "../controllers/JuiceController";
import { MapDirectorController } from "../controllers/MapDirectorController";
import { SoundEffectController } from "../controllers/SoundEffectController";
import { StructureHighlightController } from "../controllers/StructureHighlightController";
import { ViewModeController } from "../controllers/ViewModeController";
import { WarshipSelectionController } from "../controllers/WarshipSelectionController";
import { GameStartingModal } from "../GameStartingModal";
import { MapRenderer } from "../render/gl";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { GameView } from "../view";
import { FrameProfiler } from "./FrameProfiler";
import { ActionableEvents } from "./layers/ActionableEvents";
import { AlertFrame } from "./layers/AlertFrame";
import { AttacksDisplay } from "./layers/AttacksDisplay";
import { BuildMenu } from "./layers/BuildMenu";
import { ChatDisplay } from "./layers/ChatDisplay";
import { ChatModal } from "./layers/ChatModal";
import { ControlPanel } from "./layers/ControlPanel";
import { EmojiTable } from "./layers/EmojiTable";
import { EventsDisplay } from "./layers/EventsDisplay";
import { GameLeftSidebar } from "./layers/GameLeftSidebar";
import { GameRightSidebar } from "./layers/GameRightSidebar";
import { GraphicsSettingsModal } from "./layers/GraphicsSettingsModal";
import { GuideBeacon } from "./layers/GuideBeacon";
import { HeadsUpMessage } from "./layers/HeadsUpMessage";
import { ImmunityTimer } from "./layers/ImmunityTimer";
import { InGamePromo } from "./layers/InGamePromo";
import { LandWatch } from "./layers/LandWatch";
import { Leaderboard } from "./layers/Leaderboard";
import { MainRadialMenu } from "./layers/MainRadialMenu";
import { MultiTabModal } from "./layers/MultiTabModal";
import { PerformanceOverlay } from "./layers/PerformanceOverlay";
import { PlayerInfoOverlay } from "./layers/PlayerInfoOverlay";
import { PlayerPanel } from "./layers/PlayerPanel";
import { ReplayPanel } from "./layers/ReplayPanel";
import { SettingsModal } from "./layers/SettingsModal";
import { SpawnTimer } from "./layers/SpawnTimer";
import { TeamStats } from "./layers/TeamStats";
import { UnitDisplay } from "./layers/UnitDisplay";
import { WinModal } from "./layers/WinModal";
import { loadAllSprites } from "./SpriteLoader";

export function createRenderer(
  inputEl: HTMLElement,
  game: GameView,
  eventBus: EventBus,
  playerRole: string | null,
  view: MapRenderer,
): GameRenderer {
  const transformHandler = new TransformHandler(game, eventBus, inputEl);
  const userSettings = new UserSettings();

  const uiState: UIState = {
    attackRatio: 20,
    ghostStructure: null,
    rocketDirectionUp: true,
  };

  //hide when the game renders
  const startingModal = document.querySelector(
    "game-starting-modal",
  ) as GameStartingModal;
  startingModal.hide();

  // TODO maybe append this to document instead of querying for them?
  const emojiTable = document.querySelector("emoji-table") as EmojiTable;
  if (!emojiTable || !(emojiTable instanceof EmojiTable)) {
    console.error("EmojiTable element not found in the DOM");
  }
  emojiTable.transformHandler = transformHandler;
  emojiTable.game = game;
  emojiTable.initEventBus(eventBus);

  const buildMenu = document.querySelector("build-menu") as BuildMenu;
  if (!buildMenu || !(buildMenu instanceof BuildMenu)) {
    console.error("BuildMenu element not found in the DOM");
  }
  buildMenu.game = game;
  buildMenu.eventBus = eventBus;
  buildMenu.uiState = uiState;
  buildMenu.transformHandler = transformHandler;

  const leaderboard = document.querySelector("leader-board") as Leaderboard;
  if (!leaderboard || !(leaderboard instanceof Leaderboard)) {
    console.error("LeaderBoard element not found in the DOM");
  }
  leaderboard.eventBus = eventBus;
  leaderboard.game = game;

  const gameLeftSidebar = document.querySelector(
    "game-left-sidebar",
  ) as GameLeftSidebar;
  if (!gameLeftSidebar || !(gameLeftSidebar instanceof GameLeftSidebar)) {
    console.error("GameLeftSidebar element not found in the DOM");
  }
  gameLeftSidebar.game = game;
  gameLeftSidebar.eventBus = eventBus;

  const teamStats = document.querySelector("team-stats") as TeamStats;
  if (!teamStats || !(teamStats instanceof TeamStats)) {
    console.error("TeamStats element not found in the DOM");
  }
  teamStats.eventBus = eventBus;
  teamStats.game = game;

  const controlPanel = document.querySelector("control-panel") as ControlPanel;
  if (!(controlPanel instanceof ControlPanel)) {
    console.error("ControlPanel element not found in the DOM");
  }
  controlPanel.eventBus = eventBus;
  controlPanel.uiState = uiState;
  controlPanel.game = game;

  const eventsDisplay = document.querySelector(
    "events-display",
  ) as EventsDisplay;
  if (!(eventsDisplay instanceof EventsDisplay)) {
    console.error("events display not found");
  }
  eventsDisplay.eventBus = eventBus;
  eventsDisplay.game = game;
  eventsDisplay.uiState = uiState;

  const actionableEvents = document.querySelector(
    "actionable-events",
  ) as ActionableEvents;
  if (!(actionableEvents instanceof ActionableEvents)) {
    console.error("actionable events not found");
  }
  actionableEvents.eventBus = eventBus;
  actionableEvents.game = game;
  actionableEvents.uiState = uiState;

  const attacksDisplay = document.querySelector(
    "attacks-display",
  ) as AttacksDisplay;
  if (!(attacksDisplay instanceof AttacksDisplay)) {
    console.error("attacks display not found");
  }
  attacksDisplay.eventBus = eventBus;
  attacksDisplay.game = game;
  attacksDisplay.uiState = uiState;

  const chatDisplay = document.querySelector("chat-display") as ChatDisplay;
  if (!(chatDisplay instanceof ChatDisplay)) {
    console.error("chat display not found");
  }
  chatDisplay.eventBus = eventBus;
  chatDisplay.game = game;

  const playerInfo = document.querySelector(
    "player-info-overlay",
  ) as PlayerInfoOverlay;
  if (!(playerInfo instanceof PlayerInfoOverlay)) {
    console.error("player info overlay not found");
  }
  playerInfo.eventBus = eventBus;
  playerInfo.transform = transformHandler;
  playerInfo.game = game;

  const winModal = document.querySelector("win-modal") as WinModal;
  if (!(winModal instanceof WinModal)) {
    console.error("win modal not found");
  }
  winModal.eventBus = eventBus;
  winModal.game = game;

  const replayPanel = document.querySelector("replay-panel") as ReplayPanel;
  if (!(replayPanel instanceof ReplayPanel)) {
    console.error("replay panel not found");
  }
  replayPanel.eventBus = eventBus;
  replayPanel.game = game;

  const gameRightSidebar = document.querySelector(
    "game-right-sidebar",
  ) as GameRightSidebar;
  if (!(gameRightSidebar instanceof GameRightSidebar)) {
    console.error("Game Right bar not found");
  }
  gameRightSidebar.game = game;
  gameRightSidebar.eventBus = eventBus;

  const settingsModal = document.querySelector(
    "settings-modal",
  ) as SettingsModal;
  if (!(settingsModal instanceof SettingsModal)) {
    console.error("settings modal not found");
  }
  settingsModal.userSettings = userSettings;
  settingsModal.eventBus = eventBus;

  const graphicsSettingsModal = document.querySelector(
    "graphics-settings-modal",
  ) as GraphicsSettingsModal;
  if (!(graphicsSettingsModal instanceof GraphicsSettingsModal)) {
    console.error("graphics settings modal not found");
  }
  graphicsSettingsModal.userSettings = userSettings;
  graphicsSettingsModal.eventBus = eventBus;

  const unitDisplay = document.querySelector("unit-display") as UnitDisplay;
  if (!(unitDisplay instanceof UnitDisplay)) {
    console.error("unit display not found");
  }
  unitDisplay.game = game;
  unitDisplay.eventBus = eventBus;
  unitDisplay.uiState = uiState;

  const playerPanel = document.querySelector("player-panel") as PlayerPanel;
  if (!(playerPanel instanceof PlayerPanel)) {
    console.error("player panel not found");
  }
  playerPanel.g = game;
  playerPanel.initEventBus(eventBus);
  playerPanel.emojiTable = emojiTable;
  playerPanel.uiState = uiState;

  playerPanel.setRole(playerRole);

  const chatModal = document.querySelector("chat-modal") as ChatModal;
  if (!(chatModal instanceof ChatModal)) {
    console.error("chat modal not found");
  }
  chatModal.g = game;
  chatModal.initEventBus(eventBus);

  const multiTabModal = document.querySelector(
    "multi-tab-modal",
  ) as MultiTabModal;
  if (!(multiTabModal instanceof MultiTabModal)) {
    console.error("multi-tab modal not found");
  }
  multiTabModal.game = game;

  const headsUpMessage = document.querySelector(
    "heads-up-message",
  ) as HeadsUpMessage;
  if (!(headsUpMessage instanceof HeadsUpMessage)) {
    console.error("heads-up message not found");
  }
  headsUpMessage.game = game;
  headsUpMessage.eventBus = eventBus;

  const guideBeacon = document.querySelector("guide-beacon") as GuideBeacon;
  if (!(guideBeacon instanceof GuideBeacon)) {
    console.error("guide beacon not found");
  }
  guideBeacon.game = game;
  guideBeacon.eventBus = eventBus;
  guideBeacon.transformHandler = transformHandler;

  const landWatch = document.querySelector("land-watch") as LandWatch;
  if (!(landWatch instanceof LandWatch)) {
    console.error("land watch not found");
  }
  landWatch.game = game;
  landWatch.eventBus = eventBus;

  const performanceOverlay = document.querySelector(
    "performance-overlay",
  ) as PerformanceOverlay;
  if (!(performanceOverlay instanceof PerformanceOverlay)) {
    console.error("performance overlay not found");
  }
  performanceOverlay.eventBus = eventBus;
  performanceOverlay.userSettings = userSettings;

  const alertFrame = document.querySelector("alert-frame") as AlertFrame;
  if (!(alertFrame instanceof AlertFrame)) {
    console.error("alert frame not found");
  }
  alertFrame.game = game;
  alertFrame.eventBus = eventBus;

  const spawnTimer = document.querySelector("spawn-timer") as SpawnTimer;
  if (!(spawnTimer instanceof SpawnTimer)) {
    console.error("spawn timer not found");
  }
  spawnTimer.game = game;
  spawnTimer.eventBus = eventBus;
  spawnTimer.transformHandler = transformHandler;

  const immunityTimer = document.querySelector(
    "immunity-timer",
  ) as ImmunityTimer;
  if (!(immunityTimer instanceof ImmunityTimer)) {
    console.error("immunity timer not found");
  }
  immunityTimer.game = game;
  immunityTimer.eventBus = eventBus;

  const inGamePromo = document.querySelector("in-game-promo") as InGamePromo;
  if (!(inGamePromo instanceof InGamePromo)) {
    console.error("in-game promo not found");
  }
  inGamePromo.game = game;

  const layers: Controller[] = [
    new WarshipSelectionController(game, eventBus, transformHandler, view),
    new BuildPreviewController(
      game,
      eventBus,
      uiState,
      transformHandler,
      view,
      userSettings,
    ),
    new HoverHighlightController(game, eventBus, transformHandler, view),
    new HarvestController(game, eventBus, uiState, transformHandler),
    new MapDirectorController(game, view),
    new StructureHighlightController(eventBus, view),
    new ViewModeController(eventBus, view),
    new AttackingTroopsController(game, eventBus, userSettings, view),
    new SoundEffectController(game, eventBus),
    new CameraShakeController(game, eventBus),
    new JuiceController(game, eventBus),
    new CameraDirectorController(eventBus, game, transformHandler),
    eventsDisplay,
    actionableEvents,
    attacksDisplay,
    chatDisplay,
    buildMenu,
    new MainRadialMenu(
      eventBus,
      game,
      transformHandler,
      emojiTable as EmojiTable,
      buildMenu,
      uiState,
      playerPanel,
    ),
    spawnTimer,
    immunityTimer,
    leaderboard,
    gameLeftSidebar,
    unitDisplay,
    gameRightSidebar,
    controlPanel,
    playerInfo,
    winModal,
    replayPanel,
    settingsModal,
    graphicsSettingsModal,
    teamStats,
    playerPanel,
    headsUpMessage,
    guideBeacon,
    landWatch,
    multiTabModal,
    inGamePromo,
    alertFrame,
    performanceOverlay,
  ];

  return new GameRenderer(
    transformHandler,
    uiState,
    layers,
    performanceOverlay,
    game,
  );
}

/** Zoom multiple over "whole map fits" for the spawn view (see initialize). */
export const SPAWN_MAX_COVER = 1.8;

export function spawnFit(
  viewport: { width: number; height: number },
  mapWidth: number,
  mapHeight: number,
): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  const hor = viewport.width / mapWidth;
  const ver = viewport.height / mapHeight;
  const cover = Math.max(hor, ver) / Math.min(hor, ver);
  return Math.min(cover, SPAWN_MAX_COVER);
}

export class GameRenderer {
  private layerTickState = new Map<Controller, { lastTickAtMs: number }>();

  constructor(
    public transformHandler: TransformHandler,
    public uiState: UIState,
    private layers: Controller[],
    private performanceOverlay: PerformanceOverlay,
    private game: GameView,
  ) {}

  initialize() {
    loadAllSprites().catch((err) =>
      console.error("Failed to preload sprites:", err),
    );

    this.layers.forEach((l) => l.init?.());

    window.addEventListener("resize", () =>
      this.transformHandler.updateCanvasBoundingRect(),
    );

    // Spawn view: fill the screen with the map. "Contain at 90%" left the
    // world as a speck on a black frame (audit 2026-10-22); "cover" fills a
    // desktop screen edge to edge. A tall phone would lose most of a wide map
    // to cover, so the zoom past "contain" is capped there.
    this.transformHandler.centerAll(
      spawnFit(
        this.transformHandler.boundingRect(),
        this.game.width(),
        this.game.height(),
      ),
    );
  }

  tick() {
    const nowMs = performance.now();
    const shouldProfileTick = FrameProfiler.isEnabled();

    const tickLayerDurations: Record<string, number> = {};

    for (const layer of this.layers) {
      if (!layer.tick) {
        continue;
      }

      const state = this.layerTickState.get(layer) ?? {
        lastTickAtMs: -Infinity,
      };

      const intervalMs = layer.getTickIntervalMs?.() ?? 0;
      if (intervalMs > 0 && nowMs - state.lastTickAtMs < intervalMs) {
        this.layerTickState.set(layer, state);
        continue;
      }

      state.lastTickAtMs = nowMs;
      this.layerTickState.set(layer, state);

      const tickStart = shouldProfileTick ? performance.now() : 0;
      layer.tick();
      if (shouldProfileTick && tickStart !== 0) {
        const duration = performance.now() - tickStart;
        const label = layer.constructor?.name ?? "UnknownLayer";
        tickLayerDurations[label] = (tickLayerDurations[label] ?? 0) + duration;
      }
    }

    if (shouldProfileTick) {
      this.performanceOverlay.updateTickLayerMetrics(tickLayerDurations);
    }
  }
}
