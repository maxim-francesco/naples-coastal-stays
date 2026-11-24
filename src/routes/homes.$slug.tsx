import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  CalendarDays,
  CalendarRange,
  MapPin,
  Users,
  Wifi,
  Sparkles,
  Snowflake,
  ChefHat,
  Sun,
  Flag,
  Car,
  WashingMachine,
  Tv,
  KeyRound,
  Coffee,
  Waves,
  Bath as BathIcon,
  UtensilsCrossed,
  Check,
  Umbrella,
  Flame,
  Fan,
  DoorOpen,
  Baby,
  ShieldCheck,
  Laptop,
  ArrowUpDown,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhotoGallery } from "@/components/property/PhotoGallery";
import { BookingRequestDialog } from "@/components/property/BookingRequestDialog";
import {
  StayCalendar,
  defaultStaySelection,
  selectionNights,
  selectionToRange,
  type StaySelection,
} from "@/components/property/StayCalendar";
import {
  getPropertyBySlug,
  getActiveProperties,
  getPropertyAvailability,
  type Property,
} from "@/lib/properties.server";
import {
  dateOnlyToLocalDate,
  findAvailabilityConflict,
  todayInTimeZone,
  validateStayRequest,
} from "@/lib/availability";
import { absoluteUrl } from "@/lib/site-config";

const amenityIcons: Record<string, typeof Wifi> = {
  "Fast Wi-Fi": Wifi,
  "Central air conditioning": Snowflake,
  "Full modern kitchen": ChefHat,
  "Open kitchen & dining": UtensilsCrossed,
  "Screened lanai": Sun,
  "Screened patio": Sun,
  "Golf course view": Flag,
  "Water view": Waves,
  "Marble bathroom": BathIcon,
  "Free parking": Car,
  "Washer & dryer": WashingMachine,
  "Smart TV": Tv,
  "Self check-in": KeyRound,
  "Coffee maker": Coffee,

  // New mappings for Cathedral Heights & Turtle Lake
  Pool: Waves,
  "Shared pool": Waves,
  "Beach access": Umbrella,
  Wifi: Wifi,
  "Air conditioning": Snowflake,
  Kitchen: ChefHat,
  "Indoor fireplace": Flame,
  "Ceiling fan": Fan,
  "TV with standard cable": Tv,
  "HDTV with Netflix": Tv,
  "Private entrance": DoorOpen,
  Crib: Baby,
  "High chair": Baby,
  "Smoke alarm": ShieldCheck,
  "Dedicated workspace": Laptop,
  Elevator: ArrowUpDown,
  Bathtub: Bath,
  Dishwasher: WashingMachine,
};

export const Route = createFileRoute("/homes/$slug")({
  loader: async ({
    params,
  }): Promise<{ property: Property; activeProperties: Property[]; today: string }> => {
    const [property, activeProperties] = await Promise.all([
      getPropertyBySlug({ data: params.slug }),
      getActiveProperties(),
    ]);
    if (!property) throw notFound();
    return { property, activeProperties, today: todayInTimeZone() };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Home not found — Stay Naples" }, { name: "robots", content: "noindex" }],
      };
    }
    const { property } = loaderData;
    const title = `${property.name} — Naples, FL vacation rental`;
    const description = property.shortDescription.slice(0, 155);
    const canonical = absoluteUrl(`/homes/${property.slug}`);

    const jsonLdVacationRental = {
      "@context": "https://schema.org",
      "@type": "VacationRental",
      name: property.name,
      description: property.shortDescription,
      url: canonical,
      image: property.photos.map((p) => p.src),
      address: {
        "@type": "PostalAddress",
        addressLocality: "Naples",
        addressRegion: "FL",
        addressCountry: "US",
      },
      numberOfRooms: property.bedrooms,
      occupancy: {
        "@type": "QuantitativeValue",
        maxValue: property.maxGuests,
      },
      amenityFeature: property.amenities.map((amenity) => ({
        "@type": "LocationFeatureSpecification",
        name: amenity,
        value: true,
      })),
      priceRange: `$${property.baseRate}-$${property.baseRate + property.cleaningFee}`,
    };

    const jsonLdBreadcrumbs = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: absoluteUrl("/"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: property.name,
          item: canonical,
        },
      ],
    };

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: canonical }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(jsonLdVacationRental),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(jsonLdBreadcrumbs),
        },
      ],
    };
  },
  component: PropertyDetail,
});

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function displayDate(value: string | null) {
  if (!value) return "—";
  return dateOnlyToLocalDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function displayShortDate(value: string | null) {
  if (!value) return "—";
  return dateOnlyToLocalDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function PropertyDetail() {
  const { property, activeProperties, today: loaderToday } = Route.useLoaderData();
  const [today, setToday] = useState(loaderToday);
  const [unavailableDates, setUnavailableDates] = useState(property.unavailableDates);
  const [availabilityStatus, setAvailabilityStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [selection, setSelection] = useState<StaySelection>(defaultStaySelection);
  const [guests, setGuests] = useState(() => Math.min(2, property.maxGuests));
  const [bookingOpen, setBookingOpen] = useState(false);
  const inlineCtaRef = useRef<HTMLButtonElement | null>(null);
  const asideCtaRef = useRef<HTMLButtonElement | null>(null);
  const [mainCtaInView, setMainCtaInView] = useState(true);

  const refreshAvailability = useCallback(async () => {
    setAvailabilityStatus("loading");
    try {
      const result = await getPropertyAvailability({ data: property.slug });
      if (!result) throw new Error("Property not found.");
      setUnavailableDates(result.unavailableDates);
      setToday(result.today);
      setAvailabilityStatus("idle");
    } catch (error) {
      console.error("Could not refresh availability:", error);
      setAvailabilityStatus("error");
    }
  }, [property.slug]);

  useEffect(() => {
    void refreshAvailability();
  }, [refreshAvailability]);

  // The mobile CTA stands in for the main "Request to book" button while it is
  // off screen. Track both in-page buttons so the two never show together.
  useEffect(() => {
    const targets = [inlineCtaRef.current, asideCtaRef.current].filter(
      (node): node is HTMLButtonElement => node !== null,
    );
    if (targets.length === 0) return;

    const intersecting = new Map<Element, boolean>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) intersecting.set(entry.target, entry.isIntersecting);
      setMainCtaInView(Array.from(intersecting.values()).some(Boolean));
    });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  const range = selectionToRange(selection);
  const nights = selectionNights(selection);
  const selectionConflict = useMemo(
    () => (range ? findAvailabilityConflict(range, unavailableDates) : null),
    [range, unavailableDates],
  );
  const validation = useMemo(
    () =>
      range
        ? validateStayRequest({
            checkIn: range.start,
            checkOut: range.end,
            guests,
            maxGuests: property.maxGuests,
            minNights: property.minNights,
            today,
            unavailable: unavailableDates,
          })
        : null,
    [range, guests, property.maxGuests, property.minNights, today, unavailableDates],
  );
  const estimate =
    validation?.ok === true ? nights * property.baseRate + property.cleaningFee : null;
  const belowMinimum = validation?.ok === false && validation.code === "min_nights";
  const hasValidStay = Boolean(range) && !selectionConflict && validation?.ok === true;
  const showMobileCta = hasValidStay && !mainCtaInView;

  const facts = [
    { icon: Users, label: `Sleeps ${property.maxGuests}` },
    { icon: BedDouble, label: `${property.bedrooms} bedroom` },
    { icon: Bath, label: `${property.bathrooms} bathroom` },
    { icon: CalendarRange, label: `${property.minNights}-night minimum` },
  ];

  const other = activeProperties.find((p) => p.slug !== property.slug);

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

          <section id="availability" className="mt-10 scroll-mt-24">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Availability</p>
                <h2 className="mt-2 text-3xl">Plan your stay</h2>
                <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                  Choose your arrival and departure. Booked nights are marked — your checkout can
                  fall on the next guest&apos;s arrival day.
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
                  aria-live="polite"
                >
                  {availabilityStatus === "loading" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
                      Checking…
                    </>
                  ) : availabilityStatus === "error" ? (
                    <span className="text-destructive">Live check unavailable</span>
                  ) : (
                    <>
                      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                      Live availability
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void refreshAvailability()}
                  aria-label="Refresh availability"
                  className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-sand hover:text-foreground"
                >
                  <RefreshCw
                    className={`size-4 ${availabilityStatus === "loading" ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            {availabilityStatus === "error" && (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-destructive" role="alert">
                  We couldn&apos;t refresh live availability. The dates below are the last server
                  response.
                </p>
                <button
                  type="button"
                  onClick={() => void refreshAvailability()}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-sand"
                >
                  Try again
                </button>
              </div>
            )}

            <div className="-mx-5 mt-5 sm:mx-0">
              <div className="border-y border-border bg-card px-1.5 py-5 sm:rounded-3xl sm:border sm:p-6">
                <div className="grid gap-6">
                  <StayCalendar
                    unavailableDates={unavailableDates}
                    today={today}
                    selection={selection}
                    onSelectionChange={setSelection}
                    numberOfMonths={2}
                  />

                  <aside className="mx-4 rounded-2xl bg-sand/80 p-4 sm:mx-0">
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                      Your stay
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2.5">
                        <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                          Check-in
                        </p>
                        <p className="mt-1 text-sm font-medium">{displayDate(selection.checkIn)}</p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2.5">
                        <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                          Check-out
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {displayDate(selection.checkOut)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                          Guests
                        </p>
                        <Select
                          value={String(guests)}
                          onValueChange={(value) => setGuests(Number(value))}
                        >
                          <SelectTrigger
                            id="page-guests"
                            aria-label="Number of guests"
                            className="mt-1 min-h-11 w-32 rounded-xl bg-background/60"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from(
                              { length: property.maxGuests },
                              (_, index) => index + 1,
                            ).map((count) => (
                              <SelectItem key={count} value={String(count)}>
                                {count} {count === 1 ? "guest" : "guests"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                          Nights
                        </p>
                        <p className="font-display text-2xl font-semibold">{nights || "—"}</p>
                      </div>
                    </div>

                    {selectionConflict ? (
                      <p className="mt-4 rounded-xl border border-destructive/20 bg-background/70 px-3 py-2 text-xs font-medium text-destructive">
                        Those dates include nights that were just booked. Please choose another
                        range.
                      </p>
                    ) : belowMinimum ? (
                      <p className="mt-4 rounded-xl bg-background/70 px-3 py-2 text-xs font-medium">
                        Minimum stay is {property.minNights} nights. Add{" "}
                        {property.minNights - nights} more to continue.
                      </p>
                    ) : estimate !== null ? (
                      <dl className="mt-4 space-y-1.5 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <dt>
                            {currency(property.baseRate)} × {nights}{" "}
                            {nights === 1 ? "night" : "nights"}
                          </dt>
                          <dd>{currency(nights * property.baseRate)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Cleaning fee</dt>
                          <dd>{currency(property.cleaningFee)}</dd>
                        </div>
                        <div className="flex justify-between border-t border-border/70 pt-2 text-sm font-semibold text-foreground">
                          <dt>Estimated total</dt>
                          <dd>{currency(estimate)}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                        Select your dates to see the stay estimate. No payment is taken online.
                      </p>
                    )}

                    <button
                      ref={inlineCtaRef}
                      type="button"
                      onClick={() => setBookingOpen(true)}
                      className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary-strong px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-strong/90"
                    >
                      <CalendarDays className="size-4" aria-hidden="true" />
                      Request to book
                    </button>
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">
                      {range
                        ? `${nights} ${nights === 1 ? "night" : "nights"} · pending until confirmed`
                        : "Choose dates above, then send your request"}
                    </p>
                  </aside>
                </div>
              </div>
            </div>
          </section>

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
              {property.amenities.map((amenity) => {
                const Icon = amenityIcons[amenity] ?? Check;
                return (
                  <li key={amenity} className="flex items-center gap-3 text-sm">
                    <span className="flex size-8 items-center justify-center rounded-full bg-accent">
                      <Icon className="size-3.5 text-primary" />
                    </span>
                    {amenity}
                  </li>
                );
              })}
            </ul>
          </section>

          <Separator className="my-10" />

          <section>
            <h2 className="text-2xl">Where you&apos;ll be</h2>
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
            {range && (
              <div className="mt-5 rounded-xl bg-sand px-3 py-2.5 text-sm">
                <p className="font-medium">
                  {displayDate(selection.checkIn)} → {displayDate(selection.checkOut)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {nights} {nights === 1 ? "night" : "nights"} ·{" "}
                  {estimate === null ? "check minimum stay" : currency(estimate)}
                </p>
              </div>
            )}
            <button
              ref={asideCtaRef}
              type="button"
              onClick={() => setBookingOpen(true)}
              className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-primary-strong px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-strong/90"
            >
              Request to book
            </button>
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
            className="mt-6 inline-flex items-center justify-center rounded-full bg-primary-strong px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            View home
          </Link>
        </section>
      )}

      {showMobileCta && (
        <>
          <div
            aria-hidden="true"
            className="h-[calc(5rem+env(safe-area-inset-bottom))] lg:hidden"
          />
          <div
            role="region"
            aria-label="Booking summary"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pt-3 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-[0_-8px_24px_-16px_oklch(0.3_0.02_60/0.25)] backdrop-blur-md animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none lg:hidden"
          >
            <div className="mx-auto flex max-w-6xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {displayShortDate(selection.checkIn)} – {displayShortDate(selection.checkOut)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {nights} {nights === 1 ? "night" : "nights"}
                  {estimate !== null ? ` · ${currency(estimate)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBookingOpen(true)}
                className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-primary-strong px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-strong/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none min-[360px]:px-5"
              >
                <CalendarDays className="hidden size-4 min-[360px]:block" aria-hidden="true" />
                Request to book
              </button>
            </div>
          </div>
        </>
      )}

      <BookingRequestDialog
        property={property}
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        selection={selection}
        onSelectionChange={setSelection}
        guests={guests}
        onGuestsChange={setGuests}
        today={today}
        unavailableDates={unavailableDates}
        onAvailabilityRefresh={() => void refreshAvailability()}
      />
    </article>
  );
}
