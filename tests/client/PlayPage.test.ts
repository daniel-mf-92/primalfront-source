import { render } from "lit";
import { describe, expect, it } from "vitest";
import { PlayPage } from "../../src/client/components/PlayPage";

describe("PlayPage", () => {
  it("opens with player identity and the live match browser, not a marketing panel", async () => {
    const page = new PlayPage();
    const container = document.createElement("div");

    render(page.render(), container);
    await Promise.resolve();

    const playerStrip = container.querySelector(".pf-player-strip");
    const matchBrowser = container.querySelector("game-mode-selector");

    expect(container.querySelector(".pf-primal-command")).toBeNull();
    expect(container.querySelector(".pf-mobile-wordmark")?.textContent).toBe(
      "Primalfront",
    );
    expect(container.querySelectorAll("username-input")).toHaveLength(1);
    const patternInputs = container.querySelectorAll("pattern-input");
    const flagInputs = container.querySelectorAll("flag-input");
    expect(patternInputs).toHaveLength(1);
    expect(flagInputs).toHaveLength(1);
    expect(patternInputs[0].hasAttribute("show-select-label")).toBe(true);
    expect(flagInputs[0].hasAttribute("show-select-label")).toBe(true);
    expect(flagInputs[0].classList.contains("pf-player-strip__flag")).toBe(
      true,
    );
    expect(playerStrip).not.toBeNull();
    expect(matchBrowser).not.toBeNull();
    expect(
      playerStrip!.compareDocumentPosition(matchBrowser!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
