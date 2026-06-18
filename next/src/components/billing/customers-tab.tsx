'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Pencil, Trash2, Loader2, X, Search, Download } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import ConfirmModal from '@/components/ui/confirm-modal';
import { useEscKey } from '@/hooks/useEscKey';
import { billingClient, BillingCustomer, ImportableClient, ImportSummary, SkippedClient } from '@/utils/billing';
import { Pagination, SearchBox, useDebouncedValue } from './list-controls';
import FullCustomerForm from './full-customer-form';

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

const REASON_LABEL: Record<SkippedClient['reason'], string> = {
  no_wa: 'Nomor WA tidak valid',
  dup_wa: 'Nomor WA duplikat (sudah dipakai pelanggan lain)',
  exists: 'Sudah terdaftar',
  error: 'Gagal diproses',
};

type FormState = {
  id?: number;
  name: string;
  whatsapp_number: string;
  pppoe_secret_name: string;
  ktp_number: string;
  email: string;
  address: string;
  status: 'active' | 'inactive' | 'suspended';
};

export default function CustomersTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<BillingCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<BillingCustomer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [importOpen, setImportOpen] = useState(false);
  const [importable, setImportable] = useState<ImportableClient[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [impQ, setImpQ] = useState('');
  const [importResult, setImportResult] = useState<{ summary: ImportSummary; skipped: SkippedClient[] } | null>(null);

  const load = useCallback(async () => {
    if (workspaceId == null) { setItems([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const { customers, total } = await billingApi.listCustomers({ page, limit, q: debouncedQ });
      setItems(customers || []);
      setTotal(total || 0);
    } catch (e: any) {
      toast.error('Gagal memuat pelanggan', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [billingApi, workspaceId, page, debouncedQ]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(1); }, [workspaceId]);

  useEscKey(!!form, () => setForm(null));

  const openImport = async () => {
    setImportOpen(true);
    setSelected(new Set());
    setImpQ('');
    setImportResult(null);
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
      const { summary, skipped } = await billingApi.importClients(body);
      toast.success('Import selesai', {
        description: `Dibuat ${summary.created}, ditautkan ${summary.relinked}, dilewati ${summary.skipped} dari ${summary.total}.`,
      });
      setImportResult({ summary, skipped: skipped || [] });
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
    ktp_number: c.ktp_number ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    status: c.status,
  });

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await billingApi.deleteCustomer(toDelete.id);
      toast.success('Pelanggan dihapus');
      setToDelete(null);
      load();
    } catch (e: any) {
      toast.error('Gagal menghapus pelanggan', { description: e.message });
    } finally {
      setDeleting(false);
    }
  };

  const save = async () => {
    if (!form) return;
    if (!form.whatsapp_number.trim()) return toast.error('Nomor WhatsApp wajib diisi');
    setSaving(true);
    try {
      const body = {
        name: form.name.trim() || null,
        whatsapp_number: form.whatsapp_number.trim(),
        pppoe_secret_name: form.pppoe_secret_name.trim() || null,
        ktp_number: form.ktp_number.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        status: form.status,
      };
      await billingApi.updateCustomer(form.id!, body);
      toast.success('Pelanggan diperbarui');
      setForm(null);
      load();
    } catch (e: any) {
      toast.error('Gagal menyimpan pelanggan', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between gap-3 mb-4">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Cari nama / nomor / secret..." />
        <div className="flex gap-2">
          <Button variant="outline" onClick={openImport}><Download size={18} /> Import dari Monitoring</Button>
          <Button onClick={() => setAddOpen(true)}><Plus size={18} /> Tambah Pelanggan</Button>
        </div>
      </div>

      {addOpen && (
        <FullCustomerForm
          workspaceId={workspaceId}
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); setPage(1); load(); }}
        />
      )}

      {importOpen && (
        <Card className="p-4 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">Import Pelanggan dari Client Monitoring</h3>
            <button onClick={() => setImportOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Hanya client yang punya nomor WhatsApp & belum terdaftar di billing yang ditampilkan. Nama, nomor, dan secret PPPoE akan tersalin otomatis.
          </p>

          {importResult ? (
            <div>
              <div className="flex flex-wrap gap-2 mb-3 text-sm">
                <span className="px-2 py-1 rounded bg-green-500/15 text-green-600">Dibuat {importResult.summary.created}</span>
                <span className="px-2 py-1 rounded bg-blue-500/15 text-blue-600">Ditautkan {importResult.summary.relinked}</span>
                <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Dilewati {importResult.summary.skipped}</span>
                <span className="px-2 py-1 rounded bg-secondary text-muted-foreground">Total {importResult.summary.total}</span>
              </div>

              {importResult.skipped.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Semua client berhasil diproses, tidak ada yang dilewati.</p>
              ) : (
                <>
                  <p className="text-sm font-medium mb-2">Client yang dilewati ({importResult.skipped.length})</p>
                  <div className="max-h-72 overflow-y-auto border rounded-md mb-3">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card">
                        <tr className="text-left text-muted-foreground border-b">
                          <th className="py-2 px-3">Nama</th>
                          <th className="py-2 pr-3">WhatsApp</th>
                          <th className="py-2 pr-3">Alasan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.skipped.map((s, i) => (
                          <tr key={i} className="border-b">
                            <td className="py-2 px-3 font-medium">{s.client_name || <span className="text-muted-foreground">—</span>}</td>
                            <td className="py-2 pr-3 font-mono">{s.whatsapp_number || <span className="text-muted-foreground">—</span>}</td>
                            <td className="py-2 pr-3 text-amber-600">{REASON_LABEL[s.reason] || s.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Nomor WA duplikat: nomor itu sudah dipakai pelanggan billing lain (cek juga format seperti 0812… vs 62812…). Edit dulu nomornya di Monitoring, lalu impor ulang.
                  </p>
                </>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={openImport} disabled={importing}>Impor Lagi</Button>
                <Button onClick={() => setImportOpen(false)}>Selesai</Button>
              </div>
            </div>
          ) : importLoading ? (
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

      <AnimatePresence>
        {form && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1002] p-4"
            onClick={() => setForm(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 320 }}
              className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl border flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex justify-between items-center px-6 py-4 border-b shrink-0">
                <h2 className="text-lg font-bold">Edit Pelanggan</h2>
                <button onClick={() => setForm(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
              </header>
              <div className="px-6 py-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Nama</label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">No. WhatsApp *</label>
                  <Input value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} placeholder="0823..." />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">No. KTP</label>
                  <Input value={form.ktp_number} onChange={(e) => setForm({ ...form, ktp_number: e.target.value })} inputMode="numeric" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Nama Secret PPPoE</label>
                  <Input value={form.pppoe_secret_name} onChange={(e) => setForm({ ...form, pppoe_secret_name: e.target.value })} placeholder="untuk isolir/unisolir" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Status</label>
                  <select
                    className={selectCls}
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
              <footer className="flex justify-end gap-2 px-6 py-4 bg-secondary/50 rounded-b-2xl shrink-0">
                <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>Batal</Button>
                <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={18} /> : 'Simpan'}</Button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus Pelanggan"
        description={`Hapus pelanggan "${toDelete?.name || toDelete?.whatsapp_number || ''}"? Langganan & seluruh invoice pelanggan ini ikut terhapus permanen.`}
        confirmText="Hapus"
        isLoading={deleting}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">{debouncedQ ? 'Tidak ada pelanggan yang cocok.' : 'Belum ada pelanggan.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Nama</th>
                <th className="py-2 pr-3">WhatsApp</th>
                <th className="py-2 pr-3">No. KTP</th>
                <th className="py-2 pr-3">Secret PPPoE</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b hover:bg-accent/40">
                  <td className="py-2 pr-3 font-medium">{c.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2 pr-3 font-mono">{c.whatsapp_number}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{c.ktp_number || <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{c.pppoe_secret_name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${c.status === 'active' ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground'}`}>{c.status}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil size={16} /></button>
                    <button onClick={() => setToDelete(c)} className="p-1.5 rounded hover:bg-accent text-destructive"><Trash2 size={16} /></button>
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
