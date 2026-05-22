'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

// ─── Navigation item ───────────────────────────────────────────
export interface NavItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

// ─── Icon mapping (subset of lucide icons) ─────────────────────
// In a full implementation this would use lucide-react icons directly.
// For now we use a simple text-based mapping.
function NavIcon({ icon }: { icon: string }) {
  const iconMap: Record<string, string> = {
    'layout-dashboard': '▣',
    server: '▨',
    terminal: '▩',
    puzzle: '▧',
    'scroll-text': '▮',
    'check-circle': '○',
    settings: '⚙',
    shield: '◈',
    bot: '⬡',
  };

  return (
    <span className="w-5 text-center text-base" aria-hidden="true">
      {iconMap[icon] || '●'}
    </span>
  );
}

// ─── Sidebar Props ─────────────────────────────────────────────
interface SidebarProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  children?: ReactNode;
}

/**
 * Sidebar — left navigation sidebar.
 * Contains primary navigation items and plugin panel entries.
 * Supports collapsed/expanded state (saved to localStorage as UI preference).
 */
export function Sidebar({ activeRoute, onNavigate, children }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Core navigation items
  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', route: '/dashboard' },
    { id: 'nodes', label: 'Nodes', icon: 'server', route: '/nodes' },
    { id: 'sessions', label: 'Sessions', icon: 'terminal', route: '/sessions' },
    { id: 'plugins', label: 'Plugins', icon: 'puzzle', route: '/plugins' },
    { id: 'logs', label: 'Logs & Audit', icon: 'scroll-text', route: '/logs' },
    { id: 'approvals', label: 'Approvals', icon: 'check-circle', route: '/approvals' },
    { id: 'settings', label: 'Settings', icon: 'settings', route: '/settings' },
    { id: 'access-control', label: 'Access Control', icon: 'shield', route: '/access-control' },
    { id: 'ai', label: 'AI / Agents', icon: 'bot', route: '/ai' },
  ];

  const width = collapsed ? 'w-12' : 'w-56';

  return (
    <nav className={`${width} border-r border-gray-800 bg-gray-900 flex flex-col transition-all duration-200 flex-shrink-0 overflow-hidden`}>
      {/* Navigation items */}
      <div className="flex-1 overflow-y-auto py-2">
        {navItems.map(item => {
          const isActive = activeRoute === item.route;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.route)}
              className={`
                w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors
                ${isActive
                  ? 'bg-blue-900/30 text-blue-400 border-r-2 border-blue-500'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }
                ${collapsed ? 'justify-center px-0' : ''}
              `}
              title={collapsed ? item.label : undefined}
            >
              <NavIcon icon={item.icon} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}

        {/* Extra sidebar content (plugin panels, etc) */}
        {!collapsed && children && (
          <>
            <div className="border-t border-gray-800 my-2" />
            {children}
          </>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="border-t border-gray-800 p-3 text-gray-500 hover:text-gray-300 hover:bg-gray-800 text-xs transition-colors"
      >
        {collapsed ? '▶' : '◀ Collapse'}
      </button>
    </nav>
  );
}
