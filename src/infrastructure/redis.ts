import { Redis } from "ioredis";

import { env } from "../config/env.js";

declare global {
  // eslint-disable-next-line no-var
  var __redis__: Redis | undefined;
}

export const redis =
  globalThis.__redis__ ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__redis__ = redis;
}
