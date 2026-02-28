'use client';

import type { ReactNode } from 'react';

type Role = 'READ' | 'WRITE' | 'ADMIN' | null | undefined;

const roleRank: Record<'READ' | 'WRITE' | 'ADMIN', number> = {
  READ: 1,
  WRITE: 2,
  ADMIN: 3,
};

export function PermissionGate({
  role,
  require,
  children,
  fallback = null,
}: {
  role: Role;
  require: 'READ' | 'WRITE' | 'ADMIN';
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const currentRank = role ? roleRank[role] : 0;
  const requiredRank = roleRank[require];

  if (currentRank < requiredRank) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

