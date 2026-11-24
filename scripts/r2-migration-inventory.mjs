import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * READ-ONLY inventory of the photo references stored in Supabase.
 *
 * It is the first step of the Cloudinary -> Cloudflare R2 migration: it shows
 * where every property photo lives today, so the copy plan can be written
 * against real data. It never changes anything:
 *
 *   - The Supabase client is wrapped so that only read calls are possible.
 *   - Nothing is uploaded, downloaded, rewritten or deleted.
 *   - No environment value is printed; the report contains counts and ids.
 *
 * Usage (from the project root, with .env.local present):
 *   bun scripts/r2-migration-inventory.mjs [--out snapshot.json] [--probe]
 *
 *   --out <file>  also write a per-photo snapshot, used later to plan the copy
 *   --probe       also send a HEAD request to each source URL (network reads)
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- pure helpers (exported so they can be unit-tested) ----------------------

// Same shape as the transformation check in src/lib/cloudinary.ts.
const TRANSFORMATION_SEGMENT = /^(?:[a-z]{1,3}_[^/,]+)(?:,[a-z]{1,3}_[^/,]+)*$/i;
const VERSION_SEGMENT = /^v\d+$/i;

/**
 * The URL of the untransformed Cloudinary original, or null when the value is
 * not a Cloudinary upload URL.
 */
export function cloudinaryOriginalUrl(url) {
  if (typeof url !== "string" || !url.includes("res.cloudinary.com")) return null;
  const marker = "/image/upload/";
  const start = url.indexOf(marker);
  if (start === -1) return null;
  const offset = start + marker.length;
  const rest = url.slice(offset);
  const slash = rest.indexOf("/");
  const first = slash === -1 ? rest : rest.slice(0, slash);
  const remainder = slash === -1 ? "" : rest.slice(slash + 1);
  if (TRANSFORMATION_SEGMENT.test(first) && !VERSION_SEGMENT.test(first)) {
    return url.slice(0, offset) + remainder;
  }
  return url;
}

function extensionOf(url) {
  const pathname = url.split(/[?#]/)[0];
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Where a photo's file lives today and, for Cloudinary, which URL serves the
 * original bytes.
 */
export function classifyPhotoReference(photo, r2PublicBaseUrl = "") {
  const url = typeof photo.public_url === "string" ? photo.public_url.trim() : "";
  const empty = { host: null, originalUrl: null, hasTransformation: false, extension: null };
  if (!url) return { provider: "none", ...empty };

  let host;
  try {
    host = new URL(url).host;
  } catch {
    return { provider: "other", ...empty };
  }
  const extension = extensionOf(url);

  const original = cloudinaryOriginalUrl(url);
  if (original) {
    return {
      provider: "cloudinary",
      host,
      originalUrl: original,
      hasTransformation: original !== url,
      extension,
    };
  }

  const base = String(r2PublicBaseUrl || "").replace(/\/+$/, "");
  if (base && (url === base || url.startsWith(`${base}/`))) {
    return { provider: "r2", host, originalUrl: url, hasTransformation: false, extension };
  }
  return { provider: "other", host, ...empty, extension };
}

function countBy(items, keyOf) {
  const counts = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function duplicatesBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.photo.id);
  }
  return [...groups]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, photoIds]) => ({ key, photoIds }));
}

function repeatedValues(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/**
 * Aggregate view of the photo table: counts, per-property structure and the
 * anomalies a migration has to deal with. Contains no URLs.
 */
export function summarizeInventory({ properties, photos, isHeroColumn, r2PublicBaseUrl = "" }) {
  const propertyById = new Map((properties ?? []).map((property) => [property.id, property]));
  const items = (photos ?? []).map((photo) => ({
    photo,
    ...classifyPhotoReference(photo, r2PublicBaseUrl),
  }));

  const providers = { cloudinary: 0, r2: 0, other: 0, none: 0 };
  for (const item of items) providers[item.provider] += 1;

  const perProperty = [...propertyById.values()].map((property) => {
    const own = items.filter((item) => item.photo.property_id === property.id);
    const sortOrders = own.map((item) => item.photo.sort_order).sort((a, b) => a - b);
    const covers = own.filter((item) => item.photo.is_cover === true).length;
    return {
      id: property.id,
      slug: property.slug,
      name: property.name,
      isActive: property.is_active !== false,
      photoCount: own.length,
      coverCount: covers,
      heroCount: isHeroColumn ? own.filter((item) => item.photo.is_hero === true).length : null,
      providers: countBy(own, (item) => item.provider),
      sortOrders,
      duplicateSortOrders: repeatedValues(sortOrders),
    };
  });

  const anomalies = {
    isHeroColumnMissing: isHeroColumn === false,
    photosWithoutProperty: items
      .filter((item) => !propertyById.has(item.photo.property_id))
      .map((item) => item.photo.id),
    propertiesWithoutPhotos: perProperty.filter((p) => p.photoCount === 0).map((p) => p.id),
    propertiesWithoutCover: perProperty
      .filter((p) => p.photoCount > 0 && p.coverCount === 0)
      .map((p) => p.id),
    propertiesWithMultipleCovers: perProperty.filter((p) => p.coverCount > 1).map((p) => p.id),
    propertiesWithDuplicateSortOrders: perProperty
      .filter((p) => p.duplicateSortOrders.length > 0)
      .map((p) => p.id),
    photosSharingStoragePath: duplicatesBy(items, (item) => item.photo.storage_path),
    photosSharingPublicUrl: duplicatesBy(items, (item) => item.photo.public_url),
    photosWithUnsupportedSource: items
      .filter((item) => item.provider === "other" || item.provider === "none")
      .map((item) => item.photo.id),
  };

  return {
    totals: {
      properties: perProperty.length,
      activeProperties: perProperty.filter((p) => p.isActive).length,
      photos: items.length,
      providers,
      extensions: countBy(
        items.filter((item) => item.extension),
        (item) => item.extension,
      ),
      withCloudinaryTransformation: items.filter((item) => item.hasTransformation).length,
    },
    perProperty,
    anomalies,
  };
}

// The only calls the inventory is allowed to make. Anything else on the client
// or on a query builder — insert, update, upsert, delete, rpc, storage, auth —
// throws before it can reach the database.
const READ_CALLS = new Set([
  "from",
  "select",
  "eq",
  "neq",
  "in",
  "is",
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
  "then",
  "catch",
  "finally",
]);

export function readOnly(client) {
  const wrap = (target) =>
    new Proxy(target, {
      get(object, property) {
        if (typeof property === "symbol") return Reflect.get(object, property);
        const value = Reflect.get(object, property);
        if (typeof value === "function") {
          if (!READ_CALLS.has(property)) {
            return () => {
              throw new Error(`read-only inventory: ${property}() is not permitted`);
            };
          }
          return (...args) => {
            const result = value.apply(object, args);
            return typeof result === "object" && result !== null ? wrap(result) : result;
          };
        }
        return typeof value === "object" && value !== null ? wrap(value) : value;
      },
    });
  return wrap(client);
}

// --- command line ------------------------------------------------------------

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .replace(/^['"]|['"]$/g, "")
      .trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

async function probeSources(items, log) {
  const results = [];
  const seen = new Map();
  for (const item of items) {
    if (!item.originalUrl) continue;
    let status = 0;
    let bytes = null;
    if (seen.has(item.originalUrl)) {
      ({ status, bytes } = seen.get(item.originalUrl));
    } else {
      try {
        const response = await fetch(item.originalUrl, { method: "HEAD" });
        status = response.status;
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length)) bytes = length;
      } catch {
        status = 0;
      }
      seen.set(item.originalUrl, { status, bytes });
    }
    results.push({ photoId: item.photo.id, status, bytes });
  }
  const unreachable = results.filter((result) => result.status !== 200);
  log(
    `Source check: ${results.length - unreachable.length} of ${results.length} reachable, ` +
      `${results.reduce((sum, result) => sum + (result.bytes ?? 0), 0)} bytes in total`,
  );
  for (const result of unreachable) {
    log(`  ! photo ${result.photoId}: source answered HTTP ${result.status}`);
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outFile = outIndex === -1 ? null : args[outIndex + 1];
  if (outIndex !== -1 && !outFile) throw new Error("--out needs a file path");
  const shouldProbe = args.includes("--probe");

  loadEnvFile(path.resolve(__dirname, "../.env.local"));

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (reads only).");
  }

  // The public site selects this column; the inventory records whether it exists.
  const supabase = readOnly(
    createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  );

  const { data: properties, error: propertiesError } = await supabase
    .from("properties")
    .select("id, slug, name, is_active")
    .order("sort_order", { ascending: true });
  if (propertiesError) throw new Error(`Could not read properties: ${propertiesError.message}`);

  // The public site selects is_hero; probe it first so the inventory can read
  // it when the column exists and stay usable when it does not.
  const heroProbe = await supabase.from("property_photos").select("id, is_hero").limit(1);
  if (heroProbe.error && heroProbe.error.code !== "PGRST204") {
    throw new Error(`Could not read property photos: ${heroProbe.error.message}`);
  }
  const isHeroColumn = !heroProbe.error;

  const photoColumns = isHeroColumn
    ? "id, property_id, storage_path, public_url, sort_order, is_cover, is_hero"
    : "id, property_id, storage_path, public_url, sort_order, is_cover";
  const { data: photos, error: photosError } = await supabase
    .from("property_photos")
    .select(photoColumns)
    .order("property_id", { ascending: true })
    .order("sort_order", { ascending: true });
  if (photosError) throw new Error(`Could not read property photos: ${photosError.message}`);

  const r2PublicBaseUrl =
    process.env.R2_PUBLIC_BASE_URL ?? process.env.CLOUDFLARE_R2_PUBLIC_CDN_URL ?? "";
  const items = (photos ?? []).map((photo) => ({
    photo,
    ...classifyPhotoReference(photo, r2PublicBaseUrl),
  }));
  const summary = summarizeInventory({ properties, photos, isHeroColumn, r2PublicBaseUrl });

  const lines = [];
  const log = (line) => lines.push(line);
  log("Photo inventory (read-only)");
  log(
    `Properties: ${summary.totals.properties} (${summary.totals.activeProperties} active) | ` +
      `Photos: ${summary.totals.photos}`,
  );
  log(
    `By storage: Cloudinary ${summary.totals.providers.cloudinary}, R2 ${summary.totals.providers.r2}, ` +
      `other ${summary.totals.providers.other}, without URL ${summary.totals.providers.none}`,
  );
  log(
    `File types: ${
      Object.entries(summary.totals.extensions)
        .map(([ext, n]) => `${ext} ${n}`)
        .join(", ") || "none"
    } | ` + `URLs with a Cloudinary transformation: ${summary.totals.withCloudinaryTransformation}`,
  );
  log(
    `Column property_photos.is_hero: ${isHeroColumn ? "present" : "MISSING (the public site selects it)"}`,
  );
  log("Per property:");
  for (const property of summary.perProperty) {
    const orders = property.sortOrders;
    log(
      `  - ${property.name} (${property.slug}, ${property.isActive ? "active" : "inactive"}): ` +
        `${property.photoCount} photos, ${property.coverCount} cover(s)` +
        (property.heroCount === null ? "" : `, ${property.heroCount} hero`) +
        (orders.length ? `, sort order ${orders.join(",")}` : ""),
    );
  }
  const anomalies = summary.anomalies;
  const flagged = [
    anomalies.isHeroColumnMissing && "property_photos.is_hero is missing",
    anomalies.photosWithoutProperty.length &&
      `photos without a property: ${anomalies.photosWithoutProperty.join(", ")}`,
    anomalies.propertiesWithoutPhotos.length &&
      `properties without photos: ${anomalies.propertiesWithoutPhotos.join(", ")}`,
    anomalies.propertiesWithoutCover.length &&
      `properties without a cover: ${anomalies.propertiesWithoutCover.join(", ")}`,
    anomalies.propertiesWithMultipleCovers.length &&
      `properties with several covers: ${anomalies.propertiesWithMultipleCovers.join(", ")}`,
    anomalies.propertiesWithDuplicateSortOrders.length &&
      `properties with duplicate sort orders: ${anomalies.propertiesWithDuplicateSortOrders.join(", ")}`,
    anomalies.photosSharingStoragePath.length &&
      `photos sharing a stored file: ${anomalies.photosSharingStoragePath.map((d) => d.photoIds.join(" + ")).join("; ")}`,
    anomalies.photosSharingPublicUrl.length &&
      `photos sharing a URL: ${anomalies.photosSharingPublicUrl.map((d) => d.photoIds.join(" + ")).join("; ")}`,
    anomalies.photosWithUnsupportedSource.length &&
      `photos with an unexpected source: ${anomalies.photosWithUnsupportedSource.join(", ")}`,
  ].filter(Boolean);
  log("Anomalies:");
  for (const flaggedLine of flagged) log(`  ! ${flaggedLine}`);
  if (!flagged.length) log("  none");

  if (shouldProbe) await probeSources(items, log);

  console.log(lines.join("\n"));

  if (outFile) {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      isHeroColumn,
      summary,
      properties: (properties ?? []).map((property) => ({
        id: property.id,
        slug: property.slug,
        name: property.name,
        is_active: property.is_active,
      })),
      photos: items.map((item) => ({
        id: item.photo.id,
        propertyId: item.photo.property_id,
        sortOrder: item.photo.sort_order,
        isCover: item.photo.is_cover,
        isHero: item.photo.is_hero === true,
        storagePath: item.photo.storage_path,
        publicUrl: item.photo.public_url,
        provider: item.provider,
        originalUrl: item.originalUrl,
        hasTransformation: item.hasTransformation,
        extension: item.extension,
      })),
    };
    fs.writeFileSync(outFile, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Snapshot written to ${outFile}`);
  }
}

const isMain =
  typeof import.meta.main === "boolean" ? import.meta.main : process.argv[1] === __filename;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
