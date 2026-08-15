import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { siteConfig } from "@/lib/site-config";

const linkClass =
  "text-sm text-foreground/75 transition-colors hover:text-foreground data-[status=active]:text-foreground";

interface PropertyLink {
  slug: string;
  name: string;
}

function NavLinks({
  properties,
  onNavigate,
}: {
  properties: PropertyLink[];
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link to="/" className={linkClass} onClick={onNavigate} activeOptions={{ exact: true }}>
        Home
      </Link>
      {properties.map((p) => (
        <Link
          key={p.slug}
          to="/homes/$slug"
          params={{ slug: p.slug }}
          className={linkClass}
          onClick={onNavigate}
        >
          {p.name}
        </Link>
      ))}
      <Link to="/about" className={linkClass} onClick={onNavigate}>
        About & Contact
      </Link>
    </>
  );
}

export function SiteHeader({ properties = [] }: { properties?: PropertyLink[] }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link to="/" className="font-display text-lg tracking-tight">
          {siteConfig.name}
          <span className="ml-2 hidden text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground sm:inline">
            {siteConfig.tagline}
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <NavLinks properties={properties} />
        </nav>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="flex w-[85%] max-w-sm flex-col p-0">
            <div className="px-6 pt-6 pb-5 pr-14">
              <div className="font-display text-2xl tracking-tight text-foreground">{siteConfig.name}</div>
              <div className="mt-1.5 text-[0.7rem] uppercase tracking-[0.22em] text-primary-strong">{siteConfig.tagline}</div>
            </div>
            <div className="mx-6 h-px bg-border" />
            <nav className="flex-1 overflow-y-auto px-6 py-2">
              <Link
                to="/"
                activeOptions={{ exact: true }}
                onClick={() => setOpen(false)}
                className="flex items-center border-b border-border/60 border-l-2 border-l-transparent py-4 pl-4 font-display text-xl text-foreground transition-colors hover:text-primary data-[status=active]:border-l-primary data-[status=active]:text-primary animate-in fade-in-0 fill-mode-both duration-500"
                style={{ animationDelay: "0ms" }}
              >
                Home
              </Link>
              <div className="eyebrow mt-4 mb-1">The homes</div>
              {properties.map((p, index) => {
                const i = index + 1;
                return (
                  <Link
                    key={p.slug}
                    to="/homes/$slug"
                    params={{ slug: p.slug }}
                    onClick={() => setOpen(false)}
                    className="flex items-center border-b border-border/60 border-l-2 border-l-transparent py-4 pl-4 font-display text-xl text-foreground transition-colors hover:text-primary data-[status=active]:border-l-primary data-[status=active]:text-primary animate-in fade-in-0 fill-mode-both duration-500"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    {p.name}
                  </Link>
                );
              })}
              <Link
                to="/about"
                onClick={() => setOpen(false)}
                className="flex items-center border-l-2 border-l-transparent py-4 pl-4 font-display text-xl text-foreground transition-colors hover:text-primary data-[status=active]:border-l-primary data-[status=active]:text-primary animate-in fade-in-0 fill-mode-both duration-500"
                style={{ animationDelay: `${(properties.length + 1) * 60}ms` }}
              >
                About &amp; Contact
              </Link>
            </nav>
            <div className="border-t border-border bg-primary/[0.06] px-6 pt-5 pb-6">
              <div className="flex items-center gap-2.5 text-sm text-foreground/75">
                <Phone className="size-4 text-primary" />
                <a href={siteConfig.host.phoneHref} className="transition-colors hover:text-foreground">
                  {siteConfig.host.phone}
                </a>
              </div>
              <Link
                to="/about"
                onClick={() => setOpen(false)}
                className="mt-4 block rounded-lg bg-primary-strong py-3 text-center text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Book direct
              </Link>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}


