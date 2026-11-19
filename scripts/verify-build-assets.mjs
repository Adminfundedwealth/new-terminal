import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function verifyBuildAssets(outputDirectory = path.resolve("dist")) {
  const manifestPath = path.join(outputDirectory, ".vite", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const referencedFiles = new Set();

  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    for (const file of [
      entry.file,
      ...(entry.css ?? []),
      ...(entry.assets ?? []),
    ]) {
      if (typeof file === "string") {
        referencedFiles.add(file);
      }
    }
  }

  const indexHtml = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  for (const [, assetPath] of indexHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (assetPath.startsWith("/assets/")) {
      referencedFiles.add(assetPath.slice(1));
    }
  }

  const missingFiles = [];
  for (const file of referencedFiles) {
    if (!(await exists(path.join(outputDirectory, file)))) {
      missingFiles.push(file);
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(`Build references missing assets:\n${missingFiles.join("\n")}`);
  }

  return { checkedFiles: referencedFiles.size };
}

const isDirectExecution = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const { checkedFiles } = await verifyBuildAssets();
  console.log(`Verified ${checkedFiles} build asset references.`);
}
