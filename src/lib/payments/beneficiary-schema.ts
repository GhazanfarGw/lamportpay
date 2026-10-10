/**
 * The payout bank account as the API accepts it (shared by the payout
 * details check and the transfer). Field names follow Stables; which ones a
 * destination needs is Stables' rule (src/lib/payout-requirements.ts).
 */
import { z } from "zod";

import type { BankDetailField } from "@/lib/stables/types";

const optional = z.string().trim().min(1).max(64).optional();
const detail = z.string().trim().min(1).max(140).optional();

export const BankDetailsSchema = z
  .object({
    account_type: z.enum(["savings", "checking", "payment"]).optional(),
    branch_name: detail,
    swift_code: detail,
    bic_code: detail,
    ifsc_code: detail,
    aba_code: detail,
    sort_code: detail,
    branch_code: detail,
    bsb_code: detail,
    bank_code: detail,
    cnaps: detail,
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +14155552671.")
      .optional(),
    name_in_local_language: detail,
    national_identification_number: detail,
  } satisfies Record<BankDetailField, z.ZodTypeAny>)
  .strict();

// The payout account: the user's own (no holderName: the holder is the
// verified, or before verification the entered, name) or a beneficiary's
// (holderName + recipientType; owner decision 2026-10-11, Stables allows
// third-party payouts for a verified sender).
export const BeneficiarySchema = z
  .object({
    holderName: z.string().trim().min(3).max(140).optional(),
    recipientType: z.enum(["individual", "business"]).optional(),
    bankName: z.string().trim().min(2).max(140),
    accountNumber: optional,
    iban: optional,
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
      .optional(),
    address: z
      .object({
        street: z.string().trim().min(1).max(200),
        city: z.string().trim().min(1).max(100),
        state: z.string().trim().min(1).max(100),
        postalCode: z.string().trim().min(1).max(20),
        country: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{2}$/, "Use a 2-letter country code."),
      })
      .strict()
      .optional(),
    details: BankDetailsSchema.optional(),
  })
  .strict();
