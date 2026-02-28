import { Prisma } from "@prisma/client";

import { prisma } from "../infrastructure/prisma.js";
import { sha256 } from "../shared/hash.js";

const IDEMPOTENCY_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const prismaUnsafe = prisma as any;

function buildRoute(request: any): string {
  return request.routeOptions?.url ?? request.routerPath ?? String(request.url).split("?")[0];
}

function buildRequestHash(request: any): string {
  return sha256(JSON.stringify(request.body ?? null));
}

export async function requireIdempotencyKey(request: any, reply: any) {
  const userId = request.user?.sub;
  const headerValue = request.headers["idempotency-key"];

  if (!userId) {
    return reply.code(401).send({
      code: "AUTH_REQUIRED",
      message: "Authentication is required before idempotency can be enforced.",
      details: null,
      requestId: request.id
    });
  }

  if (!headerValue || typeof headerValue !== "string" || headerValue.trim().length < 8) {
    return reply.code(400).send({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required for this endpoint.",
      details: {
        ttlHours: IDEMPOTENCY_TTL_MS / (1000 * 60 * 60)
      },
      requestId: request.id
    });
  }

  const route = buildRoute(request);
  const requestHash = buildRequestHash(request);
  const idempotencyKey = headerValue.trim();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

  const existing = await prismaUnsafe.idempotencyRecord.findUnique({
    where: {
      userId_method_route_idempotencyKey: {
        userId,
        method: request.method,
        route,
        idempotencyKey
      }
    }
  });

  if (existing && existing.expiresAt <= now) {
    await prismaUnsafe.idempotencyRecord.delete({
      where: {
        id: existing.id
      }
    });
  }

  const active = existing && existing.expiresAt > now ? existing : null;

  if (active) {
    if (active.payloadHash !== requestHash) {
      return reply.code(409).send({
        code: "IDEMPOTENCY_CONFLICT",
        message: "The same Idempotency-Key cannot be reused with a different payload.",
        details: {
          idempotencyKey,
          status: active.status
        },
        requestId: request.id
      });
    }

    if (active.status === "COMPLETED") {
      return reply.code(active.responseCode ?? 200).send(active.responseJson);
    }

    return reply.code(202).send({
      code: "IDEMPOTENCY_IN_FLIGHT",
      message: "A request with the same Idempotency-Key is still processing. Retry safely or poll using requestId.",
      details: {
        idempotencyKey,
        status: active.status
      },
      requestId: request.id
    });
  }

  const created = await prismaUnsafe.idempotencyRecord.create({
    data: {
      userId,
      method: request.method,
      route,
      idempotencyKey,
      payloadHash: requestHash,
      status: "PROCESSING",
      expiresAt
    }
  });

  request.idempotency = {
    recordId: created.id,
    route,
    requestHash
  };
}

export async function persistIdempotentResponse(request: any, reply: any, payload: unknown) {
  if (!request.idempotency?.recordId || reply.statusCode >= 400) {
    return payload;
  }

  await prismaUnsafe.idempotencyRecord.update({
    where: {
      id: request.idempotency.recordId
    },
    data: {
      status: "COMPLETED",
      responseCode: reply.statusCode,
      responseJson: payload as Prisma.InputJsonValue
    }
  });

  return payload;
}

export async function clearIdempotentProcessing(request: any) {
  if (!request.idempotency?.recordId) {
    return;
  }

  await prismaUnsafe.idempotencyRecord.updateMany({
    where: {
      id: request.idempotency.recordId,
      status: "PROCESSING"
    },
    data: {
      status: "FAILED"
    }
  });
}
