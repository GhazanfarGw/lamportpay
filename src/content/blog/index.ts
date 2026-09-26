import type { BlogPost } from "./types";

// To publish a new article: create a file in ./posts that exports `post`,
// import it below, and add it to RAW_POSTS. Nothing else needs to change —
// routes, sitemap, related links and listings all read from this array.
import { post as cryptoToFiat } from "./posts/crypto-to-fiat-payments-explained";
import { post as stablecoins } from "./posts/why-stablecoins-settle-cross-border-payments";
import { post as solana } from "./posts/solana-payments-for-developers";
import { post as rails } from "./posts/web3-payment-rails-architecture";
import { post as compliance } from "./posts/compliance-roles-in-crypto-payouts";
import { post as quotes } from "./posts/designing-transparent-payment-quotes";

const RAW_POSTS: BlogPost[] = [cryptoToFiat, stablecoins, solana, rails, compliance, quotes];

export const POSTS: BlogPost[] = [...RAW_POSTS].sort((a, b) =>
  a.published === b.published ? a.title.localeCompare(b.title) : b.published.localeCompare(a.published),
);

export const CATEGORIES = Array.from(new Set(POSTS.map((p) => p.category)));

export function getPost(slug: string) {
  return POSTS.find((p) => p.slug === slug);
}

export function getRelated(slug: string) {
  const post = getPost(slug);
  if (!post) return [];
  const related = post.relatedSlugs
    .map((s) => getPost(s))
    .filter((p): p is BlogPost => Boolean(p) && p!.slug !== slug);
  if (related.length >= 2) return related.slice(0, 3);
  const fillers = POSTS.filter((p) => p.slug !== slug && !related.includes(p));
  return [...related, ...fillers].slice(0, 3);
}

export type { BlogPost } from "./types";
