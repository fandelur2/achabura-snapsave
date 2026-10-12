# SnapSave backend

Backend Node.js/Express untuk mengekstrak media yang dapat diakses publik menggunakan `yt-dlp`, menyimpan hasil sementara di server, lalu menyajikannya dari URL lokal backend. Dengan cara ini browser tidak bergantung pada CORS CDN sumber atau URL bertanda tangan yang cepat kedaluwarsa.

## Persyaratan

- Node.js 18 atau lebih baru
- `yt-dlp` versi terbaru terpasang dan dapat dipanggil dari terminal
- `ffmpeg` direkomendasikan untuk menggabungkan audio/video terpisah bila diperlukan
- HTTPS dan reverse proxy di production

### Instalasi

1. Pasang Node.js, yt-dlp, dan ffmpeg di server.
2. Salin `.env.example` menjadi `.env`, lalu isi `PUBLIC_BASE_URL` dan `ALLOWED_ORIGINS`.
3. Jalankan:

```bash
npm install
npm start
```

Tes health:

```bash
curl http://localhost:3000/health
```

Tes ekstraksi:

```bash
curl -G 'http://localhost:3000/api/extract' --data-urlencode 'url=https://www.youtube.com/watch?v=VIDEO_ID'
```

Endpoint mengembalikan `media[0].url` untuk preview dan `media[0].downloadUrl` untuk unduhan. Keduanya URL dari backend sendiri. File sementara otomatis dibersihkan setelah `FILE_TTL_MINUTES`.

## Integrasi frontend

HTML frontend sebelumnya menggunakan `GET /api/extract?url=...`. Jika backend berada di domain berbeda, ubah `EXTRACT_API_ENDPOINT` di HTML menjadi URL absolut, misalnya:

```js
const EXTRACT_API_ENDPOINT = 'https://api.domain-anda.com/api/extract';
```

Pastikan kode frontend memakai `media.url` untuk preview dan `media.downloadUrl || media.url` untuk tombol unduh. Contoh:

```js
video.src = media.url;
link.href = media.downloadUrl || media.url;
```

## CORS

`ALLOWED_ORIGINS` harus berisi origin frontend secara persis (skema + host + port bila ada), tanpa path. Backend hanya mengizinkan origin tersebut dan mengekspos header `Content-Range`, `Accept-Ranges`, `Content-Length`, `Content-Type`, serta `Content-Disposition`.

## Header dan playback

Endpoint media mengirim `Content-Type` sesuai ekstensi video, `Content-Disposition: inline` untuk preview atau `attachment` untuk unduh, `Accept-Ranges: bytes` untuk seek pada player, `Content-Length`, `Cache-Control`, dan `X-Content-Type-Options: nosniff`. Express mengelola permintaan byte-range untuk video HTML.

## Batasan dan keamanan

- Gunakan hanya untuk konten yang Anda miliki atau diizinkan untuk diunduh. Patuhi ketentuan platform dan hak cipta.
- Backend tidak melewati login, konten privat, DRM, atau kontrol akses. Konten yang butuh autentikasi ditolak.
- Dukungan platform mengikuti kemampuan `yt-dlp` yang terpasang; platform dapat berubah sewaktu-waktu.
- Untuk mengurangi penyalahgunaan, URL sumber dibatasi ke daftar domain sosial yang dikenal, API dibatasi 20 permintaan/menit per IP, durasi default maksimum 30 menit, ukuran file maksimum 500 MB, dan file cache punya masa kedaluwarsa.
- Untuk production, tambahkan autentikasi/kuota pengguna, monitoring, batas konkurensi, reverse proxy HTTPS, dan kebijakan privasi. Jangan membiarkan direktori cache dapat diakses sebagai file statis.
- `yt-dlp` perlu diperbarui secara berkala. Jangan jalankan backend ini pada hosting statis/shared hosting yang tidak mengizinkan proses Node dan executable.
