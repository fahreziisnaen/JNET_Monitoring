'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Loader2, X, Search, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { billingClient, formatRupiah, AssignableCustomer, AssignSummary, AssignSkipped } from '@/utils/billing';

const REASON_LABEL: Record<AssignSkipped['reason'], string> = {
  no_profile: 'Profil PPPoE tidak terdeteksi (secret kosong / tak ada di router)',
  no_match: 'Belum ada paket dengan profil PPPoE yang sama',
  error: 'Gagal diproses',
};

export default function MatchPackagesPanel({
  workspaceId,
  onClose,
  onDone,
}: {
  workspaceId?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<AssignableCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [result, setResult] = useState<{ summary: AssignSummary; skipped: AssignSkipped[] } | null>(null);

  const loadList = async () => {
    setResult(null);
    setSelected(new Set());
    setLoading(true);
    try {
      const { customers } = await billingApi.listAssignableCustomers();
      setItems(customers || []);
    } catch (e: any) {
      toast.error('Gagal memuat pelanggan', { description: e.message });
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  const filtered = items.filter((c) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (c.name || '').toLowerCase().includes(s)
      || (c.whatsapp_number || '').includes(s)
      || (c.pppoe_secret_name || '').toLowerCase().includes(s)
      || (c.detected_profile || '').toLowerCase().includes(s);
  });

  const matchedCount = items.filter((c) => c.package_id != null).length;

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectableShown = filtered.filter((c) => c.package_id != null);
  const allShownSelected = selectableShown.length > 0 && selectableShown.every((c) => selected.has(c.id));
  const toggleAllShown = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allShownSelected) selectableShown.forEach((c) => next.delete(c.id));
    else selectableShown.forEach((c) => next.add(c.id));
    return next;
  });

  const run = async (all: boolean) => {
    setRunning(true);
    try {
      const body = all ? { all: true } : { customer_ids: Array.from(selected) };
      const { summary, skipped } = await billingApi.assignPackages(body);
      toast.success('Pencocokan selesai', {
        description: `Ditetapkan ${summary.assigned}, dilewati ${summary.total - summary.assigned} dari ${summary.total}.`,
      });
      setResult({ summary, skipped: skipped || [] });
      onDone();
    } catch (e: any) {
      toast.error('Gagal mencocokkan paket', { description: e.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="p-4 mb-6">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Cocokkan Paket dari Monitoring</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Hanya pelanggan yang <strong>belum punya langganan</strong> yang ditampilkan. Profil PPPoE tiap pelanggan diambil dari router,
        lalu dicocokkan ke paket billing yang punya profil sama. Langganan dibuat tanpa tagihan (tagihan tetap dari Generate Invoice).
        Jika paket belum cocok, buat dulu paketnya di tab <strong>Paket</strong> dengan profil PPPoE yang sesuai.
      </p>

      {result ? (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 text-sm">
            <span className="px-2 py-1 rounded bg-green-500/15 text-green-600">Ditetapkan {result.summary.assigned}</span>
            <span className="px-2 py-1 rounded bg-amber-500/15 text-amber-600">Tanpa paket cocok {result.summary.skipped_no_match}</span>
            <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Tanpa profil {result.summary.skipped_no_profile}</span>
            <span className="px-2 py-1 rounded bg-secondary text-muted-foreground">Total {result.summary.total}</span>
          </div>

          {result.skipped.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Semua pelanggan berhasil ditetapkan paketnya.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto border rounded-md mb-3">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 px-3">Nama</th>
                    <th className="py-2 pr-3">Profil</th>
                    <th className="py-2 pr-3">Alasan dilewati</th>
                  </tr>
                </thead>
                <tbody>
                  {result.skipped.map((s, i) => (
                    <tr key={i} className="border-b">
                      <td className="py-2 px-3 font-medium">{s.name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{s.profile || <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 pr-3 text-amber-600">{REASON_LABEL[s.reason] || s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={loadList} disabled={running}>Muat Ulang</Button>
            <Button onClick={onClose}>Selesai</Button>
          </div>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Semua pelanggan sudah punya langganan. Tidak ada yang perlu dicocokkan.</p>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Cari nama / nomor / profil..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} disabled={selectableShown.length === 0} />
                Pilih semua yang cocok ({selectableShown.length})
              </label>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto border rounded-md mb-3">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 px-3 w-8"></th>
                  <th className="py-2 pr-3">Nama</th>
                  <th className="py-2 pr-3">Profil PPPoE</th>
                  <th className="py-2 pr-3">Paket cocok</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const hasMatch = c.package_id != null;
                  return (
                    <tr
                      key={c.id}
                      className={`border-b ${hasMatch ? 'hover:bg-accent/40 cursor-pointer' : 'opacity-60'}`}
                      onClick={() => hasMatch && toggle(c.id)}
                    >
                      <td className="py-2 px-3">
                        <input type="checkbox" checked={selected.has(c.id)} disabled={!hasMatch} onChange={() => toggle(c.id)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="py-2 pr-3 font-medium">{c.name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{c.detected_profile || <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 pr-3">
                        {hasMatch ? (
                          <>
                            <span className="font-medium">{c.package_name}</span>
                            {c.package_price != null && <span className="block text-xs text-muted-foreground">{formatRupiah(c.package_price)}/bln</span>}
                          </>
                        ) : (
                          <span className="text-xs text-amber-600">{c.detected_profile ? 'Belum ada paket dgn profil ini' : 'Profil tak terdeteksi'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={running}>Batal</Button>
            <Button variant="outline" onClick={() => run(true)} disabled={running || matchedCount === 0}>
              {running ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />} Cocokkan Semua ({matchedCount})
            </Button>
            <Button onClick={() => run(false)} disabled={running || selected.size === 0}>
              {running ? <Loader2 className="animate-spin" size={18} /> : null} Cocokkan Terpilih ({selected.size})
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
