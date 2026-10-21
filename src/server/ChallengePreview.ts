import { Challenge } from "../core/ChallengeLink";
import { escapeHtml } from "./GamePreviewBuilder";

// A shared result pasted into a chat unfurls into a link preview. The static
// shell's preview says "From tribe to empire"; a challenge link should say the
// score it carries, so the preview itself is the brag. The numbers are already
// clamped integers and the map name is an enum value, but everything is
// escaped anyway before it touches markup.

const ROMAN = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function challengePreviewTitle(c: Challenge): string {
  return `Age ${ROMAN[c.era] ?? c.era} · ${c.tiles.toLocaleString("en-US")} tiles · ${duration(c.seconds)} — can you beat it?`;
}

export function challengePreviewDescription(c: Challenge): string {
  const parts: string[] = [];
  if (c.outlasted > 0) {
    parts.push(`Outlasted ${c.outlasted} of ${c.rivals} tribes`);
  }
  if (c.map !== undefined) {
    parts.push(`on ${c.map}${c.compact ? " (compact)" : ""}`);
  }
  if (c.difficulty !== undefined) {
    parts.push(`${c.difficulty} difficulty`);
  }
  const setup = parts.length > 0 ? `${parts.join(" · ")}. ` : "";
  return `${setup}Tap to play the same match. Primalfront: grow a tribe into an empire, free in your browser.`;
}

/**
 * Rewrite the rendered app shell's Open Graph title/description for a
 * challenge link. The shell is matched on its exact tags; if a redesign drops
 * them the page is returned untouched rather than corrupted.
 */
export function applyChallengePreview(html: string, c: Challenge): string {
  const title = escapeHtml(challengePreviewTitle(c));
  const description = escapeHtml(challengePreviewDescription(c));
  return html
    .replace(
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${title}" />`,
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:description" content="${description}" />`,
    );
}
