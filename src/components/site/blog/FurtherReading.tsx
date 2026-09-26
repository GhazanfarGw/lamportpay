import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { getPost } from "@/content/blog";

/** Internal linking block used on product pages to point at supporting articles. */
export function FurtherReading({
  slugs,
  title = "Further reading",
}: {
  slugs: string[];
  title?: string;
}) {
  const posts = slugs.map((s) => getPost(s)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (!posts.length) return null;
  return (
    <section aria-labelledby="further-reading" className="max-w-5xl mx-auto px-5 pb-20">
      <div className="rounded-3xl border border-border/60 bg-secondary/40 p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="further-reading" className="text-2xl font-semibold tracking-tight">
            {title}
          </h2>
          <Link to="/blog" className="text-sm font-medium text-primary hover:underline">
            All articles
          </Link>
        </div>
        <ul className="mt-5 grid gap-4 md:grid-cols-3">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link
                to="/blog/$slug"
                params={{ slug: p.slug }}
                className="flex h-full flex-col rounded-2xl border border-border/60 bg-card p-5 transition hover:border-primary/40"
              >
                <span className="text-xs font-semibold text-primary">{p.category}</span>
                <span className="mt-2 font-medium leading-snug">{p.title}</span>
                <span className="mt-2 flex-1 text-sm text-muted-foreground">{p.description}</span>
                <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  Read
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
