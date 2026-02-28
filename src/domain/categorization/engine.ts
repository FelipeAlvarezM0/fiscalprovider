import { clamp } from "../../shared/money.js";
import type { CategorySuggestion, TransactionInput, UserOverrideInput, CategoryRuleInput } from "../tax/types.js";

function matchesPattern(value: string, pattern?: string | null): boolean {
  if (!pattern) {
    return false;
  }

  return new RegExp(pattern, "i").test(value);
}

export function categorizeTransaction(
  transaction: TransactionInput,
  mappingRules: CategoryRuleInput[],
  overrides: UserOverrideInput[]
): CategorySuggestion | null {
  const text = `${transaction.merchant ?? ""} ${transaction.description}`.trim();

  for (const override of overrides) {
    if (matchesPattern(text, override.vendorPattern) || matchesPattern(text, override.keywordPattern)) {
      return {
        categoryCode: override.categoryOverride,
        confidence: 99,
        reason: "Matched user override.",
        source: "USER"
      };
    }
  }

  for (const rule of mappingRules) {
    const textMatched =
      matchesPattern(text, rule.vendorPattern) || matchesPattern(text, rule.keywordPattern);
    const amountMatched =
      (rule.amountMin === null || rule.amountMin === undefined || transaction.amount >= rule.amountMin) &&
      (rule.amountMax === null || rule.amountMax === undefined || transaction.amount <= rule.amountMax);

    if (textMatched && amountMatched) {
      return {
        categoryCode: rule.code,
        confidence: clamp(rule.confidenceBase, 0, 100),
        reason: rule.reason,
        source: "RULE"
      };
    }
  }

  const description = text.toLowerCase();
  if (description.includes("meal") || description.includes("lunch") || description.includes("dinner")) {
    return {
      categoryCode: "MEALS",
      confidence: 58,
      reason: "Keyword heuristic matched meal-related terms.",
      source: "HEURISTIC"
    };
  }

  if (transaction.direction === "INCOME") {
    return {
      categoryCode: "GROSS_RECEIPTS",
      confidence: 55,
      reason: "Income transaction defaults to gross receipts when no better rule matches.",
      source: "HEURISTIC"
    };
  }

  return null;
}
