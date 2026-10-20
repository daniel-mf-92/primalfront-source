import newsItems from "../../../resources/news.json";
import {
  getVisibleNewsItems,
  isFirefoxLikeBrowser,
  NewsItem,
} from "../../../src/client/components/NewsBox";

const DISMISSED_NEWS_KEY = "dismissedNewsItems";
const allItems = newsItems as NewsItem[];
const FIREFOX_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0";
const CHROMIUM_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function createMockLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

describe("NewsBox", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getVisibleNewsItems", () => {
    it("returns all items for Firefox-like browsers when none are dismissed", () => {
      const items = getVisibleNewsItems(allItems, FIREFOX_UA);
      expect(items.length).toBe(newsItems.length);
    });

    it("hides the Firefox warning for Chromium browsers", () => {
      const items = getVisibleNewsItems(allItems, CHROMIUM_UA);
      expect(
        items.find((i) => i.id === "firefox-performance-issues-2026"),
      ).toBeUndefined();
      expect(items.length).toBe(newsItems.length - 1);
    });

    it("filters out dismissed items", () => {
      const items = getVisibleNewsItems(allItems, FIREFOX_UA);
      const firstId = items[0].id;
      localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify([firstId]));
      const filtered = getVisibleNewsItems(allItems, FIREFOX_UA);
      expect(filtered.find((i) => i.id === firstId)).toBeUndefined();
      expect(filtered.length).toBe(items.length - 1);
    });

    it("returns empty when all items are dismissed", () => {
      const allIds = allItems.map((i) => i.id);
      localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify(allIds));
      const items = getVisibleNewsItems(allItems, FIREFOX_UA);
      expect(items.length).toBe(0);
    });
  });

  describe("isFirefoxLikeBrowser", () => {
    it("detects Firefox-like user agents", () => {
      expect(isFirefoxLikeBrowser(FIREFOX_UA)).toBe(true);
      expect(isFirefoxLikeBrowser("Mozilla/5.0 FxiOS/140.0")).toBe(true);
      expect(isFirefoxLikeBrowser("Mozilla/5.0 LibreWolf/140.0")).toBe(true);
      expect(isFirefoxLikeBrowser(CHROMIUM_UA)).toBe(false);
    });
  });

  describe("news items structure", () => {
    it("each item has required fields", () => {
      const items = getVisibleNewsItems(allItems, FIREFOX_UA);
      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(typeof item.id).toBe("string");
        expect(item.title).toBeDefined();
        expect(typeof item.title).toBe("string");
        const hasDescription =
          item.description !== undefined ||
          item.descriptionTranslationKey !== undefined;
        expect(hasDescription).toBe(true);
        expect(item.type).toBeDefined();
        expect(["tournament", "tutorial", "announcement", "warning"]).toContain(
          item.type,
        );
      }
    });

    it("each item has a unique id", () => {
      const items = getVisibleNewsItems(allItems, FIREFOX_UA);
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
