/**
 * IndexedDB Durable Local Draft Storage for 3D Dental CAD Annotations.
 * Provides resilient crash & refresh recovery without continuously writing to PostgreSQL.
 */

import type { AnnotationDocument } from '@/src/types/annotation';

const DB_NAME = 'DentalCAD_DraftDB';
const DB_VERSION = 1;
const STORE_NAME = 'annotation_drafts';

interface DraftRecord {
  key: string; // `${userId || 'anon'}:${caseId}`
  caseId: string;
  userId?: string;
  document: AnnotationDocument;
  savedAt: number; // Unix timestamp ms
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof globalThis !== 'undefined' && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    // Ignore error
  }
  return null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not available in this environment'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

function getDraftKey(caseId: string, userId?: string): string {
  return `${userId || 'guest'}:${caseId}`;
}

/**
 * Save draft to IndexedDB with localStorage fallback if IndexedDB is blocked.
 */
export async function saveDraftToStorage(
  caseId: string,
  doc: AnnotationDocument,
  userId?: string
): Promise<void> {
  const key = getDraftKey(caseId, userId);
  const record: DraftRecord = {
    key,
    caseId,
    userId,
    document: doc,
    savedAt: Date.now(),
  };

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback to localStorage if IndexedDB fails (e.g. storage disabled in strict privacy mode or non-browser)
    try {
      const storage = getStorage();
      if (storage) {
        storage.setItem(`cad_draft:${key}`, JSON.stringify(record));
      }
    } catch {
      // Storage unavailable; fail gracefully without crashing UI
    }
  }
}

/**
 * Load draft from IndexedDB (or localStorage fallback).
 */
export async function loadDraftFromStorage(
  caseId: string,
  userId?: string
): Promise<{ document: AnnotationDocument; savedAt: number } | null> {
  const key = getDraftKey(caseId, userId);

  try {
    const db = await openDatabase();
    const record = await new Promise<DraftRecord | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as DraftRecord | undefined);
      req.onerror = () => reject(req.error);
    });

    if (record && record.document) {
      return { document: record.document, savedAt: record.savedAt };
    }
  } catch {
    // Attempt fallback from localStorage
    try {
      const storage = getStorage();
      if (storage) {
        const item = storage.getItem(`cad_draft:${key}`);
        if (item) {
          const parsed = JSON.parse(item) as DraftRecord;
          if (parsed && parsed.document) {
            return { document: parsed.document, savedAt: parsed.savedAt };
          }
        }
      }
    } catch {
      // Ignore fallback error
    }
  }

  return null;
}

/**
 * Clear local draft after confirmed save or explicit user discard.
 */
export async function clearDraftFromStorage(
  caseId: string,
  userId?: string
): Promise<void> {
  const key = getDraftKey(caseId, userId);

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore error
  }

  try {
    const storage = getStorage();
    if (storage) {
      storage.removeItem(`cad_draft:${key}`);
    }
  } catch {
    // Ignore
  }
}
