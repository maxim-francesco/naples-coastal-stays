import { describe, expect, test } from "bun:test";
import {
  applyDatabaseUpdates,
  buildManifest,
  buildRollbackPlan,
  mimeForSourceUrl,
  objectsForEntry,
  proposeDatabaseUpdate,
  propertyMediaPrefix,
  rollbackDatabaseUpdates,
  runMigration,
  summarizeManifest,
} from "../scripts/r2-photo-migration.mjs";
import { MemoryTransport, R2MediaStorage } from "../src/lib/r2MediaCore.ts";

const CLOUD =
  "https://res.cloudinary.com/demo-cloud/image/upload/v1755000000/naples-coastal-stays/";
const SOURCE_WIDTH = 1600;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
function jpeg(tag: number) {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, tag]);
}
function webp(tag: number) {
  return Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from("WEBPVP8 "),
    Buffer.from([tag, 0x00, 0x00, 0x00]),
  ]);
}

// Deterministic stand-in for the sharp pipeline, so this suite tests the copy
// loop rather than the encoder. The real encoder is covered separately.
const prepare = async (buffer: Buffer) => {
  const tag = buffer[buffer.length - 1] ?? 0;
  return {
    width: SOURCE_WIDTH,
    height: 1000,
    format: "jpeg",
    variants: [
      { width: 640, mimeType: "image/webp" as const, buffer: webp(tag + 1) },
      { width: 1200, mimeType: "image/webp" as const, buffer: webp(tag + 2) },
    ],
  };
};

function snapshot(overrides: { photos?: any[] } = {}) {
  return {
    generatedAt: "2026-11-23T00:00:00.000Z",
    properties: [
      { id: "prop-1", slug: "one", name: "One", is_active: true },
      { id: "prop-2", slug: "two", name: "Two", is_active: true },
    ],
    photos: overrides.photos ?? [
      {
        id: "photo-1",
        propertyId: "prop-1",
        sortOrder: 0,
        isCover: true,
        isHero: false,
        alt: "front",
        storagePath: "naples-coastal-stays/prop-1/a",
        publicUrl: `${CLOUD}prop-1/a.jpg`,
        provider: "cloudinary",
        originalUrl: `${CLOUD}prop-1/a.jpg`,
        hasTransformation: false,
        extension: "jpg",
      },
      {
        id: "photo-2",
        propertyId: "prop-1",
        sortOrder: 1,
        isCover: false,
        isHero: false,
        alt: "back",
        storagePath: "naples-coastal-stays/prop-1/b",
        publicUrl: `${CLOUD}prop-1/b.jpg`,
        provider: "cloudinary",
        originalUrl: `${CLOUD}prop-1/b.jpg`,
        hasTransformation: false,
        extension: "jpg",
      },
      {
        id: "photo-3",
        propertyId: "prop-2",
        sortOrder: 1,
        isCover: true,
        isHero: true,
        alt: "lake",
        storagePath: "naples-coastal-stays/prop-2/c",
        publicUrl: `${CLOUD}prop-2/c.jpg`,
        provider: "cloudinary",
        originalUrl: `${CLOUD}prop-2/c.jpg`,
        hasTransformation: false,
        extension: "jpg",
      },
    ],
  };
}

function storage() {
  const transport = new MemoryTransport();
  const instance = new R2MediaStorage({
    app: "naples-coastal-stays",
    transport,
    bucket: "test-bucket",
    keyPrefix: "migration-test",
    publicBaseUrl: "https://media.example.test",
    maxBytes: 1024 * 1024,
  });
  return { transport, instance };
}

function fetcher(map: Record<string, Buffer>, failing: Set<string> = new Set()) {
  return async (url: string) => {
    if (failing.has(url)) return { ok: false, status: 503, bytes: Buffer.alloc(0) };
    const bytes = map[url];
    if (!bytes) return { ok: false, status: 404, bytes: Buffer.alloc(0) };
    return { ok: true, status: 200, bytes };
  };
}

describe("inventory -> manifest", () => {
  test("records before-values and keeps cover/order metadata", () => {
    const manifest = buildManifest(snapshot());
    expect(manifest.version).toBe(2);
    expect(manifest.entries).toHaveLength(3);
    const first = manifest.entries[0];
    expect(first).toMatchObject({
      photoId: "photo-1",
      propertyId: "prop-1",
      propertySlug: "one",
      isCover: true,
      sortOrder: 0,
      status: "pending",
      mimeType: "image/jpeg",
      width: null,
      variants: [],
      before: {
        storage_path: "naples-coastal-stays/prop-1/a",
        public_url: `${CLOUD}prop-1/a.jpg`,
      },
    });
    expect(summarizeManifest(manifest).counts.pending).toBe(3);
  });

  test("skips non-Cloudinary sources instead of dropping them", () => {
    const manifest = buildManifest(
      snapshot({
        photos: [
          {
            id: "r2-photo",
            propertyId: "prop-1",
            storagePath: "naples-coastal-stays/public/prop-1/x.jpg",
            publicUrl: "https://media.example.test/naples-coastal-stays/public/prop-1/x.jpg",
            provider: "r2",
            originalUrl: null,
            sortOrder: 0,
            isCover: false,
          },
          {
            id: "mystery",
            propertyId: "prop-1",
            storagePath: null,
            publicUrl: "",
            provider: "none",
            originalUrl: null,
            sortOrder: 1,
            isCover: false,
          },
        ],
      }),
    );
    expect(manifest.entries.map((entry: any) => entry.status)).toEqual(["skipped", "skipped"]);
    expect(manifest.entries[0].before.public_url).toContain("media.example.test");
  });

  test("mime detection and prefix helper", () => {
    expect(mimeForSourceUrl(`${CLOUD}a.jpg`)).toBe("image/jpeg");
    expect(mimeForSourceUrl(`${CLOUD}a.webp?x=1`)).toBe("image/webp");
    expect(mimeForSourceUrl(`${CLOUD}a.txt`)).toBeNull();
    expect(propertyMediaPrefix("app", "p1")).toBe("app/public/p1");
    expect(propertyMediaPrefix("app", "p1", "/media/")).toBe("media/app/public/p1");
  });
});

describe("copy run", () => {
  test("uploads the original with a width marker plus WebP variants", async () => {
    const { instance } = storage();
    const sources = {
      [`${CLOUD}prop-1/a.jpg`]: jpeg(1),
      [`${CLOUD}prop-1/b.jpg`]: jpeg(2),
      [`${CLOUD}prop-2/c.jpg`]: jpeg(3),
    };
    const manifest = buildManifest(snapshot());
    const summary = await runMigration({
      manifest,
      fetchBytes: fetcher(sources),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
    });
    expect(summary.counts.uploaded).toBe(3);
    expect(summary.counts.failed).toBe(0);
    expect(summary.variantObjects).toBe(6);

    for (const entry of manifest.entries as any[]) {
      expect(entry.status).toBe("uploaded");
      expect(entry.key).toBe(
        `migration-test/naples-coastal-stays/public/${entry.propertyId}/photos/${entry.sha256}.w${SOURCE_WIDTH}.jpg`,
      );
      expect(entry.publicUrl).toBe(`https://media.example.test/${entry.key}`);
      expect(entry.width).toBe(SOURCE_WIDTH);
      expect(entry.height).toBe(1000);
      expect(entry.variants).toHaveLength(2);
      expect(entry.variants[0].key).toBe(
        `migration-test/naples-coastal-stays/public/${entry.propertyId}/photos/${entry.sha256}.w640.webp`,
      );
      expect(entry.variants[1].key).toContain(".w1200.webp");
      expect(
        entry.variants.every((variant: any) =>
          variant.publicUrl.startsWith("https://media.example.test/"),
        ),
      ).toBe(true);
      const proposal = proposeDatabaseUpdate(entry);
      expect(proposal.after).toEqual({ storage_path: entry.key, public_url: entry.publicUrl });
      expect(proposal.before.public_url).toContain("res.cloudinary.com");
    }
  });

  test("re-running is idempotent and reuses identical objects", async () => {
    const { instance } = storage();
    const bytes = jpeg(7);
    const sources = { [`${CLOUD}prop-1/a.jpg`]: bytes, [`${CLOUD}prop-1/b.jpg`]: bytes };
    const first = buildManifest(snapshot({ photos: snapshot().photos.slice(0, 2) }));
    await runMigration({
      manifest: first,
      fetchBytes: fetcher(sources),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
    });
    const keys = first.entries.map((entry: any) => entry.key);
    expect(keys[0]).toBe(keys[1]);

    const second = buildManifest(snapshot({ photos: snapshot().photos.slice(0, 2) }));
    const summary = await runMigration({
      manifest: second,
      fetchBytes: fetcher(sources),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
    });
    expect(summary.counts.uploaded).toBe(2);
    expect(second.entries.every((entry: any) => entry.reused === true)).toBe(true);
    expect(
      second.entries.every((entry: any) => entry.variants.every((v: any) => v.reused === true)),
    ).toBe(true);
    expect(second.entries.map((entry: any) => entry.key)).toEqual(keys);
  });

  test("interruption keeps finished work and resumes the rest", async () => {
    const { instance } = storage();
    const sources = {
      [`${CLOUD}prop-1/a.jpg`]: jpeg(1),
      [`${CLOUD}prop-1/b.jpg`]: jpeg(2),
      [`${CLOUD}prop-2/c.jpg`]: jpeg(3),
    };
    const manifest = buildManifest(snapshot());
    const failures = new Set([`${CLOUD}prop-1/b.jpg`]);
    await runMigration({
      manifest,
      fetchBytes: fetcher(sources, failures),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
    });
    expect(manifest.entries.map((entry: any) => entry.status)).toEqual([
      "uploaded",
      "failed",
      "uploaded",
    ]);

    failures.clear();
    const summary = await runMigration({
      manifest,
      fetchBytes: fetcher(sources, failures),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
      resume: true,
    });
    expect(summary.counts.uploaded).toBe(3);
    expect(summary.counts.failed).toBe(0);
  });

  test("corrupt bytes are rejected before anything is stored", async () => {
    const { instance, transport } = storage();
    const manifest = buildManifest(snapshot({ photos: snapshot().photos.slice(0, 1) }));
    const summary = await runMigration({
      manifest,
      fetchBytes: fetcher({ [`${CLOUD}prop-1/a.jpg`]: Buffer.from("not an image at all") }),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
    });
    expect(summary.counts.failed).toBe(1);
    expect(manifest.entries[0].key).toBeNull();
    expect(transport.objects.size).toBe(0);
  });

  test("resume re-checks completed objects and retries damaged ones", async () => {
    const { instance, transport } = storage();
    const sources = { [`${CLOUD}prop-1/a.jpg`]: jpeg(1) };
    const manifest = buildManifest(snapshot({ photos: snapshot().photos.slice(0, 1) }));
    await runMigration({
      manifest,
      fetchBytes: fetcher(sources),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
    });
    const entry = manifest.entries[0];
    expect(transport.objects.size).toBe(3); // original + two variants
    for (const key of objectsForEntry(entry).map((object) => object.key)) {
      for (const storageKey of transport.objects.keys()) {
        if (storageKey.endsWith(key)) transport.objects.delete(storageKey);
      }
    }
    expect(entry.status).toBe("uploaded");
    const summary = await runMigration({
      manifest,
      fetchBytes: fetcher(sources),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
      resume: true,
    });
    expect(summary.counts.uploaded).toBe(1);
    expect(transport.objects.size).toBe(3);
  });
});

describe("rollback plan", () => {
  test("restores previous values and deletes only objects this run created", async () => {
    const { instance } = storage();
    const sources = {
      [`${CLOUD}prop-1/a.jpg`]: jpeg(1),
      [`${CLOUD}prop-1/b.jpg`]: jpeg(2),
    };
    const manifest = buildManifest(snapshot({ photos: snapshot().photos.slice(0, 2) }));
    await runMigration({
      manifest,
      fetchBytes: fetcher(sources),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
    });
    const plan = buildRollbackPlan(manifest);
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0].restore).toEqual({
      storage_path: "naples-coastal-stays/prop-1/a",
      public_url: `${CLOUD}prop-1/a.jpg`,
    });
    expect(plan.deletableKeys).toHaveLength(6);
    expect(plan.retainedKeys).toHaveLength(0);
  });

  test("an object shared by two rows is retained", async () => {
    const { instance } = storage();
    const shared = jpeg(9);
    const sources = { [`${CLOUD}prop-1/a.jpg`]: shared, [`${CLOUD}prop-1/b.jpg`]: shared };
    const manifest = buildManifest(snapshot({ photos: snapshot().photos.slice(0, 2) }));
    await runMigration({
      manifest,
      fetchBytes: fetcher(sources),
      storage: instance,
      maxBytes: 1024 * 1024,
      prepare,
    });
    const plan = buildRollbackPlan(manifest);
    expect(plan.deletableKeys).toHaveLength(0);
    expect(plan.retainedKeys).toHaveLength(3);
  });
});

function proposal(id: string) {
  return {
    photoId: id,
    before: { storage_path: `old/${id}`, public_url: `https://old.test/${id}.jpg` },
    after: { storage_path: `new/${id}`, public_url: `https://new.test/${id}.jpg` },
  };
}

// Compare-and-set adapter: a row is only written when it still holds the
// values the caller expected, mirroring the conditional UPDATE used in
// production.
function fakeDatabase(rows: Record<string, any>, conflictAt?: string) {
  return {
    rows,
    async updatePhoto(id: string, { before, after }: any) {
      if (id === conflictAt) return { ok: false, reason: "forced_conflict" };
      const row = rows[id];
      if (
        !row ||
        row.storage_path !== before.storage_path ||
        row.public_url !== before.public_url
      ) {
        return { ok: false, reason: "conflict" };
      }
      Object.assign(row, after);
      return { ok: true };
    },
    async restorePhoto(id: string, { expected, restore }: any) {
      const row = rows[id];
      if (
        !row ||
        row.storage_path !== expected.storage_path ||
        row.public_url !== expected.public_url
      ) {
        return { ok: false, reason: "conflict" };
      }
      Object.assign(row, restore);
      return { ok: true };
    },
  };
}

describe("database apply and rollback", () => {
  test("updates every proposed row one at a time", async () => {
    const db = fakeDatabase({
      p1: { storage_path: "old/p1", public_url: "https://old.test/p1.jpg" },
      p2: { storage_path: "old/p2", public_url: "https://old.test/p2.jpg" },
    });
    const result = await applyDatabaseUpdates({ proposals: [proposal("p1"), proposal("p2")], db });
    expect(result.ok).toBe(true);
    expect(result.applied.map((row: any) => row.photoId)).toEqual(["p1", "p2"]);
    expect(db.rows.p1.storage_path).toBe("new/p1");
    expect(db.rows.p2.public_url).toBe("https://new.test/p2.jpg");
  });

  test("stops at the first conflicting row and reports what was applied", async () => {
    const db = fakeDatabase(
      {
        p1: { storage_path: "old/p1", public_url: "https://old.test/p1.jpg" },
        p2: { storage_path: "old/p2", public_url: "https://old.test/p2.jpg" },
      },
      "p2",
    );
    const result = await applyDatabaseUpdates({ proposals: [proposal("p1"), proposal("p2")], db });
    expect(result.ok).toBe(false);
    expect(result.applied.map((row: any) => row.photoId)).toEqual(["p1"]);
    expect(result.failed).toEqual({ photoId: "p2", reason: "forced_conflict" });
    expect(db.rows.p2.storage_path).toBe("old/p2");
  });

  test("restores applied rows and never overwrites a row changed afterwards", async () => {
    const db = fakeDatabase({
      p1: { storage_path: "old/p1", public_url: "https://old.test/p1.jpg" },
      p2: { storage_path: "old/p2", public_url: "https://old.test/p2.jpg" },
    });
    const applied = await applyDatabaseUpdates({ proposals: [proposal("p1"), proposal("p2")], db });
    expect(applied.ok).toBe(true);
    db.rows.p2.storage_path = "edited/by/someone-else";

    const result = await rollbackDatabaseUpdates({ applied: applied.applied, db });
    expect(result.restored).toEqual(["p1"]);
    expect(result.skipped).toEqual([{ photoId: "p2", reason: "conflict" }]);
    expect(db.rows.p1.storage_path).toBe("old/p1");
    expect(db.rows.p2.storage_path).toBe("edited/by/someone-else");
  });
});
