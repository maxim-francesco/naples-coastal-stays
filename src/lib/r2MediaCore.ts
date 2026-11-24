/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any --
 * Dependency-free S3/SigV4 core kept in its original untyped form; it is covered
 * end-to-end by tests/r2MediaCore.test.ts and by the typed wrappers in r2Media.ts. */
// @ts-nocheck

/**
 * MXM application-neutral Cloudflare R2 media core.
 *
 * - Native Node SigV4 (no SDK dependency).
 * - Public and private key spaces.
 * - Magic-byte validation, size limits, SHA-256 metadata, write-once semantics.
 * - Presigned PUT/GET for browser uploads without exposing credentials.
 * - Deterministic object keys and strict ownership-prefix checks.
 * - Injectable transport for deterministic local tests.
 */

import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import { URL } from "url";

const MIME_EXT = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
});

const EXT_MIME = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
});

const DEFAULT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

class MediaError extends Error {
  code: any;
  statusCode: any;
  details: any;
  constructor(code: any, message: any, statusCode = 500, details: any = undefined) {
    super(message);
    this.name = "MediaError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function normalizeMimeType(value) {
  if (typeof value !== "string") return null;
  const mime = value.trim().toLowerCase().split(";")[0];
  if (mime === "image/jpg") return "image/jpeg";
  return MIME_EXT[mime] ? mime : null;
}

function extForMime(mimeType) {
  const mime = normalizeMimeType(mimeType);
  return mime ? MIME_EXT[mime] : null;
}

function mimeForExt(ext) {
  return (
    EXT_MIME[
      String(ext || "")
        .replace(/^\./, "")
        .toLowerCase()
    ] || null
  );
}

function verifyMagicBytes(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const mime = normalizeMimeType(mimeType);
  if (!mime) return false;

  if (mime === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (mime === "image/webp") {
    return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  if (mime === "image/gif") {
    const header = buffer.toString("ascii", 0, 6);
    return header === "GIF87a" || header === "GIF89a";
  }
  return false;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeSegment(value, field = "segment") {
  const text = String(value == null ? "" : value).trim();
  if (
    !text ||
    text.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text) ||
    text.includes("..")
  ) {
    throw new MediaError("MEDIA_INVALID_IDENTIFIER", `Invalid ${field}.`, 400);
  }
  return text;
}

function normalizePrefix(prefix) {
  const raw = String(prefix || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  raw.split("/").forEach((part) => safeSegment(part, "prefix"));
  return raw;
}

function normalizeKey(key) {
  const raw = String(key || "")
    .trim()
    .replace(/^\/+/, "");
  if (!raw || raw.length > 1024) {
    throw new MediaError("MEDIA_INVALID_KEY", "Invalid object key.", 400);
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new MediaError("MEDIA_INVALID_KEY", "Invalid object key.", 400);
  }
  parts.forEach((part) => {
    if (!/^[A-Za-z0-9._-]+$/.test(part)) {
      throw new MediaError("MEDIA_INVALID_KEY", "Object key contains unsupported characters.", 400);
    }
  });
  return raw;
}

function buildObjectKey({
  app,
  visibility = "public",
  ownerId,
  category,
  digest,
  ext,
  width,
  keyPrefix = "",
}) {
  if (!["public", "private"].includes(visibility)) {
    throw new MediaError("MEDIA_INVALID_VISIBILITY", "Visibility must be public or private.", 400);
  }
  const cleanExt = String(ext || "")
    .replace(/^\./, "")
    .toLowerCase();
  if (!EXT_MIME[cleanExt]) {
    throw new MediaError("MEDIA_INVALID_EXTENSION", "Unsupported media extension.", 400);
  }
  const cleanDigest = String(digest || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleanDigest)) {
    throw new MediaError("MEDIA_INVALID_DIGEST", "A SHA-256 digest is required.", 400);
  }
  if (width !== undefined && (!Number.isInteger(width) || width <= 0)) {
    throw new MediaError("MEDIA_INVALID_WIDTH", "Image width must be a positive integer.", 400);
  }
  const prefix = normalizePrefix(keyPrefix);
  const fileName = width ? `${cleanDigest}.w${width}.${cleanExt}` : `${cleanDigest}.${cleanExt}`;
  const base = [
    safeSegment(app, "application"),
    visibility,
    safeSegment(ownerId, "owner id"),
    safeSegment(category, "category"),
    fileName,
  ].join("/");
  return prefix ? `${prefix}/${base}` : base;
}

function buildPendingKey({ app, visibility = "public", ownerId, category, ext, keyPrefix = "" }) {
  const cleanExt = String(ext || "")
    .replace(/^\./, "")
    .toLowerCase();
  if (!EXT_MIME[cleanExt]) {
    throw new MediaError("MEDIA_INVALID_EXTENSION", "Unsupported media extension.", 400);
  }
  const prefix = normalizePrefix(keyPrefix);
  const base = [
    safeSegment(app, "application"),
    visibility,
    safeSegment(ownerId, "owner id"),
    safeSegment(category, "category"),
    "pending",
    `${Date.now()}-${crypto.randomUUID()}.${cleanExt}`,
  ].join("/");
  return prefix ? `${prefix}/${base}` : base;
}

function assertKeyOwnedBy(key, requiredPrefix) {
  const cleanKey = normalizeKey(key);
  const prefix = normalizePrefix(requiredPrefix);
  if (!prefix || !(cleanKey === prefix || cleanKey.startsWith(`${prefix}/`))) {
    throw new MediaError(
      "MEDIA_KEY_FORBIDDEN",
      "Object key is outside the authorized namespace.",
      403,
    );
  }
  return cleanKey;
}

function readConfig(env = process.env, overrides = {}) {
  const pick = (...names) => {
    for (const name of names) {
      const value = env[name];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return undefined;
  };
  const accountId = overrides.accountId || pick("R2_ACCOUNT_ID", "CLOUDFLARE_R2_ACCOUNT_ID");
  const jurisdiction = String(
    overrides.jurisdiction || pick("R2_JURISDICTION") || "",
  ).toLowerCase();
  const inferredEndpoint = accountId
    ? `https://${accountId}${jurisdiction === "eu" ? ".eu" : ""}.r2.cloudflarestorage.com`
    : undefined;

  return {
    accountId,
    accessKeyId: overrides.accessKeyId || pick("R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_ACCESS_KEY_ID"),
    secretAccessKey:
      overrides.secretAccessKey || pick("R2_SECRET_ACCESS_KEY", "CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    bucket: overrides.bucket || pick("R2_BUCKET", "CLOUDFLARE_R2_ORIGINALS_BUCKET"),
    endpoint: String(
      overrides.endpoint || pick("R2_ENDPOINT", "CLOUDFLARE_R2_ENDPOINT") || inferredEndpoint || "",
    ).replace(/\/+$/, ""),
    publicBaseUrl: String(
      overrides.publicBaseUrl || pick("R2_PUBLIC_BASE_URL", "CLOUDFLARE_R2_PUBLIC_CDN_URL") || "",
    ).replace(/\/+$/, ""),
    // Validated when a key is built, never here: this runs at module load, and a
    // bad optional prefix must fail one upload instead of the whole admin area.
    keyPrefix: String(overrides.keyPrefix || pick("R2_KEY_PREFIX") || "")
      .trim()
      .replace(/^\/+|\/+$/g, ""),
  };
}

function assertConfigured(config) {
  const missing = [];
  if (!config.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!config.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!config.bucket) missing.push("R2_BUCKET");
  if (!config.endpoint) missing.push("R2_ENDPOINT");
  if (missing.length) {
    throw new MediaError(
      "R2_NOT_CONFIGURED",
      `R2 storage is not configured. Missing: ${missing.join(", ")}.`,
      503,
      { missing },
    );
  }
}

function rfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalQueryString(query) {
  return Object.keys(query)
    .sort()
    .map((key) => `${rfc3986(key)}=${rfc3986(String(query[key]))}`)
    .join("&");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
}

function amzNow(now = new Date()) {
  const iso = now.toISOString();
  return {
    date: iso.slice(0, 10).replace(/-/g, ""),
    amzDate: iso.replace(/[:-]|\.\d{3}/g, ""),
  };
}

function signRequest({
  method,
  path,
  query = {},
  headers,
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region = "auto",
  service = "s3",
  now = new Date(),
}) {
  const { date, amzDate } = amzNow(now);
  const lowerHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    lowerHeaders[key.toLowerCase()] = String(value).trim();
  }
  lowerHeaders["x-amz-date"] = amzDate;
  lowerHeaders["x-amz-content-sha256"] = payloadHash;

  const names = Object.keys(lowerHeaders).sort();
  const canonicalHeaders = names.map((name) => `${name}:${lowerHeaders[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    canonicalQueryString(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(secretAccessKey, date, region, service))
    .update(stringToSign)
    .digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    headers: lowerHeaders,
  };
}

function presignUrl({
  method,
  endpoint,
  bucket,
  key,
  expiresSeconds = 900,
  signedHeaders = {},
  accessKeyId,
  secretAccessKey,
  region = "auto",
  service = "s3",
  now = new Date(),
}) {
  const { date, amzDate } = amzNow(now);
  const url = new URL(`/${bucket}/${normalizeKey(key)}`, endpoint);
  const scope = `${date}/${region}/${service}/aws4_request`;

  const headerMap = { host: url.host };
  for (const [name, value] of Object.entries(signedHeaders)) {
    const normalized = name.toLowerCase();
    if (normalized === "host") continue;
    headerMap[normalized] = String(value).trim();
  }
  const names = Object.keys(headerMap).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headerMap[name]}\n`).join("");
  const signedHeaderNames = names.join(";");

  const query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(1, Math.min(604800, Math.floor(expiresSeconds)))),
    "X-Amz-SignedHeaders": signedHeaderNames,
  };
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname,
    canonicalQueryString(query),
    canonicalHeaders,
    signedHeaderNames,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(secretAccessKey, date, region, service))
    .update(stringToSign)
    .digest("hex");

  return {
    url: `${url.origin}${url.pathname}?${canonicalQueryString(query)}&X-Amz-Signature=${signature}`,
    method: method.toUpperCase(),
    signedHeaders: Object.fromEntries(
      names.filter((name) => name !== "host").map((name) => [name, headerMap[name]]),
    ),
    expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
  };
}

function shouldRetry(err) {
  if (!err) return false;
  if (err.code === "ETIMEDOUT" || err.code === "ECONNRESET" || err.code === "EAI_AGAIN")
    return true;
  if (err.statusCode === 429) return true;
  return typeof err.statusCode === "number" && err.statusCode >= 500;
}

async function withRetry(fn, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1 || !shouldRetry(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * 3 ** attempt));
    }
  }
  throw lastError;
}

class MemoryTransport {
  constructor() {
    this.objects = new Map();
    this.failures = new Map();
  }

  injectFailure(pattern, error) {
    this.failures.set(pattern, error);
  }

  clearFailures() {
    this.failures.clear();
  }

  _maybeFail(operation, key) {
    for (const pattern of [`${operation}:${key}`, `${operation}:*`]) {
      if (this.failures.has(pattern)) throw this.failures.get(pattern);
    }
  }

  _full(bucket, key) {
    return `${bucket}/${key}`;
  }

  async putObject({ bucket, key, body, contentType, metadata = {}, ifNoneMatch }) {
    this._maybeFail("put", key);
    const full = this._full(bucket, key);
    if (ifNoneMatch === "*" && this.objects.has(full)) {
      throw new MediaError("MEDIA_CONFLICT", "Object already exists.", 412);
    }
    this.objects.set(full, {
      body: Buffer.from(body),
      contentType,
      metadata: { ...metadata },
      sha256: sha256Hex(body),
    });
    return { etag: `"${sha256Hex(body)}"` };
  }

  async headObject({ bucket, key }) {
    this._maybeFail("head", key);
    const item = this.objects.get(this._full(bucket, key));
    if (!item) throw new MediaError("MEDIA_NOT_FOUND", "Object not found.", 404);
    return {
      contentLength: item.body.length,
      contentType: item.contentType,
      metadata: { ...item.metadata },
      etag: `"${item.sha256}"`,
    };
  }

  async getObject({ bucket, key, range }) {
    this._maybeFail("get", key);
    const item = this.objects.get(this._full(bucket, key));
    if (!item) throw new MediaError("MEDIA_NOT_FOUND", "Object not found.", 404);
    let body = Buffer.from(item.body);
    if (range && typeof range.start === "number" && typeof range.end === "number") {
      body = body.subarray(range.start, range.end + 1);
    }
    return { body, contentType: item.contentType, contentLength: body.length };
  }

  async deleteObject({ bucket, key }) {
    this._maybeFail("delete", key);
    this.objects.delete(this._full(bucket, key));
    return { deleted: true };
  }

  clear() {
    this.objects.clear();
    this.failures.clear();
  }
}

class R2SigV4Transport {
  constructor(config) {
    this.config = config;
  }

  async _request({ method, key, body = null, headers = {}, query = {}, range = undefined }) {
    assertConfigured(this.config);
    const url = new URL(`/${this.config.bucket}/${normalizeKey(key)}`, this.config.endpoint);
    if (query && Object.keys(query).length) {
      url.search = canonicalQueryString(query);
    }
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    const requestHeaders = {
      host: url.host,
      ...headers,
    };
    if (body) requestHeaders["content-length"] = String(body.length);
    if (range) requestHeaders.range = range;
    const signed = signRequest({
      method,
      path: url.pathname,
      query,
      headers: requestHeaders,
      payloadHash,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
    });
    requestHeaders.Authorization = signed.authorization;
    requestHeaders["x-amz-date"] = signed.headers["x-amz-date"];
    requestHeaders["x-amz-content-sha256"] = signed.headers["x-amz-content-sha256"];

    return withRetry(
      () =>
        new Promise((resolve, reject) => {
          const client = url.protocol === "https:" ? https : http;
          const req = client.request(
            url,
            { method, headers: requestHeaders, timeout: 30000 },
            (res) => {
              const chunks = [];
              res.on("data", (chunk) => chunks.push(chunk));
              res.on("end", () => {
                const responseBody = Buffer.concat(chunks);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody });
                  return;
                }
                const err = new MediaError(
                  res.statusCode === 404
                    ? "MEDIA_NOT_FOUND"
                    : res.statusCode === 412
                      ? "MEDIA_CONFLICT"
                      : "MEDIA_STORAGE_UNAVAILABLE",
                  `R2 HTTP ${res.statusCode}: ${responseBody.toString("utf8").slice(0, 300)}`,
                  res.statusCode >= 500 ? 502 : res.statusCode,
                );
                err.statusCode = res.statusCode;
                reject(err);
              });
            },
          );
          req.on("timeout", () => {
            req.destroy();
            const err = new MediaError("MEDIA_STORAGE_UNAVAILABLE", "R2 request timed out.", 504);
            err.code = "ETIMEDOUT";
            reject(err);
          });
          req.on("error", (err) => reject(err));
          if (body) req.write(body);
          req.end();
        }),
    );
  }

  async putObject({ bucket, key, body, contentType, metadata = {}, ifNoneMatch }) {
    const headers = { "content-type": contentType || "application/octet-stream" };
    if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
    for (const [name, value] of Object.entries(metadata)) {
      headers[
        `x-amz-meta-${String(name)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")}`
      ] = String(value);
    }
    const res = await this._request({ method: "PUT", key, body, headers });
    return { etag: res.headers.etag || `"${sha256Hex(body)}"` };
  }

  async headObject({ bucket, key }) {
    const res = await this._request({ method: "HEAD", key });
    const metadata = {};
    for (const [name, value] of Object.entries(res.headers)) {
      if (name.startsWith("x-amz-meta-")) metadata[name.slice("x-amz-meta-".length)] = value;
    }
    return {
      contentLength: Number.parseInt(res.headers["content-length"] || "0", 10),
      contentType: res.headers["content-type"] || null,
      metadata,
      etag: res.headers.etag || null,
    };
  }

  async getObject({ bucket, key, range }) {
    let rangeHeader;
    if (range && typeof range.start === "number" && typeof range.end === "number") {
      rangeHeader = `bytes=${range.start}-${range.end}`;
    }
    const res = await this._request({ method: "GET", key, range: rangeHeader });
    let body = res.body;
    if (range && typeof range.start === "number") {
      // Some S3-compatible implementations return 200 instead of 206; trim defensively.
      if (res.statusCode === 200) body = body.subarray(range.start, range.end + 1);
    }
    return {
      body,
      contentType: res.headers["content-type"] || null,
      contentLength: Number.parseInt(res.headers["content-length"] || String(body.length), 10),
    };
  }

  async deleteObject({ bucket, key }) {
    await this._request({ method: "DELETE", key });
    return { deleted: true };
  }
}

class R2MediaStorage {
  constructor(options = {}) {
    this.app = safeSegment(options.app || "app", "application");
    this.config = readConfig(options.env || process.env, options);
    this.transport =
      options.transport || (this.config.accessKeyId ? new R2SigV4Transport(this.config) : null);
    this.defaultMaxBytes = options.maxBytes || DEFAULT_IMAGE_MAX_BYTES;
  }

  _transport() {
    if (!this.transport) assertConfigured(this.config);
    return this.transport;
  }

  isConfigured() {
    try {
      assertConfigured(this.config);
      return Boolean(this.transport);
    } catch {
      return false;
    }
  }

  // Setting names still required for the given visibility. Names only, never
  // values, so the list is safe to show to an administrator.
  missingConfig(visibility = "public") {
    const missing = [];
    if (!this.config.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
    if (!this.config.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
    if (!this.config.bucket) missing.push("R2_BUCKET");
    if (!this.config.endpoint) missing.push("R2_ENDPOINT");
    if (visibility === "public" && !this.config.publicBaseUrl) missing.push("R2_PUBLIC_BASE_URL");
    return missing;
  }

  publicUrl(key) {
    const cleanKey = normalizeKey(key);
    if (!cleanKey.split("/").includes("public")) {
      throw new MediaError("MEDIA_PRIVATE_OBJECT", "Private objects do not have public URLs.", 403);
    }
    if (!this.config.publicBaseUrl) {
      throw new MediaError(
        "R2_PUBLIC_BASE_URL_MISSING",
        "Public media base URL is not configured.",
        503,
      );
    }
    const encoded = cleanKey.split("/").map(rfc3986).join("/");
    return `${this.config.publicBaseUrl}/${encoded}`;
  }

  keyFromPublicUrl(url: any) {
    if (!this.config.publicBaseUrl || typeof url !== "string") return null;
    const base = `${this.config.publicBaseUrl.replace(/\/+$/, "")}/`;
    if (!url.startsWith(base)) return null;
    try {
      return decodeURIComponent(url.slice(base.length).split("?")[0]);
    } catch {
      return null;
    }
  }

  async uploadImage({
    buffer,
    mimeType,
    ownerId,
    category,
    visibility = "public",
    maxBytes = this.defaultMaxBytes,
    metadata = {},
    ifNoneMatch = true,
    width,
  }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new MediaError("MEDIA_EMPTY", "An image file is required.", 400);
    }
    if (buffer.length > maxBytes) {
      throw new MediaError(
        "MEDIA_TOO_LARGE",
        `Image exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`,
        413,
      );
    }
    const mime = normalizeMimeType(mimeType);
    if (!mime) {
      throw new MediaError(
        "MEDIA_INVALID_TYPE",
        "Only JPEG, PNG, WebP, or GIF images are supported.",
        400,
      );
    }
    if (!verifyMagicBytes(buffer, mime)) {
      throw new MediaError(
        "MEDIA_MAGIC_MISMATCH",
        "The file contents do not match the declared image type.",
        400,
      );
    }
    const digest = sha256Hex(buffer);
    const ext = extForMime(mime);
    const key = buildObjectKey({
      app: this.app,
      visibility,
      ownerId,
      category,
      digest,
      ext,
      width,
      keyPrefix: this.config.keyPrefix,
    });
    const objectMetadata = {
      sha256: digest,
      bytes: String(buffer.length),
      app: this.app,
      owner: String(ownerId),
      category: String(category),
      visibility,
      ...(width ? { width: String(width) } : {}),
      ...metadata,
    };
    const transport = this._transport();

    let reused = false;
    try {
      await transport.putObject({
        bucket: this.config.bucket,
        key,
        body: buffer,
        contentType: mime,
        metadata: objectMetadata,
        ifNoneMatch: ifNoneMatch ? "*" : undefined,
      });
    } catch (err) {
      if (!ifNoneMatch || err.statusCode !== 412) throw err;
      const existing = await transport.headObject({ bucket: this.config.bucket, key });
      const existingSha = existing.metadata && existing.metadata.sha256;
      if (
        existing.contentLength === buffer.length &&
        normalizeMimeType(existing.contentType) === mime &&
        (!existingSha || existingSha === digest)
      ) {
        reused = true;
      } else {
        throw new MediaError(
          "MEDIA_CONFLICT",
          "A different object already exists at this key.",
          409,
        );
      }
    }

    if (reused) {
      return {
        key,
        bucket: this.config.bucket,
        sha256: digest,
        bytes: buffer.length,
        mimeType: mime,
        visibility,
        reused: true,
        url: visibility === "public" ? this.publicUrl(key) : null,
      };
    }

    const stored = await transport.headObject({ bucket: this.config.bucket, key });
    const storedSha = stored.metadata && stored.metadata.sha256;
    if (
      stored.contentLength !== buffer.length ||
      normalizeMimeType(stored.contentType) !== mime ||
      (storedSha && storedSha !== digest)
    ) {
      try {
        await transport.deleteObject({ bucket: this.config.bucket, key });
      } catch {
        // Best-effort cleanup of the object created by this request only.
      }
      throw new MediaError(
        "MEDIA_VERIFICATION_FAILED",
        "Uploaded object failed verification.",
        502,
      );
    }

    return {
      key,
      bucket: this.config.bucket,
      sha256: digest,
      bytes: buffer.length,
      mimeType: mime,
      visibility,
      reused: false,
      url: visibility === "public" ? this.publicUrl(key) : null,
    };
  }

  // Stores an image at an explicit public key instead of the digest-derived
  // default. Used for responsive derivatives that must sit next to their
  // original. The caller owns the key layout; ownership is still enforced by
  // `expectedPrefix`, and existing objects are never overwritten.
  async putPublicImage({
    key,
    buffer,
    mimeType,
    expectedPrefix,
    maxBytes = this.defaultMaxBytes,
    metadata = {},
    ifNoneMatch = true,
  }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new MediaError("MEDIA_EMPTY", "An image file is required.", 400);
    }
    if (buffer.length > maxBytes) {
      throw new MediaError(
        "MEDIA_TOO_LARGE",
        `Image exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`,
        413,
      );
    }
    const mime = normalizeMimeType(mimeType);
    if (!mime) {
      throw new MediaError(
        "MEDIA_INVALID_TYPE",
        "Only JPEG, PNG, WebP, or GIF images are supported.",
        400,
      );
    }
    if (!verifyMagicBytes(buffer, mime)) {
      throw new MediaError(
        "MEDIA_MAGIC_MISMATCH",
        "The file contents do not match the declared image type.",
        400,
      );
    }
    const cleanKey = expectedPrefix ? assertKeyOwnedBy(key, expectedPrefix) : normalizeKey(key);
    if (!cleanKey.split("/").includes("public")) {
      throw new MediaError(
        "MEDIA_PRIVATE_OBJECT",
        "Only public images can be stored this way.",
        403,
      );
    }
    const digest = sha256Hex(buffer);
    const objectMetadata = {
      sha256: digest,
      bytes: String(buffer.length),
      app: this.app,
      visibility: "public",
      ...metadata,
    };
    const transport = this._transport();
    const upload = () =>
      transport.putObject({
        bucket: this.config.bucket,
        key: cleanKey,
        body: buffer,
        contentType: mime,
        metadata: objectMetadata,
        ifNoneMatch: ifNoneMatch ? "*" : undefined,
      });

    let reused = false;
    try {
      await upload();
    } catch (err) {
      if (!ifNoneMatch || err.statusCode !== 412) throw err;
      const existing = await transport.headObject({ bucket: this.config.bucket, key: cleanKey });
      const existingSha = existing.metadata && existing.metadata.sha256;
      const matches =
        existing.contentLength === buffer.length &&
        normalizeMimeType(existing.contentType) === mime &&
        (!existingSha || existingSha === digest);
      if (!matches) {
        throw new MediaError(
          "MEDIA_CONFLICT",
          "A different object already exists at this key.",
          409,
        );
      }
      reused = true;
    }

    if (!reused) {
      const stored = await transport.headObject({ bucket: this.config.bucket, key: cleanKey });
      const storedSha = stored.metadata && stored.metadata.sha256;
      if (
        stored.contentLength !== buffer.length ||
        normalizeMimeType(stored.contentType) !== mime ||
        (storedSha && storedSha !== digest)
      ) {
        try {
          await transport.deleteObject({ bucket: this.config.bucket, key: cleanKey });
        } catch {
          // Best-effort cleanup of the object created by this request only.
        }
        throw new MediaError(
          "MEDIA_VERIFICATION_FAILED",
          "Uploaded object failed verification.",
          502,
        );
      }
    }

    return {
      key: cleanKey,
      bucket: this.config.bucket,
      sha256: digest,
      bytes: buffer.length,
      mimeType: mime,
      visibility: "public",
      reused,
      url: this.publicUrl(cleanKey),
    };
  }

  async createPendingUpload({
    ownerId,
    category,
    mimeType,
    byteSize,
    visibility = "public",
    maxBytes = this.defaultMaxBytes,
    expiresSeconds = 900,
  }) {
    const mime = normalizeMimeType(mimeType);
    if (!mime) {
      throw new MediaError(
        "MEDIA_INVALID_TYPE",
        "Only JPEG, PNG, WebP, or GIF images are supported.",
        400,
      );
    }
    if (!Number.isFinite(byteSize) || byteSize <= 0) {
      throw new MediaError("MEDIA_INVALID_SIZE", "A positive file size is required.", 400);
    }
    if (byteSize > maxBytes) {
      throw new MediaError(
        "MEDIA_TOO_LARGE",
        `Image exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`,
        413,
      );
    }
    // Checked in full up front: a public upload whose base URL is missing would
    // otherwise succeed and only fail when it is saved, leaving an object behind.
    const missing = this.missingConfig(visibility);
    if (missing.length) {
      throw new MediaError(
        "R2_NOT_CONFIGURED",
        `R2 storage is not configured. Missing: ${missing.join(", ")}.`,
        503,
        { missing },
      );
    }
    const key = buildPendingKey({
      app: this.app,
      visibility,
      ownerId,
      category,
      ext: extForMime(mime),
      keyPrefix: this.config.keyPrefix,
    });
    const presigned = presignUrl({
      method: "PUT",
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key,
      expiresSeconds,
      signedHeaders: { "content-type": mime },
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
    });
    return {
      key,
      bucket: this.config.bucket,
      mimeType: mime,
      visibility,
      maxBytes,
      uploadUrl: presigned.url,
      method: presigned.method,
      headers: presigned.signedHeaders,
      expiresAt: presigned.expiresAt,
    };
  }

  async verifyUploaded({ key, expectedPrefix, mimeType, maxBytes = this.defaultMaxBytes }) {
    const cleanKey = assertKeyOwnedBy(key, expectedPrefix);
    const transport = this._transport();
    const head = await transport.headObject({ bucket: this.config.bucket, key: cleanKey });
    if (head.contentLength <= 0 || head.contentLength > maxBytes) {
      throw new MediaError("MEDIA_INVALID_SIZE", "Uploaded object size is invalid.", 400);
    }
    const expectedMime = normalizeMimeType(mimeType || head.contentType);
    if (!expectedMime || normalizeMimeType(head.contentType) !== expectedMime) {
      throw new MediaError(
        "MEDIA_MIME_MISMATCH",
        "Uploaded object type does not match the ticket.",
        400,
      );
    }
    const sample = await transport.getObject({
      bucket: this.config.bucket,
      key: cleanKey,
      range: { start: 0, end: 63 },
    });
    if (!verifyMagicBytes(sample.body, expectedMime)) {
      throw new MediaError(
        "MEDIA_MAGIC_MISMATCH",
        "The uploaded file is not the declared image type.",
        400,
      );
    }
    return {
      key: cleanKey,
      bucket: this.config.bucket,
      bytes: head.contentLength,
      mimeType: expectedMime,
      visibility: cleanKey.split("/").includes("private") ? "private" : "public",
      url: cleanKey.split("/").includes("public") ? this.publicUrl(cleanKey) : null,
    };
  }

  async deleteObject(key: any, expectedPrefix: any = undefined) {
    const cleanKey = expectedPrefix ? assertKeyOwnedBy(key, expectedPrefix) : normalizeKey(key);
    const transport = this._transport();
    await transport.deleteObject({ bucket: this.config.bucket, key: cleanKey });
    return { key: cleanKey, deleted: true };
  }

  async headObject(key: any, expectedPrefix: any = undefined) {
    const cleanKey = expectedPrefix ? assertKeyOwnedBy(key, expectedPrefix) : normalizeKey(key);
    const transport = this._transport();
    return transport.headObject({ bucket: this.config.bucket, key: cleanKey });
  }

  async getObject(key: any, expectedPrefix: any = undefined) {
    const cleanKey = expectedPrefix ? assertKeyOwnedBy(key, expectedPrefix) : normalizeKey(key);
    const transport = this._transport();
    return transport.getObject({ bucket: this.config.bucket, key: cleanKey });
  }

  async presignGet(key, expiresSeconds = 900, expectedPrefix = undefined) {
    const cleanKey = expectedPrefix ? assertKeyOwnedBy(key, expectedPrefix) : normalizeKey(key);
    assertConfigured(this.config);
    return presignUrl({
      method: "GET",
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      key: cleanKey,
      expiresSeconds,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
    });
  }
}

export {
  DEFAULT_IMAGE_MAX_BYTES,
  MIME_EXT,
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
};
