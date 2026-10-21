# Primalfront

Deterministic, networked browser **.io territory-control RTS** with a 3-Age tech system
(**Primitive → Imperial → Modern**) and an explicit **anti-snowball / no-linear-rush** design.

Primalfront is a modified version of [OpenFront](https://github.com/openfrontio/OpenFrontIO)
(© OpenFront and Contributors), changed substantially from 2026 onwards. It is not affiliated
with or endorsed by the OpenFront project.

## Licence
- Code: GNU AGPL-3.0 with OpenFront's Section 7 additional terms, see `LICENSE`.
- Assets in `resources/`: CC BY-SA 4.0, see `LICENSE-ASSETS` and `CREDITS.md`.
- Source of the version running on primalfront.com: https://github.com/daniel-mf-92/primalfront-source

## What's here
- 3-Age progression: each Age unlocks buildings/units and shifts the economy (cheap/swarmy → fortified/economic → ranged/air/WMD), with a telegraphed **vulnerability window** on every age-up.
- Anti-rush economy: age cost/regen multipliers, building + border **upkeep**, **leader-tax** scaled by a per-player `threatScore`, and per-tick **techpoint** accrual gating advancement.
- Age-gated structures (Palisade, Granary, Artillery Fort, Harbor, Airbase) + minAge gating on late-game units.
- Networked `advance_age` intent + HUD (Age/techpoint readout, Advance-Age button, build-menu age locks).

## Design docs (authoritative)
- `EONFRONT_SPEC.md` — Age-system implementation spec.
- `MECHANICS_RESEARCH.md` — researched anti-snowball/era mechanics from successful games (Civ, AoE, Rise of Nations, Polytopia, EU4, .io territory games, …) + prioritized module roadmap.

## Dev
```bash
npm ci
npm run dev          # client + dev server
npx tsc --noEmit     # typecheck
npm test             # vitest
npx vite build       # production build
```

> Determinism rule: the simulation core (`src/core`) must stay deterministic — **no `Math.random` / `Date.now` / float-RNG** in sim paths. Every "chance" mechanic is a deterministic threshold/counter.
