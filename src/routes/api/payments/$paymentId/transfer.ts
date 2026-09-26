import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { handleUserRequest, json } from "@/lib/payments/http.server";
import { createPaymentTransfer } from "@/lib/payments/service.server";
import { PURPOSE_CODES, type BankDetailField } from "@/lib/stables/types";

const optional = z.string().trim().min(1).max(64).optional();
const detail = z.string().trim().min(1).max(140).optional();

/** Further bank fields, named as Stables names them. Stables decides which are needed. */
const BankDetails = z
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

const TransferInput = z
  .object({
    purposeCode: z.enum(PURPOSE_CODES).default("PERSONAL_REMITTANCE"),
    beneficiary: z
      .object({
        recipientType: z.enum(["individual", "business"]).default("individual"),
        accountHolderName: z.string().trim().min(2).max(140),
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
        details: BankDetails.optional(),
      })
      .strict(),
  })
  .strict();

/**
 * POST /api/payments/:paymentId/transfer — validate the recipient's bank
 * details with Stables (the destination's own rules), then create the Stables
 * transfer for the current quote. The response carries the single-use deposit
 * address the user sends USDC to. A 422 with `fields` names what Stables needs.
 * Bank details are forwarded to Stables and only a masked summary is stored.
 */
export const Route = createFileRoute("/api/payments/$paymentId/transfer")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleUserRequest(request, TransferInput, async (user, body) =>
          json(await createPaymentTransfer(user, params.paymentId, body)),
        ),
    },
  },
});
