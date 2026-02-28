import { describe, expect, it } from "vitest";

import { computeTaxEstimate } from "../src/domain/tax/calculator.js";
import { loadFederalRuleset, loadStateRuleset } from "../src/domain/rulesets/loader.js";

describe("tax engine", () => {
  const federalRuleset = loadFederalRuleset();
  const stateRuleset = loadStateRuleset();

  it("applies 2026 federal brackets and standard deduction for a simple W-2 case", () => {
    const result = computeTaxEstimate({
      profile: {
        userId: "user-1",
        taxYear: 2026,
        filingStatus: "SINGLE",
        dependentsCount: 0,
        residentState: "ND",
        residentCity: "Grand Forks",
        county: "Grand Forks",
        isFullYearResident: true
      },
      incomes: [
        {
          id: "income-1",
          type: "W2",
          label: "Employer W-2",
          amount: 90000,
          isConfirmed: true
        }
      ],
      estimatedPayments: [],
      transactions: [],
      deductions: [],
      mappingRules: [],
      userOverrides: [],
      federalRuleset,
      stateRuleset
    });

    expect(result.breakdown.taxableIncomeFederal).toBe(73450);
    expect(result.breakdown.federalTax).toBe(10509);
    expect(result.breakdown.federalBalanceDue).toBe(10509);
    expect(result.breakdown.stateTax).toBe(465.56);
    expect(result.estimateStatus).toBe("FULL");
    expect(result.federal.status).toBe("COMPUTED");
    expect(result.state.status).toBe("COMPUTED");
    expect(result.assumptions.some((item) => item.code === "STANDARD_DEDUCTION_APPLIED")).toBe(true);
  });

  it("detects self-employment assumptions and category-driven expense deductions", () => {
    const result = computeTaxEstimate({
      profile: {
        userId: "user-1",
        taxYear: 2026,
        filingStatus: "SINGLE",
        dependentsCount: 0,
        residentState: "ND",
        residentCity: "Grand Forks",
        county: "Grand Forks",
        isFullYearResident: true
      },
      incomes: [
        {
          id: "income-1",
          type: "BUSINESS_GROSS",
          label: "Business gross receipts",
          amount: 120000,
          isConfirmed: true
        }
      ],
      estimatedPayments: [],
      transactions: [
        {
          id: "tx-1",
          date: "2026-02-14T00:00:00.000Z",
          amount: 2000,
          merchant: "Amazon Business",
          description: "Office chairs",
          direction: "EXPENSE",
          isReviewed: false
        }
      ],
      deductions: [],
      mappingRules: [
        {
          code: "OFFICE_SUPPLIES",
          vendorPattern: "amazon",
          confidenceBase: 90,
          reason: "Test rule"
        }
      ],
      userOverrides: [],
      federalRuleset,
      stateRuleset
    });

    expect(result.breakdown.businessExpenses).toBe(2000);
    expect(result.breakdown.selfEmploymentTaxEstimateRange?.low).toBeGreaterThan(0);
    expect(result.breakdown.selfEmploymentTax).toBe(16672.87);
    expect(result.breakdown.selfEmploymentTaxDeduction).toBe(8336.44);
    expect(result.assumptions.some((item) => item.code === "SELF_EMPLOYMENT_TAX_NOT_APPLIED")).toBe(false);
    expect(result.riskFlags.some((item) => item.code === "ESTIMATED_PAYMENTS_RECOMMENDED")).toBe(true);
    expect(result.state.status).toBe("COMPUTED");
  });

  it("blocks compute when filing status is missing even if the ND ruleset is validated", () => {
    const result = computeTaxEstimate({
      profile: {
        userId: "user-1",
        taxYear: 2026,
        filingStatus: null,
        dependentsCount: 0,
        residentState: "ND",
        residentCity: "Grand Forks",
        county: "Grand Forks",
        isFullYearResident: true
      },
      incomes: [],
      estimatedPayments: [],
      transactions: [],
      deductions: [],
      mappingRules: [],
      userOverrides: [],
      federalRuleset,
      stateRuleset
    });

    expect(result.completeness.score).toBeLessThanOrEqual(50);
    expect(result.confidence.score).toBeLessThanOrEqual(60);
    expect(result.estimateStatus).toBe("BLOCKED");
    expect(result.federal.status).toBe("BLOCKED_INPUT");
    expect(result.state.tax).toBeNull();
    expect(result.riskFlags.some((item) => item.code === "STATE_RULESET_STALE")).toBe(false);
  });
});
