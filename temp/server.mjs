import { createDecipheriv, createHash, createHmac, randomBytes, createCipheriv } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { createServer } from 'node:http';

function stripWrappingQuotes(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || typeof process.env[key] === 'string') {
      continue;
    }

    process.env[key] = stripWrappingQuotes(trimmed.slice(separatorIndex + 1));
  }
}

loadEnvFile(join(process.cwd(), '.env'));
loadEnvFile(join(process.cwd(), '.env.local'));

const port = Number.parseInt(process.env.DELIVERY_EMULATOR_PORT || '3011', 10);
const dataPath =
  process.env.DELIVERY_EMULATOR_DATA_PATH || join(process.cwd(), 'data', 'messages.json');
const bearerToken = process.env.DELIVERY_EMULATOR_BEARER?.trim() || '';
const sharedKey = process.env.DELIVERY_EMULATOR_SHARED_KEY?.trim() || '';
const storeKeySource =
  process.env.DELIVERY_EMULATOR_STORE_KEY?.trim() || sharedKey || 'delivery-emulator-dev-key';
const publicDir = join(process.cwd(), 'public');
const distDir = join(process.cwd(), 'dist');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function ensureDataFile() {
  const folder = dirname(dataPath);
  if (!existsSync(folder)) {
    mkdirSync(folder, { recursive: true });
  }
  if (!existsSync(dataPath)) {
    writeFileSync(dataPath, '[]', 'utf8');
  }
}

function keyFromSecret(secret) {
  return createHash('sha256').update(secret).digest();
}

function encryptJson(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

function decryptJson(value, secret) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFromSecret(secret),
    Buffer.from(value.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function readStore() {
  ensureDataFile();
  const raw = readFileSync(dataPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function writeStore(records) {
  ensureDataFile();
  writeFileSync(dataPath, JSON.stringify(records, null, 2), 'utf8');
}

function verifyInboundSignature(body, signature) {
  if (!sharedKey) {
    return true;
  }
  if (!signature) {
    return false;
  }
  const expected = createHmac('sha256', sharedKey).update(body).digest('hex');
  return expected === signature;
}

function decodeIncomingPayload(raw) {
  const parsed = JSON.parse(raw);
  if (parsed && parsed.mode === 'sealed') {
    if (!sharedKey) {
      throw new Error('Shared key is required for sealed payloads.');
    }
    return decryptJson(parsed, sharedKey);
  }
  return parsed;
}

function saveMessage(message) {
  const records = readStore();
  records.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channel: message.channel,
    createdAt: message.createdAt,
    payload: encryptJson(message, storeKeySource),
  });
  writeStore(records.slice(0, 500));
}

function listMessages(channel) {
  return readStore()
    .map((record) => ({
      id: record.id,
      channel: record.channel,
      createdAt: record.createdAt,
      payload: decryptJson(record.payload, storeKeySource),
    }))
    .filter((record) => (channel ? record.channel === channel : true))
    .map((record) => ({
      id: record.id,
      ...record.payload,
    }));
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function serveStatic(request, response) {
  let requestedPath = request.url === '/' ? '/index.html' : request.url || '/index.html';
  const queryIndex = requestedPath.indexOf('?');
  if (queryIndex >= 0) {
    requestedPath = requestedPath.slice(0, queryIndex);
  }

  const relativePath = requestedPath.replace(/^\/+/, '');
  const distPath = join(distDir, relativePath);
  const publicPath = join(publicDir, relativePath);

  let filePath = distPath;
  if (!existsSync(filePath)) {
    filePath = publicPath;
  }
  if (!existsSync(filePath) && relativePath && relativePath !== 'index.html') {
    const distIndex = join(distDir, 'index.html');
    const publicIndex = join(publicDir, 'index.html');
    filePath = existsSync(distIndex) ? distIndex : publicIndex;
  }

  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  if (request.method === 'POST' && request.url === '/api/messages') {
    if (bearerToken) {
      const authHeader = request.headers.authorization || '';
      if (authHeader !== `Bearer ${bearerToken}`) {
        sendJson(response, 401, { message: 'Unauthorized.' });
        return;
      }
    }

    try {
      const body = await readBody(request);
      if (!verifyInboundSignature(body, request.headers['x-delivery-signature'])) {
        sendJson(response, 401, { message: 'Invalid delivery signature.' });
        return;
      }
      const payload = decodeIncomingPayload(body);
      if (!payload || !payload.channel || !payload.recipient || !payload.createdAt) {
        sendJson(response, 400, { message: 'Invalid payload.' });
        return;
      }
      saveMessage(payload);
      sendJson(response, 201, { stored: true });
    } catch (error) {
      sendJson(response, 400, {
        message: error instanceof Error ? error.message : 'Unable to store message.',
      });
    }
    return;
  }

  if (request.method === 'GET' && request.url.startsWith('/api/messages')) {
    const currentUrl = new URL(request.url, `http://localhost:${port}`);
    const channel = currentUrl.searchParams.get('channel');
    sendJson(response, 200, {
      messages: listMessages(channel === 'email' || channel === 'phone' ? channel : null),
    });
    return;
  }

  if (request.method === 'GET') {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end('Method not allowed');
});

ensureDataFile();
server.listen(port, () => {
  console.log(`Delivery emulator running on http://localhost:${port}`);
});
