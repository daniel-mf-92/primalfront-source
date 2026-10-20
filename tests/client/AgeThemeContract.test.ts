import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

test("the age theme spine covers all eight wire-serialized ages", async () => {
  const css = await readFile(
    join(process.cwd(), "src/client/styles/core/variables.css"),
    "utf8",
  );

  for (let age = 0; age <= 7; age++) {
    expect(css).toContain(`--age-${age}:`);
    expect(css).toContain(`:root[data-age="${age}"]`);
  }
});
