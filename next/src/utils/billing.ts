import { apiFetch } from './api';

const base = () => `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/billing/admin`;

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
});

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

export type PackageInput = Partial<Omit<BillingPackage, 'is_active'>> & { is_active?: boolean };

export interface PageMeta { total: number; page: number; limit: number }
export type ListParams = { page?: number; limit?: number; q?: string };
export type InvoiceListParams = ListParams & { status?: string; year?: number; month?: number };

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export interface ImportableClient {
  id: number;
  client_name: string | null;
  whatsapp_number: string | null;
  pppoe_secret_name: string | null;
  device_id: number | null;
}

export interface ImportSummary {
  total: number;
  created: number;
  relinked: number;
  skipped: number;
}

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
    listPackages: () => req<{ packages: BillingPackage[] }>('/packages'),
    createPackage: (b: PackageInput) => req('/packages', { method: 'POST', ...json(b) }),
    updatePackage: (id: number, b: PackageInput) => req(`/packages/${id}`, { method: 'PUT', ...json(b) }),
    deletePackage: (id: number) => req(`/packages/${id}`, { method: 'DELETE' }),

    listCustomers: (params: ListParams = {}) => req<{ customers: BillingCustomer[] } & PageMeta>(`/customers${qs(params)}`),
    createCustomer: (b: Partial<BillingCustomer>) => req('/customers', { method: 'POST', ...json(b) }),
    updateCustomer: (id: number, b: Partial<BillingCustomer>) => req(`/customers/${id}`, { method: 'PUT', ...json(b) }),
    listImportableClients: () => req<{ clients: ImportableClient[] }>('/importable-clients'),
    importClients: (b: { client_ids?: number[]; all?: boolean }) => req<{ summary: ImportSummary }>('/import-clients', { method: 'POST', ...json(b) }),

    listSubscriptions: (params: ListParams = {}) => req<{ subscriptions: BillingSubscription[] } & PageMeta>(`/subscriptions${qs(params)}`),
    createSubscription: (b: Partial<BillingSubscription>) => req('/subscriptions', { method: 'POST', ...json(b) }),
    updateSubscription: (id: number, b: Partial<BillingSubscription>) => req(`/subscriptions/${id}`, { method: 'PUT', ...json(b) }),

    listInvoices: (params: InvoiceListParams = {}) => req<{ invoices: BillingInvoice[] } & PageMeta>(`/invoices${qs(params)}`),
    generateInvoices: (b: { year?: number; month?: number } = {}) => req('/invoices/generate', { method: 'POST', ...json(b) }),

    getSettings: () => req<{ settings: BillingSettings | null }>('/settings'),
    updateSettings: (b: Partial<BillingSettings>) => req('/settings', { method: 'PUT', ...json(b) }),
  };
}

export type BillingClient = ReturnType<typeof billingClient>;

export const formatRupiah = (n: number | string | null | undefined) => {
  const v = Number(n || 0);
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v);
};

export const MONTHS_ID = [
  '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
