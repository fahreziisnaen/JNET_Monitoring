'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { fetchUnlinkedSecrets, UnlinkedSecret } from '@/utils/billing';

export default function PppoeSecretPicker({
  workspaceId,
  value,
  onSelect,
}: {
  workspaceId?: number | null;
  value: string;
  onSelect: (s: UnlinkedSecret | null) => void;
}) {
  const [secrets, setSecrets] = useState<UnlinkedSecret[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchUnlinkedSecrets(workspaceId)
      .then((s) => { if (active) setSecrets(s); })
      .catch(() => { if (active) setSecrets([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? secrets.filter((x) => x.name.toLowerCase().includes(s) || (x.profile || '').toLowerCase().includes(s))
      : secrets;
    return list.slice(0, 50);
  }, [q, secrets]);

  if (value) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-background text-sm">
        <span className="font-mono truncate">{value}</span>
        <button type="button" onClick={() => onSelect(null)} className="ml-auto text-muted-foreground hover:text-foreground"><X size={16} /></button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? 'Memuat secret...' : 'Cari & pilih PPPoE secret...'}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-card shadow-lg">
            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted-foreground" size={18} /></div>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">{secrets.length === 0 ? 'Semua secret sudah terpakai / tidak ada.' : 'Tidak ada yang cocok.'}</p>
            ) : filtered.map((s) => (
              <button
                type="button"
                key={s.name}
                onClick={() => { onSelect(s); setOpen(false); setQ(''); }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="font-mono truncate">{s.name}</span>
                {s.profile && <span className="text-xs text-muted-foreground shrink-0">{s.profile}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
