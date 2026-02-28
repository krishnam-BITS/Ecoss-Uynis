'use client';

import type { ReactNode } from 'react';
import { PortalModal } from '../../../components/portal/PortalModal';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  closeLabel,
  size = 'default',
  panelClassName,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  size?: 'default' | 'wide';
  panelClassName?: string;
  bodyClassName?: string;
}) {
  return (
    <PortalModal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={footer}
      closeLabel={closeLabel}
      size={size}
      panelClassName={['ui-modal', panelClassName ?? ''].join(' ').trim()}
      bodyClassName={['ui-modal__body', bodyClassName ?? ''].join(' ').trim()}
    >
      {children}
    </PortalModal>
  );
}

