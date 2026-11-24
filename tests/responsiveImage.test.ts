import { describe, expect, test } from "bun:test";
import {
  PHOTO_VARIANT_WIDTHS,
  availableVariantWidths,
  parseR2PhotoKey,
  parseR2PhotoUrl,
  photoVariantKey,
  photoVariantSrcSet,
  photoVariantUrl,
} from "../src/lib/responsiveImage";

const KEY = "naples-coastal-stays/public/prop-1/photos/" + "a".repeat(64) + ".w1600.jpg";
const URL = "https://media.staynaples.us/" + KEY;

describe("R2 photo key parsing", () => {
  test("reads the hash, width and extension from a key", () => {
    expect(parseR2PhotoKey(KEY)).toEqual({ sha256: "a".repeat(64), width: 1600, extension: "jpg" });
  });

  test("reads the same fields from a public URL", () => {
    expect(parseR2PhotoUrl(URL)).toEqual({ sha256: "a".repeat(64), width: 1600, extension: "jpg" });
  });

  test("ignores Cloudinary, local assets and keys without a width marker", () => {
    expect(parseR2PhotoUrl("https://res.cloudinary.com/demo/image/upload/v1/a.jpg")).toBeNull();
    expect(parseR2PhotoUrl("/hero-coastal.jpg")).toBeNull();
    expect(
      parseR2PhotoUrl("https://media.staynaples.us/app/public/p/photos/" + "b".repeat(64) + ".jpg"),
    ).toBeNull();
    expect(
      parseR2PhotoUrl("https://media.staynaples.us/app/public/p/photos/not-a-hash.w1600.jpg"),
    ).toBeNull();
  });

  test("rejects malformed widths", () => {
    const base = "app/public/p/photos/" + "c".repeat(64);
    expect(parseR2PhotoKey(`${base}.w0.jpg`)).toBeNull();
    expect(parseR2PhotoKey(`${base}.w-640.jpg`)).toBeNull();
    expect(parseR2PhotoKey(`${base}.w640`)).toBeNull();
  });
});

describe("variant URLs and srcset", () => {
  test("builds a sibling WebP key and URL", () => {
    expect(photoVariantKey(KEY, 640)).toBe(KEY.replace(".w1600.jpg", ".w640.webp"));
    expect(photoVariantUrl(URL, 640)).toBe(URL.replace(".w1600.jpg", ".w640.webp"));
  });

  test("never lists a width wider than the source", () => {
    expect(availableVariantWidths(URL, [350, 640, 1600, 1920])).toEqual([350, 640, 1600]);
  });

  test("sorts, de-duplicates and drops invalid widths", () => {
    expect(availableVariantWidths(URL, [640, 350, 640, 0, -1, 1920])).toEqual([350, 640]);
  });

  test("produces a well-formed srcset ending with the untouched original", () => {
    const srcset = photoVariantSrcSet(URL, [640, 1200, 1920]);
    expect(srcset).toBe(
      [
        `${URL.replace(".w1600.jpg", ".w640.webp")} 640w`,
        `${URL.replace(".w1600.jpg", ".w1200.webp")} 1200w`,
        `${URL} 1600w`,
      ].join(", "),
    );
    expect(srcset).not.toContain("undefined");
    expect(srcset).not.toContain("null");
    expect(srcset).not.toContain("1920w");
  });

  test("returns an empty srcset for non-R2 URLs", () => {
    expect(photoVariantSrcSet("https://res.cloudinary.com/demo/image/upload/v1/a.jpg")).toBe("");
    expect(photoVariantSrcSet("/hero-coastal.jpg")).toBe("");
  });

  test("exposes a standard ladder that covers every layout width", () => {
    expect(PHOTO_VARIANT_WIDTHS).toContain(350);
    expect(PHOTO_VARIANT_WIDTHS).toContain(1920);
    expect(new Set(PHOTO_VARIANT_WIDTHS).size).toBe(PHOTO_VARIANT_WIDTHS.length);
  });
});
