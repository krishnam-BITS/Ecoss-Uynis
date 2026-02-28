'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { label: 'Profile', href: '/settings/profile' },
  { label: 'Account', href: '/settings/account' },
  { label: 'Security', href: '/settings/security' },
  { label: 'Developer', href: '/settings/developer' },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="settings-nav">
      {items.map((item) => (
        <Link
          key={item.href}
          className={pathname === item.href ? 'active' : undefined}
          href={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
