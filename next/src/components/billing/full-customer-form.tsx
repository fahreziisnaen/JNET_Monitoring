'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, X, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEscKey } from '@/hooks/useEscKey';
import { billingClient, createFullCustomer, fetchOdpAssets, formatRupiah, BillingPackage, OdpAsset, UnlinkedSecret } from '@/utils/billing';
import PppoeSecretPicker from './pppoe-secret-picker';

const MapPicker = dynamic(() => import('./map-picker'), {
  ssr: false,
  loading: () => (
    <div className="h-[280px] flex items-center justify-center bg-muted rounded-md">
      <Loader2 className="animate-spin text-muted-foreground" />
    </div>
  ),
});

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

export default function FullCustomerForm({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId?: number | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [secret, setSecret] = useState('');
  const [ktp, setKtp] = useState('');
  const [name, setName] = useState('');
  const [wa, setWa] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [odp, setOdp] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [odps, setOdps] = useState<OdpAsset[]>([]);
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [packageId, setPackageId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDay, setDueDay] = useState('1');
  const [saving, setSaving] = useState(false);

  useEscKey(true, onClose);

  useEffect(() => {
    fetchOdpAssets(workspaceId).then(setOdps).catch(() => setOdps([]));
    billingApi.listPackages().then((r) => setPackages(r.packages || [])).catch(() => setPackages([]));
  }, [workspaceId, billingApi]);

  const onPickSecret = (s: UnlinkedSecret | null) => {
    setSecret(s ? s.name : '');
    if (s && !name.trim()) setName(s.name);
    if (s?.connected_odp_id != null) setOdp(String(s.connected_odp_id));
  };

  const submit = async () => {
    if (!secret) return toast.error('Pilih PPPoE secret dulu');
    if (!name.trim()) return toast.error('Nama wajib diisi');
    if (!wa.trim()) return toast.error('Nomor WhatsApp wajib diisi');
    if (lat == null || lng == null) return toast.error('Tentukan lokasi rumah di peta');
    if (!packageId) return toast.error('Pilih paket langganan');
    setSaving(true);
    try {
      const { billingCustomerId } = await createFullCustomer(workspaceId, {
        pppoe_secret_name: secret,
        client_name: name.trim(),
        whatsapp_number: wa.trim(),
        latitude: String(lat),
        longitude: String(lng),
        odp_asset_id: odp || undefined,
        ktp_number: ktp.trim() || undefined,
        photo,
      });

      if (!billingCustomerId) {
        toast.warning('Pelanggan dibuat, tapi langganan dilewati', {
          description: 'Nomor WhatsApp ini sudah terdaftar sebagai pelanggan lain. Buat langganannya manual di tab Langganan.',
        });
        onCreated();
        return;
      }

      await billingApi.createSubscription({
        customer_id: billingCustomerId,
        package_id: Number(packageId),
        start_date: startDate || undefined,
        due_day_of_month: Number(dueDay) || 1,
      } as any);

      toast.success('Pelanggan & langganan berhasil dibuat');
      onCreated();
    } catch (e: any) {
      toast.error('Gagal membuat pelanggan', { description: e.message });
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
          <h2 className="text-lg font-bold">Tambah Pelanggan Baru</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </header>
        <div className="px-6 py-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground">1. PPPoE Secret * — dari MikroTik (hanya yang belum terpakai)</label>
          <PppoeSecretPicker workspaceId={workspaceId} value={secret} onSelect={onPickSecret} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">No. KTP</label>
          <Input value={ktp} onChange={(e) => setKtp(e.target.value)} placeholder="opsional" inputMode="numeric" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Nama *</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">No. WhatsApp *</label>
          <Input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="0823..." />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">ODP</label>
          <select className={selectCls} value={odp} onChange={(e) => setOdp(e.target.value)}>
            <option value="">— tidak terhubung —</option>
            {odps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 border-t pt-3 mt-1">
          <p className="text-sm font-medium mb-2">Langganan</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Paket *</label>
              <select className={selectCls} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                <option value="">— pilih paket —</option>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({formatRupiah(p.price)})</option>)}
              </select>
              {packages.length === 0 && <p className="text-xs text-amber-600 mt-1">Belum ada paket. Buat paket dulu di tab Paket.</p>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tanggal Mulai</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Jatuh Tempo (tanggal 1–28)</label>
              <Input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1"><MapPin size={14} /> Lokasi rumah * — klik / geser pin di peta</label>
          <MapPicker lat={lat} lng={lng} onPick={(la, ln) => { setLat(la); setLng(ln); }} />
          <div className="flex gap-2 mt-2">
            <Input value={lat ?? ''} onChange={(e) => setLat(e.target.value === '' ? null : Number(e.target.value))} placeholder="Latitude" />
            <Input value={lng ?? ''} onChange={(e) => setLng(e.target.value === '' ? null : Number(e.target.value))} placeholder="Longitude" />
          </div>
        </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground">Foto depan rumah (opsional)</label>
            <Input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          </div>
        </div>
        <footer className="flex justify-end gap-2 px-6 py-4 bg-secondary/50 rounded-b-2xl shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={submit} disabled={saving || packages.length === 0}>{saving ? <Loader2 className="animate-spin" size={18} /> : 'Simpan'}</Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
