import { Prisma } from "@prisma/client";

import { defaultCategoryRules } from "../domain/categorization/defaults.js";
import { computeTaxEstimate } from "../domain/tax/calculator.js";
import { loadFederalRuleset, loadStateRuleset, resolveActiveRulesetsForTaxYear } from "../domain/rulesets/loader.js";
import { prisma } from "../infrastructure/prisma.js";
import { asNumber } from "../shared/money.js";
import { auditActions, writeAuditEvent } from "./audit-service.js";

function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  return value === null || value === undefined ? 0 : asNumber(value);
}

function severityToPrisma(value: "low" | "medium" | "high"): "LOW" | "MEDIUM" | "HIGH" {
  if (value === "high") {
    return "HIGH";
  }

  if (value === "medium") {
    return "MEDIUM";
  }

  return "LOW";
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const prismaUnsafe = prisma as any;

export async function computeTaxYear(userId: string, taxYear: number, requestId?: string) {
  const [profile, incomes, transactions, deductions, estimatedPayments, overrides] = await Promise.all([
    prisma.taxYearProfile.findUnique({
      where: {
        userId_taxYear: {
          userId,
          taxYear
        }
      }
    }),
    prisma.incomeSource.findMany({
      where: {
        userId,
        taxYear
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        taxYear
      },
      orderBy: {
        date: "asc"
      }
    }),
    prisma.deductionItem.findMany({
      where: {
        userId,
        taxYear
      }
    }),
    prismaUnsafe.estimatedPayment.findMany({
      where: {
        userId,
        taxYear
      },
      orderBy: {
        paidAt: "asc"
      }
    }),
    prisma.userOverride.findMany({
      where: {
        userId
      }
    })
  ]);

  if (!profile) {
    throw new Error(`Tax profile missing for year ${taxYear}.`);
  }

  const activeRulesets = resolveActiveRulesetsForTaxYear(taxYear);
  const federalRuleset = loadFederalRuleset(activeRulesets.federal);
  const stateRuleset = loadStateRuleset(activeRulesets.state);

  const result = computeTaxEstimate({
    profile: {
      userId,
      taxYear,
      filingStatus: profile.filingStatus,
      dependentsCount: profile.dependentsCount,
      residentState: profile.residentState,
      residentCity: profile.residentCity,
      residentZip: profile.residentZip,
      county: profile.county,
      isFullYearResident: profile.isFullYearResident,
      hasNdSalesTaxNexus: profile.hasNdSalesTaxNexus,
      salesTaxFilingFrequency: profile.salesTaxFilingFrequency,
      standardDeductionForced: profile.standardDeductionForced,
      itemizedDeductionAmount: profile.itemizedDeductionAmount ? toNumber(profile.itemizedDeductionAmount) : null,
      hasForeignIncome: profile.hasForeignIncome,
      hasK1: profile.hasK1,
      hasAdvancedInvestments: profile.hasAdvancedInvestments,
      hasAdvancedDepreciation: profile.hasAdvancedDepreciation
    },
    incomes: incomes.map((income: any) => ({
      id: income.id,
      type: income.type,
      label: income.label,
      amount: toNumber(income.amount),
      payerName: income.payerName,
      taxWithheldFederal: toNumber(income.taxWithheldFederal),
      taxWithheldState: toNumber(income.taxWithheldState),
      taxWithheldLocal: toNumber(income.taxWithheldLocal),
      taxWithheldMedicare: toNumber(income.taxWithheldMedicare),
      taxWithheldSocialSecurity: toNumber(income.taxWithheldSocialSecurity),
      isConfirmed: income.isConfirmed
    })),
    estimatedPayments: estimatedPayments.map((payment: any) => ({
      id: payment.id,
      kind: payment.kind,
      quarter: payment.quarter,
      amount: toNumber(payment.amount),
      paidAt: payment.paidAt.toISOString()
    })),
    transactions: transactions.map((transaction: any) => ({
      id: transaction.id,
      date: transaction.date.toISOString(),
      amount: toNumber(transaction.amount),
      merchant: transaction.merchant,
      description: transaction.description,
      direction: transaction.direction,
      categoryCode: transaction.categoryCode,
      categoryConfidence: transaction.categoryConfidence ? toNumber(transaction.categoryConfidence) : null,
      categoryReason: transaction.categoryReason,
      categorySource: transaction.categorySource,
      isReviewed: transaction.isReviewed
    })),
    deductions: deductions.map((deduction: any) => ({
      id: deduction.id,
      code: deduction.code,
      label: deduction.label,
      amount: toNumber(deduction.amount),
      isConfirmed: deduction.isConfirmed
    })),
    mappingRules: defaultCategoryRules,
    userOverrides: overrides.map((override: any) => ({
      vendorPattern: override.vendorPattern,
      keywordPattern: override.keywordPattern,
      categoryOverride: override.categoryOverride
    })),
    federalRuleset,
    stateRuleset
  });

  const run = await prisma.computationRun.create({
    data: {
      userId,
      taxYear,
      runStatus: "COMPLETED",
      scopeStatus: result.scope.status,
      rulesetFederalVersion: result.rulesets.federalVersion,
      rulesetStateVersion: result.rulesets.stateVersion,
      totalsJson: asJson(result.breakdown),
      explanationJson: asJson(result.explanation),
      inputsSnapshotJson: asJson({
        incomeCount: incomes.length,
        transactionCount: transactions.length,
        deductionCount: deductions.length
      }),
      completenessScore: result.completeness.score,
      confidenceScore: result.confidence.score
    }
  });

  if (result.assumptions.length > 0) {
    await prisma.computationAssumption.createMany({
      data: result.assumptions.map((assumption) => ({
        runId: run.id,
        code: assumption.code,
        description: assumption.description,
        impactLevel: severityToPrisma(assumption.impactLevel),
        userActionNeeded: assumption.userActionNeeded
      }))
    });
  }

  if (result.riskFlags.length > 0) {
    await prisma.riskFlag.createMany({
      data: result.riskFlags.map((flag) => ({
        runId: run.id,
        code: flag.code,
        severity: severityToPrisma(flag.severity),
        explanation: flag.explanation,
        ...(flag.evidence ? { evidenceJson: asJson(flag.evidence) } : {}),
        suggestedFix: flag.suggestedFix
      }))
    });
  }

  await prisma.completenessReport.upsert({
    where: {
      userId_taxYear: {
        userId,
        taxYear
      }
    },
    update: {
      score: result.completeness.score,
      missingItemsJson: asJson(result.completeness.missingItems),
      gapsJson: asJson(result.completeness.gaps),
      actionsJson: asJson(result.completeness.actions)
    },
    create: {
      userId,
      taxYear,
      score: result.completeness.score,
      missingItemsJson: asJson(result.completeness.missingItems),
      gapsJson: asJson(result.completeness.gaps),
      actionsJson: asJson(result.completeness.actions)
    }
  });

  await prisma.confidenceReport.create({
    data: {
      runId: run.id,
      score: result.confidence.score,
      driversJson: asJson(result.confidence.drivers)
    }
  });

  await writeAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    action: auditActions.TAX_COMPUTE,
    entityType: "ComputationRun",
    entityId: run.id,
    requestId,
    payload: {
      taxYear,
      federalRuleset: result.rulesets.federalVersion,
      stateRuleset: result.rulesets.stateVersion
    }
  });

  return {
    runId: run.id,
    ...result
  };
}

export async function getTaxSummary(userId: string, taxYear: number) {
  return prisma.computationRun.findFirst({
    where: {
      userId,
      taxYear
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function getTaxExplain(runId: string, userId: string) {
  return prisma.computationRun.findFirst({
    where: {
      id: runId,
      userId
    },
    select: {
      id: true,
      explanationJson: true
    }
  });
}

export async function getCompleteness(userId: string, taxYear: number) {
  return prisma.completenessReport.findUnique({
    where: {
      userId_taxYear: {
        userId,
        taxYear
      }
    }
  });
}

export async function getConfidence(runId: string, userId: string) {
  return prisma.confidenceReport.findFirst({
    where: {
      runId,
      run: {
        userId
      }
    }
  });
}

export async function getRiskFlags(runId: string, userId: string) {
  return prisma.riskFlag.findMany({
    where: {
      runId,
      run: {
        userId
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

export async function getAssumptions(runId: string, userId: string) {
  return prisma.computationAssumption.findMany({
    where: {
      runId,
      run: {
        userId
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

export async function listLowConfidenceTransactions(userId: string, taxYear: number) {
  return prisma.transaction.findMany({
    where: {
      userId,
      taxYear,
      OR: [
        {
          categoryConfidence: {
            lt: new Prisma.Decimal(70)
          }
        },
        {
          categoryCode: null
        }
      ]
    },
    orderBy: {
      date: "desc"
    }
  });
}

export async function listUncategorizedTransactions(userId: string, taxYear: number) {
  return prisma.transaction.findMany({
    where: {
      userId,
      taxYear,
      categoryCode: null
    },
    orderBy: {
      date: "desc"
    }
  });
}
