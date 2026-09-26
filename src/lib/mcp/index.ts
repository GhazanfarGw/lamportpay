import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listCorridors from "./tools/list-corridors";
import quoteTransfer from "./tools/quote-transfer";
import explainFees from "./tools/explain-fees";
import swapConfig from "./tools/swap-config";
import productOverview from "./tools/product-overview";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "lamportpay-bridge",
  title: "LamportPay Bridge",
  version: "0.1.0",
  instructions:
    "Read-only tools for LamportPay, a demo crypto-to-local-currency transfer product. Use get_product_overview for what the product does, list_corridors for supported destination currencies and demo FX rates, quote_transfer to price a demo transfer, explain_fees for the fee model, and get_swap_config for the Jupiter SOL to USDC swap demo settings. All figures are indicative demo data; no funds move and fiat payout is disabled.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [productOverview, listCorridors, quoteTransfer, explainFees, swapConfig],
});
