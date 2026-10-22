import type { PlayerState, PlayerStatic } from "../../types";

const RELATION_SIZE = 1024;
const RELATION_NEUTRAL = 0;
const RELATION_FRIENDLY = 1;
const RELATION_EMBARGO = 2;
/** A land attack in flight between the pair (either way): the border between
 * them is a live battle front and is inked as one. */
export const RELATION_WAR = 3;

/** Reusable matrix buffer — one allocation, rewritten each frame. */
const matrix = new Uint8Array(RELATION_SIZE * RELATION_SIZE);

export interface RelationMatrixResult {
  matrix: Uint8Array;
  size: number;
}

/**
 * Build a relationship matrix from player alliance, embargo, and team data.
 * Indexed by `[ownerA * size + ownerB]` → 0=neutral, 1=friendly, 2=embargo,
 * 3=war. Embargo overrides friendly (matching game priority); war overrides
 * both.
 *
 * @param teams  Optional smallID→team map. Same-team players are marked friendly.
 */
export function buildRelationMatrix(
  players: ReadonlyMap<number, PlayerState>,
  teams?: ReadonlyMap<number, string>,
): RelationMatrixResult {
  matrix.fill(RELATION_NEUTRAL);

  // Teammates — mark same-team pairs as friendly (before embargoes, which override)
  if (teams && teams.size > 0) {
    const byTeam = new Map<string, number[]>();
    for (const [sid, team] of teams) {
      if (sid <= 0 || sid >= RELATION_SIZE) continue;
      let bucket = byTeam.get(team);
      if (!bucket) {
        bucket = [];
        byTeam.set(team, bucket);
      }
      bucket.push(sid);
    }
    for (const members of byTeam.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i]!,
            b = members[j]!;
          matrix[a * RELATION_SIZE + b] = RELATION_FRIENDLY;
          matrix[b * RELATION_SIZE + a] = RELATION_FRIENDLY;
        }
      }
    }
  }

  // Alliances
  for (const ps of players.values()) {
    const sid = ps.smallID;
    if (sid <= 0 || sid >= RELATION_SIZE) continue;

    if (ps.allies) {
      for (const allyID of ps.allies) {
        if (allyID > 0 && allyID < RELATION_SIZE) {
          const ab = sid * RELATION_SIZE + allyID;
          const ba = allyID * RELATION_SIZE + sid;
          if (matrix[ab]! < RELATION_FRIENDLY) matrix[ab] = RELATION_FRIENDLY;
          if (matrix[ba]! < RELATION_FRIENDLY) matrix[ba] = RELATION_FRIENDLY;
        }
      }
    }

    if (ps.embargoes) {
      for (const eID of ps.embargoes) {
        if (eID > 0 && eID < RELATION_SIZE) {
          matrix[sid * RELATION_SIZE + eID] = RELATION_EMBARGO;
          matrix[eID * RELATION_SIZE + sid] = RELATION_EMBARGO;
        }
      }
    }
  }

  // Live battles: an attack between two tribes (wild land has smallID 0).
  for (const ps of players.values()) {
    const sid = ps.smallID;
    if (sid <= 0 || sid >= RELATION_SIZE || !ps.outgoingAttacks) continue;
    for (const a of ps.outgoingAttacks) {
      const t = a.targetID;
      if (t <= 0 || t >= RELATION_SIZE || t === sid) continue;
      matrix[sid * RELATION_SIZE + t] = RELATION_WAR;
      matrix[t * RELATION_SIZE + sid] = RELATION_WAR;
    }
  }

  return { matrix, size: RELATION_SIZE };
}

/** The pairs a player is at war with, as a stable key: the relation matrix
 * only needs rebuilding (a full-map border recompute) when this changes, not
 * every time a band starts or stops claiming wild land. */
export function warKey(
  attacks: readonly { targetID: number }[] | undefined,
): string {
  if (!attacks || attacks.length === 0) return "";
  const ids: number[] = [];
  for (const a of attacks) if (a.targetID > 0) ids.push(a.targetID);
  return ids.sort((x, y) => x - y).join(",");
}

/** Build a smallID→team map from a player list. Skips players with no team. */
export function buildTeamMap(
  players: readonly PlayerStatic[],
): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const p of players) {
    if (p.team !== null) m.set(p.smallID, p.team);
  }
  return m;
}
