'use client';

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { OdpAsset } from '@/utils/billing';

export default function OdpPicker({
  odps,
  value,
  onSelect,
}: {
  odps: OdpAsset[];
  value: string;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? odps.filter((o) => o.name.toLowerCase().includes(s)) : odps;
    return list.slice(0, 50);
  }, [q, odps]);

  if (value) {
    const sel = odps.find((o) => String(o.id) === value);
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-background text-sm">
        <span className="truncate">{sel ? sel.name : `ODP #${value}`}</span>
        <button type="button" onClick={() => onSelect('')} className="ml-auto text-muted-foreground hover:text-foreground"><X size={16} /></button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Cari & pilih ODP (opsional)..."
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-card shadow-lg">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">{odps.length === 0 ? 'Belum ada ODP terdaftar.' : 'Tidak ada yang cocok.'}</p>
            ) : filtered.map((o) => (
              <button
                type="button"
                key={o.id}
                onClick={() => { onSelect(String(o.id)); setOpen(false); setQ(''); }}
                className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{o.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
