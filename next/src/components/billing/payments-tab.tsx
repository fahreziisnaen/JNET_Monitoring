'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { billingClient, formatRupiah, formatDateTimeID, MONTHS_ID, BillingPayment } from '@/utils/billing';
import { Pagination, SearchBox, useDebouncedValue } from './list-controls';

const STATUS = ['', 'paid', 'pending', 'failed', 'expired', 'refunded'];

const statusCls: Record<string, string> = {
  paid: 'bg-green-500/15 text-green-600',
  pending: 'bg-amber-500/15 text-amber-600',
  failed: 'bg-red-500/15 text-red-600',
  expired: 'bg-muted text-muted-foreground',
  refunded: 'bg-blue-500/15 text-blue-600',
};

const statusLabel: Record<string, string> = {
  paid: 'Lunas',
  pending: 'Menunggu',
  failed: 'Gagal',
  expired: 'Kadaluarsa',
  refunded: 'Refund',
};

function methodLabel(p: BillingPayment): string {
  if (p.payment_method === 'cash') return 'Tunai';
  if (p.provider === 'tripay') return p.payment_method || 'Tripay';
  if (p.provider === 'manual') return p.payment_method || 'Manual';
  return p.payment_method || p.provider;
}

export default function PaymentsTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<BillingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [method, setMethod] = useState('');
  const [sort, setSort] = useState<'recent' | 'amount'>('recent');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const load = useCallback(async () => {
    if (workspaceId == null) { setItems([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const { payments, total } = await billingApi.listPayments({
        status: filter || undefined, q: debouncedQ, page, limit, sort,
        method: method || undefined,
      });
      setItems(payments || []);
      setTotal(total || 0);
    } catch (e: any) {
      toast.error('Gagal memuat pembayaran', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQ, page, sort, method, billingApi, workspaceId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [workspaceId, debouncedQ, filter, sort, method]);

  const totalPaid = useMemo(
    () => items.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0),
    [items]
  );

  return (
    <div>
      <div className="flex flex-col lg:flex-row justify-between gap-3 mb-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Cari no. invoice / nama / nomor / ref..." />
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} title="Status">
              {STATUS.map((s) => <option key={s} value={s}>{s ? statusLabel[s] : 'Semua status'}</option>)}
            </select>
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)} title="Metode">
              <option value="">Semua metode</option>
              <option value="cash">Tunai</option>
              <option value="QRIS">QRIS</option>
              <option value="BRIVA">BRIVA</option>
              <option value="BNIVA">BNIVA</option>
            </select>
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} title="Urutkan">
              <option value="recent">Terbaru</option>
              <option value="amount">Nominal terbesar</option>
            </select>
            <Button variant="ghost" size="icon" onClick={load} title="Muat ulang"><RefreshCw size={16} /></Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">{debouncedQ || filter ? 'Tidak ada pembayaran yang cocok.' : 'Belum ada pembayaran tercatat.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Tanggal Bayar</th>
                <th className="py-2 pr-3">Pelanggan</th>
                <th className="py-2 pr-3">No. Invoice</th>
                <th className="py-2 pr-3">Periode</th>
                <th className="py-2 pr-3">Metode</th>
                <th className="py-2 pr-3">Jumlah</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b hover:bg-accent/40">
                  <td className="py-2 pr-3">{formatDateTimeID(p.paid_at)}</td>
                  <td className="py-2 pr-3 font-medium">{p.customer_name || p.whatsapp_number}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.invoice_number}</td>
                  <td className="py-2 pr-3">{MONTHS_ID[p.period_month]} {p.period_year}</td>
                  <td className="py-2 pr-3 capitalize">{methodLabel(p)}</td>
                  <td className="py-2 pr-3">{formatRupiah(p.amount)}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusCls[p.status] || ''}`}>{statusLabel[p.status] || p.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="py-2 pr-3 text-muted-foreground" colSpan={5}>Total lunas (halaman ini)</td>
                <td className="py-2 pr-3 text-green-600">{formatRupiah(totalPaid)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && total > 0 && (
        <Pagination page={page} limit={limit} total={total} onPage={setPage} loading={loading} />
      )}
    </div>
  );
}
