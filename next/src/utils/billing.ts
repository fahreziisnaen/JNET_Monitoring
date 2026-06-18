import { apiFetch } from './api';

const base = () => `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/billing/admin`;
const apiBase = () => process.env.NEXT_PUBLIC_API_BASE_URL;
const wsq = (workspaceId?: number | null) => (workspaceId != null ? `?workspaceId=${workspaceId}` : '');

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
  ktp_number?: string | null;
  status: 'active' | 'inactive' | 'suspended';
  linked_client_name?: string | null;
  created_at?: string;
  subscription_id?: number | null;
  subscription_status?: 'active' | 'suspended' | 'cancelled' | null;
  package_id?: number | null;
  package_name?: string | null;
  package_price?: number | null;
  subscription_start_date?: string | null;
  due_day_of_month?: number | null;
}

export interface UnlinkedSecret {
  name: string;
  profile?: string;
  'remote-address'?: string | null;
  connected_odp_id?: number | null;
}

export interface OdpAsset {
  id: number;
  name: string;
  type: string;
}

export interface FullCustomerInput {
  pppoe_secret_name: string;
  client_name: string;
  whatsapp_number: string;
  latitude: string;
  longitude: string;
  odp_asset_id?: string;
  ktp_number?: string;
  photo?: File | null;
}

export async function fetchUnlinkedSecrets(workspaceId?: number | null): Promise<UnlinkedSecret[]> {
  const r = await apiFetch(`${apiBase()}/api/clients/unlinked-pppoe-secrets${wsq(workspaceId)}`);
  if (!r.ok) throw new Error('Gagal memuat secret PPPoE');
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

export async function fetchOdpAssets(workspaceId?: number | null): Promise<OdpAsset[]> {
  const r = await apiFetch(`${apiBase()}/api/assets${wsq(workspaceId)}`);
  if (!r.ok) throw new Error('Gagal memuat ODP');
  const d = await r.json();
  return (Array.isArray(d) ? d : []).filter((a: any) => a.type === 'ODP');
}

export interface CustomerDetail {
  customer: BillingCustomer & {
    latitude?: number | string | null;
    longitude?: number | string | null;
    odp_asset_id?: number | null;
    photo_url?: string | null;
  };
  subscription: {
    id: number;
    package_id: number;
    start_date: string | null;
    due_day_of_month: number;
    status: 'active' | 'suspended' | 'cancelled';
  } | null;
}

export async function updateClientGeo(
  workspaceId: number | null | undefined,
  clientId: number,
  data: { latitude?: string; longitude?: string; odp_asset_id?: string | null; photo?: File | null },
): Promise<void> {
  const fd = new FormData();
  if (data.latitude !== undefined) fd.append('latitude', data.latitude);
  if (data.longitude !== undefined) fd.append('longitude', data.longitude);
  if (data.odp_asset_id !== undefined) fd.append('odp_asset_id', data.odp_asset_id ?? '');
  if (data.photo) fd.append('photo', data.photo);
  const r = await apiFetch(`${apiBase()}/api/clients/${clientId}${wsq(workspaceId)}`, { method: 'PUT', body: fd });
  if (!r.ok) {
    let msg = 'Gagal memperbarui lokasi/foto client';
    try { const e = await r.json(); msg = e.message || msg; } catch {}
    throw new Error(msg);
  }
}

export async function createFullCustomer(
  workspaceId: number | null | undefined,
  data: FullCustomerInput,
): Promise<{ clientId: number; billingCustomerId: number | null }> {
  const fd = new FormData();
  fd.append('pppoe_secret_name', data.pppoe_secret_name);
  fd.append('client_name', data.client_name);
  fd.append('whatsapp_number', data.whatsapp_number);
  fd.append('latitude', data.latitude);
  fd.append('longitude', data.longitude);
  if (data.odp_asset_id) fd.append('odp_asset_id', data.odp_asset_id);
  if (data.ktp_number) fd.append('ktp_number', data.ktp_number);
  if (data.photo) fd.append('photo', data.photo);
  const r = await apiFetch(`${apiBase()}/api/clients${wsq(workspaceId)}`, { method: 'POST', body: fd });
  if (!r.ok) {
    let msg = 'Gagal membuat pelanggan';
    try { const e = await r.json(); msg = e.message || msg; } catch {}
    throw new Error(msg);
  }
  const d = await r.json();
  return { clientId: d.clientId, billingCustomerId: d.billingCustomerId ?? null };
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
  skipped_no_wa?: number;
  skipped_dup_wa?: number;
  skipped_error?: number;
}

export interface SkippedClient {
  client_name: string | null;
  whatsapp_number: string | null;
  reason: 'no_wa' | 'dup_wa' | 'exists' | 'error';
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
    getCustomerDetail: (id: number) => req<CustomerDetail>(`/customers/${id}`),
    createCustomer: (b: Partial<BillingCustomer>) => req('/customers', { method: 'POST', ...json(b) }),
    updateCustomer: (id: number, b: Partial<BillingCustomer>) => req(`/customers/${id}`, { method: 'PUT', ...json(b) }),
    deleteCustomer: (id: number) => req(`/customers/${id}`, { method: 'DELETE' }),
    listImportableClients: () => req<{ clients: ImportableClient[] }>('/importable-clients'),
    importClients: (b: { client_ids?: number[]; all?: boolean }) => req<{ summary: ImportSummary; skipped: SkippedClient[] }>('/import-clients', { method: 'POST', ...json(b) }),

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

export const tenureMonths = (startDate?: string | null): number | null => {
  if (!startDate) return null;
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00`);
  if (isNaN(start.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  return months < 0 ? 0 : months;
};

export const tenureLabel = (startDate?: string | null): string => {
  const m = tenureMonths(startDate);
  if (m == null) return '—';
  if (m === 0) return '< 1 bulan';
  const years = Math.floor(m / 12);
  const rem = m % 12;
  if (years > 0 && rem > 0) return `${years} thn ${rem} bln`;
  if (years > 0) return `${years} tahun`;
  return `${m} bulan`;
};

export const formatDateID = (d?: string | null): string => {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-').map(Number);
  if (!y || !m || !day || !MONTHS_ID[m]) return '—';
  return `${day} ${MONTHS_ID[m]} ${y}`;
};

export const formatDateTimeID = (d?: string | null): string => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  const tgl = `${dt.getDate()} ${MONTHS_ID[dt.getMonth() + 1]} ${dt.getFullYear()}`;
  const jam = `${String(dt.getHours()).padStart(2, '0')}.${String(dt.getMinutes()).padStart(2, '0')}`;
  return `${tgl}, ${jam}`;
};
