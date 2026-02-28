import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../config/env.js";

let ensuredBucketPromise: Promise<void> | null = null;
const storageBucket = env.S3_BUCKET;
const objectStorageConfigured = Boolean(
  storageBucket &&
    env.S3_REGION &&
    (env.S3_ENDPOINT || (!env.S3_ACCESS_KEY && !env.S3_SECRET_KEY))
);

export const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials:
    env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? {
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY
        }
      : undefined
});

function requireObjectStorageConfig() {
  if (!objectStorageConfigured) {
    throw new Error("S3-compatible object storage is not configured.");
  }
}

export function isObjectStorageConfigured() {
  return objectStorageConfigured;
}

export async function ensureDocumentBucket(): Promise<void> {
  requireObjectStorageConfig();

  if (ensuredBucketPromise) {
    return ensuredBucketPromise;
  }

  ensuredBucketPromise = (async () => {
    try {
      await s3Client.send(
        new HeadBucketCommand({
          Bucket: storageBucket
        })
      );
    } catch {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: storageBucket
        })
      );
    }
  })();

  return ensuredBucketPromise;
}

export async function createSignedUploadUrl(input: {
  key: string;
  mimeType: string;
  checksum: string;
  userId: string;
}) {
  await ensureDocumentBucket();

  return getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: storageBucket,
      Key: input.key,
      ContentType: input.mimeType,
      Metadata: {
        owneruserid: input.userId,
        uploadchecksum: input.checksum
      }
    }),
    {
      expiresIn: env.S3_SIGNED_UPLOAD_TTL_SECONDS
    }
  );
}

export async function createSignedDownloadUrl(key: string) {
  await ensureDocumentBucket();

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: storageBucket,
      Key: key
    }),
    {
      expiresIn: env.S3_SIGNED_DOWNLOAD_TTL_SECONDS
    }
  );
}

export async function headDocumentObject(key: string) {
  await ensureDocumentBucket();

  return s3Client.send(
    new HeadObjectCommand({
      Bucket: storageBucket,
      Key: key
    })
  );
}

export async function putObjectBuffer(input: {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}) {
  await ensureDocumentBucket();

  await s3Client.send(
    new PutObjectCommand({
      Bucket: storageBucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: input.metadata
    })
  );
}

export async function getObjectBuffer(key: string) {
  await ensureDocumentBucket();

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: storageBucket,
      Key: key
    })
  );

  if (!response.Body) {
    throw new Error(`Object ${key} was not found in storage.`);
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}
