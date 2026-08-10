import palmBreeze1 from "@/assets/palm-breeze-1.jpg";
import palmBreeze2 from "@/assets/palm-breeze-2.jpg";
import palmBreeze3 from "@/assets/palm-breeze-3.jpg";
import aquaSands1 from "@/assets/aqua-sands-1.jpg";
import aquaSands2 from "@/assets/aqua-sands-2.jpg";
import aquaSands3 from "@/assets/aqua-sands-3.jpg";

export const propertyAssets: Record<
  string,
  {
    photos: { src: string; alt: string }[];
    blackoutDates: { from: string; to: string }[];
  }
> = {
  "palm-breeze-retreat": {
    photos: [
      { src: palmBreeze1, alt: "Bright coastal living room opening onto a screened lanai" },
      { src: palmBreeze2, alt: "King canopy bed with sand and aqua bedding" },
      { src: palmBreeze3, alt: "Modern white kitchen with marble counters and rattan stools" },
    ],
    blackoutDates: [{ from: "2026-08-20", to: "2026-08-26" }],
  },
  "aqua-sands-suite": {
    photos: [
      { src: aquaSands1, alt: "Open living and dining space with teal sofas and marble table" },
      { src: aquaSands2, alt: "Marble bathroom with aqua glass accents" },
      { src: aquaSands3, alt: "Screened patio with rattan lounge chairs at sunset" },
    ],
    blackoutDates: [{ from: "2026-09-05", to: "2026-09-12" }],
  },
};
