// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// rpc-websockets (pulled in by @solana/web3.js) only declares "browser"/"node"
// export conditions, neither of which the workerd SSR build matches. Resolve it
// to the browser build file directly so bundling succeeds in every environment.
const rpcWebsocketsBrowser = fileURLToPath(
  new URL("./node_modules/rpc-websockets/dist/index.browser.mjs", import.meta.url),
);
const browserBufferShim = fileURLToPath(new URL("./src/lib/buffer-polyfill.ts", import.meta.url));

// @solana-mobile/wallet-adapter-mobile (pulled in by @solana/wallet-adapter-react)
// calls Node's util.inherits at module scope, which throws in the workerd SSR
// runtime and 500s every server-rendered page. It is browser-only code, so stub
// it for SSR while the real module stays in the client bundle.
const solanaMobileSsrStub = fileURLToPath(
  new URL("./src/lib/solana-mobile-ssr-stub.ts", import.meta.url),
);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      mcpPlugin(),
      {
        name: "lamportpay-solana-mobile-ssr-stub",
        enforce: "pre",
        resolveId(id, _importer, options) {
          if (
            options?.ssr &&
            id.startsWith("@solana-mobile/wallet-adapter-mobile")
          ) {
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
    ],
    resolve: {
      alias: [
        { find: /^rpc-websockets$/, replacement: rpcWebsocketsBrowser },
        { find: /^rpc-websockets\/dist\/lib\/client$/, replacement: rpcWebsocketsBrowser },
        { find: /^node:buffer$/, replacement: browserBufferShim },
        { find: /^buffer$/, replacement: browserBufferShim },
        { find: /^buffer\/$/, replacement: browserBufferShim },
      ],
    },
  },
});
