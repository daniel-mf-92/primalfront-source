import type { GameEvent } from "../core/EventBus";
import type { GameConfig } from "../core/Schemas";

export class SendKickPlayerIntentEvent implements GameEvent {
  constructor(public readonly target: string) {}
}

export class SendUpdateGameConfigIntentEvent implements GameEvent {
  constructor(public readonly config: Partial<GameConfig>) {}
}

export class SendToggleGameStartTimer implements GameEvent {}
