import type { ReactNode } from 'react';

type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  headerClassName?: string;
  cellClassName?: string;
};

type DataTableProps<T> = {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  className?: string;
  tableClassName?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'No records available.',
  className,
  tableClassName,
}: DataTableProps<T>) {
  const wrapClass = ['portal-table-wrap', className].filter(Boolean).join(' ');
  const tableClass = ['portal-table', tableClassName].filter(Boolean).join(' ');

  return (
    <div className={wrapClass}>
      <table className={tableClass}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={[
                  column.headerClassName,
                  column.align ? `is-${column.align}` : undefined,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={[
                      column.cellClassName,
                      column.align ? `is-${column.align}` : undefined,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="repo-data-table-empty" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
