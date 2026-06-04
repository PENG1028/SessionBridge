'use client';

// ═══════════════════════════════════════════════════════════════
// ConsoleController — thin wiring between state/effects/callbacks
// (useConsoleController) and the pure JSX layout (ConsoleLayout).
// This replaces the 1242-line app-shell.tsx God component.
// ═══════════════════════════════════════════════════════════════

import { useConsoleController } from './use-console-controller';
import { ConsoleLayout } from '../layout/ConsoleLayout';

interface AppCoreProps {
  wsUrl: string;
  setWsUrl: (url: string) => void;
  token: string | undefined;
  setToken: React.Dispatch<React.SetStateAction<string | undefined>>;
  onReconnect: () => void;
  isLocalPage: boolean;
  browserId: string | undefined;
}

export function ConsoleController(props: AppCoreProps) {
  const console = useConsoleController(props);
  return <ConsoleLayout {...console} />;
}
