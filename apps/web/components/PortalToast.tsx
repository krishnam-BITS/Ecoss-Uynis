'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type PortalToastTone = 'success' | 'error' | 'warning' | 'info';

export function PortalToast({
  message,
  tone = 'info',
  onClose,
  autoCloseMs = 3600,
}: {
  message: string;
  tone?: PortalToastTone;
  onClose: () => void;
  autoCloseMs?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [toastContainer, setToastContainer] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
    if (typeof document !== 'undefined') {
      let root = document.getElementById('portal-overlay-root');
      if (!(root instanceof HTMLElement)) {
        const existingGlobalRoot = document.getElementById('portal-overlay-root-global');
        if (existingGlobalRoot instanceof HTMLElement) {
          root = existingGlobalRoot;
        } else {
          const globalRoot = document.createElement('div');
          globalRoot.id = 'portal-overlay-root-global';
          globalRoot.dataset.shell = 'global';
          globalRoot.className = 'portal-theme-scope';
          document.body.appendChild(globalRoot);
          root = globalRoot;
        }
      }

      if (root instanceof HTMLElement) {
        let stack = root.querySelector<HTMLElement>('#portal-toast-stack');
        if (!(stack instanceof HTMLElement)) {
          stack = document.createElement('div');
          stack.id = 'portal-toast-stack';
          stack.className = 'portal-toast-stack';
          root.appendChild(stack);
        }
        setToastContainer(stack);
      }
    }
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!autoCloseMs || autoCloseMs <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, autoCloseMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [autoCloseMs, message, tone]);

  const toneLabel =
    tone === 'success'
      ? 'Success'
      : tone === 'error'
        ? 'Error'
        : tone === 'warning'
          ? 'Warning'
        : 'Notice';

  if (!mounted || !toastContainer) {
    return null;
  }

  return createPortal(
    <div className="portal-toast-overlay" role="presentation">
      <div
        className={`portal-toast portal-toast-${tone}`}
        role={tone === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        <div className="portal-toast-body">
          <strong className="portal-toast-label">{toneLabel}</strong>
          <span>{message}</span>
        </div>
        <button
          className="portal-toast-close"
          type="button"
          onClick={onClose}
          aria-label="Close message"
        >
          &times;
        </button>
      </div>
    </div>,
    toastContainer,
  );
}

