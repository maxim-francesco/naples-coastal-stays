import { describe, expect, test } from "bun:test";
import {
  classifyPhotoReference,
  cloudinaryOriginalUrl,
  readOnly,
  summarizeInventory,
} from "../scripts/r2-migration-inventory.mjs";

// Tests for the pure parts of the read-only inventory script. The script's
// command-line entry point is never executed here: importing the module does
// not read the environment or open a connection.

const CLOUD =
  "https://res.cloudinary.com/demo-cloud/image/upload/v1755000000/naples-coastal-stays/prop-1/photos/";
const R2_BASE = "https://media.example.test/";

test("importing the inventory module has no side effects", () => {
  // The entry point is guarded; nothing above connected anywhere.
  expect(typeof summarizeInventory).toBe("function");
});

describe("cloudinaryOriginalUrl", () => {
  test("returns an untransformed upload URL unchanged", () => {
    const url = `${CLOUD}abc.jpg`;
    expect(cloudinaryOriginalUrl(url)).toBe(url);
  });

  test("strips a transformation segment, keeping version, path and query", () => {
    // Cloudinary puts transformations directly after "/image/upload/", before
    // the version segment.
    const upload = "https://res.cloudinary.com/demo-cloud/image/upload/";
    expect(
      cloudinaryOriginalUrl(
        `${upload}ar_3:2,c_fill,f_auto,q_auto,w_800/v1755000000/naples-coastal-stays/prop-1/photos/abc.jpg`,
      ),
    ).toBe(`${CLOUD}abc.jpg`);
    expect(
      cloudinaryOriginalUrl(
        `${upload}c_fill/v1755000000/naples-coastal-stays/prop-1/photos/abc.jpg?x=1`,
      ),
    ).toBe(`${CLOUD}abc.jpg?x=1`);
    expect(cloudinaryOriginalUrl(`${upload}c_limit,w_800/abc.jpg`)).toBe(`${upload}abc.jpg`);
  });

  test("never mistakes a folder or version for a transformation", () => {
    expect(
      cloudinaryOriginalUrl("https://res.cloudinary.com/c/image/upload/naples-coastal-stays/a.jpg"),
    ).toBe("https://res.cloudinary.com/c/image/upload/naples-coastal-stays/a.jpg");
    expect(cloudinaryOriginalUrl("https://res.cloudinary.com/c/image/upload/v1/a.jpg")).toBe(
      "https://res.cloudinary.com/c/image/upload/v1/a.jpg",
    );
  });

  test("returns null for anything that is not a Cloudinary upload URL", () => {
    expect(cloudinaryOriginalUrl(`${R2_BASE}naples-coastal-stays/public/a.jpg`)).toBeNull();
    expect(
      cloudinaryOriginalUrl("https://res.cloudinary.com/c/image/fetch/https://x.test/a.jpg"),
    ).toBeNull();
    expect(cloudinaryOriginalUrl("")).toBeNull();
    expect(cloudinaryOriginalUrl(null)).toBeNull();
  });
});

describe("classifyPhotoReference", () => {
  test("tells Cloudinary, R2, other and empty references apart", () => {
    expect(classifyPhotoReference({ public_url: `${CLOUD}abc.jpg` })).toEqual({
      provider: "cloudinary",
      host: "res.cloudinary.com",
      originalUrl: `${CLOUD}abc.jpg`,
      hasTransformation: false,
      extension: "jpg",
    });
    expect(
      classifyPhotoReference({
        public_url:
          "https://res.cloudinary.com/demo-cloud/image/upload/w_800/v1755000000/naples-coastal-stays/prop-1/photos/abc.JPG",
      }),
    ).toMatchObject({
      originalUrl: `${CLOUD}abc.JPG`,
      hasTransformation: true,
      extension: "jpg",
    });
    const key = "naples-coastal-stays/public/prop-1/photos/pending/1-a.png";
    expect(classifyPhotoReference({ public_url: `${R2_BASE}${key}` }, `${R2_BASE}`)).toEqual({
      provider: "r2",
      host: "media.example.test",
      originalUrl: `${R2_BASE}${key}`,
      hasTransformation: false,
      extension: "png",
    });
    // A look-alike host and an unconfigured base are not R2.
    expect(classifyPhotoReference({ public_url: `${R2_BASE}x.jpg` }).provider).toBe("other");
    expect(
      classifyPhotoReference(
        { public_url: "https://media.example.test.attacker.example/x.jpg" },
        R2_BASE,
      ).provider,
    ).toBe("other");
    expect(
      classifyPhotoReference({ public_url: "https://a0.muscache.com/im/pictures/x.jpeg?im_w=1600" })
        .provider,
    ).toBe("other");
    expect(classifyPhotoReference({ public_url: "   " }).provider).toBe("none");
    expect(classifyPhotoReference({ public_url: "not a url" }).provider).toBe("other");
  });

  test("accepts an R2 base URL with or without a trailing slash", () => {
    const url = `${R2_BASE}naples-coastal-stays/public/a.jpg`;
    expect(classifyPhotoReference({ public_url: url }, R2_BASE).provider).toBe("r2");
    expect(classifyPhotoReference({ public_url: url }, R2_BASE.slice(0, -1)).provider).toBe("r2");
  });
});

describe("summarizeInventory", () => {
  const one = { id: "prop-1", slug: "one", name: "One", is_active: true };
  const two = { id: "prop-2", slug: "two", name: "Two", is_active: false };

  test("counts a clean inventory without flagging anything", () => {
    const summary = summarizeInventory({
      properties: [one, two],
      isHeroColumn: true,
      photos: [
        {
          id: "a",
          property_id: "prop-1",
          storage_path: "naples-coastal-stays/prop-1/a",
          public_url: `${CLOUD}a.jpg`,
          sort_order: 1,
          is_cover: true,
          is_hero: true,
        },
        {
          id: "b",
          property_id: "prop-1",
          storage_path: "naples-coastal-stays/prop-1/b",
          public_url: `${CLOUD}b.png`,
          sort_order: 2,
          is_cover: false,
          is_hero: false,
        },
        {
          id: "c",
          property_id: "prop-2",
          storage_path: "naples-coastal-stays/prop-2/c",
          public_url: `${CLOUD}c.jpg`,
          sort_order: 1,
          is_cover: true,
          is_hero: false,
        },
      ],
    });
    expect(summary.totals).toEqual({
      properties: 2,
      activeProperties: 1,
      photos: 3,
      providers: { cloudinary: 3, r2: 0, other: 0, none: 0 },
      extensions: { jpg: 2, png: 1 },
      withCloudinaryTransformation: 0,
    });
    expect(summary.perProperty[0]).toMatchObject({
      photoCount: 2,
      coverCount: 1,
      heroCount: 1,
      sortOrders: [1, 2],
      duplicateSortOrders: [],
    });
    expect(summary.anomalies).toEqual({
      isHeroColumnMissing: false,
      photosWithoutProperty: [],
      propertiesWithoutPhotos: [],
      propertiesWithoutCover: [],
      propertiesWithMultipleCovers: [],
      propertiesWithDuplicateSortOrders: [],
      photosSharingStoragePath: [],
      photosSharingPublicUrl: [],
      photosWithUnsupportedSource: [],
    });
  });

  test("reports every condition a migration has to handle", () => {
    const summary = summarizeInventory({
      properties: [one, two],
      isHeroColumn: false,
      photos: [
        {
          id: "a",
          property_id: "prop-1",
          storage_path: "shared",
          public_url: `${CLOUD}a.jpg`,
          sort_order: 1,
          is_cover: true,
        },
        {
          id: "b",
          property_id: "prop-1",
          storage_path: "shared",
          public_url: `${CLOUD}a.jpg`,
          sort_order: 1,
          is_cover: true,
        },
        {
          id: "c",
          property_id: "prop-2",
          storage_path: "x",
          public_url: `${CLOUD}c.jpg`,
          sort_order: 1,
          is_cover: false,
        },
        {
          id: "d",
          property_id: "prop-gone",
          storage_path: "y",
          public_url: "https://a0.muscache.com/x.jpeg",
          sort_order: 1,
          is_cover: true,
        },
      ],
    });
    expect(summary.anomalies.isHeroColumnMissing).toBe(true);
    expect(summary.anomalies.photosWithoutProperty).toEqual(["d"]);
    expect(summary.anomalies.propertiesWithoutCover).toEqual(["prop-2"]);
    expect(summary.anomalies.propertiesWithMultipleCovers).toEqual(["prop-1"]);
    expect(summary.anomalies.propertiesWithDuplicateSortOrders).toEqual(["prop-1"]);
    expect(summary.anomalies.photosSharingStoragePath).toEqual([
      { key: "shared", photoIds: ["a", "b"] },
    ]);
    expect(summary.anomalies.photosSharingPublicUrl).toEqual([
      { key: `${CLOUD}a.jpg`, photoIds: ["a", "b"] },
    ]);
    expect(summary.anomalies.photosWithUnsupportedSource).toEqual(["d"]);
    expect(summary.totals.providers).toEqual({ cloudinary: 3, r2: 0, other: 1, none: 0 });
  });

  test("counts photos already moved to R2 when the public base URL is known", () => {
    const summary = summarizeInventory({
      properties: [one],
      isHeroColumn: true,
      r2PublicBaseUrl: R2_BASE,
      photos: [
        {
          id: "a",
          property_id: "prop-1",
          storage_path: "naples-coastal-stays/public/prop-1/photos/pending/1.jpg",
          public_url: `${R2_BASE}naples-coastal-stays/public/prop-1/photos/pending/1.jpg`,
          sort_order: 1,
          is_cover: true,
        },
        {
          id: "b",
          property_id: "prop-1",
          storage_path: "naples-coastal-stays/prop-1/b",
          public_url: `${CLOUD}b.jpg`,
          sort_order: 2,
          is_cover: false,
        },
      ],
    });
    expect(summary.totals.providers).toEqual({ cloudinary: 1, r2: 1, other: 0, none: 0 });
    expect(summary.anomalies.propertiesWithoutPhotos).toEqual([]);
  });

  test("lists a property that has no photos at all", () => {
    const summary = summarizeInventory({ properties: [one, two], photos: [], isHeroColumn: true });
    expect(summary.anomalies.propertiesWithoutPhotos).toEqual(["prop-1", "prop-2"]);
    expect(summary.perProperty.map((p) => p.heroCount)).toEqual([0, 0]);
  });
});

describe("readOnly", () => {
  function fakeClient() {
    const builder = () => {
      const api = {
        select: () => api,
        eq: () => api,
        order: () => api,
        limit: () => api,
        then: (resolve) => resolve({ data: [{ id: "a" }], error: null }),
        insert: () => api,
        update: () => api,
        upsert: () => api,
        delete: () => api,
      };
      return api;
    };
    return {
      from: () => builder(),
      rpc: () => Promise.resolve({ data: null }),
      auth: { getUser: () => Promise.resolve({}) },
      storage: { from: () => ({ upload: () => ({}) }) },
      removeAllChannels: () => {},
    };
  }

  test("lets read chains through", async () => {
    const client = readOnly(fakeClient());
    const result = await client
      .from("property_photos")
      .select("id")
      .eq("id", "a")
      .order("id")
      .limit(1);
    expect(result).toEqual({ data: [{ id: "a" }], error: null });
  });

  test("blocks every write and every other client capability", () => {
    const client = readOnly(fakeClient());
    const blocked = [
      () => client.from("t").insert({ a: 1 }),
      () => client.from("t").update({ a: 1 }),
      () => client.from("t").upsert({ a: 1 }),
      () => client.from("t").delete(),
      () => client.rpc("a_function"),
      () => client.auth.getUser(),
      () => client.storage.from("bucket").upload("k", {}),
      () => client.removeAllChannels(),
    ];
    for (const attempt of blocked) {
      expect(() => attempt()).toThrow("read-only inventory:");
    }
  });
});
