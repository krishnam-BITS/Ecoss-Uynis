type NullableText = string | null | undefined;

function clean(value: NullableText): string {
  return (value ?? '').trim();
}

export function resolveDisplayName(input: {
  name?: NullableText;
  firstName?: NullableText;
  lastName?: NullableText;
  username?: NullableText;
  email?: NullableText;
  phone?: NullableText;
  fallbackId?: NullableText;
}): string {
  const explicit = clean(input.name);
  if (explicit) {
    return explicit;
  }

  const combined = [clean(input.firstName), clean(input.lastName)]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (combined) {
    return combined;
  }

  const username = clean(input.username);
  if (username) {
    return username;
  }

  const email = clean(input.email);
  if (email) {
    return email.split('@')[0] ?? email;
  }

  const phone = clean(input.phone);
  if (phone) {
    return phone;
  }

  const fallbackId = clean(input.fallbackId);
  if (fallbackId) {
    return `User ${fallbackId.slice(-6)}`;
  }

  return 'User';
}

export function resolveIsVerified(input: {
  emailVerified: boolean;
  phoneVerified: boolean;
  hasPrivateAccount?: boolean;
}): boolean {
  return Boolean(input.hasPrivateAccount) || input.emailVerified || input.phoneVerified;
}

export function isExpired(value: Date | null | undefined, now = new Date()): boolean {
  if (!value) {
    return false;
  }
  return value.getTime() < now.getTime();
}