/**
 * Customer verification state, derived only from what Stables told us and we
 * stored (stables_customers). Never from a wallet connection.
 *
 * Stables' verification statuses (API v1): in_progress | approved | rejected |
 * requires_action. Base payout entitlement: submitted | in_progress | approved
 * | rejected. Stables documents no "expired" verification status, so an
 * expiry/refresh case surfaces as "requires_action" (OPEN: ask Stables whether
 * verifications expire and how that is reported).
 */
export type KycState =
  | "not_registered" // no Stables customer yet
  | "kyc_pending" // Stables is reviewing, or payouts are not yet enabled
  | "kyc_action_required" // Stables needs more from the customer (incl. refresh)
  | "kyc_verified" // verification AND base payout approved by Stables
  | "kyc_rejected";

export function kycStateOf(record: {
  registered: boolean;
  verificationStatus: string | null;
  basePayoutStatus: string | null;
}): KycState {
  if (!record.registered) return "not_registered";
  const v = record.verificationStatus;
  if (v === "rejected" || record.basePayoutStatus === "rejected") return "kyc_rejected";
  if (v === "requires_action") return "kyc_action_required";
  if (v === "approved" && record.basePayoutStatus === "approved") return "kyc_verified";
  return "kyc_pending";
}

export const KYC_STATE_LABEL: Record<KycState, string> = {
  not_registered: "Not verified yet",
  kyc_pending: "Verification in review",
  kyc_action_required: "Action needed",
  kyc_verified: "Verified",
  kyc_rejected: "Verification rejected",
};
