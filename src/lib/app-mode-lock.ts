/**
 * Code-level lock for LIVE MODE.
 *
 * LIVE MODE stays unavailable while this is false, whatever the environment
 * says. Turning it on is a deliberate, reviewed code change, made only after
 * the production configuration is complete and the owner has approved going
 * live (docs/security/test-live-mode.md). Environment variables alone can
 * never enable live payments.
 */
export const LIVE_MODE_CODE_UNLOCKED: boolean = false;
