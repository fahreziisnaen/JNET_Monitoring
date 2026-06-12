'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { billingClient, BillingSettings } from '@/utils/billing';

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

export default function BillingSettingsTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [s, setS] = useState<Partial<BillingSettings>>({});
  // Kunci diisi hanya jika admin mengetik baru (current value di-mask oleh backend).
  const [apiKey, setApiKey] = useState('');
  const [privKey, setPrivKey] = useState('');
  const [maskedApi, setMaskedApi] = useState<string | null>(null);
  const [maskedPriv, setMaskedPriv] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { settings } = await billingApi.getSettings();
      if (settings) {
        setS(settings);
        setMaskedApi(settings.tripay_api_key);
        setMaskedPriv(settings.tripay_private_key);
      } else {
        setS({ tripay_mode: 'sandbox', invoice_gen_day: 1, reminder_days_before: 3, grace_days: 3, auto_isolir_enabled: 0, isolir_profile: 'Isolir' });
      }
    } catch (e: any) {
      toast.error('Gagal memuat pengaturan', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [billingApi]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const body: Partial<BillingSettings> = {
        tripay_merchant_code: s.tripay_merchant_code || null,
        tripay_mode: s.tripay_mode || 'sandbox',
        invoice_gen_day: Number(s.invoice_gen_day) || 1,
        reminder_days_before: Number(s.reminder_days_before) || 0,
        grace_days: Number(s.grace_days) || 0,
        auto_isolir_enabled: s.auto_isolir_enabled ? 1 : 0,
        isolir_profile: s.isolir_profile || 'Isolir',
      };
      // Kirim kunci hanya jika diisi baru (hindari menimpa dengan nilai mask).
      if (apiKey.trim()) body.tripay_api_key = apiKey.trim();
      if (privKey.trim()) body.tripay_private_key = privKey.trim();

      await billingApi.updateSettings(body);
      toast.success('Pengaturan billing disimpan');
      setApiKey(''); setPrivKey('');
      load();
    } catch (e: any) {
      toast.error('Gagal menyimpan pengaturan', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="p-4">
        <h3 className="font-semibold mb-1">Payment Gateway — Tripay</h3>
        <p className="text-xs text-muted-foreground mb-4">Kredensial dipakai untuk membuat transaksi & memverifikasi webhook. Kunci tidak ditampilkan utuh setelah disimpan.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Merchant Code</label>
            <Input value={s.tripay_merchant_code || ''} onChange={(e) => setS({ ...s, tripay_merchant_code: e.target.value })} placeholder="T1234" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Mode</label>
            <select className={selectCls} value={s.tripay_mode || 'sandbox'} onChange={(e) => setS({ ...s, tripay_mode: e.target.value as BillingSettings['tripay_mode'] })}>
              <option value="sandbox">sandbox</option>
              <option value="production">production</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">API Key {maskedApi && <span className="text-muted-foreground/70">(tersimpan: {maskedApi})</span>}</label>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={maskedApi ? 'Biarkan kosong jika tidak diubah' : 'Masukkan API key'} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Private Key {maskedPriv && <span className="text-muted-foreground/70">(tersimpan)</span>}</label>
            <Input type="password" value={privKey} onChange={(e) => setPrivKey(e.target.value)} placeholder={maskedPriv ? 'Biarkan kosong jika tidak diubah' : 'Masukkan private key'} />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-1">Kebijakan Tagihan & Isolir</h3>
        <p className="text-xs text-muted-foreground mb-4">Mengatur generate invoice, reminder, masa tenggang, dan auto-isolir.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Tanggal generate invoice</label>
            <Input type="number" min={1} max={28} value={s.invoice_gen_day ?? 1} onChange={(e) => setS({ ...s, invoice_gen_day: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Reminder H- (hari sebelum jatuh tempo)</label>
            <Input type="number" min={0} value={s.reminder_days_before ?? 3} onChange={(e) => setS({ ...s, reminder_days_before: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Masa tenggang (hari setelah jatuh tempo)</label>
            <Input type="number" min={0} value={s.grace_days ?? 3} onChange={(e) => setS({ ...s, grace_days: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Nama profil Isolir</label>
            <Input value={s.isolir_profile || 'Isolir'} onChange={(e) => setS({ ...s, isolir_profile: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={!!s.auto_isolir_enabled} onChange={(e) => setS({ ...s, auto_isolir_enabled: e.target.checked ? 1 : 0 })} />
            Aktifkan auto-isolir setelah masa tenggang habis
          </label>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} Simpan Pengaturan</Button>
      </div>
    </div>
  );
}
