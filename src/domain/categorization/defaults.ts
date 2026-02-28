import type { CategoryRuleInput } from "../tax/types.js";

export const defaultCategoryRules: CategoryRuleInput[] = [
  {
    code: "OFFICE_SUPPLIES",
    vendorPattern: "amazon|staples|office depot",
    confidenceBase: 86,
    reason: "Vendor pattern indicates office supplies."
  },
  {
    code: "MEALS",
    vendorPattern: "doordash|ubereats|grubhub|restaurant|cafe",
    confidenceBase: 70,
    reason: "Vendor pattern suggests meal expense."
  },
  {
    code: "TRAVEL",
    vendorPattern: "delta|united|american airlines|hilton|marriott",
    confidenceBase: 84,
    reason: "Merchant pattern suggests travel expense."
  },
  {
    code: "SOFTWARE",
    keywordPattern: "subscription|saas|hosting|software|cloud",
    confidenceBase: 82,
    reason: "Description indicates software or recurring SaaS expense."
  },
  {
    code: "BANK_FEES",
    keywordPattern: "fee|service charge|overdraft",
    confidenceBase: 78,
    reason: "Description indicates bank fee."
  },
  {
    code: "GROSS_RECEIPTS",
    keywordPattern: "invoice|client payment|payout",
    confidenceBase: 75,
    reason: "Description suggests revenue intake."
  }
];
