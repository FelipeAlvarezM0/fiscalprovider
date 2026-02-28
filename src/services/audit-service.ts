import { Prisma } from "@prisma/client";

import { prisma } from "../infrastructure/prisma.js";

export const auditActions = {
  AUTH_REGISTER: "AUTH_REGISTER",
  AUTH_LOGIN: "AUTH_LOGIN",
  AUTH_REFRESH: "AUTH_REFRESH",
  TAX_PROFILE_UPSERT: "TAX_PROFILE_UPSERT",
  INCOME_CREATED: "INCOME_CREATED",
  DOCUMENT_UPLOAD_URL_CREATED: "DOCUMENT_UPLOAD_URL_CREATED",
  DOCUMENT_UPLOAD_CONFIRMED: "DOCUMENT_UPLOAD_CONFIRMED",
  IMPORT_BANK_CSV_STARTED: "IMPORT_BANK_CSV_STARTED",
  IMPORT_BANK_CSV_COMPLETED: "IMPORT_BANK_CSV_COMPLETED",
  TAX_COMPUTE: "TAX_COMPUTE",
  EXPORT_REQUESTED: "EXPORT_REQUESTED"
} as const;

export type AuditAction = (typeof auditActions)[keyof typeof auditActions];

interface AuditInput {
  userId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown>;
}

export async function writeAuditEvent(input: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      userId: input.userId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      requestId: input.requestId ?? null,
      payloadJson: (input.payload ?? Prisma.JsonNull) as Prisma.InputJsonValue
    }
  });
}
