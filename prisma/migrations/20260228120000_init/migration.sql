-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FilingStatus" AS ENUM ('SINGLE', 'MARRIED_FILING_JOINTLY', 'MARRIED_FILING_SEPARATELY', 'HEAD_OF_HOUSEHOLD', 'QUALIFYING_SURVIVING_SPOUSE');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('W2', 'FORM_1099_MISC', 'FORM_1099_NEC', 'BUSINESS_GROSS', 'OTHER_TAXABLE');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('RULE', 'HEURISTIC', 'ML', 'USER', 'MANUAL');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_UPLOAD', 'AVAILABLE', 'PROCESSING', 'EXTRACTED', 'FAILED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ScopeStatus" AS ENUM ('IN_SCOPE', 'PARTIAL', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "SalesTaxFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ESTIMATED_QUARTERLY', 'EXTENSION', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxYearProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "filingStatus" "FilingStatus",
    "dependentsCount" INTEGER NOT NULL DEFAULT 0,
    "residentState" TEXT NOT NULL DEFAULT 'ND',
    "residentCity" TEXT,
    "residentZip" TEXT,
    "county" TEXT,
    "isFullYearResident" BOOLEAN NOT NULL DEFAULT true,
    "hasNdSalesTaxNexus" BOOLEAN NOT NULL DEFAULT false,
    "salesTaxFilingFrequency" "SalesTaxFilingFrequency",
    "standardDeductionForced" BOOLEAN,
    "itemizedDeductionAmount" DECIMAL(12,2),
    "hasForeignIncome" BOOLEAN NOT NULL DEFAULT false,
    "hasK1" BOOLEAN NOT NULL DEFAULT false,
    "hasAdvancedInvestments" BOOLEAN NOT NULL DEFAULT false,
    "hasAdvancedDepreciation" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxYearProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "type" "IncomeType" NOT NULL,
    "label" TEXT NOT NULL,
    "payerName" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxWithheldFederal" DECIMAL(12,2),
    "taxWithheldState" DECIMAL(12,2),
    "taxWithheldLocal" DECIMAL(12,2),
    "taxWithheldMedicare" DECIMAL(12,2),
    "taxWithheldSocialSecurity" DECIMAL(12,2),
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "sourceDocumentId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadChecksum" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "extractedJson" JSONB,
    "extractedAt" TIMESTAMP(3),
    "extractedConfidence" DECIMAL(5,2),
    "uploadConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "merchant" TEXT,
    "description" TEXT NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "categoryCode" TEXT,
    "categoryConfidence" DECIMAL(5,2),
    "categoryReason" TEXT,
    "categorySource" "CategorySource" NOT NULL DEFAULT 'MANUAL',
    "documentId" TEXT,
    "importBatchId" TEXT,
    "fingerprintId" TEXT,
    "isReviewed" BOOLEAN NOT NULL DEFAULT false,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeductionItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "sourceTransactionId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeductionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "runStatus" "JobStatus" NOT NULL DEFAULT 'COMPLETED',
    "scopeStatus" "ScopeStatus" NOT NULL,
    "rulesetFederalVersion" TEXT NOT NULL,
    "rulesetStateVersion" TEXT NOT NULL,
    "totalsJson" JSONB NOT NULL,
    "explanationJson" JSONB NOT NULL,
    "inputsSnapshotJson" JSONB NOT NULL,
    "completenessScore" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "requestId" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCategory" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deductible" BOOLEAN NOT NULL DEFAULT false,
    "supported" BOOLEAN NOT NULL DEFAULT true,
    "limitConfigJson" JSONB,
    "formTargetsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCategory_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CategoryMappingRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vendorPattern" TEXT,
    "keywordPattern" TEXT,
    "amountMin" DECIMAL(12,2),
    "amountMax" DECIMAL(12,2),
    "confidenceBase" DECIMAL(5,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputationAssumption" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "impactLevel" "Severity" NOT NULL,
    "userActionNeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputationAssumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletenessReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "missingItemsJson" JSONB NOT NULL,
    "gapsJson" JSONB NOT NULL,
    "actionsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompletenessReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidenceReport" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "driversJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfidenceReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'PENDING',
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimatedPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'ESTIMATED_QUARTERLY',
    "quarter" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimatedPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionFingerprint" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorPattern" TEXT,
    "keywordPattern" TEXT,
    "categoryOverride" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "suggestedFix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "artifactKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "responseCode" INTEGER,
    "responseJson" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "DeviceSession_userId_expiresAt_idx" ON "DeviceSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "TaxYearProfile_taxYear_idx" ON "TaxYearProfile"("taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "TaxYearProfile_userId_taxYear_key" ON "TaxYearProfile"("userId", "taxYear");

-- CreateIndex
CREATE INDEX "IncomeSource_userId_taxYear_idx" ON "IncomeSource"("userId", "taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_userId_taxYear_status_idx" ON "Document"("userId", "taxYear", "status");

-- CreateIndex
CREATE INDEX "Transaction_userId_taxYear_date_idx" ON "Transaction"("userId", "taxYear", "date");

-- CreateIndex
CREATE INDEX "Transaction_userId_taxYear_categoryCode_idx" ON "Transaction"("userId", "taxYear", "categoryCode");

-- CreateIndex
CREATE INDEX "DeductionItem_userId_taxYear_code_idx" ON "DeductionItem"("userId", "taxYear", "code");

-- CreateIndex
CREATE INDEX "ComputationRun_userId_taxYear_createdAt_idx" ON "ComputationRun"("userId", "taxYear", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ComputationAssumption_runId_idx" ON "ComputationAssumption"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "CompletenessReport_userId_taxYear_key" ON "CompletenessReport"("userId", "taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "ConfidenceReport_runId_key" ON "ConfidenceReport"("runId");

-- CreateIndex
CREATE INDEX "ImportBatch_userId_taxYear_createdAt_idx" ON "ImportBatch"("userId", "taxYear", "createdAt");

-- CreateIndex
CREATE INDEX "EstimatedPayment_userId_taxYear_paidAt_idx" ON "EstimatedPayment"("userId", "taxYear", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionFingerprint_fingerprint_key" ON "TransactionFingerprint"("fingerprint");

-- CreateIndex
CREATE INDEX "UserOverride_userId_categoryOverride_idx" ON "UserOverride"("userId", "categoryOverride");

-- CreateIndex
CREATE INDEX "RiskFlag_runId_severity_idx" ON "RiskFlag"("runId", "severity");

-- CreateIndex
CREATE INDEX "ExportJob_userId_taxYear_status_idx" ON "ExportJob"("userId", "taxYear", "status");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_status_idx" ON "IdempotencyRecord"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_method_route_idempotencyKey_key" ON "IdempotencyRecord"("userId", "method", "route", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "DeviceSession" ADD CONSTRAINT "DeviceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxYearProfile" ADD CONSTRAINT "TaxYearProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeSource" ADD CONSTRAINT "IncomeSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeSource" ADD CONSTRAINT "IncomeSource_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fingerprintId_fkey" FOREIGN KEY ("fingerprintId") REFERENCES "TransactionFingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionItem" ADD CONSTRAINT "DeductionItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputationRun" ADD CONSTRAINT "ComputationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputationAssumption" ADD CONSTRAINT "ComputationAssumption_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ComputationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletenessReport" ADD CONSTRAINT "CompletenessReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidenceReport" ADD CONSTRAINT "ConfidenceReport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ComputationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimatedPayment" ADD CONSTRAINT "EstimatedPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOverride" ADD CONSTRAINT "UserOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ComputationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
