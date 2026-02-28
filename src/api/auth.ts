export async function requireAuth(request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.unauthorized("Authentication required.");
  }
}

export function getUserId(request: any): string {
  const user = request.user as { sub?: string };
  if (!user?.sub) {
    throw request.server.httpErrors.unauthorized("Missing authenticated user.");
  }

  return user.sub;
}
