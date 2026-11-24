// Local WebP derivative generation for property photos.
//
// Cloudflare R2 stores and serves bytes as they are, so responsive variants are
// produced before upload. `sharp` (libvips) is the only image dependency and is
// used on the server and in the migration script, never in the browser bundle.
//
// Rules enforced here:
//   - the original JPEG/PNG is never re-encoded or altered;
//   - no variant is wider than the source (no upscaling);
//   - every requested width up to the source width is generated once;
//   - output is WebP at a fixed quality, so a given input always produces the
//     same bytes and the content-addressed key stays stable.

import sharp, { type Metadata } from "sharp";
import { PHOTO_VARIANT_QUALITY, PHOTO_VARIANT_WIDTHS } from "./responsiveImage";

export interface ImageVariant {
  width: number;
  mimeType: "image/webp";
  buffer: Buffer;
}

export interface PreparedImage {
  width: number;
  height: number;
  format: string;
  variants: ImageVariant[];
}

export class ImageVariantError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ImageVariantError";
    this.code = code;
  }
}

const ORIENTATION_SWAPS_DIMENSIONS = new Set([5, 6, 7, 8]);

export async function prepareImageVariants(
  buffer: Buffer,
  {
    widths = PHOTO_VARIANT_WIDTHS,
    quality = PHOTO_VARIANT_QUALITY,
  }: { widths?: readonly number[]; quality?: number } = {},
): Promise<PreparedImage> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImageVariantError("IMAGE_EMPTY", "An image is required.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch {
    throw new ImageVariantError("IMAGE_UNDECODABLE", "The image could not be decoded.");
  }

  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new ImageVariantError(
      "IMAGE_DIMENSIONS_UNAVAILABLE",
      "The image dimensions are unavailable.",
    );
  }

  // EXIF orientation 5-8 rotates the image a quarter turn, so the displayed
  // width is the stored height. The variant pipeline applies `.rotate()`, which
  // makes the output match what a browser shows.
  const swaps = ORIENTATION_SWAPS_DIMENSIONS.has(metadata.orientation ?? 1);
  const width = swaps ? metadata.height : metadata.width;
  const height = swaps ? metadata.width : metadata.height;

  const targets = [...new Set(widths)]
    .filter((candidate) => Number.isInteger(candidate) && candidate > 0 && candidate <= width)
    .sort((a, b) => a - b);

  const variants: ImageVariant[] = [];
  for (const target of targets) {
    let output: Buffer;
    try {
      output = await sharp(buffer, { failOn: "error" })
        .rotate()
        .resize({ width: target, withoutEnlargement: true, fit: "inside" })
        .webp({ quality, effort: 4, smartSubsample: true })
        .toBuffer();
    } catch {
      throw new ImageVariantError(
        "IMAGE_VARIANT_FAILED",
        `Could not create the ${target}px variant.`,
      );
    }
    if (!output || output.length === 0) {
      throw new ImageVariantError("IMAGE_VARIANT_EMPTY", `The ${target}px variant is empty.`);
    }
    variants.push({ width: target, mimeType: "image/webp", buffer: output });
  }

  return { width, height, format: metadata.format, variants };
}
