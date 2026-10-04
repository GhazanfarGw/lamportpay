/**
 * Unit tests start from the documented defaults for LamportPay's business
 * settings (no fee, every payment coin), whatever the developer's .env says.
 * Tests that need a fee or a coin list set it themselves.
 */
for (const key of [
  "LAMPORTPAY_FEE_BPS",
  "LAMPORTPAY_FEE_MIN",
  "LAMPORTPAY_FEE_MAX",
  "LAMPORTPAY_SWAP_FEE_BPS",
  "LAMPORTPAY_REVENUE_WALLET",
  "JUPITER_REFERRAL_ACCOUNT",
  "PAYMENT_ENABLED_CURRENCIES",
]) {
  delete process.env[key];
}
