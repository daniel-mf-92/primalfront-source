import fs from "fs/promises";
import { parse } from "node-html-parser";
import path from "path";
import { describe, expect, test } from "vitest";

const readRepoFile = (relativePath: string) =>
  fs.readFile(path.join(process.cwd(), relativePath), "utf8");

describe("startup performance contract", () => {
  test("renders a visible first-paint shell while the application loads", async () => {
    const html = await readRepoFile("index.html");

    expect(html).toContain('id="startup-shell"');
    expect(html).toContain("Loading live battles");
    expect(html).toContain(".preload #startup-shell");
    expect(html).not.toMatch(
      /\.preload\s*\{[^}]*(visibility\s*:\s*hidden|opacity\s*:\s*0)/s,
    );
  });

  test("loads remote fonts without blocking first paint", async () => {
    const html = await readRepoFile("index.html");
    const fontPreload = parse(html).querySelector(
      'link[rel="preload"][as="style"][href^="https://fonts.googleapis.com/"]',
    );

    expect(fontPreload).not.toBeNull();
    expect(fontPreload?.getAttribute("onload")).toMatch(
      /this\.rel\s*=\s*'stylesheet'/,
    );
  });

  test("keeps the gameplay engine out of the homepage entry path", async () => {
    const main = await readRepoFile("src/client/Main.ts");
    const viteConfig = await readRepoFile("vite.config.ts");
    const packageJson = JSON.parse(await readRepoFile("package.json"));

    expect(main).toContain('import("./ClientGameRunner")');
    expect(main).not.toMatch(
      /import\s*\{\s*joinLobby[\s\S]*?from\s+["']\.\/ClientGameRunner["']/,
    );
    expect(viteConfig).not.toContain("obfuscate-client-bundles");
    expect(viteConfig).toContain('name: "startup-entry-budget"');
    expect(packageJson.devDependencies).not.toHaveProperty(
      "javascript-obfuscator",
    );
  });

  test("defers optional analytics and ad scripts until the app is ready", async () => {
    const html = await readRepoFile("index.html");
    const main = await readRepoFile("src/client/Main.ts");

    expect(html).toContain("window.__loadAfterAppReady");
    // OpenFront's inherited ad/analytics tags were removed (see LicenseCompliance.test.ts).
    // Any optional third-party script added back must still wait for app-ready.
    for (const host of [
      "googletagmanager.com",
      "static.cloudflareinsights.com",
      "cdn.intergient.com",
    ]) {
      const eager = new RegExp(
        `<script[^>]+src=["'][^"']*${host.replace(/[.]/g, "\\.")}`,
      );
      expect(html).not.toMatch(eager);
    }
    expect(main).toContain(
      'document.dispatchEvent(new Event("primalfront-app-ready"))',
    );
  });

  test("does not initialize a compositor-blocking video ad on the homepage", async () => {
    const homepagePromos = await readRepoFile("src/client/HomepagePromos.ts");

    expect(homepagePromos).not.toContain("corner_ad_video");
  });
});
