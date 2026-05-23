'use client';

import React from 'react';
import { Bell } from 'lucide-react';

/**
 * NotificationEntry — minimal notification entry point.
 * In Phase 1 this is a simple indicator.
 * Phase 2 will add: notify.list, notify.markRead, WebSocket notify.event subscription.
 *
 * Core API: notify.*
 * Surface: notification.center
 */
export function NotificationEntry() {
  return (
    <div className="relative">
      <button
        className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors relative"
        title="Notifications"
      >
        <Bell size={16} />
        {/* Unread badge — Phase 2: from notify.list */}
        <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full" />
      </button>
    </div>
  );
}
