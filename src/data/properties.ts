import palmBreeze1 from "@/assets/palm-breeze-1.jpg";
import palmBreeze2 from "@/assets/palm-breeze-2.jpg";
import palmBreeze3 from "@/assets/palm-breeze-3.jpg";
import aquaSands1 from "@/assets/aqua-sands-1.jpg";
import aquaSands2 from "@/assets/aqua-sands-2.jpg";
import aquaSands3 from "@/assets/aqua-sands-3.jpg";

export type Property = {
  slug: string;
  name: string;
  area: string;
  shortDescription: string;
  longDescription: string[];
  maxGuests: number;
  bedrooms: number;
  bathrooms: number;
  minNights: number;
  baseRate: number;
  cleaningFee: number;
  amenities: string[];
  photos: { src: string; alt: string }[];
  /** Placeholder blackout ranges until the admin area is built. */
  blackoutDates: { from: string; to: string }[];
};

export const properties: Property[] = [
  {
    slug: "palm-breeze-retreat",
    name: "Palm Breeze Retreat",
    area: "Naples, Florida — golf course views",
    shortDescription:
      "A bright, fully renovated coastal condo with a screened lanai overlooking the palms and the golf course.",
    longDescription: [
      "Palm Breeze Retreat is a light-filled one-bedroom condo, renovated top to bottom in a soft palette of white, sand and sea glass. Mornings start on the screened lanai with coffee and the sound of palms; evenings end under the king canopy bed with the shutters open.",
      "The modern white kitchen is fully equipped for a long, slow stay — marble counters, full-size appliances and everything you need to cook if you'd rather not go out. Naples' beaches, Fifth Avenue South and the golf course are all a short drive away.",
    ],
    maxGuests: 3,
    bedrooms: 1,
    bathrooms: 1,
    minNights: 3,
    baseRate: 180,
    cleaningFee: 90,
    amenities: [
      "Fast Wi-Fi",
      "Central air conditioning",
      "Full modern kitchen",
      "Screened lanai",
      "Golf course view",
      "Free parking",
      "Washer & dryer",
      "Smart TV",
      "Self check-in",
      "Coffee maker",
    ],
    photos: [
      { src: palmBreeze1, alt: "Bright coastal living room opening onto a screened lanai" },
      { src: palmBreeze2, alt: "King canopy bed with sand and aqua bedding" },
      { src: palmBreeze3, alt: "Modern white kitchen with marble counters and rattan stools" },
    ],
    blackoutDates: [{ from: "2026-08-20", to: "2026-08-26" }],
  },
  {
    slug: "aqua-sands-suite",
    name: "Aqua Sands Suite",
    area: "Naples, Florida — water views",
    shortDescription:
      "An elegant renovated suite with an open living and dining space, marble bathrooms and a walkout screened patio.",
    longDescription: [
      "Aqua Sands Suite pairs an open living and dining space with coastal decor in teal and sand. The finishes are quietly luxurious — marble in the bathroom, natural textures underfoot, and generous windows that keep the whole home in daylight.",
      "Step straight out to the screened patio for sunset over the water. It sleeps up to four comfortably, making it an easy choice for couples travelling together or a small family escaping winter.",
    ],
    maxGuests: 4,
    bedrooms: 1,
    bathrooms: 1,
    minNights: 3,
    baseRate: 195,
    cleaningFee: 90,
    amenities: [
      "Fast Wi-Fi",
      "Central air conditioning",
      "Open kitchen & dining",
      "Screened patio",
      "Water view",
      "Marble bathroom",
      "Free parking",
      "Washer & dryer",
      "Smart TV",
      "Self check-in",
    ],
    photos: [
      { src: aquaSands1, alt: "Open living and dining space with teal sofas and marble table" },
      { src: aquaSands2, alt: "Marble bathroom with aqua glass accents" },
      { src: aquaSands3, alt: "Screened patio with rattan lounge chairs at sunset" },
    ],
    blackoutDates: [{ from: "2026-09-05", to: "2026-09-12" }],
  },
];

export const getProperty = (slug: string) => properties.find((p) => p.slug === slug);
