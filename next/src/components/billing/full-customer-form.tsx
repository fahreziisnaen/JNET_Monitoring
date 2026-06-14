'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, X, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { createFullCustomer, fetchOdpAssets, OdpAsset, UnlinkedSecret } from '@/utils/billing';
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
  const [secret, setSecret] = useState('');
  const [ktp, setKtp] = useState('');
  const [name, setName] = useState('');
  const [wa, setWa] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [odp, setOdp] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [odps, setOdps] = useState<OdpAsset[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchOdpAssets(workspaceId).then(setOdps).catch(() => setOdps([]));
  }, [workspaceId]);

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
    setSaving(true);
    try {
      await createFullCustomer(workspaceId, {
        pppoe_secret_name: secret,
        client_name: name.trim(),
        whatsapp_number: wa.trim(),
        latitude: String(lat),
        longitude: String(lng),
        odp_asset_id: odp || undefined,
        ktp_number: ktp.trim() || undefined,
        photo,
      });
      toast.success('Pelanggan dibuat & tersinkron ke billing');
      onCreated();
    } catch (e: any) {
      toast.error('Gagal membuat pelanggan', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 mb-6">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Tambah Pelanggan Baru</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
        <Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={18} /> : 'Simpan'}</Button>
      </div>
    </Card>
  );
}
