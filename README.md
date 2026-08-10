# Naples Coastal Stays

A boutique vacation-rental website for two properties in Naples, Florida — public listings with photo galleries, availability, and direct booking requests, plus a password-protected admin dashboard for managing properties, photos, pricing, and booking requests.

## Tech stack

- **Framework:** TanStack Start (React 19, SSR, file-based routing)
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Database & Auth:** Supabase (Postgres + Auth)
- **Images:** Cloudinary (signed uploads)
- **Package manager:** Bun
- **Deploy:** Vercel

## Getting started

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev
```

The dev server runs on http://localhost:8080 (or the next free port).

## Environment variables

Create a `.env.local` file (never commit it) with:

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
VITE_CLOUDINARY_CLOUD_NAME=


## Project structure

- `src/routes/` — public pages and the `/admin` dashboard
- `src/lib/*.server.ts` — server functions (Supabase reads/writes, auth guard, Cloudinary signing)
- `src/components/` — UI components (site + admin)

## Scripts

- `bun run dev` — start the dev server
- `bun run build` — production build
- `bun run lint` — lint
