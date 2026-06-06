// ─── Install Manager ─────────────────────────────────────────────
// Manages plugin dependency installation records.
// Reads/writes ~/.sessionbridge/install-history.json.
// Server-side only.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import type { InstallRecord } from './app-registry/app-types';
import { getInstallHistoryFile, ensureBaseDir } from '../../lib/server-state/paths';

const HISTORY_FILE = getInstallHistoryFile();

function readHistory(): Record<string, InstallRecord[]> {
  try {
    if (!existsSync(HISTORY_FILE)) return {};
    const raw = readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (_e) {
    return {};
  }
}

function writeHistory(history: Record<string, InstallRecord[]>): void {
  ensureBaseDir();
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

export function getInstallHistory(appId: string): InstallRecord[] {
  const history = readHistory();
  return history[appId] ?? [];
}

export function getInstallRecord(appId: string, installId: string): InstallRecord | null {
  const records = getInstallHistory(appId);
  return records.find(r => r.installId === installId) ?? null;
}

export function createInstallRecord(
  appId: string,
  checkId: string,
  command: string,
): InstallRecord {
  const record: InstallRecord = {
    installId: randomBytes(6).toString('hex'),
    appId,
    checkId,
    command,
    status: 'running',
    startedAt: Date.now(),
  };

  const history = readHistory();
  if (!history[appId]) history[appId] = [];
  history[appId].push(record);
  writeHistory(history);

  return record;
}

export function updateInstallRecord(
  appId: string,
  installId: string,
  update: Partial<Pick<InstallRecord, 'status' | 'finishedAt' | 'stdout' | 'stderr'>>,
): InstallRecord | null {
  const history = readHistory();
  const records = history[appId];
  if (!records) return null;

  const record = records.find(r => r.installId === installId);
  if (!record) return null;

  Object.assign(record, update);
  writeHistory(history);
  return record;
}

export function deleteInstallRecord(appId: string, installId: string): boolean {
  const history = readHistory();
  const records = history[appId];
  if (!records) return false;

  const idx = records.findIndex(r => r.installId === installId);
  if (idx < 0) return false;

  records.splice(idx, 1);
  writeHistory(history);
  return true;
}
