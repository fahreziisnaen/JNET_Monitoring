'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { billingClient, BillingCustomer } from '@/utils/billing';
import { useDebouncedValue } from './list-controls';

export default function CustomerPicker({ workspaceId, value, label, onSelect }: {
  workspaceId?: number | null;
  value: string;
  label: string;
  onSelect: (c: { id: number; label: string } | null) => void;
}) {
  const api = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query);
  const [results, setResults] = useState<BillingCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    api.listCustomers({ q: debounced, limit: 8 })
      .then((r) => { if (active) setResults(r.customers || []); })
      .catch(() => { if (active) setResults([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, debounced, open]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 h-10 rounded-md border border-input bg-background px-3 text-sm">
        <span className="flex-1 truncate">{label || `#${value}`}</span>
        <button type="button" onClick={() => onSelect(null)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          className="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm"
          placeholder="Ketik nama / nomor untuk cari..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-card border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-3"><Loader2 className="animate-spin text-muted-foreground" size={16} /></div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Tidak ada pelanggan ditemukan</div>
          ) : results.map((c) => (
            <div
              key={c.id}
              className="px-3 py-2 cursor-pointer hover:bg-secondary text-sm"
              onClick={() => { onSelect({ id: c.id, label: c.name || c.whatsapp_number }); setOpen(false); setQuery(''); }}
            >
              <span className="font-medium">{c.name || '—'}</span>{' '}
              <span className="font-mono text-xs text-muted-foreground">{c.whatsapp_number}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
