'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CoreClient } from '../core/core-types';
import { Table } from '../components/Table';
import type { TableColumn } from '../components/Table';
import { EmptyState } from '../components/EmptyState';

interface InfoTableProps {
  core: CoreClient;
  method: string;
  params?: Record<string, unknown>;
  columns: TableColumn<Record<string, unknown>>[];
  emptyMessage?: string;
  refreshInterval?: number;
  renderActions?: (row: Record<string, unknown>) => React.ReactNode;
}

export function InfoTable({
  core,
  method,
  params,
  columns,
  emptyMessage,
  refreshInterval = 0,
  renderActions,
}: InfoTableProps) {
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    let cancelled = false;
    core.call<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(method, params || {})
      .then(result => {
        if (cancelled) return;
        const items = Array.isArray(result) ? result : (result as { items?: Record<string, unknown>[] })?.items ?? [];
        setData(items as Record<string, unknown>[]);
        setLoading(false);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [core, method, JSON.stringify(params)]);

  useEffect(() => {
    const cancel = fetchData();
    return cancel;
  }, [fetchData]);

  useEffect(() => {
    if (refreshInterval <= 0) return;
    const timer = setInterval(fetchData, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, fetchData]);

  if (error) {
    return <div className="p-4 text-[11px] text-red-400">{error}</div>;
  }

  const allColumns: TableColumn<Record<string, unknown>>[] = renderActions
    ? [...columns, {
        key: '_actions',
        label: '',
        render: (_, row) => renderActions(row),
        className: 'text-right',
      }]
    : columns;

  return data.length === 0 && !loading ? (
    <EmptyState message={emptyMessage || 'No items'} />
  ) : (
    <Table columns={allColumns} data={data} loading={loading} emptyMessage={emptyMessage} />
  );
}
