import { logger } from "../infrastructure/logger.js";
import {
  handleDeadLetterReprocess,
  handleExtractDocument,
  handleGenerateTaxPackPdf,
  handleImportBankCsv,
  handlePurgeExpiredUploadUrls,
  handleRebuildCategoryIndex,
  handleRecomputeTaxYear,
  handleRulesetUpdateCheck
} from "./handlers.js";
import { createWorker, queueNames } from "./queues.js";

createWorker(queueNames.extractDocument, async (job) => handleExtractDocument(job.data));
createWorker(queueNames.importBankCsv, async (job) => handleImportBankCsv(job.data));
createWorker(queueNames.recomputeTaxYear, async (job) => handleRecomputeTaxYear(job.data));
createWorker(queueNames.generateTaxPackPdf, async (job) => handleGenerateTaxPackPdf(job.data));
createWorker(queueNames.rulesetUpdateCheck, async () => handleRulesetUpdateCheck());
createWorker(queueNames.rebuildCategoryIndex, async () => handleRebuildCategoryIndex());
createWorker(queueNames.purgeExpiredUploadUrls, async () => handlePurgeExpiredUploadUrls());
createWorker(queueNames.deadLetterReprocess, async () => handleDeadLetterReprocess());

logger.info("worker runtime started");
