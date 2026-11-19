import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyBuildAssets } from "../../scripts/verify-build-assets.mjs";

const temporaryDirectories: string[] = [];

async function createBuildFixture(includeStocksChunk: boolean): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "terminal-build-"));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, ".vite"), { recursive: true });
  await mkdir(path.join(directory, "assets"), { recursive: true });
  await writeFile(path.join(directory, "index.html"), '<script src="/assets/index.js"></script>');
  await writeFile(
    path.join(directory, ".vite", "manifest.json"),
    JSON.stringify({
      "src/main.tsx": {
        file: "assets/index.js",
        dynamicImports: ["src/pages/Stocks.tsx"],
      },
      "src/pages/Stocks.tsx": { file: "assets/Stocks-hash1234.js" },
    }),
  );
  await writeFile(path.join(directory, "assets", "index.js"), "");
  if (includeStocksChunk) {
    await writeFile(path.join(directory, "assets", "Stocks-hash1234.js"), "");
  }

  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("production build asset integrity", () => {
  it("accepts a build when every lazy route chunk exists", async () => {
    const directory = await createBuildFixture(true);

    await expect(verifyBuildAssets(directory)).resolves.toEqual({ checkedFiles: 2 });
  });

  it("fails the build when a lazy route chunk is missing", async () => {
    const directory = await createBuildFixture(false);

    await expect(verifyBuildAssets(directory)).rejects.toThrow(
      "Build references missing assets:\nassets/Stocks-hash1234.js",
    );
  });
});
