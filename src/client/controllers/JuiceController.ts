import { EventBus } from "../../core/EventBus";
import { Controller } from "../Controller";
import { ScreenFlashEvent, ScreenShakeEvent } from "../render/ScreenShake";
import { PlaySoundEffectEvent } from "../sound/Sounds";
import type { PlayerView } from "../view";
import { GameView } from "../view";

// Golden Age: the biggest positive moment in the primal meta — a warm golden
// wash under the fanfare (the fanfare also ducks the music).
const GOLDEN_AGE_FLASH = {
  rgb: [1.0, 0.78, 0.22] as const,
  alpha: 0.22,
  durationMs: 1400,
};

// Era advance: the Great Work completes — a bright ceremonial wash. The
// era-advance arpeggio itself is played by SoundEffectController.
const ERA_FLASH = {
  rgb: [1.0, 0.9, 0.55] as const,
  alpha: 0.18,
  durationMs: 1100,
};

// A raid knocked our ritual back — a red sting so sabotage is felt, not read.
const SETBACK_FLASH = {
  rgb: [0.85, 0.2, 0.12] as const,
  alpha: 0.1,
  durationMs: 500,
};
const SETBACK_SHAKE = 0.25;

// The ritual collapsed outright (gate lost / criteria broken at the end).
const FAILED_FLASH = {
  rgb: [0.85, 0.2, 0.12] as const,
  alpha: 0.14,
  durationMs: 800,
};
// The collapse cue is the setback crack pitched down — heavier, more final.
const FAILED_SFX_RATE = 0.7;

const STARTED_SHAKE = 0.15;

/**
 * Gives the primal-meta gameplay moments a physical body. Watches the LOCAL
 * player's replicated state for edges — Golden Age won, Great Work started /
 * knocked back / collapsed / completed — and fans each into correlated
 * audio + screen-wash + shake cues. Purely presentational: reads GameView,
 * emits client events, never touches the lockstep sim.
 */
export class JuiceController implements Controller {
  // null = baseline not yet captured (first tick after spawn must not fire).
  private lastGoldenAge: boolean | null = null;
  private lastAge: number | null = null;
  private hadGreatWork = false;
  private lastGreatWorkProgress = 0;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {}

  tick(): void {
    const me = this.game.myPlayer();
    if (me === null) return;
    this.detectGoldenAge(me);
    this.detectGreatWork(me);
  }

  private detectGoldenAge(me: PlayerView): void {
    const active = me.goldenAgeActive();
    if (this.lastGoldenAge !== null && active && !this.lastGoldenAge) {
      this.eventBus.emit(new PlaySoundEffectEvent("golden-age"));
      this.flash(GOLDEN_AGE_FLASH);
    }
    this.lastGoldenAge = active;
  }

  private detectGreatWork(me: PlayerView): void {
    const age = me.age();
    const gw = me.greatWork();
    const ageAdvanced = this.lastAge !== null && age > this.lastAge;

    if (gw !== null && !this.hadGreatWork) {
      // Ritual opened — the commitment moment: drums.
      this.eventBus.emit(new PlaySoundEffectEvent("great-work-started"));
      this.eventBus.emit(new ScreenShakeEvent(STARTED_SHAKE));
    } else if (
      gw !== null &&
      this.hadGreatWork &&
      gw.progress < this.lastGreatWorkProgress
    ) {
      // Raided mid-ritual — progress knocked back.
      this.eventBus.emit(new PlaySoundEffectEvent("great-work-setback"));
      this.eventBus.emit(new ScreenShakeEvent(SETBACK_SHAKE));
      this.flash(SETBACK_FLASH);
    } else if (gw === null && this.hadGreatWork) {
      if (ageAdvanced) {
        // Completed — SoundEffectController plays the era fanfare; we add the
        // ceremonial wash so the age-up washes over the whole map.
        this.flash(ERA_FLASH);
      } else {
        // Collapsed (gate lost / criteria broken) — heavier, downpitched crack.
        this.eventBus.emit(
          new PlaySoundEffectEvent("great-work-setback", FAILED_SFX_RATE),
        );
        this.flash(FAILED_FLASH);
      }
    } else if (ageAdvanced) {
      // Age rose without a tracked ritual (e.g. instant/test paths) — still
      // give the moment its wash.
      this.flash(ERA_FLASH);
    }

    this.hadGreatWork = gw !== null;
    this.lastGreatWorkProgress = gw?.progress ?? 0;
    this.lastAge = age;
  }

  private flash(f: {
    rgb: readonly [number, number, number];
    alpha: number;
    durationMs: number;
  }): void {
    this.eventBus.emit(
      new ScreenFlashEvent(f.rgb[0], f.rgb[1], f.rgb[2], f.alpha, f.durationMs),
    );
  }
}
