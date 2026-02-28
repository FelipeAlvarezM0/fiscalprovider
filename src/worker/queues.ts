import { Queue, Worker } from "bullmq";

import { env } from "../config/env.js";
import { logger } from "../infrastructure/logger.js";

export const queueNames = {
  extractDocument: "extract_document",
  importBankCsv: "import_bank_csv",
  recomputeTaxYear: "recompute_tax_year",
  generateTaxPackPdf: "generate_tax_pack_pdf",
  rulesetUpdateCheck: "ruleset_update_check",
  rebuildCategoryIndex: "rebuild_category_index",
  purgeExpiredUploadUrls: "purge_expired_upload_urls",
  deadLetterReprocess: "dead_letter_reprocess"
} as const;

export function createQueue(name: string) {
  return new Queue(name, {
    connection: { url: env.REDIS_URL } as any,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });
}

export function createWorker<TData>(
  name: string,
  processor: (job: any) => Promise<unknown>
) {
  const worker = new Worker<TData>(name, processor, {
    connection: { url: env.REDIS_URL } as any
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, queue: name }, "worker job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, queue: name, error }, "worker job failed");
  });

  return worker;
}

export function schedulerEnabled() {
  return env.NODE_ENV !== "test";
}
