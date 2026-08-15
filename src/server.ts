import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

import { siteConfig, legacySlugRedirects } from "./lib/site-config";
import { buildSitemapXml, buildRobotsTxt } from "./lib/seo.server";

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      const legacyMatch = pathname.match(/^\/homes\/([^/]+)\/?$/);
      if (legacyMatch) {
        const oldSlug = legacyMatch[1]!;
        const newSlug = legacySlugRedirects[oldSlug];
        if (newSlug) {
          const targetUrl = `${url.origin}/homes/${newSlug}${url.search}`;
          return new Response(null, {
            status: 301,
            headers: {
              Location: targetUrl,
            },
          });
        }
      }

      if (pathname === "/sitemap.xml") {
        try {
          const body = await buildSitemapXml();
          return new Response(body, {
            status: 200,
            headers: {
              "content-type": "application/xml; charset=utf-8",
              "cache-control": "public, max-age=3600, s-maxage=86400",
            },
          });
        } catch (err) {
          console.error("Error serving sitemap.xml:", err);
          const fallback = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${siteConfig.url}/</loc>\n    <priority>1.0</priority>\n  </url>\n  <url>\n    <loc>${siteConfig.url}/about</loc>\n    <priority>0.7</priority>\n  </url>\n</urlset>`;
          return new Response(fallback, {
            status: 200,
            headers: {
              "content-type": "application/xml; charset=utf-8",
              "cache-control": "public, max-age=3600, s-maxage=86400",
            },
          });
        }
      }

      if (pathname === "/robots.txt") {
        try {
          const body = buildRobotsTxt();
          return new Response(body, {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "public, max-age=3600, s-maxage=86400",
            },
          });
        } catch (err) {
          console.error("Error serving robots.txt:", err);
          const fallback = `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${siteConfig.url}/sitemap.xml\n`;
          return new Response(fallback, {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "public, max-age=3600, s-maxage=86400",
            },
          });
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

