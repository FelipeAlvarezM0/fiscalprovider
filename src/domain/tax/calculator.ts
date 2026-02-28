import { createId } from "../../shared/ids.js";
import { roundCurrency } from "../../shared/money.js";
import { categorizeTransaction } from "../categorization/engine.js";
import type { FilingStatusCode, TaxBracket } from "../rulesets/types.js";
import type {
  ComputationAssumptionInput,
  ExplanationNode,
  RiskFlagInput,
  TaxBreakdown,
  TaxComputationInput,
  TaxComputationOutput,
  TransactionInput
} from "./types.js";
import { evaluateCompleteness } from "./completeness.js";
import { evaluateConfidence } from "./confidence.js";
import { buildRiskFlags } from "./risk-flags.js";
import { evaluateScope } from "./scope.js";

function computeBracketTax(income: number, brackets: TaxBracket[]): number {
  let total = 0;

  for (const bracket of brackets) {
    if (income <= bracket.min) {
      continue;
    }

    const upper = bracket.max ?? income;
    const taxableAtBracket = Math.min(income, upper) - bracket.min;
    if (taxableAtBracket > 0) {
      total += taxableAtBracket * bracket.rate;
    }
  }

  return roundCurrency(total);
}

function detectDeductibleExpense(transaction: TransactionInput): boolean {
  return (
    transaction.direction === "EXPENSE" &&
    [
      "OFFICE_SUPPLIES",
      "MEALS",
      "TRAVEL",
      "SOFTWARE",
      "BANK_FEES"
    ].includes(transaction.categoryCode ?? "")
  );
}

function estimateSelfEmploymentTaxRange(netSelfEmploymentIncome: number): { low: number; high: number } | null {
  if (netSelfEmploymentIncome <= 0) {
    return null;
  }

  const baseline = roundCurrency(netSelfEmploymentIncome * 0.9235 * 0.153);
  return {
    low: roundCurrency(baseline * 0.95),
    high: roundCurrency(baseline * 1.05)
  };
}

function computeSelfEmploymentTax(
  filingStatus: FilingStatusCode | null,
  grossIncome: number,
  businessExpenses: number,
  input: TaxComputationInput
) {
  const hasSelfEmploymentIncome = input.incomes.some((income) =>
    ["FORM_1099_NEC", "BUSINESS_GROSS"].includes(income.type)
  );

  if (!hasSelfEmploymentIncome || filingStatus === null) {
    return {
      hasSelfEmploymentIncome,
      netSelfEmploymentIncome: 0,
      taxableEarnings: 0,
      details: null,
      deduction: 0,
      estimateRange: null
    };
  }

  const netSelfEmploymentIncome = roundCurrency(Math.max(0, grossIncome - businessExpenses));
  if (netSelfEmploymentIncome <= 0) {
    return {
      hasSelfEmploymentIncome,
      netSelfEmploymentIncome,
      taxableEarnings: 0,
      details: null,
      deduction: 0,
      estimateRange: {
        low: 0,
        high: 0
      }
    };
  }

  const rules = input.federalRuleset.selfEmploymentTax;
  const taxableEarnings = roundCurrency(netSelfEmploymentIncome * rules.netEarningsFactor);
  const w2Wages = roundCurrency(
    input.incomes
      .filter((income) => income.type === "W2")
      .reduce((sum, income) => sum + income.amount, 0)
  );
  const remainingSocialSecurityBase = Math.max(0, rules.socialSecurityWageBase - w2Wages);
  const socialSecurityPortion = roundCurrency(
    Math.min(taxableEarnings, remainingSocialSecurityBase) * rules.socialSecurityRate
  );
  const medicarePortion = roundCurrency(taxableEarnings * rules.medicareRate);
  const additionalMedicareThreshold = rules.additionalMedicareThreshold[filingStatus];
  const remainingAdditionalThreshold = Math.max(0, additionalMedicareThreshold - w2Wages);
  const additionalMedicarePortion = roundCurrency(
    Math.max(0, taxableEarnings - remainingAdditionalThreshold) * rules.additionalMedicareRate
  );
  const total = roundCurrency(socialSecurityPortion + medicarePortion + additionalMedicarePortion);
  const deductibleHalf = roundCurrency((socialSecurityPortion + medicarePortion) / 2);

  return {
    hasSelfEmploymentIncome,
    netSelfEmploymentIncome,
    taxableEarnings,
    details: {
      total,
      deductibleHalf,
      socialSecurityPortion,
      medicarePortion,
      additionalMedicarePortion
    },
    deduction: deductibleHalf,
    estimateRange: {
      low: total,
      high: total
    }
  };
}

function buildEstimatedPaymentPlan(taxYear: number, annualAmount: number) {
  if (annualAmount <= 0) {
    return [];
  }

  const installment = roundCurrency(annualAmount / 4);
  return [
    { dueDate: `${taxYear}-04-15`, amount: installment },
    { dueDate: `${taxYear}-06-15`, amount: installment },
    { dueDate: `${taxYear}-09-15`, amount: installment },
    { dueDate: `${taxYear + 1}-01-15`, amount: installment }
  ];
}

function buildExplanation(
  breakdown: TaxBreakdown,
  categorizedTransactions: Array<TransactionInput>,
  deductionLabel: string,
  federalTax: number,
  stateTax: number | null,
  stateStatus: string
): ExplanationNode {
  const incomeRefs = categorizedTransactions
    .filter((transaction) => transaction.direction === "INCOME")
    .map((transaction) => transaction.id);
  const expenseRefs = categorizedTransactions
    .filter((transaction) => detectDeductibleExpense(transaction))
    .map((transaction) => transaction.id);

  return {
    nodeId: createId(),
    label: "Tax estimate",
    formula: "federal tax + state tax",
    inputs: {
      grossIncome: breakdown.grossIncome,
      businessExpenses: breakdown.businessExpenses,
      deductionUsed: breakdown.deductionUsed
    },
    outputs: {
      federalTax,
      stateTax,
      totalTax: breakdown.totalTax
    },
    transactionRefs: [],
    children: [
      {
        nodeId: createId(),
        label: "Income aggregation",
        formula: "sum(income sources and income transactions)",
        inputs: {
          incomeTransactions: incomeRefs.length
        },
        outputs: {
          grossIncome: breakdown.grossIncome
        },
        children: [],
        transactionRefs: incomeRefs
      },
      {
        nodeId: createId(),
        label: "Business deductions",
        formula: "sum(deductible expense transactions)",
        inputs: {
          deductionStrategy: deductionLabel
        },
        outputs: {
          businessExpenses: breakdown.businessExpenses
        },
        children: [],
        transactionRefs: expenseRefs
      },
      {
        nodeId: createId(),
        label: "Federal taxable income",
        formula: "gross income - business expenses - SE tax deduction - selected deduction",
        inputs: {
          grossIncome: breakdown.grossIncome,
          businessExpenses: breakdown.businessExpenses,
          selfEmploymentTaxDeduction: breakdown.selfEmploymentTaxDeduction,
          deductionUsed: breakdown.deductionUsed
        },
        outputs: {
          taxableIncomeFederal: breakdown.taxableIncomeFederal,
          federalTax
        },
        children: [],
        transactionRefs: []
      },
      {
        nodeId: createId(),
        label: "North Dakota tax",
        formula: stateTax === null ? "state computation blocked" : "apply state ruleset brackets",
        inputs: {
          taxableIncomeState: breakdown.taxableIncomeState,
          stateStatus
        },
        outputs: {
          stateTax
        },
        children: [],
        transactionRefs: []
      },
      {
        nodeId: createId(),
        label: "Self-employment tax",
        formula: breakdown.selfEmploymentTax > 0 ? "Schedule SE style computation" : "no self-employment tax",
        inputs: {
          selfEmploymentTaxDeduction: breakdown.selfEmploymentTaxDeduction
        },
        outputs: {
          selfEmploymentTax: breakdown.selfEmploymentTax
        },
        children: [],
        transactionRefs: []
      }
    ]
  };
}

function inferSelectedDeduction(
  filingStatus: FilingStatusCode | null,
  standardDeductionForced: boolean | null | undefined,
  itemizedAmount: number | null | undefined,
  standardDeduction: number
): { amount: number; label: string; assumption?: ComputationAssumptionInput } {
  if (!filingStatus) {
    return {
      amount: 0,
      label: "No deduction selected due to missing filing status"
    };
  }

  if (standardDeductionForced === true || !itemizedAmount || itemizedAmount <= standardDeduction) {
    return {
      amount: standardDeduction,
      label: "Standard deduction",
      assumption: {
        code: "STANDARD_DEDUCTION_APPLIED",
        description: "The engine applied the standard deduction because itemized deductions were absent or lower.",
        impactLevel: "medium",
        userActionNeeded: false
      }
    };
  }

  return {
    amount: itemizedAmount,
    label: "Itemized deduction"
  };
}

export function computeTaxEstimate(input: TaxComputationInput): TaxComputationOutput {
  const categorizedTransactions = input.transactions.map((transaction) => {
    if (transaction.categoryCode) {
      return transaction;
    }

    const suggestion = categorizeTransaction(transaction, input.mappingRules, input.userOverrides);
    return {
      ...transaction,
      categoryCode: suggestion?.categoryCode ?? transaction.categoryCode,
      categoryConfidence: suggestion?.confidence ?? transaction.categoryConfidence,
      categoryReason: suggestion?.reason ?? transaction.categoryReason,
      categorySource: suggestion?.source ?? transaction.categorySource,
      categorySuggestion: suggestion ?? undefined
    };
  });

  const scopeContext = evaluateScope(input.profile);
  const completeness = evaluateCompleteness(input.profile, input.incomes, categorizedTransactions);

  const explicitDeductions = input.deductions.filter((deduction) => deduction.isConfirmed);
  const deductibleExpenses = categorizedTransactions
    .filter((transaction) => detectDeductibleExpense(transaction))
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const businessExpenses = roundCurrency(
    deductibleExpenses + explicitDeductions.reduce((sum, deduction) => sum + deduction.amount, 0)
  );

  const grossIncome = roundCurrency(input.incomes.reduce((sum, income) => sum + income.amount, 0));

  const filingStatus = input.profile.filingStatus;
  const standardDeduction = filingStatus
    ? input.federalRuleset.standardDeduction[filingStatus]
    : 0;
  const selfEmploymentComputation = computeSelfEmploymentTax(filingStatus, grossIncome, businessExpenses, input);
  const selectedDeduction = inferSelectedDeduction(
    filingStatus,
    input.profile.standardDeductionForced,
    input.profile.itemizedDeductionAmount,
    standardDeduction
  );

  const adjustedGrossIncome = roundCurrency(
    Math.max(0, grossIncome - businessExpenses - selfEmploymentComputation.deduction)
  );
  const taxableIncomeFederal = roundCurrency(
    Math.max(0, adjustedGrossIncome - selectedDeduction.amount)
  );

  const federalIncomeTax =
    filingStatus === null ? 0 : computeBracketTax(taxableIncomeFederal, input.federalRuleset.brackets[filingStatus]);
  const federalTax = roundCurrency(federalIncomeTax + (selfEmploymentComputation.details?.total ?? 0));
  const federal =
    filingStatus === null
      ? {
          status: "BLOCKED_INPUT" as const,
          tax: null,
          reasonCode: "MISSING_FILING_STATUS",
          reason: "Federal income tax requires a filing status.",
          taxableIncome: null,
          withholdings: null,
          effectiveRate: null
        }
      : {
          status: "COMPUTED" as const,
          tax: federalTax,
          reasonCode: null,
          reason: null,
          taxableIncome: taxableIncomeFederal,
          withholdings: 0,
          effectiveRate: grossIncome > 0 ? roundCurrency(federalTax / grossIncome) : null
        };

  const stateTax =
    filingStatus === null || !input.stateRuleset.computable || !input.stateRuleset.brackets
      ? null
      : computeBracketTax(taxableIncomeFederal, input.stateRuleset.brackets[filingStatus]);
  const state =
    input.stateRuleset.computable && stateTax !== null
        ? {
          status: "COMPUTED" as const,
          tax: stateTax,
          reasonCode: null,
          reason: null,
          taxableIncome: taxableIncomeFederal,
          withholdings: 0,
          effectiveRate: grossIncome > 0 ? roundCurrency(stateTax / grossIncome) : null
        }
      : {
          status:
            scopeContext.scope.status === "OUT_OF_SCOPE"
              ? ("OUT_OF_SCOPE" as const)
              : ("BLOCKED_RULESET" as const),
          tax: null,
          reasonCode: input.stateRuleset.computable ? "OUT_OF_SCOPE_CASE_DETECTED" : "STATE_RULESET_STALE",
          reason:
            input.stateRuleset.computable
              ? scopeContext.scope.reasons.join(" ")
              : input.stateRuleset.staleness?.reason ?? "State ruleset is not computable.",
          taxableIncome: null,
          withholdings: null,
          effectiveRate: null
        };

  const assumptions: ComputationAssumptionInput[] = [...scopeContext.assumptions];
  if (selectedDeduction.assumption) {
    assumptions.push(selectedDeduction.assumption);
  }
  if (input.stateRuleset.computable && input.profile.residentState === "ND") {
    assumptions.push({
      code: "ND_2026_RATE_SCHEDULE_APPLIED",
      description:
        "North Dakota 2026 state tax uses the official 2026 ND-1ES rate schedule. ND-specific additions, subtractions, and credits still follow the currently modeled 2025 instruction surface where separately supported.",
      impactLevel: "medium",
      userActionNeeded: false
    });
  }

  const selfEmploymentTaxEstimateRange =
    selfEmploymentComputation.estimateRange ??
    estimateSelfEmploymentTaxRange(selfEmploymentComputation.netSelfEmploymentIncome);

  const riskFlags: RiskFlagInput[] = [
    ...scopeContext.flags,
    ...buildRiskFlags(scopeContext.scope, input.incomes, categorizedTransactions, input.stateRuleset)
  ];

  if (selfEmploymentComputation.hasSelfEmploymentIncome && (selfEmploymentComputation.details?.total ?? 0) > 0) {
    riskFlags.push({
      code: "ESTIMATED_PAYMENTS_RECOMMENDED",
      severity: "medium",
      explanation: "Self-employment income usually requires quarterly estimated payments to avoid underpayment surprises.",
      suggestedFix: "Use the quarterly payment recommendation and record estimated payments as they are made."
    });
  }

  const confidence = evaluateConfidence(
    completeness,
    input.incomes,
    categorizedTransactions,
    riskFlags,
    input.stateRuleset.computable
  );

  const federalWithholding = roundCurrency(
    input.incomes.reduce((sum, income) => sum + (income.taxWithheldFederal ?? 0), 0)
  );
  const stateWithholding = roundCurrency(
    input.incomes.reduce((sum, income) => sum + (income.taxWithheldState ?? 0), 0)
  );
  const estimatedPaymentsTotal = roundCurrency(
    input.estimatedPayments.reduce((sum, payment) => sum + payment.amount, 0)
  );
  const federalBalanceDue = roundCurrency(federalTax - federalWithholding - estimatedPaymentsTotal);
  const effectiveStateTax = stateTax;
  const stateBalanceDue = effectiveStateTax === null ? null : roundCurrency(effectiveStateTax - stateWithholding);
  const totalBalanceDue = stateBalanceDue === null ? null : roundCurrency(federalBalanceDue + stateBalanceDue);
  const monthlySetAsideRecommendation = roundCurrency(
    Math.max(0, (totalBalanceDue ?? federalBalanceDue) / 12)
  );
  const quarterlyEstimatedPaymentRecommendation = roundCurrency(
    Math.max(0, (totalBalanceDue ?? federalBalanceDue) / 4)
  );
  const estimatedPaymentPlan = buildEstimatedPaymentPlan(
    input.profile.taxYear,
    Math.max(0, totalBalanceDue ?? federalBalanceDue)
  );

  if (federalBalanceDue > Math.max(1000, grossIncome * 0.05)) {
    riskFlags.push({
      code: "UNDERWITHHOLDING_RISK",
      severity: federalBalanceDue > Math.max(2500, grossIncome * 0.1) ? "high" : "medium",
      explanation: "Current withholding and estimated payments may be too low relative to the projected federal liability.",
      suggestedFix: "Increase withholding or make estimated payments during the year.",
      evidence: {
        federalBalanceDue,
        federalWithholding,
        estimatedPaymentsTotal
      }
    });
  }

  const breakdown: TaxBreakdown = {
    federalTax,
    stateTax: effectiveStateTax,
    totalTax: effectiveStateTax === null ? null : roundCurrency(federalTax + effectiveStateTax),
    taxableIncomeFederal,
    taxableIncomeState: stateTax === null ? null : taxableIncomeFederal,
    grossIncome,
    businessExpenses,
    deductionUsed: selectedDeduction.amount,
    federalWithholding,
    stateWithholding,
    estimatedPayments: estimatedPaymentsTotal,
    federalBalanceDue,
    stateBalanceDue,
    totalBalanceDue,
    monthlySetAsideRecommendation,
    quarterlyEstimatedPaymentRecommendation,
    selfEmploymentTax: selfEmploymentComputation.details?.total ?? 0,
    selfEmploymentTaxDeduction: selfEmploymentComputation.deduction,
    selfEmploymentTaxDetails: selfEmploymentComputation.details,
    selfEmploymentTaxEstimateRange
  };
  federal.withholdings = federalWithholding;
  state.withholdings = stateWithholding;

  const estimateStatus =
    federal.status !== "COMPUTED" || state.status === "BLOCKED_RULESET"
      ? "BLOCKED"
      : scopeContext.scope.status === "IN_SCOPE"
        ? "FULL"
        : "PARTIAL";
  const estimateWatermark =
    estimateStatus === "FULL"
      ? null
      : `${estimateStatus === "BLOCKED" ? "Blocked estimate." : "Partial estimate only."} ${scopeContext.scope.recommendedNextStep}`;

  return {
    scope: scopeContext.scope,
    outOfScopeReasons: scopeContext.scope.reasonCodes.filter((code) => code !== "SUPPORTED_CASE"),
    estimateStatus,
    estimateWatermark,
    federal,
    state,
    breakdown,
    explanation: buildExplanation(
      breakdown,
      categorizedTransactions,
      selectedDeduction.label,
      federalTax,
      stateTax,
      state.status
    ),
    assumptions,
    completeness,
    confidence,
    riskFlags,
    estimatedPaymentPlan,
    categorizedTransactions,
    rulesets: {
      federalVersion: input.federalRuleset.id,
      stateVersion: input.stateRuleset.id
    }
  };
}
