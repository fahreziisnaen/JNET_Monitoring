/**
 * billing.ts — klien API untuk panel admin Billing.
 * Membungkus apiFetch ke /api/billing/admin/* + tipe entitas billing.
 */
import { apiFetch } from './api';

const base = () => `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/billing/admin`;

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
});

// ---- Tipe entitas ----
export interface BillingPackage {
  id: number;
  workspace_id: number;
  name: string;
  description: string | null;
  price: number;
  speed_mbps: number | null;
  pppoe_profile: string | null;
  billing_cycle: 'monthly';
  is_active: 0 | 1;
}

export interface BillingCustomer {
  id: number;
  workspace_id: number;
  client_id: number | null;
  device_id: number | null;
  pppoe_secret_name: string | null;
  name: string | null;
  whatsapp_number: string;
  email: string | null;
  address: string | null;
  status: 'active' | 'inactive' | 'suspended';
  linked_client_name?: string | null;
  created_at?: string;
}

export interface BillingSubscription {
  id: number;
  workspace_id: number;
  customer_id: number;
  package_id: number;
  status: 'active' | 'suspended' | 'cancelled';
  start_date: string;
  due_day_of_month: number;
  next_due_date: string | null;
  customer_name?: string | null;
  whatsapp_number?: string | null;
  package_name?: string | null;
  price?: number | null;
}

export interface BillingInvoice {
  id: number;
  workspace_id: number;
  subscription_id: number;
  customer_id: number;
  invoice_number: string;
  period_year: number;
  period_month: number;
  amount: number;
  due_date: string;
  status: 'unpaid' | 'paid' | 'overdue' | 'void';
  paid_at: string | null;
  created_at: string;
  customer_name?: string | null;
  whatsapp_number?: string | null;
}

export interface BillingSettings {
  workspace_id: number;
  tripay_merchant_code: string | null;
  tripay_api_key: string | null;
  tripay_private_key: string | null;
  tripay_mode: 'sandbox' | 'production';
  invoice_gen_day: number;
  reminder_days_before: number;
  grace_days: number;
  auto_isolir_enabled: 0 | 1;
  isolir_profile: string;
}

// Input paket: is_active boleh boolean (backend menanganinya).
export type PackageInput = Partial<Omit<BillingPackage, 'is_active'>> & { is_active?: boolean };

/**
 * Klien billing yang TER-SCOPE ke satu workspace.
 * `workspaceId` di-append sebagai query (?workspaceId=) ke SEMUA request —
 * backend resolveWorkspaceId membacanya (override untuk admin/noc/superadmin).
 * Tanpa workspaceId, backend memakai workspace milik user (req.user.workspace_id).
 */
export function billingClient(workspaceId?: number | null) {
  async function req<T = any>(path: string, options?: RequestInit): Promise<T> {
    let p = path;
    if (workspaceId != null) {
      p += (p.includes('?') ? '&' : '?') + `workspaceId=${workspaceId}`;
    }
    const res = await apiFetch(`${base()}${p}`, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.message) || `Error ${res.status}`);
    return data as T;
  }

  return {
    // Paket
    listPackages: () => req<{ packages: BillingPackage[] }>('/packages'),
    createPackage: (b: PackageInput) => req('/packages', { method: 'POST', ...json(b) }),
    updatePackage: (id: number, b: PackageInput) => req(`/packages/${id}`, { method: 'PUT', ...json(b) }),
    deletePackage: (id: number) => req(`/packages/${id}`, { method: 'DELETE' }),

    // Pelanggan
    listCustomers: () => req<{ customers: BillingCustomer[] }>('/customers'),
    createCustomer: (b: Partial<BillingCustomer>) => req('/customers', { method: 'POST', ...json(b) }),
    updateCustomer: (id: number, b: Partial<BillingCustomer>) => req(`/customers/${id}`, { method: 'PUT', ...json(b) }),

    // Langganan
    listSubscriptions: () => req<{ subscriptions: BillingSubscription[] }>('/subscriptions'),
    createSubscription: (b: Partial<BillingSubscription>) => req('/subscriptions', { method: 'POST', ...json(b) }),
    updateSubscription: (id: number, b: Partial<BillingSubscription>) => req(`/subscriptions/${id}`, { method: 'PUT', ...json(b) }),

    // Invoice
    listInvoices: (query = '') => req<{ invoices: BillingInvoice[] }>(`/invoices${query}`),
    generateInvoices: (b: { year?: number; month?: number } = {}) => req('/invoices/generate', { method: 'POST', ...json(b) }),

    // Pengaturan
    getSettings: () => req<{ settings: BillingSettings | null }>('/settings'),
    updateSettings: (b: Partial<BillingSettings>) => req('/settings', { method: 'PUT', ...json(b) }),
  };
}

export type BillingClient = ReturnType<typeof billingClient>;

// ---- Util format ----
export const formatRupiah = (n: number | string | null | undefined) => {
  const v = Number(n || 0);
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v);
};

export const MONTHS_ID = [
  '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
