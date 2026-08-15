export const siteConfig = {
  name: "Stay Naples",
  tagline: "Naples, FL",
  description: "Two boutique vacation homes in Naples, Florida, booked direct with the owner.",
  url: "https://staynaples.us",
  ogImage: "https://staynaples.us/og-image.jpg",
  host: {
    name: "Eugenia Bucur Grecu",
    phone: "+1 (239) 571-4461",
    phoneHref: "tel:+12395714461",
  },
  location: {
    city: "Naples",
    region: "FL",
    regionFull: "Florida",
    country: "US",
  },
} as const;

export function absoluteUrl(path: string): string {
  return new URL(path, siteConfig.url).href;
}
