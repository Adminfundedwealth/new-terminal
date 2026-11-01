process.env.VITE_PROXY_URL = "https://new-terminal-production.up.railway.app";

const { build } = await import("vite");
await build();
