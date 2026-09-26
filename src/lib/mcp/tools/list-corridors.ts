import { defineTool } from "@lovable.dev/mcp-js";
import { CORRIDORS, PAYOUT_METHODS, SENDER_CURRENCIES } from "@/components/site/demo-data";

export default defineTool({
  name: "list_corridors",
  title: "List payout corridors",
  description:
    "List the demo payout corridors LamportPay supports, with their demo FX rate against USD, plus supported payout methods and sender currencies.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => {
    const corridors = CORRIDORS.map((c) => ({
      country: c.country,
      currency: c.currency,
      usdRate: c.rate,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              note: "Demo FX rates only — indicative, not live market data.",
              corridors,
              payoutMethods: PAYOUT_METHODS,
              senderCurrencies: SENDER_CURRENCIES,
            },
            null,
            2,
          ),
        },
      ],
      structuredContent: {
        corridors,
        payoutMethods: [...PAYOUT_METHODS],
        senderCurrencies: [...SENDER_CURRENCIES],
      },
    };
  },
});
