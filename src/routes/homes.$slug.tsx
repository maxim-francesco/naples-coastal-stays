import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { eachDayOfInterval, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  CalendarRange,
  MapPin,
  Users,
  Wifi,
  Sparkles,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { PhotoGallery } from "@/components/property/PhotoGallery";
import { BookingRequestDialog } from "@/components/property/BookingRequestDialog";
import { getProperty, properties, type Property } from "@/data/properties";

export const Route = createFileRoute("/homes/$slug")({
  loader: ({ params }): { property: Property } => {
    const property = getProperty(params.slug);
    if (!property) throw notFound();
    return { property };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Home not found — Palm & Sands" }, { name: "robots", content: "noindex" }],
      };
    }
    const { property } = loaderData;
    const title = `${property.name} — Naples, FL vacation rental`;
    return {
      meta: [
        { title },
        { name: "description", content: property.shortDescription.slice(0, 155) },
        { property: "og:title", content: title },
        { property: "og:description", content: property.shortDescription.slice(0, 155) },
        { property: "og:type", content: "article" },
      ],
    };
  },
  component: PropertyDetail,
});

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function PropertyDetail() {
  const { property } = Route.useLoaderData();
  const [range, setRange] = useState<DateRange | undefined>();

  const blocked = useMemo(
    () =>
      property.blackoutDates.flatMap((b) =>
        eachDayOfInterval({ start: parseISO(b.from), end: parseISO(b.to) }),
      ),
    [property.blackoutDates],
  );

  const facts = [
    { icon: Users, label: `Sleeps ${property.maxGuests}` },
    { icon: BedDouble, label: `${property.bedrooms} bedroom` },
    { icon: Bath, label: `${property.bathrooms} bathroom` },
    { icon: CalendarRange, label: `${property.minNights}-night minimum` },
  ];

  const other = properties.find((p) => p.slug !== property.slug);

  return (
    <article className="mx-auto max-w-6xl px-5 pt-8 sm:px-8">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All homes
      </Link>

      <header className="mt-6 mb-8">
        <p className="eyebrow flex items-center gap-2">
          <MapPin className="size-3.5 text-primary" /> {property.area}
        </p>
        <h1 className="mt-3 text-4xl sm:text-5xl">{property.name}</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">{property.shortDescription}</p>
      </header>

      <PhotoGallery photos={property.photos} title={property.name} />

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_360px]">
        <div>
          <ul className="flex flex-wrap gap-x-8 gap-y-4 border-y border-border py-5">
            {facts.map((fact) => (
              <li key={fact.label} className="flex items-center gap-2 text-sm">
                <fact.icon className="size-4 text-primary" />
                {fact.label}
              </li>
            ))}
          </ul>

          <section className="mt-10">
            <h2 className="text-2xl">About this home</h2>
            <div className="mt-4 space-y-4 text-muted-foreground">
              {property.longDescription.map((p) => (
                <p key={p.slice(0, 24)}>{p}</p>
              ))}
            </div>
          </section>

          <Separator className="my-10" />

          <section>
            <h2 className="text-2xl">Amenities</h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {property.amenities.map((amenity) => (
                <li key={amenity} className="flex items-center gap-3 text-sm">
                  <span className="flex size-8 items-center justify-center rounded-full bg-accent">
                    <Wifi className="size-3.5 text-primary" />
                  </span>
                  {amenity}
                </li>
              ))}
            </ul>
          </section>

          <Separator className="my-10" />

          <section>
            <h2 className="text-2xl">Availability</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Greyed-out dates are already booked. Select a range to see your estimate.
            </p>
            <div className="mt-5 inline-block rounded-2xl border border-border bg-card p-3 shadow-soft">
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                numberOfMonths={1}
                disabled={[{ before: new Date() }, ...blocked]}
                className="pointer-events-auto sm:hidden"
              />
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                numberOfMonths={2}
                disabled={[{ before: new Date() }, ...blocked]}
                className="pointer-events-auto hidden sm:block"
              />
            </div>
          </section>

          <Separator className="my-10" />

          <section>
            <h2 className="text-2xl">Where you'll be</h2>
            <div className="mt-5 flex h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-sand text-center">
              <MapPin className="size-6 text-primary" />
              <p className="text-sm text-muted-foreground">
                Map of {property.area}
                <br />
                Exact address shared after booking is confirmed.
              </p>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-3xl">{currency(property.baseRate)}</span>
              <span className="text-sm text-muted-foreground">per night</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
              <li className="flex justify-between">
                <span>Cleaning fee</span>
                <span>{currency(property.cleaningFee)}</span>
              </li>
              <li className="flex justify-between">
                <span>Minimum stay</span>
                <span>{property.minNights} nights</span>
              </li>
              <li className="flex justify-between">
                <span>Payment</span>
                <span>No card needed</span>
              </li>
            </ul>
            <div className="mt-6">
              <BookingRequestDialog
                property={property}
                range={range}
                disabledDates={blocked}
              />
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
              Booking direct with the owner — best rate, no platform fees.
            </p>
          </div>
        </aside>
      </div>

      {other && (
        <section className="mt-20 rounded-2xl bg-sand p-8 text-center sm:p-12">
          <p className="eyebrow">The other home</p>
          <h2 className="mt-3 text-3xl">{other.name}</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            {other.shortDescription}
          </p>
          <Link
            to="/homes/$slug"
            params={{ slug: other.slug }}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            View home
          </Link>
        </section>
      )}
    </article>
  );
}
