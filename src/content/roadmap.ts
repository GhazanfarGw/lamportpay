/**
 * Public roadmap and future vision, shared by the home page and the white paper.
 * Owner-supplied wording (9 Oct 2026). These are proposed stages, not delivery
 * commitments: do not add dates here until scope and dependencies are validated.
 */

export type RoadmapPhase = {
  phase: number;
  title: string;
  status: "current" | "proposed";
  summary: string;
  /** What must be true (or decided by the owner) before the stage can start. */
  dependsOn: string;
};

export const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    phase: 1,
    title: "Core product validation",
    status: "current",
    summary:
      "Validate the Solana wallet flow, Jupiter-powered swap, USDC quote, verification, payout sandbox, transaction tracking and receipt.",
    dependsOn: "Owner sign-off on test-mode results.",
  },
  {
    phase: 2,
    title: "Security and controlled launch",
    status: "proposed",
    summary:
      "Complete security reviews, confirm partner requirements, validate payout corridors and prepare production readiness.",
    dependsOn: "Funding, external security review, partner sign-off and the owner's LIVE approval.",
  },
  {
    phase: 3,
    title: "Liquidity and asset integrations",
    status: "proposed",
    summary:
      "Explore additional liquidity providers, supported tokens, stablecoins and potential Bitcoin / Ethereum integration paths.",
    dependsOn: "A technical feasibility assessment before any delivery date is set.",
  },
  {
    phase: 4,
    title: "Partnerships and market expansion",
    status: "proposed",
    summary:
      "Develop payout-partner relationships, expand supported fiat currencies and countries, and explore integrations with relevant businesses and platforms.",
    dependsOn: "Payout-partner support and local compliance review per corridor.",
  },
  {
    phase: 5,
    title: "Global payout ecosystem",
    status: "proposed",
    summary:
      "Explore B2B payout APIs, remittance use cases, wider blockchain support and a larger strategic partner network.",
    dependsOn: "Partner-licensed products and the regulatory approvals they need.",
  },
];

export const ROADMAP_NOTE =
  "These are proposed roadmap stages, not promises of completed work. Delivery dates are assigned only after scope and dependencies are validated.";

/** What works today (test mode: Solana devnet + partner sandbox, no real funds). */
export const CURRENT_FLOW = [
  { title: "Supported Solana assets", detail: "SOL, USDC and supported SPL tokens" },
  { title: "Jupiter-powered swap", detail: "Only when needed; live quotes in test mode" },
  { title: "USDC", detail: "Payout-ready, in your own wallet" },
  { title: "Verified bank payout", detail: "Licensed partner, to your own account" },
] as const;

/** Future exploration only: none of these are current capabilities. */
export const FUTURE_EXPLORATION = [
  "Bitcoin",
  "Ethereum",
  "Additional chains",
  "More stablecoins",
  "Wider liquidity providers",
  "More fiat corridors",
  "B2B payout APIs",
  "Remittance use cases",
] as const;
