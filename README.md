# Naples Coastal Stays

Build a small, elegant vacation-rental website for a host who owns 2 properties in Naples, Florida (Gulf Coast, USA). Think a boutique version of Airbnb/Booking, but for just these two homes. All content in English.

## Overall goal

A polished, mobile-first site where guests can browse the 2 properties, see photos, amenities, availability and pricing, and send a booking request. Plus a simple password-protected admin area where the owner can add/edit properties, upload photos, and set prices — no coding needed.

## Design direction (very important — must look chic, calm, coastal)

- Aesthetic: modern coastal / beach-house luxury. Airy, lots of whitespace, photography-first.

- Color palette: soft off-white / sand backgrounds (#FBF9F6), warm beige neutrals, deep charcoal text (#2B2B2B), and a single teal/aqua accent (#4FA3A5 / soft aqua like in beach decor). Use the accent sparingly for buttons and highlights.

- Typography: an elegant serif for headings (e.g. Fraunces or Cormorant Garamond) paired with a clean sans-serif for body (Inter). Generous line spacing.

- Full-bleed hero images, large rounded corners on cards (rounded-2xl), subtle shadows, smooth hover transitions. Nothing loud or corporate.

- Fully responsive, mobile-first. Most guests browse on phones.

- Use shadcn/ui components and lucide-react icons.

## Pages / routes (keep routing simple and standard — React Router, one component per page)

1. Home ("/") — full-width hero image with the host's tagline, a short intro sentence, then the 2 properties as two large image cards ("View home" CTA). A small "Why book direct" strip with 3–4 trust points (spotless & recently renovated, direct-booking best price, self check-in, golf-course & water views). Footer with contact + policies.

2. Property detail ("/homes/:slug") — image gallery with lightbox, property title + short description, key facts row (guests, bedrooms, bathrooms, min nights), amenities list with icons, an embedded Google Map placeholder, an availability calendar (react-day-picker style), a pricing summary box (base rate/night + cleaning fee), and a "Request to book" button that opens a booking-request form (dates, number of guests, name, email, message) with a live total estimate (nights × rate + cleaning fee).

3. About / Contact ("/about") — host photo placeholder, story, house rules / policies (check-in 4pm, check-out 10am, no smoking, quiet hours), contact info.

4. Admin login ("/admin/login") and admin dashboard ("/admin").

## Admin area (protected)

- Login with email + password (use Supabase Auth).

- Dashboard sections:

  - Properties: list, create, edit, delete. Fields: name, slug, short description, long description, address/area, max guests, bedrooms, bathrooms, min nights, amenities (multi-select), base nightly rate, cleaning fee.

  - Photos: per property, drag-and-drop upload, reorder, delete, set cover image (store in Supabase Storage).

  - Pricing: base rate + optional seasonal rate periods (start date, end date, nightly rate) — Florida has a high winter season, so seasonal pricing matters.

  - Calendar: manually block/unblock date ranges per property (blackout dates).

  - Requests inbox: list incoming booking requests with status (new / confirmed / declined) and guest details.

- Clean table + form UI with shadcn, toasts on save, confirm dialogs on delete.

## Data (use Supabase — connect the native Supabase integration)

Tables: properties, property_photos, rate_periods, blackout_dates, booking_requests. Set up sensible columns and relationships. Seed the database with the 2 real properties below and 2–3 realistic sample booking requests.

## The 2 properties (seed content — placeholder, refine later)

- Home 1: "Palm Breeze Retreat" — a bright, fully renovated 1-bed / 1-bath coastal condo in Naples, FL with a screened lanai overlooking the palms and golf course, modern white kitchen, king canopy bed. Sleeps 2–3. Base rate $180/night, cleaning fee $90, 3-night minimum.

- Home 2: "Aqua Sands Suite" — an elegant renovated 1-bed / 1-bath unit with an open living/dining space, coastal decor in teal and sand, marble bathrooms, walkout to a screened patio. Sleeps 2–4. Base rate $195/night, cleaning fee $90, 3-night minimum.

Use tasteful placeholder images for now (I'll replace with real photos after).

## Constraints

- Do NOT build iCal/calendar sync, payments, or cron jobs — I'll handle those later.

- Keep the code modular and cleanly organized (clear folders for pages, components, lib), so it's easy to migrate afterward.

- Booking requests should just save to the database and show a success confirmation — no payment step.

Start with the design system, the Home page, and one property detail page. I'll review before we build the admin.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/71a6da81-4116-4848-ad0f-19974d23c9ea).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
