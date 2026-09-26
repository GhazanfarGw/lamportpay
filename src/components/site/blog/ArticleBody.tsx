import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import type { Block, ProductLink } from "@/content/blog/types";

function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function ArticleBody({ body }: { body: Block[] }) {
  return (
    <div className="mt-10 space-y-6">
      {body.map((block, i) => {
        switch (block.type) {
          case "h2":
            return (
              <h2
                key={i}
                id={slugifyHeading(block.text)}
                className="scroll-mt-24 pt-6 text-2xl md:text-3xl font-semibold tracking-tight"
              >
                {block.text}
              </h2>
            );
          case "h3":
            return (
              <h3
                key={i}
                id={slugifyHeading(block.text)}
                className="scroll-mt-24 pt-2 text-xl font-semibold tracking-tight"
              >
                {block.text}
              </h3>
            );
          case "p":
            return (
              <p key={i} className="text-base md:text-lg leading-relaxed text-muted-foreground">
                {block.text}
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="space-y-2.5 pl-1">
                {block.items.map((item) => (
                  <li key={item} className="flex gap-3 text-base leading-relaxed text-muted-foreground">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="space-y-2.5">
                {block.items.map((item, idx) => (
                  <li key={item} className="flex gap-3 text-base leading-relaxed text-muted-foreground">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                      {idx + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            );
          case "callout":
            return (
              <aside
                key={i}
                className="rounded-2xl border border-primary/25 bg-accent/60 p-5 md:p-6"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-accent-foreground">
                  <Info className="h-4 w-4" aria-hidden="true" />
                  {block.title}
                </div>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">{block.text}</p>
              </aside>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-primary pl-5 text-lg italic leading-relaxed text-foreground"
              >
                {block.text}
              </blockquote>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

export function ProductLinkCards({ links }: { links: ProductLink[] }) {
  if (!links.length) return null;
  return (
    <section aria-labelledby="see-it-in-product" className="mt-16">
      <h2 id="see-it-in-product" className="text-2xl font-semibold tracking-tight">
        See it in the product
      </h2>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="rounded-2xl border border-border/60 bg-card p-5 transition hover:border-primary/40"
          >
            <div className="font-medium">{link.label}</div>
            <p className="mt-1.5 text-sm text-muted-foreground">{link.note}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
