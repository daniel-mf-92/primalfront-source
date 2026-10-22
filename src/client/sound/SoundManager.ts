import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import { Age } from "../../core/game/Game";
import {
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import {
  MusicSuspendEvent,
  PlaySoundEffectEvent,
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
  SoundEffect,
  soundEffectUrls,
} from "./Sounds";

export const MAX_CONCURRENT_SOUNDS = 8;

// ±6% random pitch on every one-shot effect so rapid/repeated SFX never sound
// mechanically identical (game-feel). Client presentation only — uses
// Math.random(), which is fine here and never touches the lockstep sim.
export const SFX_PITCH_VARIATION = 0.06;

// "Heavy" cues briefly duck the background music so the moment lands with
// full weight — the classic sidechain trick. Attack fast, release slow.
export const HEAVY_SFX: ReadonlySet<SoundEffect> = new Set<SoundEffect>([
  "atom-hit",
  "hydrogen-hit",
  "era-advance",
  "golden-age",
]);
export const MUSIC_DUCK_LEVEL = 0.35;
export const MUSIC_DUCK_ATTACK_MS = 120;
export const MUSIC_DUCK_HOLD_MS = 1600;
export const MUSIC_DUCK_RELEASE_MS = 900;

// Per-era adaptive music. Every era has a broad ambient pool and a smaller
// conflict pool. We horizontally re-sequence between them when combat starts or
// ends; no stems are required and every transition still uses the same lazy
// loading/crossfade path.
// AI-NOTE: MOST tracks here are Kevin MacLeod / incompetech.com under CC BY 4.0 —
// their attribution is REQUIRED and lives in the in-game Credits + CREDITS.md.
// The Primitive (tribal) era ALSO includes CC0 / public-domain / Pixabay tracks
// that need no attribution. Per-track licence is in CREDITS.md — check it there
// before assuming a given file is CC-BY. | expires: never (mixed-licence catalog).
const music = (...names: string[]): string[] =>
  names.map((n) => `sounds/music/${n}.mp3`);

export type EraMusicMood = "ambient" | "conflict";

interface EraMusicPools {
  ambient: string[];
  conflict: string[];
}

const ERA_PLAYLISTS: Record<number, EraMusicPools> = {
  [Age.Primitive]: {
    ambient: music(
      "primitive8",
      "primitive9",
      "primitive10",
      "primitive18",
      "primitive15",
      "primitive16",
      "primitive17",
      "primitive",
      "primitive2",
      "primitive3",
      "primitive7",
      "primitive4",
      "primitive6",
      "primitive5",
    ),
    conflict: music(
      "primitive11",
      "primitive13",
      "primitive12",
      "primitive14",
      "primitive19",
    ),
  },
  [Age.Classical]: {
    ambient: music("classical4", "classical3", "classical6", "classical7"),
    conflict: music("classical", "classical5", "classical2"),
  },
  [Age.Imperial]: {
    ambient: music("imperial7", "imperial", "imperial2", "imperial6"),
    conflict: music("imperial4", "imperial5", "imperial3"),
  },
  [Age.Feudal]: {
    ambient: music("feudal", "feudal2", "feudal5", "feudal4", "feudal7"),
    conflict: music("feudal3", "feudal6"),
  },
  [Age.Enlightened]: {
    ambient: music(
      "enlightened3",
      "enlightened",
      "enlightened2",
      "enlightened7",
      "enlightened6",
    ),
    conflict: music("enlightened5", "enlightened4"),
  },
  [Age.Industrial]: {
    ambient: music("industrial2", "industrial5", "industrial7"),
    conflict: music(
      "industrial",
      "industrial3",
      "industrial4",
      "industrial6",
      "industrial8",
    ),
  },
  [Age.Modern]: {
    ambient: music("modern2", "modern5", "modern6", "modern3"),
    conflict: music("modern8", "modern9", "modern7", "modern", "modern4"),
  },
  [Age.Alien]: {
    ambient: music("alien2", "alien", "alien4", "alien5"),
    conflict: music("alien3", "alien6", "alien7"),
  },
};
const MUSIC_CROSSFADE_MS = 1800;

export class SoundManager {
  // Track Howls are cached by file URL and lazy-loaded on first play, so we only
  // ever fetch the track that is actually playing — never the whole ~MBs catalog.
  private trackHowls: Map<string, Howl> = new Map();
  // Position of the currently-playing track within the current era's playlist
  // (which plays in fixed authored order and loops).
  private orderPos: number = 0;
  private currentEra: number | null = null;
  private currentMood: EraMusicMood = "ambient";
  private currentMusicHowl: Howl | null = null;
  // Bumped on every track start; stale "end" handlers compare against it so a
  // superseded track (era change / skip) can never advance the playlist.
  private playGeneration: number = 0;
  private soundEffects: Map<SoundEffect, Howl> = new Map();
  private soundEffectsVolume: number = 1;
  private backgroundMusicVolume: number = 0;
  private activeSounds: { howl: Howl; id: number }[] = [];
  private duckRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private eventBus: EventBus;
  private onPlaySoundEffect: (e: PlaySoundEffectEvent) => void;
  private onSetBackgroundMusicVolume: (
    e: SetBackgroundMusicVolumeEvent,
  ) => void;
  private onSetSoundEffectsVolume: (e: SetSoundEffectsVolumeEvent) => void;
  private onMusicSuspend: (e: MusicSuspendEvent) => void;
  // While true no music starts and no effect plays: the match is over (result
  // screen) or was just left. Cleared by resumeMusic() / playLoadingMusic().
  private suspended = false;
  private onStoredBackgroundMusicVolume: (e: Event) => void;
  private onStoredSoundEffectsVolume: (e: Event) => void;

  constructor(eventBus: EventBus, userSettings: UserSettings) {
    this.eventBus = eventBus;
    // Era tracks load on demand via updateEra(); nothing to preload here.
    this.setBackgroundMusicVolume(userSettings.backgroundMusicVolume());
    this.setSoundEffectsVolume(userSettings.soundEffectsVolume());
    this.onPlaySoundEffect = (e) => this.playSoundEffect(e.effect, e.rate);
    this.onSetBackgroundMusicVolume = (e) =>
      this.setBackgroundMusicVolume(e.volume);
    this.onSetSoundEffectsVolume = (e) => this.setSoundEffectsVolume(e.volume);
    this.onStoredBackgroundMusicVolume = (e: Event) => {
      const volume = parseFloat(String((e as CustomEvent<string>).detail));
      if (Number.isFinite(volume)) this.setBackgroundMusicVolume(volume);
    };
    this.onStoredSoundEffectsVolume = (e: Event) => {
      const volume = parseFloat(String((e as CustomEvent<string>).detail));
      if (Number.isFinite(volume)) this.setSoundEffectsVolume(volume);
    };
    this.onMusicSuspend = (e) =>
      e.suspended ? this.suspendMusic() : this.resumeMusic();
    eventBus.on(PlaySoundEffectEvent, this.onPlaySoundEffect);
    eventBus.on(MusicSuspendEvent, this.onMusicSuspend);
    eventBus.on(SetBackgroundMusicVolumeEvent, this.onSetBackgroundMusicVolume);
    eventBus.on(SetSoundEffectsVolumeEvent, this.onSetSoundEffectsVolume);
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.backgroundMusicVolume`,
      this.onStoredBackgroundMusicVolume,
    );
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.soundEffectsVolume`,
      this.onStoredSoundEffectsVolume,
    );
  }

  public dispose(): void {
    if (this.duckRestoreTimer !== null) {
      clearTimeout(this.duckRestoreTimer);
      this.duckRestoreTimer = null;
    }
    this.eventBus.off(PlaySoundEffectEvent, this.onPlaySoundEffect);
    this.eventBus.off(MusicSuspendEvent, this.onMusicSuspend);
    this.eventBus.off(
      SetBackgroundMusicVolumeEvent,
      this.onSetBackgroundMusicVolume,
    );
    this.eventBus.off(SetSoundEffectsVolumeEvent, this.onSetSoundEffectsVolume);
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.backgroundMusicVolume`,
      this.onStoredBackgroundMusicVolume,
    );
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.soundEffectsVolume`,
      this.onStoredSoundEffectsVolume,
    );
    this.trackHowls.forEach((track) => {
      this.safely("stop background track", () => track.stop());
      this.safely("unload background track", () => track.unload());
    });
    this.trackHowls.clear();
    this.currentMusicHowl = null;
    this.currentEra = null;
    this.currentMood = "ambient";
    this.soundEffects.forEach((sound) => {
      this.safely("stop sound effect", () => sound.stop());
      this.safely("unload sound effect", () => sound.unload());
    });
    this.soundEffects.clear();
    this.activeSounds = [];
  }

  private safely(action: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`SoundManager: failed to ${action}`, err);
    }
  }

  /** Begin (or resume) Primitive music for non-game menu and loading screens. */
  public playMenuMusic(): void {
    this.enterEra(Age.Primitive, "ambient", true);
  }

  /** Crossfade back to Primitive music while the client waits for a game. */
  public playLoadingMusic(): void {
    // Joining a game is the player asking for sound again.
    this.suspended = false;
    this.enterEra(Age.Primitive, "ambient", false);
  }

  /** Fade the music out and stop every effect until resumeMusic(). */
  public suspendMusic(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.stopAllSoundEffects();
    const howl = this.currentMusicHowl;
    this.currentMusicHowl = null;
    this.playGeneration++;
    if (!howl) return;
    this.safely("fade out music", () => {
      if (!howl.playing()) {
        howl.stop();
        return;
      }
      howl.fade(howl.volume(), 0, 600);
      howl.once("fade", () => this.safely("stop music", () => howl.stop()));
    });
  }

  /** Undo suspendMusic(): bring the current era's music back. */
  public resumeMusic(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.playBackgroundMusic();
  }

  public isSuspended(): boolean {
    return this.suspended;
  }

  /** Begin (or resume) era music for the current/last-known era. */
  public playBackgroundMusic(): void {
    this.enterEra(this.currentEra ?? Age.Primitive, this.currentMood, true);
  }

  public stopBackgroundMusic(): void {
    this.safely("stop background music", () => {
      this.currentMusicHowl?.stop();
    });
  }

  /**
   * Drive the soundtrack from the local player's Age. Called every game tick;
   * crossfades to the new era's playlist only when the era actually changes.
   */
  public updateEra(era: number, mood: EraMusicMood = "ambient"): void {
    if (era === this.currentEra && mood === this.currentMood) return;
    this.enterEra(era, mood, false);
  }

  public setBackgroundMusicVolume(volume: number): void {
    this.backgroundMusicVolume = Math.max(0, Math.min(1, volume));
    this.safely("set background music volume", () => {
      const howl = this.currentMusicHowl;
      if (!howl) {
        if (this.backgroundMusicVolume > 0 && this.currentEra !== null) {
          this.enterEra(this.currentEra, this.currentMood, true);
        }
        return;
      }
      howl.volume(this.backgroundMusicVolume);
      if (this.backgroundMusicVolume > 0 && !howl.playing()) {
        howl.play();
      } else if (this.backgroundMusicVolume <= 0) {
        howl.pause();
      }
    });
  }

  private getTrackHowl(url: string): Howl | null {
    const existing = this.trackHowls.get(url);
    if (existing) return existing;
    let howl: Howl | null = null;
    this.safely(`load music ${url}`, () => {
      // html5 streaming keeps the multi-MB track out of the Web Audio buffer.
      // loop:false — we advance to the next playlist track on "end".
      howl = new Howl({
        src: [assetUrl(url)],
        loop: false,
        volume: 0,
        html5: true,
      });
      this.trackHowls.set(url, howl);
    });
    return howl;
  }

  private playlistFor(era: number, mood: EraMusicMood): string[] {
    const pools = ERA_PLAYLISTS[era];
    if (!pools) return [];
    const requested = pools[mood];
    return requested.length > 0 ? requested : pools.ambient;
  }

  /** Enter an era/mood: start its authored pool from the top. */
  private enterEra(era: number, mood: EraMusicMood, immediate: boolean): void {
    if (this.suspended) {
      // Remember where the soundtrack should resume, play nothing now.
      this.currentEra = era;
      this.currentMood = mood;
      return;
    }
    this.safely(`enter era ${era} music`, () => {
      const playlist = this.playlistFor(era, mood);
      if (!playlist || playlist.length === 0) {
        // No music defined for this era (e.g. a new age before its playlist
        // ships) — remember it so a later track can still resume cleanly.
        this.currentEra = era;
        this.currentMood = mood;
        return;
      }
      if (
        era === this.currentEra &&
        mood === this.currentMood &&
        this.currentMusicHowl
      ) {
        // Same era, already have a track — just resume, don't restart.
        if (
          this.backgroundMusicVolume > 0 &&
          !this.currentMusicHowl.playing()
        ) {
          this.currentMusicHowl.volume(this.backgroundMusicVolume);
          this.currentMusicHowl.play();
        }
        return;
      }
      this.orderPos = 0;
      this.currentEra = era;
      this.currentMood = mood;
      this.playTrackAt(era, mood, 0, immediate);
    });
  }

  /** Play the track at `pos` in an era/mood pool, crossfading from prev. */
  private playTrackAt(
    era: number,
    mood: EraMusicMood,
    pos: number,
    immediate: boolean,
  ): void {
    const playlist = this.playlistFor(era, mood);
    if (!playlist || playlist.length === 0) return;
    this.orderPos =
      ((pos % playlist.length) + playlist.length) % playlist.length;
    const prev = this.currentMusicHowl;
    if (this.backgroundMusicVolume <= 0) {
      // Keep the requested era/position, but do not fetch multi-MB music while
      // the user's music volume is muted. Unmuting will load this track.
      this.currentMusicHowl = null;
      this.playGeneration++;
      this.safely("stop previous track", () => prev?.stop());
      return;
    }
    const url = playlist[this.orderPos];
    const next = this.getTrackHowl(url);
    if (!next) return;
    this.currentMusicHowl = next;

    // Generation token: only the latest started track may advance the playlist.
    const gen = ++this.playGeneration;
    // Clear any stale "end" handler before re-arming (Howler has off(); the unit
    // mock does not — the generation guard makes stragglers no-ops regardless).
    if (typeof next.off === "function") next.off("end");
    next.once("end", () => this.onTrackEnd(era, mood, gen));

    if (prev === next) {
      // Single-track wrap (a one-entry playlist looping on itself) — restart it.
      this.safely("restart track", () => {
        if (typeof next.seek === "function") next.seek(0);
        if (this.backgroundMusicVolume > 0) {
          next.volume(this.backgroundMusicVolume);
          if (!next.playing()) next.play();
        }
      });
      return;
    }

    next.volume(0);
    if (!next.playing()) next.play();
    if (immediate || !prev) {
      // Era start (or explicit resume) — snap straight to full volume.
      next.volume(this.backgroundMusicVolume);
    } else if (!prev.playing()) {
      // Previous track ended on its own — gently fade the next one in.
      next.fade(0, this.backgroundMusicVolume, MUSIC_CROSSFADE_MS);
    } else {
      // Era changed mid-track — crossfade between the two live tracks.
      next.fade(0, this.backgroundMusicVolume, MUSIC_CROSSFADE_MS);
      const fadingOut = prev;
      fadingOut.fade(fadingOut.volume(), 0, MUSIC_CROSSFADE_MS);
      fadingOut.once("fade", () =>
        this.safely("stop faded track", () => fadingOut.stop()),
      );
    }
  }

  /** A track finished naturally — advance to the next track in the playlist (looping). */
  private onTrackEnd(era: number, mood: EraMusicMood, gen: number): void {
    if (gen !== this.playGeneration) return; // superseded
    if (era !== this.currentEra) return; // era changed under us
    if (mood !== this.currentMood) return; // mood changed under us
    const playlist = this.playlistFor(era, mood);
    if (!playlist || playlist.length === 0) return;
    // Loop the fixed order: wrap back to the first (best-fit) track at the end.
    const pos = (this.orderPos + 1) % playlist.length;
    this.playTrackAt(era, mood, pos, false);
  }

  private getOrLoadSoundEffect(name: SoundEffect): Howl | null {
    let sound = this.soundEffects.get(name);
    if (sound) return sound;
    const src = soundEffectUrls.get(name);
    if (!src) return null;
    try {
      sound = new Howl({ src: [src], volume: this.soundEffectsVolume });
      this.soundEffects.set(name, sound);
      return sound;
    } catch (err) {
      console.error(`SoundManager: failed to load sound ${name}`, err);
      return null;
    }
  }

  private removeActiveSoundById(id: number): void {
    this.activeSounds = this.activeSounds.filter((s) => s.id !== id);
  }

  public playSoundEffect(name: SoundEffect, rate?: number): void {
    if (this.suspended) return;
    this.safely(`play sound ${name}`, () => {
      const howl = this.getOrLoadSoundEffect(name);
      if (!howl) return;

      if (this.activeSounds.length >= MAX_CONCURRENT_SOUNDS) {
        const oldest = this.activeSounds[0];
        oldest.howl.stop(oldest.id);
        this.removeActiveSoundById(oldest.id);
      }

      const id = howl.play();
      const base = rate !== undefined && rate > 0 ? rate : 1;
      howl.rate(base * (1 + (Math.random() * 2 - 1) * SFX_PITCH_VARIATION), id);
      this.activeSounds.push({ howl, id });
      howl.once("end", () => this.removeActiveSoundById(id), id);
      howl.once("stop", () => this.removeActiveSoundById(id), id);

      if (HEAVY_SFX.has(name)) this.duckMusic();
    });
  }

  /**
   * Briefly duck the background music under a heavy cue, then ease it back.
   * Presentation only; no-ops when music is muted or between tracks. If the
   * track changes while ducked, the restore is skipped — the incoming track
   * starts at full volume anyway.
   */
  private duckMusic(): void {
    const howl = this.currentMusicHowl;
    if (!howl || this.backgroundMusicVolume <= 0) return;
    if (typeof howl.fade !== "function") return;
    if (this.duckRestoreTimer !== null) clearTimeout(this.duckRestoreTimer);
    this.safely("duck music", () => {
      howl.fade(
        howl.volume() as number,
        this.backgroundMusicVolume * MUSIC_DUCK_LEVEL,
        MUSIC_DUCK_ATTACK_MS,
      );
    });
    this.duckRestoreTimer = setTimeout(() => {
      this.duckRestoreTimer = null;
      if (this.currentMusicHowl !== howl) return;
      if (this.backgroundMusicVolume <= 0) return;
      this.safely("restore ducked music", () => {
        howl.fade(
          howl.volume() as number,
          this.backgroundMusicVolume,
          MUSIC_DUCK_RELEASE_MS,
        );
      });
    }, MUSIC_DUCK_HOLD_MS);
  }

  public setSoundEffectsVolume(volume: number): void {
    this.soundEffectsVolume = Math.max(0, Math.min(1, volume));
    this.safely("set sound effects volume", () => {
      this.soundEffects.forEach((sound) => {
        sound.volume(this.soundEffectsVolume);
      });
    });
  }

  public stopSoundEffect(name: SoundEffect): void {
    this.safely(`stop sound ${name}`, () => {
      const howl = this.soundEffects.get(name);
      if (howl) {
        howl.stop();
        this.activeSounds = this.activeSounds.filter((s) => s.howl !== howl);
      }
    });
  }

  public stopAllSoundEffects(): void {
    this.safely("stop all sound effects", () => {
      this.soundEffects.forEach((sound) => sound.stop());
      this.activeSounds = [];
    });
  }
}
