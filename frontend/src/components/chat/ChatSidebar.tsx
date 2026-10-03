/**
 * Collapsible chat history: "Projects" (folders that each list their chats) and "Chats"
 * (everything not in a project). Chats come from `api.threads`; folders and which chat is in
 * which are client-side (see useChatFolders).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ThreadSummary } from '../../api';
import { useResource } from '../../hooks/useResource';
import { Ms } from '../ui';
import { useChatFolders } from './useChatFolders';

export interface CurrentChat {
  threadId: string;
  title: string;
}

export function ChatSidebar({
  open,
  mobile,
  navH,
  activeThreadId,
  current,
  refreshKey,
  onClose,
  onNew,
  onOpen,
}: {
  open: boolean;
  mobile: boolean;
  navH: number;
  activeThreadId: string | null;
  /** The conversation being had right now; listed even before the server knows about it. */
  current: CurrentChat | null;
  /** Changes when a run finishes, to refetch the list. */
  refreshKey: unknown;
  onClose: () => void;
  onNew: () => void;
  onOpen: (threadId: string) => void;
}) {
  const threads = useResource(useCallback((signal) => api.threads.list(50, signal), []), [refreshKey]);
  const { folders, createFolder, renameFolder, deleteFolder, moveThread, folderOf } = useChatFolders();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const aside = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('[data-chat-menu]')) setMenu(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);

  const rows: ThreadSummary[] = useMemo(() => {
    const list = threads.data ?? [];
    if (current && !list.some((t) => t.thread_id === current.threadId)) {
      const now = new Date().toISOString();
      return [
        { thread_id: current.threadId, title: current.title, place_name: null, last_question: current.title, last_status: 'done', last_sentence: null, run_count: 1, started_at: now, updated_at: now },
        ...list,
      ];
    }
    return list;
  }, [threads.data, current]);

  const uncategorised = rows.filter((r) => !folderOf(r.thread_id));

  const startRename = (id: string, name: string) => {
    setRenaming(id);
    setDraft(name);
  };
  const commitRename = () => {
    if (renaming) renameFolder(renaming, draft);
    setRenaming(null);
  };
  const newProject = () => {
    const f = createFolder('New project');
    setExpanded((e) => ({ ...e, [f.id]: true }));
    startRename(f.id, f.name);
  };

  const row = (t: ThreadSummary) => {
    const on = t.thread_id === activeThreadId;
    return (
      <div key={t.thread_id} className="row" style={{ position: 'relative', gap: 0 }} data-chat-menu>
        <button
          onClick={() => { onOpen(t.thread_id); if (mobile) onClose(); }}
          className="menu-item"
          style={{ background: on ? 'var(--s2)' : undefined, padding: '7px 8px', gap: 8, minWidth: 0 }}
          title={t.title}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: '500 13px/1.4 var(--font)' }}>{t.title}</span>
        </button>
        <button
          aria-label={`Options for ${t.title}`}
          aria-haspopup="menu"
          onClick={() => setMenu((m) => (m === t.thread_id ? null : t.thread_id))}
          style={{ flex: 'none', width: 28, height: 28, borderRadius: 6, background: 'transparent', border: 0, color: 'var(--muted)' }}
        >
          <Ms n="more_horiz" size={18} />
        </button>
        {menu === t.thread_id && (
          <div className="menu" role="menu" style={{ right: 0, top: 32, width: 220 }}>
            <div className="menu-label eyebrow">Move to project…</div>
            {folders.map((f) => (
              <button key={f.id} className={`menu-item ${folderOf(t.thread_id) === f.id ? 'on' : ''}`} onClick={() => { moveThread(t.thread_id, f.id); setExpanded((e) => ({ ...e, [f.id]: true })); setMenu(null); }}>
                <Ms n="folder" />{f.name}
              </button>
            ))}
            <button className="menu-item" onClick={() => { const f = createFolder('New project'); moveThread(t.thread_id, f.id); setExpanded((e) => ({ ...e, [f.id]: true })); startRename(f.id, f.name); setMenu(null); }}>
              <Ms n="create_new_folder" />New project
            </button>
            {folderOf(t.thread_id) && (
              <button className="menu-item" onClick={() => { moveThread(t.thread_id, null); setMenu(null); }}>
                <Ms n="folder_off" />Remove from project
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!open) return null;

  return (
    <>
      {mobile && <div onClick={onClose} style={{ position: 'fixed', inset: 0, top: navH, background: 'rgba(0,0,0,.5)', zIndex: 39 }} />}
      <aside
        ref={aside}
        aria-label="Chat history"
        style={{ position: 'fixed', top: navH, left: 0, bottom: mobile ? 64 : 0, width: mobile ? 'min(300px, 86vw)' : 280, zIndex: 40, background: '#000', borderRight: '1px solid var(--hair-soft)', display: 'flex', flexDirection: 'column', animation: 'fadeIn .2s ease both' }}
      >
        <div className="row" style={{ padding: 10, gap: 6 }}>
          <button className="btn btn-sm" onClick={() => { onNew(); if (mobile) onClose(); }} style={{ flex: 1, justifyContent: 'flex-start' }}>
            <Ms n="add_comment" />New chat
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Hide chat history" title="Hide chat history"><Ms n="left_panel_close" /></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 6px 12px' }}>
          <div className="row" style={{ justifyContent: 'space-between', padding: '8px 8px 4px' }}>
            <span className="eyebrow">Projects</span>
            <button className="btn btn-text btn-sm" onClick={newProject}><Ms n="add" />New project</button>
          </div>
          {!folders.length && <div className="caption" style={{ padding: '2px 10px 8px' }}>Group related chats into a project.</div>}
          {folders.map((f) => {
            const inside = rows.filter((r) => folderOf(r.thread_id) === f.id);
            const isOpen = !!expanded[f.id];
            return (
              <div key={f.id}>
                <div className="row" style={{ gap: 0 }}>
                  {renaming === f.id ? (
                    <input
                      className="input"
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                      style={{ height: 32, margin: '2px 4px' }}
                      aria-label="Project name"
                    />
                  ) : (
                    <>
                      <button className="menu-item" aria-expanded={isOpen} onClick={() => setExpanded((e) => ({ ...e, [f.id]: !isOpen }))} style={{ padding: '7px 8px', gap: 6 }}>
                        <Ms n={isOpen ? 'expand_more' : 'chevron_right'} size={18} />
                        <Ms n="folder" size={18} />
                        <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span className="tiny">{inside.length}</span>
                      </button>
                      <button aria-label={`Rename ${f.name}`} title="Rename" onClick={() => startRename(f.id, f.name)} style={{ flex: 'none', width: 28, height: 28, borderRadius: 6, background: 'transparent', border: 0, color: 'var(--muted)' }}><Ms n="edit" size={16} /></button>
                      <button aria-label={`Delete ${f.name}`} title="Delete project (chats are kept)" onClick={() => deleteFolder(f.id)} style={{ flex: 'none', width: 28, height: 28, borderRadius: 6, background: 'transparent', border: 0, color: 'var(--muted)' }}><Ms n="close" size={16} /></button>
                    </>
                  )}
                </div>
                {isOpen && (
                  <div style={{ paddingLeft: 18 }}>
                    {inside.map(row)}
                    {!inside.length && <div className="caption" style={{ padding: '2px 10px 6px' }}>No chats yet.</div>}
                  </div>
                )}
              </div>
            );
          })}

          <div className="eyebrow" style={{ padding: '14px 8px 4px' }}>Chats</div>
          {threads.isLoading && <div className="caption" style={{ padding: '4px 10px' }}>Loading…</div>}
          {threads.error && <div className="caption" style={{ padding: '4px 10px' }}>Could not load your chats. <button className="btn btn-text btn-sm" onClick={threads.refetch}>Retry</button></div>}
          {uncategorised.map(row)}
          {!threads.isLoading && !threads.error && !uncategorised.length && <div className="caption" style={{ padding: '4px 10px' }}>No chats yet. Ask something to start one.</div>}
        </div>
      </aside>
    </>
  );
}
