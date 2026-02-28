import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonAsButton = {
  href?: undefined;
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

type ButtonAsLink = {
  href: string;
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button({
  className,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  ...props
}: ButtonProps) {
  const classes = [
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    fullWidth ? 'ui-button--full' : '',
    className ?? '',
  ]
    .join(' ')
    .trim();

  if ('href' in props && props.href) {
    const { children, href, ...anchorProps } = props;
    return (
      <Link className={classes} href={href} {...anchorProps}>
        {children}
      </Link>
    );
  }

  const { children, type = 'button', ...buttonProps } = props as ButtonAsButton;
  return (
    <button className={classes} type={type} {...buttonProps}>
      {children}
    </button>
  );
}

