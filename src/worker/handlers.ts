import { statSync } from "node:fs";
import path from "node:path";

import { loadRulesetMeta } from "../domain/rulesets/loader.js";
import { logger } from "../infrastructure/logger.js";
import { prisma } from "../infrastructure/prisma.js";
import { createTaxPackExport } from "../services/export-service.js";
import { computeTaxYear } from "../services/tax-service.js";

export async function handleExtractDocument(data: { documentId: string }) {
  logger.info({ documentId: data.documentId }, "extract_document handler invoked");
}

export async function handleImportBankCsv(data: { batchId: string }) {
  logger.info({ batchId: data.batchId }, "import_bank_csv handler invoked");
}

export async function handleRecomputeTaxYear(data: { userId: string; taxYear: number }) {
  return computeTaxYear(data.userId, data.taxYear);
}

export async function handleGenerateTaxPackPdf(data: { exportId: string }) {
  const exportJob = await prisma.exportJob.findUnique({
    where: {
      id: data.exportId
    }
  });

  if (!exportJob) {
    throw new Error(`Export job ${data.exportId} not found.`);
  }

  return createTaxPackExport(exportJob.userId, exportJob.taxYear);
}

export async function handleRulesetUpdateCheck() {
  const meta = loadRulesetMeta();
  const staleEntries = meta.versions.filter((entry) => entry.status === "stale");
  const rulesetStats = meta.versions.map((entry) => {
    const absolutePath = path.resolve(process.cwd(), entry.path);
    const stats = statSync(absolutePath);
    return {
      id: entry.id,
      mtime: stats.mtime.toISOString(),
      status: entry.status
    };
  });

  logger.warn(
    {
      staleEntries,
      rulesetStats
    },
    "ruleset_update_check completed"
  );

  return {
    staleCount: staleEntries.length
  };
}

export async function handleRebuildCategoryIndex() {
  logger.info("rebuild_category_index handler invoked");
}

export async function handlePurgeExpiredUploadUrls() {
  logger.info("purge_expired_upload_urls handler invoked");
}

export async function handleDeadLetterReprocess() {
  logger.info("dead_letter_reprocess handler invoked");
}
