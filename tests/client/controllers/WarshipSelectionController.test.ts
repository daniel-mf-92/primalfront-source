import { WarshipSelectionController } from "../../../src/client/controllers/WarshipSelectionController";
import {
  ContextMenuEvent,
  MouseUpEvent,
  TouchEvent,
  UnitSelectionEvent,
} from "../../../src/client/InputHandler";

describe("WarshipSelectionController", () => {
  let game: any;
  let eventBus: any;
  let transformHandler: any;
  let view: any;
  let myPlayer: any;
  let owner: any;

  beforeEach(() => {
    myPlayer = {
      id: () => 1,
      isPlayer: () => true,
      isFriendly: vi.fn(() => false),
      territoryColor: () => ({
        lighten: () => ({ alpha: () => ({ toRgbString: () => "#fff" }) }),
      }),
    };
    owner = { isPlayer: () => false };
    game = {
      width: () => 100,
      height: () => 100,
      config: () => ({
        theme: () => ({
          territoryColor: () => ({
            lighten: () => ({ alpha: () => ({ toRgbString: () => "#fff" }) }),
          }),
        }),
      }),
      x: () => 10,
      y: () => 10,
      unitInfo: () => ({ maxHealth: 10, constructionDuration: 5 }),
      myPlayer: () => myPlayer,
      isValidCoord: () => true,
      ref: () => ({ id: 1 }),
      inSpawnPhase: () => false,
      isWater: () => false,
      owner: () => owner,
      units: () => [],
      manhattanDist: () => 100,
      ticks: () => 1,
      updatesSinceLastTick: () => undefined,
    };
    eventBus = { on: vi.fn(), emit: vi.fn() };
    transformHandler = {
      screenToWorldCoordinates: () => ({ x: 10, y: 10 }),
    };
    view = { setSelectedUnits: vi.fn() };
  });

  it("tracks the selected unit on single-unit selection (rendering is WebGL)", () => {
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    const unit = {
      id: () => 1,
      type: () => "Warship",
      isActive: () => true,
      tile: () => ({}),
      owner: () => ({}),
    };
    const event = { isSelected: true, unit };
    ui["onUnitSelection"](event as UnitSelectionEvent);
    // selectedUnit is held for game-logic callers (the click handlers). The
    // visual selection box is drawn by WebGL SelectionBoxPass — wired from
    // ClientGameRunner via view.setSelectedUnits([unit.id()]).
    expect(ui["selectedUnit"]).toBe(unit);
  });

  it("clears selection on deselect", () => {
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    const unit = {
      id: () => 1,
      type: () => "Warship",
      isActive: () => true,
      tile: () => ({}),
      owner: () => ({}),
    };
    ui["onUnitSelection"]({ isSelected: true, unit } as UnitSelectionEvent);
    ui["onUnitSelection"]({
      isSelected: false,
      unit: null,
    } as unknown as UnitSelectionEvent);
    expect(ui["selectedUnit"]).toBeNull();
  });

  it("tracks multi-selection list", () => {
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    const units = [
      { id: () => 1, isActive: () => true },
      { id: () => 2, isActive: () => true },
    ];
    ui["onUnitSelection"]({
      isSelected: true,
      unit: null,
      units,
    } as unknown as UnitSelectionEvent);
    expect(ui["multiSelectedWarships"]).toEqual(units);
    expect(ui["selectedUnit"]).toBeNull();
  });

  it("turns a touch on unowned land into the direct expand action", () => {
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );

    ui["onTouch"](new TouchEvent(20, 30));

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit.mock.calls[0][0]).toBeInstanceOf(MouseUpEvent);
  });

  it("turns a touch on hostile land into the direct attack action", () => {
    owner = { isPlayer: () => true };
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );

    ui["onTouch"](new TouchEvent(20, 30));

    expect(myPlayer.isFriendly).toHaveBeenCalledWith(owner);
    expect(eventBus.emit.mock.calls[0][0]).toBeInstanceOf(MouseUpEvent);
  });

  it("keeps the action menu for owned and friendly land", () => {
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );

    owner = myPlayer;
    ui["onTouch"](new TouchEvent(20, 30));
    expect(eventBus.emit.mock.calls[0][0]).toBeInstanceOf(ContextMenuEvent);

    eventBus.emit.mockClear();
    owner = { isPlayer: () => true };
    myPlayer.isFriendly.mockReturnValue(true);
    ui["onTouch"](new TouchEvent(20, 30));
    expect(eventBus.emit.mock.calls[0][0]).toBeInstanceOf(ContextMenuEvent);
  });
});
