import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Static release checks for the security-only candidate. These do not prove the
// runtime is safe by themselves; they catch the specific regressions this
// release exists to fix: leaked development credentials and a guard that does
// not consult the server-only allowlist.

const root = join(import.meta.dir, "..");
const src = join(root, "src");

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

const sources = filesUnder(src).filter((path) => /\.(ts|tsx)$/.test(path));
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => path.slice(src.length + 1).replaceAll("\\", "/");

describe("source scan", () => {
  test("no development admin credential references exist in the source", () => {
    const offenders = sources.filter((path) => read(path).includes("VITE_DEV_ADMIN"));
    expect(offenders.map(rel)).toEqual([]);
  });

  test("the admin guard reads the server-only allowlist", () => {
    const guard = read(join(src, "lib", "authGuard.server.ts"));
    expect(guard).toContain("ADMIN_USER_IDS");
    expect(guard).toContain("process.env");
    expect(guard).not.toContain("VITE_ADMIN");
  });

  test("the browser client only reads browser-safe Supabase values", () => {
    const client = read(join(src, "lib", "supabase.client.ts"));
    expect(client).toContain("VITE_SUPABASE_URL");
    expect(client).toContain("VITE_SUPABASE_ANON_KEY");
    expect(client).not.toContain("SERVICE_ROLE");
    expect(client).not.toContain("ADMIN_USER_IDS");
  });

  test("the build disables the wrapper's all-VITE_* define injection", () => {
    const config = read(join(root, "vite.config.ts"));
    expect(config).toContain("envDefine: false");
    expect(config).toContain('envPrefix: ["VITE_SUPABASE_", "VITE_CLOUDINARY_"]');
  });
});
