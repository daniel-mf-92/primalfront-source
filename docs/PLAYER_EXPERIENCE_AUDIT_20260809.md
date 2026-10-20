# Primalfront player-experience audit — 2026-08-09

## Scope and evidence

This audit is based on `origin/master` at `6fb71e1`, which is also the live
commit reported by `https://primalfront.com/commit.txt` on 2026-08-09.

The build was run from an isolated worktree with the prescribed Node 20
runtime and a local dev server. I exercised the home screen, practice flow,
single-player start, spawn, first expansion attempt, and radial menu at
1400×1000 and 390×844. Screenshots were captured under
`/tmp/openfront-run/` during the audit.

The browser smoke skill initially expected a visible `SOLO` button. The current
home screen instead exposes `PRACTICE`; that stale assertion timed out before
the product flow. The ad-hoc audit used the visible `PRACTICE` button and
reached the game successfully. The branch now accepts either current entry
label and keeps the lobby-loading hero actionable, so the verification path
tracks the player path again.

## Bottom line

Primalfront is not suffering from a lack of features or surface polish. It is
suffering from a lack of one legible player contract.

The product currently asks the player to understand all of these at once:

- live matchmaking, practice, ranked, custom lobbies, and a large map picker;
- territory expansion and survival;
- Primitive resources and forest objectives;
- a multi-age technology runway;
- buildings, troop allocation, attacks, alliances, tribes, and endgame drama;
- a large collection of HUD, replay, social, and monetization surfaces.

The result is a game that can be technically active while feeling inert,
unclear, and visually overburdened. The overhaul must reduce the number of
things the player has to interpret before it increases the number of things
the game can do.

## Experience thesis

> Primalfront is a readable, dramatic territory war where every few seconds
> the player makes one visible risk/reward decision: expand, consolidate, or
> threaten a rival.

The first 90 seconds should communicate only four facts:

1. Where I can safely grow.
2. What resource or strategic advantage that growth creates.
3. What I risk by growing now.
4. What my next meaningful choice is.

Everything else should be delayed, collapsed, or made secondary until the
player has demonstrated that they understand the loop.

## Observed findings

### P0 — the entry path does not make a confident promise

The home page shows a large primary card stuck on `FINDING THE NEXT MATCH...`
and `CONNECTING TO LOBBY...`. The immediately usable actions—`PLAY WITH
FRIENDS`, `PRACTICE`, `RANKED`, and `JOIN WITH CODE`—are visually demoted under
`MORE WAYS TO PLAY`.

This makes the product's primary action look broken and its working action look
like a fallback. On mobile the same arrangement leaves a large dead card above
the four real buttons.

**Direction:** make `PLAY NOW` or `PRACTICE` an explicit, always-available
primary action. Treat matchmaking as a status/secondary option with a timeout
and a useful fallback, never as the hero state when it cannot complete.

### P0 — the first decision is visually buried

At desktop size after spawn, the player identity, large territory label, fog,
and a tall bottom control panel compete for the same visual center. At 390px
wide, the bottom HUD occupies roughly the lower third of the screen and the
battlefield becomes difficult to read until later rendering settles.

The player can technically act, but the game does not visually establish a
clear action target. This is a hierarchy failure, not a color-token failure.

**Direction:** in the first-turn state, reserve the center for the map and the
next action. Collapse nonessential readouts, move identity to a compact badge,
and keep only objective, troops, attack allocation, and one contextual action
visible. The build row must not compete with the first action.

### P0 — objective copy and game state disagree

The first-turn card says `Expand into forest` and explains that forest and
jungle generate resources. In the observed game, the objective remained at
`0%` after an expansion attempt, while the ground-truth tile count changed
from 256 to 212 over five seconds. A player can therefore experience loss or
non-progress while the UI describes a simple expansion task.

**Direction:** objectives must be event-backed, not merely descriptive. Show a
highlighted valid target, the exact action that advances the objective, and a
failure reason when the action does not count. If the Primitive era is meant
to involve rewilding or costly drift, expose that consequence in the objective
itself instead of presenting expansion as a one-way tutorial.

### P1 — radial actions are not self-explanatory

The radial menu opens successfully, but the visible choices are mostly icons
without persistent labels. It opens over the territory name and near the
already-dense bottom dock. New players have to infer what each icon means,
what it costs, and whether it is currently possible.

**Direction:** use a labelled action ring for the first several interactions;
show name, cost, effect, and unavailable reason in one adjacent detail panel.
Allow the compact icon-only version only after the player has used the action.

### P1 — mobile is a different layout problem, not a scaled desktop

The mobile practice picker is reasonably legible and has a clear `START GAME`
button. The in-game mobile layout is not: the map, top controls, player label,
objective, resource row, era row, and build controls compete vertically. The
player reaches the match but loses practical access to the battlefield and
the action surface.

**Direction:** design a mobile combat HUD around a bottom sheet with two states:
a compact `next action` state and an expanded economy/build state. Never show
the full desktop control panel by default on a 390px viewport.

### P1 — visual identity is stronger than visual hierarchy

The warm near-black surfaces, Oxanium display type, age accent, and map treatment
form a recognizable direction. However, the same accent/frame language is used
for navigation, panels, objectives, and actions, so emphasis is not selective.
The map is atmospheric but recedes so far that important terrain/resource
information becomes hard to read.

**Direction:** retain the forged tactical identity, but define a strict visual
priority order: current action > local threat > owned territory/resources >
global standings > progression > secondary systems. Color and motion should
signal state, not decorate every component.

### P1 — the design authority is fragmented

The repository contains simultaneous and partially conflicting identities:
the README describes a 3-Age system, `package.json` describes a 7-Age system,
the authoritative specs use both Eonfront and Primalfront names, and recent
history contains separate efforts for era fun, HUD decluttering, era-relative
standing, juice, viral endgame, primitive resources, and multiple UX passes.

This is not just documentation debt. It explains why the product keeps gaining
mechanics and local improvements without gaining a unified experience.

**Direction:** choose one canonical fantasy, age count, first-minute loop, and
HUD information architecture. Mark older direction documents historical or
archive them. New features must name which pillar and player decision they
serve.

## Overhaul order

### Phase 0 — freeze expansion

For the first overhaul slice, do not add new eras, units, resources, social
systems, or monetization surfaces. New work is limited to making the current
first-minute loop understandable and satisfying.

### Phase 1 — repair the contract

- Replace the stuck matchmaking hero state with a dependable play path.
- Make `Practice` the explicit onboarding route.
- Keep the live-game smoke flow attached to the current route and assert the
  actual player outcome rather than a stale button label or an assumed growth
  direction.
- Instrument first action, first successful expansion, first loss, and exit.

### Phase 2 — rebuild the first 90 seconds

- Spawn: show a compact explanation of safe land, terrain/resource value, and
  nearby risk.
- First action: highlight one valid target and explain its consequence.
- After action: show immediate map feedback, resource feedback, and risk.
- Next choice: present exactly two or three options—expand, consolidate, or
  attack—rather than the entire technology/build universe.

### Phase 3 — establish the HUD hierarchy
