// Cloudinary -> Cloudflare R2 photo migration planner/copier.
//
// STEP 05A proved the copy loop; STEP 05B-01 adds the responsive derivative
// stage. Nothing here touches production by itself: the caller passes a fetch
// function and a storage instance, which is how the dry-run tests exercise the
// whole flow with an in-memory transport and local fixtures.
//
// Guarantees:
//   - every source file is downloaded, size/type/magic-bytes checked and hashed;
//   - the original is stored content-addressed with its pixel width in the key;
//   - WebP derivatives are generated for every standard width up to the source
//     width and stored next to the original, never wider than the source;
//   - every object is written with `ifNoneMatch`, so re-running reuses bytes
//     instead of overwriting, and identical photos share objects;
//   - the manifest records the previous database values before anything is
//     proposed, so rollback is a row-by-row restore plus deletion of objects
//     this run created and no other row uses;
//   - an interrupted run resumes from the manifest and re-verifies every object.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sha256Hex, verifyMagicBytes } from "../src/lib/r2MediaCore.ts";
import { prepareImageVariants } from "../src/lib/imageVariants.ts";
import { PHOTO_VARIANT_WIDTHS, photoVariantKey } from "../src/lib/responsiveImage.ts";

export const MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
});

export const MANIFEST_VERSION = 2;

export function mimeForSourceUrl(url) {
  if (typeof url !== "string") return null;
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  if (!match) return null;
  return MIME_BY_EXTENSION[match[1].toLowerCase()] ?? null;
}

export function propertyMediaPrefix(app, propertyId, keyPrefix = "") {
  const cleanPrefix = String(keyPrefix || "").replace(/^\/+|\/+$/g, "");
  const base = `${app}/public/${propertyId}`;
  return cleanPrefix ? `${cleanPrefix}/${base}` : base;
}

/**
 * Turns a read-only inventory snapshot into a migration manifest. Entries that
 * cannot be migrated (already on R2, missing URL, unsupported file type) are
 * recorded as skipped with a reason instead of silently disappearing.
 */
export function buildManifest(snapshot, { app = "naples-coastal-stays", keyPrefix = "" } = {}) {
  if (!snapshot || !Array.isArray(snapshot.photos)) {
    throw new Error("A snapshot with a photos array is required.");
  }
  const propertyById = new Map(
    (snapshot.properties ?? []).map((property) => [property.id, property]),
  );
  const entries = snapshot.photos.map((photo) => {
    const property = propertyById.get(photo.propertyId);
    const mimeType = mimeForSourceUrl(photo.originalUrl);
    const base = {
      photoId: photo.id,
      propertyId: photo.propertyId,
      propertySlug: property?.slug ?? null,
      propertyName: property?.name ?? null,
      alt: photo.alt ?? "",
      sortOrder: photo.sortOrder ?? 0,
      isCover: photo.isCover === true,
      isHero: photo.isHero === true,
      sourceUrl: photo.originalUrl ?? null,
      mimeType,
      before: {
        storage_path: photo.storagePath ?? null,
        public_url: photo.publicUrl ?? null,
      },
      status: "pending",
      key: null,
      publicUrl: null,
      sha256: null,
      bytes: null,
      width: null,
      height: null,
      variants: [],
      reused: null,
      error: null,
    };
    if (photo.provider !== "cloudinary") {
      return { ...base, status: "skipped", error: `source is ${photo.provider}, not cloudinary` };
    }
    if (!photo.originalUrl) {
      return { ...base, status: "skipped", error: "missing original URL" };
    }
    if (!mimeType) {
      return { ...base, status: "skipped", error: "unsupported file type" };
    }
    if (!property) {
      return { ...base, status: "skipped", error: "photo has no matching property" };
    }
    return base;
  });

  return {
    version: MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    app,
    keyPrefix: String(keyPrefix || "").replace(/^\/+|\/+$/g, ""),
    sourceSnapshotAt: snapshot.generatedAt ?? null,
    entries,
  };
}

export function summarizeManifest(manifest) {
  const counts = { pending: 0, uploaded: 0, failed: 0, skipped: 0 };
  let variantObjects = 0;
  const perProperty = new Map();
  for (const entry of manifest.entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    if (Array.isArray(entry.variants)) variantObjects += entry.variants.length;
    const key = entry.propertyId;
    if (!perProperty.has(key)) {
      perProperty.set(key, {
        propertyId: key,
        slug: entry.propertySlug,
        name: entry.propertyName,
        total: 0,
        uploaded: 0,
        pending: 0,
        failed: 0,
        skipped: 0,
        variants: 0,
      });
    }
    const row = perProperty.get(key);
    row.total += 1;
    row[entry.status] = (row[entry.status] ?? 0) + 1;
    if (Array.isArray(entry.variants)) row.variants += entry.variants.length;
  }
  return { counts, variantObjects, perProperty: [...perProperty.values()] };
}

export function proposeDatabaseUpdate(entry) {
  if (entry.status !== "uploaded" || !entry.key || !entry.publicUrl) return null;
  return {
    photoId: entry.photoId,
    before: { ...entry.before },
    after: { storage_path: entry.key, public_url: entry.publicUrl },
  };
}

/**
 * Every object this entry owns: the original plus its variants.
 */
export function objectsForEntry(entry) {
  const objects = [];
  if (entry.key) objects.push({ key: entry.key, created: entry.reused === false });
  for (const variant of entry.variants ?? []) {
    if (variant && variant.key) {
      objects.push({ key: variant.key, created: variant.reused === false });
    }
  }
  return objects;
}

/**
 * Rollback data for every row this manifest proposes to change. Objects are
 * deletable only when the run created them and no other migrated row points at
 * the same key.
 */
export function buildRollbackPlan(manifest) {
  const applied = manifest.entries.filter((entry) => entry.status === "uploaded");
  const usage = new Map();
  for (const entry of applied) {
    for (const object of objectsForEntry(entry)) {
      usage.set(object.key, (usage.get(object.key) ?? 0) + 1);
    }
  }

  const deletableKeys = [];
  const retainedKeys = [];
  for (const entry of applied) {
    for (const object of objectsForEntry(entry)) {
      if (object.created && usage.get(object.key) === 1) deletableKeys.push(object.key);
      else retainedKeys.push(object.key);
    }
  }

  return {
    rows: applied.map((entry) => ({
      photoId: entry.photoId,
      restore: { ...entry.before },
    })),
    deletableKeys: [...new Set(deletableKeys)],
    retainedKeys: [...new Set(retainedKeys)],
  };
}

/**
 * Applies the proposed database rows one at a time. The adapter owns the
 * transaction and must implement `updatePhoto(photoId, { before, after })`,
 * resolving to `{ ok: true }` only when the row still matched `before` and was
 * updated, or `{ ok: false, reason }` otherwise. A failed row stops the run so
 * the caller can roll back exactly the rows that were applied.
 */
export async function applyDatabaseUpdates({ proposals, db, log = () => {} }) {
  const applied = [];
  for (const proposal of proposals) {
    if (!proposal) continue;
    const result = await db.updatePhoto(proposal.photoId, {
      before: proposal.before,
      after: proposal.after,
    });
    if (!result || result.ok !== true) {
      return {
        ok: false,
        applied,
        failed: { photoId: proposal.photoId, reason: result?.reason ?? "update_failed" },
      };
    }
    applied.push(proposal);
    log(`updated ${proposal.photoId}`);
  }
  return { ok: true, applied, failed: null };
}

/**
 * Restores the rows changed by `applyDatabaseUpdates`, newest first. The
 * adapter must implement `restorePhoto(photoId, { expected, restore })` with
 * the same compare-and-set contract, so a row edited after the migration is
 * reported as skipped instead of being overwritten.
 */
export async function rollbackDatabaseUpdates({ applied, db, log = () => {} }) {
  const restored = [];
  const skipped = [];
  for (const proposal of [...applied].reverse()) {
    const result = await db.restorePhoto(proposal.photoId, {
      expected: proposal.after,
      restore: proposal.before,
    });
    if (result?.ok === true) {
      restored.push(proposal.photoId);
      log(`restored ${proposal.photoId}`);
    } else {
      skipped.push({ photoId: proposal.photoId, reason: result?.reason ?? "restore_failed" });
    }
  }
  return { restored, skipped };
}

async function verifyCompletedEntry(entry, storage) {
  try {
    const head = await storage.headObject(entry.key);
    if (head.contentLength !== entry.bytes) return false;
    const storedSha = head.metadata && head.metadata.sha256;
    if (storedSha && storedSha !== entry.sha256) return false;
    for (const variant of entry.variants ?? []) {
      const variantHead = await storage.headObject(variant.key);
      if (variantHead.contentLength !== variant.bytes) return false;
      const variantSha = variantHead.metadata && variantHead.metadata.sha256;
      if (variantSha && variantSha !== variant.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies every pending entry. `fetchBytes` must resolve to
 * `{ ok, status, bytes }`. `persist` is awaited after each entry so an
 * interrupted run can resume from the manifest. Failed entries stay failed with
 * a code and are retried on the next run.
 *
 * `prepare` is injectable so tests can run the whole loop without an image
 * encoder; production and the dry-run use `prepareImageVariants` (sharp).
 */
export async function runMigration({
  manifest,
  fetchBytes,
  storage,
  maxBytes,
  log = () => {},
  persist = async () => {},
  resume = false,
  prepare = prepareImageVariants,
  variantWidths = PHOTO_VARIANT_WIDTHS,
}) {
  if (!manifest || !Array.isArray(manifest.entries)) throw new Error("A manifest is required.");
  if (typeof fetchBytes !== "function") throw new Error("fetchBytes is required.");
  if (!storage) throw new Error("storage is required.");

  if (resume) {
    for (const entry of manifest.entries) {
      if (entry.status === "uploaded" && !(await verifyCompletedEntry(entry, storage))) {
        entry.status = "pending";
        entry.reused = null;
      }
    }
    await persist(manifest);
  }

  for (const entry of manifest.entries) {
    if (entry.status !== "pending" && entry.status !== "failed") continue;
    const prefix = propertyMediaPrefix(storage.app, entry.propertyId, storage.config.keyPrefix);
    try {
      const response = await fetchBytes(entry.sourceUrl);
      if (!response.ok) throw new Error(`source answered HTTP ${response.status}`);
      const buffer = response.bytes;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0)
        throw new Error("source returned no bytes");
      if (buffer.length > maxBytes) throw new Error("source exceeds the size limit");
      if (!verifyMagicBytes(buffer, entry.mimeType))
        throw new Error("source bytes are not the declared image type");

      const digest = sha256Hex(buffer);
      const prepared = await prepare(buffer, { widths: variantWidths });
      if (!prepared.width || !Number.isInteger(prepared.width) || prepared.width <= 0) {
        throw new Error("source width is unavailable");
      }

      const uploaded = await storage.uploadImage({
        buffer,
        mimeType: entry.mimeType,
        ownerId: entry.propertyId,
        category: "photos",
        visibility: "public",
        maxBytes,
        width: prepared.width,
        metadata: { photoId: entry.photoId, height: String(prepared.height) },
      });
      const verified = await storage.verifyUploaded({
        key: uploaded.key,
        expectedPrefix: prefix,
        mimeType: entry.mimeType,
        maxBytes,
      });

      // Record the original before the variants so a failure below is still
      // visible in the manifest and rollback knows the object exists.
      entry.key = verified.key;
      entry.publicUrl = verified.url;
      entry.sha256 = digest;
      entry.bytes = buffer.length;
      entry.width = prepared.width;
      entry.height = prepared.height;
      entry.reused = uploaded.reused === true;
      entry.error = null;

      const variants = [];
      for (const variant of prepared.variants) {
        const key = photoVariantKey(verified.key, variant.width);
        if (!key) throw new Error(`could not derive the ${variant.width}px variant key`);
        const stored = await storage.putPublicImage({
          key,
          buffer: variant.buffer,
          mimeType: "image/webp",
          expectedPrefix: prefix,
          maxBytes,
          metadata: { originalSha: digest, width: String(variant.width), format: "webp" },
        });
        variants.push({
          width: variant.width,
          key: stored.key,
          publicUrl: stored.url,
          sha256: stored.sha256,
          bytes: stored.bytes,
          reused: stored.reused === true,
        });
      }

      entry.variants = variants;
      entry.status = "uploaded";
      log(
        `uploaded ${entry.photoId} -> ${entry.key} (${entry.width}x${entry.height}, ${variants.length} variants${entry.reused ? ", original reused" : ""})`,
      );
    } catch (error) {
      entry.status = "failed";
      entry.error =
        error && (error.code || error.message ? error.code || error.message : String(error));
      log(`failed ${entry.photoId}: ${entry.error}`);
    }
    await persist(manifest);
  }
  return summarizeManifest(manifest);
}

export function writeManifest(file, manifest) {
  const target = path.resolve(file);
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

export function readManifest(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

export function fingerprintManifest(manifest) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        manifest.entries.map((entry) => [entry.photoId, entry.sourceUrl, entry.before.public_url]),
      ),
    )
    .digest("hex");
}
