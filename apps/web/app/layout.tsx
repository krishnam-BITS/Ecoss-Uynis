import { Suspense } from 'react';
import './globals.css';

export const metadata = {
  title: 'Uynis',
  description: 'Git hosting and collaboration',
};
export const dynamic = 'force-dynamic';

const THEME_INIT_SCRIPT = `
(() => {
  const root = document.documentElement;
  root.style.visibility = 'hidden';
  root.setAttribute('data-theme-pending', 'true');
  try {
    root.setAttribute('data-app-ready', 'false');
    const key = 'uynis-theme';
    const stored = localStorage.getItem(key);
    const theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  } catch {
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  } finally {
    root.setAttribute('data-theme-pending', 'false');
    root.style.visibility = '';
  }
  const markReady = () => root.setAttribute('data-app-ready', 'true');
  if (document.readyState === 'complete') {
    markReady();
  } else {
    window.addEventListener('load', markReady, { once: true });
    window.setTimeout(markReady, 2500);
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-app-ready="false"
      data-theme-pending="true"
      style={{ visibility: 'hidden' }}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <noscript>
          <style>{'html{visibility:visible !important;}'}</style>
        </noscript>
      </head>
      <body suppressHydrationWarning>
        <div className="noise" aria-hidden="true" />
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  );
}
