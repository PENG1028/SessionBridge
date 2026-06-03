// ─── Session Persistence Store (IndexedDB + localStorage) ─────

export interface Block {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'unknown';
  semantic: string;
  toolName: string;
  detail: string;
  output: string;
  content: string;
  args?: Record<string, unknown>;
  isComplete: boolean;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  blocks?: Block[];
  timestamp: number;
}

export interface StoredSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// localStorage keys
export const LS_ACTIVE_SESSION = 'bridge-active-session';
export const LS_SESSIONS_META = 'bridge-sessions-metadata';
export const LS_MESSAGES_CACHE = 'bridge-messages';

const DB_NAME = 'sessionbridge-db';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

class SessionStore {
  private db: IDBDatabase | null = null;
  private dbReady: Promise<void>;

  constructor() {
    this.dbReady = this.initDB();
  }

  private async initDB(): Promise<void> {
    try {
      this.db = await openDB();
    } catch (_e) {
      this.db = null; // IndexedDB unavailable (private browsing, etc.)
    }
  }

  private async ensureDB(): Promise<IDBDatabase | null> {
    await this.dbReady;
    return this.db;
  }

  // ─── Session metadata (localStorage) ───

  listSessions(): StoredSession[] {
    try {
      const raw = localStorage.getItem(LS_SESSIONS_META);
      return raw ? JSON.parse(raw) : [];
    } catch (_e) {
      return [];
    }
  }

  getSession(id: string): StoredSession | undefined {
    return this.listSessions().find(s => s.id === id);
  }

  saveSessionMeta(session: StoredSession): void {
    const sessions = this.listSessions();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) sessions[idx] = session;
    else sessions.push(session);
    try {
      localStorage.setItem(LS_SESSIONS_META, JSON.stringify(sessions));
    } catch (_e) { /* quota exceeded */ }
  }

  deleteSession(id: string): void {
    const sessions = this.listSessions().filter(s => s.id !== id);
    try {
      localStorage.setItem(LS_SESSIONS_META, JSON.stringify(sessions));
    } catch (_e) { /* ignore */ }
    // Also remove from IndexedDB
    this.clearMessages(id).catch(() => {});
  }

  // ─── Messages (IndexedDB) ───

  async loadMessages(sessionId: string): Promise<Message[]> {
    const db = await this.ensureDB();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(sessionId);
      req.onsuccess = () => {
        const data = req.result;
        resolve(data?.messages ?? []);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async appendMessage(sessionId: string, message: Message): Promise<void> {
    const db = await this.ensureDB();
    if (!db) return;
    const existing = await this.loadMessages(sessionId);
    existing.push(message);
    return this.replaceMessages(sessionId, existing);
  }

  async replaceMessages(sessionId: string, messages: Message[]): Promise<void> {
    const db = await this.ensureDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ id: sessionId, messages });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clearMessages(sessionId: string): Promise<void> {
    const db = await this.ensureDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(sessionId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ─── Active session ID (localStorage) ───

  getActiveSessionId(): string | null {
    try {
      return localStorage.getItem(LS_ACTIVE_SESSION);
    } catch (_e) {
      return null;
    }
  }

  setActiveSessionId(id: string | null): void {
    try {
      if (id) localStorage.setItem(LS_ACTIVE_SESSION, id);
      else localStorage.removeItem(LS_ACTIVE_SESSION);
    } catch (_e) { /* ignore */ }
  }
}

export const sessionStore = new SessionStore();
