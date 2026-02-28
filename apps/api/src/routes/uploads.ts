import type { FastifyInstance, FastifyReply } from 'fastify';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { markUploadConsumed, verifyUploadToken } from '../lib/upload-tokens.js';
import { getAttachmentUploadsDir, getAvatarUploadsDir } from '../lib/uploads.js';
import { getObject, putObject } from '../lib/object-store.js';

const uploadBodyLimit = Number.parseInt(
  process.env.UPLOAD_BODY_LIMIT ?? '262144000',
  10,
);
const attachmentMaxBytes = Number.parseInt(
  process.env.ATTACHMENT_MAX_BYTES ?? '10485760',
  10,
);
const allowLegacyUploadFallback =
  process.env.UPLOADS_LEGACY_FALLBACK?.trim().toLowerCase() === 'true';

function createCountingLimiter(maxBytes: number) {
  let total = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (maxBytes > 0 && total > maxBytes) {
        callback(new Error('Upload exceeds maximum size.'));
        return;
      }
      callback(null, chunk);
    },
  });
  return {
    limiter,
    getTotalBytes: () => total,
  };
}

function isMissingObjectError(error: unknown) {
  const code = (error as { name?: string; Code?: string }).name ?? (error as { Code?: string }).Code;
  return code === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchBucket';
}

function toSafeFileName(value: string) {
  const decoded = decodeURIComponent(value);
  const normalized = path.basename(decoded);
  return normalized;
}

async function sendStoredOrLegacyFile(reply: FastifyReply, input: { key: string; legacyPath: string }) {
  try {
    const object = await getObject(input.key);
    if (!object.body) {
      return reply.code(404).send({ message: 'File not found.' });
    }
    if (object.contentLength) {
      reply.header('content-length', object.contentLength);
    }
    return reply.type(object.contentType).send(object.body);
  } catch (error) {
    if (!isMissingObjectError(error)) {
      throw error;
    }
  }

  if (!allowLegacyUploadFallback) {
    return reply.code(404).send({ message: 'File not found.' });
  }

  try {
    await access(input.legacyPath);
    return reply.send(createReadStream(input.legacyPath));
  } catch {
    return reply.code(404).send({ message: 'File not found.' });
  }
}

async function readStreamToBuffer(input: {
  stream: AsyncIterable<Buffer | string>;
  maxBytes: number;
}) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of input.stream) {
    const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += nextChunk.length;
    if (input.maxBytes > 0 && totalBytes > input.maxBytes) {
      throw new Error('Upload exceeds maximum size.');
    }
    chunks.push(nextChunk);
  }
  return {
    buffer: Buffer.concat(chunks),
    totalBytes,
  };
}

export async function uploadRoutes(server: FastifyInstance) {
  server.get('/uploads/attachments/:fileName', async (request, reply) => {
    const params = request.params as { fileName: string };
    const fileName = toSafeFileName(params.fileName);
    if (!fileName) {
      return reply.code(404).send({ message: 'File not found.' });
    }

    return sendStoredOrLegacyFile(reply, {
      key: `attachments/${fileName}`,
      legacyPath: path.join(getAttachmentUploadsDir(), fileName),
    });
  });

  server.get('/uploads/avatars/:fileName', async (request, reply) => {
    const params = request.params as { fileName: string };
    const fileName = toSafeFileName(params.fileName);
    if (!fileName) {
      return reply.code(404).send({ message: 'File not found.' });
    }

    return sendStoredOrLegacyFile(reply, {
      key: `avatars/${fileName}`,
      legacyPath: path.join(getAvatarUploadsDir(), fileName),
    });
  });

  server.post('/uploads/attachments', async (request, reply) => {
    await request.jwtVerify();

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ message: 'Attachment file is required.' });
    }

    const safeName = path.basename(data.filename || 'attachment.bin');
    const filename = `${randomUUID()}-${safeName}`;
    const objectKey = `attachments/${filename}`;

    let totalBytes = 0;
    try {
      const uploaded = await readStreamToBuffer({
        stream: data.file as AsyncIterable<Buffer | string>,
        maxBytes: attachmentMaxBytes,
      });
      totalBytes = uploaded.totalBytes;
      await putObject({
        key: objectKey,
        body: uploaded.buffer,
        contentType: data.mimetype,
        contentLength: uploaded.totalBytes,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to upload attachment.';
      const status = message.includes('maximum size') ? 413 : 400;
      return reply.code(status).send({ message });
    }

    const baseUrl =
      process.env.API_PUBLIC_URL ?? `${request.protocol}://${request.hostname}`;
    const url = `${baseUrl}/uploads/attachments/${encodeURIComponent(filename)}`;

    return reply.send({
      url,
      name: data.filename || safeName,
      size: totalBytes,
      contentType: data.mimetype,
    });
  });

  server.put(
    '/uploads/signed/:uploadId',
    { config: { bodyLimit: uploadBodyLimit } },
    async (request, reply) => {
      const { uploadId } = request.params as { uploadId: string };
      const tokenFromHeader = request.headers['x-upload-token'];
      const tokenFromQuery =
        typeof request.query === 'object' && request.query
          ? (request.query as { token?: string }).token
          : undefined;
      const token =
        typeof tokenFromHeader === 'string'
          ? tokenFromHeader
          : tokenFromQuery;

      if (!token) {
        return reply.code(401).send({ message: 'Upload token required.' });
      }

      const record = await verifyUploadToken(uploadId, token);
      if (!record) {
        return reply.code(401).send({ message: 'Invalid or expired upload token.' });
      }

      const contentLength = request.headers['content-length']
        ? Number(request.headers['content-length'])
        : null;
      if (contentLength && record.maxBytes && contentLength > record.maxBytes) {
        return reply.code(413).send({ message: 'Upload exceeds maximum size.' });
      }

      const targetKey = record.storagePath;
      const { limiter, getTotalBytes } = createCountingLimiter(record.maxBytes);
      const chunks: Buffer[] = [];

      try {
        for await (const chunk of request.raw) {
          const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          await new Promise<void>((resolve, reject) => {
            limiter.write(nextChunk, (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          });
          chunks.push(nextChunk);
        }
        limiter.end();
        const bodyBuffer = Buffer.concat(chunks);
        await putObject({
          key: targetKey,
          body: bodyBuffer,
          contentType: record.contentType ?? request.headers['content-type'],
          contentLength: bodyBuffer.length,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to upload file.';
        const status = message.includes('maximum size') ? 413 : 400;
        return reply.code(status).send({ message });
      }

      await markUploadConsumed(uploadId);
      return reply.send({ ok: true, key: targetKey, bytes: getTotalBytes() });
    },
  );
}

