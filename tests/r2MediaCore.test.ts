import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  DEFAULT_IMAGE_MAX_BYTES,
  MediaError,
  MemoryTransport,
  R2MediaStorage,
  R2SigV4Transport,
  assertKeyOwnedBy,
  buildObjectKey,
  buildPendingKey,
  canonicalQueryString,
  extForMime,
  mimeForExt,
  normalizeMimeType,
  presignUrl,
  readConfig,
  sha256Hex,
  signRequest,
  verifyMagicBytes,
  withRetry,
} from "../src/lib/r2MediaCore";
import { JPEG, PNG, SHARED_ENV, codeOf, failure } from "./helpers";

// Unit tests for the R2 media core. Everything runs in memory or over a
// loopback HTTP server: no request leaves this machine and no credential is
// read. The values below are synthetic fixtures and are never written to an
// environment file.

const TEST_ENV = { R2_ACCOUNT_ID: "00000000000000000000000000000000", ...SHARED_ENV };

const EMPTY_SHA256 = sha256Hex("");

const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from("VP8 ", "ascii"),
]);
const GIF = Buffer.from("GIF89a\u0000\u0000\u0000\u0000\u0000\u0000\u0000", "latin1");
const NOT_AN_IMAGE = Buffer.from("<html><body>nope</body></html>", "utf8");

function createStorage(
  env: Record<string, string> = TEST_ENV,
  options: Record<string, unknown> = {},
) {
  const transport = new MemoryTransport();
  const storage = new R2MediaStorage({ app: "test-app", env, transport, ...options });
  return { storage, transport };
}

function recording(transport: MemoryTransport) {
  const calls: string[] = [];
  const wrapped = new Proxy(transport, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { calls, transport: wrapped as MemoryTransport };
}

describe("configuration", () => {
  test("reads the documented names and infers the default endpoint", () => {
    const config = readConfig({
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "key-id",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "photos",
      R2_PUBLIC_BASE_URL: "https://media.example.test/",
    });
    expect(config.endpoint).toBe("https://account-id.r2.cloudflarestorage.com");
    expect(config.publicBaseUrl).toBe("https://media.example.test");
    expect(config.keyPrefix).toBe("");
  });

  test("accepts the CLOUDFLARE_R2_* aliases when the short names are absent", () => {
    const config = readConfig({
      CLOUDFLARE_R2_ACCOUNT_ID: "account-id",
      CLOUDFLARE_R2_ACCESS_KEY_ID: "alias-key",
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: "alias-secret",
      CLOUDFLARE_R2_ORIGINALS_BUCKET: "alias-bucket",
      CLOUDFLARE_R2_PUBLIC_CDN_URL: "https://alias.example.test",
    });
    expect(config.accessKeyId).toBe("alias-key");
    expect(config.secretAccessKey).toBe("alias-secret");
    expect(config.bucket).toBe("alias-bucket");
    expect(config.publicBaseUrl).toBe("https://alias.example.test");
  });

  test("prefers the short names over the aliases", () => {
    const config = readConfig({
      R2_BUCKET: "short-bucket",
      CLOUDFLARE_R2_ORIGINALS_BUCKET: "alias-bucket",
    });
    expect(config.bucket).toBe("short-bucket");
  });

  test("uses the EU endpoint for the eu jurisdiction", () => {
    const config = readConfig({ R2_ACCOUNT_ID: "account-id", R2_JURISDICTION: "EU" });
    expect(config.endpoint).toBe("https://account-id.eu.r2.cloudflarestorage.com");
  });

  test("lets an explicit endpoint win and strips its trailing slashes", () => {
    const config = readConfig({
      R2_ACCOUNT_ID: "account-id",
      R2_ENDPOINT: "https://storage.example.test///",
      R2_PUBLIC_BASE_URL: "https://media.example.test/",
    });
    expect(config.endpoint).toBe("https://storage.example.test");
  });

  test("does not fail at load time when the optional key prefix is invalid", () => {
    // Reading configuration must never throw: this module is evaluated when
    // the admin routes load, and a bad optional value would take the whole
    // admin area down instead of failing the one upload that needs it.
    const config = readConfig({ ...TEST_ENV, R2_KEY_PREFIX: "invalid prefix/with spaces" });
    expect(config.keyPrefix).toBe("invalid prefix/with spaces");
    const error = (() => {
      try {
        return buildObjectKey({
          app: "test-app",
          ownerId: "prop-1",
          category: "photos",
          digest: "a".repeat(64),
          ext: "jpg",
          keyPrefix: config.keyPrefix,
        });
      } catch (e) {
        return e as MediaError;
      }
    })();
    expect((error as MediaError).code).toBe("MEDIA_INVALID_IDENTIFIER");
  });

  test("reports an empty configuration as not configured", () => {
    const storage = new R2MediaStorage({ app: "test-app", env: {} });
    expect(storage.isConfigured()).toBe(false);
  });
});

describe("MIME types and magic bytes", () => {
  test("normalises declared MIME types and rejects anything that is not a supported image", () => {
    expect(normalizeMimeType("IMAGE/JPG")).toBe("image/jpeg");
    expect(normalizeMimeType(" image/png; charset=binary ")).toBe("image/png");
    expect(normalizeMimeType("image/svg+xml")).toBeNull();
    expect(normalizeMimeType("text/html")).toBeNull();
    expect(normalizeMimeType(42)).toBeNull();
    expect(extForMime("image/jpg")).toBe("jpg");
    expect(mimeForExt(".JPEG")).toBe("image/jpeg");
    expect(mimeForExt("svg")).toBeNull();
  });

  test("checks that the file contents really are the declared image type", () => {
    expect(verifyMagicBytes(PNG, "image/png")).toBe(true);
    expect(verifyMagicBytes(JPEG, "image/jpeg")).toBe(true);
    expect(verifyMagicBytes(WEBP, "image/webp")).toBe(true);
    expect(verifyMagicBytes(GIF, "image/gif")).toBe(true);
    expect(verifyMagicBytes(PNG, "image/jpeg")).toBe(false);
    expect(verifyMagicBytes(NOT_AN_IMAGE, "image/jpeg")).toBe(false);
    expect(verifyMagicBytes(Buffer.alloc(4), "image/jpeg")).toBe(false);
  });
});

describe("object keys", () => {
  const digest = "a".repeat(64);

  test("builds content-addressed keys inside the owner namespace", () => {
    expect(
      buildObjectKey({
        app: "naples-coastal-stays",
        visibility: "public",
        ownerId: "prop-1",
        category: "photos",
        digest,
        ext: ".JPG",
      }),
    ).toBe(`naples-coastal-stays/public/prop-1/photos/${digest}.jpg`);
    expect(
      buildObjectKey({
        app: "naples-coastal-stays",
        visibility: "private",
        ownerId: "prop-1",
        category: "documents",
        digest,
        ext: "png",
        keyPrefix: "/clients/naples/",
      }),
    ).toBe(`clients/naples/naples-coastal-stays/private/prop-1/documents/${digest}.png`);
  });

  test("rejects key material that could escape the namespace", () => {
    const base = { app: "test-app", ownerId: "prop-1", category: "photos", digest, ext: "jpg" };
    const codeOf = (patch: Record<string, unknown>) => {
      try {
        buildObjectKey({ ...base, ...patch } as Parameters<typeof buildObjectKey>[0]);
        return "none";
      } catch (e) {
        return (e as MediaError).code;
      }
    };
    expect(codeOf({ ownerId: "../other" })).toBe("MEDIA_INVALID_IDENTIFIER");
    expect(codeOf({ ownerId: "two words" })).toBe("MEDIA_INVALID_IDENTIFIER");
    expect(codeOf({ category: "photos/../private" })).toBe("MEDIA_INVALID_IDENTIFIER");
    expect(codeOf({ digest: "z".repeat(64) })).toBe("MEDIA_INVALID_DIGEST");
    expect(codeOf({ ext: "svg" })).toBe("MEDIA_INVALID_EXTENSION");
    expect(codeOf({ visibility: "publicx" })).toBe("MEDIA_INVALID_VISIBILITY");
  });

  test("issues unique pending keys under the owner namespace", () => {
    const args = {
      app: "test-app",
      visibility: "public",
      ownerId: "prop-1",
      category: "photos",
      ext: "jpg",
    };
    const first = buildPendingKey(args);
    const second = buildPendingKey(args);
    expect(first).toMatch(/^test-app\/public\/prop-1\/photos\/pending\/\d+-[0-9a-f-]{36}\.jpg$/);
    expect(first).not.toBe(second);
  });

  test("treats only the exact namespace or its children as owned", () => {
    const prefix = "test-app/public/prop-1";
    expect(assertKeyOwnedBy("test-app/public/prop-1/photos/pending/1-a.jpg", prefix)).toBe(
      "test-app/public/prop-1/photos/pending/1-a.jpg",
    );
    expect(assertKeyOwnedBy("/test-app/public/prop-1", prefix)).toBe("test-app/public/prop-1");
    const codeOf = (key: string) => {
      try {
        assertKeyOwnedBy(key, prefix);
        return "none";
      } catch (e) {
        return (e as MediaError).code;
      }
    };
    expect(codeOf("test-app/public/prop-2/photos/pending/1-a.jpg")).toBe("MEDIA_KEY_FORBIDDEN");
    expect(codeOf("test-app/public/prop-10/photos/pending/1-a.jpg")).toBe("MEDIA_KEY_FORBIDDEN");
    expect(codeOf("test-app/private/prop-1/photos/pending/1-a.jpg")).toBe("MEDIA_KEY_FORBIDDEN");
    expect(codeOf("test-app/public/prop-1/photos/../../prop-2/a.jpg")).toBe("MEDIA_INVALID_KEY");
    expect(codeOf("test-app/public/prop-1//a.jpg")).toBe("MEDIA_INVALID_KEY");
    expect(codeOf("test-app/public/prop-1/")).toBe("MEDIA_INVALID_KEY");
    expect(codeOf("test-app/public/prop-1/my file.jpg")).toBe("MEDIA_INVALID_KEY");
    expect(codeOf("")).toBe("MEDIA_INVALID_KEY");
  });
});

describe("signing", () => {
  // Independent SigV4 reference written from the AWS specification, used only
  // to cross-check the implementation under test.
  const hmac = (key: crypto.BinaryLike, data: string) =>
    crypto.createHmac("sha256", key).update(data, "utf8").digest();
  const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
  // Code-unit order, as the specification requires (not locale order).
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const encode = (value: string) =>
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );

  function referenceSigningKey(secret: string, date: string, region: string, service: string) {
    let key: crypto.BinaryLike = `AWS4${secret}`;
    for (const part of [date, region, service, "aws4_request"]) key = hmac(key, part);
    return key;
  }

  function referencePresign(input: {
    method: string;
    endpoint: string;
    bucket: string;
    key: string;
    expiresSeconds: number;
    signedHeaders: Record<string, string>;
    accessKeyId: string;
    secretAccessKey: string;
    now: Date;
  }) {
    const url = new URL(`/${input.bucket}/${input.key}`, input.endpoint);
    const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const scope = `${date}/auto/s3/aws4_request`;
    const headers: Record<string, string> = { host: url.host };
    for (const [name, value] of Object.entries(input.signedHeaders)) {
      if (name.toLowerCase() !== "host") headers[name.toLowerCase()] = value.trim();
    }
    const signedNames = Object.keys(headers).sort(byText);
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(input.expiresSeconds),
      "X-Amz-SignedHeaders": signedNames.join(";"),
    };
    const canonicalQuery = Object.entries(query)
      .map(([name, value]) => `${encode(name)}=${encode(value)}`)
      .sort(byText)
      .join("&");
    const canonicalHeaders = signedNames.map((name) => `${name}:${headers[name]}\n`).join("");
    const canonicalRequest = [
      input.method.toUpperCase(),
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedNames.join(";"),
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signature = hmac(
      referenceSigningKey(input.secretAccessKey, date, "auto", "s3"),
      stringToSign,
    ).toString("hex");
    return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  function referenceSign(input: {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    payloadHash: string;
    accessKeyId: string;
    secretAccessKey: string;
    now: Date;
  }) {
    const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const scope = `${date}/auto/s3/aws4_request`;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers))
      headers[name.toLowerCase()] = value.trim();
    headers["x-amz-date"] = amzDate;
    headers["x-amz-content-sha256"] = input.payloadHash;
    const signedNames = Object.keys(headers).sort(byText);
    const canonicalQuery = Object.entries(input.query)
      .map(([name, value]) => `${encode(name)}=${encode(value)}`)
      .sort(byText)
      .join("&");
    const canonicalRequest = [
      input.method.toUpperCase(),
      input.path,
      canonicalQuery,
      signedNames.map((name) => `${name}:${headers[name]}\n`).join(""),
      signedNames.join(";"),
      input.payloadHash,
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signature = hmac(
      referenceSigningKey(input.secretAccessKey, date, "auto", "s3"),
      stringToSign,
    ).toString("hex");
    return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
  }

  test("the reference signing key matches the vector published in the AWS SigV4 documentation", () => {
    // AWS "Signature Version 4" derivation example: secret wJalr…EXAMPLEKEY,
    // date 20120215, region us-east-1, service iam.
    expect(
      referenceSigningKey(
        "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        "20120215",
        "us-east-1",
        "iam",
      ).toString("hex"),
    ).toBe("f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
  });

  const credentials = {
    accessKeyId: TEST_ENV.R2_ACCESS_KEY_ID,
    secretAccessKey: TEST_ENV.R2_SECRET_ACCESS_KEY,
  };
  const now = new Date("2026-11-23T09:30:00.000Z");

  test("server request signatures match the independent reference", () => {
    const cases = [
      {
        method: "PUT",
        path: "/test-bucket/test-app/public/prop-1/photos/pending/1-a.jpg",
        query: {},
        headers: {
          Host: "storage.example.test",
          "Content-Type": "image/jpeg",
          "content-length": "4",
        },
        payloadHash: sha256Hex("test"),
      },
      {
        method: "GET",
        path: "/test-bucket/test-app/public/prop-1/photos/pending/1-a.jpg",
        query: { "list-type": "2", prefix: "a b" },
        headers: { host: "storage.example.test", Range: "bytes=0-63" },
        payloadHash: EMPTY_SHA256,
      },
      {
        method: "DELETE",
        path: "/test-bucket/a",
        query: {},
        headers: { host: "storage.example.test" },
        payloadHash: EMPTY_SHA256,
      },
    ];
    for (const input of cases) {
      const signed = signRequest({ ...input, ...credentials, now });
      expect(signed.authorization).toBe(referenceSign({ ...input, ...credentials, now }));
      expect(signed.amzDate).toBe("20261123T093000Z");
      expect(signed.headers["x-amz-content-sha256"]).toBe(input.payloadHash);
    }
  });

  test("presigned URLs match the independent reference and never contain the secret", () => {
    const inputs = [
      {
        method: "PUT",
        key: "test-app/public/prop-1/photos/pending/1-a.jpg",
        expiresSeconds: 900,
        signedHeaders: { "content-type": "image/jpeg" },
      },
      {
        method: "GET",
        key: "test-app/public/prop-1/photos/aa.jpg",
        expiresSeconds: 3600,
        signedHeaders: {},
      },
    ];
    for (const input of inputs) {
      const presigned = presignUrl({
        ...input,
        endpoint: TEST_ENV.R2_ENDPOINT,
        bucket: TEST_ENV.R2_BUCKET,
        ...credentials,
        now,
      });
      expect(presigned.url).toBe(
        referencePresign({
          ...input,
          endpoint: TEST_ENV.R2_ENDPOINT,
          bucket: TEST_ENV.R2_BUCKET,
          ...credentials,
          now,
        }),
      );
      expect(presigned.url.includes(TEST_ENV.R2_SECRET_ACCESS_KEY)).toBe(false);
    }
  });

  test("presigned URLs clamp the expiry and list only the headers the caller must send", () => {
    const base = {
      endpoint: TEST_ENV.R2_ENDPOINT,
      bucket: TEST_ENV.R2_BUCKET,
      key: "k.jpg",
      signedHeaders: { "content-type": "image/webp" },
      ...credentials,
      now,
    };
    const tooLong = presignUrl({ ...base, method: "PUT", expiresSeconds: 10 * 24 * 3600 });
    expect(tooLong.url).toContain("X-Amz-Expires=604800");
    const tooShort = presignUrl({ ...base, method: "PUT", expiresSeconds: 0 });
    expect(tooShort.url).toContain("X-Amz-Expires=1");
    const ticket = presignUrl({ ...base, method: "PUT", expiresSeconds: 900 });
    expect(ticket.method).toBe("PUT");
    expect(ticket.signedHeaders).toEqual({ "content-type": "image/webp" });
    expect(ticket.url).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
    expect(new Date(ticket.expiresAt).getTime()).toBe(now.getTime() + 900_000);
  });

  test("builds canonical query strings", () => {
    expect(canonicalQueryString({ b: "x y", a: "~", c: "a*b" })).toBe("a=~&b=x%20y&c=a%2Ab");
  });
});

describe("R2MediaStorage.uploadImage", () => {
  test("stores a verified, content-addressed object and returns its public URL", async () => {
    const { storage, transport } = createStorage();
    const result = await storage.uploadImage({
      buffer: PNG,
      mimeType: "image/png",
      ownerId: "prop-1",
      category: "photos",
    });
    const digest = sha256Hex(PNG);
    expect(result).toEqual({
      key: `test-app/public/prop-1/photos/${digest}.png`,
      bucket: "test-bucket",
      sha256: digest,
      bytes: PNG.length,
      mimeType: "image/png",
      visibility: "public",
      reused: false,
      url: `https://media.example.test/test-app/public/prop-1/photos/${digest}.png`,
    });
    const stored = await transport.headObject({ bucket: "test-bucket", key: result.key });
    expect(stored.contentLength).toBe(PNG.length);
    expect(stored.contentType).toBe("image/png");
    expect(stored.metadata).toMatchObject({
      sha256: digest,
      bytes: String(PNG.length),
      visibility: "public",
    });
  });

  test("reuses an identical object instead of writing it again", async () => {
    const { storage, transport } = createStorage();
    const first = await storage.uploadImage({
      buffer: JPEG,
      mimeType: "image/jpeg",
      ownerId: "prop-1",
      category: "photos",
    });
    const second = await storage.uploadImage({
      buffer: JPEG,
      mimeType: "image/jpeg",
      ownerId: "prop-1",
      category: "photos",
    });
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.key).toBe(first.key);
    expect(transport.objects.size).toBe(1);
  });

  test("refuses to treat a different object as a match for the same content key", async () => {
    const { storage, transport } = createStorage();
    const key = `test-app/public/prop-1/photos/${sha256Hex(PNG)}.png`;
    await transport.putObject({ bucket: "test-bucket", key, body: JPEG, contentType: "image/png" });
    const error = await failure(() =>
      storage.uploadImage({
        buffer: PNG,
        mimeType: "image/png",
        ownerId: "prop-1",
        category: "photos",
      }),
    );
    expect(error.code).toBe("MEDIA_CONFLICT");
    // The pre-existing object is left untouched.
    expect((await transport.headObject({ bucket: "test-bucket", key })).contentLength).toBe(
      JPEG.length,
    );
  });

  test("deletes its own object when verification after writing fails", async () => {
    class TamperingTransport extends MemoryTransport {
      async putObject(args: {
        bucket: string;
        key: string;
        body: Buffer;
        contentType: string;
        metadata?: Record<string, string>;
      }) {
        return super.putObject({ ...args, metadata: { ...args.metadata, sha256: "0".repeat(64) } });
      }
    }
    const transport = new TamperingTransport();
    const storage = new R2MediaStorage({ app: "test-app", env: TEST_ENV, transport });
    const error = await failure(() =>
      storage.uploadImage({
        buffer: PNG,
        mimeType: "image/png",
        ownerId: "prop-1",
        category: "photos",
      }),
    );
    expect(error.code).toBe("MEDIA_VERIFICATION_FAILED");
    expect(transport.objects.size).toBe(0);
  });

  test("refuses files that are empty, too large, mistyped or not really images", async () => {
    const { storage, transport } = createStorage();
    const upload = (patch: Record<string, unknown>) =>
      storage.uploadImage({
        buffer: PNG,
        mimeType: "image/png",
        ownerId: "prop-1",
        category: "photos",
        ...patch,
      } as never);
    expect((await failure(() => upload({ buffer: Buffer.alloc(0) }))).code).toBe("MEDIA_EMPTY");
    expect((await failure(() => upload({ buffer: PNG, maxBytes: 8 }))).code).toBe(
      "MEDIA_TOO_LARGE",
    );
    expect((await failure(() => upload({ mimeType: "image/svg+xml" }))).code).toBe(
      "MEDIA_INVALID_TYPE",
    );
    expect((await failure(() => upload({ mimeType: "image/jpeg" }))).code).toBe(
      "MEDIA_MAGIC_MISMATCH",
    );
    expect(
      (await failure(() => upload({ buffer: NOT_AN_IMAGE, mimeType: "image/jpeg" }))).code,
    ).toBe("MEDIA_MAGIC_MISMATCH");
    expect(transport.objects.size).toBe(0);
  });

  test("gives private objects no public URL", async () => {
    const { storage } = createStorage();
    const result = await storage.uploadImage({
      buffer: JPEG,
      mimeType: "image/jpeg",
      ownerId: "prop-1",
      category: "documents",
      visibility: "private",
    });
    expect(result.url).toBeNull();
    expect(result.key).toContain("/private/");
    expect((await failure(() => storage.publicUrl(result.key))).code).toBe("MEDIA_PRIVATE_OBJECT");
  });

  test("fails clearly when R2 is not configured", async () => {
    const storage = new R2MediaStorage({ app: "test-app", env: {} });
    const error = await failure(() =>
      storage.uploadImage({
        buffer: JPEG,
        mimeType: "image/jpeg",
        ownerId: "prop-1",
        category: "photos",
      }),
    );
    expect(error.code).toBe("R2_NOT_CONFIGURED");
    expect(error.details).toEqual({
      missing: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT"],
    });
  });

  test("puts the pixel width in the key when one is supplied", async () => {
    const { storage } = createStorage();
    const result = await storage.uploadImage({
      buffer: JPEG,
      mimeType: "image/jpeg",
      ownerId: "prop-1",
      category: "photos",
      width: 1600,
    });
    expect(result.key).toBe(`test-app/public/prop-1/photos/${sha256Hex(JPEG)}.w1600.jpg`);
    expect(
      (
        await failure(() =>
          storage.uploadImage({
            buffer: JPEG,
            mimeType: "image/jpeg",
            ownerId: "prop-1",
            category: "photos",
            width: 0,
          }),
        )
      ).code,
    ).toBe("MEDIA_INVALID_WIDTH");
  });
});

describe("R2MediaStorage.putPublicImage", () => {
  const WEBP = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from("WEBPVP8 "),
    Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]),
  ]);
  const key = `test-app/public/prop-1/photos/${"a".repeat(64)}.w640.webp`;
  const prefix = "test-app/public/prop-1";

  test("stores a derivative at the exact key and returns its URL", async () => {
    const { storage, transport } = createStorage();
    const result = await storage.putPublicImage({
      key,
      buffer: WEBP,
      mimeType: "image/webp",
      expectedPrefix: prefix,
    });
    expect(result.key).toBe(key);
    expect(result.url).toBe(`https://media.example.test/${key}`);
    expect(result.reused).toBe(false);
    expect(transport.objects.get(`test-bucket/${key}`)?.body.equals(WEBP)).toBe(true);
  });

  test("never overwrites: an identical object is reused, a different one is a conflict", async () => {
    const { storage, transport } = createStorage();
    await storage.putPublicImage({
      key,
      buffer: WEBP,
      mimeType: "image/webp",
      expectedPrefix: prefix,
    });
    const reused = await storage.putPublicImage({
      key,
      buffer: WEBP,
      mimeType: "image/webp",
      expectedPrefix: prefix,
    });
    expect(reused.reused).toBe(true);

    const other = Buffer.concat([WEBP.subarray(0, 12), Buffer.from([9, 9, 9, 9])]);
    const error = await failure(() =>
      storage.putPublicImage({
        key,
        buffer: other,
        mimeType: "image/webp",
        expectedPrefix: prefix,
      }),
    );
    expect(error.code).toBe("MEDIA_CONFLICT");
    expect(transport.objects.get(`test-bucket/${key}`)?.body.equals(WEBP)).toBe(true);
  });

  test("rejects keys outside the property namespace and bad image bytes", async () => {
    const { storage } = createStorage();
    expect(
      (
        await failure(() =>
          storage.putPublicImage({
            key: "test-app/public/other/photos/x.w640.webp",
            buffer: WEBP,
            mimeType: "image/webp",
            expectedPrefix: prefix,
          }),
        )
      ).code,
    ).toBe("MEDIA_KEY_FORBIDDEN");
    expect(
      (
        await failure(() =>
          storage.putPublicImage({
            key,
            buffer: JPEG,
            mimeType: "image/webp",
            expectedPrefix: prefix,
          }),
        )
      ).code,
    ).toBe("MEDIA_MAGIC_MISMATCH");
  });
});

describe("R2MediaStorage.createPendingUpload", () => {
  test("issues a presigned PUT that can only write one key in the owner namespace", async () => {
    const { storage } = createStorage();
    const before = Date.now();
    const ticket = await storage.createPendingUpload({
      ownerId: "prop-1",
      category: "photos",
      mimeType: "image/jpg",
      byteSize: 1024,
      visibility: "public",
      maxBytes: 2048,
      expiresSeconds: 900,
    });
    expect(ticket.mimeType).toBe("image/jpeg");
    expect(ticket.bucket).toBe("test-bucket");
    expect(ticket.key).toMatch(
      /^test-app\/public\/prop-1\/photos\/pending\/\d+-[0-9a-f-]{36}\.jpg$/,
    );
    expect(ticket.method).toBe("PUT");
    expect(ticket.headers).toEqual({ "content-type": "image/jpeg" });
    expect(ticket.maxBytes).toBe(2048);
    expect(ticket.visibility).toBe("public");
    expect(
      ticket.uploadUrl.startsWith(`https://storage.example.test/test-bucket/${ticket.key}?`),
    ).toBe(true);
    expect(ticket.uploadUrl).toContain("X-Amz-Expires=900");
    expect(ticket.uploadUrl).toContain("X-Amz-Signature=");
    // A presigned URL carries the access key *id* by design, never the secret.
    expect(ticket.uploadUrl).toContain(encodeURIComponent(TEST_ENV.R2_ACCESS_KEY_ID));
    expect(JSON.stringify(ticket).includes(TEST_ENV.R2_SECRET_ACCESS_KEY)).toBe(false);
    const expiresAt = new Date(ticket.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 900_000);
  });

  test("validates type and size before looking at the configuration", async () => {
    const { storage } = createStorage();
    const ticket = (patch: Record<string, unknown>) =>
      storage.createPendingUpload({
        ownerId: "prop-1",
        category: "photos",
        mimeType: "image/jpeg",
        byteSize: 10,
        visibility: "public",
        maxBytes: 20,
        ...patch,
      } as never);
    expect((await failure(() => ticket({ mimeType: "image/heic" }))).code).toBe(
      "MEDIA_INVALID_TYPE",
    );
    expect((await failure(() => ticket({ byteSize: 0 }))).code).toBe("MEDIA_INVALID_SIZE");
    expect((await failure(() => ticket({ byteSize: 21 }))).code).toBe("MEDIA_TOO_LARGE");
    expect((await failure(() => ticket({ ownerId: "../other" }))).code).toBe(
      "MEDIA_INVALID_IDENTIFIER",
    );
  });

  test("reports every missing setting before any bytes are uploaded", async () => {
    const { storage } = createStorage({});
    const error = await failure(() =>
      storage.createPendingUpload({
        ownerId: "prop-1",
        category: "photos",
        mimeType: "image/jpeg",
        byteSize: 10,
        visibility: "public",
      }),
    );
    expect(error.code).toBe("R2_NOT_CONFIGURED");
    expect(error.details).toEqual({
      missing: [
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "R2_ENDPOINT",
        "R2_PUBLIC_BASE_URL",
      ],
    });
    expect(storage.missingConfig("public")).toEqual(
      error.details && (error.details as { missing: string[] }).missing,
    );
  });

  test("a public photo cannot be uploaded until the public base URL is configured", async () => {
    // Without it the upload would succeed and only the save step would fail,
    // leaving a publicly reachable object that no database row points to.
    const { storage } = createStorage({
      R2_ACCESS_KEY_ID: TEST_ENV.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: TEST_ENV.R2_SECRET_ACCESS_KEY,
      R2_BUCKET: TEST_ENV.R2_BUCKET,
      R2_ENDPOINT: TEST_ENV.R2_ENDPOINT,
    });
    expect(storage.isConfigured()).toBe(true);
    const error = await failure(() =>
      storage.createPendingUpload({
        ownerId: "prop-1",
        category: "photos",
        mimeType: "image/jpeg",
        byteSize: 10,
        visibility: "public",
      }),
    );
    expect(error.code).toBe("R2_NOT_CONFIGURED");
    expect(error.details).toEqual({ missing: ["R2_PUBLIC_BASE_URL"] });
    expect(error.message).toBe("R2 storage is not configured. Missing: R2_PUBLIC_BASE_URL.");
  });

  test("private uploads do not need a public base URL", async () => {
    const { storage } = createStorage({
      R2_ACCESS_KEY_ID: TEST_ENV.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: TEST_ENV.R2_SECRET_ACCESS_KEY,
      R2_BUCKET: TEST_ENV.R2_BUCKET,
      R2_ENDPOINT: TEST_ENV.R2_ENDPOINT,
    });
    const ticket = await storage.createPendingUpload({
      ownerId: "prop-1",
      category: "documents",
      mimeType: "image/jpeg",
      byteSize: 10,
      visibility: "private",
    });
    expect(ticket.key).toContain("/private/");
  });
});

describe("R2MediaStorage.verifyUploaded", () => {
  const prefix = "test-app/public/prop-1";
  const key = `${prefix}/photos/pending/1-a.png`;

  async function seeded(body: Buffer, contentType: string) {
    const { storage, transport } = createStorage();
    await transport.putObject({ bucket: "test-bucket", key, body, contentType });
    return { storage, transport };
  }

  const verify = (storage: R2MediaStorage, patch: Record<string, unknown> = {}) =>
    storage.verifyUploaded({
      key,
      expectedPrefix: prefix,
      mimeType: "image/png",
      maxBytes: 1024,
      ...patch,
    } as never);

  test("accepts a genuine upload that belongs to the owner", async () => {
    const { storage } = await seeded(PNG, "image/png");
    expect(await verify(storage)).toEqual({
      key,
      bucket: "test-bucket",
      bytes: PNG.length,
      mimeType: "image/png",
      visibility: "public",
      url: `https://media.example.test/${key}`,
    });
  });

  test("refuses keys outside the expected namespace before reading them", async () => {
    const { storage, transport } = createStorage();
    const { calls, transport: watched } = recording(transport);
    (storage as unknown as { transport: MemoryTransport }).transport = watched;
    const error = await failure(() =>
      storage.verifyUploaded({
        key,
        expectedPrefix: "test-app/public/prop-2",
        mimeType: "image/png",
      }),
    );
    expect(error.code).toBe("MEDIA_KEY_FORBIDDEN");
    expect(error.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });

  test("refuses empty, oversized, mistyped, non-image and missing objects", async () => {
    const empty = await seeded(Buffer.alloc(0), "image/png");
    expect((await failure(() => verify(empty.storage))).code).toBe("MEDIA_INVALID_SIZE");

    const oversized = await seeded(PNG, "image/png");
    expect((await failure(() => verify(oversized.storage, { maxBytes: 8 }))).code).toBe(
      "MEDIA_INVALID_SIZE",
    );

    const mistyped = await seeded(PNG, "application/octet-stream");
    expect((await failure(() => verify(mistyped.storage))).code).toBe("MEDIA_MIME_MISMATCH");

    const disguised = await seeded(NOT_AN_IMAGE, "image/png");
    expect((await failure(() => verify(disguised.storage))).code).toBe("MEDIA_MAGIC_MISMATCH");

    const { storage } = createStorage();
    expect((await failure(() => verify(storage))).code).toBe("MEDIA_NOT_FOUND");
  });
});

describe("public URLs and deletion", () => {
  test("publicUrl builds the public URL and refuses private or malformed keys", () => {
    const { storage } = createStorage();
    expect(storage.publicUrl("test-app/public/prop-1/photos/1-a_1.b.jpg")).toBe(
      "https://media.example.test/test-app/public/prop-1/photos/1-a_1.b.jpg",
    );
    // Keys with characters outside the safe set are refused rather than encoded.
    expect(codeOf(() => storage.publicUrl("test-app/public/prop-1/photos/a b.jpg"))).toBe(
      "MEDIA_INVALID_KEY",
    );
    expect(codeOf(() => storage.publicUrl("test-app/private/prop-1/photos/a.jpg"))).toBe(
      "MEDIA_PRIVATE_OBJECT",
    );
    const { storage: bare } = createStorage({ R2_PUBLIC_BASE_URL: "" });
    expect(codeOf(() => bare.publicUrl("test-app/public/prop-1/photos/a.jpg"))).toBe(
      "R2_PUBLIC_BASE_URL_MISSING",
    );
  });

  test("keyFromPublicUrl only accepts URLs under the configured public base", () => {
    const { storage } = createStorage();
    const key = "test-app/public/prop-1/photos/a%20b.jpg";
    expect(storage.keyFromPublicUrl(`https://media.example.test/${key}`)).toBe(
      "test-app/public/prop-1/photos/a b.jpg",
    );
    expect(storage.keyFromPublicUrl(`https://media.example.test/${key}?v=2`)).toBe(
      "test-app/public/prop-1/photos/a b.jpg",
    );
    expect(storage.keyFromPublicUrl("https://other.example.test/test-app/public/a.jpg")).toBeNull();
    expect(
      storage.keyFromPublicUrl("https://res.cloudinary.com/demo/image/upload/a.jpg"),
    ).toBeNull();
    expect(storage.keyFromPublicUrl("")).toBeNull();
    expect(storage.keyFromPublicUrl(undefined)).toBeNull();
  });

  test("deleteObject refuses keys outside the required prefix", async () => {
    const { storage, transport } = createStorage();
    await transport.putObject({
      bucket: "test-bucket",
      key: "test-app/public/prop-2/a.jpg",
      body: JPEG,
      contentType: "image/jpeg",
    });
    const error = await failure(() =>
      storage.deleteObject("test-app/public/prop-2/a.jpg", "test-app/public/prop-1"),
    );
    expect(error.code).toBe("MEDIA_KEY_FORBIDDEN");
    expect(transport.objects.size).toBe(1);
    await storage.deleteObject("test-app/public/prop-2/a.jpg", "test-app/public/prop-2");
    expect(transport.objects.size).toBe(0);
  });

  test("the default size limit is 10 MB", () => {
    expect(DEFAULT_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("withRetry", () => {
  test("retries transient failures with backoff and gives up after three attempts", async () => {
    let attempts = 0;
    const reset = () => Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    const first = await failure(() =>
      withRetry(async () => {
        attempts += 1;
        throw reset();
      }),
    );
    expect((first as { code?: string }).code).toBe("ECONNRESET");
    expect(attempts).toBe(3);

    attempts = 0;
    const value = await withRetry(async (attempt) => {
      attempts += 1;
      if (attempt < 2) throw Object.assign(new Error("R2 HTTP 503"), { statusCode: 503 });
      return "ok";
    });
    expect(value).toBe("ok");
    expect(attempts).toBe(3);

    attempts = 0;
    await failure(() =>
      withRetry(async () => {
        attempts += 1;
        throw Object.assign(new Error("R2 HTTP 400"), { statusCode: 400 });
      }),
    );
    expect(attempts).toBe(1);
  });
});

describe("R2SigV4Transport against a loopback HTTP server", () => {
  let server: http.Server;
  let endpoint = "";
  const received: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }> = [];
  const responses: Array<{ status: number; headers?: Record<string, string>; body?: Buffer }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        received.push({
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        const next = responses.shift();
        res.writeHead(next?.status ?? 200, next?.headers ?? {});
        res.end(next?.body ?? Buffer.alloc(0));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    received.length = 0;
    responses.length = 0;
  });

  const createTransport = () =>
    new R2SigV4Transport({
      accountId: TEST_ENV.R2_ACCOUNT_ID,
      accessKeyId: TEST_ENV.R2_ACCESS_KEY_ID,
      secretAccessKey: TEST_ENV.R2_SECRET_ACCESS_KEY,
      bucket: TEST_ENV.R2_BUCKET,
      endpoint,
      publicBaseUrl: TEST_ENV.R2_PUBLIC_BASE_URL,
      keyPrefix: "",
    });

  test("signs a PUT with the payload hash and sends the object key in the path", async () => {
    responses.push({ status: 200, headers: { etag: '"abc"' } });
    const result = await createTransport().putObject({
      bucket: "test-bucket",
      key: "test-app/public/prop-1/photos/a.jpg",
      body: JPEG,
      contentType: "image/jpeg",
      metadata: { sha256: sha256Hex(JPEG) },
      ifNoneMatch: "*",
    });
    expect(result.etag).toBe('"abc"');
    const [request] = received;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe("/test-bucket/test-app/public/prop-1/photos/a.jpg");
    expect(request.body.equals(JPEG)).toBe(true);
    expect(request.headers["content-type"]).toBe("image/jpeg");
    expect(request.headers["content-length"]).toBe(String(JPEG.length));
    expect(request.headers["if-none-match"]).toBe("*");
    expect(request.headers["x-amz-meta-sha256"]).toBe(sha256Hex(JPEG));
    expect(request.headers["x-amz-content-sha256"]).toBe(sha256Hex(JPEG));
    expect(request.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(request.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access-key-id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=([a-z0-9-]+;)+[a-z0-9-]+, Signature=[0-9a-f]{64}$/,
    );
    const signedHeaders = String(request.headers.authorization).match(/SignedHeaders=([^,]+)/)?.[1];
    expect(signedHeaders?.split(";").sort()).toEqual(
      [
        "content-length",
        "content-type",
        "host",
        "if-none-match",
        "x-amz-content-sha256",
        "x-amz-date",
        "x-amz-meta-sha256",
      ].sort(),
    );
  });

  test("reads object metadata back from a HEAD request", async () => {
    responses.push({
      status: 200,
      headers: {
        "content-length": String(JPEG.length),
        "content-type": "image/jpeg",
        "x-amz-meta-sha256": sha256Hex(JPEG),
      },
    });
    const head = await createTransport().headObject({ bucket: "test-bucket", key: "a.jpg" });
    expect(head).toEqual({
      contentLength: JPEG.length,
      contentType: "image/jpeg",
      metadata: { sha256: sha256Hex(JPEG) },
      etag: null,
    });
    expect(received[0]?.method).toBe("HEAD");
  });

  test("maps a missing object to MEDIA_NOT_FOUND without retrying", async () => {
    responses.push({ status: 404, body: Buffer.from("<Error><Code>NoSuchKey</Code></Error>") });
    const error = await failure(() =>
      createTransport().headObject({ bucket: "test-bucket", key: "missing.jpg" }),
    );
    expect(error.code).toBe("MEDIA_NOT_FOUND");
    expect(error.statusCode).toBe(404);
    expect(received).toHaveLength(1);
  });

  test("maps other client errors to MEDIA_STORAGE_UNAVAILABLE with the real status", async () => {
    responses.push({
      status: 403,
      body: Buffer.from("<Error><Code>InvalidAccessKeyId</Code></Error>"),
    });
    const error = await failure(() =>
      createTransport().headObject({ bucket: "test-bucket", key: "a.jpg" }),
    );
    expect(error.code).toBe("MEDIA_STORAGE_UNAVAILABLE");
    expect(error.statusCode).toBe(403);
    expect(received).toHaveLength(1);
  });

  test("retries server errors and succeeds when storage recovers", async () => {
    responses.push(
      { status: 503, body: Buffer.from("slow down") },
      { status: 500, body: Buffer.from("boom") },
      { status: 200, headers: { "content-length": "0" } },
    );
    const head = await createTransport().headObject({ bucket: "test-bucket", key: "a.jpg" });
    expect(head.contentLength).toBe(0);
    expect(received).toHaveLength(3);
  });

  test("gives up after three failed attempts on server errors", async () => {
    responses.push(
      { status: 500, body: Buffer.from("boom") },
      { status: 500, body: Buffer.from("boom") },
      { status: 500, body: Buffer.from("boom") },
    );
    const error = await failure(() =>
      createTransport().headObject({ bucket: "test-bucket", key: "a.jpg" }),
    );
    expect(error.code).toBe("MEDIA_STORAGE_UNAVAILABLE");
    expect(error.statusCode).toBe(500);
    expect(received).toHaveLength(3);
  });

  test("requests a byte range for content inspection", async () => {
    responses.push({ status: 206, headers: { "content-length": String(PNG.length) }, body: PNG });
    const result = await createTransport().getObject({
      bucket: "test-bucket",
      key: "a.png",
      range: { start: 0, end: 63 },
    });
    expect(received[0]?.headers.range).toBe("bytes=0-63");
    expect(result.body.equals(PNG)).toBe(true);
    expect(result.contentLength).toBe(PNG.length);
  });

  test("trims the body when storage ignores the range", async () => {
    responses.push({ status: 200, headers: { "content-length": String(JPEG.length) }, body: JPEG });
    const result = await createTransport().getObject({
      bucket: "test-bucket",
      key: "a.jpg",
      range: { start: 0, end: 3 },
    });
    expect(result.body.equals(JPEG.subarray(0, 4))).toBe(true);
  });

  test("sends a DELETE for the object key", async () => {
    responses.push({ status: 204 });
    const result = await createTransport().deleteObject({ bucket: "test-bucket", key: "a.jpg" });
    expect(result).toEqual({ deleted: true });
    expect(received[0]?.method).toBe("DELETE");
    expect(received[0]?.url).toBe("/test-bucket/a.jpg");
  });

  test("refuses to send anything when it is not configured", async () => {
    const transport = new R2SigV4Transport({
      accessKeyId: "",
      secretAccessKey: "",
      bucket: "",
      endpoint: "",
    });
    const error = await failure(() =>
      transport.headObject({ bucket: "test-bucket", key: "a.jpg" }),
    );
    expect(error.code).toBe("R2_NOT_CONFIGURED");
    expect(received).toHaveLength(0);
  });
});
