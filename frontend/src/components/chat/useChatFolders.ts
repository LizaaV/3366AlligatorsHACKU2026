/**
 * Chat "projects" (folders) and which chat sits in which.
 *
 * Client-side only for now, persisted to localStorage.
 * TODO(api): once threads are on the server (PR #49), add a `folder_id` to the thread and a
 * folders endpoint, then replace this hook's storage with calls — the hook's shape can stay.
 */

import { useCallback, useEffect, useState } from 'react';

export interface ChatFolder {
  id: string;
  name: string;
}

interface Saved {
  folders: ChatFolder[];
  /** thread id -> folder id. A thread with no entry is "uncategorised". */
  assign: Record<string, string>;
}

const KEY = 'gt.chat.folders';
const EMPTY: Saved = { folders: [], assign: {} };

const read = (): Saved => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<Saved>;
    return { folders: Array.isArray(p.folders) ? p.folders : [], assign: p.assign && typeof p.assign === 'object' ? p.assign : {} };
  } catch {
    return EMPTY;
  }
};

const newId = () => `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

export function useChatFolders() {
  const [state, setState] = useState<Saved>(read);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: folders last for this session only */
    }
  }, [state]);

  const createFolder = useCallback((name: string) => {
    const f: ChatFolder = { id: newId(), name: name.trim() || 'New project' };
    setState((s) => ({ ...s, folders: [...s.folders, f] }));
    return f;
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setState((s) => ({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, name: n } : f)) }));
  }, []);

  /** Deleting a project does not delete its chats; they go back to "Chats". */
  const deleteFolder = useCallback((id: string) => {
    setState((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      assign: Object.fromEntries(Object.entries(s.assign).filter(([, fid]) => fid !== id)),
    }));
  }, []);

  const moveThread = useCallback((threadId: string, folderId: string | null) => {
    setState((s) => {
      const assign = { ...s.assign };
      if (folderId) assign[threadId] = folderId;
      else delete assign[threadId];
      return { ...s, assign };
    });
  }, []);

  const folderOf = useCallback((threadId: string) => state.assign[threadId] ?? null, [state.assign]);

  return { folders: state.folders, createFolder, renameFolder, deleteFolder, moveThread, folderOf };
}
