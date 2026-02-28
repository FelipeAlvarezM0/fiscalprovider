export type FilingStatusCode =
  | "SINGLE"
  | "MARRIED_FILING_JOINTLY"
  | "MARRIED_FILING_SEPARATELY"
  | "HEAD_OF_HOUSEHOLD"
  | "QUALIFYING_SURVIVING_SPOUSE";

export interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

export interface FederalRuleset {
  id: string;
  jurisdiction: "federal";
  taxYear: number;
  effectiveFrom: string;
  status: "validated" | "stale" | "draft";
  source: Array<{ name: string; url: string }>;
  checksum: string;
  rulesetSignature: string;
  validatedAt: string;
  changelog: string[];
  standardDeduction: Record<FilingStatusCode, number>;
  brackets: Record<FilingStatusCode, TaxBracket[]>;
  selfEmploymentTax: {
    netEarningsFactor: number;
    socialSecurityRate: number;
    medicareRate: number;
    additionalMedicareRate: number;
    socialSecurityWageBase: number;
    additionalMedicareThreshold: Record<FilingStatusCode, number>;
  };
  supportedCredits: string[];
  unsupportedCredits: string[];
  notes: string[];
}

export interface StateRuleset {
  id: string;
  jurisdiction: "state";
  stateCode: string;
  taxYear: number;
  effectiveFrom: string;
  status: "validated" | "stale" | "draft";
  source: Array<{ name: string; url: string }>;
  checksum: string;
  rulesetSignature: string;
  validatedAt: string;
  changelog: string[];
  computable: boolean;
  brackets?: Record<FilingStatusCode, TaxBracket[]>;
  staleness?: {
    reason: string;
    action: string;
  };
  fallbackPolicy?: {
    mode: "block" | "zero-tax" | "fallback";
    impact: "low" | "medium" | "high";
  };
}

export interface RulesetMetaEntry {
  id: string;
  jurisdiction: string;
  path: string;
  effectiveFrom: string;
  status: string;
  approvedBy: string;
  approvedAt: string;
  sourceHash: string;
  validatedAt: string;
}

export interface RulesetMeta {
  active: {
    federal: string;
    state: string;
    localSalesTax: string;
  };
  activeByTaxYear?: Record<string, { federal: string; state: string; localSalesTax?: string }>;
  versions: RulesetMetaEntry[];
}
