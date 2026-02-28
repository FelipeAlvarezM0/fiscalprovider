import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { Prisma } from "@prisma/client";
import Fastify from "fastify";
import { ZodError } from "zod";

import { getUserId, requireAuth } from "./api/auth.js";
import { clearIdempotentProcessing, persistIdempotentResponse, requireIdempotencyKey } from "./api/idempotency.js";
import { buildOpenApiDocument } from "./api/openapi.js";
import {
  bankCsvImportSchema,
  confirmCategorySchema,
  confirmUploadSchema,
  incomeSchema,
  linkDocumentSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  taxProfileSchema,
  transactionListQuerySchema,
  transactionSchema,
  uploadUrlSchema,
  yearQuerySchema
} from "./api/schemas.js";
import { env } from "./config/env.js";
import { prisma } from "./infrastructure/prisma.js";
import { auditActions, writeAuditEvent } from "./services/audit-service.js";
import { enableMfa, loginUser, refreshSession, registerUser, verifyMfa } from "./services/auth-service.js";
import { confirmUpload, createUploadUrl, getDocument, listDocuments } from "./services/document-service.js";
import { createTaxPackExport, getExportDownload } from "./services/export-service.js";
import { importBankCsv } from "./services/import-service.js";
import {
  computeTaxYear,
  getAssumptions,
  getCompleteness,
  getConfidence,
  getRiskFlags,
  getTaxExplain,
  getTaxSummary,
  listLowConfidenceTransactions,
  listUncategorizedTransactions
} from "./services/tax-service.js";

function decimal(value: number | undefined) {
  return value === undefined ? undefined : new Prisma.Decimal(value);
}

function asJson(value: Record<string, unknown> | undefined) {
  return value as Prisma.InputJsonValue | undefined;
}

async function requireOwnedDocument(app: any, userId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      userId
    }
  });

  if (!document) {
    throw app.httpErrors.notFound("Document not found.");
  }

  return document;
}

async function requireOwnedIncome(app: any, userId: string, incomeId: string) {
  const income = await prisma.incomeSource.findFirst({
    where: {
      id: incomeId,
      userId
    }
  });

  if (!income) {
    throw app.httpErrors.notFound("Income source not found.");
  }

  return income;
}

async function requireOwnedTransaction(app: any, userId: string, transactionId: string) {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      userId
    }
  });

  if (!transaction) {
    throw app.httpErrors.notFound("Transaction not found.");
  }

  return transaction;
}

export async function buildApp() {
  const apiPrefix = "/v1";
  const app = Fastify({
    logger: true,
    disableRequestLogging: false
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: env.CORS_ORIGINS.includes("*") ? true : env.CORS_ORIGINS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    credentials: false
  });
  await app.register(fastifyRateLimit, {
    max: 200,
    timeWindow: "1 minute"
  });
  await app.register(fastifyMultipart);
  await app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET
  });

  app.setErrorHandler(async (error: any, request, reply) => {
    const statusCode =
      error instanceof ZodError
        ? 400
        : typeof (error as any).statusCode === "number"
          ? (error as any).statusCode
          : 500;

    if ((request as any).idempotency?.key) {
      await clearIdempotentProcessing(request as any);
    }

    return reply.code(statusCode).send({
      code:
        error instanceof ZodError
          ? "VALIDATION_ERROR"
          : ((error as any).code ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR")),
      message: error.message,
      details:
        error instanceof ZodError
          ? error.flatten()
          : ((error as any).details ?? null),
      requestId: request.id
    });
  });

  app.addHook("onSend", persistIdempotentResponse);

  app.get("/health", async () => ({
    ok: true
  }));

  app.get("/openapi.json", async () => buildOpenApiDocument());

  app.get(`${apiPrefix}/health`, async () => ({
    ok: true,
    version: "v1"
  }));

  app.post(`${apiPrefix}/auth/register`, async (request) => {
    const body = registerSchema.parse(request.body);
    return registerUser(app, body, {
      requestId: request.id,
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
      deviceLabel: body.deviceLabel
    });
  });

  app.post(`${apiPrefix}/auth/login`, async (request) => {
    const body = loginSchema.parse(request.body);
    return loginUser(app, body, {
      requestId: request.id,
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
      deviceLabel: body.deviceLabel
    });
  });

  app.post(`${apiPrefix}/auth/refresh`, async (request) => {
    const body = refreshSchema.parse(request.body);
    return refreshSession(app, body, {
      requestId: request.id
    });
  });

  app.post(`${apiPrefix}/auth/mfa/enable`, { preHandler: requireAuth }, async () => enableMfa(app));
  app.post(`${apiPrefix}/auth/mfa/verify`, { preHandler: requireAuth }, async () => verifyMfa(app));

  app.get(`${apiPrefix}/tax/profile`, { preHandler: requireAuth }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    return prisma.taxYearProfile.findUnique({
      where: {
        userId_taxYear: {
          userId: getUserId(request),
          taxYear: year
        }
      }
    });
  });

  app.put(`${apiPrefix}/tax/profile`, { preHandler: requireAuth }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    const body = taxProfileSchema.parse(request.body);
    const userId = getUserId(request);

    const profile = await prisma.taxYearProfile.upsert({
      where: {
        userId_taxYear: {
          userId,
          taxYear: year
        }
      },
      update: {
        ...body
      },
      create: {
        userId,
        taxYear: year,
        ...body
      }
    });

    await writeAuditEvent({
      userId,
      actorType: "USER",
      actorId: userId,
      action: auditActions.TAX_PROFILE_UPSERT,
      entityType: "TaxYearProfile",
      entityId: profile.id,
      requestId: request.id,
      payload: {
        taxYear: year
      }
    });

    return profile;
  });

  app.post(`${apiPrefix}/incomes`, { preHandler: [requireAuth, requireIdempotencyKey] }, async (request) => {
    const body = incomeSchema.parse(request.body);
    const userId = getUserId(request);

    if (body.sourceDocumentId) {
      await requireOwnedDocument(app, userId, body.sourceDocumentId);
    }

    const income = await prisma.incomeSource.create({
      data: {
        userId,
        taxYear: body.taxYear,
        type: body.type,
        label: body.label,
        payerName: body.payerName ?? null,
        amount: new Prisma.Decimal(body.amount),
        taxWithheldFederal: decimal(body.taxWithheldFederal),
        taxWithheldState: decimal(body.taxWithheldState),
        taxWithheldLocal: decimal(body.taxWithheldLocal),
        taxWithheldMedicare: decimal(body.taxWithheldMedicare),
        taxWithheldSocialSecurity: decimal(body.taxWithheldSocialSecurity),
        isConfirmed: body.isConfirmed,
        sourceDocumentId: body.sourceDocumentId ?? null,
        metadataJson: asJson(body.metadataJson)
      } as Prisma.IncomeSourceUncheckedCreateInput
    });

    await writeAuditEvent({
      userId,
      actorType: "USER",
      actorId: userId,
      action: auditActions.INCOME_CREATED,
      entityType: "IncomeSource",
      entityId: income.id,
      requestId: request.id
    });

    return income;
  });

  app.get(`${apiPrefix}/incomes`, { preHandler: requireAuth }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    return prisma.incomeSource.findMany({
      where: {
        userId: getUserId(request),
        taxYear: year
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  });

  app.put(`${apiPrefix}/incomes/:id`, { preHandler: requireAuth }, async (request) => {
    const body = incomeSchema.partial().parse(request.body);
    const userId = getUserId(request);
    const income = await requireOwnedIncome(app, userId, (request.params as { id: string }).id);

    if (body.sourceDocumentId) {
      await requireOwnedDocument(app, userId, body.sourceDocumentId);
    }

    return prisma.incomeSource.update({
      where: {
        id: income.id
      },
      data: {
        ...(body.label ? { label: body.label } : {}),
        ...(body.payerName !== undefined ? { payerName: body.payerName ?? null } : {}),
        ...(body.amount !== undefined ? { amount: new Prisma.Decimal(body.amount) } : {}),
        ...(body.taxWithheldFederal !== undefined ? { taxWithheldFederal: decimal(body.taxWithheldFederal) } : {}),
        ...(body.taxWithheldState !== undefined ? { taxWithheldState: decimal(body.taxWithheldState) } : {}),
        ...(body.taxWithheldLocal !== undefined ? { taxWithheldLocal: decimal(body.taxWithheldLocal) } : {}),
        ...(body.taxWithheldMedicare !== undefined ? { taxWithheldMedicare: decimal(body.taxWithheldMedicare) } : {}),
        ...(body.taxWithheldSocialSecurity !== undefined
          ? { taxWithheldSocialSecurity: decimal(body.taxWithheldSocialSecurity) }
          : {}),
        ...(body.isConfirmed !== undefined ? { isConfirmed: body.isConfirmed } : {}),
        ...(body.sourceDocumentId !== undefined ? { sourceDocumentId: body.sourceDocumentId ?? null } : {}),
        ...(body.metadataJson !== undefined ? { metadataJson: asJson(body.metadataJson) } : {})
      } as Prisma.IncomeSourceUncheckedUpdateInput
    });
  });

  app.post(`${apiPrefix}/transactions`, { preHandler: [requireAuth, requireIdempotencyKey] }, async (request) => {
    const body = transactionSchema.parse(request.body);
    const userId = getUserId(request);

    if (body.documentId) {
      await requireOwnedDocument(app, userId, body.documentId);
    }

    return prisma.transaction.create({
      data: {
        userId,
        taxYear: body.taxYear,
        date: new Date(body.date),
        amount: new Prisma.Decimal(body.amount),
        merchant: body.merchant ?? null,
        description: body.description,
        direction: body.direction,
        categoryCode: body.categoryCode ?? null,
        categoryConfidence:
          body.categoryConfidence === null || body.categoryConfidence === undefined
            ? null
            : new Prisma.Decimal(body.categoryConfidence),
        categoryReason: body.categoryReason ?? null,
        categorySource: body.categorySource ?? "MANUAL",
        documentId: body.documentId ?? null,
        metadataJson: asJson(body.metadataJson)
      }
    });
  });

  app.get(`${apiPrefix}/transactions`, { preHandler: requireAuth }, async (request) => {
    const query = transactionListQuerySchema.parse(request.query);
    const where = {
      userId: getUserId(request),
      taxYear: query.year,
      ...(query.category ? { categoryCode: query.category } : {}),
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {})
    };

    const [totalCount, items] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: {
          date: "desc"
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      })
    ]);

    return {
      page: query.page,
      pageSize: query.pageSize,
      totalCount,
      items
    };
  });

  app.put(`${apiPrefix}/transactions/:id`, { preHandler: requireAuth }, async (request) => {
    const body = transactionSchema.partial().parse(request.body);
    const userId = getUserId(request);
    const transaction = await requireOwnedTransaction(app, userId, (request.params as { id: string }).id);

    if (body.documentId) {
      await requireOwnedDocument(app, userId, body.documentId);
    }

    return prisma.transaction.update({
      where: {
        id: transaction.id
      },
      data: {
        ...(body.date ? { date: new Date(body.date) } : {}),
        ...(body.amount !== undefined ? { amount: new Prisma.Decimal(body.amount) } : {}),
        ...(body.merchant !== undefined ? { merchant: body.merchant ?? null } : {}),
        ...(body.description ? { description: body.description } : {}),
        ...(body.direction ? { direction: body.direction } : {}),
        ...(body.categoryCode !== undefined ? { categoryCode: body.categoryCode ?? null } : {}),
        ...(body.categoryConfidence !== undefined
          ? {
              categoryConfidence:
                body.categoryConfidence === null ? null : new Prisma.Decimal(body.categoryConfidence)
            }
          : {}),
        ...(body.categoryReason !== undefined ? { categoryReason: body.categoryReason ?? null } : {}),
        ...(body.categorySource ? { categorySource: body.categorySource } : {}),
        ...(body.documentId !== undefined ? { documentId: body.documentId ?? null } : {}),
        ...(body.metadataJson !== undefined ? { metadataJson: asJson(body.metadataJson) } : {}),
        isReviewed: true
      } as Prisma.TransactionUncheckedUpdateInput
    });
  });

  app.post(`${apiPrefix}/transactions/:id/link-document`, { preHandler: requireAuth }, async (request) => {
    const body = linkDocumentSchema.parse(request.body);
    const userId = getUserId(request);
    const transaction = await requireOwnedTransaction(app, userId, (request.params as { id: string }).id);
    await requireOwnedDocument(app, userId, body.documentId);

    return prisma.transaction.update({
      where: {
        id: transaction.id
      },
      data: {
        documentId: body.documentId,
        isReviewed: true
      }
    });
  });

  app.post(`${apiPrefix}/documents/upload-url`, { preHandler: requireAuth }, async (request) => {
    const body = uploadUrlSchema.parse(request.body);
    return createUploadUrl(getUserId(request), body, request.id);
  });

  app.post(`${apiPrefix}/documents/confirm`, { preHandler: [requireAuth, requireIdempotencyKey] }, async (request) => {
    const body = confirmUploadSchema.parse(request.body);
    return confirmUpload(getUserId(request), body, request.id);
  });

  app.get(`${apiPrefix}/documents`, { preHandler: requireAuth }, async (request) => listDocuments(getUserId(request)));
  app.get(`${apiPrefix}/documents/:id`, { preHandler: requireAuth }, async (request) =>
    getDocument(getUserId(request), (request.params as { id: string }).id)
  );

  app.post(`${apiPrefix}/imports/bank-csv`, { preHandler: [requireAuth, requireIdempotencyKey] }, async (request) => {
    const body = bankCsvImportSchema.parse(request.body);
    return importBankCsv(getUserId(request), body, request.id);
  });

  app.get(`${apiPrefix}/review/low-confidence`, { preHandler: requireAuth }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    return listLowConfidenceTransactions(getUserId(request), year);
  });

  app.get(`${apiPrefix}/review/uncategorized`, { preHandler: requireAuth }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    return listUncategorizedTransactions(getUserId(request), year);
  });

  app.post(`${apiPrefix}/review/confirm-category`, { preHandler: requireAuth }, async (request) => {
    const body = confirmCategorySchema.parse(request.body);
    const userId = getUserId(request);
    const ownedTransaction = await requireOwnedTransaction(app, userId, body.transactionId);

    const transaction = await prisma.transaction.update({
      where: {
        id: ownedTransaction.id
      },
      data: {
        categoryCode: body.categoryCode,
        categorySource: "USER",
        categoryConfidence: new Prisma.Decimal(100),
        isReviewed: true
      }
    });

    if (body.createOverride && transaction.merchant) {
      await prisma.userOverride.create({
        data: {
          userId,
          vendorPattern: transaction.merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          categoryOverride: body.categoryCode
        }
      });
    }

    return transaction;
  });

  app.post(`${apiPrefix}/tax/compute`, { preHandler: [requireAuth, requireIdempotencyKey] }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    return computeTaxYear(getUserId(request), year, request.id);
  });

  app.get(`${apiPrefix}/tax/summary`, { preHandler: requireAuth }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    return getTaxSummary(getUserId(request), year);
  });

  app.get(`${apiPrefix}/tax/explain`, { preHandler: requireAuth }, async (request) => {
    const query = request.query as { runId?: string };
    if (!query.runId) {
      throw app.httpErrors.badRequest("runId is required.");
    }

    return getTaxExplain(query.runId, getUserId(request));
  });

  app.get(`${apiPrefix}/tax/completeness`, { preHandler: requireAuth }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    return getCompleteness(getUserId(request), year);
  });

  app.get(`${apiPrefix}/tax/confidence`, { preHandler: requireAuth }, async (request) => {
    const query = request.query as { runId?: string };
    if (!query.runId) {
      throw app.httpErrors.badRequest("runId is required.");
    }

    return getConfidence(query.runId, getUserId(request));
  });

  app.get(`${apiPrefix}/tax/risk-flags`, { preHandler: requireAuth }, async (request) => {
    const query = request.query as { runId?: string };
    if (!query.runId) {
      throw app.httpErrors.badRequest("runId is required.");
    }

    return getRiskFlags(query.runId, getUserId(request));
  });

  app.get(`${apiPrefix}/tax/assumptions`, { preHandler: requireAuth }, async (request) => {
    const query = request.query as { runId?: string };
    if (!query.runId) {
      throw app.httpErrors.badRequest("runId is required.");
    }

    return getAssumptions(query.runId, getUserId(request));
  });

  app.post(`${apiPrefix}/exports/tax-pack`, { preHandler: requireAuth }, async (request) => {
    const { year } = yearQuerySchema.parse(request.query);
    return createTaxPackExport(getUserId(request), year, request.id);
  });

  app.get(`${apiPrefix}/exports/:id/download`, { preHandler: requireAuth }, async (request, reply) => {
    const result = await getExportDownload(getUserId(request), (request.params as { id: string }).id);
    if (!result) {
      throw app.httpErrors.notFound("Export artifact not found.");
    }

    reply.header("content-type", result.contentType);
    reply.header("content-disposition", `attachment; filename="${result.fileName}"`);
    return reply.send(result.buffer);
  });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
