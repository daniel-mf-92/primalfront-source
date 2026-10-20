import { describe, expect, it } from "vitest";

import { JuiceController } from "../../../src/client/controllers/JuiceController";
import {
  ScreenFlashEvent,
  ScreenShakeEvent,
} from "../../../src/client/render/ScreenShake";
import { PlaySoundEffectEvent } from "../../../src/client/sound/Sounds";
import { EventBus } from "../../../src/core/EventBus";

interface GreatWork {
  targetAge: number;
  progress: number;
  required: number;
}

// A mutable local-player harness: tests drive state edges and observe the
// controller's emitted sound / flash / shake cues.
function makeHarness() {
  const eventBus = new EventBus();
  const sounds: { effect: string; rate?: number }[] = [];
  const flashes: { r: number; g: number; b: number; alpha: number }[] = [];
  const shakes: number[] = [];
  eventBus.on(PlaySoundEffectEvent, (e) =>
    sounds.push({ effect: e.effect, rate: e.rate }),
  );
  eventBus.on(ScreenFlashEvent, (e) =>
    flashes.push({ r: e.r, g: e.g, b: e.b, alpha: e.alpha }),
  );
  eventBus.on(ScreenShakeEvent, (e) => shakes.push(e.magnitude));

  const state = {
    goldenAge: false,
    age: 0,
    greatWork: null as GreatWork | null,
  };
  const me = {
    goldenAgeActive: () => state.goldenAge,
    age: () => state.age,
    greatWork: () => state.greatWork,
  };
  const game = { myPlayer: () => me };
  const controller = new JuiceController(game as any, eventBus);
  return { controller, state, sounds, flashes, shakes };
}

describe("JuiceController", () => {
  it("fires nothing on the baseline tick or on steady state", () => {
    const h = makeHarness();
    h.controller.tick();
    h.controller.tick();
    expect(h.sounds).toEqual([]);
    expect(h.flashes).toEqual([]);
    expect(h.shakes).toEqual([]);
  });

  it("plays the fanfare + gold wash exactly once on a Golden Age rising edge", () => {
    const h = makeHarness();
    h.controller.tick(); // baseline
    h.state.goldenAge = true;
    h.controller.tick();
    expect(h.sounds.map((s) => s.effect)).toEqual(["golden-age"]);
    expect(h.flashes).toHaveLength(1);
    // Gold-tinted wash, red-dominant channels.
    expect(h.flashes[0].r).toBeGreaterThan(h.flashes[0].b);
    h.controller.tick(); // still active — no repeat
    expect(h.sounds).toHaveLength(1);
  });

  it("does not fire when joining with a Golden Age already active", () => {
    const h = makeHarness();
    h.state.goldenAge = true;
    h.controller.tick(); // first observation IS the baseline
    expect(h.sounds).toEqual([]);
  });

  it("drums + a small jolt when my Great Work opens", () => {
    const h = makeHarness();
    h.controller.tick();
    h.state.greatWork = { targetAge: 1, progress: 0, required: 300 };
    h.controller.tick();
    expect(h.sounds.map((s) => s.effect)).toEqual(["great-work-started"]);
    expect(h.shakes).toHaveLength(1);
  });

  it("cracks + red sting when ritual progress is knocked backward", () => {
    const h = makeHarness();
    h.controller.tick();
    h.state.greatWork = { targetAge: 1, progress: 200, required: 300 };
    h.controller.tick();
    h.state.greatWork = { targetAge: 1, progress: 100, required: 300 };
    h.controller.tick();
    const effects = h.sounds.map((s) => s.effect);
    expect(effects).toEqual(["great-work-started", "great-work-setback"]);
    expect(h.sounds[1].rate).toBeUndefined();
    expect(h.flashes).toHaveLength(1);
    expect(h.shakes).toHaveLength(2);
  });

  it("washes gold (no crack) when the ritual completes into an age-up", () => {
    const h = makeHarness();
    h.controller.tick();
    h.state.greatWork = { targetAge: 1, progress: 299, required: 300 };
    h.controller.tick();
    h.state.greatWork = null;
    h.state.age = 1;
    h.controller.tick();
    const effects = h.sounds.map((s) => s.effect);
    expect(effects).toEqual(["great-work-started"]); // no setback cue
    expect(h.flashes).toHaveLength(1); // the era wash
  });

  it("plays the downpitched crack when the ritual collapses without an age-up", () => {
    const h = makeHarness();
    h.controller.tick();
    h.state.greatWork = { targetAge: 1, progress: 150, required: 300 };
    h.controller.tick();
    h.state.greatWork = null; // gate lost — age unchanged
    h.controller.tick();
    const last = h.sounds[h.sounds.length - 1];
    expect(last.effect).toBe("great-work-setback");
    expect(last.rate).toBeLessThan(1);
    expect(h.flashes).toHaveLength(1);
  });

  it("washes the era flash on a plain age rise (instant advance paths)", () => {
    const h = makeHarness();
    h.controller.tick();
    h.state.age = 1;
    h.controller.tick();
    expect(h.flashes).toHaveLength(1);
    expect(h.sounds).toEqual([]); // era SFX belongs to SoundEffectController
  });
});
