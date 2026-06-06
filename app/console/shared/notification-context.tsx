'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { getNotificationBridge } from './notification-bridge';

export interface AppNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface NotificationContextValue {
  notifications: AppNotification[];
  notify: (n: Omit<AppNotification, 'id'> & { id?: string }) => void;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  notify: () => {},
  dismiss: () => {},
});

let _nextId = 0;
function nextId() {
  return `ntf_${++_nextId}_${Date.now().toString(36)}`;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const notify = useCallback((n: Omit<AppNotification, 'id'> & { id?: string }) => {
    const id = n.id || nextId();
    // If server-assigned id already exists, update in-place
    if (n.id) {
      setNotifications(prev => {
        const existing = prev.find(x => x.id === n.id);
        if (existing) {
          return prev.map(x => x.id === n.id ? { ...x, ...n, id: n.id! } : x);
        }
        return [...prev.slice(-4), { ...n, id: n.id! } as AppNotification];
      });
    } else {
      const notification: AppNotification = { ...n, id } as AppNotification;
      setNotifications(prev => [...prev.slice(-4), notification]);
    }
    const dur = n.duration ?? 4000;
    if (dur > 0) {
      setTimeout(() => dismiss(id), dur);
    }
    // Fire native OS notification if shell supports it (Electron / Capacitor / Web)
    getNotificationBridge().show({ ...n, id } as AppNotification);
  }, [dismiss]);

  return (
    <NotificationContext.Provider value={{ notifications, notify, dismiss }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  return useContext(NotificationContext);
}
