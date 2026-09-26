import { defineTool } from "@lovable.dev/mcp-js";
import { SOL_MINT, SUPPORTED_INPUT_MINTS, TOKENS, USDC_MINT } from "@/lib/tokens";

export default defineTool({
  name: "get_swap_config",
  title: "Get swap configuration",
  description:
    "Return the SOL to USDC swap configuration used by LamportPay's Jupiter demo: supported mints, decimals, and the enforced test amount limits.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => {
    const config = {
      route: "SOL -> USDC via Jupiter",
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      supportedInputMints: [...SUPPORTED_INPUT_MINTS],
      tokens: Object.values(TOKENS),
      limits: { minSol: 0.001, maxSol: 0.01, defaultSol: 0.001 },
      destinationPolicy:
        "Output always returns to the connected wallet. Custom receiver or destination token accounts are rejected server-side.",
      safety:
        "Creating an order does not move funds. A real Jupiter swap only happens after the user reviews and signs the transaction in their wallet. Never share a seed phrase or private key.",
      fiatPayout: "Disabled. LamportPay is evaluating regulated payout infrastructure partners.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(config, null, 2) }],
      structuredContent: config,
    };
  },
});
