'use client';

import { Sparkles } from 'lucide-react';
import { registerView, registerAdapterMapping, registerAdapterMeta } from '../../app/console/main/view-registry';
import { ClaudeChatView } from '../../app/console/main/claude-chat-view';

registerView('claude-chat', {
  component: ClaudeChatView,
  meta: {
    title: 'Claude Chat',
    icon: Sparkles,
    viewType: 'main.editor',
    pluginId: 'claude-code',
    sidebarRequirements: { left: 'auto', right: 'shown' },
    openMode: 'instance-bound',
  },
});

registerAdapterMapping('claude-code', 'claude-chat');
registerAdapterMeta('claude-code', { icon: Sparkles, label: 'Claude Code', emoji: '💬' });

// Tasks panel is now declared in claude-code/sb-extension.json contributes.views
// and its React component is registered via register-panel-components.ts.
// The manifest provides id/title/icon/when; core provides the component override.
