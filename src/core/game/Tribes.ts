import { PseudoRandom } from "../PseudoRandom";
import { Biome, TribeArchetype } from "./Game";

// Module F — Predator tribes (Primitive identity).
//
// Each primitive-era tribe takes on a predator identity drawn from the biome it
// spawns in: a cold-land tribe becomes a Wolf Pack, a temperate one a Bear Clan,
// an arid one a Lion Pride, a sandy/desert one a Jackal Pack, a forest one a
// Boar Sounder, an equatorial-jungle one a Tiger Ambush. This is flavor for v1
// (display identity in the Primitive era) with a deliberate biome↔archetype
// pairing that leaves room for a small terrain affinity later.
//
// All mappings here are pure + deterministic and intentionally tunable.

// Biome → predator archetype. Pairing (per ERA_OVERHAUL Module 0/F):
//   Cold→Wolf, Green→Bear, Arid→Lion, Sandy→Jackal, Forest→Boar, Jungle→Tiger.
export function tribeForBiome(b: Biome): TribeArchetype {
  switch (b) {
    case Biome.Cold:
      return TribeArchetype.Wolf;
    case Biome.Green:
      return TribeArchetype.Bear;
    case Biome.Arid:
      return TribeArchetype.Lion;
    case Biome.Sandy:
      return TribeArchetype.Jackal;
    case Biome.Forest:
      return TribeArchetype.Boar;
    case Biome.Jungle:
      return TribeArchetype.Tiger;
  }
}

// Human-readable tribe name shown as the player's identity in the Primitive era.
// Tunable flavor strings. Collective nouns: a group of boars is a "sounder", a
// group of tigers an "ambush".
export function tribeName(t: TribeArchetype): string {
  switch (t) {
    case TribeArchetype.Wolf:
      return "Wolf Pack";
    case TribeArchetype.Bear:
      return "Bear Clan";
    case TribeArchetype.Lion:
      return "Lion Pride";
    case TribeArchetype.Jackal:
      return "Jackal Pack";
    case TribeArchetype.Boar:
      return "Boar Sounder";
    case TribeArchetype.Tiger:
      return "Tiger Ambush";
  }
}

// Human-tribe naming (Module §1 taxonomy). Non-pack Bots are NORMAL human
// tribes, not predator packs, so they need a plausible early-human tribe name
// instead of an animal archetype. The name is built from a deterministic
// pick over fixed pools — given the same seeded `PseudoRandom`, every client
// produces the identical name, preserving lockstep determinism. Collective +
// descriptor pools keep the namespace large enough to avoid frequent dupes
// while staying flavorful ("People of the Ash", "Stoneford Clan", …).
const HUMAN_TRIBE_PREFIXES: readonly string[] = [
  "Ash",
  "Stone",
  "River",
  "Oak",
  "Ember",
  "Flint",
  "Reed",
  "Moss",
  "Fen",
  "Briar",
  "Hollow",
  "Thorn",
  "Elm",
  "Cinder",
  "Dawn",
  "Dusk",
  "Frost",
  "Marsh",
  "Pine",
  "Clay",
];

const HUMAN_TRIBE_SUFFIXES: readonly string[] = [
  "Clan",
  "Folk",
  "Tribe",
  "Kin",
  "People",
  "Hearth",
  "Band",
  "Hold",
  "Kindred",
  "Children",
];

// Deterministically pick a human-tribe name. Pure over the supplied
// PseudoRandom: the only entropy is the seeded RNG draws, so replay-stable.
// Two draws (prefix, suffix) — keep this draw count/order stable so the RNG
// stream stays aligned across clients.
export function humanTribeName(random: PseudoRandom): string {
  const prefix = random.randElement(HUMAN_TRIBE_PREFIXES as string[]);
  const suffix = random.randElement(HUMAN_TRIBE_SUFFIXES as string[]);
  return `${prefix} ${suffix}`;
}

// Neanderthal-tribe naming (Module §7 taxonomy). Neanderthals are a distinct
// primitive NPC people, not a human tribe and not an animal pack, so they get
// their own unmistakable name. Drawn from the real Neanderthal type-sites (the
// caves/locations where Neanderthal remains were found) + the fixed
// "Neanderthals" identity, so a player instantly reads the tribe as Neanderthal.
// ONE deterministic draw over the supplied PseudoRandom — replay-stable; keep
// the draw count/order stable so the RNG stream stays aligned across clients.
const NEANDERTHAL_SITES: readonly string[] = [
  "Shanidar",
  "Krapina",
  "Vindija",
  "La Ferrassie",
  "El Sidrón",
  "Amud",
  "Kebara",
  "Saccopastore",
  "Spy",
  "Tabun",
  "Feldhofer",
  "Gibraltar",
];

export function neanderthalTribeName(random: PseudoRandom): string {
  const site = random.randElement(NEANDERTHAL_SITES as string[]);
  return `${site} Neanderthals`;
}
