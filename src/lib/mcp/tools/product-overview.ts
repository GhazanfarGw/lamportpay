import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "get_product_overview",
  title: "Get product overview",
  description:
    "Return an overview of LamportPay: what it does, the demo transfer flow steps, current capabilities, and what is intentionally disabled.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => {
    const overview = {
      brand: "LamportPay",
      legalEntity: "Lamport Pay Ltd",
      contact: "hello@lamportpay.com",
      tagline: "Crypto in. Local money out.",
      headline: "Send crypto. Recipient receives local currency.",
      liveCapabilities: [
        "Jupiter-powered SOL to USDC swap demo with wallet signing (Phantom, Solflare)",
        "Solana RPC health and transaction verification (mainnet, devnet, testnet)",
        "Demo transfer simulator with indicative FX rates and fee breakdown",
      ],
      disabledCapabilities: [
        "Fiat conversion and payout — LamportPay is evaluating regulated payout infrastructure partners",
        "KYC verification (mock only in the demo flow)",
      ],
      demoTransferFlow: ["Details", "Quote", "Mock KYC", "Confirmation", "Tracking", "Receipt"],
      pages: [
        { path: "/", name: "Home" },
        { path: "/send", name: "Send demo" },
        { path: "/swap", name: "SOL to USDC swap demo" },
        { path: "/how-it-works", name: "How it works" },
        { path: "/whitepaper", name: "White paper" },
        { path: "/compliance", name: "Compliance" },
        { path: "/docs", name: "Developer docs" },
        { path: "/contact", name: "Contact" },
      ],
      disclaimer:
        "Demonstration product. No real fiat payouts, KYC, or custody of user funds.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(overview, null, 2) }],
      structuredContent: overview,
    };
  },
});
