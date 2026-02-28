import { randomBytes } from "node:crypto";

import { prisma } from "../infrastructure/prisma.js";
import { hashPassword, sha256, verifyPassword } from "../shared/hash.js";
import { auditActions, writeAuditEvent } from "./audit-service.js";

function newRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

async function createSession(userId: string, refreshToken: string, deviceLabel?: string, userAgent?: string, ipAddress?: string) {
  const ttlMs = 1000 * 60 * 60 * 24 * 30;
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.deviceSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      deviceLabel: deviceLabel ?? null,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt
    }
  });

  return expiresAt;
}

async function issueAccessToken(app: any, userId: string, email: string): Promise<string> {
  return app.jwt.sign(
    {
      sub: userId,
      email
    },
    {
      expiresIn: "15m"
    }
  );
}

export async function registerUser(
  app: any,
  input: { email: string; password: string; displayName?: string },
  context: { requestId?: string; userAgent?: string; ipAddress?: string; deviceLabel?: string }
) {
  const existing = await prisma.user.findUnique({
    where: {
      email: input.email.toLowerCase()
    }
  });

  if (existing) {
    throw app.httpErrors.conflict("Email already registered.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash,
      displayName: input.displayName ?? null
    }
  });

  const refreshToken = newRefreshToken();
  const expiresAt = await createSession(
    user.id,
    refreshToken,
    context.deviceLabel,
    context.userAgent,
    context.ipAddress
  );
  const accessToken = await issueAccessToken(app, user.id, user.email);

  await writeAuditEvent({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: auditActions.AUTH_REGISTER,
    entityType: "User",
    entityId: user.id,
    requestId: context.requestId
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName
    },
    accessToken,
    refreshToken,
    refreshExpiresAt: expiresAt.toISOString()
  };
}

export async function loginUser(
  app: any,
  input: { email: string; password: string },
  context: { requestId?: string; userAgent?: string; ipAddress?: string; deviceLabel?: string }
) {
  const user = await prisma.user.findUnique({
    where: {
      email: input.email.toLowerCase()
    }
  });

  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw app.httpErrors.unauthorized("Invalid credentials.");
  }

  const refreshToken = newRefreshToken();
  const expiresAt = await createSession(
    user.id,
    refreshToken,
    context.deviceLabel,
    context.userAgent,
    context.ipAddress
  );
  const accessToken = await issueAccessToken(app, user.id, user.email);

  await writeAuditEvent({
    userId: user.id,
    actorType: "USER",
    actorId: user.id,
    action: auditActions.AUTH_LOGIN,
    entityType: "DeviceSession",
    requestId: context.requestId
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName
    },
    accessToken,
    refreshToken,
    refreshExpiresAt: expiresAt.toISOString()
  };
}

export async function refreshSession(
  app: any,
  input: { refreshToken: string },
  context: { requestId?: string }
) {
  const tokenHash = sha256(input.refreshToken);
  const session = await prisma.deviceSession.findFirst({
    where: {
      refreshTokenHash: tokenHash,
      revokedAt: null,
      expiresAt: {
        gt: new Date()
      }
    },
    include: {
      user: true
    }
  });

  if (!session) {
    throw app.httpErrors.unauthorized("Refresh token is invalid or expired.");
  }

  const nextRefreshToken = newRefreshToken();
  const nextExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await prisma.deviceSession.update({
    where: {
      id: session.id
    },
    data: {
      refreshTokenHash: sha256(nextRefreshToken),
      expiresAt: nextExpiresAt
    }
  });

  const accessToken = await issueAccessToken(app, session.user.id, session.user.email);

  await writeAuditEvent({
    userId: session.user.id,
    actorType: "USER",
    actorId: session.user.id,
    action: auditActions.AUTH_REFRESH,
    entityType: "DeviceSession",
    entityId: session.id,
    requestId: context.requestId
  });

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    refreshExpiresAt: nextExpiresAt.toISOString()
  };
}

export async function enableMfa(app: any) {
  throw app.httpErrors.notImplemented("MFA provider is not configured.");
}

export async function verifyMfa(app: any) {
  throw app.httpErrors.notImplemented("MFA provider is not configured.");
}
