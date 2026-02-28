import net from "node:net";

import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { prisma } from "../src/infrastructure/prisma.js";

async function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

const dbAvailable = await canConnect("127.0.0.1", 5432);

describe.skipIf(!dbAvailable)("http integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await prisma.$connect();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "ConfidenceReport",
        "CompletenessReport",
        "ComputationAssumption",
        "RiskFlag",
        "ComputationRun",
        "Transaction",
        "TransactionFingerprint",
        "ImportBatch",
        "IncomeSource",
        "DeductionItem",
        "TaxYearProfile",
        "UserOverride",
        "EstimatedPayment",
        "ExportJob",
        "Document",
        "IdempotencyRecord",
        "DeviceSession",
        "AuditEvent",
        "User"
      RESTART IDENTITY CASCADE
    `);
  });

  async function registerAndAuth(email: string) {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email,
        password: "supersecret123",
        displayName: "Integration Test User"
      }
    });

    expect(registerResponse.statusCode).toBe(200);
    const body = registerResponse.json();
    return {
      userId: body.user.id as string,
      accessToken: body.accessToken as string
    };
  }

  it("imports bank CSV transactions end-to-end with dedupe and transaction listing", async () => {
    const { accessToken } = await registerAndAuth("imports@example.com");

    const profileResponse = await app.inject({
      method: "PUT",
      url: "/v1/tax/profile?year=2026",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        filingStatus: "SINGLE",
        residentState: "ND",
        isFullYearResident: true
      }
    });

    expect(profileResponse.statusCode).toBe(200);

    const csvContent = [
      "Date,Description,Amount",
      "2026-01-05,Coffee Shop,-12.50",
      "2026-01-07,Client Payment,1500.00",
      "2026-01-07,Client Payment,1500.00"
    ].join("\n");

    const importResponse = await app.inject({
      method: "POST",
      url: "/v1/imports/bank-csv",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "import-batch-001"
      },
      payload: {
        taxYear: 2026,
        csvContent
      }
    });

    expect(importResponse.statusCode).toBe(200);
    const importBody = importResponse.json();
    expect(importBody.createdCount).toBe(2);
    expect(importBody.duplicateCount).toBe(1);
    expect(importBody.batchId).toBeTruthy();

    const transactionsResponse = await app.inject({
      method: "GET",
      url: "/v1/transactions?year=2026&page=1&pageSize=10",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(transactionsResponse.statusCode).toBe(200);
    const transactionsBody = transactionsResponse.json();
    expect(transactionsBody.totalCount).toBe(2);
    expect(transactionsBody.items[0].description).toBeTruthy();
  });

  it("generates and downloads a tax pack pdf end-to-end", async () => {
    const { accessToken } = await registerAndAuth("exports@example.com");

    const profileResponse = await app.inject({
      method: "PUT",
      url: "/v1/tax/profile?year=2026",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        filingStatus: "SINGLE",
        residentState: "ND",
        isFullYearResident: true
      }
    });

    expect(profileResponse.statusCode).toBe(200);

    const incomeResponse = await app.inject({
      method: "POST",
      url: "/v1/incomes",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "income-export-001"
      },
      payload: {
        taxYear: 2026,
        type: "W2",
        label: "Employer W-2",
        amount: 90000,
        isConfirmed: true,
        taxWithheldFederal: 9500
      }
    });

    expect(incomeResponse.statusCode).toBe(200);

    const exportResponse = await app.inject({
      method: "POST",
      url: "/v1/exports/tax-pack?year=2026",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(exportResponse.statusCode).toBe(200);
    const exportBody = exportResponse.json();
    expect(exportBody.status).toBe("COMPLETED");
    expect(exportBody.artifactKey).toMatch(/\.pdf$/);

    const downloadResponse = await app.inject({
      method: "GET",
      url: `/v1/exports/${exportBody.id}/download`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers["content-type"]).toContain("application/pdf");
    expect(downloadResponse.headers["content-disposition"]).toContain(".pdf");
    expect(downloadResponse.body.startsWith("%PDF")).toBe(true);
  });
});
