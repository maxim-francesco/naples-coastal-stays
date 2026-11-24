// Server-side photo optimisation: takes the bytes the browser uploaded, keeps
// an untouched content-addressed original and stores WebP derivatives next to
// it. Used by the admin upload path today and by the migration script's copy
// phase conceptually (the script uses the same helpers through its own storage
// instance).
import "@tanstack/react-start/server-only";

import { MediaError, NAPLES_IMAGE_MAX_BYTES, naplesMedia, propertyMediaPrefix } from "./r2Media";
import { prepareImageVariants } from "./imageVariants";
import { PHOTO_VARIANT_WIDTHS, photoVariantKey } from "./responsiveImage";

export interface StoredVariant {
  width: number;
  key: string;
  url: string;
  sha256: string;
  bytes: number;
  reused: boolean;
}

export interface StoredPhoto {
  original: {
    key: string;
    url: string;
    width: number;
    height: number;
    sha256: string;
    bytes: number;
    reused: boolean;
  };
  variants: StoredVariant[];
}

async function deleteQuietly(propertyId: string, key: string): Promise<void> {
  try {
    await naplesMedia.deleteObject(key, propertyMediaPrefix(propertyId));
  } catch {
    // Best-effort: the caller is already handling a failure.
  }
}

/**
 * Content-addressed original (with its pixel width in the key) plus one WebP
 * variant per standard width up to the source width. Any object created before
 * a failure is removed again, so a failed call leaves the bucket unchanged.
 */
export async function storePhotoWithVariants({
  propertyId,
  buffer,
  mimeType,
  widths = PHOTO_VARIANT_WIDTHS,
}: {
  propertyId: string;
  buffer: Buffer;
  mimeType: string;
  widths?: readonly number[];
}): Promise<StoredPhoto> {
  const prepared = await prepareImageVariants(buffer, { widths });
  const expectedPrefix = propertyMediaPrefix(propertyId);
  const created: string[] = [];

  try {
    const original = await naplesMedia.uploadImage({
      buffer,
      mimeType,
      ownerId: propertyId,
      category: "photos",
      visibility: "public",
      maxBytes: NAPLES_IMAGE_MAX_BYTES,
      width: prepared.width,
      metadata: { height: String(prepared.height) },
    });
    if (!original.url) {
      throw new MediaError("MEDIA_PRIVATE_OBJECT", "Public media URL is not configured.", 503);
    }
    created.push(original.key);

    const variants: StoredVariant[] = [];
    for (const variant of prepared.variants) {
      const key = photoVariantKey(original.key, variant.width);
      if (!key) throw new MediaError("MEDIA_INVALID_KEY", "Could not derive the variant key.", 400);
      const stored = await naplesMedia.putPublicImage({
        key,
        buffer: variant.buffer,
        mimeType: "image/webp",
        expectedPrefix,
        maxBytes: NAPLES_IMAGE_MAX_BYTES,
        metadata: {
          originalSha: original.sha256,
          width: String(variant.width),
          format: "webp",
        },
      });
      if (!stored.reused) created.push(stored.key);
      variants.push({
        width: variant.width,
        key: stored.key,
        url: stored.url,
        sha256: stored.sha256,
        bytes: stored.bytes,
        reused: stored.reused === true,
      });
    }

    return {
      original: {
        key: original.key,
        url: original.url,
        width: prepared.width,
        height: prepared.height,
        sha256: original.sha256,
        bytes: original.bytes,
        reused: original.reused === true,
      },
      variants,
    };
  } catch (error) {
    for (const key of created) await deleteQuietly(propertyId, key);
    throw error;
  }
}
