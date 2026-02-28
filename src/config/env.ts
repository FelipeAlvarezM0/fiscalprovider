import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/fiscal_nd"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(16).default("local-development-access-secret"),
  JWT_REFRESH_SECRET: z.string().min(16).default("local-development-refresh-secret"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  DEFAULT_RULESET_IRS: z.string().default("IRS-2026.1"),
  DEFAULT_RULESET_ND: z.string().default("ND-2026.2"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  S3_SIGNED_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  S3_SIGNED_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  DOCUMENT_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  DOCUMENT_ALLOWED_MIME_TYPES: z
    .string()
    .default("application/pdf,image/jpeg,image/png,text/csv")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  KMS_KEY_ID: z.string().default("local-dev-key"),
  RULESET_SIGNING_SECRET: z.string().default("local-dev-ruleset-secret")
});

export const env = envSchema.parse(process.env);
