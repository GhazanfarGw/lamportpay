/** Errors the payment API returns to the browser (status, machine code, extra context). */

/** A field Stables flagged on the beneficiary, in Stables' snake_case naming. */
export type FieldIssue = { field: string | null; message: string };

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** Extra machine-readable context returned to the browser. */
    readonly extra?: {
      reason?: string;
      fields?: FieldIssue[];
      /** Balances in minor units, as decimal strings (funding and swap guards). */
      held?: string;
      needed?: string;
      solNeeded?: string;
      /** TEST MODE: an amount the payout partner's sandbox accepts, to start again with. */
      retryAmount?: string;
      retryCountry?: string;
    },
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
