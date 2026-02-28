import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type PortalActionButtonProps = {
  children: ReactNode;
  href?: undefined;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

type PortalActionLinkProps = {
  children: ReactNode;
  href: string;
  className?: string;
};

type PortalActionProps = PortalActionButtonProps | PortalActionLinkProps;

export function PortalAction(props: PortalActionProps) {
  const className = `inbox-action ${props.className ?? ''}`.trim();

  if ('href' in props && props.href) {
    return (
      <Link className={className} href={props.href}>
        {props.children}
      </Link>
    );
  }

  const { children, href: _href, className: _className, ...buttonProps } = props as PortalActionButtonProps;
  return (
    <button className={className} type="button" {...buttonProps}>
      {children}
    </button>
  );
}
