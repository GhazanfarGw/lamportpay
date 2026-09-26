export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "callout"; title: string; text: string }
  | { type: "quote"; text: string };

export type ProductLink = {
  to: "/send" | "/swap" | "/how-it-works" | "/workflow" | "/whitepaper" | "/compliance" | "/docs" | "/contact";
  label: string;
  note: string;
};

export type BlogPost = {
  slug: string;
  title: string;
  /** Meta title. Keep under ~60 characters where possible. */
  metaTitle: string;
  description: string;
  category: "Crypto-to-fiat" | "Stablecoins" | "Solana" | "Web3 payment rails" | "Compliance";
  published: string; // ISO date
  updated?: string; // ISO date
  readingMinutes: number;
  keywords: string[];
  /** One-sentence answer shown directly under the H1. */
  summary: string;
  body: Block[];
  productLinks: ProductLink[];
  relatedSlugs: string[];
};

export const BLOG_BASE_URL = "https://lamportpay.com";

export function postUrl(slug: string) {
  return `${BLOG_BASE_URL}/blog/${slug}`;
}

export function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
