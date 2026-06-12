'use client';

import React, { useState, useEffect } from 'react';
import { Package, Users, Repeat, ReceiptText, Settings as SettingsIcon, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { usePageTitle } from '@/hooks/usePageTitle';
import { apiFetch } from '@/utils/api';
import PackagesTab from '@/components/billing/packages-tab';
import CustomersTab from '@/components/billing/customers-tab';
import SubscriptionsTab from '@/components/billing/subscriptions-tab';
import InvoicesTab from '@/components/billing/invoices-tab';
import BillingSettingsTab from '@/components/billing/settings-tab';

type TabKey = 'packages' | 'customers' | 'subscriptions' | 'invoices' | 'settings';

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'packages', label: 'Paket', icon: Package },
  { key: 'customers', label: 'Pelanggan', icon: Users },
  { key: 'subscriptions', label: 'Langganan', icon: Repeat },
  { key: 'invoices', label: 'Invoice', icon: ReceiptText },
  { key: 'settings', label: 'Pengaturan', icon: SettingsIcon },
];

interface Workspace { id: number; name: string }

export default function BillingPage() {
  usePageTitle('Billing');
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('packages');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsId, setWsId] = useState<number | null>(null);

  // Billing: owner + admin + noc + super_admin
  const canAccess = user?.role === 'admin' || user?.role === 'noc' || user?.is_owner || user?.is_super_admin;

  // Default scope = workspace milik user; di-update setelah daftar workspace dimuat.
  useEffect(() => {
    if (user?.workspace_id && wsId == null) setWsId(user.workspace_id);
  }, [user?.workspace_id, wsId]);

  // Muat daftar workspace untuk pemilih (superadmin: semua; noc/admin: yang diizinkan).
  useEffect(() => {
    if (!user || !canAccess) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const endpoint = user.is_super_admin ? '/api/workspaces/all' : '/api/noc/my-workspaces';
    apiFetch(`${apiUrl}${endpoint}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Workspace[]) => {
        const list = Array.isArray(data) ? data : [];
        setWorkspaces(list);
        // Jika workspace user tak ada di daftar, pakai yang pertama.
        if (list.length > 0 && !list.some((w) => w.id === user.workspace_id)) {
          setWsId(list[0].id);
        }
      })
      .catch(() => { /* abaikan; fallback ke workspace user */ });
  }, [user, canAccess]);

  if (user && !canAccess) {
    return (
      <div className="p-4 md:p-8">
        <div className="flex flex-col items-center justify-center p-12 bg-secondary/50 rounded-xl border mt-8">
          <ShieldAlert className="h-10 w-10 text-destructive mb-3" />
          <h2 className="text-xl font-bold mb-1">Akses Ditolak</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Halaman Billing hanya untuk Admin / Owner / NOC / Super Admin.
          </p>
        </div>
      </div>
    );
  }

  const showWsSelector = workspaces.length > 1;

  return (
    <div className="p-3 sm:p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Billing</h1>
        {showWsSelector && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Workspace:</span>
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm max-w-[240px]"
              value={wsId ?? ''}
              onChange={(e) => setWsId(Number(e.target.value))}
            >
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 sm:gap-2 mb-6 border-b overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'packages' && <PackagesTab workspaceId={wsId} />}
        {tab === 'customers' && <CustomersTab workspaceId={wsId} />}
        {tab === 'subscriptions' && <SubscriptionsTab workspaceId={wsId} />}
        {tab === 'invoices' && <InvoicesTab workspaceId={wsId} />}
        {tab === 'settings' && <BillingSettingsTab workspaceId={wsId} />}
      </div>
    </div>
  );
}
