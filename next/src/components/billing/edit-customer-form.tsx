'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, X, MapPin, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEscKey } from '@/hooks/useEscKey';
import { billingClient, updateClientGeo, fetchOdpAssets, formatRupiah, BillingPackage, OdpAsset, CustomerDetail } from '@/utils/billing';
import { apiFetch } from '@/utils/api';
import OdpPicker from './odp-picker';
import DateField from './date-field';

const MapPicker = dynamic(() => import('./map-picker'), {
  ssr: false,
  loading: () => (
    <div className="h-[280px] flex items-center justify-center bg-muted rounded-md">
      <Loader2 className="animate-spin text-muted-foreground" />
    </div>
  ),
});

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1.5';

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function EditCustomerForm({
  workspaceId,
  customerId,
  onClose,
  onSaved,
}: {
  workspaceId?: number | null;
  customerId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);

  const [name, setName] = useState('');
  const [wa, setWa] = useState('');
  const [ktp, setKtp] = useState('');
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'suspended'>('active');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [odp, setOdp] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [coordText, setCoordText] = useState('');
  const [packageId, setPackageId] = useState('');
  const [startDate, setStartDate] = useState(todayStr);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [secrets, setSecrets] = useState<string[]>([]);
  const [odps, setOdps] = useState<OdpAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEscKey(true, onClose);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    Promise.all([
      billingApi.getCustomerDetail(customerId),
      billingApi.listPackages().then((r) => r.packages || []).catch(() => []),
      fetchOdpAssets(workspaceId).catch(() => []),
      apiFetch(`${apiUrl}/api/pppoe/secrets?workspaceId=${workspaceId}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: Array<{ name?: string }>) => (Array.isArray(rows) ? rows.map((s) => s.name).filter(Boolean) as string[] : []))
        .catch(() => [] as string[]),
    ]).then(([d, pkgs, odpList, secretList]) => {
      if (!active) return;
      const c = d.customer;
      setDetail(d);
      setName(c.name ?? '');
      setWa(c.whatsapp_number ?? '');
      setKtp(c.ktp_number ?? '');
      setSecret(c.pppoe_secret_name ?? '');
      setStatus(c.status);
      setEmail(c.email ?? '');
      setAddress(c.address ?? '');
      setOdp(c.odp_asset_id != null ? String(c.odp_asset_id) : '');
      const la = c.latitude != null && c.latitude !== '' ? Number(c.latitude) : null;
      const ln = c.longitude != null && c.longitude !== '' ? Number(c.longitude) : null;
      setLat(la);
      setLng(ln);
      if (la != null && ln != null) setCoordText(`${la}, ${ln}`);
      setExistingPhotoUrl(c.photo_url ? `${process.env.NEXT_PUBLIC_API_BASE_URL}${c.photo_url}` : null);
      setPackages(pkgs);
      setSecrets(secretList);
      setOdps(odpList);
      if (d.subscription) setPackageId(String(d.subscription.package_id));
      if (d.subscription?.start_date) setStartDate(d.subscription.start_date);
    }).catch((e) => {
      if (active) toast.error('Gagal memuat detail pelanggan', { description: e.message });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [billingApi, customerId, workspaceId]);

  useEffect(() => {
    if (!photo) { setPhotoUrl(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'));
      if (!item) return;
      const f = item.getAsFile();
      if (f) { e.preventDefault(); setPhoto(f); toast.success('Foto ditempel dari clipboard'); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const clientId = detail?.customer.client_id ?? null;
  const hasSub = !!detail?.subscription;
  const previewSrc = photoUrl || existingPhotoUrl;

  const applyCoordText = (v: string) => {
    setCoordText(v);
    const parts = v.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      const la = Number(parts[0]);
      const ln = Number(parts[1]);
      if (!Number.isNaN(la) && !Number.isNaN(ln)) { setLat(la); setLng(ln); return; }
    }
    setLat(null);
    setLng(null);
  };

  const onMapPick = (la: number, ln: number) => {
    setLat(la);
    setLng(ln);
    setCoordText(`${la.toFixed(6)}, ${ln.toFixed(6)}`);
  };

  const pickFile = (f: File | null) => {
    if (f && !f.type.startsWith('image/')) return toast.error('File harus berupa gambar');
    setPhoto(f);
  };

  const submit = async () => {
    if (!wa.trim()) return toast.error('Nomor WhatsApp wajib diisi');
    setSaving(true);
    try {
      await billingApi.updateCustomer(customerId, {
        name: name.trim() || null,
        whatsapp_number: wa.trim(),
        ktp_number: ktp.trim() || null,
        pppoe_secret_name: secret.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        status,
      });

      if (clientId) {
        const geo: { latitude?: string; longitude?: string; odp_asset_id?: string | null; photo?: File | null } = {
          odp_asset_id: odp || '',
          photo,
        };
        if (lat != null && lng != null) { geo.latitude = String(lat); geo.longitude = String(lng); }
        await updateClientGeo(workspaceId, clientId, geo);
      }

      let subResult: any = null;
      if (packageId) {
        if (hasSub) {
          const sub = detail!.subscription!;
          const body: Record<string, unknown> = {};
          if (Number(packageId) !== sub.package_id) body.package_id = Number(packageId);
          if (startDate && startDate !== String(sub.start_date || '').slice(0, 10)) {
            body.start_date = startDate;
            body.due_day_of_month = Math.min(Math.max(Number(startDate.slice(8, 10)) || 1, 1), 28);
          }
          if (Object.keys(body).length) subResult = await billingApi.updateSubscription(sub.id, body as any);
        } else {
          const start = startDate || todayStr();
          const dueDay = Math.min(Math.max(Number(start.slice(8, 10)) || 1, 1), 28);
          subResult = await billingApi.createSubscription({ customer_id: customerId, package_id: Number(packageId), start_date: start, due_day_of_month: dueDay } as any);
        }
      }

      const sync = subResult?.profile_sync;
      if (sync && !sync.ok) {
        toast.warning('Paket tersimpan, tapi profil MikroTik belum sinkron', { description: sync.message });
      } else if (sync?.ok) {
        toast.success('Pelanggan diperbarui', { description: sync.message });
      } else {
        toast.success('Pelanggan diperbarui');
      }
      onSaved();
    } catch (e: any) {
      toast.error('Gagal menyimpan perubahan', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1002] p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 22, stiffness: 320 }}
        className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl border flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex justify-between items-center px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-bold">Edit Pelanggan</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </header>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="px-6 py-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Secret PPPoE (dari MikroTik — untuk isolir/unisolir & ganti profil)</label>
              {secrets.length > 0 ? (
                <select className={selectCls} value={secret} onChange={(e) => setSecret(e.target.value)}>
                  <option value="">— pilih secret —</option>
                  {secret && !secrets.includes(secret) && <option value={secret}>{secret} (tersimpan, tak ada di router)</option>}
                  {secrets.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="nama secret (router tak terjangkau)" />
              )}
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Nama</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>No. WhatsApp *</label>
              <Input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="0823..." />
            </div>
            <div>
              <label className={labelCls}>No. KTP</label>
              <Input value={ktp} onChange={(e) => setKtp(e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
                <option value="suspended">Isolir</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>ODP</label>
              {clientId ? (
                <OdpPicker odps={odps} value={odp} onSelect={setOdp} />
              ) : (
                <p className="text-xs text-muted-foreground py-2">Tidak tertaut ke client monitoring.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Alamat</label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>

            <div className="sm:col-span-2 border-t pt-4 mt-1">
              <p className="text-sm font-semibold mb-3">Langganan</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <div>
                  <label className={labelCls}>Paket <span className="font-normal text-muted-foreground/70">{hasSub ? '(ubah untuk upgrade/downgrade)' : '(buat langganan)'}</span></label>
                  <select className={selectCls} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                    <option value="">— pilih paket —</option>
                    {packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({formatRupiah(p.price)})</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tanggal Pasang / Mulai Langganan</label>
                  <DateField value={startDate} onChange={setStartDate} />
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Jatuh tempo tagihan bulanan mengikuti tanggal ini{hasSub && detail?.subscription?.due_day_of_month ? ` (saat ini tiap tanggal ${detail.subscription.due_day_of_month})` : ''}.
                  </p>
                </div>
              </div>
            </div>

            {clientId && (
              <>
                <div className="sm:col-span-2">
                  <label className={`${labelCls} flex items-center gap-1`}><MapPin size={14} /> Lokasi rumah <span className="font-normal text-muted-foreground/70">— klik / geser pin di peta</span></label>
                  <MapPicker lat={lat} lng={lng} onPick={onMapPick} />
                  <Input
                    className="mt-2"
                    value={coordText}
                    onChange={(e) => applyCoordText(e.target.value)}
                    placeholder="Latitude, Longitude — mis. -7.746600, 113.211900"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Tempel koordinat dari Google Maps (format: lintang, bujur).</p>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Foto depan rumah</label>
                  <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0] || null); }}
                    className={`mt-1 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent/40'}`}
                  >
                    {previewSrc ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewSrc} alt="Foto rumah" className="max-h-48 w-auto rounded-md object-contain" />
                        <span className="text-xs text-muted-foreground">{photo ? photo.name : 'Foto saat ini — klik/seret/tempel untuk ganti'}</span>
                        {photo && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); pickFile(null); }} className="text-xs text-destructive hover:underline">Batalkan foto baru</button>
                        )}
                      </>
                    ) : (
                      <>
                        <ImagePlus size={22} className="text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Seret & lepas, tempel (Ctrl+V), atau klik untuk pilih</span>
                      </>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <footer className="flex justify-end gap-2 px-6 py-4 bg-secondary/50 rounded-b-2xl shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={submit} disabled={saving || loading}>{saving ? <Loader2 className="animate-spin" size={18} /> : 'Simpan'}</Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
