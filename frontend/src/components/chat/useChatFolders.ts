/**
 * Chat "projects" (folders) and which chat sits in which, kept on the server
 * (`api.projects`, `api.threads.setProject`) so they survive a cleared browser and follow the
 * user to another device.
 *
 * Every change is optimistic: the UI updates at once, the request follows, and a failure rolls the
 * change back and shows a toast. A new project gets a temporary id so the sidebar can rename it
 * and file chats in it before the server has answered; that id stays its stable key for the
 * session, and later calls wait for the real one.
 *
 * Which project a chat is in comes from `ThreadSummary.project_id`; `assign` holds only the
 * moves made in this session that the thread list has not caught up with yet.
 *
 * One-time migration: folders the old version of this hook kept in localStorage are created on
 * the server (and their chats re-filed), then removed from localStorage.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toApiError, usingFixtures, type ThreadSummary } from '../../api';
import { useStore } from '../../state/store';

export interface ChatFolder {
  id: string;
  name: string;
}

/** The id the old localStorage version stored its folders under. */
const LEGACY_KEY = 'gt.chat.folders';

let tempSeq = 0;
const tempId = () => `tmp_${Date.now().toString(36)}_${++tempSeq}`;

interface LegacySaved {
  folders: ChatFolder[];
  assign: Record<string, string>;
}

function readLegacy(): LegacySaved | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LegacySaved>;
    const folders = (Array.isArray(p.folders) ? p.folders : []).filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string');
    const assign = p.assign && typeof p.assign === 'object' ? p.assign : {};
    return { folders, assign };
  } catch {
    return null;
  }
}

function writeLegacy(saved: LegacySaved | null) {
  try {
    if (!saved || saved.folders.length === 0) localStorage.removeItem(LEGACY_KEY);
    else localStorage.setItem(LEGACY_KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable: nothing to clean up */
  }
}

export function useChatFolders(threads: ThreadSummary[] | undefined) {
  const { notify } = useStore();
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  /** thread id -> folder key, or null for "unfiled": moves made here, not yet in `threads`. */
  const [assign, setAssign] = useState<Record<string, string | null>>({});
  /** folder key -> server project id, once known. Keys of server-loaded folders are the id itself. */
  const serverIds = useRef(new Map<string, string>());
  /** folder key -> the create request still in flight. */
  const creating = useRef(new Map<string, Promise<string>>());
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const alive = useRef(true);
  /** Bumped when a server id is learned, so `folderOf` is re-read. */
  const [version, setVersion] = useState(0);

  const fail = useCallback(
    (what: string, err: unknown) => {
      if (!alive.current) return;
      notify(`${what}. ${toApiError(err).userMessage}`, undefined, undefined, 'error');
    },
    [notify],
  );

  /** The server id of a folder, waiting for its create to finish; null if it never existed. */
  const resolve = useCallback(async (key: string): Promise<string | null> => {
    const known = serverIds.current.get(key);
    if (known) return known;
    const pending = creating.current.get(key);
    if (!pending) return null;
    try {
      return await pending;
    } catch {
      return null;
    }
  }, []);

  /* ---------- load, then migrate once ---------- */

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const ac = new AbortController();

    const migrate = async (existing: ChatFolder[]) => {
      const legacy = readLegacy();
      if (!legacy || legacy.folders.length === 0) {
        if (legacy) writeLegacy(null);
        return;
      }
      let remaining = legacy.folders;
      const created: ChatFolder[] = [];
      const moved: Record<string, string> = {};
      for (const f of legacy.folders) {
        let project;
        try {
          project = await api.projects.create(f.name);
        } catch {
          break; // offline or at the cap: keep the rest in localStorage for the next load
        }
        serverIds.current.set(project.id, project.id);
        created.push({ id: project.id, name: project.name });
        for (const [threadId, folderId] of Object.entries(legacy.assign)) {
          if (folderId !== f.id) continue;
          try {
            await api.threads.setProject(threadId, project.id);
            moved[threadId] = project.id;
          } catch {
            /* the chat is gone or the call failed: it simply stays unfiled */
          }
        }
        remaining = remaining.filter((x) => x.id !== f.id);
        writeLegacy({ folders: remaining, assign: legacy.assign });
        if (cancelled) break;
      }
      if (cancelled) return;
      if (created.length) {
        setFolders([...existing, ...created.filter((c) => !existing.some((e) => e.id === c.id))]);
        setAssign((a) => ({ ...a, ...moved }));
      }
    };

    (async () => {
      try {
        const list = await api.projects.list(ac.signal);
        if (cancelled) return;
        const loaded = list.map((p) => ({ id: p.id, name: p.name }));
        for (const p of loaded) serverIds.current.set(p.id, p.id);
        // Keep folders created while the list was loading.
        setFolders((cur) => [...loaded, ...cur.filter((c) => !loaded.some((p) => p.id === c.id))]);
        if (!usingFixtures()) await migrate(loaded);
      } catch (err) {
        if (toApiError(err).kind !== 'aborted') fail('Could not load your projects', err);
      }
    })();

    return () => {
      cancelled = true;
      alive.current = false;
      ac.abort();
    };
  }, [fail]);

  /* ---------- the thread list catches up: drop overrides it already agrees with ---------- */

  useEffect(() => {
    if (!threads) return;
    setAssign((a) => {
      let changed = false;
      const next = { ...a };
      for (const t of threads) {
        if (!(t.thread_id in next)) continue;
        const key = next[t.thread_id];
        const sid = key ? serverIds.current.get(key) ?? null : null;
        if ((t.project_id ?? null) === sid) {
          delete next[t.thread_id];
          changed = true;
        }
      }
      return changed ? next : a;
    });
  }, [threads]);

  /* ---------- mutations ---------- */

  const createFolder = useCallback(
    (name: string): ChatFolder => {
      const f: ChatFolder = { id: tempId(), name: name.trim().slice(0, 60) || 'New project' };
      setFolders((cur) => [...cur, f]);
      const p = api.projects.create(f.name).then((project) => {
        serverIds.current.set(f.id, project.id);
        creating.current.delete(f.id);
        if (alive.current) setVersion((v) => v + 1);
        return project.id;
      });
      creating.current.set(f.id, p);
      p.catch((err) => {
        creating.current.delete(f.id);
        setFolders((cur) => cur.filter((x) => x.id !== f.id));
        setAssign((a) => Object.fromEntries(Object.entries(a).filter(([, k]) => k !== f.id)));
        fail('Could not create the project', err);
      });
      return f;
    },
    [fail],
  );

  const renameFolder = useCallback(
    (id: string, name: string) => {
      const n = name.trim().slice(0, 60);
      const before = foldersRef.current.find((f) => f.id === id);
      if (!n || !before || before.name === n) return;
      setFolders((cur) => cur.map((f) => (f.id === id ? { ...f, name: n } : f)));
      (async () => {
        const sid = await resolve(id);
        if (!sid) return; // its create failed; the folder is already gone
        try {
          await api.projects.rename(sid, n);
        } catch (err) {
          setFolders((cur) => cur.map((f) => (f.id === id ? { ...f, name: before.name } : f)));
          fail('Could not rename the project', err);
        }
      })();
    },
    [resolve, fail],
  );

  /** Deleting a project does not delete its chats; they go back to "Chats". */
  const deleteFolder = useCallback(
    (id: string) => {
      const before = foldersRef.current;
      const index = before.findIndex((f) => f.id === id);
      if (index < 0) return;
      const folder = before[index];
      const hadAssign = Object.entries(assign).filter(([, k]) => k === id);
      setFolders((cur) => cur.filter((f) => f.id !== id));
      // Chats the thread list still has in this project must read as unfiled right away.
      const filedHere = (threads ?? []).filter((t) => t.project_id && t.project_id === serverIds.current.get(id)).map((t) => t.thread_id);
      setAssign((a) => {
        const next = Object.fromEntries(Object.entries(a).filter(([, k]) => k !== id));
        for (const t of filedHere) next[t] = null;
        return next;
      });
      (async () => {
        const sid = await resolve(id);
        if (!sid) return;
        try {
          await api.projects.remove(sid);
        } catch (err) {
          setFolders((cur) => (cur.some((f) => f.id === id) ? cur : [...cur.slice(0, index), folder, ...cur.slice(index)]));
          setAssign((a) => {
            const next = { ...a };
            for (const t of filedHere) delete next[t];
            for (const [t, k] of hadAssign) next[t] = k;
            return next;
          });
          fail('Could not delete the project', err);
        }
      })();
    },
    [assign, threads, resolve, fail],
  );

  const moveThread = useCallback(
    (threadId: string, folderId: string | null) => {
      const prev = threadId in assign ? assign[threadId] : undefined;
      setAssign((a) => ({ ...a, [threadId]: folderId }));
      (async () => {
        const sid = folderId ? await resolve(folderId) : null;
        if (folderId && !sid) return; // the project's create failed and was rolled back
        try {
          await api.threads.setProject(threadId, sid);
        } catch (err) {
          setAssign((a) => {
            const next = { ...a };
            if (prev === undefined) delete next[threadId];
            else next[threadId] = prev;
            return next;
          });
          fail('Could not move the chat', err);
        }
      })();
    },
    [assign, resolve, fail],
  );

  const folderOf = useCallback(
    (threadId: string): string | null => {
      if (threadId in assign) return assign[threadId];
      const pid = threads?.find((t) => t.thread_id === threadId)?.project_id;
      if (!pid) return null;
      const f = folders.find((x) => x.id === pid || serverIds.current.get(x.id) === pid);
      return f ? f.id : null;
    },
    [assign, threads, folders, version],
  );

  return { folders, createFolder, renameFolder, deleteFolder, moveThread, folderOf };
}
