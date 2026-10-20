import { beforeEach, describe, expect, test, vi } from "vitest";
import newsItemsFallback from "../../resources/news.json";

function setTestUrl(url: string) {
  const jsdom = (
    globalThis as unknown as {
      jsdom?: { reconfigure(options: { url: string }): void };
    }
  ).jsdom;
  if (jsdom) {
    jsdom.reconfigure({ url });
    return;
  }
  window.history.replaceState({}, "", url);
}

function installLocalStorageMock() {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, String(value));
      }),
    },
  });
}

describe("local API fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    installLocalStorageMock();
    setTestUrl("http://localhost/");
  });

  test("uses local resources instead of fetching news from the default localhost API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getNews, shouldUseLocalApiFallback } =
      await import("../../src/client/Api");

    expect(shouldUseLocalApiFallback()).toBe(true);
    await expect(getNews()).resolves.toEqual(newsItemsFallback);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does not refresh auth against the default localhost API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { userAuth } = await import("../../src/client/Auth");

    await expect(userAuth()).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("keeps explicit local API overrides active", async () => {
    window.localStorage.setItem("apiHost", "http://localhost:8788");
    const { getApiBase, shouldUseLocalApiFallback } =
      await import("../../src/client/Api");

    expect(shouldUseLocalApiFallback()).toBe(false);
    expect(getApiBase()).toBe("http://localhost:8788");
  });

  test("uses local resources instead of fetching from private IP dev hosts", async () => {
    setTestUrl("http://10.0.0.2:9000/");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getAudience, getNews, shouldUseLocalApiFallback } =
      await import("../../src/client/Api");

    expect(getAudience()).toBe("localhost");
    expect(shouldUseLocalApiFallback()).toBe(true);
    await expect(getNews()).resolves.toEqual(newsItemsFallback);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("keeps explicit API domain active on private IP dev hosts", async () => {
    vi.stubEnv("API_DOMAIN", "api.example.test");
    setTestUrl("http://10.0.0.2:9000/");
    const { getApiBase, shouldUseLocalApiFallback } =
      await import("../../src/client/Api");

    expect(shouldUseLocalApiFallback()).toBe(false);
    expect(getApiBase()).toBe("https://api.example.test");
  });
});
