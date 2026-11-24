import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import sharp from "sharp";
import { join } from "node:path";
import { JPEG, NOT_AN_IMAGE, SHARED_ENV, createFakeSupabase } from "./helpers";
import { MemoryTransport, MediaError, readConfig } from "../src/lib/r2MediaCore";

// Tests for the admin photo server functions. TanStack Start, the request
// object and the Supabase auth lookup are replaced with in-memory doubles; the
// admin guard under test is the real one, so every endpoint is exercised through
// the same authorization path production uses. The R2 binding is also real,
// running over the in-memory transport. Nothing here reaches a database, a
// bucket or the network.

type Row = Record<string, unknown>;
type Result = { ok: boolean; data?: Row; error?: string; storage?: string };
type Call = (args: { data?: unknown }) => Promise<unknown>;

const TOKEN = "test-session-token";
const ADMIN_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ORDINARY_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const lib = join(import.meta.dir, "..", "src", "lib");

// --- doubles for what the server functions depend on -------------------------

const registered: Array<{ method: string }> = [];

mock.module("@tanstack/react-start", () => ({
  createServerFn: (options?: { method?: "GET" | "POST" }) => {
    const state = {
      method: options?.method ?? "GET",
      validate: undefined as ((data: unknown) => unknown) | undefined,
    };
    const chain = {
      validator(validate: (data: unknown) => unknown) {
        state.validate = validate;
        return chain;
      },
      handler(handler: (ctx: { data: unknown }) => Promise<unknown>) {
        registered.push({ method: state.method });
        // Async like the real client call, so validation failures reject too.
        return async (args: { data?: unknown } = {}) =>
          handler({ data: state.validate ? state.validate(args.data) : args.data, context: {} });
      },
    };
    return chain;
  },
}));

// The bearer token lives in a request header; the payload never carries it.
let authorization: string | null = null;
mock.module("@tanstack/react-start/server", () => ({
  getRequest: () => ({
    headers: new Headers(authorization ? { Authorization: authorization } : {}),
  }),
}));

// Supabase Auth double: one known token resolves to the signed-in user.
const auth = { userId: ADMIN_ID };
mock.module(join(lib, "supabase.server.ts"), () => ({
  supabase: {
    auth: {
      getUser: async (token: string) =>
        token === TOKEN
          ? { data: { user: { id: auth.userId } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } },
    },
  },
}));

const db = createFakeSupabase();
mock.module(join(lib, "supabase.admin.server.ts"), () => ({ supabaseAdmin: db.supabaseAdmin }));

// --- the real modules under test ---------------------------------------------

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

const photos = await import("../src/lib/adminPhotos.server");

const storage = binding.naplesMedia as unknown as { transport: MemoryTransport; config: unknown };
const configured = storage.config;
let transport: MemoryTransport;

// --- fixtures ----------------------------------------------------------------

const PROPERTY = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "one",
  name: "One",
  is_active: true,
};
const OTHER = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "two",
  name: "Two",
  is_active: true,
};
const ownKey = (name: string) =>
  `naples-coastal-stays/public/${PROPERTY.id}/photos/pending/${name}`;
const R2_KEY = ownKey("1-a.jpg");
const FOREIGN_KEY = `naples-coastal-stays/public/${OTHER.id}/photos/pending/1-b.jpg`;
const LEGACY_PATH = `naples-coastal-stays/${PROPERTY.id}/abc123`;
const LEGACY_URL = `https://res.cloudinary.com/demo-cloud/image/upload/v1755000000/${LEGACY_PATH}.jpg`;

const storedAt = (key: string) => `${SHARED_ENV.R2_BUCKET}/${key}`;

function seed(extra: Row[] = []): Record<string, Row[]> {
  return {
    properties: [PROPERTY, OTHER],
    property_photos: [
      {
        id: "photo-r2",
        property_id: PROPERTY.id,
        storage_path: R2_KEY,
        public_url: `https://media.example.test/${R2_KEY}`,
        alt: "",
        sort_order: 1,
        is_cover: true,
      },
      {
        id: "photo-legacy",
        property_id: PROPERTY.id,
        storage_path: LEGACY_PATH,
        public_url: LEGACY_URL,
        alt: "",
        sort_order: 2,
        is_cover: false,
      },
      {
        id: "photo-other",
        property_id: OTHER.id,
        storage_path: FOREIGN_KEY,
        public_url: `https://media.example.test/${FOREIGN_KEY}`,
        alt: "",
        sort_order: 1,
        is_cover: true,
      },
      ...extra,
    ],
  };
}

const uploadTo = (key: string, body: Buffer, contentType: string) =>
  transport.putObject({ bucket: SHARED_ENV.R2_BUCKET, key, body, contentType });

const call = (fn: Call, data: unknown) => fn({ data }) as Promise<Result>;
const rows = () => db.tables.property_photos ?? [];
const ids = () => rows().map((row) => row.id);

const signIn = (token: string | null = TOKEN) => {
  authorization = token ? `Bearer ${token}` : null;
};

const errorLog: string[] = [];
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  errorLog.length = 0;
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLog.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
  });
  transport = new MemoryTransport();
  storage.transport = transport;
  storage.config = configured;
  process.env["ADMIN_USER_IDS"] = ADMIN_ID;
  auth.userId = ADMIN_ID;
  signIn();
  db.reset(seed());
  await uploadTo(R2_KEY, JPEG, "image/jpeg");
});

afterEach(() => {
  errorSpy.mockRestore();
});

afterAll(() => {
  storage.transport = null;
  delete process.env["ADMIN_USER_IDS"];
  mock.restore();
});

const ticketFor = async (propertyId = PROPERTY.id) => {
  const result = await call(photos.getUploadTicket, {
    propertyId,
    contentType: "image/jpeg",
    byteSize: 1024,
  });
  if (!result.ok || !result.data) throw new Error(result.error || "no ticket");
  return result.data;
};

describe("authorization", () => {
  test("every write endpoint rejects a caller without an admin session before doing anything", async () => {
    signIn(null);
    const writes: Array<[string, () => Promise<Result>]> = [
      [
        "getUploadTicket",
        () =>
          call(photos.getUploadTicket, {
            propertyId: PROPERTY.id,
            contentType: "image/jpeg",
            byteSize: 10,
          }),
      ],
      [
        "savePropertyPhoto",
        () =>
          call(photos.savePropertyPhoto, {
            propertyId: PROPERTY.id,
            key: R2_KEY,
            mimeType: "image/jpeg",
          }),
      ],
      ["deletePropertyPhoto", () => call(photos.deletePropertyPhoto, { id: "photo-r2" })],
      [
        "setCoverPhoto",
        () => call(photos.setCoverPhoto, { id: "photo-legacy", propertyId: PROPERTY.id }),
      ],
      [
        "reorderPhotos",
        () =>
          call(photos.reorderPhotos, {
            propertyId: PROPERTY.id,
            orderedIds: ["photo-legacy", "photo-r2"],
          }),
      ],
    ];
    for (const [name, run] of writes) {
      expect(await run(), name).toEqual({ ok: false, error: "Unauthorized" });
    }
    expect(db.log).toEqual([]);
    expect(ids()).toEqual(["photo-r2", "photo-legacy", "photo-other"]);
    expect(transport.objects.size).toBe(1);
    // Fails when a write endpoint is added without being covered above.
    expect(registered.filter((fn) => fn.method === "POST")).toHaveLength(writes.length + 1);
  });

  test("the photo inventory is protected too, and no endpoint is a GET", async () => {
    signIn(null);
    await expect(call(photos.listPropertyPhotos, { propertyId: PROPERTY.id })).rejects.toThrow(
      "Unauthorized",
    );
    expect(db.log).toEqual([]);
    expect(registered.filter((fn) => fn.method === "GET")).toHaveLength(0);
  });

  test("an authenticated user who is not on the allowlist is refused", async () => {
    auth.userId = ORDINARY_ID;
    const result = await call(photos.deletePropertyPhoto, { id: "photo-r2" });
    expect(result).toEqual({ ok: false, error: "Forbidden" });
    expect(db.log).toEqual([]);
    expect(transport.objects.size).toBe(1);
  });

  test("an allowlisted administrator is allowed", async () => {
    process.env["ADMIN_USER_IDS"] = `${ORDINARY_ID}, ${ADMIN_ID}`;
    auth.userId = ADMIN_ID;
    expect(await call(photos.deletePropertyPhoto, { id: "photo-r2" })).toEqual({
      ok: true,
      storage: "deleted",
    });
  });

  test("a missing allowlist fails closed for an otherwise valid session", async () => {
    delete process.env["ADMIN_USER_IDS"];
    const result = await call(photos.deletePropertyPhoto, { id: "photo-r2" });
    expect(result).toEqual({ ok: false, error: "Admin access is not configured." });
    expect(db.log).toEqual([]);
  });

  test("a token in the payload never authenticates: only the Authorization header does", async () => {
    signIn(null);
    const result = await call(photos.deletePropertyPhoto, {
      id: "photo-r2",
      accessToken: TOKEN,
    });
    expect(result).toEqual({ ok: false, error: "Unauthorized" });
    expect(db.log).toEqual([]);
  });
});

describe("getUploadTicket", () => {
  test("returns what the browser needs to upload, and nothing secret", async () => {
    const ticket = await ticketFor();
    expect(ticket.method).toBe("PUT");
    expect(ticket.headers).toEqual({ "content-type": "image/jpeg" });
    expect(ticket.maxBytes).toBe(10 * 1024 * 1024);
    expect(
      String(ticket.key).startsWith(`naples-coastal-stays/public/${PROPERTY.id}/photos/pending/`),
    ).toBe(true);
    expect(
      String(ticket.uploadUrl).startsWith(`${SHARED_ENV.R2_ENDPOINT}/${SHARED_ENV.R2_BUCKET}/`),
    ).toBe(true);
    expect(JSON.stringify(ticket).includes(SHARED_ENV.R2_SECRET_ACCESS_KEY)).toBe(false);
    // Issuing a ticket stores nothing and writes nothing.
    expect(db.log).toEqual(["properties.select"]);
    expect(transport.objects.size).toBe(1);
  });

  test("refuses a property that does not exist", async () => {
    const result = await call(photos.getUploadTicket, {
      propertyId: "missing",
      contentType: "image/jpeg",
      byteSize: 10,
    });
    expect(result).toEqual({ ok: false, error: "Property not found." });
  });

  test("rejects a size above the limit before doing anything", async () => {
    await expect(
      call(photos.getUploadTicket, {
        propertyId: PROPERTY.id,
        contentType: "image/jpeg",
        byteSize: 10 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow();
    expect(db.log).toEqual([]);
  });

  test("names the missing settings when R2 is not configured", async () => {
    storage.config = readConfig({});
    const result = await call(photos.getUploadTicket, {
      propertyId: PROPERTY.id,
      contentType: "image/jpeg",
      byteSize: 10,
    });
    expect(result).toEqual({
      ok: false,
      error:
        "R2 storage is not configured. Missing: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT, R2_PUBLIC_BASE_URL.",
    });
  });
});

describe("savePropertyPhoto", () => {
  const save = (key: string, mimeType = "image/jpeg") =>
    call(photos.savePropertyPhoto, {
      propertyId: PROPERTY.id,
      key,
      mimeType,
      alt: "Pool",
    });

  test("saves a verified upload as the next photo of the property", async () => {
    const ticket = await ticketFor();
    await uploadTo(ticket.key as string, JPEG, "image/jpeg");
    const result = await save(ticket.key as string);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      property_id: PROPERTY.id,
      storage_path: ticket.key,
      public_url: `https://media.example.test/${ticket.key}`,
      alt: "Pool",
      sort_order: 3,
      is_cover: false,
    });
  });

  test("optimises a real upload into a content-addressed original plus WebP variants", async () => {
    const realJpeg = await sharp({
      create: {
        width: 1600,
        height: 1000,
        channels: 3,
        background: { r: 30, g: 90, b: 140 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const ticket = await ticketFor();
    await uploadTo(ticket.key as string, realJpeg, "image/jpeg");
    const result = await save(ticket.key as string);
    expect(result.ok).toBe(true);

    const row = result.data as Row;
    expect(String(row.storage_path)).toMatch(/\/photos\/[a-f0-9]{64}\.w1600\.jpg$/);
    expect(row.public_url).toBe(`https://media.example.test/${row.storage_path}`);
    expect(row.public_url).not.toContain("/pending/");

    const keys = [...transport.objects.keys()];
    const variants = keys.filter((key) =>
      /\.w(350|447|528|538|640|700|828|1056|1076|1200|1600)\.webp$/.test(key),
    );
    expect(variants).toHaveLength(11);
    expect(keys.some((key) => key.endsWith(".w1920.webp"))).toBe(false);
    expect(keys.some((key) => key.endsWith(String(ticket.key)))).toBe(false);
  });

  test("discards an upload whose content is not the declared image type", async () => {
    const ticket = await ticketFor();
    await uploadTo(ticket.key as string, NOT_AN_IMAGE, "image/jpeg");
    const result = await save(ticket.key as string);
    expect(result).toEqual({
      ok: false,
      error: "The uploaded file is not the declared image type.",
    });
    expect(transport.objects.has(storedAt(ticket.key as string))).toBe(false);
    expect(ids()).toEqual(["photo-r2", "photo-legacy", "photo-other"]);
  });

  test("discards an upload that is larger than the limit", async () => {
    const ticket = await ticketFor();
    await uploadTo(
      ticket.key as string,
      Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]),
      "image/jpeg",
    );
    const result = await save(ticket.key as string);
    expect(result).toEqual({ ok: false, error: "Uploaded object size is invalid." });
    expect(transport.objects.has(storedAt(ticket.key as string))).toBe(false);
  });

  test("keeps the object when verification fails for a transient reason, so saving can be retried", async () => {
    const ticket = await ticketFor();
    await uploadTo(ticket.key as string, JPEG, "image/jpeg");
    transport.injectFailure(
      "head:*",
      new MediaError("MEDIA_STORAGE_UNAVAILABLE", "R2 HTTP 503: unavailable", 502),
    );
    const first = await save(ticket.key as string);
    expect(first).toEqual({ ok: false, error: "R2 HTTP 503: unavailable" });
    expect(transport.objects.has(storedAt(ticket.key as string))).toBe(true);

    transport.clearFailures();
    const retry = await save(ticket.key as string);
    expect(retry.ok).toBe(true);
  });

  test("refuses an object stored under another property and leaves it alone", async () => {
    await uploadTo(FOREIGN_KEY, JPEG, "image/jpeg");
    const result = await save(FOREIGN_KEY);
    expect(result).toEqual({ ok: false, error: "Object key is outside the authorized namespace." });
    expect(transport.objects.has(storedAt(FOREIGN_KEY))).toBe(true);
    expect(ids()).toEqual(["photo-r2", "photo-legacy", "photo-other"]);
  });

  test("removes the stored object when the photo row cannot be created", async () => {
    const ticket = await ticketFor();
    await uploadTo(ticket.key as string, JPEG, "image/jpeg");
    db.failNext("property_photos.insert", "insert failed");
    const result = await save(ticket.key as string);
    // The raw database error is never returned to the caller.
    expect(result).toEqual({ ok: false, error: "Could not save the photo. Please try again." });
    expect(transport.objects.has(storedAt(ticket.key as string))).toBe(false);
  });

  test("refuses a property that does not exist", async () => {
    const result = await call(photos.savePropertyPhoto, {
      propertyId: "missing",
      key: R2_KEY,
      mimeType: "image/jpeg",
    });
    expect(result).toEqual({ ok: false, error: "Property not found." });
    expect(transport.objects.size).toBe(1);
  });

  test("removes the stored object when the existing photos cannot be read", async () => {
    const ticket = await ticketFor();
    await uploadTo(ticket.key as string, JPEG, "image/jpeg");
    db.failNext("property_photos.select", "select failed");
    const result = await save(ticket.key as string);
    expect(result).toEqual({
      ok: false,
      error: "Could not check the existing photos. Please try again.",
    });
    expect(transport.objects.has(storedAt(ticket.key as string))).toBe(false);
    expect(ids()).toEqual(["photo-r2", "photo-legacy", "photo-other"]);
  });
});

describe("logging", () => {
  test("reports storage problems by code and never writes the credentials to the log", async () => {
    storage.config = readConfig({});
    await call(photos.getUploadTicket, {
      propertyId: PROPERTY.id,
      contentType: "image/jpeg",
      byteSize: 10,
    });
    storage.config = configured;

    const ticket = await ticketFor();
    await uploadTo(ticket.key as string, NOT_AN_IMAGE, "image/jpeg");
    await call(photos.savePropertyPhoto, {
      propertyId: PROPERTY.id,
      key: ticket.key,
      mimeType: "image/jpeg",
    });

    transport.injectFailure(
      "delete:*",
      new MediaError("MEDIA_STORAGE_UNAVAILABLE", "R2 HTTP 503: unavailable", 502),
    );
    await call(photos.deletePropertyPhoto, { id: "photo-r2" });

    expect(errorLog).toEqual([
      "Error in getUploadTicket: R2_NOT_CONFIGURED",
      "Error in savePropertyPhoto: MEDIA_MAGIC_MISMATCH",
      "R2 photo cleanup pending: MEDIA_STORAGE_UNAVAILABLE",
    ]);
    expect(errorLog.join("\n")).not.toContain(SHARED_ENV.R2_SECRET_ACCESS_KEY);
    expect(errorLog.join("\n")).not.toContain(SHARED_ENV.R2_ACCESS_KEY_ID);
  });
});

describe("deletePropertyPhoto", () => {
  const remove = (id: string) => call(photos.deletePropertyPhoto, { id });

  test("deletes a photo stored in R2 together with its file", async () => {
    expect(await remove("photo-r2")).toEqual({ ok: true, storage: "deleted" });
    expect(ids()).toEqual(["photo-legacy", "photo-other"]);
    expect(transport.objects.size).toBe(0);
  });

  test("never deletes the remote original of a photo that is not stored in R2", async () => {
    expect(await remove("photo-legacy")).toEqual({ ok: true, storage: "legacy-kept" });
    expect(ids()).toEqual(["photo-r2", "photo-other"]);
    expect(transport.objects.size).toBe(1);
  });

  test("keeps a file that another photo still uses", async () => {
    db.reset(
      seed([
        {
          id: "photo-twin",
          property_id: PROPERTY.id,
          storage_path: R2_KEY,
          public_url: `https://media.example.test/${R2_KEY}`,
          alt: "",
          sort_order: 3,
          is_cover: false,
        },
      ]),
    );
    expect(await remove("photo-r2")).toEqual({ ok: true, storage: "shared-kept" });
    expect(transport.objects.size).toBe(1);
    expect(await remove("photo-twin")).toEqual({ ok: true, storage: "deleted" });
    expect(transport.objects.size).toBe(0);
  });

  test("keeps the file when it cannot confirm what else uses it", async () => {
    // First select fetches the photo; the second counts the remaining references.
    db.failNext("property_photos.select", "count failed", 1);
    expect(await remove("photo-r2")).toEqual({ ok: true, storage: "cleanup-pending" });
    expect(ids()).toEqual(["photo-legacy", "photo-other"]);
    expect(transport.objects.size).toBe(1);
  });

  test("removes the row but reports pending cleanup when storage cannot delete", async () => {
    transport.injectFailure(
      "delete:*",
      new MediaError("MEDIA_STORAGE_UNAVAILABLE", "R2 HTTP 503: unavailable", 502),
    );
    expect(await remove("photo-r2")).toEqual({ ok: true, storage: "cleanup-pending" });
    expect(ids()).toEqual(["photo-legacy", "photo-other"]);
    expect(transport.objects.size).toBe(1);
  });

  test("promotes the next photo to cover when the cover is deleted", async () => {
    await remove("photo-r2");
    expect(rows().find((row) => row.id === "photo-legacy")?.is_cover).toBe(true);
  });

  test("leaves everything alone when the photo does not exist", async () => {
    expect(await remove("missing")).toEqual({ ok: false, error: "Photo not found." });
    expect(transport.objects.size).toBe(1);
  });
});

describe("setCoverPhoto", () => {
  test("moves the cover inside the property", async () => {
    const result = await call(photos.setCoverPhoto, {
      id: "photo-legacy",
      propertyId: PROPERTY.id,
    });
    expect(result).toEqual({ ok: true });
    expect(rows().map((row) => [row.id, row.is_cover])).toEqual([
      ["photo-r2", false],
      ["photo-legacy", true],
      ["photo-other", true],
    ]);
  });

  test("refuses a photo that belongs to another property", async () => {
    const result = await call(photos.setCoverPhoto, {
      id: "photo-other",
      propertyId: PROPERTY.id,
    });
    expect(result).toEqual({ ok: false, error: "Photo not found for this property." });
    expect(rows().map((row) => row.is_cover)).toEqual([true, false, true]);
  });
});

describe("reorderPhotos", () => {
  test("changes the order of this property's photos only", async () => {
    const result = await call(photos.reorderPhotos, {
      propertyId: PROPERTY.id,
      orderedIds: ["photo-legacy", "photo-r2", "photo-other"],
    });
    expect(result).toEqual({ ok: true });
    expect(rows().map((row) => [row.id, row.sort_order])).toEqual([
      ["photo-r2", 1],
      ["photo-legacy", 0],
      ["photo-other", 1],
    ]);
  });
});

describe("listPropertyPhotos", () => {
  test("lists a property's photos in display order", async () => {
    const result = await call(photos.listPropertyPhotos, { propertyId: PROPERTY.id });
    expect(Array.isArray(result) ? result.map((row) => row.id) : result).toEqual([
      "photo-r2",
      "photo-legacy",
    ]);
  });
});
