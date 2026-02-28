import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type DeliveryChannel = 'email' | 'phone';
export type DeliveryResult = {
  delivered: boolean;
  skipped?: boolean;
  storedLocally?: boolean;
};

type DeliveryPayload = {
  channel: DeliveryChannel;
  recipient: string;
  sender: string;
  subject: string | null;
  text: string;
  html: string | null;
  otpCode: string | null;
  purpose: string;
  createdAt: string;
};

type SealedDeliveryPayload = {
  mode: 'sealed';
  algorithm: 'aes-256-gcm';
  createdAt: string;
  iv: string;
  tag: string;
  data: string;
};

const DELIVERY_PROVIDER = (process.env.MESSAGE_DELIVERY_PROVIDER?.trim().toLowerCase() || 'none') as
  | 'none'
  | 'webhook'
  | 'sendgrid'
  | 'twilio'
  | 'auto';

const DELIVERY_URL = process.env.MESSAGE_DELIVERY_WEBHOOK_URL?.trim() || '';
const DELIVERY_BEARER = process.env.MESSAGE_DELIVERY_WEBHOOK_BEARER?.trim() || '';
const DELIVERY_SHARED_KEY = process.env.MESSAGE_DELIVERY_SHARED_KEY?.trim() || '';
const SENDGRID_API_KEY = process.env.MESSAGE_DELIVERY_SENDGRID_API_KEY?.trim() || '';
const SENDGRID_FROM_EMAIL =
  process.env.MESSAGE_DELIVERY_SENDGRID_FROM_EMAIL?.trim() || process.env.OTP_SENDER_EMAIL?.trim() || '';
const TWILIO_ACCOUNT_SID = process.env.MESSAGE_DELIVERY_TWILIO_ACCOUNT_SID?.trim() || '';
const TWILIO_AUTH_TOKEN = process.env.MESSAGE_DELIVERY_TWILIO_AUTH_TOKEN?.trim() || '';
const TWILIO_FROM_PHONE =
  process.env.MESSAGE_DELIVERY_TWILIO_FROM_PHONE?.trim() || process.env.OTP_SENDER_PHONE?.trim() || '';
const LOCAL_EMULATOR_DATA_PATH =
  process.env.DELIVERY_EMULATOR_DATA_PATH?.trim() ||
  resolve(process.cwd(), 'temp', 'data', 'messages.json');
const LOCAL_EMULATOR_STORE_KEY =
  process.env.DELIVERY_EMULATOR_STORE_KEY?.trim() ||
  DELIVERY_SHARED_KEY ||
  'delivery-emulator-dev-key';

function getSharedKey() {
  if (!DELIVERY_SHARED_KEY) {
    return null;
  }

  return createHash('sha256').update(DELIVERY_SHARED_KEY).digest();
}

function sealPayload(payload: DeliveryPayload): DeliveryPayload | SealedDeliveryPayload {
  const sharedKey = getSharedKey();
  if (!sharedKey) {
    return payload;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sharedKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    mode: 'sealed',
    algorithm: 'aes-256-gcm',
    createdAt: payload.createdAt,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

function keyFromSecret(secret: string) {
  return createHash('sha256').update(secret).digest();
}

function encryptLocalPayload(value: DeliveryPayload, secret: string) {
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

function isLocalWebhookDeliveryTarget() {
  if (!DELIVERY_URL) {
    return false;
  }

  try {
    const url = new URL(DELIVERY_URL);
    return (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.pathname === '/api/messages'
    );
  } catch {
    return false;
  }
}

function ensureLocalEmulatorStore() {
  const folder = dirname(LOCAL_EMULATOR_DATA_PATH);
  if (!existsSync(folder)) {
    mkdirSync(folder, { recursive: true });
  }
  if (!existsSync(LOCAL_EMULATOR_DATA_PATH)) {
    writeFileSync(LOCAL_EMULATOR_DATA_PATH, '[]', 'utf8');
  }
}

function storeInLocalEmulator(payload: DeliveryPayload) {
  ensureLocalEmulatorStore();
  const raw = readFileSync(LOCAL_EMULATOR_DATA_PATH, 'utf8');
  const records = JSON.parse(raw);
  const list = Array.isArray(records) ? records : [];
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channel: payload.channel,
    createdAt: payload.createdAt,
    payload: encryptLocalPayload(payload, LOCAL_EMULATOR_STORE_KEY),
  });
  writeFileSync(LOCAL_EMULATOR_DATA_PATH, JSON.stringify(list.slice(0, 500), null, 2), 'utf8');
}

function signBody(body: string) {
  if (!DELIVERY_SHARED_KEY) {
    return null;
  }

  return createHmac('sha256', DELIVERY_SHARED_KEY).update(body).digest('hex');
}

async function handleFailedResponse(response: Response) {
  const fallback = `Message delivery failed with status ${response.status}.`;
  try {
    const data = (await response.json()) as { message?: string; errors?: Array<{ message?: string }> };
    const nestedMessage = data.errors?.[0]?.message;
    throw new Error(data.message || nestedMessage || fallback);
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw error;
    }
    throw new Error(fallback);
  }
}

async function deliverViaWebhook(payload: DeliveryPayload) {
  if (!DELIVERY_URL) {
    throw new Error(
      'Webhook delivery is not configured. Set MESSAGE_DELIVERY_WEBHOOK_URL.',
    );
  }

  const outbound = sealPayload(payload);
  const body = JSON.stringify(outbound);
  const signature = signBody(body);

  let response: Response;
  try {
    response = await fetch(DELIVERY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(DELIVERY_BEARER ? { authorization: `Bearer ${DELIVERY_BEARER}` } : {}),
        ...(signature ? { 'x-delivery-signature': signature } : {}),
      },
      body,
    });
  } catch (error) {
    if (isLocalWebhookDeliveryTarget()) {
      storeInLocalEmulator(payload);
      return { delivered: false, storedLocally: true } satisfies DeliveryResult;
    }
    throw error;
  }

  if (!response.ok) {
    if (isLocalWebhookDeliveryTarget()) {
      storeInLocalEmulator(payload);
      return { delivered: false, storedLocally: true } satisfies DeliveryResult;
    }
    await handleFailedResponse(response);
  }

  return { delivered: true } satisfies DeliveryResult;
}

async function deliverViaSendGrid(payload: DeliveryPayload) {
  if (payload.channel !== 'email') {
    throw new Error('SendGrid delivery only supports email payloads.');
  }
  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL) {
    throw new Error(
      'SendGrid delivery is not configured. Set MESSAGE_DELIVERY_SENDGRID_API_KEY and MESSAGE_DELIVERY_SENDGRID_FROM_EMAIL.',
    );
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: payload.recipient }],
          subject: payload.subject || 'Uynis notification',
        },
      ],
      from: { email: SENDGRID_FROM_EMAIL },
      content: [
        { type: 'text/plain', value: payload.text },
        ...(payload.html ? [{ type: 'text/html', value: payload.html }] : []),
      ],
    }),
  });

  if (!response.ok) {
    await handleFailedResponse(response);
  }
}

async function deliverViaTwilio(payload: DeliveryPayload) {
  if (payload.channel !== 'phone') {
    throw new Error('Twilio delivery only supports phone payloads.');
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_PHONE) {
    throw new Error(
      'Twilio delivery is not configured. Set MESSAGE_DELIVERY_TWILIO_ACCOUNT_SID, MESSAGE_DELIVERY_TWILIO_AUTH_TOKEN, and MESSAGE_DELIVERY_TWILIO_FROM_PHONE.',
    );
  }

  const body = new URLSearchParams({
    To: payload.recipient,
    From: TWILIO_FROM_PHONE,
    Body: payload.text,
  });
  const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${credentials}`,
      },
      body,
    },
  );

  if (!response.ok) {
    await handleFailedResponse(response);
  }
}

export async function deliverNotification(input: {
  channel: DeliveryChannel;
  recipient: string;
  sender: string;
  subject?: string | null;
  text: string;
  html?: string | null;
  otpCode?: string | null;
  purpose: string;
}): Promise<DeliveryResult> {
  const payload: DeliveryPayload = {
    channel: input.channel,
    recipient: input.recipient,
    sender: input.sender,
    subject: input.subject ?? null,
    text: input.text,
    html: input.html ?? null,
    otpCode: input.otpCode ?? null,
    purpose: input.purpose,
    createdAt: new Date().toISOString(),
  };

  if (DELIVERY_PROVIDER === 'none') {
    return {
      delivered: false,
      skipped: true,
    };
  }

  if (DELIVERY_PROVIDER === 'webhook') {
    return deliverViaWebhook(payload);
  }

  if (DELIVERY_PROVIDER === 'sendgrid') {
    await deliverViaSendGrid(payload);
    return { delivered: true };
  }

  if (DELIVERY_PROVIDER === 'twilio') {
    await deliverViaTwilio(payload);
    return { delivered: true };
  }

  if (DELIVERY_PROVIDER === 'auto') {
    if (payload.channel === 'email' && SENDGRID_API_KEY) {
      await deliverViaSendGrid(payload);
      return { delivered: true };
    }
    if (payload.channel === 'phone' && TWILIO_ACCOUNT_SID) {
      await deliverViaTwilio(payload);
      return { delivered: true };
    }
    if (DELIVERY_URL) {
      await deliverViaWebhook(payload);
      return { delivered: true };
    }
    throw new Error(
      'Auto delivery could not find a configured provider. Configure SendGrid, Twilio, or webhook delivery.',
    );
  }

  throw new Error(
    'Message delivery provider is not configured. Supported values: none, webhook, sendgrid, twilio, auto.',
  );

  return { delivered: true };
}
