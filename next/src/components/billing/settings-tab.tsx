'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { billingClient, BillingSettings, GatewayStatus } from '@/utils/billing';

export default function BillingSettingsTab({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [s, setS] = useState<Partial<BillingSettings>>({});
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);

  const load = useCallback(async () => {
    if (workspaceId == null) { setLoading(false); return; }
    setLoading(true);
    try {
      const { settings, gateway } = await billingApi.getSettings();
      setGateway(gateway || null);
      if (settings) {
        setS(settings);
      } else {
        setS({ invoice_gen_day: 1, reminder_days_before: 3, grace_days: 3, auto_isolir_enabled: 0, isolir_profile: 'Isolir' });
      }
    } catch (e: any) {
      toast.error('Gagal memuat pengaturan', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [billingApi, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await billingApi.updateSettings({
        invoice_gen_day: Number(s.invoice_gen_day) || 1,
        reminder_days_before: Number(s.reminder_days_before) || 0,
        grace_days: Number(s.grace_days) || 0,
        auto_isolir_enabled: s.auto_isolir_enabled ? 1 : 0,
        isolir_profile: s.isolir_profile || 'Isolir',
      });
      toast.success('Pengaturan billing disimpan');
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
        <p className="text-xs text-muted-foreground mb-4">Kredensial Tripay disetel global di server lewat file <code>.env</code>, bukan di sini. Berlaku untuk semua workspace.</p>
        {gateway?.configured ? (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 size={18} /> Gateway terkonfigurasi — mode <span className="font-medium">{gateway.mode}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertCircle size={18} /> Gateway belum dikonfigurasi (mode simulasi). Isi <code>TRIPAY_*</code> di <code>.env</code> server.
          </div>
        )}
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
