// A click on free land spawns the player while they have no tribe yet: during the
// spawn phase as before, and also after it, because a slow device can spend most of
// the 30-second spawn window loading the map. Without this a late click was sent as
// a camp move for a player who does not exist and silently did nothing.
export interface SpawnClickState {
  isLand: boolean;
  hasOwner: boolean;
  inSpawnPhase: boolean;
  isRandomSpawn: boolean;
  /** null when this client is not a player (spectator or replay) */
  hasSpawned: boolean | null;
}

export function shouldSendSpawnIntent(s: SpawnClickState): boolean {
  if (!s.isLand || s.hasOwner || s.isRandomSpawn) return false;
  if (s.inSpawnPhase) return true;
  return s.hasSpawned === false;
}

/** Keep the "click a land tile" prompt up until the player actually has a tribe. */
export function needsSpawnPrompt(s: {
  inSpawnPhase: boolean;
  isRandomSpawn: boolean;
  hasSpawned: boolean | null;
}): boolean {
  if (s.inSpawnPhase) return true;
  return !s.isRandomSpawn && s.hasSpawned === false;
}
