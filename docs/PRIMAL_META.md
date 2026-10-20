# Primal Meta — the stay-primitive vs. advance timing game

Owner direction (2026-07-13): keep the Primitive era exciting and potentially
LONG-LASTING. Advancing eras is deliberately expensive for the initiator and
(via the existing diffusion system) subsidizes rivals — so the interesting
decision is WHEN to advance, not how fast. This document specs the systems
that make that meta work without collapsing into the degenerate "nobody ever
advances" standoff.

One-line brief: **Primitive is the game; civilization is the escalation weapon
you time.**

## The standoff problem and its three dials

If advancing helps your rivals (diffusion) and costs you a premium, the naive
optimum is to never advance first. Three mechanisms keep the clock honest:

1. **Twilight of the wild** (`primitiveTwilightMult`): while the ice age lasts
   the primitive economy runs at full strength; once the caps have receded the
   wild THINS OUT — the wood→gold internal economy and woodland harvest decay
   linearly to a floor (0.35) over `primitiveTwilightTicks` (~8 min). Staying
   primitive is strong early and decays late: a power curve, not a plateau.
2. **World pressure** (`worldPressureMult`): from the FIRST advance anywhere in
   the world, primitive arms slowly obsolesce — the cross-age combat gap widens
   (1 → 1.35 over ~8 min) in `attackLogic`. Once civilization exists, the
   standoff cannot quietly re-form.
3. **Golden Age** (`goldenAge*`): the FIRST player in the world to reach each
   Age gets a ~60s burst (troop regen ×1.4, gold ×1.5, attack ×1.15) — the
   first-mover payoff that makes eating the premium worth the timing gamble.

Tuning target: in a default lobby the first advance should typically land
minute ~8–14 — never minute 2 (beeline meta), never never (standoff).

## Era Triumphs — soft mastery, not a checklist

Each non-final era tracks four optional, sticky Triumphs:

- **Ingenuity:** reach 125% of the base tech threshold.
- **Prosperity:** stockpile 150% of the base gold toll.
- **Dominion:** hold the era's territory target with integration debt below 60%
  of capacity.
- **Legacy:** earn an era-scaled amount of renown after entering the era.

Triumphs never hard-block advancement. Instead they alter the transition quote:

| Triumphs |  Toll | Great Work time | Vulnerability |
| -------: | ----: | --------------: | ------------: |
|        0 |  150% |            150% |          150% |
|        1 |  125% |            120% |          120% |
|        2 |  100% |            100% |          100% |
|        3 |   90% |             85% |           70% |
|        4 | 82.5% |             70% |           40% |

This creates the intended timing decision. A beeliner can still gamble on the
world-first Golden Age, but pays a larger toll, performs a longer public ritual,
and emerges vulnerable for longer. A player who actually uses the era can
transition efficiently without being forced through a fixed objective path.
Triumphs reset on advancement; Legacy uses a per-era renown baseline.

## The Great Work — era advance as a public, interruptible ritual

`AdvanceAgeExecution` no longer advances instantly. It opens a **Great Work**:

- Start requires the full advance criteria (gates + tech + gold); the gold
  toll is ESCROWED immediately (`Player.startGreatWork`).
- Progress ticks up 1/tick for `greatWorkTicks(age)` (30s Primitive → 100s
  Alien-bound). The work is replicated to every client (PlayerUpdate).
- A world-first bid (target age nobody has reached) is broadcast to the whole
  lobby: _"X has begun a Great Work — the Classical Age rises in 30s. Raid
  them to stop it!"_
- **Raids are the counterplay**: every successful `RaidExecution` against the
  owner knocks progress back `greatWorkRaidSetbackTicks` (10s).
- Losing the advance gate (settlement/keystone sacked) COLLAPSES the work:
  half the escrow refunds (`greatWorkFailRefundBps`), half sinks. Death
  refunds nothing.
- Completion releases the escrow into the real `advanceAge()` (Golden Age,
  diffusion, advance penalty all fire there). If criteria broke mid-ritual
  (tech raided below threshold) the work STALLS at 100% and retries.

`Player.advanceAge()` itself stays instant — it is the internal/test path and
the completion step of the ritual.

## Primitive raid toys (RaidExecution, deterministic)

Raiding a MORE ADVANCED victim now also:

1. **LEARN** — loots `raidTechLootFraction` (12%) of their tech points
   (transfer conserved; primitives literally steal the future).
2. **INCITE** (Primitive raider only) — injects integration debt
   (`raidUnrestDebt` = 15% of the victim's overextension capacity), pushing
   civilized realms toward the existing unrest/secession machinery.
3. **SABOTAGE** — sets back any Great Work in progress (see above).

## Bot archetypes (TribeExecution)

A monoculture of advance-ASAP bots would falsify the meta in every lobby.
Tribes now split (seeded from player id, lockstep-identical):

- **RAIDER (~30%)** — never settles a City, never advances; raids the most
  advanced/richest hostile neighbor on a seeded cadence. The barbarians.
- **BUILDER (~50%)** — settles and advances only with a 2× toll savings
  buffer (raid-resistant, better-timed bids).
- **BEELINER (~20%)** — legacy behavior; usually the lobby's first Great Work
  and first raid target.

## UI legibility (ControlPanel)

- Advance button carries a one-line decision card: _"Advancing arms your
  rivals (your tech spreads to them) — but the first to a new Age wins a
  Golden Age."_
- An active Great Work replaces the button with a live progress bar
  (% + seconds left); a GOLDEN AGE chip shows during the burst.
- Event feed: Great Work start (world-first = broadcast), setbacks (both
  parties), collapse, era advances (world-first = broadcast + Golden Age).

## Determinism rules honored

All new sim math is integer basis points or floats fed through Math.floor,
pure functions of replicated state (`game.ticks()`, player fields,
`worldFirstAdvanceTick`). No `Math.random`, no `Date.now`, no transcendentals.
World-era bookkeeping (`GameImpl.recordEraReached`) is driven only from
`advanceAge()` inside the lockstep tick.

## Explicitly out of scope (future follow-ups)

- Cancel-my-ritual intent for humans (workaround: none; the ritual is a
  commitment by design — revisit if players ask).
- Primitive-only mobility/migration upgrades and a formal Stone-Age win
  condition (renown already partially rewards a huge primitive tribe).
- Nations (`NationExecution`) never advance ages (pre-existing) — archetypes
  only apply to tribes.

Tests: `tests/GreatWork.test.ts`, `tests/PrimalMeta.test.ts` (+ updated
PlayerState fixtures). Tuning knobs all live in `Config.ts` under the
"Primal-meta" banner.
