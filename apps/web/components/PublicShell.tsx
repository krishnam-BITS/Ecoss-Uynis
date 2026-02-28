'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  PUBLIC_TOP_NAV_LINKS,
  matchPublicSearchItems,
  type PublicSearchItem,
  type PublicTopNavKey,
} from '../lib/public-navigation';
import { getToken } from '../lib/auth';
import { UynisLogo } from './UynisLogo';

type PublicShellMode = 'landing' | 'login' | 'signup';

type PublicShellProps = {
  children: ReactNode;
  mode?: PublicShellMode;
  hideHeader?: boolean;
  className?: string;
  activeTopNav?: PublicTopNavKey;
  searchModel?: {
    items: PublicSearchItem[];
    placeholder?: string;
  };
};

export function PublicShell(props: PublicShellProps) {
  const {
    children,
    mode = 'landing',
    hideHeader = false,
    className,
    activeTopNav,
    searchModel,
  } = props;
  const pathname = usePathname();
  const searchRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [hasToken, setHasToken] = useState(false);

  const activeNav =
    activeTopNav ??
    PUBLIC_TOP_NAV_LINKS.find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )?.key;

  const searchResults = useMemo(() => {
    if (!searchModel || !searchOpen) {
      return [];
    }
    return matchPublicSearchItems(searchModel.items, searchQuery).slice(0, 8);
  }, [searchModel, searchOpen, searchQuery]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const syncToken = () => setHasToken(Boolean(getToken()));
    syncToken();
    window.addEventListener('storage', syncToken);
    window.addEventListener('focus', syncToken);
    return () => {
      window.removeEventListener('storage', syncToken);
      window.removeEventListener('focus', syncToken);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const updateTheme = () => setTheme(media.matches ? 'light' : 'dark');
    updateTheme();
    media.addEventListener('change', updateTheme);
    return () => media.removeEventListener('change', updateTheme);
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    const handleOutside = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [searchOpen]);

  const shellClassName = [
    'site-shell',
    hideHeader ? 'public-shell' : '',
    hideHeader ? 'site-shell--auth' : '',
    className ?? '',
  ]
    .join(' ')
    .trim();

  const mainClassName = [
    'site-main',
    hideHeader ? 'public-main' : '',
    hideHeader ? 'site-main-full public-main-full' : '',
  ]
    .join(' ')
    .trim();

  return (
    <div className={shellClassName}>
      <div className="site-frame">
        {hideHeader ? null : (
          <div className="site-topbars">
            <header className="site-topbar">
              <Link className="site-brand-link" href="/" aria-label="Uynis">
                <UynisLogo
                  className="site-brand-logo"
                  variant={theme === 'light' ? 'light' : 'dark'}
                />
              </Link>
              <div className="site-topbar-left">
                <nav className="site-topnav" aria-label="Public">
                  {PUBLIC_TOP_NAV_LINKS.map((item) => (
                    <Link
                      key={item.key}
                      className={`site-topnav-link ${activeNav === item.key ? 'active' : ''}`.trim()}
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
                {searchModel ? (
                  <div className="site-search" ref={searchRef}>
                    <span className="site-search-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <circle cx="11" cy="11" r="6.5" />
                        <path d="M16 16l4 4" />
                      </svg>
                    </span>
                    <input
                      type="search"
                      className="site-search-input"
                      placeholder={searchModel.placeholder ?? 'Search product, help, and policy'}
                      value={searchQuery}
                      onFocus={() => setSearchOpen(true)}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setSearchOpen(true);
                      }}
                    />
                    {searchOpen && searchResults.length > 0 ? (
                      <div className="site-search-menu" role="listbox">
                        {searchResults.map((item) => (
                          <Link
                            key={item.id}
                            href={item.href}
                            className="site-search-option"
                            onClick={() => setSearchOpen(false)}
                          >
                            <span>{item.label}</span>
                            {item.description ? <small>{item.description}</small> : null}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="site-topbar-right">
                {hasToken ? (
                  <Link className="primary" href="/dashboard">
                    Dashboard
                  </Link>
                ) : (
                  <>
                    {mode === 'login' ? (
                      <Link className="ghost" href="/signup">
                        Create account
                      </Link>
                    ) : mode === 'signup' ? (
                      <Link className="ghost" href="/login">
                        Log in
                      </Link>
                    ) : (
                      <>
                        <Link className="ghost" href="/login">
                          Log in
                        </Link>
                        <Link className="primary" href="/signup">
                          Create account
                        </Link>
                      </>
                    )}
                  </>
                )}
              </div>
            </header>
          </div>
        )}
        <main className={mainClassName}>
          {hideHeader ? (
            children
          ) : (
            <div className="site-canvas">
              <div className="site-canvas-inner">{children}</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
