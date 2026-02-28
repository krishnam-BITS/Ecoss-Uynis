'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { UynisLogo } from './UynisLogo';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

type AuthSplitLayoutProps = {
  intro: ReactNode;
  children: ReactNode;
  frameClassName?: string;
};

export function AuthSplitLayout({
  intro,
  children,
  frameClassName,
}: AuthSplitLayoutProps) {
  const pathname = usePathname();
  const languageRef = useRef<HTMLDivElement | null>(null);
  const languageButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [language, setLanguage] = useState('English');
  const [languageWidth, setLanguageWidth] = useState<number | null>(null);

  const languages = useMemo(() => ['English', 'Hindi'], []);
  const helpHref = useMemo(() => {
    if (pathname.startsWith('/signup')) {
      return '/help#help-signup';
    }
    if (pathname.startsWith('/forgot-id') || pathname.startsWith('/forgot-password')) {
      return '/help#help-password';
    }
    if (pathname.startsWith('/private')) {
      return '/help#help-private';
    }
    return '/help#help-login';
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const updateWidth = () => {
      const button = languageButtonRef.current;
      if (!button) {
        return;
      }
      const computed = window.getComputedStyle(button);
      const font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }
      context.font = font;
      let maxWidth = 0;
      for (const option of languages) {
        maxWidth = Math.max(maxWidth, context.measureText(option).width);
      }
      const iconWidth = 20;
      const gap = 8;
      const padding = 4;
      setLanguageWidth(Math.ceil(maxWidth + iconWidth + gap + padding));
    };
    updateWidth();
    if (document.fonts?.ready) {
      document.fonts.ready.then(updateWidth).catch(() => null);
    }
  }, [languages]);

  useEffect(() => {
    if (!isLanguageOpen) {
      return;
    }
    const handleOutside = (event: MouseEvent) => {
      if (!languageRef.current?.contains(event.target as Node)) {
        setIsLanguageOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsLanguageOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isLanguageOpen]);

  return (
    <div className="login-page">
      <div className={`login-frame ${frameClassName ?? ''}`.trim()}>
        <section className="login-panel">
          <div className="login-panel-top">
            <Link className="login-logo-link" href="/">
              <UynisLogo variant="light" className="login-logo login-logo-light" />
              <UynisLogo variant="dark" className="login-logo login-logo-dark" />
            </Link>
            <div className="login-intro">{intro}</div>
          </div>
          <div className="login-panel-footer">
            <div
              className="login-language-wrap"
              ref={languageRef}
              style={languageWidth ? { width: languageWidth } : undefined}
            >
              <button
                className="login-language"
                type="button"
                ref={languageButtonRef}
                aria-haspopup="listbox"
                aria-expanded={isLanguageOpen}
                onClick={() => setIsLanguageOpen((open) => !open)}
              >
                <span>{language}</span>
                <ChevronDownIcon />
              </button>
              {isLanguageOpen ? (
                <div className="login-language-menu" role="listbox">
                  {languages.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="option"
                      aria-selected={option === language}
                      className="login-language-option"
                      onClick={() => {
                        setLanguage(option);
                        setIsLanguageOpen(false);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="login-panel-links">
              <Link className="login-link" href={helpHref}>
                Help
              </Link>
              <Link className="login-link" href="/terms#terms">
                Terms
              </Link>
            </div>
          </div>
        </section>
        <section className="login-form">{children}</section>
      </div>
    </div>
  );
}
