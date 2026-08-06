import { Link } from "@tanstack/react-router";
import { Mail, Phone, MapPin } from "lucide-react";
import { properties } from "@/data/properties";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/70 bg-sand">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-3">
        <div>
          <p className="font-display text-xl">Palm &amp; Sands</p>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Two carefully kept homes in Naples, Florida. Booked directly with the owner.
          </p>
        </div>

        <div>
          <p className="eyebrow">The homes</p>
          <ul className="mt-4 space-y-2 text-sm">
            {properties.map((p) => (
              <li key={p.slug}>
                <Link
                  to="/homes/$slug"
                  params={{ slug: p.slug }}
                  className="text-foreground/75 transition-colors hover:text-foreground"
                >
                  {p.name}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/about" className="text-foreground/75 transition-colors hover:text-foreground">
                About &amp; policies
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="eyebrow">Contact</p>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Mail className="size-4 text-primary" /> stay@palmandsands.com
            </li>
            <li className="flex items-center gap-2">
              <Phone className="size-4 text-primary" /> +1 (239) 555-0147
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="size-4 text-primary" /> Naples, Florida
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} Palm &amp; Sands. All rights reserved.</p>
          <p>Check-in 4:00 PM · Check-out 10:00 AM · No smoking · Quiet hours 10 PM–8 AM</p>
        </div>
      </div>
    </footer>
  );
}
