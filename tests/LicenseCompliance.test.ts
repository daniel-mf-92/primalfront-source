import fs from "fs";
import path from "path";

// Primalfront is a modified OpenFront (AGPL-3.0 + Section 7 terms). These checks keep the
// legal notices in place and stop OpenFront's own ad/analytics IDs from creeping back in.
const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const NOTICE = "© OpenFront and Contributors";

describe("licence compliance", () => {
  test("ships the AGPL licence with OpenFront's Section 7 terms", () => {
    const licence = read("LICENSE");
    expect(licence).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(licence).toContain(NOTICE);
    expect(fs.existsSync(path.join(ROOT, "LICENSE-ASSETS"))).toBe(true);
  });

  test("keeps the OpenFront notice in the footer and loading screen", () => {
    expect(JSON.parse(read("resources/lang/en.json")).main.copyright).toContain(
      NOTICE,
    );
    expect(read("src/client/GameStartingModal.ts")).toContain(NOTICE);
    for (const file of fs.readdirSync(path.join(ROOT, "resources/lang"))) {
      const main = JSON.parse(read(`resources/lang/${file}`)).main ?? {};
      if (main.copyright !== undefined) {
        expect(`${file}: ${main.copyright}`).toContain(NOTICE);
      }
    }
  });

  test("offers players the source code", () => {
    expect(read("src/client/components/Footer.ts")).toContain(
      "github.com/daniel-mf-92/primalfront-source",
    );
  });

  test("carries none of OpenFront's ad or analytics accounts", () => {
    const html = read("index.html");
    for (const id of [
      "G-WQGQQ8RDN4",
      "AW-16702609763",
      "1025558/75940",
      "03d93e6fefb349c28ee69b408fa25a13",
    ]) {
      expect(html).not.toContain(id);
    }
    expect(read("src/client/GoogleAdElement.ts")).not.toContain(
      "ca-pub-7035513310742290",
    );
  });
});
