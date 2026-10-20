import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock howler before importing SoundManager
const howlCtor = vi.fn();
const howlInstances: any[] = [];
let nextPlayId = 1;
vi.mock("howler", () => {
  class MockHowl {
    play = vi.fn(() => nextPlayId++);
    rate = vi.fn();
    stop = vi.fn((id?: number) => {
      if (id !== undefined) {
        this._fireEvent("stop", id);
      }
    });
    volume = vi.fn();
    pause = vi.fn();
    fade = vi.fn();
    playing = vi.fn().mockReturnValue(false);
    unload = vi.fn();
    once = vi.fn((event: string, callback: () => void, id?: number) => {
      if (id !== undefined) {
        if (!this._listeners.has(event)) {
          this._listeners.set(event, new Map());
        }
        this._listeners.get(event)!.set(id, callback);
      }
    });
    _listeners: Map<string, Map<number, () => void>> = new Map();
    _fireEvent(event: string, id: number) {
      const cb = this._listeners.get(event)?.get(id);
      if (cb) {
        cb();
        this._listeners.get(event)?.delete(id);
      }
    }
    constructor(_opts: any) {
      howlCtor(_opts);
      howlInstances.push(this);
    }
  }
  return { Howl: MockHowl };
});

// Mock the Sounds module so tests don't depend on actual asset paths
vi.mock("../../../src/client/sound/Sounds", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/client/sound/Sounds")>();
  return {
    ...actual,
    soundEffectUrls: new Map([
      ["click", "mock/click.mp3"],
      ["atom-hit", "mock/atom-hit.mp3"],
      ["atom-launch", "mock/atom-launch.mp3"],
      ["hydrogen-hit", "mock/hydrogen-hit.mp3"],
      ["hydrogen-launch", "mock/hydrogen-launch.mp3"],
      ["mirv-launch", "mock/mirv-launch.mp3"],
      ["ka-ching", "mock/ka-ching.mp3"],
      ["message", "mock/message.mp3"],
      ["build-city", "mock/build-city.mp3"],
    ]),
  };
});

import {
  MAX_CONCURRENT_SOUNDS,
  MUSIC_DUCK_ATTACK_MS,
  MUSIC_DUCK_HOLD_MS,
  MUSIC_DUCK_LEVEL,
  MUSIC_DUCK_RELEASE_MS,
  SFX_PITCH_VARIATION,
  SoundManager,
} from "../../../src/client/sound/SoundManager";
import {
  PlaySoundEffectEvent,
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
} from "../../../src/client/sound/Sounds";
import { EventBus } from "../../../src/core/EventBus";
import { UserSettings } from "../../../src/core/game/UserSettings";

const createdSoundManagers: SoundManager[] = [];

function createSoundManager(
  eventBus: EventBus,
  userSettings: UserSettings,
): SoundManager {
  const manager = new SoundManager(eventBus, userSettings);
  createdSoundManagers.push(manager);
  return manager;
}

function createUserSettings(musicVolume = 0, sfxVolume = 1): UserSettings {
  const settings = new UserSettings();
  settings.setBackgroundMusicVolume(musicVolume);
  settings.setSoundEffectsVolume(sfxVolume);
  return settings;
}

afterEach(() => {
  for (const manager of createdSoundManagers.splice(0)) {
    manager.dispose();
  }
});

describe("SoundManager", () => {
  let eventBus: EventBus;
  let userSettings: UserSettings;
  let soundManager: SoundManager;

  beforeEach(() => {
    howlCtor.mockClear();
    howlInstances.length = 0;
    nextPlayId = 1;
    eventBus = new EventBus();
    userSettings = createUserSettings();
    soundManager = createSoundManager(eventBus, userSettings);
  });

  it("lazy-loads a sound effect once and reuses it", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
    eventBus.emit(new PlaySoundEffectEvent("click"));
    // Era music is lazy-loaded (none created at construct), so only the single
    // reused Click Howl is ever constructed.
    expect(howlCtor).toHaveBeenCalledTimes(1);
  });

  it("creates no music until an era is entered, then one track per era", () => {
    const settings = createUserSettings(0.6, 1);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    const sm = createSoundManager(bus, settings);
    expect(howlCtor).toHaveBeenCalledTimes(0);
    sm.updateEra(0); // Primitive
    expect(howlCtor).toHaveBeenCalledTimes(1);
    sm.updateEra(1); // Classical → new track + crossfade
    expect(howlCtor).toHaveBeenCalledTimes(2);
    sm.updateEra(1); // same era → no new track
    expect(howlCtor).toHaveBeenCalledTimes(2);
  });

  it("crossfades between ambient and conflict pools inside the same era", () => {
    const settings = createUserSettings(0.6, 1);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    const sm = createSoundManager(bus, settings);

    sm.updateEra(0, "ambient");
    const ambient = howlInstances[howlInstances.length - 1];
    ambient.playing.mockReturnValue(true);
    sm.updateEra(0, "conflict");
    const conflict = howlInstances[howlInstances.length - 1];

    expect(howlCtor).toHaveBeenCalledTimes(2);
    expect(conflict.fade).toHaveBeenCalled();
    expect(ambient.fade).toHaveBeenCalled();

    sm.updateEra(0, "conflict");
    expect(howlCtor).toHaveBeenCalledTimes(2);
  });

  it("defines ambient and conflict music for every era", () => {
    const settings = createUserSettings(0.6, 1);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    const sm = createSoundManager(bus, settings);

    for (let era = 0; era <= 7; era++) {
      sm.updateEra(era, "ambient");
      sm.updateEra(era, "conflict");
    }

    expect(howlCtor).toHaveBeenCalledTimes(16);
  });

  it("plays a sound effect when PlaySoundEffectEvent is emitted", () => {
    eventBus.emit(new PlaySoundEffectEvent("atom-hit"));
    const effectHowl = howlInstances[howlInstances.length - 1];
    expect(effectHowl.play).toHaveBeenCalledTimes(1);
  });

  it("applies organic pitch variation within ±SFX_PITCH_VARIATION to each effect", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
    const howl = howlInstances[howlInstances.length - 1];
    expect(howl.rate).toHaveBeenCalledTimes(1);
    const [rate, id] = howl.rate.mock.calls[0];
    expect(rate).toBeGreaterThanOrEqual(1 - SFX_PITCH_VARIATION);
    expect(rate).toBeLessThanOrEqual(1 + SFX_PITCH_VARIATION);
    // rate must target the specific play id, not the whole Howl.
    expect(id).toBe(1);
  });

  it("scales the jittered pitch by an explicit rate request", () => {
    eventBus.emit(new PlaySoundEffectEvent("click", 0.7));
    const howl = howlInstances[howlInstances.length - 1];
    const [rate] = howl.rate.mock.calls[0];
    expect(rate).toBeGreaterThanOrEqual(0.7 * (1 - SFX_PITCH_VARIATION) - 1e-9);
    expect(rate).toBeLessThanOrEqual(0.7 * (1 + SFX_PITCH_VARIATION) + 1e-9);
  });

  it("ducks background music under a heavy cue and restores it after the hold", () => {
    vi.useFakeTimers();
    try {
      const settings = createUserSettings(0.8, 1);
      const bus = new EventBus();
      howlInstances.length = 0;
      const sm = createSoundManager(bus, settings);
      sm.updateEra(0); // Primitive — creates + starts the music track
      const music = howlInstances[howlInstances.length - 1];
      music.fade.mockClear();

      bus.emit(new PlaySoundEffectEvent("atom-hit"));
      expect(music.fade).toHaveBeenCalledTimes(1);
      const [, duckTo, attackMs] = music.fade.mock.calls[0];
      expect(duckTo).toBeCloseTo(0.8 * MUSIC_DUCK_LEVEL, 10);
      expect(attackMs).toBe(MUSIC_DUCK_ATTACK_MS);

      vi.advanceTimersByTime(MUSIC_DUCK_HOLD_MS + 10);
      expect(music.fade).toHaveBeenCalledTimes(2);
      const [, restoreTo, releaseMs] = music.fade.mock.calls[1];
      expect(restoreTo).toBeCloseTo(0.8, 10);
      expect(releaseMs).toBe(MUSIC_DUCK_RELEASE_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not duck music for routine effects", () => {
    vi.useFakeTimers();
    try {
      const settings = createUserSettings(0.8, 1);
      const bus = new EventBus();
      howlInstances.length = 0;
      const sm = createSoundManager(bus, settings);
      sm.updateEra(0);
      const music = howlInstances[howlInstances.length - 1];
      music.fade.mockClear();

      bus.emit(new PlaySoundEffectEvent("click"));
      vi.advanceTimersByTime(MUSIC_DUCK_HOLD_MS * 2);
      expect(music.fade).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies bootstrap volume from UserSettings to background music", () => {
    const settings = createUserSettings(0.5, 1);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    const sm = createSoundManager(bus, settings);
    sm.updateEra(0); // entering an era lazily creates + starts its track
    const eraHowl = howlInstances[howlInstances.length - 1];
    expect(eraHowl.volume).toHaveBeenCalledWith(0.5);
  });

  it("does not load menu music while background music is muted", () => {
    soundManager.playMenuMusic();
    expect(howlCtor).toHaveBeenCalledTimes(0);

    eventBus.emit(new SetBackgroundMusicVolumeEvent(0.5));
    expect(howlCtor).toHaveBeenCalledTimes(1);
    const eraHowl = howlInstances[howlInstances.length - 1];
    expect(eraHowl.volume).toHaveBeenCalledWith(0.5);
  });

  it("responds to stored menu background music volume changes", () => {
    soundManager.playMenuMusic();
    expect(howlCtor).toHaveBeenCalledTimes(0);

    userSettings.setBackgroundMusicVolume(0.6);

    expect(howlCtor).toHaveBeenCalledTimes(1);
    const eraHowl = howlInstances[howlInstances.length - 1];
    expect(eraHowl.volume).toHaveBeenCalledWith(0.6);
  });

  it("applies current sfx volume to lazily-loaded sounds", () => {
    const settings = createUserSettings(0, 0.3);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    createSoundManager(bus, settings);
    bus.emit(new PlaySoundEffectEvent("click"));
    expect(howlCtor).toHaveBeenLastCalledWith(
      expect.objectContaining({ volume: 0.3 }),
    );
  });

  it("responds to SetBackgroundMusicVolumeEvent", () => {
    soundManager.playMenuMusic();
    expect(howlCtor).toHaveBeenCalledTimes(0);
    eventBus.emit(new SetBackgroundMusicVolumeEvent(0.7));
    const eraHowl = howlInstances[howlInstances.length - 1];
    eraHowl.volume.mockClear();
    eventBus.emit(new SetBackgroundMusicVolumeEvent(0.6));
    expect(eraHowl.volume).toHaveBeenCalledWith(0.6);
  });

  it("responds to SetBackgroundMusicVolumeEvent when already playing", () => {
    const settings = createUserSettings(0.5, 1);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    const sm = createSoundManager(bus, settings);
    sm.playMenuMusic();
    const eraHowl = howlInstances[howlInstances.length - 1];
    eraHowl.volume.mockClear();
    bus.emit(new SetBackgroundMusicVolumeEvent(0.7));
    expect(eraHowl.volume).toHaveBeenCalledWith(0.7);
  });

  it("responds to SetSoundEffectsVolumeEvent", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
    const clickHowl = howlInstances[howlInstances.length - 1];
    clickHowl.volume.mockClear();
    eventBus.emit(new SetSoundEffectsVolumeEvent(0.4));
    expect(clickHowl.volume).toHaveBeenCalledWith(0.4);
  });

  it("clamps volume values between 0 and 1", () => {
    soundManager.playMenuMusic();
    eventBus.emit(new SetBackgroundMusicVolumeEvent(2));
    const eraHowl = howlInstances[howlInstances.length - 1];
    expect(eraHowl.volume).toHaveBeenCalledWith(1);

    eraHowl.volume.mockClear();
    eventBus.emit(new SetBackgroundMusicVolumeEvent(-0.5));
    expect(eraHowl.volume).toHaveBeenCalledWith(0);
  });

  it("dispose() unsubscribes from EventBus so events no longer play sounds", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
    const clickHowl = howlInstances[howlInstances.length - 1];
    expect(clickHowl.play).toHaveBeenCalledTimes(1);

    soundManager.dispose();

    eventBus.emit(new PlaySoundEffectEvent("click"));
    expect(clickHowl.play).toHaveBeenCalledTimes(1);
  });

  it("dispose() stops and unloads all loaded sound effects", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
    const clickHowl = howlInstances[howlInstances.length - 1];

    soundManager.dispose();

    expect(clickHowl.stop).toHaveBeenCalled();
    expect(clickHowl.unload).toHaveBeenCalled();
  });

  it("dispose() stops and unloads background music", () => {
    eventBus.emit(new SetBackgroundMusicVolumeEvent(0.5));
    soundManager.playMenuMusic();
    const eraHowl = howlInstances[howlInstances.length - 1];

    soundManager.dispose();

    expect(eraHowl.stop).toHaveBeenCalled();
    expect(eraHowl.unload).toHaveBeenCalled();
  });

  it("does not throw when playSoundEffect is called directly", () => {
    expect(() => soundManager.playSoundEffect("click")).not.toThrow();
  });

  it("does not throw when playBackgroundMusic and stopBackgroundMusic are called", () => {
    expect(() => soundManager.playBackgroundMusic()).not.toThrow();
    expect(() => soundManager.stopBackgroundMusic()).not.toThrow();
  });

  it("swallows errors from Howler and does not propagate", () => {
    howlInstances.forEach((h) => {
      h.play.mockImplementation(() => {
        throw new Error("audio backend failure");
      });
      h.stop.mockImplementation(() => {
        throw new Error("audio backend failure");
      });
      h.volume.mockImplementation(() => {
        throw new Error("audio backend failure");
      });
    });
    eventBus.emit(new PlaySoundEffectEvent("click"));
    const clickHowl = howlInstances[howlInstances.length - 1];
    clickHowl.play.mockImplementation(() => {
      throw new Error("audio backend failure");
    });
    clickHowl.stop.mockImplementation(() => {
      throw new Error("audio backend failure");
    });
    clickHowl.volume.mockImplementation(() => {
      throw new Error("audio backend failure");
    });

    expect(() => soundManager.playBackgroundMusic()).not.toThrow();
    expect(() => soundManager.stopBackgroundMusic()).not.toThrow();
    expect(() => soundManager.setBackgroundMusicVolume(0.5)).not.toThrow();
    expect(() => soundManager.setSoundEffectsVolume(0.5)).not.toThrow();
    expect(() => soundManager.playSoundEffect("click")).not.toThrow();
    expect(() => soundManager.stopSoundEffect("click")).not.toThrow();
  });
});

describe("Sound channel management", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    howlCtor.mockClear();
    howlInstances.length = 0;
    nextPlayId = 1;
    eventBus = new EventBus();
    createSoundManager(eventBus, createUserSettings());
  });

  it("new sound always plays even when at channel cap", () => {
    for (let i = 0; i < MAX_CONCURRENT_SOUNDS; i++) {
      eventBus.emit(new PlaySoundEffectEvent("click"));
    }

    eventBus.emit(new PlaySoundEffectEvent("atom-hit"));
    const atomHowl = howlInstances[howlInstances.length - 1];
    expect(atomHowl.play).toHaveBeenCalled();
  });

  it("stops the oldest sound when at channel cap", () => {
    for (let i = 0; i < MAX_CONCURRENT_SOUNDS; i++) {
      eventBus.emit(new PlaySoundEffectEvent("click"));
    }
    const clickHowl = howlInstances[howlInstances.length - 1];

    // The first play had id=1. Playing one more should stop id=1.
    eventBus.emit(new PlaySoundEffectEvent("atom-hit"));
    expect(clickHowl.stop).toHaveBeenCalledWith(1);
  });

  it("frees a channel when a sound ends naturally", () => {
    for (let i = 0; i < MAX_CONCURRENT_SOUNDS; i++) {
      eventBus.emit(new PlaySoundEffectEvent("click"));
    }
    const clickHowl = howlInstances[howlInstances.length - 1];

    // Simulate first sound ending naturally
    clickHowl._fireEvent("end", 1);

    // Next sound should play without stopping anything
    clickHowl.stop.mockClear();
    eventBus.emit(new PlaySoundEffectEvent("click"));
    expect(clickHowl.stop).not.toHaveBeenCalled();
  });

  it("allows up to MAX_CONCURRENT_SOUNDS without stopping any", () => {
    for (let i = 0; i < MAX_CONCURRENT_SOUNDS; i++) {
      eventBus.emit(new PlaySoundEffectEvent("click"));
    }
    const clickHowl = howlInstances[howlInstances.length - 1];
    expect(clickHowl.play).toHaveBeenCalledTimes(8);
    // No stop calls with specific IDs (only general stop might be called)
    expect(clickHowl.stop).not.toHaveBeenCalled();
  });
});
