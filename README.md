# Dapodik Peserta Didik Scraper

Skrip browser (JavaScript) untuk menarik data peserta didik dari aplikasi Datadik Dapodik Kemendikdasmen (`datadik.kemendikdasmen.go.id`) dan mengekspornya ke CSV.

Mendapatkan per sekolah: daftar peserta didik (nama, jenis kelamin, tanggal lahir, nama ibu, NIK, NISN, terakhir update, rombel, tingkat) plus data agama dari halaman detail per siswa.

## Persyaratan

- Akun aktif & sudah login ke `datadik.kemendikdasmen.go.id` di tab browser (Chrome/Edge/Firefox).
- Browser Desktop (skrip memakai `prompt`, `DOMParser`, `Blob`, hidden iframe — tidak jalan di mobile).

## Cara pakai

1. Buka `https://datadik.kemendikdasmen.go.id` (sudah login).
2. Tekan `F12` → tab **Console**.
3. Salin **satu baris panjang** `eval(atob('...'))` di `LOAD.md` (jangan dipotong/di-wrap), paste di Console, Enter.
4. Ikuti prompt: pilih level filter (Kabupaten / Kecamatan / Sekolah, kosong = semua).
5. Tunggu sampai CSV ter-download otomatis (`peserta_didik_<filter>_<tanggal>.csv`).

Kode sumber asli ada di `fetch_peserta_didik.js`. Baris yang di-paste adalah versi ter-obfuscate (base64) agar tidak mudah dibaca sekilas.

## Kontrol saat berjalan

Skrip menampilkan status live di Console (di-update tiap detik, tanpa baris baru). Tersedia objek global `window._fetch`:

| Perintah | Fungsi |
|---|---|
| `window._fetch.pause()` | tahan sementara (request yang berjalan diselesaikan) |
| `window._fetch.resume()` | lanjutkan |
| `window._fetch.stop()` | hentikan; CSV sebagian tetap ter-download |
| `window._fetch.stats()` | status (sekolah / siswa / agama berhasil-gagal / rate) |
| `window._fetch.download()` | download CSV lebih awal |

## Penanganan WAF (SafeLine)

- Request dari skrip dijalankan lewat hidden iframe yang memuat halaman asli (`/manage`) sehingga membawa `Referer` + `Sec-Fetch-Site` alami seperti tab browser biasa.
- **Challenge nyata** (status `468` / marker JS SafeLine) → skrip minta validasi manual di browser, lalu lanjut.
- **Blokir** (status `403`/`429`, halaman "Access Forbidden" SafeLine) → skrip tidak meminta validasi; ia menunggu backoff (5s → 60s) lalu retry otomatis dan menurunkan paralelisme sekolah ke 1.

## Regenerasi artefak (setelah edit source)

1. Edit `fetch_peserta_didik.js`.
2. Obfuscate:

```bash
npx --yes javascript-obfuscator fetch_peserta_didik.js --output fetch_peserta_didik.obf.js --compact true --string-array true --string-array-threshold 0.6 --control-flow-flattening true --control-flow-flattening-threshold 0.4 --dead-code-injection false --self-defending false --disable-console-output false
```

3. Encode hasil ke base64, ganti baris `eval(atob('...'))` di `LOAD.md` (satu baris WAJIB utuh — jangan pernah di-rewrap editor).

## Keterbatasan

- Scraping via sesi browser (bukan API resmi). Gunakan sewajarnya; batasi volume dan paralelisme agar tidak kena blokir WAF.
- Data agama diambil satu per satu per siswa dari halaman detail — pada dataset besar butuh waktu.
- File `sekolah.csv` berisi data referensi sekolah yang dipakai untuk uji/daftar filter.
