'use client';

import { Terminal as TerminalIcon } from 'lucide-react';
import { registerView, registerAdapterMapping, registerAdapterMeta } from '../../app/console/main/view-registry';
import { TerminalView } from '../../app/console/main/terminal-view';

registerView('terminal', {
  component: TerminalView,
  meta: { title: 'Terminal', icon: TerminalIcon, sidebarRequirements: { left: 'auto', right: 'auto' } },
});

registerAdapterMapping('shell', 'terminal');
registerAdapterMeta('shell', { icon: TerminalIcon, label: 'Terminal', emoji: '⌨' });
