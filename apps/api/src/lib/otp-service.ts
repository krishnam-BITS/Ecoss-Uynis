import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  deliverNotification,
  type DeliveryChannel,
  type DeliveryResult,
} from './message-delivery.js';

export type OtpPurpose =
  | 'ACCOUNT_VERIFY'
  | 'IDENTIFIER_RECOVERY'
  | 'PASSWORD_RESET'
  | 'CONTACT_VERIFY';

type OtpChallenge = {
  hash: Buffer;
  expiresAt: number;
  attempts: number;
};

type OtpSendWindow = {
  count: number;
  windowStartedAt: number;
  lockedUntil: number | null;
};

const DEFAULT_TTL_MS = Number.parseInt(process.env.OTP_TTL_MS ?? '600000', 10);
const MAX_ATTEMPTS = Number.parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10);
const OTP_MAX_SENDS_PER_WINDOW = Number.parseInt(process.env.OTP_MAX_SENDS_PER_WINDOW ?? '4', 10);
const OTP_SEND_LOCK_WINDOW_MS = Number.parseInt(process.env.OTP_SEND_LOCK_WINDOW_MS ?? '3600000', 10);
const OTP_SECRET =
  process.env.OTP_HMAC_SECRET?.trim() ||
  process.env.JWT_SECRET ||
  'dev-secret-change-me';

const challenges = new Map<string, OtpChallenge>();
const sendWindows = new Map<string, OtpSendWindow>();

export class OtpSendRateLimitError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'OtpSendRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

function getKey(input: { purpose: OtpPurpose; scopeKey: string }) {
  return `${input.purpose}:${input.scopeKey.trim().toLowerCase()}`;
}

function makeHash(input: { purpose: OtpPurpose; scopeKey: string; code: string }) {
  return createHmac('sha256', OTP_SECRET)
    .update(`${input.purpose}:${input.scopeKey.trim().toLowerCase()}:${input.code}`)
    .digest();
}

function pruneExpiredChallenges() {
  const now = Date.now();
  for (const [key, value] of challenges.entries()) {
    if (value.expiresAt <= now || value.attempts >= MAX_ATTEMPTS) {
      challenges.delete(key);
    }
  }

  for (const [key, value] of sendWindows.entries()) {
    const windowExpired = value.windowStartedAt + OTP_SEND_LOCK_WINDOW_MS <= now;
    const lockExpired = !value.lockedUntil || value.lockedUntil <= now;
    if (windowExpired && lockExpired) {
      sendWindows.delete(key);
    }
  }
}

function createOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function copyMatches(left: Buffer, right: Buffer) {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function contentForPurpose(purpose: OtpPurpose, code: string) {
  if (purpose === 'PASSWORD_RESET') {
    return {
      subject: 'Reset your Uynis password',
      heading: 'Password reset request',
      label: 'Password reset',
      intro: 'Use this one-time code to continue resetting your Uynis password.',
      text: `Uynis password reset code: ${code}. Enter this code to continue resetting your password. This code expires in 10 minutes. If you did not request a password reset, you can ignore this message.`,
    };
  }
  if (purpose === 'CONTACT_VERIFY') {
    return {
      subject: 'Verify your new contact',
      heading: 'Confirm your new contact method',
      label: 'Contact verification',
      intro: 'Use this one-time code to confirm the new email or phone you added to your account.',
      text: `Uynis contact verification code: ${code}. Enter this code to confirm your new contact method. This code expires in 10 minutes. If you did not make this change, you can ignore this message.`,
    };
  }
  if (purpose === 'IDENTIFIER_RECOVERY') {
    return {
      subject: 'Confirm account recovery access',
      heading: 'Account recovery verification',
      label: 'Account recovery',
      intro: 'Use this one-time code to prove you still control this email address or phone number.',
      text: `Uynis recovery code: ${code}. Enter this code to continue account recovery. This code expires in 10 minutes. If you did not request account recovery, you can ignore this message.`,
    };
  }
  return {
    subject: 'Verify your Uynis account',
    heading: 'Verify your Uynis account',
    label: 'Account verification',
    intro: 'Use this one-time code to verify your account and finish the sign-up or login flow.',
    text: `Uynis verification code: ${code}. Enter this code to verify your account. This code expires in 10 minutes. If you did not request this code, you can ignore this message.`,
  };
}

function assertOtpSendAllowed(key: string) {
  const now = Date.now();
  const current = sendWindows.get(key);

  if (!current) {
    return;
  }

  if (current.lockedUntil && current.lockedUntil > now) {
    throw new OtpSendRateLimitError(
      'Too many OTP requests. Please wait 1 hour before requesting another code.',
      current.lockedUntil - now,
    );
  }

  if (current.windowStartedAt + OTP_SEND_LOCK_WINDOW_MS <= now) {
    return;
  }

  if (current.count >= OTP_MAX_SENDS_PER_WINDOW) {
    current.lockedUntil = now + OTP_SEND_LOCK_WINDOW_MS;
    sendWindows.set(key, current);
    throw new OtpSendRateLimitError(
      'Too many OTP requests. Please wait 1 hour before requesting another code.',
      OTP_SEND_LOCK_WINDOW_MS,
    );
  }
}

function registerOtpSendSuccess(key: string) {
  const now = Date.now();
  const current = sendWindows.get(key);

  if (!current || current.windowStartedAt + OTP_SEND_LOCK_WINDOW_MS <= now) {
    sendWindows.set(key, {
      count: 1,
      windowStartedAt: now,
      lockedUntil: null,
    });
    return;
  }

  current.count += 1;
  sendWindows.set(key, current);
}

export async function sendOtpChallenge(input: {
  purpose: OtpPurpose;
  scopeKey: string;
  channel: DeliveryChannel;
  recipient: string;
}): Promise<{ expiresInMs: number; delivery: DeliveryResult }> {
  pruneExpiredChallenges();

  const key = getKey(input);
  assertOtpSendAllowed(key);

  const code = createOtpCode();
  const content = contentForPurpose(input.purpose, code);
  const sender =
    input.channel === 'email'
      ? process.env.OTP_SENDER_EMAIL?.trim() || 'no-reply@uynis.local'
      : process.env.OTP_SENDER_PHONE?.trim() || 'Uynis';

  const html =
    input.channel === 'email'
      ? [
          '<div style="font-family:Segoe UI,Arial,sans-serif;padding:24px;background:#f3f6fb;color:#0f172a;">',
          '<div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:22px;padding:30px;border:1px solid #dbe4f2;box-shadow:0 18px 45px rgba(15,23,42,0.08);">',
          `<div style="display:inline-flex;align-items:center;padding:6px 12px;border-radius:999px;background:#eef4ff;color:#3357a3;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(content.label)}</div>`,
          `<h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2;">${escapeHtml(content.heading)}</h1>`,
          `<p style="margin:0 0 18px;color:#475569;font-size:16px;line-height:1.7;">${escapeHtml(content.intro)}</p>`,
          '<div style="padding:18px;border-radius:18px;background:#0f172a;color:#ffffff;text-align:center;">',
          '<div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.72;margin-bottom:10px;">One-time code</div>',
          `<div style="font-size:34px;font-weight:800;letter-spacing:0.38em;padding-left:0.38em;">${escapeHtml(code)}</div>`,
          '</div>',
          '<div style="margin-top:20px;padding:18px;border-radius:16px;border:1px solid #dbe4f2;background:#f8fbff;">',
          '<div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">What to do</div>',
          `<p style="margin:0;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(content.text)}</p>`,
          '</div>',
          '<p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.6;">This code is valid for 10 minutes and can only be used once.</p>',
          '<p style="margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.6;">If you did not request this message, you can safely ignore it.</p>',
          '</div>',
          '</div>',
        ].join('')
      : null;

  const delivery = await deliverNotification({
    channel: input.channel,
    recipient: input.recipient,
    sender,
    subject: content.subject,
    text: content.text,
    html,
    otpCode: code,
    purpose: input.purpose,
  });

  if (delivery.delivered) {
    registerOtpSendSuccess(key);
    challenges.set(key, {
      hash: makeHash({
        purpose: input.purpose,
        scopeKey: input.scopeKey,
        code,
      }),
      expiresAt: Date.now() + DEFAULT_TTL_MS,
      attempts: 0,
    });
  }

  return {
    expiresInMs: DEFAULT_TTL_MS,
    delivery,
  };
}

export function verifyOtpChallenge(
  input: {
    purpose: OtpPurpose;
    scopeKey: string;
    code: string;
  },
  options?: {
    consume?: boolean;
  },
) {
  pruneExpiredChallenges();

  const key = getKey(input);
  const challenge = challenges.get(key);
  if (!challenge) {
    return false;
  }
  if (challenge.expiresAt <= Date.now()) {
    challenges.delete(key);
    return false;
  }

  challenge.attempts += 1;
  const incoming = makeHash({
    purpose: input.purpose,
    scopeKey: input.scopeKey,
    code: input.code.trim(),
  });

  if (!copyMatches(challenge.hash, incoming)) {
    if (challenge.attempts >= MAX_ATTEMPTS) {
      challenges.delete(key);
    } else {
      challenges.set(key, challenge);
    }
    return false;
  }

  if (options?.consume === false) {
    challenges.set(key, challenge);
  } else {
    challenges.delete(key);
  }
  return true;
}
