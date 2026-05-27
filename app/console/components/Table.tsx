'use client';

import { cn } from './cn';
import { Spinner } from './Spinner';

export interface TableColumn<T> {
  key: string;
  label: string;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  loading,
  emptyMessage = 'No data',
  onRowClick,
  className,
}: TableProps<T>) {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full">
        <thead>
          <tr className="text-left text-gray-500 text-[10px] border-b border-gray-800 tracking-wider uppercase">
            {columns.map(col => (
              <th key={col.key} className={cn('px-2 py-1.5 font-medium', col.className)}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center text-gray-600 text-[10px] py-6">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={(row.id ?? row.key ?? i) as string}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-gray-800/50 text-gray-400 text-xs',
                  onRowClick && 'cursor-pointer hover:bg-gray-800/30',
                )}
              >
                {columns.map(col => (
                  <td key={col.key} className={cn('px-2 py-1.5', col.className)}>
                    {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
