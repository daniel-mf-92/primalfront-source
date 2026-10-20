# Primalfront — Design Direction

> Art direction for the MASSIVE restyle of the OpenFront-derived UI.
> Current state to kill: flat `#111827cc` boxes, one saturated blue (`--color-malibu-blue` / `#007bc3`) on everything, system-ish fonts, no elevation, no motion, no age identity.

---

## 1. Core Aesthetic Thesis

Primalfront is the **sweep of human ages, weaponized into a UI**. The interface itself must narrate the journey from primal to alien — so the single ownable mechanic no competitor has is an **age-driven accent system**: one `--age-accent` CSS variable walks a 7-color spine (ember → crimson → gold → violet → steel → teal → bio-cyan) as the player advances, recoloring the HUD in a ceremonial age-up beat. Everything else is a **stable, atmospheric near-black command surface** — panels read as forged physical objects floating over a recessed, vignetted hex world, with a two-axis type system (engraved display for grandeur, technical sans + tabular mono for data). Atmospheric AND legible: the map recedes, the HUD owns the foreground, color is reserved for state and progression, never decoration.

---

## 2. Three Candidate Directions

### Direction A — "Forge & Empire" (gritty-historical)

**Pitch:** A war-room carved from stone and hammered metal — every panel is a forged relief, ages bleed from ember-ochre to crimson to gold like firelight on bronze.

**Mood:** Weighty, tactile, ceremonial. Crusader Kings III parchment-and-metal meets Age of Empires IV relief panels. Candlelit, grimy, ancient-into-industrial. The UI feels *struck*, not rendered.

**Palette (neutral base — warm-leaning near-black):**
- `--bg-void #0b0805` · `--bg-base #14100a` · `--panel-well #1a1410` · `--panel-raised #241c14`
- `--frame-edge #4a3d2c` (oxidized bronze hairline) · `--frame-bevel-hi rgba(255,236,196,0.08)` · `--frame-bevel-lo rgba(0,0,0,0.55)`
- Text: `--text-hi #f3ece0` · `--text-mid #b3a489` · `--text-lo #7a6c54`
- State: gain `--gain #8db255` (verdigris green) · loss `--loss #c5462f` · warn `--warn #d99a2b`
- **Per-age accents (firelight spine):** Primitive `#c9742e` (ember/ochre) · Imperial `#c0392b` (legionary crimson) · Feudal `#b8923c` (heraldic gold) · Enlightened `#8a6db5` (royal violet) · Industrial `#7a6b52` (brass/soot) · Modern `#3e9aa8` (patina teal) · Alien `#5fd8a8` (corroded bio-cyan)

**Typography:** Display `Cinzel` 600/700, ALL CAPS, tracking 0.05em (Roman inscriptional — age names, victory banners, screen titles). UI `Spectral` or `Sorts Mill Goudy` for body to keep the period feel; fall back to `Space Grotesk` if a sans is needed for dense labels. Numerics `Spectral SC` small-caps or `Chivo Mono` tabular. Scale (rem): 3.25 hero / 2 screen / 1.375 panel-title / 1 default / 0.8125 body / 0.6875 micro.

**Panels:** Heavy skeuomorphic frames. 1px `--frame-edge` outer border + 2px inset bevel (hi top/left, lo bottom/right) faking forged metal. Solid `--panel-well` scrim (never translucent in menus). Notched/clipped corners via `clip-path: polygon(...)` with a 1px accent chamfer. Optional 4% paper-grain texture overlay in early ages, fading to clean by Modern.

**Background/map:** Hex world pushed *way* back — desaturated −30%, radial vignette to near-black at edges, heavy 4% film grain, a warm low candlelight bloom top-left in `--age-accent`. Drifts very slowly (60s) in menus.

**Motion:** Heaviest, most ceremonial. `--ease-forge cubic-bezier(0.16,1,0.3,1)`. Panels *forge in* (translateY 10px + opacity + a 1px accent border-draw, 320ms). Buttons press like stamped metal (scale 0.96 + inset shadow). Age-up = full-screen accent bloom + a Cinzel age banner that sweeps across a darkened map, 1.2s hold.

---

### Direction B — "Tactical Command" (sleek-tactical-scifi) — RECOMMENDED

**Pitch:** A cool, near-black tactical HMI where depth is light not shadow — restrained glass HUD over a recessed hex map, and the accent *evolves* primal-ember to alien-plasma as you climb the ages.

**Mood:** Disciplined, premium, modern AAA. Frostpunk 2 / EVE Online frosted command panels meets Civ VII consolidated hubs. Quiet most of the time, ceremonial at age-up. Reads "engineered," not "fantasy" — which lets the alien endgame land harder.

**Palette (cool near-black, blue-slate tint — elevation = lighter):**
- `--surface-0 #0a0e14` (base/behind map) · `--surface-1 #11161f` (panels) · `--surface-2 #1a2230` (raised/hover) · `--surface-3 #232d3d` (popovers/menus) · `--overlay #2b3647` (modals)
- Lines: `--line rgba(255,255,255,0.08)` · `--line-strong rgba(255,255,255,0.16)`
- Text: `--text-hi #e6ebf2` · `--text-mid #9aa7b8` · `--text-lo #5d6b80`
- State / faction: gain `--gain #4ade80` · loss `--loss #f87171` · `--ember #e8743b` (attack/conquest counter-accent) · ally=warm / enemy=cool (kept distinct from age-accent so ownership ≠ selection)
- **Per-age accents (primal→plasma spine):** Primitive `#c9742e` (ember) · Imperial `#c0392b` (legion crimson) · Feudal `#b8923c` (heraldic gold) · Enlightened `#7d5fb2` (royal violet) · Industrial `#5a6b7a` (steel/soot) · Modern `#00a3b4` (teal tech) · Alien `#45f0c0` (bio-luminescent cyan)

**Typography:** Display `Oxanium` 700/800 (geometric techno that ages well from primal to alien — better than overused Orbitron) for hero, age badges, screen titles. UI/body `Inter` (or `Sora`) — neutral, crisp at small sizes. Numerics `JetBrains Mono` (or Inter) with `font-variant-numeric: tabular-nums` so HUD counters don't jitter. Optional: nudge display toward `Orbitron`/wider tracking *only* in Modern/Alien ages as a "world has changed" cue; keep UI constant. Scale: hero `clamp(2.5rem,6vw,4.5rem)` 800 / screen 2rem / panel-title 1.375 / default 1 / body 0.95 / HUD-label 0.7rem uppercase tracking-widest `--text-lo`.

**Panels:** Two contexts. **Menus/lobby = SOLID** `--surface-1`, 1px `--line` border + 1px inset top highlight (lit edge), no blur (legibility + .io perf). **In-game HUD = frosted glass** — `--surface-1` at ~72% alpha + `backdrop-blur` ≤12px + 1px `--line` + accent edge on active. Notched clip-path corners on hero/CTA in later ages. Elevation via luminance ladder, real drop-shadow reserved for true modals only (`0 24px 48px rgba(0,0,0,0.6)`).

**Background/map:** Stack back→front: radial gradient `--surface-0`→`#05070b`; hex world at 12–18% opacity, desaturated, slow 20–30s parallax drift; soft top-left light bloom in current `--age-accent` at ~8%; 1–3% film grain (`mix-blend: overlay`); strong corner vignette. Late ages add faint cyan/violet scanlines; early ages add dust grain — same stack, different tint token. Hero headline sits on a `--surface-0/0`→`/70` scrim.

**Motion:** `--ease cubic-bezier(0.2,0.8,0.2,1)`. Durations 120ms hover/press · 240ms panel in/out · 600ms age transition. Signature button hover: `translateY(-1px)` + border→`--line-strong` + accent glow fade-in. Panel enter: fade + 8px rise 240ms. Age-up: 600ms cross-fade of `[data-age]` tokens + one-shot radial flash from the age badge. All decorative motion (parallax, scanlines) gated behind `prefers-reduced-motion` and kept off the WebGL thread.

---

### Direction C — "Obsidian Doctrine" (bold-minimal / neo-brutalist)

**Pitch:** Brutal confidence — vast black negative space, one enormous engraved headline, a single weaponized accent block, and nothing else competing for attention.

**Mood:** Severe, editorial, modern-museum. Think a manifesto poster more than a game menu. Maximum hierarchy, minimum chrome. The age accent is the *only* color event on screen, so each age feels like a regime change.

**Palette (true layered black, monochrome discipline):**
- `--ink-0 #060709` · `--ink-1 #0e1014` · `--ink-2 #181b21` · `--ink-3 #24282f`
- Lines: hard `--line #ffffff1f` (heavier than B — brutalist edges) · `--line-strong #ffffff33`
- Text: `--text-hi #f5f6f8` · `--text-mid #8b929c` · `--text-lo #565d68`
- State: gain `#5fe39b` · loss `#ff5d5d` · single counter `--ember #ff6a2b`
- **Per-age accents (high-saturation, used as solid blocks):** Primitive `#e08a2c` · Imperial `#e0392b` · Feudal `#e0b53c` · Enlightened `#9b5cff` · Industrial `#6d7d8f` · Modern `#16c0d8` · Alien `#2effc4`

**Typography:** Display `Archivo` Expanded 900 or `Space Grotesk` 700 at huge sizes (hero up to `clamp(3rem,9vw,7rem)`), tight tracking, often the accent color as a full text fill. Body `Inter` 400/500 small and quiet. Numerics `Space Mono` tabular. Logo flavor only: `Black Ops One`. Strict 4px spacing scale, generous whitespace, all-caps section labels.

**Panels:** Almost no panels. Content sits directly on `--ink-0` separated by hard 1px hairlines and spacing. The few real panels (lobby cards, modals) are flat `--ink-1` with a single hard border, sharp 4px radius max, no bevels, no glass. The primary CTA is a solid full-accent block, oversized, uppercase, heavy.

**Background/map:** Mostly empty black. Hex map barely visible (6–10% opacity), no grain, no bloom — just a faint geometric ghost. Vignette optional. The drama comes from type scale and negative space, not texture.

**Motion:** Snappy and minimal. 100ms / 200ms only. No parallax, no scanlines. Hover = accent underline draw or border flip to `--line-strong`. Age-up = a hard full-screen accent wipe (200ms) then the new age label slams in — abrupt, like a coup, not a fade.

---

## 3. Recommendation

**Pick Direction B — "Tactical Command."**

It closes the amateur→AAA gap fastest because it's a **token system, not a reskin**: a 5-step lighter-on-elevation surface ladder, a retuned restrained accent used as light/edge not fill, a real type pairing, and the one ownable hook — the `[data-age]` accent/tint/texture progression — all drop cleanly into Tailwind `@theme` + `@layer components` consumed by the existing Lit components. It's atmospheric enough to feel grand, disciplined enough to stay legible on a canvas-heavy .io client, and the cool-base → alien-plasma arc makes the alien endgame the visual payoff. A (Forge) is gorgeous but heavier to execute (skeuomorphic frames, grain, more art assets) and risks fighting map legibility; C (Obsidian) is striking but too austere for a dense RTS HUD with resource readouts and build menus. B borrows A's "panel as forged object" frame discipline for in-game HUD and C's neo-brutalist bold-CTA hierarchy for menus — best of all three.

---

## 4. Token Set — Direction B (drop into `styles.css` / `core/variables.css`)

```css
:root {
  /* ---- Surfaces (elevation = LIGHTER, not shadow) ---- */
  --surface-0: #0a0e14;   /* base / behind map */
  --surface-1: #11161f;   /* panels, lobby cards */
  --surface-2: #1a2230;   /* raised, hover, nested */
  --surface-3: #232d3d;   /* popovers, menus */
  --overlay:   #2b3647;   /* modals */

  /* ---- Lines / dividers ---- */
  --line:        rgba(255, 255, 255, 0.08);
  --line-strong: rgba(255, 255, 255, 0.16);
  --bevel-hi:    rgba(255, 255, 255, 0.06); /* inset top highlight */

  /* ---- Text ---- */
  --text-hi:  #e6ebf2;
  --text-mid: #9aa7b8;
  --text-lo:  #5d6b80;

  /* ---- State / faction ---- */
  --gain:  #4ade80;
  --loss:  #f87171;
  --ember: #e8743b;   /* attack / conquest / danger counter-accent */
  --faction-you:   #e8a23b; /* warm = you/ally */
  --faction-enemy: #4aa3d8; /* cool = enemy */

  /* ---- Age accent spine (primal -> alien) ---- */
  --age-primitive:    #c9742e;
  --age-imperial:     #c0392b;
  --age-feudal:       #b8923c;
  --age-enlightened:  #7d5fb2;
  --age-industrial:   #5a6b7a;
  --age-modern:       #00a3b4;
  --age-alien:        #45f0c0;

  /* live accent — age system rewrites this on [data-age] change */
  --age-accent:     var(--age-primitive);
  --age-accent-hi:  color-mix(in srgb, var(--age-accent) 70%, #ffffff);
  --age-accent-dim: color-mix(in srgb, var(--age-accent) 45%, var(--surface-0));
  --age-glow:       color-mix(in srgb, var(--age-accent) 30%, transparent);

  /* ---- Typography ---- */
  --font-display: "Oxanium", system-ui, sans-serif;     /* titles, age badges */
  --font-ui:      "Inter", system-ui, sans-serif;        /* body, labels, buttons */
  --font-num:     "JetBrains Mono", ui-monospace, monospace; /* counters, timers */

  --fz-hero:   clamp(2.5rem, 6vw, 4.5rem);
  --fz-screen: 2rem;
  --fz-title:  1.375rem;
  --fz-base:   1rem;
  --fz-body:   0.95rem;
  --fz-label:  0.7rem;   /* uppercase, tracking-widest */
  --lh-tight:  1.2;
  --lh-body:   1.45;
  --tracking-label: 0.12em;

  /* ---- Radii (tactical = tighter than SaaS) ---- */
  --r-sm: 4px;   /* chips, inputs */
  --r-md: 8px;   /* buttons, cards */
  --r-lg: 12px;  /* panels */

  /* ---- Shadows / elevation (luminance does most; shadow for overlays only) ---- */
  --shadow-1: 0 2px 8px rgba(0, 0, 0, 0.6);            /* HUD docks */
  --shadow-2: 0 12px 48px rgba(0, 0, 0, 0.75);         /* modals */
  --shadow-3: 0 24px 48px rgba(0, 0, 0, 0.6);          /* critical overlays */
  --ring-accent: 0 0 0 1px var(--age-accent), 0 0 16px var(--age-glow);

  /* ---- Glass (in-game HUD ONLY) ---- */
  --glass-bg:   color-mix(in srgb, var(--surface-1) 72%, transparent);
  --glass-blur: 12px;

  /* ---- Spacing (4px scale) ---- */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-6: 24px; --sp-8: 32px; --sp-12: 48px; --sp-16: 64px;

  /* ---- Motion ---- */
  --ease:        cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-forge:  cubic-bezier(0.16, 1, 0.3, 1);
  --dur-micro:   120ms;  /* hover / press */
  --dur-panel:   240ms;  /* panel in/out */
  --dur-age:     600ms;  /* age transition */
}

/* Age system: set data-age on <body>; transition the live accent */
[data-age] { transition: --age-accent var(--dur-age) var(--ease); }
[data-age="primitive"]   { --age-accent: var(--age-primitive); }
[data-age="imperial"]    { --age-accent: var(--age-imperial); }
[data-age="feudal"]      { --age-accent: var(--age-feudal); }
[data-age="enlightened"] { --age-accent: var(--age-enlightened); }
[data-age="industrial"]  { --age-accent: var(--age-industrial); }
[data-age="modern"]      { --age-accent: var(--age-modern); }
[data-age="alien"]       { --age-accent: var(--age-alien); }

@media (prefers-reduced-motion: reduce) {
  *, [data-age] { transition-duration: 1ms !important; animation: none !important; }
}
```

---

## 5. Component-by-Component Restyle Checklist

- [ ] **Global tokens** — replace `--boxBackgroundColor #111827cc`, `--color-malibu-blue`, and the single-blue `--primaryColor*` vars with the token set above. Self-host Oxanium + Inter + JetBrains Mono (`@font-face`, no FOIT on the static client). Set `[data-age]` on `<body>`, defaulting to `primitive`.
- [ ] **Nav / header** — solid `--surface-1` bar, 1px bottom `--line`, 1px top `--bevel-hi` lit edge. Active tab = `--age-accent` underline (2px) + `--text-hi`; inactive = `--text-mid`. Logo in `--font-display` 800. No glass here.
- [ ] **Main menu** — layered hero background (gradient + ghost hex map + age bloom + grain + vignette). Headline in `--font-display` on a scrim. Buttons stacked, neo-brutalist hierarchy (see Buttons).
- [ ] **Lobby cards** — SOLID `--surface-1`, `--r-lg`, 1px `--line` + top `--bevel-hi`. Hover lifts to `--surface-2` + border→`--line-strong` over `--dur-micro`. Map thumbnail desaturated, player-count in `--font-num` tabular. Selected card gets `--ring-accent`.
- [ ] **Buttons** — Primary CTA (PLAY / JOIN WAR): large, uppercase `--font-display`, full `--age-accent` fill, `px-8 py-4`, `--ring-accent` glow, letter-spacing — ONE per view. Secondary: transparent fill + `--line` border + `--text-hi`, hover → `--surface-2`. Press: `scale(0.97)` + inset shadow, `--dur-micro`. Danger/attack: `--ember`.
- [ ] **Modals / dialogs** — `--overlay` surface, `--r-lg`, `--shadow-2` + `0 0 0 1px var(--line-strong)`. Backdrop `rgba(6,9,15,0.7)`. Title `--font-display`; enter = fade + 8px rise, `--dur-panel`.
- [ ] **Forms / inputs / settings** — `--surface-2` field, `--r-sm`, 1px `--line`; focus = `--ring-accent` (replaces the old blue ring). Labels `--font-ui` `--fz-label` uppercase `--text-lo`.
- [ ] **Loading screen** — `--surface-0` void + ghost hex map + slow age bloom. Progress bar fills in `--age-accent` over `--surface-2` track; percentage in `--font-num` tabular. Optional rotating age-flavor tip line in `--text-mid`.
- [ ] **In-game HUD — resource readout** — `<pf-resource-readout>` Lit component: 18px icon (currentColor → `--age-accent`/text) + uppercase `--fz-label` label `--text-lo` + value `--font-num` tabular `--text-hi`, fixed min-width per cell (no reflow). 220ms count-up tween; one-shot `--gain`/`--loss` pulse on change, settle to `--text-hi`. Rate ghost `+12/s` in `--text-mid`. Docked top-center in a glass panel (`--glass-bg` + blur ≤12px), notched corners, `--shadow-1`.
- [ ] **In-game HUD — build/unit menus & minimap** — frosted `--glass-bg`, 1px `--line`, active item gets `--age-accent` edge. Icons from one Lucide/Phosphor base @1.75px stroke, inline SVG `currentColor`. Minimap frame = forged-object treatment; warm=you / cool=enemy territory, distinct from `--age-accent`.
- [ ] **Age emblems / age indicator** — distinct silhouette per age (handprint → eagle → castle → compass → gear → satellite → glyph), 24px 2-tone, used as the progress marker and age-up badge.
- [ ] **Age-up moment** — on advancement: swap `[data-age]` (600ms token cross-fade) → one-shot radial accent bloom from the age badge → `--font-display` age banner sweeps in over a briefly darkened map (0.6s hold) → HUD recolors. Gate the bloom/sweep behind `prefers-reduced-motion` (fall back to a plain token cross-fade).
- [ ] **Chat / overlays** — `--surface-3`, `--line`, `--font-ui` `--fz-body`; system messages `--text-mid`, own name in `--faction-you`.
- [ ] **prefers-reduced-motion pass** — confirm parallax, scanlines, grain animation, and age-up bloom all collapse to opacity-only / static. Verify HUD readouts still tween-free but functional.
