'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

const FORM_FIELD_SELECTOR = [
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
].join(',');

let scrollLockDepth = 0;
let previousBodyOverflow = '';
let previousBodyPaddingRight = '';

const lockBodyScroll = () => {
  if (typeof document === 'undefined') {
    return () => undefined;
  }

  const { body, documentElement } = document;

  if (scrollLockDepth === 0) {
    previousBodyOverflow = body.style.overflow;
    previousBodyPaddingRight = body.style.paddingRight;

    const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }

  scrollLockDepth += 1;

  return () => {
    scrollLockDepth = Math.max(0, scrollLockDepth - 1);
    if (scrollLockDepth === 0) {
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
    }
  };
};

const getFocusableElements = (container: HTMLElement | null) => {
  if (!container) {
    return [] as HTMLElement[];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
  );
};

const useOverlayRoot = (enabled: boolean) => {
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      setOverlayRoot(null);
      return;
    }

    const shellRoot = document.getElementById('portal-overlay-root');
    if (shellRoot instanceof HTMLElement) {
      setOverlayRoot(shellRoot);
      return;
    }

    const existingGlobalRoot = document.getElementById('portal-overlay-root-global');
    if (existingGlobalRoot instanceof HTMLElement) {
      setOverlayRoot(existingGlobalRoot);
      return;
    }

    const globalRoot = document.createElement('div');
    globalRoot.id = 'portal-overlay-root-global';
    globalRoot.dataset.shell = 'global';
    globalRoot.className = 'portal-theme-scope';
    document.body.appendChild(globalRoot);
    setOverlayRoot(globalRoot);
  }, [enabled]);

  return overlayRoot;
};

type PortalOverlayProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
  closeLabel?: string;
  size?: 'default' | 'wide';
  initialFocusRef?: RefObject<HTMLElement | null>;
};

type PortalOverlayVariant = 'modal' | 'drawer-right';

function PortalOverlay({
  variant,
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  panelClassName,
  bodyClassName,
  closeLabel = 'Close dialog',
  size = 'default',
  initialFocusRef,
}: PortalOverlayProps & { variant: PortalOverlayVariant }) {
  const overlayRoot = useOverlayRoot(open);
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const panelClasses = useMemo(
    () =>
      [
        'portal-overlay-panel',
        'portal-overlay',
        variant === 'drawer-right'
          ? 'portal-overlay-panel--drawer portal-drawer portalDrawer'
          : 'portal-overlay-panel--modal portal-modal portalModal',
        size === 'wide' ? 'portal-overlay-panel--wide' : '',
        panelClassName ?? '',
      ]
        .join(' ')
        .trim(),
    [panelClassName, size, variant],
  );

  const bodyClasses = useMemo(
    () =>
      ['portal-overlay-body', 'portal-modal__body', 'portalModalBody', 'portalScrollArea', bodyClassName ?? '']
        .join(' ')
        .trim(),
    [bodyClassName],
  );

  useEffect(() => {
    if (!open || !overlayRoot) {
      return;
    }

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const unlockScroll = lockBodyScroll();

    const focusTimer = window.setTimeout(() => {
      const initialFocus = initialFocusRef?.current;
      if (initialFocus) {
        initialFocus.focus({ preventScroll: true });
        return;
      }
      const firstFormField = panelRef.current?.querySelector<HTMLElement>(FORM_FIELD_SELECTOR);
      if (firstFormField) {
        firstFormField.focus({ preventScroll: true });
        return;
      }
      const focusableElements = getFocusableElements(panelRef.current);
      if (focusableElements.length) {
        focusableElements[0].focus({ preventScroll: true });
        return;
      }
      panelRef.current?.focus({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!panelRef.current) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements(panelRef.current);
      if (!focusableElements.length) {
        event.preventDefault();
        panelRef.current.focus({ preventScroll: true });
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      const activeInside = activeElement instanceof HTMLElement && panelRef.current.contains(activeElement);

      if (event.shiftKey) {
        if (!activeInside || activeElement === firstFocusable) {
          event.preventDefault();
          lastFocusable.focus({ preventScroll: true });
        }
        return;
      }

      if (!activeInside || activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      unlockScroll();

      const previousActive = previousActiveElementRef.current;
      if (previousActive && typeof previousActive.focus === 'function') {
        window.setTimeout(() => {
          previousActive.focus({ preventScroll: true });
        }, 0);
      }
    };
  }, [initialFocusRef, open, overlayRoot]);

  if (!open || !overlayRoot) {
    return null;
  }

  return createPortal(
    <div className={`portal-overlay-layer portal-overlay-layer--${variant}`} role="presentation">
      <button
        type="button"
        className="portal-overlay-backdrop"
        aria-label={closeLabel}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        className={panelClasses}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="portal-overlay-head portal-modal__header portalModalHeader">
          <div className="portal-overlay-head-copy">
            <h2 id={titleId} className="portal-overlay-title">
              {title}
            </h2>
            {subtitle ? <p className="portal-overlay-subtitle">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="portal-overlay-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            &times;
          </button>
        </header>
        <div className={bodyClasses}>{children}</div>
        {footer ? (
          <footer className="portal-overlay-footer portal-modal__footer portalModalFooter">{footer}</footer>
        ) : null}
      </section>
    </div>,
    overlayRoot,
  );
}

export function PortalModal(props: PortalOverlayProps) {
  return <PortalOverlay variant="modal" {...props} />;
}

export function PortalDrawer(props: PortalOverlayProps) {
  return <PortalOverlay variant="drawer-right" {...props} />;
}

