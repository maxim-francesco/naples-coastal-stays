import { siteConfig, absoluteUrl } from "./site-config";

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function buildSitemapXml(): Promise<string> {
  let propertyRoutes = "";
  try {
    const { supabaseAdmin } = await import("./supabase.admin.server");
    const { data: properties, error } = await supabaseAdmin
      .from("properties")
      .select("slug, updated_at")
      .eq("is_active", true);

    if (!error && properties) {
      propertyRoutes = properties
        .map((p) => {
          const loc = xmlEscape(absoluteUrl(`/homes/${p.slug}`));
          const lastmod = p.updated_at ? xmlEscape(p.updated_at.split("T")[0]!) : "";
          const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
          return `  <url>\n    <loc>${loc}</loc>${lastmodTag}\n    <priority>0.9</priority>\n  </url>`;
        })
        .join("\n");
    }
  } catch (err) {
    console.error("Failed to fetch properties for sitemap:", err);
  }

  const rootLoc = xmlEscape(absoluteUrl("/"));
  const aboutLoc = xmlEscape(absoluteUrl("/about"));

  const staticRoutes = `  <url>\n    <loc>${rootLoc}</loc>\n    <priority>1.0</priority>\n  </url>\n  <url>\n    <loc>${aboutLoc}</loc>\n    <priority>0.7</priority>\n  </url>`;

  const urlsXml = propertyRoutes ? `${staticRoutes}\n${propertyRoutes}` : staticRoutes;

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsXml}\n</urlset>`;
}

export function buildRobotsTxt(): string {
  return `User-agent: *
Allow: /
Disallow: /admin

Sitemap: ${absoluteUrl("/sitemap.xml")}
`;
}
