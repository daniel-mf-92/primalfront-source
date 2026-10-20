# Credits

## Music

Except where noted, background music is by **Kevin MacLeod** (https://incompetech.com),
licensed under the **Creative Commons: By Attribution 4.0 License**
(https://creativecommons.org/licenses/by/4.0/).

Each age has a playlist that plays in a **fixed, fitness-ranked order** in-game
(best-fitting track first; tracks advance with a crossfade and the list loops),
so the strongest-matching tune always leads the era. Tracks below are listed in
that play order:

| Age         | Tracks (in play order)                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitive   | **Tribal lead (CC0 / Pixabay — no attribution, see section below):** "Tribal Drums - Forest", "War Drums", "Tribal Drums (Didgeridoo & Handpan)", "Shamanic Drums", "Ritual Drums of Power", "The Land of Warriors", "Blood Eagle", "Tribal", "Bonfire", "Ambient Bongos", "Ancient Rite", "Consecrated Ground". **Then Kevin MacLeod:** "Chee Zee Jungle", "Chee Zee Cave", "Crossing the Chasm", "Echoes of Time v2", "Lightless Dawn", "Heart of Nowhere", "Mesmerize"                                                      |
| Classical   | "Achilles", "Desert City", "Ibn Al-Noor", "Egmont Overture", "Crusade", "Ouroboros", "Hidden Past"                                                                                    |
| Imperial    | "Heroic Age", "Strength of the Titans", "Clash Defiant", "Epic Unease", "The Pyre", "Hall of the Mountain King", "Rising Tide"                                                        |
| Feudal      | "Minstrel Guild", "Angevin", "Court of the Queen", "Master of the Feast", "Teller of the Tales", "Pippin the Hunchback", "Folk Round"                                                 |
| Enlightened | "Canon in D Major", "Virtutes Instrumenti", "Suonatore di Liuto", "Virtutes Vocis", "Gymnopedie No 1", "Despair and Triumph", "Healing"                                               |
| Industrial  | "Industrial Revolution", "Industrial Music Box", "Mechanolith", "Iron Bacon", "Steel Rods", **"Radetzky March" (public domain — see below)**, "Volatile Reaction", "Crinoline Dreams" |
| Modern      | "Crisis", "Heavy Interlude", "The Complex", "Hot Pursuit", "Hitman", "Blip Stream", "Digital Lemonade", "Decisions", "Killing Time"                                                   |
| Alien       | "Interloper", "Floating Cities", "Space Fighter Loop", "Phantom from Space", "Frozen Star", "Deep Haze", "Long Note Two"                                                              |

### Royalty-free / CC0 tribal tracks (Primitive era — NO attribution required)

These lead the primitive/tribal soundtrack. All are cleared for commercial
bundling with **no attribution obligation**; listed here only as a provenance
record in case a claim is ever raised.

| File            | Title                               | Author / Source                                          | Licence                                  |
| --------------- | ----------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| primitive8.mp3  | Tribal Drums - Forest               | AiCanvas — pixabay.com/music/world-tribal-drums-forest-441256 | Pixabay Content License (no attribution) |
| primitive9.mp3  | Tribal Drums (Didgeridoo & Handpan) | Surprising_Media — pixabay.com                           | Pixabay Content License                  |
| primitive10.mp3 | Shamanic Drums                      | RibhavAgrawal — pixabay.com                              | Pixabay Content License                  |
| primitive11.mp3 | War Drums                           | Stereo_Color — pixabay.com/music/rock-war-drums-493734   | Pixabay Content License                  |
| primitive12.mp3 | The Land of Warriors (Didgeridoo)   | RibhavAgrawal — pixabay.com                              | Pixabay Content License                  |
| primitive13.mp3 | Ritual Drums of Power               | DesiFreeMusic — pixabay.com                              | Pixabay Content License                  |
| primitive14.mp3 | Blood Eagle                         | FreePD — archive.org/details/freepd (world)              | CC0 1.0 (public domain)                  |
| primitive15.mp3 | Bonfire                             | FreePD                                                   | CC0 1.0 (public domain)                  |
| primitive16.mp3 | Ambient Bongos                      | FreePD                                                   | CC0 1.0 (public domain)                  |
| primitive17.mp3 | Ancient Rite                        | FreePD (epic)                                            | CC0 1.0 (public domain)                  |
| primitive18.mp3 | Tribal                              | Of Far Different Nature — opengameart.org/content/tribal | CC0                                      |
| primitive19.mp3 | Consecrated Ground                  | FreePD (horror)                                          | CC0 1.0 (public domain)                  |

Pixabay tracks are under the **Pixabay Content License**: commercial use with no
attribution; the only restriction (not reselling the audio as a standalone file
or music pack) does not apply to in-game background music. FreePD/OpenGameArt
tracks are **CC0** (public-domain dedication). Files re-encoded to 128 kbps MP3
and looped/crossfaded in-game; no other modification.

### Public-domain tracks (not Kevin MacLeod)

- **"Radetzky March"** (Johann Strauss Sr., Op. 228) — performed by **"The President's Own"
  United States Marine Band**. This recording is in the **public domain** (a work of the
  U.S. federal government; the composition's author died in 1849). Source: Wikimedia Commons.
  No attribution is required; the band is credited here as a courtesy.

_Classical_ is the ancient-antiquity age slotted between Primitive and Imperial.

Recordings are unmodified other than re-encoding to 128 kbps for size and
playback looping/ordering/crossfading.

> To swap any track for a CC0 / public-domain one (which would remove the
> attribution requirement entirely), replace the matching file in
> `resources/sounds/music/<era><n>.mp3`, then update this file and the in-game
> credit string `game_starting_modal.music_credit`.

## Sound effects

- **`era-advance.wav`**, **`golden-age.wav`**, **`great-work-started.wav`**,
  **`great-work-setback.wav`** and **`attack-order.wav`** are **procedurally
  generated** (additive synthesis) by this project's own tooling — they are
  original works, not sampled from any third party, and carry **no attribution
  requirement**.
- All other effects under `resources/sounds/effects/` are pre-existing project
  assets.
