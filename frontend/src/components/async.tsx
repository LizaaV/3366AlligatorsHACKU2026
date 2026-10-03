/**
 * UI for the states a networked app has and a prototype does not: loading, failed, and
 * not-connected-yet. Styled with the existing tokens so they read as part of the design
 * rather than as debug output.
 */

import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { Btn, Ms } from './ui';

/** Shimmering placeholder block. `lines > 1` stacks them with a shortened last line. */
export function Skeleton({ h = 16, w, lines = 1, radius = 6, style }: { h?: number; w?: number | string; lines?: number; radius?: number; style?: React.CSSProperties }) {
  return (
    <span aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="skeleton"
          style={{ height: h, width: i === lines - 1 && lines > 1 ? '62%' : (w ?? '100%'), borderRadius: radius, display: 'block' }}
        />
      ))}
    </span>
  );
}

/** Card-shaped skeleton for grid and row layouts. */
export const SkeletonCard = ({ height = 240 }: { height?: number }) => (
  <div className="card" style={{ height, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden>
    <Skeleton h={Math.round(height * 0.45)} radius={8} />
    <Skeleton h={14} w="55%" />
    <Skeleton h={12} lines={2} />
  </div>
);

/**
 * Failure state with a retry. Distinguishes "the backend is not built yet" from a genuine
 * failure, because during this phase of the project those need different wording.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  compact,
}: {
  error: ApiError | Error | undefined;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
}) {
  const api = error instanceof ApiError ? error : undefined;
  const pending = api?.kind === 'not-implemented';
  const message = api?.userMessage ?? 'Something went wrong. Try again.';
  const canRetry = !!onRetry && (api?.retryable ?? true);

  return (
    <div
      role="alert"
      className={compact ? 'row' : 'card'}
      style={
        compact
          ? { gap: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--hair)' }
          : { padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }
      }
    >
      <Ms n={pending ? 'cloud_off' : 'error_outline'} size={compact ? 18 : 28} className="muted" style={{ flex: 'none' }} />
      <div className="col grow" style={{ gap: 4, alignItems: compact ? 'flex-start' : 'center' }}>
        {!compact && <div className="subhead">{title ?? (pending ? 'Not connected yet' : 'Could not load this')}</div>}
        <div className="body-sm" style={{ maxWidth: 420 }}>
          {pending ? 'This part of the app is waiting on the backend endpoint.' : message}
        </div>
      </div>
      {canRetry && (
        <Btn size="sm" icon="refresh" onClick={onRetry} style={compact ? { marginLeft: 'auto' } : undefined}>
          Try again
        </Btn>
      )}
    </div>
  );
}

/**
 * The standard loading / error / empty / data switch, so pages do not each invent their own.
 * Keeps previously loaded data visible during a refetch instead of flashing a skeleton.
 */
export function Async<T>({
  resource,
  skeleton,
  empty,
  isEmpty,
  children,
}: {
  resource: { data: T | undefined; error: ApiError | undefined; isLoading: boolean; refetch: () => void };
  skeleton: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (resource.isLoading) return <>{skeleton}</>;
  if (resource.error && resource.data === undefined) return <ErrorState error={resource.error} onRetry={resource.refetch} />;
  if (resource.data === undefined) return <>{skeleton}</>;
  if (empty && isEmpty?.(resource.data)) return <>{empty}</>;
  return <>{children(resource.data)}</>;
}
