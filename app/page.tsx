'use client';

export const dynamic = 'force-dynamic';

import { ensureBootstrapped } from './console/bootstrap';
import { CoreClientProvider } from './console/core/core-client-provider';
import { CoreErrorProvider } from './console/core/core-error-provider';
import { LayoutProvider } from './console/workbench';
import { useCoreConnection } from './console/core/use-core-connection';
import { ConsoleController } from './console/controller/ConsoleController';

ensureBootstrapped();

export default function Page() {
  return (
    <LayoutProvider>
      <PageContent />
    </LayoutProvider>
  );
}

function PageContent() {
  const { wsUrl, setWsUrl, token, setToken, reconnectKey, triggerReconnect, isLocalPage, browserId } = useCoreConnection();
  return (
    <CoreClientProvider forceOffline={false} reconnectKey={reconnectKey}>
      <CoreErrorProvider>
        <ConsoleController
          wsUrl={wsUrl}
          setWsUrl={setWsUrl}
          token={token}
          setToken={setToken}
          onReconnect={triggerReconnect}
          isLocalPage={isLocalPage}
          browserId={browserId}
        />
      </CoreErrorProvider>
    </CoreClientProvider>
  );
}
