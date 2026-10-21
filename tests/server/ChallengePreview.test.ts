import { describe, expect, it } from "vitest";
import { parseChallenge } from "../../src/core/ChallengeLink";
import { Difficulty, GameMapType } from "../../src/core/game/Game";
import {
  applyChallengePreview,
  challengePreviewTitle,
} from "../../src/server/ChallengePreview";

const SHELL = `<head>
    <meta property="og:url" content="https://primalfront.com/" />
    <meta property="og:title" content="Primalfront - From tribe to empire" />
    <meta
      property="og:description"
      content="Start as one small tribe and grow into a world power."
    />
    <meta property="og:image" content="/x.png" />
  </head>`;

describe("challenge link preview", () => {
  it("puts the score in the preview title and the setup in the description", () => {
    const c = parseChallenge("?c=3.1284.173.205.862&m=Europe&d=Hard&k=1")!;
    const html = applyChallengePreview(SHELL, c);
    expect(html).toContain(
      '<meta property="og:title" content="Era III · 1,284 tiles · 14:22 — can you beat it?" />',
    );
    expect(html).toContain("Outlasted 173 of 205 tribes");
    expect(html).toContain("on Europe (compact)");
    expect(html).toContain("Hard difficulty");
    expect(html).not.toContain("From tribe to empire");
    // Only the two tags change.
    expect(html).toContain('<meta property="og:image" content="/x.png" />');
  });

  it("leaves the shell alone when a redesign drops the tags", () => {
    const c = parseChallenge("?c=1.10.0.0.5")!;
    expect(applyChallengePreview("<head></head>", c)).toBe("<head></head>");
  });

  it("never lets markup through", () => {
    const c = parseChallenge("?c=2.50.1.2.30")!;
    (c as { map?: string }).map = '"><script>alert(1)</script>';
    const html = applyChallengePreview(SHELL, c);
    expect(html).not.toContain("<script>");
    expect(challengePreviewTitle(c)).not.toContain("<");
  });

  it("round-trips the setup through the client link encoder", async () => {
    const { buildChallengeUrl } = await import("../../src/core/ChallengeLink");
    const url = buildChallengeUrl("https://primalfront.com", {
      era: 2,
      tiles: 900,
      outlasted: 3,
      rivals: 40,
      seconds: 400,
      map: GameMapType.AmazonRiver,
      difficulty: Difficulty.Easy,
      compact: true,
    });
    expect(url).toBe(
      "https://primalfront.com/?c=2.900.3.40.400&m=Amazon%20River&d=Easy&k=1",
    );
    const back = parseChallenge(new URL(url).search)!;
    expect(back.map).toBe(GameMapType.AmazonRiver);
    expect(back.difficulty).toBe(Difficulty.Easy);
    expect(back.compact).toBe(true);
  });

  it("drops an unknown map or difficulty but keeps the score", () => {
    const c = parseChallenge("?c=2.50.1.2.30&m=Atlantis&d=Nightmare&k=2")!;
    expect(c.map).toBeUndefined();
    expect(c.difficulty).toBeUndefined();
    expect(c.compact).toBeUndefined();
    expect(c.tiles).toBe(50);
  });
});
