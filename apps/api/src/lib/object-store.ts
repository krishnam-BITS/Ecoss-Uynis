import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const endpoint =
  process.env.S3_ENDPOINT?.trim() ||
  process.env.MINIO_ENDPOINT?.trim() ||
  'http://minio:9000';
const accessKeyId =
  process.env.S3_ACCESS_KEY?.trim() ||
  process.env.MINIO_ACCESS_KEY?.trim() ||
  process.env.MINIO_ROOT_USER?.trim() ||
  'uynisminio';
const secretAccessKey =
  process.env.S3_SECRET_KEY?.trim() ||
  process.env.MINIO_SECRET_KEY?.trim() ||
  process.env.MINIO_ROOT_PASSWORD?.trim() ||
  'uynisminiosecret';
const region = process.env.S3_REGION?.trim() || 'us-east-1';
const uploadsBucket =
  process.env.S3_BUCKET_UPLOADS?.trim() ||
  process.env.MINIO_BUCKET?.trim() ||
  'uynis-uploads';

const hasObjectStoreConfig = Boolean(endpoint && accessKeyId && secretAccessKey);

const s3Client = hasObjectStoreConfig
  ? new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  : null;

let bucketReady = false;
let bucketCheckedAt = 0;
const bucketCheckIntervalMs = 60_000;

export function isObjectStoreConfigured() {
  return Boolean(s3Client);
}

export function getUploadsBucket() {
  return uploadsBucket;
}

export async function checkObjectStoreReadiness() {
  if (!s3Client) {
    return { ok: false, message: 'Object store is not configured.' };
  }
  try {
    await ensureBucket();
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Object store unavailable.',
    };
  }
}

async function ensureBucket() {
  if (!s3Client) {
    throw new Error('Object store is not configured.');
  }

  const now = Date.now();
  if (bucketReady && now - bucketCheckedAt < bucketCheckIntervalMs) {
    return;
  }

  try {
    await s3Client.send(
      new HeadBucketCommand({
        Bucket: uploadsBucket,
      }),
    );
    bucketReady = true;
    bucketCheckedAt = now;
    return;
  } catch {
    try {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: uploadsBucket,
        }),
      );
      bucketReady = true;
      bucketCheckedAt = now;
    } catch (error) {
      const code = (error as { name?: string }).name;
      if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
        bucketReady = true;
        bucketCheckedAt = now;
        return;
      }
      throw error;
    }
  }
}

export async function putObject(input: {
  key: string;
  body: PutObjectCommandInput['Body'];
  contentType?: string | null;
  contentLength?: number | null;
}) {
  if (!s3Client) {
    throw new Error('Object store is not configured.');
  }
  await ensureBucket();
  await s3Client.send(
    new PutObjectCommand({
      Bucket: uploadsBucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType ?? undefined,
      ContentLength:
        typeof input.contentLength === 'number' && input.contentLength >= 0
          ? input.contentLength
          : undefined,
    }),
  );
  return {
    bucket: uploadsBucket,
    key: input.key,
  };
}

export async function getObject(key: string) {
  if (!s3Client) {
    throw new Error('Object store is not configured.');
  }
  await ensureBucket();
  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: uploadsBucket,
      Key: key,
    }),
  );
  return {
    body: result.Body ?? null,
    contentType: result.ContentType ?? 'application/octet-stream',
    contentLength: result.ContentLength ?? null,
  };
}

export async function getObjectBuffer(key: string) {
  const object = await getObject(key);
  if (!object.body) {
    throw new Error('Object body is missing.');
  }
  if (typeof (object.body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    const bytes = await (object.body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of object.body as AsyncIterable<Buffer | string>) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getSignedObjectUrl(input: { key: string; expiresInSeconds?: number }) {
  if (!s3Client) {
    throw new Error('Object store is not configured.');
  }
  await ensureBucket();
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: uploadsBucket,
      Key: input.key,
    }),
    { expiresIn: input.expiresInSeconds ?? 900 },
  );
}

export async function deleteObject(key: string) {
  if (!s3Client) {
    return;
  }
  await ensureBucket();
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: uploadsBucket,
      Key: key,
    }),
  );
}
