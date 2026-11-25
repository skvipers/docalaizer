'use client';

import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useI18n } from '../i18n-provider';
import {
  ENTITY_ICON_OPTIONS,
  normalizeDocumentIcon,
  type EntityIconKey,
} from './entity-icon';

interface IconPickerProps {
  label: string;
  value: EntityIconKey;
  onChange: (value: EntityIconKey) => void;
  disabled?: boolean;
}

export function IconPicker({ label, value, onChange, disabled = false }: IconPickerProps) {
  const { locale, t } = useI18n();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    if (!normalizedQuery) return ENTITY_ICON_OPTIONS;
    return ENTITY_ICON_OPTIONS.filter(
      ({ value: key, label: optionLabel }) =>
        optionLabel.toLocaleLowerCase(locale).includes(normalizedQuery) ||
        key.includes(normalizedQuery),
    );
  }, [query, locale]);
  const normalizedValue = normalizeDocumentIcon(value);

  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-60">
      <legend className="mb-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </legend>
      <div className="relative mb-2">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
          style={{ color: 'var(--text-muted)' }}
          strokeWidth={1.75}
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('iconPicker.searchPlaceholder')}
          aria-label={`${label}: ${t('iconPicker.searchSuffix')}`}
          autoComplete="off"
          className="w-full rounded-md border py-2 pl-8 pr-3 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-primary)',
          }}
        />
      </div>
      {filteredOptions.length > 0 ? (
        <div className="grid max-h-56 grid-cols-6 gap-2 overflow-y-auto pr-1 sm:grid-cols-8 lg:grid-cols-10">
          {filteredOptions.map(({ value: key, label: optionLabel, Icon }) => {
            const selected = normalizedValue === key;
            return (
              <button
                key={key}
                type="button"
                aria-label={optionLabel}
                aria-pressed={selected}
                title={optionLabel}
                onClick={() => onChange(key)}
                className="flex h-10 items-center justify-center rounded-md border transition-colors hover:border-[var(--border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed"
                style={{
                  backgroundColor: selected ? 'var(--accent-primary-soft)' : 'var(--bg-subtle)',
                  borderColor: selected ? 'var(--accent-primary)' : 'var(--border-default)',
                  color: selected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                }}
              >
                <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
      ) : (
        <p
          className="rounded-md border border-dashed px-3 py-4 text-center text-xs"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          {t('iconPicker.empty')}
        </p>
      )}
      <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {t('iconPicker.count', { shown: filteredOptions.length, total: ENTITY_ICON_OPTIONS.length })}
      </p>
    </fieldset>
  );
}
