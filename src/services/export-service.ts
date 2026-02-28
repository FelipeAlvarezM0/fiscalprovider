import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../infrastructure/prisma.js";
import { getObjectBuffer, isObjectStorageConfigured, putObjectBuffer } from "../infrastructure/s3.js";
import { computeTaxYear } from "./tax-service.js";
import { auditActions, writeAuditEvent } from "./audit-service.js";

const EXPORTS_DIR = path.resolve(process.cwd(), "generated", "exports");

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdf(lines: string[]): Buffer {
  const pageSize = 38;
  const chunks: string[][] = [];
  for (let index = 0; index < lines.length; index += pageSize) {
    chunks.push(lines.slice(index, index + pageSize));
  }

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");

  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  const totalPages = chunks.length || 1;
  const firstPageObjectId = 4;
  const firstContentObjectId = firstPageObjectId + totalPages;

  for (let index = 0; index < totalPages; index += 1) {
    pageObjectIds.push(firstPageObjectId + index);
    contentObjectIds.push(firstContentObjectId + index);
  }

  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${totalPages} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  chunks.forEach((chunk, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`
    );
  });

  chunks.forEach((chunk) => {
    const stream = [
      "BT",
      "/F1 12 Tf",
      "50 760 Td",
      ...chunk.flatMap((line, lineIndex) => (lineIndex === 0 ? [`(${pdfEscape(line)}) Tj`] : ["0 -18 Td", `(${pdfEscape(line)}) Tj`])),
      "ET"
    ].join("\n");

    objects.push(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
  });

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, "utf8");
}

function buildExportArtifactKey(userId: string, exportId: string) {
  return `exports/${userId}/${exportId}.pdf`;
}

async function persistExportArtifact(input: {
  userId: string;
  exportId: string;
  buffer: Buffer;
}) {
  const artifactKey = buildExportArtifactKey(input.userId, input.exportId);

  if (isObjectStorageConfigured()) {
    await putObjectBuffer({
      key: artifactKey,
      body: input.buffer,
      contentType: "application/pdf",
      metadata: {
        owneruserid: input.userId,
        exportid: input.exportId
      }
    });

    return artifactKey;
  }

  await mkdir(EXPORTS_DIR, { recursive: true });
  const fallbackArtifactKey = path.join("generated", "exports", `${input.exportId}.pdf`);
  const artifactPath = path.resolve(process.cwd(), fallbackArtifactKey);
  await writeFile(artifactPath, input.buffer);
  return fallbackArtifactKey;
}

async function loadExportArtifact(artifactKey: string) {
  if (!artifactKey.startsWith("generated")) {
    return getObjectBuffer(artifactKey);
  }

  const artifactPath = path.resolve(process.cwd(), artifactKey);
  return readFile(artifactPath);
}

export async function createTaxPackExport(userId: string, taxYear: number, requestId?: string) {
  const computeResult = await computeTaxYear(userId, taxYear, requestId);
  const exportJob = await prisma.exportJob.create({
    data: {
      userId,
      taxYear,
      status: "RUNNING"
    }
  });

  const lines = [
    `fiscalND tax pack - ${taxYear}`,
    `Generated at: ${new Date().toISOString()}`,
    `Run ID: ${computeResult.runId}`,
    `Estimate status: ${computeResult.estimateStatus}`,
    `Federal ruleset: ${computeResult.rulesets.federalVersion}`,
    `State ruleset: ${computeResult.rulesets.stateVersion}`,
    "",
    "Estimated taxes",
    `Federal tax: $${computeResult.breakdown.federalTax.toFixed(2)}`,
    `State tax: ${computeResult.breakdown.stateTax === null ? "BLOCKED/UNAVAILABLE" : `$${computeResult.breakdown.stateTax.toFixed(2)}`}`,
    `Total tax: ${computeResult.breakdown.totalTax === null ? "BLOCKED/UNAVAILABLE" : `$${computeResult.breakdown.totalTax.toFixed(2)}`}`,
    `Federal balance due: $${computeResult.breakdown.federalBalanceDue.toFixed(2)}`,
    `Total balance due: ${computeResult.breakdown.totalBalanceDue === null ? "BLOCKED/UNAVAILABLE" : `$${computeResult.breakdown.totalBalanceDue.toFixed(2)}`}`,
    `Monthly set-aside recommendation: $${computeResult.breakdown.monthlySetAsideRecommendation.toFixed(2)}`,
    `Quarterly estimate recommendation: $${computeResult.breakdown.quarterlyEstimatedPaymentRecommendation.toFixed(2)}`,
    "",
    "Data quality",
    `Completeness: ${computeResult.completeness.score}`,
    `Confidence: ${computeResult.confidence.score}`,
    "",
    "What to fix",
    ...(computeResult.completeness.actions.length > 0
      ? computeResult.completeness.actions.map((item) => `- ${item}`)
      : ["- No immediate completeness actions."]),
    "",
    "Risk flags",
    ...(computeResult.riskFlags.length > 0
      ? computeResult.riskFlags.map((flag) => `- ${flag.code}: ${flag.explanation}`)
      : ["- No active risk flags."]),
    "",
    "Assumptions",
    ...(computeResult.assumptions.length > 0
      ? computeResult.assumptions.map((assumption) => `- ${assumption.code}: ${assumption.description}`)
      : ["- No explicit assumptions."])
  ];

  if (computeResult.estimatedPaymentPlan.length > 0) {
    lines.push("", "Estimated payment schedule");
    for (const installment of computeResult.estimatedPaymentPlan) {
      lines.push(`- ${installment.dueDate}: $${installment.amount.toFixed(2)}`);
    }
  }

  const artifactKey = await persistExportArtifact({
    userId,
    exportId: exportJob.id,
    buffer: buildPdf(lines)
  });

  const completedJob = await prisma.exportJob.update({
    where: {
      id: exportJob.id
    },
    data: {
      status: "COMPLETED",
      artifactKey,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24)
    }
  });

  await writeAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    action: auditActions.EXPORT_REQUESTED,
    entityType: "ExportJob",
    entityId: completedJob.id,
    requestId,
    payload: {
      taxYear,
      runId: computeResult.runId
    }
  });

  return completedJob;
}

export async function getExportDownload(userId: string, exportId: string) {
  const exportJob = await prisma.exportJob.findFirst({
    where: {
      id: exportId,
      userId
    }
  });

  if (!exportJob?.artifactKey) {
    return null;
  }

  const buffer = await loadExportArtifact(exportJob.artifactKey);

  return {
    exportJob,
    fileName: `fiscalND-tax-pack-${exportJob.taxYear}.pdf`,
    contentType: "application/pdf",
    buffer
  };
}
