import { assetUrl } from "../../core/AssetUrls";
import { GameEvent } from "../../core/EventBus";

export type SoundEffect =
  | "ka-ching"
  | "atom-hit"
  | "atom-launch"
  | "hydrogen-hit"
  | "hydrogen-launch"
  | "mirv-launch"
  | "alliance-suggested"
  | "alliance-broken"
  | "build-port"
  | "build-city"
  | "build-defense-post"
  | "build-warship"
  | "sam-built"
  | "silo-built"
  | "sam-hit"
  | "warship-lost"
  | "era-advance"
  | "golden-age"
  | "great-work-started"
  | "great-work-setback"
  | "attack-order"
  | "message"
  | "click"
  | "under-attack";

export const soundEffectUrls: ReadonlyMap<SoundEffect, string> = new Map([
  ["ka-ching", assetUrl("sounds/effects/ka-ching.mp3")],
  ["atom-hit", assetUrl("sounds/effects/atom-hit.mp3")],
  ["atom-launch", assetUrl("sounds/effects/atom-launch.mp3")],
  ["hydrogen-hit", assetUrl("sounds/effects/hydrogen-hit.mp3")],
  ["hydrogen-launch", assetUrl("sounds/effects/hydrogen-launch.mp3")],
  ["mirv-launch", assetUrl("sounds/effects/mirv-launch.mp3")],
  ["alliance-suggested", assetUrl("sounds/effects/alliance-suggested.mp3")],
  ["alliance-broken", assetUrl("sounds/effects/alliance-broken.mp3")],
  ["build-port", assetUrl("sounds/effects/build-port.mp3")],
  ["build-city", assetUrl("sounds/effects/build-city.mp3")],
  ["build-defense-post", assetUrl("sounds/effects/build-defense-post.mp3")],
  ["build-warship", assetUrl("sounds/effects/build-warship.mp3")],
  ["sam-built", assetUrl("sounds/effects/sam-built.mp3")],
  ["silo-built", assetUrl("sounds/effects/silo-built.mp3")],
  ["sam-hit", assetUrl("sounds/effects/sam-hit.mp3")],
  ["warship-lost", assetUrl("sounds/effects/warship-lost.mp3")],
  ["era-advance", assetUrl("sounds/effects/era-advance.wav")],
  ["golden-age", assetUrl("sounds/effects/golden-age.wav")],
  ["great-work-started", assetUrl("sounds/effects/great-work-started.wav")],
  ["great-work-setback", assetUrl("sounds/effects/great-work-setback.wav")],
  ["attack-order", assetUrl("sounds/effects/attack-order.wav")],
  ["message", assetUrl("sounds/effects/message.mp3")],
  ["click", assetUrl("sounds/effects/click.mp3")],
  ["under-attack", assetUrl("sounds/effects/under-attack.wav")],
]);

export class PlaySoundEffectEvent implements GameEvent {
  constructor(
    public readonly effect: SoundEffect,
    /** Optional playback-rate multiplier (1 = normal); pitch jitter stacks on top. */
    public readonly rate?: number,
  ) {}
}

/**
 * Silence (true) or bring back (false) the match's music and effects. The
 * result screen raises it: the match is over, its soundtrack should not keep
 * playing under "Back to menu" (audit 2026-10-22).
 */
export class MusicSuspendEvent implements GameEvent {
  constructor(public readonly suspended: boolean) {}
}

const QUIET_MENU_KEY = "pf.quietMenuAfterMatch";

/** Leaving a match: the menu page that loads next starts silent. */
export function markQuietMenu(): void {
  try {
    sessionStorage.setItem(QUIET_MENU_KEY, "1");
  } catch {
    // Storage blocked: the menu plays its music as before.
  }
}

/** True once after a match was left (see markQuietMenu). */
export function consumeQuietMenu(): boolean {
  try {
    const quiet = sessionStorage.getItem(QUIET_MENU_KEY) !== null;
    sessionStorage.removeItem(QUIET_MENU_KEY);
    return quiet;
  } catch {
    return false;
  }
}

export class SetSoundEffectsVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}

export class SetBackgroundMusicVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}
