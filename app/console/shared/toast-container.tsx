'use client';

import { useEffect, useState } from 'react';
import { X, Info, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import { useNotification, type AppNotification } from './notification-context';

const iconMap: Record<AppNotification['type'], typeof Info> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
};

const colorMap: Record<AppNotification['type'], string> = {
  info: 'border-cyan-800/40 bg-cyan-950/60 text-cyan-300',
  success: 'border-emerald-800/40 bg-emerald-950/60 text-emerald-300',
  warning: 'border-amber-800/40 bg-amber-950/60 text-amber-300',
  error: 'border-red-800/40 bg-red-950/60 text-red-300',
};

function Toast({ n }: { n: AppNotification }) {
  const { dismiss } = useNotification();
  const [entering, setEntering] = useState(true);
  const Icon = iconMap[n.type];

  useEffect(() => {
    requestAnimationFrame(() => setEntering(false));
  }, []);

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border shadow-lg shadow-black/30 backdrop-blur-sm transition-all duration-300 ${colorMap[n.type]} ${
        entering ? 'opacity-0 translate-x-4 scale-95' : 'opacity-100 translate-x-0 scale-100'
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold">{n.title}</div>
        {n.message && <div className="text-[10px] opacity-80 mt-0.5">{n.message}</div>}
        {n.action && (
          <button
            onClick={n.action.onClick}
            className="text-[9px] underline hover:opacity-80 mt-0.5"
          >
            {n.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => dismiss(n.id)}
        className="text-[10px] opacity-50 hover:opacity-100 shrink-0 mt-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { notifications } = useNotification();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 w-72 pointer-events-none">
      {notifications.map(n => (
        <div key={n.id} className="pointer-events-auto">
          <Toast n={n} />
        </div>
      ))}
    </div>
  );
}
