'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { billingClient, formatRupiah, BillingSubscription, BillingCustomer, BillingPackage } from '@/utils/billing';

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

export default function SubscriptionsTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<BillingSubscription[]>([]);
  const [customers, setCustomers] = useState<BillingCustomer[]>([]);
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: '', package_id: '', start_date: '', due_day_of_month: '1' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [subs, custs, pkgs] = await Promise.all([
        billingApi.listSubscriptions(),
        billingApi.listCustomers(),
        billingApi.listPackages(),
      ]);
      setItems(subs.subscriptions || []);
      setCustomers(custs.customers || []);
      setPackages(pkgs.packages || []);
    } catch (e: any) {
      toast.error('Gagal memuat langganan', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [billingApi]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.customer_id || !form.package_id) return toast.error('Pelanggan dan paket wajib dipilih');
    setSaving(true);
    try {
      await billingApi.createSubscription({
        customer_id: Number(form.customer_id),
        package_id: Number(form.package_id),
        start_date: form.start_date || undefined,
        due_day_of_month: Number(form.due_day_of_month) || 1,
      } as any);
      toast.success('Langganan dibuat');
      setOpen(false);
      setForm({ customer_id: '', package_id: '', start_date: '', due_day_of_month: '1' });
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
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Langganan menghubungkan pelanggan dengan paket + tanggal jatuh tempo.</p>
        <Button onClick={() => setOpen(true)} disabled={customers.length === 0 || packages.length === 0}>
          <Plus size={18} /> Tambah Langganan
        </Button>
      </div>

      {customers.length === 0 || packages.length === 0 ? (
        <p className="text-xs text-amber-600 mb-4">Buat minimal 1 paket dan 1 pelanggan dulu sebelum membuat langganan.</p>
      ) : null}

      {open && (
        <Card className="p-4 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">Langganan Baru</h3>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Pelanggan *</label>
              <select className={selectCls} value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">— pilih —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name || c.whatsapp_number}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Paket *</label>
              <select className={selectCls} value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
                <option value="">— pilih —</option>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({formatRupiah(p.price)})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tanggal Mulai</label>
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Jatuh Tempo (tanggal 1–28)</label>
              <Input type="number" min={1} max={28} value={form.due_day_of_month} onChange={(e) => setForm({ ...form, due_day_of_month: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={create} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={18} /> : 'Simpan'}</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Belum ada langganan.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Pelanggan</th>
                <th className="py-2 pr-3">Paket</th>
                <th className="py-2 pr-3">Harga</th>
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
    </div>
  );
}
