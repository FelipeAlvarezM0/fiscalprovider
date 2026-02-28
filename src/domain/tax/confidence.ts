import { clamp } from "../../shared/money.js";
import type {
  ConfidenceResult,
  CompletenessResult,
  IncomeInput,
  RiskFlagInput,
  TransactionInput
} from "./types.js";

export function evaluateConfidence(
  completeness: CompletenessResult,
  incomes: IncomeInput[],
  transactions: TransactionInput[],
  flags: RiskFlagInput[],
  stateComputable: boolean
): ConfidenceResult {
  const drivers: ConfidenceResult["drivers"] = [];
  let score = completeness.score;

  const confirmedIncomes = incomes.filter((income) => income.isConfirmed).length;
  const incomeConfirmationRatio = incomes.length === 0 ? 0 : confirmedIncomes / incomes.length;
  const categorizedRatio =
    transactions.length === 0
      ? 1
      : transactions.filter((transaction) => Boolean(transaction.categoryCode)).length / transactions.length;

  if (incomeConfirmationRatio < 0.8) {
    const impact = Math.round((0.8 - incomeConfirmationRatio) * 25);
    score -= impact;
    drivers.push({
      code: "INCOME_CONFIRMATION_GAP",
      impact: -impact,
      reason: "Confirmed income coverage is below 80%."
    });
  }

  if (categorizedRatio < 0.85) {
    const impact = Math.round((0.85 - categorizedRatio) * 35);
    score -= impact;
    drivers.push({
      code: "UNCATEGORIZED_TRANSACTIONS",
      impact: -impact,
      reason: "Too many transactions remain uncategorized."
    });
  }

  if (!stateComputable) {
    score -= 20;
    drivers.push({
      code: "STATE_RULESET_STALE",
      impact: -20,
      reason: "North Dakota ruleset is stale or not computable."
    });
  }

  const highFlags = flags.filter((flag) => flag.severity === "high").length;
  if (highFlags > 0) {
    const impact = Math.min(25, highFlags * 8);
    score -= impact;
    drivers.push({
      code: "HIGH_RISK_FLAGS",
      impact: -impact,
      reason: `${highFlags} high-severity risk flags were raised.`
    });
  }

  if (drivers.length === 0) {
    drivers.push({
      code: "CONFIDENCE_STABLE",
      impact: 0,
      reason: "Coverage, categorization and ruleset status are healthy."
    });
  }

  return {
    score: clamp(score, 0, 100),
    drivers
  };
}
