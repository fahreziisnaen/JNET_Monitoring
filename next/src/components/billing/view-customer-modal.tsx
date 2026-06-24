'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, X, MapPin, Phone, Mail, IdCard, Home, Package as PackageIcon,
  CalendarDays, KeyRound, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { useEscKey } from '@/hooks/useEscKey';
import { billingClient, formatRupiah, formatDateID, tenureLabel, BillingCustomer, CustomerDetail } from '@/utils/billing';

const custStatusLabel: Record<string, string> = { active: 'Aktif', inactive: 'Nonaktif', suspended: 'Isolir' };
const custStatusCls: Record<string, string> = {
  active: 'bg-green-500/15 text-green-600',
  inactive: 'bg-muted text-muted-foreground',
  suspended: 'bg-orange-500/15 text-orange-600',
};
const subStatusLabel: Record<string, string> = { active: 'Aktif', suspended: 'Isolir', cancelled: 'Berhenti' };

function Row({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-b-0">
      <Icon size={16} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium break-words">{children}</div>
      </div>
    </div>
  );
}

const dash = <span className="text-muted-foreground font-normal">—</span>;

export default function ViewCustomerModal({
  workspaceId,
  customer,
  onClose,
}: {
  workspaceId?: number | null;
  customer: BillingCustomer;
  onClose: () => void;
}) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);

  useEscKey(true, onClose);

  useEffect(() => {
    let active = true;
    setLoading(true);
    billingApi.getCustomerDetail(customer.id)
      .then((d) => { if (active) setDetail(d); })
      .catch((e) => { if (active) toast.error('Gagal memuat detail pelanggan', { description: e.message }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [billingApi, customer.id]);

  const c = detail?.customer;
  const lat = c?.latitude != null && c.latitude !== '' ? Number(c.latitude) : null;
  const lng = c?.longitude != null && c.longitude !== '' ? Number(c.longitude) : null;
  const photoSrc = c?.photo_url ? `${process.env.NEXT_PUBLIC_API_BASE_URL}${c.photo_url}` : null;
  const subStatus = customer.subscription_status || null;

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
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{customer.name || customer.whatsapp_number}</h2>
            <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded ${custStatusCls[customer.status] || ''}`}>
              {custStatusLabel[customer.status] || customer.status}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </header>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="px-6 py-5 overflow-y-auto space-y-5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Foto Rumah</p>
              {photoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoSrc} alt="Foto rumah" className="w-full max-h-64 object-cover rounded-lg border" />
              ) : (
                <div className="w-full h-40 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground">
                  <Home size={26} />
                  <span className="text-sm">Belum ada foto rumah</span>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Langganan</p>
              <Row icon={PackageIcon} label="Paket">
                {customer.package_name ? (
                  <>
                    {customer.package_name}
                    {customer.package_price != null && <span className="text-muted-foreground font-normal"> · {formatRupiah(customer.package_price)}/bln</span>}
                  </>
                ) : <span className="font-normal text-muted-foreground">Belum ada paket</span>}
              </Row>
              <Row icon={CalendarDays} label="Status & Masa Langganan">
                {customer.subscription_id ? (
                  <>
                    {subStatus && <span className="mr-2">{subStatusLabel[subStatus] || subStatus}</span>}
                    <span className="text-muted-foreground font-normal">
                      {tenureLabel(customer.subscription_start_date)}
                      {customer.subscription_start_date && ` · sejak ${formatDateID(customer.subscription_start_date)}`}
                      {customer.due_day_of_month ? ` · jatuh tempo tiap tgl ${customer.due_day_of_month}` : ''}
                    </span>
                  </>
                ) : dash}
              </Row>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Kontak & Identitas</p>
              <Row icon={Phone} label="WhatsApp"><span className="font-mono">{customer.whatsapp_number || dash}</span></Row>
              <Row icon={Mail} label="Email">{c?.email || dash}</Row>
              <Row icon={IdCard} label="No. KTP"><span className="font-mono">{c?.ktp_number || dash}</span></Row>
              <Row icon={Home} label="Alamat">{c?.address || dash}</Row>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Teknis & Lokasi</p>
              <Row icon={KeyRound} label="Secret PPPoE"><span className="font-mono text-xs">{c?.pppoe_secret_name || dash}</span></Row>
              <Row icon={MapPin} label="Koordinat">
                {lat != null && lng != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${lat},${lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {lat.toFixed(6)}, {lng.toFixed(6)} <ExternalLink size={13} />
                  </a>
                ) : dash}
              </Row>
            </div>
          </div>
        )}

        <footer className="flex justify-end gap-2 px-6 py-4 bg-secondary/50 rounded-b-2xl shrink-0">
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
