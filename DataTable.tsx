import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  width?: number | string;
  className?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  isSelected?: (row: T) => boolean;
  emptyText: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isSelected,
  emptyText,
}: DataTableProps<T>) {
  const data = rows ?? [];

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={column.width !== undefined ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, index) => {
              const selected = isSelected?.(row) ?? false;
              const className =
                [onRowClick && styles.clickable, selected && styles.selected]
                  .filter(Boolean)
                  .join(' ') || undefined;

              return (
                <tr
                  key={rowKey(row, index)}
                  className={className}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={column.className}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
