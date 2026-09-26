import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";

import { SiteLayout } from "@/components/site/Layout";
import { ArticleBody, ProductLinkCards } from "@/components/site/blog/ArticleBody";
import { getPost, getRelated } from "@/content/blog";
import { formatDate } from "@/content/blog/types";
import { breadcrumbSchema, canonical, pageSeo, SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = getPost(params.slug);
    if (!post) throw notFound();
    return { post, related: getRelated(params.slug) };
  },
  head: ({ params, loaderData }) => {
    const post = loaderData?.post;
    if (!post) {
      return { meta: [{ title: "Article not found — LamportPay" }, { name: "robots", content: "noindex" }] };
    }
    const path = `/blog/${params.slug}`;
    const seo = pageSeo({
      path,
      title: `${post.metaTitle} | LamportPay`,
      description: post.description,
      type: "article",
    });
    return {
      ...seo,
      meta: [
        ...seo.meta,
        { name: "keywords", content: post.keywords.join(", ") },
        { name: "author", content: "LamportPay" },
        { property: "article:published_time", content: post.published },
        { property: "article:modified_time", content: post.updated ?? post.published },
        { property: "article:section", content: post.category },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            description: post.description,
            datePublished: post.published,
            dateModified: post.updated ?? post.published,
            inLanguage: "en",
            articleSection: post.category,
            keywords: post.keywords.join(", "),
            mainEntityOfPage: { "@type": "WebPage", "@id": canonical(path) },
            author: { "@type": "Organization", name: "LamportPay", url: SITE_URL },
            publisher: { "@type": "Organization", name: "LamportPay", url: SITE_URL },
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(
            breadcrumbSchema([
              { name: "Home", path: "/" },
              { name: "Blog", path: "/blog" },
              { name: post.title, path },
            ]),
          ),
        },
      ],
    };
  },
  component: BlogPostPage,
  notFoundComponent: PostNotFound,
});

function PostNotFound() {
  return (
    <SiteLayout>
      <section className="max-w-3xl mx-auto px-5 py-24 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Article not found</h1>
        <p className="mt-3 text-muted-foreground">
          That article does not exist or has been moved.
        </p>
        <Link
          to="/blog"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Back to the blog
        </Link>
      </section>
    </SiteLayout>
  );
}

function BlogPostPage() {
  const { post, related } = Route.useLoaderData();
  return (
    <SiteLayout>
      <article className="max-w-3xl mx-auto px-5 py-14 md:py-20">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link to="/" className="hover:text-foreground">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link to="/blog" className="hover:text-foreground">
                Blog
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-foreground">
              {post.category}
            </li>
          </ol>
        </nav>

        <header className="mt-6">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-semibold text-primary">{post.category}</span>
            <time dateTime={post.published}>{formatDate(post.published)}</time>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {post.readingMinutes} min read
            </span>
          </div>
          <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">{post.title}</h1>
          <p className="mt-5 rounded-2xl border border-border/60 bg-card p-5 text-base md:text-lg leading-relaxed">
            {post.summary}
          </p>
        </header>

        <ArticleBody body={post.body} />

        <ProductLinkCards links={post.productLinks} />

        {related.length > 0 && (
          <section aria-labelledby="related-reading" className="mt-16">
            <h2 id="related-reading" className="text-2xl font-semibold tracking-tight">
              Related reading
            </h2>
            <ul className="mt-5 space-y-3">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    to="/blog/$slug"
                    params={{ slug: r.slug }}
                    className="flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-card p-5 transition hover:border-primary/40"
                  >
                    <span>
                      <span className="font-medium">{r.title}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {r.description}
                      </span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-14 border-t border-border/60 pt-6">
          <p className="text-xs leading-relaxed text-muted-foreground">
            LamportPay is a demonstration product operated by Lamport Pay Ltd. A small real Jupiter
            SOL to USDC swap may be executed only after you review and sign it in your connected
            wallet, and the output returns to that wallet. LamportPay does not currently process
            fiat payout, real KYC, FX conversion, bank payout, or third-party recipient transfer.
          </p>
          <Link
            to="/blog"
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All articles
          </Link>
        </footer>
      </article>
    </SiteLayout>
  );
}
