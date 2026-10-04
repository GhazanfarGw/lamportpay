/**
 * Shared by the TEST MODE Pay Now panel (browser) and its server check, so
 * both always use the same program id and memo text.
 */

/** SPL Memo program v2 (same id on devnet and mainnet). */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** The exact memo the wallet signs for a payment. */
export function testPaymentMemo(paymentId: string): string {
  return `LamportPay TEST payment ${paymentId}`;
}
