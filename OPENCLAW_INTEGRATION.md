# Panduan Integrasi JNET Monitoring dengan OpenClaw (via MCP)

Dokumen ini berisi panduan untuk mengaktifkan integrasi antara **JNET Monitoring** dan aplikasi **OpenClaw** menggunakan arsitektur Model Context Protocol (MCP).

Karena JNET Monitoring dan OpenClaw adalah dua aplikasi yang **terpisah** (dan berpotensi berjalan di PC/Server yang berbeda), ikuti langkah-langkah di bawah ini dengan saksama.

---

## Tahap 1: Persiapan di JNET Monitoring

Pertama, Anda harus membuat sebuah **API Key** khusus untuk OpenClaw agar AI mendapatkan izin mengakses data JNET Monitoring.

1. Buka aplikasi **JNET Monitoring** di browser Anda.
2. Login menggunakan akun **Super Admin**.
3. Buka menu **Pengaturan** (Settings).
4. Gulir ke bagian **Perangkat & Konektivitas**, cari kotak **Manajemen API Key (Service Accounts)**.
5. Pilih Workspace dari dropdown, beri nama untuk key (contoh: "OpenClaw Integrasi"), lalu klik **Generate Key**.
6. **PENTING:** Sebuah *alert* akan muncul berisi kombinasi karakter acak. **Salin (Copy) kode API Key tersebut** dan simpan di tempat yang aman. Kode ini tidak akan ditampilkan lagi secara utuh.

---

## Tahap 2: Persiapan File MCP untuk OpenClaw

OpenClaw perlu menjalankan sebuah file jembatan (bridge) bernama `mcp-server.js` menggunakan standar komunikasi `stdio` (Standard Input/Output).

Jika OpenClaw Anda berada di komputer yang **sama** dengan JNET Monitoring:
- Anda cukup menggunakan file `backend/mcp-server.js` yang sudah ada di dalam folder proyek JNET Monitoring.

Jika OpenClaw Anda berada di komputer yang **berbeda** (misalnya OpenClaw di laptop, JNET Monitoring di server VPS):
1. Salin (Copy) file `mcp-server.js` dari folder `backend/` JNET ke komputer tempat OpenClaw berada.
2. Di komputer OpenClaw, buat sebuah folder khusus (misal: `C:\OpenClaw-MCP`).
3. Masukkan file `mcp-server.js` ke folder tersebut.
4. Buka terminal/Command Prompt di folder tersebut, lalu install *dependencies* yang dibutuhkan:
   ```bash
   npm init -y
   npm install @modelcontextprotocol/sdk axios
   ```

---

## Tahap 3: Konfigurasi OpenClaw

Agar OpenClaw mengenali server MCP JNET Monitoring Anda, ikuti dua langkah berikut:

### 3.1 Mendaftarkan Server MCP ke dalam Workspace Agent
Agent OpenClaw bekerja di *"ruang isolasi"* mereka sendiri (secara default di `~/.openclaw/workspace`). Agar konfigurasi `mcporter` langsung terbaca oleh Agent, Anda **HARUS** mengeksekusi perintah penambahan config di dalam folder tersebut.

Buka terminal OS Linux tempat OpenClaw terinstall, lalu jalankan perintah berurutan ini (sesuaikan path JNET milik Anda!):

```bash
# 1. Masuk ke ruang isolasi Agent
mkdir -p ~/.openclaw/workspace/jnet
cd ~/.openclaw/workspace/jnet

# 2. Masukkan script mcp-server.js Anda ke dalam folder ini (Bisa copy manual atau wget)

# 3. Install dependencies yang dibutuhkan script MCP agar tidak error 'Module Not Found'
npm install dotenv axios @modelcontextprotocol/sdk zod

# 4. Tambahkan konfigurasi MCP Server
mcporter config add jnet-monitoring --command "node /root/.openclaw/workspace/jnet/mcp-server.js" --env "JNET_API_URL=http://IP_SERVER_JNET:9494" --env "JNET_API_KEY=PASTE_API_KEY_DI_SINI"
```
*(Catatan: Langkah ini mengharuskan fitur `mcporter` sudah ter-checklist aktif di `openclaw onboard` atau `openclaw plugins`).*

**Penjelasan Variabel:**
- `command`: Isi dengan perintah eksekusi dan **absolute path** (lokasi sebenarnya) file `mcp-server.js`.
- `JNET_API_URL`: Ganti dengan URL public atau IP lokal tempat JNET backend beroperasi.
- `JNET_API_KEY`: Paste kode API Key panjang yang sebelumnya Anda salin dari web JNET.

### 3.2 Verifikasi Konfigurasi
Langkah 3.1 di atas akan otomatis membuat file `config/mcporter.json` di dalam folder `~/.openclaw/workspace`. Anda bisa memastikannya dengan mengetik `ls ~/.openclaw/workspace/config/`.

## Tahap 4: Uji Coba (Testing) AI

Sebelum mencoba interaksi, pastikan Anda **Me-Restart Service/Gateway OpenClaw** Anda agar konfigurasi baru dimuat:
- Jika berjalan di terminal, matikan dengan `Ctrl+C` lalu jalankan ulang `openclaw gateway`.
- Jika berjalan sebagai service, gunakan perintah restart yang sesuai (misal: `systemctl restart openclaw`).

Anda juga bisa memverifikasi apakah integrasi sukses dan alat (tools) JNET terbaca oleh OS dengan perintah:
```bash
mcporter list jnet-monitoring
```

Setelah dipastikan terhubung, Anda bisa langsung memulai *chat* ke asisten OpenClaw Anda dengan perintah bahasa natural:

- *"Tolong cek ada berapa device Mikrotik yang terhubung di sistem JNET."*
- *"Bagaimana status CPU router Mikrotik ID 1 saat ini?"*
- *"Tampilkan daftar user PPPoE yang sedang terhubung di router 1."*
- *"Tolong kick user 'fahrezi' dari router 1 karena tunggakan."*
- *"Cek daftar aset jaringan ODP dan OLT di dalam sistem."*

Selamat! OpenClaw AI kini berhasil diintegrasikan dan dapat memonitor sistem JNET Anda dengan aman.
