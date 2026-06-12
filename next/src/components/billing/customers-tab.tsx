'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Pencil, Loader2, X, Search, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { billingClient, BillingCustomer, ImportableClient } from '@/utils/billing';

type FormState = {
  id?: number;
  name: string;
  whatsapp_number: string;
  pppoe_secret_name: string;
  email: string;
  address: string;
  status: 'active' | 'inactive' | 'suspended';
};

const emptyForm: FormState = {
  name: '', whatsapp_number: '', pppoe_secret_name: '', email: '', address: '', status: 'active',
};

export default function CustomersTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<BillingCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

  // Import dari Client monitoring
  const [importOpen, setImportOpen] = useState(false);
  const [importable, setImportable] = useState<ImportableClient[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [impQ, setImpQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { customers } = await billingApi.listCustomers();
      setItems(customers || []);
    } catch (e: any) {
      toast.error('Gagal memuat pelanggan', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [billingApi]);

  useEffect(() => { load(); }, [load]);

  const openImport = async () => {
    setImportOpen(true);
    setSelected(new Set());
    setImpQ('');
    setImportLoading(true);
    try {
      const { clients } = await billingApi.listImportableClients();
      setImportable(clients || []);
    } catch (e: any) {
      toast.error('Gagal memuat client', { description: e.message });
      setImportable([]);
    } finally {
      setImportLoading(false);
    }
  };

  const impFiltered = importable.filter((c) => {
    if (!impQ) return true;
    const s = impQ.toLowerCase();
    return (c.client_name || '').toLowerCase().includes(s)
      || (c.whatsapp_number || '').includes(s)
      || (c.pppoe_secret_name || '').toLowerCase().includes(s);
  });

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const allShownSelected = impFiltered.length > 0 && impFiltered.every((c) => selected.has(c.id));
  const toggleAllShown = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allShownSelected) impFiltered.forEach((c) => next.delete(c.id));
    else impFiltered.forEach((c) => next.add(c.id));
    return next;
  });

  const doImport = async (all: boolean) => {
    setImporting(true);
    try {
      const body = all ? { all: true } : { client_ids: Array.from(selected) };
      const { summary } = await billingApi.importClients(body);
      toast.success('Import selesai', {
        description: `Dibuat ${summary.created}, ditautkan ${summary.relinked}, dilewati ${summary.skipped} dari ${summary.total}.`,
      });
      setImportOpen(false);
      load();
    } catch (e: any) {
      toast.error('Gagal mengimpor', { description: e.message });
    } finally {
      setImporting(false);
    }
  };

  const openEdit = (c: BillingCustomer) => setForm({
    id: c.id,
    name: c.name ?? '',
    whatsapp_number: c.whatsapp_number ?? '',
    pppoe_secret_name: c.pppoe_secret_name ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    status: c.status,
  });

  const save = async () => {
    if (!form) return;
    if (!form.whatsapp_number.trim()) return toast.error('Nomor WhatsApp wajib diisi');
    setSaving(true);
    try {
      const body = {
        name: form.name.trim() || null,
        whatsapp_number: form.whatsapp_number.trim(),
        pppoe_secret_name: form.pppoe_secret_name.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        status: form.status,
      };
      if (form.id) {
        await billingApi.updateCustomer(form.id, body);
        toast.success('Pelanggan diperbarui');
      } else {
        await billingApi.createCustomer(body);
        toast.success('Pelanggan dibuat');
      }
      setForm(null);
      load();
    } catch (e: any) {
      toast.error('Gagal menyimpan pelanggan', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const filtered = items.filter((c) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (c.name || '').toLowerCase().includes(s)
      || (c.whatsapp_number || '').includes(s)
      || (c.pppoe_secret_name || '').toLowerCase().includes(s);
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Cari nama / nomor / secret..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openImport}><Download size={18} /> Import dari Monitoring</Button>
          <Button onClick={() => setForm({ ...emptyForm })}><Plus size={18} /> Tambah Pelanggan</Button>
        </div>
      </div>

      {importOpen && (
        <Card className="p-4 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">Import Pelanggan dari Client Monitoring</h3>
            <button onClick={() => setImportOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Hanya client yang punya nomor WhatsApp & belum terdaftar di billing yang ditampilkan. Nama, nomor, dan secret PPPoE akan tersalin otomatis.
          </p>

          {importLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : importable.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Tidak ada client yang bisa diimpor (semua sudah terdaftar atau tanpa nomor WA).</p>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Cari client..." value={impQ} onChange={(e) => setImpQ(e.target.value)} />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} />
                    Pilih semua ({impFiltered.length})
                  </label>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto border rounded-md mb-3">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 px-3 w-8"></th>
                      <th className="py-2 pr-3">Nama</th>
                      <th className="py-2 pr-3">WhatsApp</th>
                      <th className="py-2 pr-3">Secret PPPoE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impFiltered.map((c) => (
                      <tr key={c.id} className="border-b hover:bg-accent/40 cursor-pointer" onClick={() => toggle(c.id)}>
                        <td className="py-2 px-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} onClick={(e) => e.stopPropagation()} /></td>
                        <td className="py-2 pr-3 font-medium">{c.client_name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-2 pr-3 font-mono">{c.whatsapp_number}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{c.pppoe_secret_name || <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>Batal</Button>
                <Button variant="outline" onClick={() => doImport(true)} disabled={importing}>
                  {importing ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />} Import Semua ({importable.length})
                </Button>
                <Button onClick={() => doImport(false)} disabled={importing || selected.size === 0}>
                  {importing ? <Loader2 className="animate-spin" size={18} /> : null} Import Terpilih ({selected.size})
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {form && (
        <Card className="p-4 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">{form.id ? 'Edit Pelanggan' : 'Pelanggan Baru'}</h3>
            <button onClick={() => setForm(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Nama</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Nomor WhatsApp *</label>
              <Input value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} placeholder="0823..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Nama Secret PPPoE</label>
              <Input value={form.pppoe_secret_name} onChange={(e) => setForm({ ...form, pppoe_secret_name: e.target.value })} placeholder="untuk isolir/unisolir" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })}
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="suspended">suspended</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Email</label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Alamat</label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setForm(null)}>Batal</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={18} /> : 'Simpan'}</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Belum ada pelanggan.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Nama</th>
                <th className="py-2 pr-3">WhatsApp</th>
                <th className="py-2 pr-3">Secret PPPoE</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b hover:bg-accent/40">
                  <td className="py-2 pr-3 font-medium">{c.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2 pr-3 font-mono">{c.whatsapp_number}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{c.pppoe_secret_name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${c.status === 'active' ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground'}`}>{c.status}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil size={16} /></button>
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
