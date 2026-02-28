import { clamp } from "../../shared/money.js";
import type { CompletenessResult, IncomeInput, TaxProfileInput, TransactionInput } from "./types.js";

function monthsWithActivity(transactions: TransactionInput[], incomes: IncomeInput[]): Set<number> {
  const months = new Set<number>();

  for (const transaction of transactions) {
    months.add(new Date(transaction.date).getUTCMonth() + 1);
  }

  if (incomes.length > 0) {
    for (let month = 1; month <= 12; month += 1) {
      months.add(month);
    }
  }

  return months;
}

export function evaluateCompleteness(
  profile: TaxProfileInput,
  incomes: IncomeInput[],
  transactions: TransactionInput[]
): CompletenessResult {
  let score = 100;
  const missingItems: CompletenessResult["missingItems"] = [];
  const gaps: CompletenessResult["gaps"] = [];
  const actions: string[] = [];

  if (!profile.filingStatus) {
    score -= 25;
    missingItems.push({
      code: "MISSING_FILING_STATUS",
      description: "Filing status is required to choose the correct bracket table.",
      action: "Complete the tax profile filing status.",
      impact: "high"
    });
  }

  if (incomes.length === 0) {
    score -= 25;
    missingItems.push({
      code: "MISSING_INCOME",
      description: "No income sources are loaded for the selected tax year.",
      action: "Add W-2, 1099 or business income records.",
      impact: "high"
    });
  }

  const uncategorized = transactions.filter((transaction) => !transaction.categoryCode);
  if (uncategorized.length > 0) {
    score -= Math.min(20, uncategorized.length * 2);
    missingItems.push({
      code: "UNCATEGORIZED_TRANSACTIONS",
      description: `${uncategorized.length} transactions are missing a confirmed category.`,
      action: "Review low-confidence and uncategorized transactions.",
      impact: uncategorized.length > 8 ? "high" : "medium"
    });
  }

  const activityMonths = monthsWithActivity(transactions, incomes);
  for (let month = 1; month <= 12; month += 1) {
    if (!activityMonths.has(month)) {
      gaps.push({
        code: "TEMPORAL_GAP",
        description: "No activity found for this month.",
        month
      });
    }
  }

  if (gaps.length >= 4) {
    score -= 15;
    actions.push("Investigate temporal gaps to confirm the year is fully loaded.");
  }

  const largeUnreviewed = transactions.filter(
    (transaction) => Math.abs(transaction.amount) >= 1000 && !transaction.isReviewed
  );
  if (largeUnreviewed.length > 0) {
    score -= Math.min(10, largeUnreviewed.length * 2);
    missingItems.push({
      code: "LARGE_UNREVIEWED_TRANSACTIONS",
      description: `${largeUnreviewed.length} large transactions have not been reviewed.`,
      action: "Confirm category and supporting documents for large transactions.",
      impact: "medium"
    });
  }

  if (actions.length === 0) {
    actions.push("No blocking completeness issues detected.");
  }

  return {
    score: clamp(score, 0, 100),
    missingItems,
    gaps,
    actions
  };
}
