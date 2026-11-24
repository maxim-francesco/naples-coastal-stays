// Responsive photo URLs for media stored in Cloudflare R2.
//
// Originals are stored content-addressed with their pixel width in the file
// name, for example:
//
//   naples-coastal-stays/public/<propertyId>/photos/<sha256>.w1600.jpg
//
// WebP derivatives sit next to the original and differ only by width:
//
//   naples-coastal-stays/public/<propertyId>/photos/<sha256>.w640.webp
//
// The width marker lets the renderer build a `srcset` that only contains files
// that were actually generated, so a small source image can never produce a
// candidate that 404s. The original JPG stays the universal fallback.

export const PHOTO_VARIANT_WIDTHS: readonly number[] = [
  350, 447, 528, 538, 640, 700, 828, 1056, 1076, 1200, 1600, 1920,
];

export const PHOTO_VARIANT_QUALITY = 80;

export interface R2PhotoKeyParts {
  sha256: string;
  width: number;
  extension: string;
}

const ORIGINAL_BASENAME = /^([a-f0-9]{64})\.w([1-9][0-9]{1,4})\.(jpe?g|png|webp|gif)$/i;

function parseBasename(basename: string): R2PhotoKeyParts | null {
  const match = ORIGINAL_BASENAME.exec(basename);
  if (!match) return null;
  const sha256 = match[1];
  const width = Number(match[2]);
  const extension = match[3];
  if (!sha256 || !extension || !Number.isInteger(width) || width <= 0) return null;
  return { sha256: sha256.toLowerCase(), width, extension: extension.toLowerCase() };
}

// Reads the width marker from a storage key (not a URL).
export function parseR2PhotoKey(key: string): R2PhotoKeyParts | null {
  if (typeof key !== "string" || !key) return null;
  const basename = key.split("/").pop();
  return basename ? parseBasename(basename) : null;
}

// Reads the width marker from an R2 public URL. Cloudinary, local assets and
// any URL without the marker return null, which keeps those images on their
// existing single-file path.
export function parseR2PhotoUrl(url: string): R2PhotoKeyParts | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.includes("/public/")) return null;
    const basename = parsed.pathname.split("/").pop();
    return basename ? parseBasename(decodeURIComponent(basename)) : null;
  } catch {
    return null;
  }
}

export function photoVariantKey(originalKey: string, width: number): string | null {
  const parts = parseR2PhotoKey(originalKey);
  if (!parts || !Number.isInteger(width) || width <= 0) return null;
  const directory = originalKey.slice(0, originalKey.lastIndexOf("/") + 1);
  return `${directory}${parts.sha256}.w${width}.webp`;
}

export function photoVariantUrl(originalUrl: string, width: number): string | null {
  const parts = parseR2PhotoUrl(originalUrl);
  if (!parts || !Number.isInteger(width) || width <= 0) return null;
  try {
    const parsed = new URL(originalUrl);
    const segments = parsed.pathname.split("/");
    segments[segments.length - 1] = `${parts.sha256}.w${width}.webp`;
    parsed.pathname = segments.join("/");
    return parsed.toString();
  } catch {
    return null;
  }
}

// Widths that are guaranteed to exist for this original: positive integers, no
// duplicates, no wider than the source. Returns an ascending list.
export function availableVariantWidths(
  url: string,
  widths: readonly number[] = PHOTO_VARIANT_WIDTHS,
): number[] {
  const max = parseR2PhotoUrl(url)?.width;
  if (!max) return [];
  const unique = new Set<number>();
  for (const width of widths) {
    if (Number.isInteger(width) && width > 0 && width <= max) unique.add(width);
  }
  return [...unique].sort((a, b) => a - b);
}

// A `srcset` built from the generated WebP files, plus the untouched original
// at its own width as the final, highest-quality candidate. Empty when the URL
// is not an R2 photo. No candidate is ever wider than the source.
export function photoVariantSrcSet(
  url: string,
  widths: readonly number[] = PHOTO_VARIANT_WIDTHS,
): string {
  const parts = parseR2PhotoUrl(url);
  if (!parts) return "";
  const available = availableVariantWidths(url, widths);
  const candidates = available
    .map((width) => {
      const variantUrl = photoVariantUrl(url, width);
      return variantUrl ? `${variantUrl} ${width}w` : null;
    })
    .filter((entry): entry is string => entry !== null);
  if (!available.includes(parts.width)) {
    candidates.push(`${url} ${parts.width}w`);
  }
  return candidates.join(", ");
}
