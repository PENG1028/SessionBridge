'use client';

import { Sparkles } from 'lucide-react';
import { registerView, registerAdapterMapping, registerAdapterMeta } from '../../app/console/main/view-registry';
import { registerPanel } from '../../app/console/panels/panel-registry';
import { TaskPanel } from '../../app/console/panels/task-panel';
import { ClaudeChatView } from '../../app/console/main/claude-chat-view';

registerView('claude-chat', {
  component: ClaudeChatView,
  meta: { title: 'Claude Chat', icon: Sparkles, sidebarRequirements: { left: 'auto', right: 'shown' } },
});

registerAdapterMapping('claude-code', 'claude-chat');
registerAdapterMeta('claude-code', { icon: Sparkles, label: 'Claude Code', emoji: '💬' });

// Tasks panel — registered here because it's claude-code specific
registerPanel({ id: 'tasks', side: 'right', title: 'Tasks', order: 10, component: TaskPanel });
