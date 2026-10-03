/**
 * The chat input, used by the full chat on the Ask tab and by the floating bubble elsewhere:
 * a rounded multi-line box with a place control, the language pill and send.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { LANGS } from '../../data/i18n';
import { useStore } from '../../state/store';
import { Ms } from '../ui';

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  leading,
  busy,
  compact,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Left of the bottom row: the place picker, or a static context chip in the bubble. */
  leading?: ReactNode;
  /** A run is in flight; sending is held until it finishes. */
  busy?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const { lang, open } = useStore();
  const L = LANGS.find((l) => l.code === lang) ?? LANGS[0];
  const ta = useRef<HTMLTextAreaElement>(null);

  // Grow with the text up to a cap, then scroll. Re-measured on resize, since a narrow
  // first layout would otherwise leave the box tall.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, compact ? 110 : 168)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [value, compact]);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  const canSend = !!value.trim() && !busy;

  return (
    <div
      className="chat-composer glass"
      style={{ borderRadius: compact ? 18 : 24, padding: compact ? '10px 10px 8px 14px' : '14px 14px 10px 18px' }}
    >
      <textarea
        ref={ta}
        value={value}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        placeholder={placeholder}
        aria-label="Ask a question"
        style={{ display: 'block', width: '100%', resize: 'none', background: 'transparent', border: 0, outline: 0, color: '#fff', font: `500 ${compact ? 14 : 16}px/1.5 var(--font)`, padding: 0, minHeight: compact ? 24 : 28, maxHeight: compact ? 110 : 168 }}
      />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <div style={{ minWidth: 0, flex: '0 1 auto' }}>{leading}</div>
        <span className="grow" />
        <button
          type="button"
          className="pill"
          onClick={() => open({ kind: 'lang' })}
          title={`Answer language: ${L.english}`}
          aria-label={`Answer language: ${L.english}`}
          style={{ border: '1px solid var(--hair-soft)', background: 'transparent' }}
        >
          <Ms n="translate" size={14} />
          {L.code.toUpperCase()}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSend}
          title="Send"
          aria-label="Send"
          style={{ width: 36, height: 36, flex: 'none', borderRadius: '50%', background: canSend ? '#fff' : 'var(--s3)', color: canSend ? '#000' : 'var(--subtle)', border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {busy ? <span className="spinner" /> : <Ms n="arrow_upward" size={20} />}
        </button>
      </div>
    </div>
  );
}
