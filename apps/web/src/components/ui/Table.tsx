import type { ReactNode, TableHTMLAttributes } from 'react';

export function Table({
  className,
  children,
  ...props
}: {
  className?: string;
  children: ReactNode;
} & TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="ui-table-wrap">
      <table className={['ui-table', className ?? ''].join(' ').trim()} {...props}>
        {children}
      </table>
    </div>
  );
}

