process.env.VITE_PROXY_URL = "https://new-terminal-production.up.railway.app";

const { build } = await import("vite");
await build({
  build: {
    emptyOutDir: false,
    manifest: true,
  },
});

const { verifyBuildAssets } = await import("./verify-build-assets.mjs");
const { checkedFiles } = await verifyBuildAssets();
console.log(`Verified ${checkedFiles} build asset references.`);
