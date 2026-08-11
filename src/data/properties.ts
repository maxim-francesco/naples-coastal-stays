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
    name: "Cathedral Heights",
    area: "Naples, Florida — Cathedral Heights",
    shortDescription:
      "A five-minute drive to Clam Pass Beach, close to shopping and dining. Small dogs welcome.",
    longDescription: [
      "Cathedral Heights is an entire four-bedroom home tucked into a quiet residential neighbourhood in Naples, kept clean and well-stocked for easy family stays.",
      "The screened-in private pool is the heart of the home, with loungers and a covered outdoor living area for relaxing between beach days.",
      "You're about a fifteen-minute walk from The Baker Museum and a short drive from Clam Pass Beach, with shopping and dining close by.",
    ],
    maxGuests: 8,
    bedrooms: 4,
    bathrooms: 2,
    minNights: 3,
    baseRate: 180,
    cleaningFee: 90,
    amenities: [
      "Pool",
      "Free parking",
      "Wifi",
      "Air conditioning",
      "Kitchen",
      "Indoor fireplace",
      "Ceiling fan",
      "Washer & dryer",
      "TV with standard cable",
      "Coffee maker",
      "Private entrance",
      "Crib",
      "High chair",
      "Smoke alarm"
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
    name: "Turtle Lake",
    area: "Naples, Florida — Turtle Lakes community",
    shortDescription:
      "A recently renovated two-bedroom condo in Turtle Lakes, walking distance to shopping and dining and minutes from Clam Pass Beach.",
    longDescription: [
      "Turtle Lake is a recently renovated two-bedroom, two-bath condo in the Turtle Lakes community, finished with new tile, laminate flooring and high-end furnishings.",
      "The master bedroom has a king bed and private bathroom, the guest room a queen, and the open living room features an electric fireplace and a large TV.",
      "The community adds a golf course, tennis court, shared pool, gym, sauna and clubhouse, with a screened lanai off the living room for the Florida climate.",
    ],
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 2,
    minNights: 3,
    baseRate: 195,
    cleaningFee: 90,
    amenities: [
      "Beach access",
      "Wifi",
      "Air conditioning",
      "Kitchen",
      "Dedicated workspace",
      "Shared pool",
      "Indoor fireplace",
      "Washer & dryer",
      "HDTV with Netflix",
      "Elevator",
      "Free parking",
      "Bathtub",
      "Coffee maker",
      "Dishwasher",
      "Smoke alarm"
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
