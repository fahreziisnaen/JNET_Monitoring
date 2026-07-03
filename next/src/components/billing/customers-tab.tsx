'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Pencil, Trash2, Loader2, X, Search, Download, Eye, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import ConfirmModal from '@/components/ui/confirm-modal';
import { billingClient, formatRupiah, tenureLabel, formatDateID, BillingCustomer, BillingPackage, ImportableClient, ImportSummary, SkippedClient } from '@/utils/billing';
import { Pagination, SearchBox, useDebouncedValue } from './list-controls';
import FullCustomerForm from './full-customer-form';
import EditCustomerForm from './edit-customer-form';
import ViewCustomerModal from './view-customer-modal';
import MatchPackagesPanel from './match-packages-panel';

const REASON_LABEL: Record<SkippedClient['reason'], string> = {
  no_wa: 'Nomor WA tidak valid',
  dup_wa: 'Nomor WA duplikat (sudah dipakai pelanggan lain)',
  exists: 'Sudah terdaftar',
  error: 'Gagal diproses',
};

export default function CustomersTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [items, setItems] = useState<BillingCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [viewCustomer, setViewCustomer] = useState<BillingCustomer | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toDelete, setToDelete] = useState<BillingCustomer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [pkgFilter, setPkgFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const limit = 20;

  const [matchOpen, setMatchOpen] = useState(false);
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
      const { customers, total } = await billingApi.listCustomers({
        page, limit, q: debouncedQ, sort,
        package_id: pkgFilter ? Number(pkgFilter) : undefined,
        status: statusFilter || undefined,
      });
      setItems(customers || []);
      setTotal(total || 0);
    } catch (e: any) {
      toast.error('Gagal memuat pelanggan', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [billingApi, workspaceId, page, debouncedQ, sort, pkgFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (workspaceId == null) { setPackages([]); return; }
    billingApi.listPackages().then((r) => setPackages(r.packages || [])).catch(() => setPackages([]));
  }, [billingApi, workspaceId]);

  useEffect(() => { setPage(1); }, [workspaceId, debouncedQ, sort, pkgFilter, statusFilter]);

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

  const changeSubStatus = async (c: BillingCustomer, status: 'active' | 'suspended' | 'cancelled') => {
    if (!c.subscription_id) return;
    try {
      await billingApi.updateSubscription(c.subscription_id, { status } as any);
      toast.success(`Status langganan: ${status}`);
      load();
    } catch (e: any) {
      toast.error('Gagal ubah status langganan', { description: e.message });
    }
  };

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

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between gap-3 mb-3">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Cari nama / nomor / secret..." />
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => { setMatchOpen(true); setImportOpen(false); }}><Wand2 size={18} />Cocokkan Paket</Button>
          <Button variant="outline" className="gap-2" onClick={openImport}><Download size={18} />Import dari Monitoring</Button>
          <Button className="gap-2" onClick={() => setAddOpen(true)}><Plus size={18} />Tambah Pelanggan</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Urutkan:</span>
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
            <option value="recent">Terbaru</option>
            <option value="name">Nama (A–Z)</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Paket:</span>
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm max-w-[180px]" value={pkgFilter} onChange={(e) => setPkgFilter(e.target.value)}>
            <option value="">Semua paket</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Status:</span>
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Semua status</option>
            <option value="active">Aktif</option>
            <option value="suspended">Isolir</option>
            <option value="cancelled">Berhenti</option>
          </select>
        </div>
        {(pkgFilter || statusFilter || sort !== 'recent') && (
          <Button variant="ghost" size="sm" onClick={() => { setSort('recent'); setPkgFilter(''); setStatusFilter(''); }}>Reset</Button>
        )}
      </div>

      {addOpen && (
        <FullCustomerForm
          workspaceId={workspaceId}
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); setPage(1); load(); }}
        />
      )}

      {matchOpen && (
        <MatchPackagesPanel
          workspaceId={workspaceId}
          onClose={() => setMatchOpen(false)}
          onDone={load}
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

      {viewCustomer && (
        <ViewCustomerModal
          workspaceId={workspaceId}
          customer={viewCustomer}
          onClose={() => setViewCustomer(null)}
        />
      )}

      {editId != null && (
        <EditCustomerForm
          workspaceId={workspaceId}
          customerId={editId}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); load(); }}
        />
      )}

      <ConfirmModal
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus Pelanggan"
        description={`Hapus pelanggan "${toDelete?.name || toDelete?.whatsapp_number || ''}"? Langganan, seluruh invoice & pembayaran ikut terhapus permanen. Secret PPPoE di router MikroTik dan data monitoring (peta/ODP/foto) JUGA dihapus — pelanggan akan kehilangan koneksi internet.`}
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
                <th className="py-2 pr-3">Paket</th>
                <th className="py-2 pr-3">Lama Langganan</th>
                <th className="py-2 pr-3">Status Langganan</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b hover:bg-accent/40">
                  <td className="py-2 pr-3 font-medium">{c.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2 pr-3 font-mono">{c.whatsapp_number}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{c.ktp_number || <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-2 pr-3">
                    {c.package_name ? (
                      <>
                        <span className="font-medium">{c.package_name}</span>
                        {c.package_price != null && <span className="block text-xs text-muted-foreground">{formatRupiah(c.package_price)}/bln</span>}
                      </>
                    ) : <span className="text-muted-foreground">Belum ada paket</span>}
                  </td>
                  <td className="py-2 pr-3">
                    {c.subscription_id ? (
                      <>
                        <span>{tenureLabel(c.subscription_start_date)}</span>
                        {c.subscription_start_date && <span className="block text-xs text-muted-foreground">sejak {formatDateID(c.subscription_start_date)}</span>}
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 pr-3">
                    {c.subscription_id ? (
                      <select
                        className={`text-xs rounded border border-input bg-background px-2 py-1 ${c.subscription_status === 'active' ? 'text-green-600' : c.subscription_status === 'suspended' ? 'text-orange-600' : 'text-muted-foreground'}`}
                        value={c.subscription_status || 'active'}
                        onChange={(e) => changeSubStatus(c, e.target.value as 'active' | 'suspended' | 'cancelled')}
                      >
                        <option value="active">Aktif</option>
                        <option value="suspended">Isolir</option>
                        <option value="cancelled">Berhenti</option>
                      </select>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <button onClick={() => setViewCustomer(c)} className="p-1.5 rounded hover:bg-accent text-muted-foreground" title="Lihat detail"><Eye size={16} /></button>
                    <button onClick={() => setEditId(c.id)} className="p-1.5 rounded hover:bg-accent text-muted-foreground" title="Edit"><Pencil size={16} /></button>
                    <button onClick={() => setToDelete(c)} className="p-1.5 rounded hover:bg-accent text-destructive" title="Hapus"><Trash2 size={16} /></button>
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
