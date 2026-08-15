import { createFileRoute } from "@tanstack/react-router";
import { Clock, Cigarette, Moon, Phone, MapPin, PawPrint } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { siteConfig, absoluteUrl } from "@/lib/site-config";

export const Route = createFileRoute("/about")({
  head: () => {
    const canonical = absoluteUrl("/about");
    const ogTitle = `About your host — ${siteConfig.name}, Naples FL`;
    const ogDescription = "Host story, house rules and direct contact for two Naples vacation homes.";

    return {
      meta: [
        { title: `About your host & house policies — ${siteConfig.name}` },
        {
          name: "description",
          content:
            "Meet the owner of two Naples, Florida vacation homes, read the house rules and check-in policies, and get in touch directly.",
        },
        { property: "og:title", content: ogTitle },
        { property: "og:description", content: ogDescription },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
        { name: "twitter:title", content: ogTitle },
        { name: "twitter:description", content: ogDescription },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: About,
});

const rules = [
  { icon: Clock, title: "Check-in from 4:00 PM", body: "Keyless self check-in; codes are sent the morning of arrival." },
  { icon: Clock, title: "Check-out by 10:00 AM", body: "Late check-out is often possible — just ask." },
  { icon: Cigarette, title: "No smoking indoors", body: "Smoking is not permitted anywhere inside either home." },
  { icon: Moon, title: "Quiet hours 10 PM – 8 AM", body: "Both communities are residential and pleasantly quiet." },
  { icon: PawPrint, title: "Small dogs welcome at Cathedral Heights", body: "Cathedral Heights is dog-friendly for small dogs; Turtle Lake is kept pet-free for allergy-sensitive guests." },
];

function About() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
      <p className="eyebrow">Your host</p>
      <h1 className="mt-3 text-4xl sm:text-5xl">A small, personal way to stay in Naples</h1>

      <div className="mt-10 grid gap-10 sm:grid-cols-[220px_1fr]">
        <div className="flex h-56 items-center justify-center rounded-2xl bg-sand text-sm text-muted-foreground sm:h-60">
          Host photo
        </div>
        <div className="space-y-4 text-muted-foreground">
          <p>
            {siteConfig.host.name} has been welcoming guests to Naples for over a decade.
            What started as one condo she couldn't bear to leave empty has become two homes she
            looks after personally — no management company, no call centre.
          </p>
          <p>
            Every stay is prepared by the same small local team: fresh linens, a stocked coffee
            station, and someone a phone call away if you need anything at all.
          </p>
        </div>
      </div>

      <Separator className="my-14" />

      <h2 className="text-3xl">House rules & policies</h2>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2">
        {rules.map((rule) => (
          <li key={rule.title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
            <span className="flex size-10 items-center justify-center rounded-full bg-accent">
              <rule.icon className="size-4 text-primary" />
            </span>
            <h3 className="mt-4 text-lg">{rule.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{rule.body}</p>
          </li>
        ))}
      </ul>

      <Separator className="my-14" />

      <h2 className="text-3xl">Get in touch</h2>
      <p className="mt-3 text-muted-foreground">
        Questions about dates, longer winter stays or the neighbourhood? Give us a call — we're happy to help.
      </p>
      <ul className="mt-6 space-y-3 text-sm">
        <li className="flex items-center gap-3">
          <Phone className="size-4 text-primary" />
          <a href={siteConfig.host.phoneHref} className="hover:underline">
            {siteConfig.host.phone}
          </a>
        </li>
        <li className="flex items-center gap-3">
          <MapPin className="size-4 text-primary" /> Naples, Florida, USA
        </li>
      </ul>
    </div>
  );
}
