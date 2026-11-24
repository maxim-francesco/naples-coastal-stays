import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { ImageVariantError, prepareImageVariants } from "../src/lib/imageVariants";

async function jpeg(width: number, height: number, shade = 120): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: shade, g: Math.floor(shade / 2), b: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("local WebP derivatives", () => {
  test("generates every requested width up to the source, and nothing wider", async () => {
    const source = await jpeg(2000, 1200);
    const prepared = await prepareImageVariants(source, { widths: [640, 1200, 1920, 2400] });

    expect(prepared.width).toBe(2000);
    expect(prepared.height).toBe(1200);
    expect(prepared.format).toBe("jpeg");
    expect(prepared.variants.map((variant) => variant.width)).toEqual([640, 1200, 1920]);

    for (const variant of prepared.variants) {
      expect(variant.mimeType).toBe("image/webp");
      expect(variant.buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(variant.buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
      const metadata = await sharp(variant.buffer).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(variant.width);
    }
  });

  test("includes a variant equal to the source width but never upscales", async () => {
    const source = await jpeg(1200, 800);
    const prepared = await prepareImageVariants(source, { widths: [640, 1200, 1600] });
    expect(prepared.variants.map((variant) => variant.width)).toEqual([640, 1200]);

    const small = await jpeg(500, 300);
    const smallPrepared = await prepareImageVariants(small, { widths: [350, 640] });
    expect(smallPrepared.variants.map((variant) => variant.width)).toEqual([350]);
  });

  test("keeps the original bytes untouched", async () => {
    const source = await jpeg(800, 600);
    const copy = Buffer.from(source);
    await prepareImageVariants(source, { widths: [640] });
    expect(source.equals(copy)).toBe(true);
  });

  test("is deterministic, so a re-run produces the same bytes and keys", async () => {
    const source = await jpeg(900, 600, 90);
    const first = await prepareImageVariants(source, { widths: [350, 640] });
    const second = await prepareImageVariants(source, { widths: [350, 640] });
    expect(
      first.variants.map((variant, index) => variant.buffer.equals(second.variants[index]!.buffer)),
    ).toEqual([true, true]);
  });

  test("rejects bytes that are not a decodable image", async () => {
    let caught: ImageVariantError | null = null;
    try {
      await prepareImageVariants(Buffer.from("not an image at all"), { widths: [640] });
    } catch (error) {
      caught = error as ImageVariantError;
    }
    expect(caught?.code).toBe("IMAGE_UNDECODABLE");
  });
});
