# Modul Billing — JNET Monitoring

Fondasi aplikasi billing pembayaran pelanggan ISP, **modul di dalam backend Express** yang sudah ada (Opsi A). Monitoring tetap satu-satunya pemilik interaksi MikroTik; billing me-reuse koneksi, isolir, dan gateway WhatsApp lewat service bersama.

## Status: SCAFFOLD / Fondasi
Endpoint inti **berfungsi** (auth pelanggan, lihat invoice, admin CRUD). Dua bagian sengaja di-**stub** & aman:
- **Gateway Tripay** (`services/tripayService.js`): `createTransaction` mengembalikan transaksi *simulasi* bila kredensial kosong; tinggal isi blok `// TODO(go-live)`. Verifikasi signature webhook **sudah nyata**.
- **Scheduler** (`billingScheduler.js`): **MATI default**. Aktifkan via `BILLING_SCHEDULER_ENABLED=true` setelah data & `billing_settings` siap.

## Cara pasang
```bash
# 1. Migrasi skema
mysql -u root -p jnet_monitoring < backend/migrations/billing_module.sql
# 2. (opsional) set env billing di backend/.env — lihat .env.example bagian BILLING
# 3. Restart backend. Modul auto-terpasang via server.js -> require('./src/billing').register(app)
```

## Arsitektur
```
src/billing/
├── index.js                      register(app): pasang 3 grup route + scheduler
├── billingScheduler.js           cron: generate invoice, overdue, auto-isolir (opt-in)
├── middleware/
│   └── customerAuthMiddleware.js  protectCustomer (JWT aud='billing-customer' + sesi)
├── services/
│   ├── billingService.js          generate invoice (idempotent), hitung jatuh tempo
│   ├── tripayService.js           abstraksi gateway (stub createTransaction, HMAC nyata)
│   └── isolirService.js           reuse runCommandForWorkspace -> isolir/unisolir PPPoE
├── controllers/
│   ├── customerAuthController.js   OTP WhatsApp (TANPA bypass — beda dari auth admin)
│   ├── customerPortalController.js subscription/invoice/pay milik pelanggan sendiri
│   ├── billingAdminController.js   CRUD paket/pelanggan/langganan/invoice/settings
│   └── paymentController.js        webhook gateway -> tandai lunas + buka isolir
└── routes/{customer,admin,webhook}Routes.js
```

## Endpoint

### Pelanggan — `/api/billing/customer` (auth: OTP WhatsApp)
| Method | Path | Keterangan |
|--------|------|-----------|
| POST | `/auth/request-otp` | Kirim OTP ke nomor WA terdaftar |
| POST | `/auth/verify-otp` | Verifikasi OTP → token (JWT 30d) |
| POST | `/auth/logout` | Revoke sesi |
| GET | `/me` | Profil pelanggan |
| GET | `/subscription` | Langganan & paket aktif |
| GET | `/invoices` | Daftar invoice sendiri |
| GET | `/invoices/:id` | Detail invoice + pembayaran |
| POST | `/invoices/:id/pay` | Buat transaksi bayar (gateway) |

### Admin — `/api/billing/admin` (auth: admin existing `protect` + `authorizeAdmin`)
Paket `GET/POST/PUT/DELETE /packages[/:id]` · Pelanggan `GET/POST/PUT /customers[/:id]` · Langganan `GET/POST/PUT /subscriptions[/:id]` · Invoice `GET /invoices`, `POST /invoices/generate` · Settings `GET/PUT /settings`.

### Webhook — `/api/billing/webhook/tripay`
Raw body + verifikasi HMAC-SHA256 (`X-Callback-Signature`). Saat `PAID`: invoice→lunas, lalu **buka isolir** pelanggan otomatis.

### Dokumentasi API — `/api/docs` (Scalar)
Kontrak lengkap ada di **`openapi.yaml`** (ditulis tangan = sumber kebenaran). Scalar hanya merender spec itu (embed CDN, tanpa dependency npm). Spec mentah: `/api/docs/openapi.yaml` (bisa di-import ke Postman/Insomnia). Aktif default; set `BILLING_DOCS_ENABLED=false` di produksi. **Hanya billing yang dipublish** — API monitoring tidak.

## Model data (8 tabel `billing_*`)
`billing_settings` (gateway+kebijakan per-ws) · `billing_packages` (plan→profil PPPoE) · `billing_customers` (identitas login, link ke `clients`+secret) · `billing_customer_sessions` · `billing_customer_otps` · `billing_subscriptions` · `billing_invoices` · `billing_payments`.

## Integrasi dengan monitoring
- **Isolir/unisolir**: `isolirService` memakai `runCommandForWorkspace` yang sama dengan `pppoeController` — bukan duplikasi koneksi.
- **WhatsApp**: `sendWhatsAppMessage` dari `services/whatsappService`.
- **Link pelanggan**: `billing_customers.client_id` → `clients.id`, dan `pppoe_secret_name` untuk aksi router.

## Catatan keamanan (sengaja berbeda dari auth admin)
- OTP pelanggan **tidak** di-bypass saat WhatsApp mati (admin punya celah ini) → balas 503.
- Token pelanggan & admin tidak bisa saling dipakai (klaim `aud`).
- Kunci gateway tidak pernah dikembalikan utuh oleh `GET /settings` (di-mask).

## Langkah lanjutan (di luar fondasi ini)
1. Implementasi nyata `tripayService.createTransaction` (request axios).
2. Reminder H- jatuh tempo (`runReminders`) + penanda "sudah dikirim".
3. Frontend React Native (login OTP → daftar invoice → checkout).
4. Audit transaksi & idempotensi webhook (retry gateway).
