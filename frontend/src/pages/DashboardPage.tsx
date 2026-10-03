import { useCallback, useState } from 'react';
import { useStore } from '../state/store';
import { api, toApiError } from '../api';
import type { Dashboard, DashboardBlock, DashboardSummary } from '../api';
import { useResource } from '../hooks/useResource';
import { fmtDate } from '../lib/format';
import { Btn, Empty, Ms } from '../components/ui';
import { ErrorState, SkeletonCard } from '../components/async';
import { AnswerBlocks } from '../components/blocks';
import { RecurrencePill, StatusPill } from './WatchDetail';

export function DashboardPage() {
  const { route } = useStore();
  return (
    <div className="page">
      <div className="page-inner">{route.id ? <DashboardDetail id={route.id} /> : <Overview />}</div>
    </div>
  );
}

/* ---------------- list ---------------- */

function Overview() {
  const { t, go, notify, watches } = useStore();
  const list = useResource(useCallback((signal) => api.dashboards.list(signal), []), []);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const d = await api.dashboards.create(n);
      setName('');
      setNaming(false);
      go('dashboard', d.id);
    } catch (err) {
      notify(toApiError(err).userMessage, undefined, undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const items = list.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Dashboard</div>
          <div className="h1" style={{ marginTop: 10 }}>{t('dashboard.title')}</div>
          <div className="body" style={{ marginTop: 6, maxWidth: 640 }}>{t('dashboard.sub')}</div>
        </div>
        <Btn variant="primary" icon="add" onClick={() => setNaming(true)}>New dashboard</Btn>
      </div>

      {naming && (
        <form
          className="row wrap card"
          style={{ padding: 16, gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="field grow" style={{ flex: '1 1 260px' }}>
            Dashboard name
            <input className="input" autoFocus value={name} maxLength={80} placeholder="e.g. North Pivot overview" onChange={(e) => setName(e.target.value)} />
          </label>
          <Btn type="submit" variant="primary" disabled={!name.trim() || busy}>Create</Btn>
          <Btn type="button" variant="text" onClick={() => { setNaming(false); setName(''); }}>Cancel</Btn>
        </form>
      )}

      {list.isLoading ? (
        <div className="grid-cards" aria-busy="true" aria-label="Loading dashboards">
          {Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} height={180} />)}
        </div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} title="Could not load your dashboards" />
      ) : items.length === 0 ? (
        <Empty icon="dashboard" title="No dashboards yet" body="A dashboard keeps the blocks you care about in one place and refreshes them on demand. Create one, then save blocks to it from an answer.">
          <Btn variant="primary" icon="add" onClick={() => setNaming(true)}>New dashboard</Btn>
        </Empty>
      ) : (
        <div className="grid-cards">
          {items.map((d) => (
            <DashboardCard key={d.id} d={d} triggers={watches.filter((w) => w.dashboardId === d.id).length} />
          ))}
        </div>
      )}
    </>
  );
}

function DashboardCard({ d, triggers }: { d: DashboardSummary; triggers: number }) {
  const { go } = useStore();
  return (
    <div
      className="card fade-up col"
      role="link"
      tabIndex={0}
      onClick={() => go('dashboard', d.id)}
      onKeyDown={(e) => e.key === 'Enter' && go('dashboard', d.id)}
      style={{ padding: '20px 22px', gap: 10, cursor: 'pointer', minHeight: 150 }}
    >
      <div className="row"><Ms n="dashboard" size={18} className="muted" /><span className="eyebrow">Dashboard</span></div>
      <div className="card-title">{d.name}</div>
      <div className="body-sm">
        {d.blockCount} {d.blockCount === 1 ? 'block' : 'blocks'}
        {triggers > 0 && <> · {triggers} {triggers === 1 ? 'trigger' : 'triggers'}</>}
      </div>
      <div className="tiny" style={{ marginTop: 'auto' }}>Created {fmtDate(d.createdAt)}</div>
    </div>
  );
}

/* ---------------- detail ---------------- */

function DashboardDetail({ id }: { id: string }) {
  const { go, open, notify, watches } = useStore();
  const res = useResource(useCallback((signal) => api.dashboards.get(id, signal), [id]), [id]);
  const [local, setLocal] = useState<Dashboard | null>(null);
  const dash = local?.id === id ? local : res.data;

  const back = (
    <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start', marginLeft: -12 }} onClick={() => go('dashboard')}>
      <Ms n="arrow_back" className="ms-flip" />All dashboards
    </button>
  );

  if (res.isLoading) {
    return (
      <div className="col" style={{ gap: 16 }} aria-busy="true">
        {back}
        <SkeletonCard height={260} />
      </div>
    );
  }
  if (res.error && !dash) {
    const gone = res.error.kind === 'http' && res.error.status === 404;
    return (
      <div className="col" style={{ gap: 16 }}>
        {back}
        {gone ? (
          <Empty icon="dashboard" title="This dashboard no longer exists" body="It may have been deleted.">
            <Btn variant="primary" onClick={() => go('dashboard')}>See all dashboards</Btn>
          </Empty>
        ) : (
          <ErrorState error={res.error} onRetry={res.refetch} title="Could not load this dashboard" />
        )}
      </div>
    );
  }
  if (!dash) return null;

  const patchBlocks = (fn: (b: DashboardBlock[]) => DashboardBlock[]) => setLocal({ ...dash, blocks: fn(dash.blocks) });
  const linked = watches.filter((w) => w.dashboardId === dash.id);

  const del = async () => {
    if (!window.confirm(`Delete “${dash.name}” and its blocks? Triggers on it keep running.`)) return;
    try {
      await api.dashboards.remove(dash.id);
      go('dashboard');
      notify(`Deleted “${dash.name}”`, undefined, undefined, 'delete');
    } catch (err) {
      notify(toApiError(err).userMessage, undefined, undefined, 'error');
    }
  };

  return (
    <div className="col" style={{ gap: 28 }}>
      <div className="col" style={{ gap: 14, paddingBottom: 20, borderBottom: '1px solid var(--hair-soft)' }}>
        {back}
        <div className="h1" style={{ fontSize: 'clamp(28px, 4vw, 48px)' }}>{dash.name}</div>
        <div className="row wrap">
          <span className="pill" style={{ background: 'var(--s2)' }}><Ms n="dashboard" size={14} />{dash.blocks.length} {dash.blocks.length === 1 ? 'block' : 'blocks'}</span>
          <span className="pill" style={{ background: 'var(--s2)' }}>Created {fmtDate(dash.createdAt)}</span>
        </div>
        <div className="row wrap">
          <Btn icon="add_alert" onClick={() => open({ kind: 'watchBuilder', dashboardId: dash.id })}>New trigger for this dashboard</Btn>
          <Btn variant="text" icon="delete" onClick={del}>Delete</Btn>
        </div>
      </div>

      <section className="col" style={{ gap: 14 }}>
        <div className="eyebrow">Blocks</div>
        {dash.blocks.length === 0 ? (
          <Empty icon="widgets" title="No blocks yet" body="Save a block from an answer to put it here. Each one can be refreshed on its own.">
            <Btn variant="primary" icon="forum" onClick={() => go('ask')}>Ask something</Btn>
          </Empty>
        ) : (
          <div className="col" style={{ gap: 20 }}>
            {dash.blocks.map((b) => (
              <BlockCard
                key={b.blockId}
                dashboardId={dash.id}
                b={b}
                onRefreshed={(next) => patchBlocks((all) => all.map((x) => (x.blockId === next.blockId ? next : x)))}
                onRemoved={() => patchBlocks((all) => all.filter((x) => x.blockId !== b.blockId))}
              />
            ))}
          </div>
        )}
      </section>

      <section className="col" style={{ gap: 14 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="eyebrow">Triggers on this dashboard</div>
          <Btn size="sm" icon="add" onClick={() => open({ kind: 'watchBuilder', dashboardId: dash.id })}>New trigger for this dashboard</Btn>
        </div>
        {linked.length === 0 ? (
          <div className="sunk body-sm" style={{ padding: '14px 16px' }}>
            No triggers yet. Add one to hear when this dashboard&rsquo;s state changes.
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {linked.map((w) => (
              <div
                key={w.id}
                className="card row wrap"
                role="link"
                tabIndex={0}
                onClick={() => go('triggers', w.id)}
                onKeyDown={(e) => e.key === 'Enter' && go('triggers', w.id)}
                style={{ padding: '12px 16px', gap: 10, cursor: 'pointer' }}
              >
                <Ms n="notifications_active" size={18} className="muted" />
                <span className="grow ink" style={{ font: '600 14px/1.38 var(--font)' }}>{w.name}</span>
                <RecurrencePill recurrence={w.recurrence} />
                <StatusPill status={w.status} on={w.enabled} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BlockCard({ dashboardId, b, onRefreshed, onRemoved }: {
  dashboardId: string;
  b: DashboardBlock;
  onRefreshed: (next: DashboardBlock) => void;
  onRemoved: () => void;
}) {
  const { notify } = useStore();
  const [busy, setBusy] = useState<'refresh' | 'remove' | null>(null);

  const refresh = async () => {
    setBusy('refresh');
    try {
      onRefreshed(await api.dashboards.refreshBlock(dashboardId, b.blockId));
      notify('Block refreshed', undefined, undefined, 'refresh');
    } catch (err) {
      const e = toApiError(err);
      // 409/422 keep the old block on the server; say why rather than a generic failure.
      const why = e.status === 409 ? 'This block is already refreshing.' : e.status === 422 ? 'The saved recipe could not be re-run. The previous block is kept.' : e.userMessage;
      notify(why, undefined, undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await api.dashboards.removeBlock(dashboardId, b.blockId);
      onRemoved();
    } catch (err) {
      notify(toApiError(err).userMessage, undefined, undefined, 'error');
      setBusy(null);
    }
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="tiny grow">
          Refreshed {fmtDate(b.refreshedAt)} · from run of {b.source.runDate}
          {b.caption ? ` · ${b.caption}` : ''}
        </span>
        <Btn size="sm" icon="refresh" disabled={busy !== null} onClick={refresh}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh'}</Btn>
        <Btn size="sm" variant="text" icon="close" disabled={busy !== null} onClick={remove} aria-label="Remove block">Remove</Btn>
      </div>
      <AnswerBlocks blocks={[b.block]} />
    </div>
  );
}
