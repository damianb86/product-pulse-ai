import { build } from "esbuild";

await build({
  entryPoints: ["scripts/run-product-pulse-worker.js"],
  outfile: "build/product-pulse-worker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  loader: {
    ".js": "jsx",
    ".jsx": "jsx",
    ".ts": "ts",
    ".tsx": "tsx",
  },
  plugins: [
    {
      name: "externalize-runtime-dependencies",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^[^./]|^\w+:/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
});
