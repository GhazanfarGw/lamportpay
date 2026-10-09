/**
 * Strategic ecosystem: companies the owner supplied as CANDIDATES (9 Oct 2026).
 *
 * None of these is a confirmed LamportPay partner. An entry is shown on the public site
 * only when `status` is something other than "owner-confirmation-required"; until the
 * owner confirms the relationship, it renders in local development only (with a
 * "needs owner confirmation" badge) so nothing unconfirmed is published.
 *
 * Rules: no logos without written permission, no valuations, revenue, investments,
 * commitments or partnership announcements. Descriptions are short paraphrases of each
 * company's own website (or the owner's records where the site could not be read).
 */

export type EcosystemStatus =
  | "confirmed-partner"
  | "affiliated-business"
  | "advisor-network"
  | "potential-partner"
  | "owner-confirmation-required";

export type EcosystemCompany = {
  name: string;
  url: string;
  /** Short business description; null when it could not be verified. */
  description: string | null;
  status: EcosystemStatus;
  /** Where the description comes from (for the owner's review, not rendered publicly). */
  source: string;
  /** Open questions for the owner before this entry can be published. */
  toConfirm: string;
};

export const ECOSYSTEM_STATUS_LABEL: Record<EcosystemStatus, string> = {
  "confirmed-partner": "Confirmed partner",
  "affiliated-business": "Affiliated business",
  "advisor-network": "Advisor network",
  "potential-partner": "Potential ecosystem partner",
  "owner-confirmation-required": "Needs owner confirmation",
};

export const ECOSYSTEM_COMPANIES: EcosystemCompany[] = [
  {
    name: "AGC Global Logistics",
    url: "https://agcgl.com/",
    description: null,
    status: "owner-confirmation-required",
    source:
      "agcgl.com could not be read or found in search; the team's workspace uses the agcgl.com domain.",
    toConfirm: "Business description, and whether the label is Affiliated business.",
  },
  {
    name: "Bliss Rent",
    url: "https://bliss.rent/",
    description: "Car-rental booking platform for Dubai airport rentals.",
    status: "owner-confirmation-required",
    source:
      "Owner's project records (Bliss Rent project tracker); bliss.rent itself could not be read.",
    toConfirm: "Relationship to LamportPay and permission to list it.",
  },
  {
    name: "ZOH Real Estate",
    url: "https://zoh.ae/",
    description:
      "UAE real-estate firm offering property investment, purchase and property-management services.",
    status: "owner-confirmation-required",
    source: "zoh.ae (company website).",
    toConfirm: "That zoh.ae (ZOH Real Estate) is the intended ZOH, and the relationship.",
  },
  {
    name: "Wharf Street Studios",
    url: "https://www.wharfstreetstudios.com/",
    description:
      "London studio building immersive games and AI-produced films, with a focus on blockchain gaming.",
    status: "owner-confirmation-required",
    source: "wharfstreetstudios.com (company website).",
    toConfirm: "Relationship to LamportPay and permission to list it.",
  },
  {
    name: "Privev",
    url: "https://www.privev.com/",
    description: "London chauffeur service with an all-electric fleet, including the Mercedes EQS.",
    status: "owner-confirmation-required",
    source: "privev.com (company website).",
    toConfirm: "Relationship to LamportPay and permission to list it.",
  },
  {
    name: "Secure Ledger Solutions",
    url: "https://secureledgerssolutions.com/",
    description:
      "Crypto advisory firm offering institutional advisory, liquidity management, digital-asset protection and OTC support.",
    status: "owner-confirmation-required",
    source:
      "secureledgerssolutions.com (company website; the site names itself Secure Ledger Solutions).",
    toConfirm: "Exact company name, relationship to LamportPay and permission to list it.",
  },
];

/** Entries that may appear on the public site (never the unconfirmed ones). */
export function publicEcosystem(showUnconfirmed = false): EcosystemCompany[] {
  return ECOSYSTEM_COMPANIES.filter(
    (c) => showUnconfirmed || c.status !== "owner-confirmation-required",
  );
}
