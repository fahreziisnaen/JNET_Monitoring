'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Pencil, Trash2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { billingClient, formatRupiah, BillingPackage } from '@/utils/billing';

type FormState = {
  id?: number;
  name: string;
  price: string;
  speed_mbps: string;
  pppoe_profile: string;
  description: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  name: '', price: '', speed_mbps: '', pppoe_profile: '', description: '', is_active: true,
};

export default function PackagesTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<BillingPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { packages } = await billingApi.listPackages();
      setItems(packages || []);
    } catch (e: any) {
      toast.error('Gagal memuat paket', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [billingApi]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => setForm({ ...emptyForm });
  const openEdit = (p: BillingPackage) => setForm({
    id: p.id,
    name: p.name,
    price: String(p.price ?? ''),
    speed_mbps: p.speed_mbps != null ? String(p.speed_mbps) : '',
    pppoe_profile: p.pppoe_profile ?? '',
    description: p.description ?? '',
    is_active: p.is_active === 1,
  });

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return toast.error('Nama paket wajib diisi');
    if (form.price === '' || isNaN(Number(form.price))) return toast.error('Harga tidak valid');
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        price: Number(form.price),
        speed_mbps: form.speed_mbps ? Number(form.speed_mbps) : null,
        pppoe_profile: form.pppoe_profile.trim() || null,
        description: form.description.trim() || null,
        is_active: form.is_active,
      };
      if (form.id) {
        await billingApi.updatePackage(form.id, body);
        toast.success('Paket diperbarui');
      } else {
        await billingApi.createPackage(body);
        toast.success('Paket dibuat');
      }
      setForm(null);
      load();
    } catch (e: any) {
      toast.error('Gagal menyimpan paket', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: BillingPackage) => {
    if (!confirm(`Hapus paket "${p.name}"?`)) return;
    try {
      await billingApi.deletePackage(p.id);
      toast.success('Paket dihapus');
      load();
    } catch (e: any) {
      toast.error('Gagal menghapus paket', { description: e.message });
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Daftar paket layanan (dipetakan ke profil PPPoE).</p>
        <Button onClick={openCreate}><Plus size={18} /> Tambah Paket</Button>
      </div>

      {form && (
        <Card className="p-4 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">{form.id ? 'Edit Paket' : 'Paket Baru'}</h3>
            <button onClick={() => setForm(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Nama Paket *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Home 20 Mbps" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Harga (Rp) *</label>
              <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="150000" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Kecepatan (Mbps)</label>
              <Input type="number" value={form.speed_mbps} onChange={(e) => setForm({ ...form, speed_mbps: e.target.value })} placeholder="20" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Profil PPPoE</label>
              <Input value={form.pppoe_profile} onChange={(e) => setForm({ ...form, pppoe_profile: e.target.value })} placeholder="mis. 20Mbps" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Deskripsi</label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Aktif
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setForm(null)}>Batal</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={18} /> : 'Simpan'}</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Belum ada paket. Klik "Tambah Paket".</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-lg font-bold text-primary">{formatRupiah(p.price)}<span className="text-xs font-normal text-muted-foreground">/bln</span></p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil size={16} /></button>
                  <button onClick={() => remove(p)} className="p-1.5 rounded hover:bg-accent text-destructive"><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground mt-2 space-y-0.5">
                {p.speed_mbps != null && <div>{p.speed_mbps} Mbps</div>}
                {p.pppoe_profile && <div>Profil: <span className="font-mono">{p.pppoe_profile}</span></div>}
                {p.description && <div>{p.description}</div>}
                {p.is_active === 0 && <span className="inline-block text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Nonaktif</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
