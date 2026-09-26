import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { CORRIDORS, TOKENS, TOKEN_USD, calcQuote, type Token } from "@/components/site/demo-data";

export default defineTool({
  name: "quote_transfer",
  title: "Quote a demo transfer",
  description:
    "Calculate a demo LamportPay quote: crypto amount in, fees, and the local currency amount the recipient would receive. Uses indicative demo rates; no funds move.",
  inputSchema: {
    amount: z.number().positive().describe("Amount of the input token to send."),
    token: z
      .enum(TOKENS as unknown as [Token, ...Token[]])
      .describe("Input crypto token symbol, e.g. SOL or USDC."),
    currency: z
      .string()
      .min(3)
      .describe("Destination local currency code, e.g. PKR, INR, NGN."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ amount, token, currency }) => {
    const code = currency.trim().toUpperCase();
    const corridor = CORRIDORS.find((c) => c.currency === code);
    if (!corridor) {
      throw new ToolError(
        `Unsupported currency "${code}". Supported: ${CORRIDORS.map((c) => c.currency).join(", ")}.`,
      );
    }
    const q = calcQuote(amount, token, code);
    const quote = {
      input: { amount, token, tokenUsdPrice: TOKEN_USD[token] },
      usdValue: Number(q.usdValue.toFixed(2)),
      usdcSettlement: Number(q.usdcSettlement.toFixed(2)),
      fees: {
        payoutPartnerFee: Number(q.payoutFee.toFixed(2)),
        lamportpayFee: Number(q.platformFee.toFixed(2)),
        totalFee: Number(q.totalFee.toFixed(2)),
        model: "Payout partner 1% (min $1) + LamportPay 0.5%",
      },
      fx: { currency: code, country: corridor.country, rate: q.fxRate },
      recipientReceives: Number(q.recipientAmount.toFixed(2)),
      disclaimer:
        "Demo quote using indicative rates. Fiat payout is disabled; LamportPay is evaluating regulated payout infrastructure partners.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(quote, null, 2) }],
      structuredContent: quote,
    };
  },
});
