import { createFileRoute } from "@tanstack/react-router";

import { POSTS } from "@/content/blog";
import { canonical } from "@/lib/seo";

const STATIC_PAGES: { path: string; priority: string; changefreq: string }[] = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/send", priority: "0.9", changefreq: "monthly" },
  { path: "/swap", priority: "0.8", changefreq: "monthly" },
  { path: "/how-it-works", priority: "0.8", changefreq: "monthly" },
  { path: "/workflow", priority: "0.7", changefreq: "monthly" },
  { path: "/whitepaper", priority: "0.7", changefreq: "monthly" },
  { path: "/compliance", priority: "0.7", changefreq: "monthly" },
  { path: "/docs", priority: "0.7", changefreq: "monthly" },
  { path: "/blog", priority: "0.9", changefreq: "weekly" },
  { path: "/contact", priority: "0.6", changefreq: "monthly" },
];

function buildSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [
    ...STATIC_PAGES.map((p) => ({
      loc: canonical(p.path),
      lastmod: today,
      changefreq: p.changefreq,
      priority: p.priority,
    })),
    ...POSTS.map((p) => ({
      loc: canonical(`/blog/${p.slug}`),
      lastmod: p.updated ?? p.published,
      changefreq: "monthly",
      priority: "0.8",
    })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`,
  )
  .join("\n")}
</urlset>
`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildSitemap(), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});
