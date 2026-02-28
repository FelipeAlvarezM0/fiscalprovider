import { env } from "../config/env.js";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  headDocumentObject,
  isObjectStorageConfigured
} from "../infrastructure/s3.js";
import { prisma } from "../infrastructure/prisma.js";
import { createId } from "../shared/ids.js";
import { auditActions, writeAuditEvent } from "./audit-service.js";

function notFoundError(message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = 404;
  error.code = "NOT_FOUND";
  return error;
}

function validationError(message: string, details?: Record<string, unknown>): Error & { statusCode: number; code: string; details?: Record<string, unknown> } {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
    details?: Record<string, unknown>;
  };
  error.statusCode = 400;
  error.code = "VALIDATION_ERROR";
  error.details = details;
  return error;
}

function serviceUnavailableError(message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = 503;
  error.code = "SERVICE_UNAVAILABLE";
  return error;
}

function buildStorageKey(userId: string, fileName: string) {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `documents/${userId}/${createId()}-${sanitized}`;
}

export async function createUploadUrl(
  userId: string,
  input: { taxYear: number; fileName: string; mimeType: string; sizeBytes: number; checksum: string },
  requestId?: string
) {
  if (!isObjectStorageConfigured()) {
    throw serviceUnavailableError("Document storage is not configured.");
  }

  if (!env.DOCUMENT_ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    throw validationError("MIME type is not allowed for document uploads.", {
      mimeType: input.mimeType,
      allowedMimeTypes: env.DOCUMENT_ALLOWED_MIME_TYPES
    });
  }

  if (input.sizeBytes > env.DOCUMENT_MAX_SIZE_BYTES) {
    throw validationError("Document exceeds the allowed size limit.", {
      sizeBytes: input.sizeBytes,
      maxSizeBytes: env.DOCUMENT_MAX_SIZE_BYTES
    });
  }

  const storageKey = buildStorageKey(userId, input.fileName);
  const document = await prisma.document.create({
    data: {
      userId,
      taxYear: input.taxYear,
      storageKey,
      uploadChecksum: input.checksum,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "PENDING_UPLOAD"
    }
  });

  const uploadUrl = await createSignedUploadUrl({
    key: document.storageKey,
    mimeType: input.mimeType,
    checksum: input.checksum,
    userId
  });

  await writeAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    action: auditActions.DOCUMENT_UPLOAD_URL_CREATED,
    entityType: "Document",
    entityId: document.id,
    requestId
  });

  return {
    documentId: document.id,
    uploadUrl,
    expiresInSeconds: env.S3_SIGNED_UPLOAD_TTL_SECONDS
  };
}

export async function confirmUpload(userId: string, input: { documentId: string }, requestId?: string) {
  if (!isObjectStorageConfigured()) {
    throw serviceUnavailableError("Document storage is not configured.");
  }

  const existing = await prisma.document.findFirst({
    where: {
      id: input.documentId,
      userId
    }
  });

  if (!existing) {
    throw notFoundError("Document not found.");
  }

  const objectHead = await headDocumentObject(existing.storageKey).catch(() => null);
  if (!objectHead) {
    throw validationError("Uploaded object was not found in storage.", {
      documentId: existing.id
    });
  }

  const ownerUserId = objectHead.Metadata?.owneruserid;
  const uploadChecksum = objectHead.Metadata?.uploadchecksum;
  const contentType = objectHead.ContentType ?? null;
  const contentLength = objectHead.ContentLength ?? 0;

  if (ownerUserId !== userId) {
    throw validationError("Uploaded object owner metadata does not match the authenticated user.", {
      documentId: existing.id
    });
  }

  if (uploadChecksum !== existing.uploadChecksum) {
    throw validationError("Uploaded object checksum metadata does not match the expected document checksum.", {
      documentId: existing.id
    });
  }

  if (contentType !== existing.mimeType) {
    throw validationError("Uploaded object MIME type does not match the expected document MIME type.", {
      documentId: existing.id
    });
  }

  if (contentLength > existing.sizeBytes || contentLength > env.DOCUMENT_MAX_SIZE_BYTES) {
    throw validationError("Uploaded object exceeds the expected size constraints.", {
      documentId: existing.id,
      contentLength,
      expectedSizeBytes: existing.sizeBytes
    });
  }

  const document = await prisma.document.update({
    where: {
      id: existing.id
    },
    data: {
      status: "AVAILABLE",
      uploadConfirmedAt: new Date()
    }
  });

  await writeAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    action: auditActions.DOCUMENT_UPLOAD_CONFIRMED,
    entityType: "Document",
    entityId: document.id,
    requestId
  });

  return document;
}

export async function listDocuments(userId: string) {
  return prisma.document.findMany({
    where: {
      userId
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function getDocument(userId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      userId
    }
  });

  if (!document) {
    return null;
  }

  const downloadUrl =
    document.status === "AVAILABLE" && isObjectStorageConfigured()
      ? await createSignedDownloadUrl(document.storageKey)
      : null;

  return {
    ...document,
    downloadUrl,
    downloadUrlExpiresInSeconds: downloadUrl ? env.S3_SIGNED_DOWNLOAD_TTL_SECONDS : null
  };
}
