import { describe, expect, it } from "vitest";
import {
  PRIMITIVE_TRIBE_CAMERA_ZOOM,
  TransformHandler,
} from "../../src/client/TransformHandler";
import { EventBus } from "../../src/core/EventBus";
import { Age } from "../../src/core/game/Game";
import {
  makeGameView,
  makeNameViewData,
  makePlayerView,
} from "../util/viewStubs";

function makeInputElement(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 600,
      }) as DOMRect,
  });
  return el;
}

describe("TransformHandler", () => {
  it("centers GoToPlayer on the spawn tile when name placement is not ready", () => {
    const game = makeGameView({ width: 100, height: 80 });
    const player = makePlayerView({
      game,
      data: { spawnTile: game.ref(23, 17), age: Age.Classical },
      nameData: makeNameViewData({ x: 0, y: 0, size: 0 }),
    });
    const handler = new TransformHandler(
      game,
      new EventBus(),
      makeInputElement(),
    );

    handler.onGoToPlayer({ player, zoom: 8 });

    expect((handler as any).target).toMatchObject({ x: 23, y: 17 });
    expect((handler as any).targetScale).toBe(8);
    (handler as any).clearTarget();
  });

  it("prefers a ready name placement over the spawn tile", () => {
    const game = makeGameView({ width: 100, height: 80 });
    const player = makePlayerView({
      game,
      data: { spawnTile: game.ref(23, 17), age: Age.Classical },
      nameData: makeNameViewData({ x: 44, y: 31, size: 12 }),
    });
    const handler = new TransformHandler(
      game,
      new EventBus(),
      makeInputElement(),
    );

    handler.onGoToPlayer({ player });

    expect((handler as any).target).toMatchObject({ x: 44, y: 31 });
    (handler as any).clearTarget();
  });

  it("zooms primitive GoToPlayer calls tightly to the tribe", () => {
    const game = makeGameView({ width: 100, height: 80 });
    const player = makePlayerView({
      game,
      data: { spawnTile: game.ref(23, 17), age: Age.Primitive },
      nameData: makeNameViewData({ x: 44, y: 31, size: 12 }),
    });
    const handler = new TransformHandler(
      game,
      new EventBus(),
      makeInputElement(),
    );

    handler.onGoToPlayer({ player, zoom: 8 });

    expect((handler as any).target).toMatchObject({ x: 44, y: 31 });
    expect((handler as any).targetScale).toBe(PRIMITIVE_TRIBE_CAMERA_ZOOM);
    (handler as any).clearTarget();
  });
});
