import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

// rpc-websockets (pulled in by @solana/web3.js) only declares "browser"/"node"
// export conditions, neither of which the SSR build matches. Resolve it
// to the browser build file directly so bundling succeeds in every environment.
const rpcWebsocketsBrowser = fileURLToPath(
  new URL("./node_modules/rpc-websockets/dist/index.browser.mjs", import.meta.url),
);
const browserBufferShim = fileURLToPath(new URL("./src/lib/buffer-polyfill.ts", import.meta.url));

// @solana-mobile/wallet-adapter-mobile (pulled in by @solana/wallet-adapter-react)
// calls Node's util.inherits at module scope, which throws in the SSR runtime
// and 500s every server-rendered page. It is browser-only code, so stub it for
// SSR while the real module stays in the client bundle.
const solanaMobileSsrStub = fileURLToPath(
  new URL("./src/lib/solana-mobile-ssr-stub.ts", import.meta.url),
);

export default defineConfig(({ command, mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine = Object.fromEntries(
    Object.entries(viteEnv).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return {
    define: envDefine,
    css: { transformer: "lightningcss" },
    // strictPort: Supabase auth redirect URLs are registered for :8080.
    server: { host: "::", port: 8080, strictPort: true },
    resolve: {
      alias: [
        { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
        { find: /^rpc-websockets$/, replacement: rpcWebsocketsBrowser },
        { find: /^rpc-websockets\/dist\/lib\/client$/, replacement: rpcWebsocketsBrowser },
        { find: /^node:buffer$/, replacement: browserBufferShim },
        { find: /^buffer$/, replacement: browserBufferShim },
        { find: /^buffer\/$/, replacement: browserBufferShim },
      ],
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      {
        name: "lamportpay-solana-mobile-ssr-stub",
        enforce: "pre",
        resolveId(id, _importer, options) {
          if (options?.ssr && id.startsWith("@solana-mobile/wallet-adapter-mobile")) {
            return solanaMobileSsrStub;
          }
          return null;
        },
      },
      {
        name: "lamportpay-node-buffer-browser-shim",
        enforce: "pre",
        resolveId(id) {
          if (id === "node:buffer" || id === "buffer" || id === "buffer/") return browserBufferShim;
          return null;
        },
      },
      tanstackStart({
        // Use src/server.ts (our SSR error wrapper) as the server entry.
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
      }),
      // Nitro only runs for production builds. Preset defaults to "vercel";
      // override with NITRO_PRESET (e.g. "node-server") for other targets.
      // NITRO_NO_EXTERNALS=1 bundles all deps instead of tracing node_modules,
      // which works around a Windows-only EISDIR error in the file tracer.
      // Vercel Cron runs payment reconciliation (it sends CRON_SECRET as a
      // bearer token). Daily by default because Hobby plans reject anything
      // more frequent; set RECONCILE_CRON_SCHEDULE (e.g. "*/10 * * * *") on Pro.
      ...(command === "build"
        ? [
            nitro({
              preset: process.env.NITRO_PRESET || "vercel",
              noExternals: process.env.NITRO_NO_EXTERNALS === "1",
              vercel: {
                config: {
                  version: 3,
                  crons: [
                    {
                      path: "/api/cron/reconcile-payments",
                      schedule: process.env.RECONCILE_CRON_SCHEDULE || "0 5 * * *",
                    },
                  ],
                },
              },
            }),
          ]
        : []),
      viteReact(),
    ],
  };
});
