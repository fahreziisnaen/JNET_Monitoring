'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw, Send, Banknote, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ConfirmModal from '@/components/ui/confirm-modal';
import { billingClient, formatRupiah, formatDateID, MONTHS_ID, BillingInvoice } from '@/utils/billing';
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
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [sort, setSort] = useState<'recent' | 'due' | 'amount'>('recent');
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [toPayCash, setToPayCash] = useState<BillingInvoice | null>(null);
  const [payingCash, setPayingCash] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    if (workspaceId == null) { setItems([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const { invoices, total } = await billingApi.listInvoices({
        status: filter || undefined, q: debouncedQ, page, limit, sort,
        month: month ? Number(month) : undefined,
        year: year ? Number(year) : undefined,
      });
      setItems(invoices || []);
      setTotal(total || 0);
    } catch (e: any) {
      toast.error('Gagal memuat invoice', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQ, page, sort, month, year, billingApi, workspaceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(1); }, [workspaceId, debouncedQ, filter, sort, month, year]);

  const sendWa = async (iv: BillingInvoice) => {
    setSendingId(iv.id);
    try {
      const r = await billingApi.sendInvoiceWa(iv.id);
      if (r.wa_sent) {
        toast.success('Tagihan terkirim via WhatsApp', { description: iv.invoice_number });
      } else {
        toast.warning(r.message, { description: 'Salin link: ' + r.checkout_url });
      }
      load();
    } catch (e: any) {
      toast.error('Gagal mengirim tagihan', { description: e.message });
    } finally {
      setSendingId(null);
    }
  };

  const confirmPayCash = async () => {
    if (!toPayCash) return;
    setPayingCash(true);
    try {
      await billingApi.payInvoiceCash(toPayCash.id);
      toast.success('Pembayaran tunai dicatat', { description: toPayCash.invoice_number });
      setToPayCash(null);
      load();
    } catch (e: any) {
      toast.error('Gagal mencatat pembayaran', { description: e.message });
    } finally {
      setPayingCash(false);
    }
  };

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

  const doExport = async () => {
    setExporting(true);
    try {
      await billingApi.exportInvoices({
        status: filter || undefined, sort, q: debouncedQ,
        month: month ? Number(month) : undefined,
        year: year ? Number(year) : undefined,
      });
    } catch (e: any) {
      toast.error('Gagal mengekspor', { description: e.message });
    } finally {
      setExporting(false);
    }
  };

  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];

  return (
    <div>
      <div className="flex flex-col lg:flex-row justify-between gap-3 mb-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Cari no. invoice / nama / nomor..." />
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} title="Status">
              {STATUS.map((s) => <option key={s} value={s}>{s || 'Semua status'}</option>)}
            </select>
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} title="Bulan">
              <option value="">Semua bulan</option>
              {MONTHS_ID.map((m, i) => i > 0 && <option key={i} value={i}>{m}</option>)}
            </select>
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={year} onChange={(e) => setYear(e.target.value)} title="Tahun">
              <option value="">Semua tahun</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} title="Urutkan">
              <option value="recent">Terbaru</option>
              <option value="due">Jatuh tempo terdekat</option>
              <option value="amount">Nominal terbesar</option>
            </select>
            <Button variant="ghost" size="icon" onClick={load} title="Muat ulang"><RefreshCw size={16} /></Button>
            <Button variant="outline" className="gap-2" onClick={doExport} disabled={exporting} title="Export ke Excel">
              {exporting ? <Loader2 className="animate-spin" size={16} /> : <FileDown size={16} />} Excel
            </Button>
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
                <th className="py-2 pr-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((iv) => (
                <tr key={iv.id} className="border-b hover:bg-accent/40">
                  <td className="py-2 pr-3 font-mono text-xs">{iv.invoice_number}</td>
                  <td className="py-2 pr-3 font-medium">{iv.customer_name || iv.whatsapp_number}</td>
                  <td className="py-2 pr-3">{MONTHS_ID[iv.period_month]} {iv.period_year}</td>
                  <td className="py-2 pr-3">{formatRupiah(iv.amount)}</td>
                  <td className="py-2 pr-3">{formatDateID(iv.due_date)}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusCls[iv.status] || ''}`}>{iv.status}</span>
                  </td>
                  <td className="py-2 pr-3">
                    {iv.status !== 'paid' && iv.status !== 'void' && (
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setToPayCash(iv)} title="Tandai lunas — bayar tunai">
                          <Banknote size={14} /><span className="ml-1.5">Bayar Cash</span>
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => sendWa(iv)} disabled={sendingId === iv.id} title="Kirim link bayar via WhatsApp">
                          {sendingId === iv.id ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                          <span className="ml-1.5">Kirim WA</span>
                        </Button>
                      </div>
                    )}
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

      <ConfirmModal
        isOpen={!!toPayCash}
        onClose={() => setToPayCash(null)}
        onConfirm={confirmPayCash}
        title="Tandai Lunas (Bayar Cash)"
        description={`Tandai invoice ${toPayCash?.invoice_number || ''} sebesar ${formatRupiah(toPayCash?.amount || 0)} sebagai LUNAS via pembayaran tunai? Pelanggan yang terisolir akan otomatis dibuka.`}
        confirmText="Tandai Lunas"
        isLoading={payingCash}
      />
    </div>
  );
}
