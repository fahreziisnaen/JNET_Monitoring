'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { TrendingUp, Wallet } from 'lucide-react';
import { billingClient, formatRupiah, MONTHS_ID, PaymentsSummary } from '@/utils/billing';

export default function RevenueSummary({ workspaceId }: { workspaceId?: number | null }) {
  const billingApi = useMemo(() => billingClient(workspaceId), [workspaceId]);
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);

  useEffect(() => {
    let active = true;
    if (workspaceId == null) { setSummary(null); return; }
    billingApi.paymentsSummary()
      .then((s) => { if (active) setSummary(s); })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [billingApi, workspaceId]);

  const monthName = MONTHS_ID[new Date().getMonth() + 1];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
      <div className="rounded-xl border bg-card p-4 flex items-center gap-4">
        <div className="rounded-lg bg-green-500/15 text-green-600 p-2.5"><TrendingUp size={22} /></div>
        <div>
          <p className="text-xs text-muted-foreground">Pendapatan {monthName}</p>
          <p className="text-xl font-bold">{summary ? formatRupiah(summary.month_revenue) : '—'}</p>
          {summary && <p className="text-xs text-muted-foreground">{summary.month_count} pembayaran lunas</p>}
        </div>
      </div>
      <div className="rounded-xl border bg-card p-4 flex items-center gap-4">
        <div className="rounded-lg bg-blue-500/15 text-blue-600 p-2.5"><Wallet size={22} /></div>
        <div>
          <p className="text-xs text-muted-foreground">Total Pendapatan</p>
          <p className="text-xl font-bold">{summary ? formatRupiah(summary.total_revenue) : '—'}</p>
          {summary && <p className="text-xs text-muted-foreground">{summary.total_count} pembayaran lunas</p>}
        </div>
      </div>
    </div>
  );
}
