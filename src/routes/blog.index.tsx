import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";

import { SiteLayout } from "@/components/site/Layout";
import { POSTS, CATEGORIES } from "@/content/blog";
import { formatDate } from "@/content/blog/types";
import { breadcrumbSchema, canonical, pageSeo, SITE_URL } from "@/lib/seo";

const TITLE = "Blog — crypto payments, stablecoins and Solana | LamportPay";
const DESCRIPTION =
  "Practical, in-depth articles on crypto-to-fiat payments, stablecoin settlement, Solana payment engineering and Web3 payment rail architecture.";

export const Route = createFileRoute("/blog/")({
  head: () => {
    const seo = pageSeo({ path: "/blog", title: TITLE, description: DESCRIPTION });
    return {
      ...seo,
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "LamportPay Blog",
            description: DESCRIPTION,
            url: canonical("/blog"),
            publisher: { "@type": "Organization", name: "LamportPay", url: SITE_URL },
            blogPost: POSTS.map((p) => ({
              "@type": "BlogPosting",
              headline: p.title,
              description: p.description,
              datePublished: p.published,
              dateModified: p.updated ?? p.published,
              url: canonical(`/blog/${p.slug}`),
            })),
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(
            breadcrumbSchema([
              { name: "Home", path: "/" },
              { name: "Blog", path: "/blog" },
            ]),
          ),
        },
      ],
    };
  },
  component: BlogIndex,
});

function BlogIndex() {
  const [featured, ...rest] = POSTS;
  return (
    <SiteLayout>
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-24">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex items-center gap-2">
            <li>
              <Link to="/" className="hover:text-foreground">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-foreground">
              Blog
            </li>
          </ol>
        </nav>

        <header className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Blog</p>
          <h1 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
            How crypto-to-local-currency payments actually work
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Engineering and product writing on the parts of a payment route that are easy to
            promise and hard to build: conversion, settlement, compliance boundaries and honest
            quoting.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Topics covered">
            {CATEGORIES.map((c) => (
              <li
                key={c}
                className="rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground"
              >
                {c}
              </li>
            ))}
          </ul>
        </header>

        {featured && (
          <article className="mt-14 rounded-3xl border border-border/60 bg-card p-6 md:p-10">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="font-semibold text-primary">{featured.category}</span>
              <time dateTime={featured.published}>{formatDate(featured.published)}</time>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {featured.readingMinutes} min read
              </span>
            </div>
            <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
              <Link to="/blog/$slug" params={{ slug: featured.slug }} className="hover:text-primary">
                {featured.title}
              </Link>
            </h2>
            <p className="mt-3 max-w-3xl text-base md:text-lg text-muted-foreground">
              {featured.summary}
            </p>
            <Link
              to="/blog/$slug"
              params={{ slug: featured.slug }}
              className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              Read the article
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </article>
        )}

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {rest.map((p) => (
            <article
              key={p.slug}
              className="flex flex-col rounded-2xl border border-border/60 bg-card p-6 transition hover:border-primary/40"
            >
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="font-semibold text-primary">{p.category}</span>
                <time dateTime={p.published}>{formatDate(p.published)}</time>
                <span>{p.readingMinutes} min read</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight">
                <Link to="/blog/$slug" params={{ slug: p.slug }} className="hover:text-primary">
                  {p.title}
                </Link>
              </h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {p.description}
              </p>
              <Link
                to="/blog/$slug"
                params={{ slug: p.slug }}
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                Read more
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>

        <aside className="mt-16 rounded-3xl border border-border/60 bg-secondary/40 p-6 md:p-8">
          <h2 className="text-xl font-semibold tracking-tight">See the architecture in practice</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            The demo shows the full route. The SOL to USDC conversion runs live against Solana under
            strict limits with output returning to your own wallet; identity checks, fiat conversion
            and local payout are simulated.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/how-it-works"
              className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              How it works
            </Link>
            <Link
              to="/send"
              className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-card"
            >
              Transfer demo
            </Link>
            <Link
              to="/docs"
              className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-card"
            >
              Developer docs
            </Link>
          </div>
        </aside>
      </section>
    </SiteLayout>
  );
}
