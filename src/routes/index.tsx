import { createFileRoute, Link } from "@tanstack/react-router";
import { BedDouble, Bath, Users, Sparkles, KeyRound, BadgePercent, Palmtree } from "lucide-react";
import heroImage from "@/assets/hero-coastal.jpg";
import { properties } from "@/data/properties";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Palm & Sands — Two boutique vacation homes in Naples, FL" },
      {
        name: "description",
        content:
          "Book two renovated coastal homes in Naples, Florida directly with the owner. Golf-course and water views, self check-in, best direct rates.",
      },
      { property: "og:title", content: "Palm & Sands — Naples, Florida vacation homes" },
      {
        property: "og:description",
        content:
          "Two renovated coastal homes in Naples, Florida. Book direct with the owner for the best rate.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Home,
});

const trustPoints = [
  { icon: Sparkles, title: "Spotless & recently renovated", body: "Both homes were fully refreshed with new kitchens, baths and linens." },
  { icon: BadgePercent, title: "Best price, booked direct", body: "No platform service fees — you pay the owner's rate, nothing more." },
  { icon: KeyRound, title: "Self check-in", body: "Arrive whenever suits you with your own keyless entry code." },
  { icon: Palmtree, title: "Golf-course & water views", body: "Screened lanais made for coffee mornings and long Gulf sunsets." },
];

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Home() {
  return (
    <>
      <section className="relative">
        <div className="relative h-[78vh] min-h-[520px] w-full overflow-hidden">
          <img
            src={heroImage}
            alt="Sunlit coastal terrace with palms and the Gulf of Mexico beyond"
            width={1920}
            height={1088}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/55 via-foreground/15 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-5 pb-14 sm:px-8 sm:pb-20">
            <p className="eyebrow text-background/80">Naples, Florida · Gulf Coast</p>
            <h1 className="mt-4 max-w-2xl text-4xl text-background sm:text-6xl">
              Two quiet homes, kept the way we'd want to find them.
            </h1>
            <p className="mt-5 max-w-xl text-background/85">
              Light-filled, freshly renovated and minutes from the beach — booked directly with the
              owner, never through a middleman.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="max-w-2xl">
          <p className="eyebrow">The homes</p>
          <h2 className="mt-3 text-3xl sm:text-4xl">Choose your stay</h2>
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-2">
          {properties.map((property) => (
            <Link
              key={property.slug}
              to="/homes/$slug"
              params={{ slug: property.slug }}
              className="group block overflow-hidden rounded-2xl bg-card shadow-soft transition-shadow duration-500 hover:shadow-lift"
            >
              <div className="overflow-hidden">
                <img
                  src={property.photos[0]!.src}
                  alt={property.photos[0]!.alt}
                  loading="lazy"
                  width={1600}
                  height={1104}
                  className="h-72 w-full object-cover transition-transform duration-700 group-hover:scale-[1.05] sm:h-80"
                />
              </div>
              <div className="p-7">
                <p className="eyebrow">{property.area}</p>
                <h3 className="mt-2 text-2xl">{property.name}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{property.shortDescription}</p>

                <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <Users className="size-3.5 text-primary" /> Sleeps {property.maxGuests}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <BedDouble className="size-3.5 text-primary" /> {property.bedrooms} bed
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Bath className="size-3.5 text-primary" /> {property.bathrooms} bath
                  </li>
                </ul>

                <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
                  <p className="text-sm">
                    <span className="font-display text-xl">{currency(property.baseRate)}</span>
                    <span className="text-muted-foreground"> / night</span>
                  </p>
                  <span className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity group-hover:opacity-90">
                    View home
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-sand py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="eyebrow">Why book direct</p>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {trustPoints.map((point) => (
              <div key={point.title}>
                <span className="flex size-11 items-center justify-center rounded-full bg-background">
                  <point.icon className="size-5 text-primary" />
                </span>
                <h3 className="mt-4 text-lg">{point.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{point.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
