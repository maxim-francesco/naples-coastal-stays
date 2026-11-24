// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // The wrapper injects every VITE_* value into import.meta.env by default,
  // bypassing envPrefix. Disable that injection so Vite's own envPrefix below
  // is authoritative and only browser-safe values reach the client bundle.
  envDefine: false,
  vite: {
    // Only browser-safe values may reach the client bundle. Narrowing the
    // prefix keeps development-only credentials such as VITE_DEV_ADMIN_* out
    // of `import.meta.env`, which TanStack Start serializes into client code.
    envPrefix: ["VITE_SUPABASE_", "VITE_CLOUDINARY_"],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    preset: "vercel",
  },
});
