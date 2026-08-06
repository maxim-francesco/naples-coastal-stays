import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { properties } from "@/data/properties";

const linkClass =
  "text-sm text-foreground/75 transition-colors hover:text-foreground data-[status=active]:text-foreground";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
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

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link to="/" className="font-display text-lg tracking-tight">
          Palm &amp; Sands
          <span className="ml-2 hidden text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground sm:inline">
            Naples, FL
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <NavLinks />
        </nav>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <nav className="mt-10 flex flex-col gap-6 px-5">
              <NavLinks />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
