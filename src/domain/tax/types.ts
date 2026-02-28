import type { FilingStatusCode, FederalRuleset, StateRuleset } from "../rulesets/types.js";

export type IncomeTypeCode = "W2" | "FORM_1099_MISC" | "FORM_1099_NEC" | "BUSINESS_GROSS" | "OTHER_TAXABLE";
export type DirectionCode = "INCOME" | "EXPENSE";
export type CategorySourceCode = "RULE" | "HEURISTIC" | "ML" | "USER" | "MANUAL";
export type ImpactLevel = "low" | "medium" | "high";
export type ScopeStatusCode = "IN_SCOPE" | "PARTIAL" | "OUT_OF_SCOPE";
export type EstimateStatusCode = "FULL" | "PARTIAL" | "BLOCKED";

export interface TaxProfileInput {
  userId: string;
  taxYear: number;
  filingStatus: FilingStatusCode | null;
  dependentsCount: number;
  residentState: string;
  residentCity?: string | null;
  residentZip?: string | null;
  county?: string | null;
  isFullYearResident: boolean;
  hasNdSalesTaxNexus?: boolean;
  salesTaxFilingFrequency?: "MONTHLY" | "QUARTERLY" | "ANNUAL" | null;
  standardDeductionForced?: boolean | null;
  itemizedDeductionAmount?: number | null;
  hasForeignIncome?: boolean;
  hasK1?: boolean;
  hasAdvancedInvestments?: boolean;
  hasAdvancedDepreciation?: boolean;
}

export interface IncomeInput {
  id: string;
  type: IncomeTypeCode;
  label: string;
  amount: number;
  payerName?: string | null;
  taxWithheldFederal?: number;
  taxWithheldState?: number;
  taxWithheldLocal?: number;
  taxWithheldMedicare?: number;
  taxWithheldSocialSecurity?: number;
  isConfirmed: boolean;
}

export interface EstimatedPaymentInput {
  id: string;
  kind: "ESTIMATED_QUARTERLY" | "EXTENSION" | "OTHER";
  quarter?: number | null;
  amount: number;
  paidAt: string;
}

export interface TransactionInput {
  id: string;
  date: string;
  amount: number;
  merchant?: string | null;
  description: string;
  direction: DirectionCode;
  categoryCode?: string | null;
  categoryConfidence?: number | null;
  categoryReason?: string | null;
  categorySource?: CategorySourceCode;
  isReviewed?: boolean;
}

export interface DeductionInput {
  id: string;
  code: string;
  label: string;
  amount: number;
  isConfirmed: boolean;
}

export interface CategoryRuleInput {
  code: string;
  vendorPattern?: string | null;
  keywordPattern?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  confidenceBase: number;
  reason: string;
}

export interface UserOverrideInput {
  vendorPattern?: string | null;
  keywordPattern?: string | null;
  categoryOverride: string;
}

export interface CategorySuggestion {
  categoryCode: string;
  confidence: number;
  reason: string;
  source: CategorySourceCode;
}

export interface MissingItem {
  code: string;
  description: string;
  action: string;
  impact: ImpactLevel;
}

export interface GapItem {
  code: string;
  description: string;
  month?: number;
}

export interface Driver {
  code: string;
  impact: number;
  reason: string;
}

export interface ComputationAssumptionInput {
  code: string;
  description: string;
  impactLevel: ImpactLevel;
  userActionNeeded: boolean;
}

export interface RiskFlagInput {
  code: string;
  severity: ImpactLevel;
  explanation: string;
  suggestedFix: string;
  evidence?: Record<string, unknown>;
}

export interface ExplanationNode {
  nodeId: string;
  label: string;
  formula: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  children: ExplanationNode[];
  transactionRefs: string[];
}

export interface ScopeDecision {
  status: ScopeStatusCode;
  reasons: string[];
  reasonCodes: string[];
  recommendedNextStep: string;
}

export interface StateComputationStatus {
  status: "COMPUTED" | "BLOCKED_RULESET" | "OUT_OF_SCOPE";
  tax: number | null;
  reasonCode: string | null;
  reason: string | null;
  taxableIncome?: number | null;
  withholdings?: number | null;
  effectiveRate?: number | null;
}

export interface FederalComputationStatus {
  status: "COMPUTED" | "BLOCKED_INPUT";
  tax: number | null;
  reasonCode: string | null;
  reason: string | null;
  taxableIncome?: number | null;
  withholdings?: number | null;
  effectiveRate?: number | null;
}

export interface EstimatedPaymentRecommendation {
  dueDate: string;
  amount: number;
}

export interface SelfEmploymentTaxDetails {
  total: number;
  deductibleHalf: number;
  socialSecurityPortion: number;
  medicarePortion: number;
  additionalMedicarePortion: number;
}

export interface CompletenessResult {
  score: number;
  missingItems: MissingItem[];
  gaps: GapItem[];
  actions: string[];
}

export interface ConfidenceResult {
  score: number;
  drivers: Driver[];
}

export interface TaxBreakdown {
  federalTax: number;
  stateTax: number | null;
  totalTax: number | null;
  taxableIncomeFederal: number;
  taxableIncomeState: number | null;
  grossIncome: number;
  businessExpenses: number;
  deductionUsed: number;
  federalWithholding: number;
  stateWithholding: number;
  estimatedPayments: number;
  federalBalanceDue: number;
  stateBalanceDue: number | null;
  totalBalanceDue: number | null;
  monthlySetAsideRecommendation: number;
  quarterlyEstimatedPaymentRecommendation: number;
  selfEmploymentTax: number;
  selfEmploymentTaxDeduction: number;
  selfEmploymentTaxDetails: SelfEmploymentTaxDetails | null;
  selfEmploymentTaxEstimateRange: {
    low: number;
    high: number;
  } | null;
}

export interface TaxComputationInput {
  profile: TaxProfileInput;
  incomes: IncomeInput[];
  estimatedPayments: EstimatedPaymentInput[];
  transactions: TransactionInput[];
  deductions: DeductionInput[];
  mappingRules: CategoryRuleInput[];
  userOverrides: UserOverrideInput[];
  federalRuleset: FederalRuleset;
  stateRuleset: StateRuleset;
}

export interface TaxComputationOutput {
  scope: ScopeDecision;
  outOfScopeReasons: string[];
  estimateStatus: EstimateStatusCode;
  estimateWatermark: string | null;
  federal: FederalComputationStatus;
  state: StateComputationStatus;
  breakdown: TaxBreakdown;
  explanation: ExplanationNode;
  assumptions: ComputationAssumptionInput[];
  completeness: CompletenessResult;
  confidence: ConfidenceResult;
  riskFlags: RiskFlagInput[];
  estimatedPaymentPlan: EstimatedPaymentRecommendation[];
  categorizedTransactions: Array<TransactionInput & { categorySuggestion?: CategorySuggestion }>;
  rulesets: {
    federalVersion: string;
    stateVersion: string;
  };
}
