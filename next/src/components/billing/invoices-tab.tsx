'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { billingClient, formatRupiah, MONTHS_ID, BillingInvoice } from '@/utils/billing';
import { Pagination, SearchBox, useDebouncedValue } from './list-controls';

const STATUS = ['', 'unpaid', 'paid', 'overdue', 'void'];
const statusCls: Record<string, string> = {
  paid: 'bg-green-500/15 text-green-600',
  unpaid: 'bg-blue-500/15 text-blue-600',
  overdue: 'bg-red-500/15 text-red-600',
  void: 'bg-muted text-muted-foreground',
};

export default function InvoicesTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<BillingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { invoices, total } = await billingApi.listInvoices({ status: filter || undefined, q: debouncedQ, page, limit });
      setItems(invoices || []);
      setTotal(total || 0);
    } catch (e: any) {
      toast.error('Gagal memuat invoice', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQ, page, billingApi]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(1); }, [workspaceId]);

  const generate = async () => {
    if (!confirm('Generate invoice bulan ini untuk semua langganan aktif? (aman diulang, tidak akan dobel)')) return;
    setGenerating(true);
    try {
      const { summary } = await billingApi.generateInvoices();
      toast.success('Generate selesai', { description: `Dibuat ${summary.created}, dilewati ${summary.skipped} dari ${summary.total} langganan.` });
      load();
    } catch (e: any) {
      toast.error('Gagal generate invoice', { description: e.message });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col lg:flex-row justify-between gap-3 mb-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Cari no. invoice / nama / nomor..." />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
              {STATUS.map((s) => <option key={s} value={s}>{s || 'Semua'}</option>)}
            </select>
            <Button variant="ghost" size="icon" onClick={load} title="Muat ulang"><RefreshCw size={16} /></Button>
          </div>
        </div>
        <Button onClick={generate} disabled={generating}>
          {generating ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} Generate Invoice Bulan Ini
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">{debouncedQ || filter ? 'Tidak ada invoice yang cocok.' : 'Belum ada invoice. Klik "Generate Invoice Bulan Ini".'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">No. Invoice</th>
                <th className="py-2 pr-3">Pelanggan</th>
                <th className="py-2 pr-3">Periode</th>
                <th className="py-2 pr-3">Jumlah</th>
                <th className="py-2 pr-3">Jatuh Tempo</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((iv) => (
                <tr key={iv.id} className="border-b hover:bg-accent/40">
                  <td className="py-2 pr-3 font-mono text-xs">{iv.invoice_number}</td>
                  <td className="py-2 pr-3 font-medium">{iv.customer_name || iv.whatsapp_number}</td>
                  <td className="py-2 pr-3">{MONTHS_ID[iv.period_month]} {iv.period_year}</td>
                  <td className="py-2 pr-3">{formatRupiah(iv.amount)}</td>
                  <td className="py-2 pr-3">{iv.due_date}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusCls[iv.status] || ''}`}>{iv.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && total > 0 && (
        <Pagination page={page} limit={limit} total={total} onPage={setPage} loading={loading} />
      )}
    </div>
  );
}
