'use client';

import { ChatLayout } from './components/chat-layout';

// ─── Main entry — ClaudeChatView ────────────────────
// Referenced by plugin.yaml → main.editor surface.
// When no instanceId is bound, ChatLayout shows the
// provider setup or empty state screen. When bound,
// it shows the chat interface.

export function ClaudeChatView({ instanceId }: { instanceId?: string }) {
  return <ChatLayout instanceId={instanceId} />;
}

export default ClaudeChatView;
