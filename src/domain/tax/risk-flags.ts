import type {
  IncomeInput,
  RiskFlagInput,
  ScopeDecision,
  TransactionInput
} from "./types.js";
import type { StateRuleset } from "../rulesets/types.js";

export function buildRiskFlags(
  scope: ScopeDecision,
  incomes: IncomeInput[],
  transactions: TransactionInput[],
  stateRuleset: StateRuleset
): RiskFlagInput[] {
  const flags: RiskFlagInput[] = [];

  const uncategorizedCount = transactions.filter((transaction) => !transaction.categoryCode).length;
  const uncategorizedRatio = transactions.length === 0 ? 0 : uncategorizedCount / transactions.length;
  if (uncategorizedRatio >= 0.25) {
    flags.push({
      code: "HIGH_UNCATEGORIZED_RATIO",
      severity: uncategorizedRatio >= 0.4 ? "high" : "medium",
      explanation: "A large share of transactions is still uncategorized.",
      suggestedFix: "Review the categorization queue and confirm overrides for recurring merchants.",
      evidence: {
        uncategorizedCount,
        totalTransactions: transactions.length
      }
    });
  }

  if (transactions.some((transaction) => transaction.direction === "EXPENSE") && incomes.length === 0) {
    flags.push({
      code: "MISSING_INCOME_SIGNAL",
      severity: "high",
      explanation: "Business expenses are present without any matching income source.",
      suggestedFix: "Add or confirm income sources before relying on the estimate."
    });
  }

  const mealExpenses = transactions.filter((transaction) => transaction.categoryCode === "MEALS");
  const expenseTransactions = transactions.filter((transaction) => transaction.direction === "EXPENSE");
  const mealsRatio = expenseTransactions.length === 0 ? 0 : mealExpenses.length / expenseTransactions.length;
  if (mealsRatio > 0.35) {
    flags.push({
      code: "UNUSUAL_MEALS_RATIO",
      severity: "medium",
      explanation: "Meal expenses represent an unusually large share of business expenses.",
      suggestedFix: "Review meal categorization and confirm business purpose on supporting receipts.",
      evidence: {
        mealsTransactions: mealExpenses.length,
        expenseTransactions: expenseTransactions.length
      }
    });
  }

  if (!stateRuleset.computable) {
    flags.push({
      code: "STATE_RULESET_STALE",
      severity: "high",
      explanation: "North Dakota ruleset is marked stale and state tax cannot be computed safely.",
      suggestedFix: stateRuleset.staleness?.action ?? "Validate and reload the ND ruleset."
    });
  }

  if (scope.status !== "IN_SCOPE") {
    flags.push({
      code: "OUT_OF_SCOPE_CASE_DETECTED",
      severity: scope.status === "OUT_OF_SCOPE" ? "high" : "medium",
      explanation: scope.reasons.join(" "),
      suggestedFix: "Escalate to manual review or a more advanced tax module."
    });
  }

  return flags;
}
