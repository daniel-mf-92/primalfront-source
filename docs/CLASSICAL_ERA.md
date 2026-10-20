# Classical "Kingdom" Era — Design + Implementation (2026-06-16)

A new era inserted **between Primitive and Imperial**, built ON TOP of the
ice-age progression rework (`feat/primitive-unbreak`, see `ICE_AGE_ECONOMY.md`).
Branch: `feat/classical-era` (off `40d6019` + the ice-age WIP).

> Fiction: the ice-age climate clock thaws the Primitive era into settlement.
> The first tribe to found a permanent City becomes a **Kingdom** (Classical).
> Kingdoms are fragile — overexpansion breeds dissent and civil war. Only a
> stable, consolidated kingdom advances to **Imperial**, where empires finally
> hold territory freely.

---

## Progression ladder (after insertion)

`Primitive(0) → Classical(1) → Imperial(2) → Feudal(3) → Enlightened(4) → Industrial(5) → Modern(6) → Alien(7)`

- **Primitive → Classical** — reuses the existing settle gate: own ≥1 permanent
  City (`citiesToAdvance`) + the gold toll. Founding your first City turns a
  tribe into a Kingdom. (Special-cased in `PlayerImpl.meetsAdvanceCriteria`.)
- **Classical → Imperial** — tech points + gold (`advanceAgeCost(Classical)` =
  `{16000n, 400}`). No keystone building. Reaching Imperial is the *reward*:
  overextension penalty + civil war switch OFF.

### RENUMBER landmine (read before touching the Age enum)
`advanceAge()` does `_age++`, so enum **order = progression order**. A new era
MUST be inserted at position and the rest renumbered, NOT appended. Four
RAW-INTEGER age-indexed structures shadow the enum and were reshuffled in
lockstep — keep them aligned:
- `ERA_MUSIC_URLS` (`SoundManager.ts`)
- `INTEGRATION_DEBT_PER_CAPTURE`, `ATTACK_TILES_PER_TICK_AGE_MULT` (`Config.ts`)
- `ageNames` (`BuildMenu.ts`)
- `AGE_IMPERIAL` (`structure-theme.ts`)
Everything else compares by enum NAME and is renumber-safe. Guarded by
`tests/ClassicalEra.test.ts`.

---

## Era-scaled polity titles (`Game.ts` `eraTitle` → `PlayerImpl.displayName`)

Civilized players get a title prefix on their display name (map labels, HUD,
events). Animal packs are not civilizations → keep their raw archetype name.

| Era | Title | | Era | Title |
|-----|-------|-|-----|-------|
| Primitive | Tribe of | | Enlightened | Republic of |
| Classical | Kingdom of | | Industrial | Union of |
| Imperial | Empire of | | Modern | Federation of |
| Feudal | Dominion of | | Alien | Ascendancy of |

(English only — display names are proper nouns. Trivial to swap.)

---

## Classical map dynamics — why the map does NOT fill up

Three coupled pressures keep a Classical kingdom from ballooning:

1. **Limited conquest.** `ATTACK_TILES_PER_TICK_AGE_MULT[Classical] = 0.38` —
   only a little faster than a Primitive tribe (0.25), far below Imperial (0.45).
2. **Big internal dissent penalty.** The overextension penalty
   (`Config.overextensionPenalty`) — previously Primitive-only — now also applies
   in Classical, at a HARDER severity (`OVEREXTENSION_MAX_PENALTY_CLASSICAL =
   0.4`, vs Primitive's 0.2). Holding more land than your Cities can administer
   (`overextensionCapacity = 50 + 25/City`) bleeds gold + troop regen.
3. **Civil war / secession (headline).** When integration debt stays at/above
   `civilWarDebtRatio()` (1.5) × administrative capacity, a contiguous province
   **secedes** to a brand-new independent rebel **Kingdom** (inherits the
   Classical age → renders as a rival "Kingdom of …"). The parent's debt resets
   to `civilWarDebtResetFraction()` (0.5) × capacity — relief with lingering
   unrest. Reuses `TribeSplitExecution` ("secession" mode); triggered from
   `PlayerExecution.maybeEnqueueSecession` on the split-check cadence, debounced
   via `secessionPending`. Applies to ALL Classical players incl. the human.

Plus **reduced rewild**: `rewildEnabled` now covers Primitive AND Classical, but
Classical cities project a wider hinterland (`classicalSupportRadiusMult = 2.0`)
and shed slower (`classicalRewildBudgetMult = 0.4`) — the frontier trims gently
instead of pulsing like a nomad camp.

Imperial+ : none of the above — empires hold territory freely (existing design).

---

## Music

A 7-track Classical playlist (`classical.mp3`..`classical7.mp3`) — "Achilles",
"Crusade", "Ibn Al-Noor", "Desert City", "Egmont Overture", "Ouroboros",
"Hidden Past" — Kevin MacLeod (incompetech.com), CC BY 4.0. Shipped by the
concurrent per-age-playlist rework (`SoundManager.ts` `ERA_PLAYLISTS`, keyed by
the Age enum member so it is renumber-safe); this era just enables the staged
`[Age.Classical]` line. Attribution REQUIRED, lives in `CREDITS.md`.

---

## Determinism (lockstep — same rules as ICE_AGE_ECONOMY.md §D)

All new logic is integer/ratio math on replicated state. The secession carve is
pure geometry (longer bounding-box axis, median cut, TileRef tie-break); the only
randomness is the rebel's PlayerInfo id from a `PseudoRandom` seeded on
(parent id, tick, salt). No `Math.random` / `Date.now`. Per-tick scans are bounded
by the existing split-check cadence + the carve's one-shot execution.

---

## Tunables (all in `Config.ts`)

`civilWarDebtRatio` 1.5 · `civilWarDebtResetFraction` 0.5 ·
`OVEREXTENSION_MAX_PENALTY_CLASSICAL` 0.4 · `classicalSupportRadiusMult` 2.0 ·
`classicalRewildBudgetMult` 0.4 · `ATTACK_TILES_PER_TICK_AGE_MULT[1]` 0.38 ·
`INTEGRATION_DEBT_PER_CAPTURE[1]` 0.92 · `advanceAgeCost(Classical)` {16000n,400}.
