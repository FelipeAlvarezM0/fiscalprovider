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

export async function ensureDocumentBucket(): Promise<void> {
  if (ensuredBucketPromise) {
    return ensuredBucketPromise;
  }

  ensuredBucketPromise = (async () => {
    try {
      await s3Client.send(
        new HeadBucketCommand({
          Bucket: env.S3_BUCKET
        })
      );
    } catch {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: env.S3_BUCKET
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
      Bucket: env.S3_BUCKET,
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
      Bucket: env.S3_BUCKET,
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
      Bucket: env.S3_BUCKET,
      Key: key
    })
  );
}
