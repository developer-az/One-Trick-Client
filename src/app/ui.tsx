import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChampionIcon, ItemIcon } from '../components/GameIcons';
import type { Champion } from '../logic/pykeLogic';
import { IconSearch, IconX } from './icons';

export type Tone = 'live' | 'warn' | 'bad' | 'gold' | 'muted';

export const Card: React.FC<React.PropsWithChildren<{ className?: string; pad?: boolean }>> = ({
  className = '',
  pad = true,
  children,
}) => <section className={`ot-card ${pad ? 'ot-card-pad' : ''} ${className}`}>{children}</section>;

export const CardHeader: React.FC<{ title: string; action?: React.ReactNode; sub?: React.ReactNode }> = ({
  title,
  action,
  sub,
}) => (
  <div className="flex items-start justify-between gap-3 mb-3">
    <div className="min-w-0">
      <h2 className="ot-card-title">{title}</h2>
      {sub ? <p className="mt-1 text-sm ot-muted">{sub}</p> : null}
    </div>
    {action}
  </div>
);

export const Pill: React.FC<React.PropsWithChildren<{ tone?: Tone; title?: string }>> = ({
  tone = 'muted',
  title,
  children,
}) => (
  <span className={`ot-pill ot-tone-${tone}`} title={title}>
    <span className="ot-dot" />
    {children}
  </span>
);

export const Badge: React.FC<React.PropsWithChildren<{ tone?: 'gold' | 'teal' | 'red' | 'blue' | 'amber' | 'muted' }>> = ({
  tone = 'muted',
  children,
}) => <span className={`ot-badge ${tone === 'muted' ? '' : `ot-badge-${tone}`}`}>{children}</span>;

export const Switch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className="ot-switch"
    onClick={() => onChange(!checked)}
  />
);

export const SettingRow: React.FC<{
  title: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
}> = ({ title, hint, control }) => (
  <div className="flex items-start justify-between gap-6 py-3.5 border-b border-[color:var(--ot-border)] last:border-0">
    <div className="min-w-0">
      <div className="text-[15px] font-medium">{title}</div>
      {hint ? <div className="mt-0.5 text-sm ot-muted leading-relaxed">{hint}</div> : null}
    </div>
    <div className="pt-0.5">{control}</div>
  </div>
);

export const Portrait: React.FC<{
  champion?: { id?: string | null; name?: string | null; key?: string | number | null } | null;
  size?: number;
  ring?: 'gold' | 'red' | 'blue';
  className?: string;
}> = ({ champion, size = 44, ring, className = '' }) => (
  <span
    className={`ot-portrait ${ring ? `ot-portrait-ring-${ring}` : ''} ${className}`}
    style={{ width: size, height: size }}
  >
    {champion ? (
      <ChampionIcon
        championId={champion.id}
        championName={champion.name}
        championKey={champion.key}
        alt={champion.name || champion.id || 'Champion'}
      />
    ) : null}
  </span>
);

export const Item: React.FC<{ id: string; name: string; size?: number; title?: string }> = ({
  id,
  name,
  size = 40,
  title,
}) => (
  <span className="ot-item" style={{ width: size, height: size }} title={title || name}>
    <ItemIcon itemId={id} alt={name} />
  </span>
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ icon, title, body, action }) => (
  <div className="flex flex-col items-center text-center py-12 px-6">
    {icon ? <div className="mb-4 ot-faint">{icon}</div> : null}
    <div className="ot-card-heading">{title}</div>
    {body ? <p className="mt-2 max-w-md text-sm ot-muted leading-relaxed">{body}</p> : null}
    {action ? <div className="mt-5">{action}</div> : null}
  </div>
);

/** Search-as-you-type champion picker. */
export const ChampionCombobox: React.FC<{
  champions: Champion[];
  value: Champion | null;
  onChange: (next: Champion | null) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  exclude?: Set<string>;
}> = ({ champions, value, onChange, placeholder = 'Search champion', disabled, autoFocus, exclude }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const list = champions.filter((c) => !exclude?.has(c.id));
    if (!q) return list.slice(0, 40);
    const starts: Champion[] = [];
    const contains: Champion[] = [];
    for (const c of list) {
      const name = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (name.startsWith(q)) starts.push(c);
      else if (name.includes(q)) contains.push(c);
    }
    return [...starts, ...contains].slice(0, 40);
  }, [champions, query, exclude]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (c: Champion | null) => {
    onChange(c);
    setQuery('');
    setOpen(false);
  };

  if (value && !open) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          className="flex items-center gap-2.5 min-w-0 text-left"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            setActive(0);
          }}
          title="Change champion"
        >
          <span className="truncate text-[15px] font-medium">{value.name}</span>
        </button>
        {!disabled ? (
          <button type="button" className="ot-btn ot-btn-ghost ot-btn-sm !px-1.5" onClick={() => pick(null)} aria-label="Clear">
            <IconX />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="relative">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 ot-faint" />
        <input
          className="ot-input !pl-9"
          value={query}
          disabled={disabled}
          autoFocus={autoFocus || open}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(matches.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && matches[active]) {
              e.preventDefault();
              pick(matches[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </div>
      {open && matches.length > 0 ? (
        <div className="ot-combobox-menu" role="listbox">
          {matches.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`ot-combobox-option ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
            >
              <Portrait champion={c} size={26} />
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export interface Toast {
  id: number;
  tone: 'good' | 'bad' | 'info';
  title: string;
  body?: string;
}

export const Toasts: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => (
  <div className="ot-toasts" aria-live="polite">
    {toasts.map((t) => (
      <div key={t.id} className="ot-toast">
        <span
          className={`ot-dot mt-1.5 ${t.tone === 'good' ? 'ot-tone-live' : t.tone === 'bad' ? 'ot-tone-bad' : 'ot-tone-gold'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{t.title}</div>
          {t.body ? <div className="mt-0.5 text-sm ot-muted break-words">{t.body}</div> : null}
        </div>
        <button type="button" className="ot-faint hover:text-white" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
          <IconX />
        </button>
      </div>
    ))}
  </div>
);
