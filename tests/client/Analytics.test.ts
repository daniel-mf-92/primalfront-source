import { afterEach, describe, expect, it, vi } from "vitest";
import { trackAnalyticsEvent } from "../../src/client/Analytics";

describe("trackAnalyticsEvent", () => {
  afterEach(() => {
    delete (window as Window & { gtag?: unknown }).gtag;
  });

  it("is a no-op when analytics is unavailable", () => {
    expect(() =>
      trackAnalyticsEvent("play_intent", { entry_point: "quick_play" }),
    ).not.toThrow();
  });

  it("forwards defined, non-sensitive funnel fields to gtag", () => {
    const gtag = vi.fn();
    (window as Window & { gtag?: typeof gtag }).gtag = gtag;

    trackAnalyticsEvent("game_started", {
      source: "public",
      entry_point: "quick_play",
      map: "world",
      omitted: undefined,
    });

    expect(gtag).toHaveBeenCalledWith("event", "game_started", {
      source: "public",
      entry_point: "quick_play",
      map: "world",
    });
  });
});
