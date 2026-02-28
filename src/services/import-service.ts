import { Prisma } from "@prisma/client";

import { categorizeTransaction } from "../domain/categorization/engine.js";
import { defaultCategoryRules } from "../domain/categorization/defaults.js";
import { prisma } from "../infrastructure/prisma.js";
import { sha256 } from "../shared/hash.js";
import { createId } from "../shared/ids.js";
import { computeTaxYear } from "./tax-service.js";
import { auditActions, writeAuditEvent } from "./audit-service.js";

interface BankCsvImportInput {
  taxYear: number;
  csvContent: string;
  source?: string;
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      if (current.length > 0 || row.length > 0) {
        row.push(current.trim());
        rows.push(row);
        row = [];
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    rows.push(row);
  }

  return rows.filter((item) => item.some((cell) => cell.length > 0));
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const found = normalized.findIndex((header) => header === candidate);
    if (found >= 0) {
      return found;
    }
  }

  return -1;
}

function parseAmount(raw: string): number {
  const normalized = raw.replace(/[$,\s]/g, "").replace(/[()]/g, "");
  const isNegative = raw.includes("(") || normalized.startsWith("-");
  const numeric = Number.parseFloat(normalized.replace("-", ""));
  if (Number.isNaN(numeric)) {
    throw new Error(`Invalid amount value: ${raw}`);
  }

  return isNegative ? -numeric : numeric;
}

function parseDate(raw: string): Date {
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    const month = match[1] ?? "";
    const day = match[2] ?? "";
    const yearRaw = match[3] ?? "";
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`);
  }

  throw new Error(`Invalid date value: ${raw}`);
}

function buildFingerprint(
  taxYear: number,
  date: Date,
  amount: number,
  merchant: string,
  direction: "INCOME" | "EXPENSE",
  source: string
) {
  return sha256(
    JSON.stringify({
      taxYear,
      date: date.toISOString().slice(0, 10),
      amount,
      merchant: merchant.toLowerCase(),
      direction,
      source
    })
  );
}

export async function importBankCsv(
  userId: string,
  input: BankCsvImportInput,
  requestId?: string
) {
  const rows = parseCsv(input.csvContent);
  if (rows.length < 2) {
    throw Object.assign(new Error("CSV must include a header row and at least one data row."), {
      statusCode: 400,
      code: "VALIDATION_ERROR"
    });
  }

  const headers = rows[0] ?? [];
  const bodyRows = rows.slice(1);
  const dateIndex = detectColumn(headers, ["date", "transactiondate", "posteddate"]);
  const amountIndex = detectColumn(headers, ["amount", "transactionamount"]);
  const descriptionIndex = detectColumn(headers, ["description", "memo", "details"]);
  const merchantIndex = detectColumn(headers, ["merchant", "name", "payee", "vendor"]);
  const debitIndex = detectColumn(headers, ["debit", "withdrawal"]);
  const creditIndex = detectColumn(headers, ["credit", "deposit"]);

  if (dateIndex < 0 || (amountIndex < 0 && (debitIndex < 0 || creditIndex < 0))) {
    throw Object.assign(new Error("CSV must include recognizable date and amount columns."), {
      statusCode: 400,
      code: "VALIDATION_ERROR"
    });
  }

  const source = input.source ?? "bank_csv";
  const overrides = await prisma.userOverride.findMany({
    where: {
      userId
    }
  });

  const batch = await prisma.importBatch.create({
    data: {
      userId,
      taxYear: input.taxYear,
      source,
      status: "PROCESSING",
      summaryJson: {
        totalRows: bodyRows.length
      }
    }
  });

  await writeAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    action: auditActions.IMPORT_BANK_CSV_STARTED,
    entityType: "ImportBatch",
    entityId: batch.id,
    requestId,
    payload: {
      taxYear: input.taxYear,
      source
    }
  });

  let createdCount = 0;
  let duplicateCount = 0;
  const fingerprintCache = new Set<string>();

  for (const row of bodyRows) {
    if (row.every((cell) => cell.length === 0)) {
      continue;
    }

    const date = parseDate(row[dateIndex] ?? "");
    const amount =
      amountIndex >= 0
        ? parseAmount(row[amountIndex] ?? "")
        : parseAmount(row[creditIndex] || "0") - parseAmount(row[debitIndex] || "0");
    const direction = amount < 0 ? "EXPENSE" : "INCOME";
    const normalizedAmount = Math.abs(amount);
    const description = row[descriptionIndex] || row[merchantIndex] || "Imported bank transaction";
    const merchant = row[merchantIndex] || row[descriptionIndex] || "Unknown merchant";
    const fingerprint = buildFingerprint(input.taxYear, date, normalizedAmount, merchant, direction, source);

    if (fingerprintCache.has(fingerprint)) {
      duplicateCount += 1;
      continue;
    }

    const existingFingerprint = await prisma.transactionFingerprint.findUnique({
      where: {
        fingerprint
      }
    });

    if (existingFingerprint) {
      duplicateCount += 1;
      fingerprintCache.add(fingerprint);
      continue;
    }

    const categorySuggestion = categorizeTransaction(
      {
        id: createId(),
        date: date.toISOString(),
        amount: normalizedAmount,
        merchant,
        description,
        direction
      },
      defaultCategoryRules,
      overrides.map((override) => ({
        vendorPattern: override.vendorPattern,
        keywordPattern: override.keywordPattern,
        categoryOverride: override.categoryOverride
      }))
    );

    const fingerprintRecord = await prisma.transactionFingerprint.create({
      data: {
        fingerprint
      }
    });

    await prisma.transaction.create({
      data: {
        userId,
        taxYear: input.taxYear,
        date,
        amount: new Prisma.Decimal(normalizedAmount),
        merchant,
        description,
        direction,
        categoryCode: categorySuggestion?.categoryCode ?? null,
        categoryConfidence:
          categorySuggestion?.confidence !== undefined ? new Prisma.Decimal(categorySuggestion.confidence) : null,
        categoryReason: categorySuggestion?.reason ?? null,
        categorySource: categorySuggestion?.source ?? "MANUAL",
        importBatchId: batch.id,
        fingerprintId: fingerprintRecord.id,
        metadataJson: {
          source,
          importedFrom: "bank_csv"
        }
      }
    });

    createdCount += 1;
    fingerprintCache.add(fingerprint);
  }

  await prisma.importBatch.update({
    where: {
      id: batch.id
    },
    data: {
      status: "COMPLETED",
      summaryJson: {
        totalRows: bodyRows.length,
        createdCount,
        duplicateCount
      }
    }
  });

  await writeAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    action: auditActions.IMPORT_BANK_CSV_COMPLETED,
    entityType: "ImportBatch",
    entityId: batch.id,
    requestId,
    payload: {
      taxYear: input.taxYear,
      source,
      createdCount,
      duplicateCount
    }
  });

  const profile = await prisma.taxYearProfile.findUnique({
    where: {
      userId_taxYear: {
        userId,
        taxYear: input.taxYear
      }
    }
  });

  const recompute =
    profile !== null ? await computeTaxYear(userId, input.taxYear, requestId) : null;

  return {
    batchId: batch.id,
    source,
    totalRows: bodyRows.length,
    createdCount,
    duplicateCount,
    recompute
  };
}
