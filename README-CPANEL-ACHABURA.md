# Deploy SnapSave di cPanel — achabura.com

## Penting sebelum mulai
Backend ini membutuhkan **Node.js 18+**, izin menjalankan child process (`spawn`), executable **yt-dlp**, dan idealnya **ffmpeg**. Banyak shared hosting cPanel tidak mengizinkan pemasangan/eksekusi binary tambahan. Jika provider tidak mendukung semuanya, backend ini tidak dapat berjalan di paket tersebut; gunakan VPS atau layanan Node.js yang mengizinkan yt-dlp/ffmpeg.

## Arsitektur yang disarankan
- Frontend: `https://achabura.com` (atau `https://www.achabura.com`)
- Backend: `https://api.achabura.com`
- Backend URL media: `https://api.achabura.com/api/media/ID`

## A. Periksa fitur cPanel
1. Login cPanel sendiri (jangan kirim password ke siapa pun).
2. Cari **Setup Node.js App**, **Application Manager**, atau **Node.js Selector**.
3. Jika tidak ada, tanyakan ke provider apakah akun mendukung aplikasi Node.js persisten, Node.js 18+, menjalankan `yt-dlp` dan `ffmpeg`, serta penggunaan proses child process. Jangan lanjut mengunggah backend sampai mereka mengonfirmasi.
4. Jika tersedia, tanyakan juga apakah `yt-dlp`/`ffmpeg` tersedia atau boleh dipasang di direktori home.

## B. Buat subdomain backend
1. cPanel → **Domains** → **Create A New Domain** atau **Subdomains**.
2. Buat `api.achabura.com`.
3. Pastikan DNS mengarah ke hosting yang sama dan aktifkan SSL/AutoSSL untuk `api.achabura.com`.
4. Jangan arahkan subdomain ini ke direktori frontend `public_html` sebagai file statis; subdomain harus dipetakan ke aplikasi Node.js melalui fitur Node app cPanel.

## C. Upload backend
1. Buat folder aplikasi privat, misalnya `/home/CPANELUSER/snapsave-backend` (ganti `CPANELUSER` dengan username cPanel). Jangan letakkan folder cache atau `.env` di `public_html`.
2. Upload dan ekstrak ZIP backend ke folder tersebut. Pastikan `server.js` dan `package.json` ada langsung di application root, bukan bersarang satu folder ekstra.
3. Di **Setup Node.js App**, buat aplikasi: versi Node 18 atau lebih baru, application root `snapsave-backend`, startup file `server.js`. Domain/subdomain pilih `api.achabura.com` jika cPanel menyediakan pemetaan domain.
4. Klik **Run NPM Install** (atau aktifkan virtual environment sesuai instruksi panel). Jika menggunakan terminal, jalankan `npm install` dari application root.
5. Masukkan environment variables berikut melalui panel Node.js App.

```env
PUBLIC_BASE_URL=https://api.achabura.com
ALLOWED_ORIGINS=https://achabura.com,https://www.achabura.com
YTDLP_PATH=yt-dlp
MAX_DURATION_SECONDS=1800
MAX_FILE_BYTES=524288000
FILE_TTL_MINUTES=60
JOB_TIMEOUT_MS=180000
```

6. Pastikan `yt-dlp` dapat dijalankan dari aplikasi. Jika provider memberi path absolut, set `YTDLP_PATH` ke path tersebut. Jika `ffmpeg` ada, atur `FFMPEG_LOCATION` sesuai format yang disyaratkan oleh `yt-dlp` (biasanya direktori executable atau path yang didukung oleh versi yt-dlp).
7. Klik **Restart** pada aplikasi. Baca error log jika gagal.

> Beberapa cPanel menggunakan Passenger dan menetapkan `PORT` sendiri. Biarkan `PORT` diatur oleh panel; jangan paksa port lain.

## D. Hubungkan frontend
Gunakan file `snapsave-fixed-achabura.html` yang disertakan. Di dalamnya endpoint API sudah diarahkan ke `https://api.achabura.com/api/extract`. Upload/gunakan file ini untuk menggantikan HTML frontend lama setelah memastikan layout halaman tetap sesuai. Jika halaman dipasang di WordPress/Elementor, edit script yang sudah ada dan ubah baris `EXTRACT_API_ENDPOINT` ke URL tersebut, bukan mengganti seluruh halaman.

## E. Uji
1. Buka `https://api.achabura.com/health`. Respons harus JSON dengan status sehat.
2. Buka frontend `https://achabura.com`, masukkan URL postingan publik dari platform yang didukung, lalu klik unduh.
3. Periksa DevTools → Network jika gagal. `404` biasanya pemetaan URL/aplikasi; `403` biasanya CORS/domain; `500` atau error `yt-dlp` berarti dependency/izin/proses server; `422` biasanya ekstraksi sumber gagal.
4. Tes `yt-dlp` dari terminal hosting jika tersedia. Jika tidak dapat dijalankan, minta provider mengonfirmasi dukungan binary atau pindahkan backend ke VPS/layanan Node.js yang sesuai.

## CORS
Origin harus persis cocok, termasuk `https://` dan `www` jika digunakan. Jangan set `*` untuk website publik. CORS hanya mengatur akses browser; CORS tidak memasang dependency dan tidak membuat ekstraksi berhasil dengan sendirinya.

## Keamanan & keterbatasan
- Gunakan untuk media yang Anda miliki atau punya izin untuk mengunduh. Tidak mendukung bypass DRM, login, atau postingan privat.
- Cache media menghabiskan disk. Pantau kuota hosting dan jangan membuka folder cache sebagai direktori statis.
- Shared hosting sering membatasi CPU, proses latar, disk, waktu eksekusi, dan executable eksternal; proses video dapat terkena batas provider.
- Jika Node.js atau `yt-dlp` tidak didukung, pilihan paling realistis adalah mempertahankan frontend di cPanel dan menjalankan backend pada VPS/hosting Node yang mendukung binary.
