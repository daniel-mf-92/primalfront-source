import { Game, PlayerInfo, PlayerType } from "../game/Game";
import { humanTribeName, neanderthalTribeName } from "../game/Tribes";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { SpawnExecution } from "./SpawnExecution";
import { TRIBE_NAME_PREFIXES, TRIBE_NAME_SUFFIXES } from "./utils/TribeNames";

export class TribeSpawner {
  private random: PseudoRandom;
  // Module §1 — animal-pack classification stream. Distinct from `this.random`
  // (the +2 id/name stream) so adding/removing a pack roll never shifts the
  // tribe-id/name sequence. Seeded `simpleHash(gameID)+4` per the determinism
  // spec (TribeSpawner +2, resources +3, animal-pack +4). NO Math.random.
  private packRandom: PseudoRandom;
  // Module §7 — Neanderthal classification stream. Distinct from every other
  // stream so adding/removing the Neanderthal roll never shifts the tribe-id /
  // name / pack sequence. Seeded `simpleHash(gameID)+5` per the determinism spec
  // (base +0, Executor +1, TribeSpawner +2, resources +3, animal-pack +4,
  // Neanderthal +5). NO Math.random.
  private neanderthalRandom: PseudoRandom;

  constructor(
    private gs: Game,
    private gameID: GameID,
  ) {
    // Use a different seed than createGameRunner (which uses simpleHash(gameID))
    // to avoid tribe IDs colliding with nation/human IDs from the same PRNG sequence.
    this.random = new PseudoRandom(simpleHash(gameID) + 2);
    this.packRandom = new PseudoRandom(simpleHash(gameID) + 4);
    this.neanderthalRandom = new PseudoRandom(simpleHash(gameID) + 5);
  }

  spawnTribes(numTribes: number): SpawnExecution[] {
    const tribes: SpawnExecution[] = [];
    for (let i = 0; i < numTribes; i++) {
      tribes.push(this.spawnTribe());
    }
    return tribes;
  }

  // Spawn one Bot tribe. Deterministically classify it as an ANIMAL PACK with
  // probability `config.animalPackBotRatio()` (~0.20); the rest become normal
  // human tribes. ONLY Bots ever roll here — Humans/Nations are spawned by
  // other paths and are never packs (Module §1).
  spawnTribe(): SpawnExecution {
    // Draw the classification rolls BEFORE the id/name draws, each on its own
    // stream so they never perturb the id/name stream order. Pack and
    // Neanderthal are MUTUALLY EXCLUSIVE: a pack roll wins first; only a
    // non-pack bot can then roll Neanderthal. Both rolls are drawn
    // unconditionally so each stream advances identically on every client
    // regardless of the outcome (lockstep determinism).
    const config = this.gs.config();
    const packRoll = this.packRandom.next();
    const neanderthalRoll = this.neanderthalRandom.next();
    const isPack = packRoll < config.animalPackBotRatio();
    const isNeanderthal =
      !isPack && neanderthalRoll < config.neanderthalBotRatio();

    // Pack bots take a biome-derived predator archetype/name in SpawnExecution;
    // their PlayerInfo.name is a placeholder the display layer never shows.
    // Neanderthals show an unmistakable Neanderthal clan name. Everyone else is
    // a normal human tribe. The name draw stays on `this.random`.
    let name: string;
    if (isPack) {
      name = this.randomTribeName();
    } else if (isNeanderthal) {
      name = neanderthalTribeName(this.random);
    } else {
      name = humanTribeName(this.random);
    }

    const info = new PlayerInfo(
      name,
      PlayerType.Bot,
      null,
      this.random.nextID(),
    );
    // Guard: only Bots reach this method, so only Bots are ever flagged.
    if (isPack) {
      info.setIsAnimalPack(true);
    } else if (isNeanderthal) {
      info.setIsNeanderthal(true);
    }
    return new SpawnExecution(this.gameID, info);
  }

  private randomTribeName(): string {
    const prefixIndex = this.random.nextInt(0, TRIBE_NAME_PREFIXES.length);
    const suffixIndex = this.random.nextInt(0, TRIBE_NAME_SUFFIXES.length);
    return `${TRIBE_NAME_PREFIXES[prefixIndex]} ${TRIBE_NAME_SUFFIXES[suffixIndex]}`;
  }
}
