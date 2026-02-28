import { z } from "zod";

export const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100)
});

export const transactionListQuerySchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100),
  from: z.string().optional(),
  to: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120).optional(),
  deviceLabel: z.string().min(1).max(120).optional()
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  deviceLabel: z.string().min(1).max(120).optional()
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

export const taxProfileSchema = z.object({
  filingStatus: z
    .enum([
      "SINGLE",
      "MARRIED_FILING_JOINTLY",
      "MARRIED_FILING_SEPARATELY",
      "HEAD_OF_HOUSEHOLD",
      "QUALIFYING_SURVIVING_SPOUSE"
    ])
    .nullable()
    .optional(),
  dependentsCount: z.number().int().min(0).default(0),
  residentState: z.string().length(2).default("ND"),
  residentCity: z.string().max(120).nullable().optional(),
  residentZip: z.string().max(20).nullable().optional(),
  county: z.string().max(120).nullable().optional(),
  isFullYearResident: z.boolean().default(true),
  hasNdSalesTaxNexus: z.boolean().optional(),
  salesTaxFilingFrequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]).nullable().optional(),
  standardDeductionForced: z.boolean().nullable().optional(),
  itemizedDeductionAmount: z.number().min(0).nullable().optional(),
  hasForeignIncome: z.boolean().optional(),
  hasK1: z.boolean().optional(),
  hasAdvancedInvestments: z.boolean().optional(),
  hasAdvancedDepreciation: z.boolean().optional(),
  notes: z.string().max(2000).optional()
});

export const incomeSchema = z.object({
  taxYear: z.number().int().min(2024).max(2100),
  type: z.enum(["W2", "FORM_1099_MISC", "FORM_1099_NEC", "BUSINESS_GROSS", "OTHER_TAXABLE"]),
  label: z.string().min(1).max(255),
  payerName: z.string().max(255).optional(),
  amount: z.number(),
  taxWithheldFederal: z.number().optional(),
  taxWithheldState: z.number().optional(),
  taxWithheldLocal: z.number().optional(),
  taxWithheldMedicare: z.number().optional(),
  taxWithheldSocialSecurity: z.number().optional(),
  isConfirmed: z.boolean().default(false),
  sourceDocumentId: z.string().uuid().optional(),
  metadataJson: z.record(z.string(), z.unknown()).optional()
});

export const transactionSchema = z.object({
  taxYear: z.number().int().min(2024).max(2100),
  date: z.iso.datetime(),
  amount: z.number(),
  merchant: z.string().max(255).optional(),
  description: z.string().min(1).max(500),
  direction: z.enum(["INCOME", "EXPENSE"]),
  categoryCode: z.string().max(100).nullable().optional(),
  categoryConfidence: z.number().min(0).max(100).nullable().optional(),
  categoryReason: z.string().max(255).nullable().optional(),
  categorySource: z.enum(["RULE", "HEURISTIC", "ML", "USER", "MANUAL"]).optional(),
  documentId: z.string().uuid().nullable().optional(),
  metadataJson: z.record(z.string(), z.unknown()).optional()
});

export const linkDocumentSchema = z.object({
  documentId: z.string().uuid()
});

export const uploadUrlSchema = z.object({
  taxYear: z.number().int().min(2024).max(2100),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  checksum: z.string().min(8)
});

export const confirmUploadSchema = z.object({
  documentId: z.string().uuid()
});

export const bankCsvImportSchema = z.object({
  taxYear: z.number().int().min(2024).max(2100),
  csvContent: z.string().min(1),
  source: z.string().min(1).max(120).optional()
});

export const confirmCategorySchema = z.object({
  transactionId: z.string().uuid(),
  categoryCode: z.string().min(1).max(100),
  createOverride: z.boolean().default(false)
});
