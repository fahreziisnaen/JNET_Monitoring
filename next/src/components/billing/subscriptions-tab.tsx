'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { billingClient, formatRupiah, formatDateID, BillingSubscription, BillingPackage } from '@/utils/billing';
import { useEscKey } from '@/hooks/useEscKey';
import { Pagination, SearchBox, useDebouncedValue } from './list-controls';
import CustomerPicker from './customer-picker';

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function tenureMonths(startDate?: string | null): number | null {
  if (!startDate) return null;
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00`);
  if (isNaN(start.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  return months < 0 ? 0 : months;
}

function tenureLabel(startDate?: string | null): string {
  const m = tenureMonths(startDate);
  if (m == null) return '—';
  if (m === 0) return '< 1 bulan';
  const years = Math.floor(m / 12);
  const rem = m % 12;
  if (years > 0 && rem > 0) return `${years} thn ${rem} bln`;
  if (years > 0) return `${years} tahun`;
  return `${m} bulan`;
}

export default function SubscriptionsTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<BillingSubscription[]>([]);
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [customerCount, setCustomerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: '', customer_label: '', package_id: '', start_date: todayStr() });
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const load = useCallback(async () => {
    if (workspaceId == null) { setItems([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const { subscriptions, total } = await billingApi.listSubscriptions({ page, limit, q: debouncedQ });
      setItems(subscriptions || []);
      setTotal(total || 0);
    } catch (e: any) {
      toast.error('Gagal memuat langganan', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [billingApi, workspaceId, page, debouncedQ]);

  useEffect(() => { load(); }, [load]);

  const loadMeta = useCallback(async () => {
    if (workspaceId == null) { setPackages([]); setCustomerCount(0); return; }
    try {
      const [pkgs, custs] = await Promise.all([
        billingApi.listPackages(),
        billingApi.listCustomers({ limit: 1 }),
      ]);
      setPackages(pkgs.packages || []);
      setCustomerCount(custs.total || 0);
    } catch {}
  }, [billingApi, workspaceId]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  useEffect(() => { setPage(1); }, [workspaceId]);

  useEscKey(open, () => setOpen(false));

  const create = async () => {
    if (!form.customer_id || !form.package_id) return toast.error('Pelanggan dan paket wajib dipilih');
    setSaving(true);
    try {
      const start = form.start_date || todayStr();
      const dueDay = Math.min(Math.max(Number(start.slice(8, 10)) || 1, 1), 28);
      await billingApi.createSubscription({
        customer_id: Number(form.customer_id),
        package_id: Number(form.package_id),
        start_date: start,
        due_day_of_month: dueDay,
      } as any);
      toast.success('Langganan dibuat');
      setOpen(false);
      setForm({ customer_id: '', customer_label: '', package_id: '', start_date: todayStr() });
      load();
    } catch (e: any) {
      toast.error('Gagal membuat langganan', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (s: BillingSubscription, status: BillingSubscription['status']) => {
    try {
      await billingApi.updateSubscription(s.id, { status });
      toast.success(`Status langganan: ${status}`);
      load();
    } catch (e: any) {
      toast.error('Gagal ubah status', { description: e.message });
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between gap-3 mb-4">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Cari pelanggan / paket..." />
        <Button onClick={() => setOpen(true)} disabled={customerCount === 0 || packages.length === 0}>
          <Plus size={18} /> Tambah Langganan
        </Button>
      </div>

      {customerCount === 0 || packages.length === 0 ? (
        <p className="text-xs text-amber-600 mb-4">Buat minimal 1 paket dan 1 pelanggan dulu sebelum membuat langganan.</p>
      ) : null}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1002] p-4"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 320 }}
              className="bg-card rounded-2xl shadow-2xl w-full max-w-lg border"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex justify-between items-center px-6 py-4 border-b">
                <h2 className="text-lg font-bold">Langganan Baru</h2>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
              </header>
              <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Pelanggan *</label>
                  <CustomerPicker
                    workspaceId={workspaceId}
                    value={form.customer_id}
                    label={form.customer_label}
                    onSelect={(c) => setForm({ ...form, customer_id: c ? String(c.id) : '', customer_label: c ? c.label : '' })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Paket *</label>
                  <select className={selectCls} value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
                    <option value="">— pilih —</option>
                    {packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({formatRupiah(p.price)})</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Tanggal Mulai</label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                  <p className="text-[11px] text-muted-foreground mt-1">Tanggal jatuh tempo tagihan tiap bulan mengikuti tanggal ini.</p>
                </div>
              </div>
              <footer className="flex justify-end gap-2 px-6 py-4 bg-secondary/50 rounded-b-2xl">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Batal</Button>
                <Button onClick={create} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={18} /> : 'Simpan'}</Button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">{debouncedQ ? 'Tidak ada langganan yang cocok.' : 'Belum ada langganan.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Pelanggan</th>
                <th className="py-2 pr-3">Paket</th>
                <th className="py-2 pr-3">Harga</th>
                <th className="py-2 pr-3">Lama Langganan</th>
                <th className="py-2 pr-3">Jatuh Tempo</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b hover:bg-accent/40">
                  <td className="py-2 pr-3 font-medium">{s.customer_name || s.whatsapp_number}</td>
                  <td className="py-2 pr-3">{s.package_name}</td>
                  <td className="py-2 pr-3">{formatRupiah(s.price)}</td>
                  <td className="py-2 pr-3">
                    <span className="font-medium">{tenureLabel(s.start_date)}</span>
                    {s.start_date && <span className="block text-xs text-muted-foreground">sejak {formatDateID(s.start_date)}</span>}
                  </td>
                  <td className="py-2 pr-3">tgl {s.due_day_of_month}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${s.status === 'active' ? 'bg-green-500/15 text-green-600' : s.status === 'suspended' ? 'bg-orange-500/15 text-orange-600' : 'bg-muted text-muted-foreground'}`}>{s.status}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <select className="text-xs rounded border border-input bg-background px-2 py-1" value={s.status} onChange={(e) => changeStatus(s, e.target.value as BillingSubscription['status'])}>
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="cancelled">cancelled</option>
                    </select>
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
