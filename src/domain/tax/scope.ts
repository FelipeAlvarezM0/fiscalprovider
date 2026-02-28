import type { ComputationAssumptionInput, RiskFlagInput, ScopeDecision, TaxProfileInput } from "./types.js";

export function evaluateScope(profile: TaxProfileInput): {
  scope: ScopeDecision;
  assumptions: ComputationAssumptionInput[];
  flags: RiskFlagInput[];
} {
  const reasons: string[] = [];
  const reasonCodes: string[] = [];
  const assumptions: ComputationAssumptionInput[] = [];
  const flags: RiskFlagInput[] = [];
  let status: ScopeDecision["status"] = "IN_SCOPE";
  let recommendedNextStep = "Proceed with the standard compute flow.";

  if (profile.residentState !== "ND") {
    status = "OUT_OF_SCOPE";
    reasons.push("Resident state is not North Dakota.");
    reasonCodes.push("NON_ND_RESIDENCY");
    recommendedNextStep = "Use a multi-state tax workflow or route the case to manual review.";
  }

  if (!profile.isFullYearResident) {
    status = status === "OUT_OF_SCOPE" ? status : "PARTIAL";
    reasons.push("Part-year residency requires a more advanced state allocation module.");
    reasonCodes.push("PART_YEAR_RESIDENCY");
    recommendedNextStep = "Treat the output as partial and escalate to a state allocation workflow.";
    assumptions.push({
      code: "FULL_YEAR_ND_ASSUMED_FALSE",
      description: "Profile indicates part-year residency, which is only partially supported.",
      impactLevel: "high",
      userActionNeeded: true
    });
  }

  if (profile.hasForeignIncome || profile.hasK1 || profile.hasAdvancedInvestments || profile.hasAdvancedDepreciation) {
    status = "OUT_OF_SCOPE";
    reasons.push("Advanced tax attributes were detected.");
    reasonCodes.push("ADVANCED_TAX_ATTRIBUTES");
    recommendedNextStep = "Escalate to a CPA or to an advanced tax module before relying on the estimate.";
    flags.push({
      code: "OUT_OF_SCOPE_CASE_DETECTED",
      severity: "high",
      explanation: "The profile contains income or deduction types that are outside the supported surface.",
      suggestedFix: "Escalate to a specialized module or manual preparer review.",
      evidence: {
        hasForeignIncome: profile.hasForeignIncome ?? false,
        hasK1: profile.hasK1 ?? false,
        hasAdvancedInvestments: profile.hasAdvancedInvestments ?? false,
        hasAdvancedDepreciation: profile.hasAdvancedDepreciation ?? false
      }
    });
  }

  if (reasons.length === 0) {
    reasons.push("Profile falls within the supported scope.");
    reasonCodes.push("SUPPORTED_CASE");
  }

  return {
    scope: {
      status,
      reasons,
      reasonCodes,
      recommendedNextStep
    },
    assumptions,
    flags
  };
}
