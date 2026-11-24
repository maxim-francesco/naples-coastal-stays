import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { JPEG, SHARED_ENV, failure } from "./helpers";
import { MemoryTransport, readConfig } from "../src/lib/r2MediaCore";

// Unit tests for the application binding around the R2 media core. They run
// entirely in memory: the storage transport is swapped for an in-memory one and
// the configuration comes from synthetic fixtures that are removed from the
// environment as soon as the module has been loaded.

test("the test process runs without project credentials", () => {
  expect(process.env.NODE_ENV).toBe("test");
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "R2_SECRET_ACCESS_KEY"]) {
    expect(process.env[name]).toBeUndefined();
  }
});

const previous = new Map<string, string | undefined>();
for (const [name, value] of Object.entries(SHARED_ENV)) {
  previous.set(name, process.env[name]);
  process.env[name] = value;
}
const binding = await import("../src/lib/r2Media");
for (const [name, value] of previous) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const storage = binding.naplesMedia as unknown as { transport: MemoryTransport; config: unknown };
const configured = storage.config;
let transport: MemoryTransport;

beforeEach(() => {
  transport = new MemoryTransport();
  storage.transport = transport;
  storage.config = configured;
});

afterAll(() => {
  storage.transport = null;
});

describe("property media binding", () => {
  const propertyId = "11111111-1111-4111-8111-111111111111";
  const otherPropertyId = "22222222-2222-4222-8222-222222222222";
  const prefix = `naples-coastal-stays/public/${propertyId}`;

  test("gives each property its own namespace", () => {
    expect(binding.propertyMediaPrefix(propertyId)).toBe(prefix);
    expect(binding.NAPLES_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  test("issues tickets that can only write into that namespace", async () => {
    const ticket = await binding.createPropertyUploadTicket(propertyId, "image/jpeg", 1024);
    expect(ticket.key.startsWith(`${prefix}/photos/pending/`)).toBe(true);
    expect(ticket.key.endsWith(".jpg")).toBe(true);
    expect(ticket.method).toBe("PUT");
    expect(ticket.headers).toEqual({ "content-type": "image/jpeg" });
    expect(ticket.maxBytes).toBe(binding.NAPLES_IMAGE_MAX_BYTES);
    expect(JSON.stringify(ticket).includes(SHARED_ENV.R2_SECRET_ACCESS_KEY)).toBe(false);
  });

  test("verification accepts the property's own upload", async () => {
    const key = `${prefix}/photos/pending/1-a.jpg`;
    await transport.putObject({
      bucket: SHARED_ENV.R2_BUCKET,
      key,
      body: JPEG,
      contentType: "image/jpeg",
    });
    const verified = await binding.verifyPropertyUpload(propertyId, key, "image/jpeg");
    expect(verified.key).toBe(key);
    expect(verified.url).toBe(`https://media.example.test/${key}`);
  });

  test("verification refuses an object that belongs to another property", async () => {
    const foreign = `naples-coastal-stays/public/${otherPropertyId}/photos/pending/1-a.jpg`;
    const error = await failure(() =>
      binding.verifyPropertyUpload(propertyId, foreign, "image/jpeg"),
    );
    expect(error.code).toBe("MEDIA_KEY_FORBIDDEN");
  });

  test("recognises only this property's own R2 objects as deletable", () => {
    const own = `${prefix}/photos/pending/1-a.jpg`;
    const foreign = `naples-coastal-stays/public/${otherPropertyId}/photos/pending/1-a.jpg`;
    const cases: Array<[unknown, string | null]> = [
      [own, own],
      [`https://media.example.test/${own}`, own],
      [`https://media.example.test/${own}?v=2`, own],
      [foreign, null],
      [`https://media.example.test/${foreign}`, null],
      // Photos stored before R2: a Cloudinary URL and a Cloudinary public id.
      [
        "https://res.cloudinary.com/demo-cloud/image/upload/v1755000000/naples-coastal-stays/31c25214-42c5-4211-8b5d-28643ebbbe35/abc123.jpg",
        null,
      ],
      ["naples-coastal-stays/31c25214-42c5-4211-8b5d-28643ebbbe35/abc123", null],
      // Anything else on the internet, or a look-alike of the media host.
      ["https://a0.muscache.com/im/pictures/x.jpeg", null],
      [`https://media.example.test.attacker.example/${own}`, null],
      ["", null],
      [null, null],
      [42, null],
      [undefined, null],
    ];
    for (const [value, expected] of cases) {
      expect(binding.managedPropertyKey(value, propertyId)).toBe(expected);
    }
  });

  test("deletion refuses keys outside the property namespace", async () => {
    const foreign = `naples-coastal-stays/public/${otherPropertyId}/photos/pending/1-a.jpg`;
    await transport.putObject({
      bucket: SHARED_ENV.R2_BUCKET,
      key: foreign,
      body: JPEG,
      contentType: "image/jpeg",
    });
    const error = await failure(() => binding.deletePropertyObject(propertyId, foreign));
    expect(error.code).toBe("MEDIA_KEY_FORBIDDEN");
    expect(transport.objects.size).toBe(1);
  });

  test("deletion removes the object from the property namespace", async () => {
    const own = `${prefix}/photos/pending/1-a.jpg`;
    await transport.putObject({
      bucket: SHARED_ENV.R2_BUCKET,
      key: own,
      body: JPEG,
      contentType: "image/jpeg",
    });
    await binding.deletePropertyObject(propertyId, own);
    expect(transport.objects.size).toBe(0);
  });

  test("refuses to issue a ticket, naming the missing settings, when R2 is not configured", async () => {
    storage.config = readConfig({});
    const error = await failure(() =>
      binding.createPropertyUploadTicket(propertyId, "image/jpeg", 10),
    );
    expect(error.code).toBe("R2_NOT_CONFIGURED");
    expect(error.message).toBe(
      "R2 storage is not configured. Missing: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT, R2_PUBLIC_BASE_URL.",
    );
  });
});

describe("server-only protection", () => {
  const src = join(import.meta.dir, "..", "src");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
  }

  test("the R2 binding is marked server-only, so the bundler rejects client imports", () => {
    const source = readFileSync(join(src, "lib", "r2Media.ts"), "utf8");
    expect(source).toMatch(/import\s+["']@tanstack\/react-start\/server-only["']/);
  });

  test("only server modules import the R2 binding", () => {
    const importers = sourceFiles(src).filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["'][^"']*r2Media["']|import\(\s*["'][^"']*r2Media["']\s*\)/.test(source);
    });
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.every((file) => /\.server\.tsx?$/.test(file))).toBe(true);
  });
});
