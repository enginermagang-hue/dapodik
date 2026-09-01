# Ringkasan SPTJM — SPTJM_filled_new.xlsx (Sheet: SPTJM)

> Sumber: `SPTJM_filled_new.xlsx:3` | Data baris 5–208 | Total **200** sekolah | Diupdate: 2026-09-01

## 1. Legenda Warna Baris

| Warna               | Kode Fill  | Jumlah  | Arti                                   |
| ------------------- | ---------- | ------- | -------------------------------------- |
| Hijau               | `FF92D050` | 69      | Sudah mengirim, SPTJM tidak bermasalah |
| Biru                | `FF00B0F0` | 37      | Baru mengirim SPTJM                    |
| Merah               | `FFFF0000` | 32      | Sudah mengirim tapi bermasalah         |
| Putih (tanpa warna) | —          | 62      | Belum mengirim SPTJM (kolom H kosong)  |
| **Total**           | —          | **200** | —                                      |

- **Sudah kirim:** 138 sekolah (136 dengan H dan I numeric, 2 dengan H berupa teks: `665 sptjm 663` dan `tidak ada data sekolah yang di kirim`)
- **Belum kirim:** 62 sekolah

## 2. Komposisi Sekolah

- **Bentuk Pendidikan:** SMA 123, SMK 68, SLB 9
- **Status:** Negeri 136, Swasta 64
- **Kabupaten/Kota:**
  - Kab. Manggarai Timur: 62
  - Kab. Manggarai: 52
  - Kab. Manggarai Barat: 50
  - Kab. Ngada: 36

## 3. Status per Kabupaten

| Kabupaten            | Total   | Hijau  | Biru   | Merah  | Belum  | Selisih Kuning |
| -------------------- | ------- | ------ | ------ | ------ | ------ | -------------- |
| Kab. Manggarai       | 52      | 8      | 15     | 6      | 23     | 5              |
| Kab. Manggarai Barat | 50      | 45     | 0      | 5      | 0      | 12             |
| Kab. Manggarai Timur | 62      | 5      | 13     | 17     | 27     | 3              |
| Kab. Ngada           | 36      | 11     | 9      | 4      | 12     | 6              |
| **Total**            | **200** | **69** | **37** | **32** | **62** | **26**         |

## 4. Selisih PD (SPTJM) vs PD (Dapo) — Kolom H:I Kuning `FFFFFF00`

- **Total selisih:** 26 sekolah (keduanya numeric dan beda)
- **Kondisi awal:** 4 sudah kuning, 22 belum → **sudah diperbaiki, sekarang 26 kuning semua**
- **Besaran selisih:** mayoritas 1–2, terbesar 13

### Daftar 26 Sekolah Selisih

| No. | Sheet Row | Sekolah                           | Kab.                 | H (SPTJM) | I (Dapo) | Selisih | Warna Baris |
| --- | --------- | --------------------------------- | -------------------- | --------- | -------- | ------- | ----------- |
| 12  | 16        | SMAN 1 LELAK                      | Kab. Manggarai       | 573       | 574      | 1       | Biru        |
| 32  | 36        | SMAS ST MARIA ITENG               | Kab. Manggarai       | 335       | 334      | 1       | Biru        |
| 35  | 39        | SMK Alam Lestari Ruteng           | Kab. Manggarai       | 111       | 112      | 1       | Hijau       |
| 37  | 41        | SMK NEGERI 1 RAHONG UTARA         | Kab. Manggarai       | 118       | 113      | 5       | Biru        |
| 40  | 44        | SMK NEGERI BUNG RUTENG            | Kab. Manggarai       | 66        | 67       | 1       | Biru        |
| 54  | 58        | SLB NEGERI KOMODO                 | Kab. Manggarai Barat | 82        | 84       | 2       | Hijau       |
| 55  | 59        | SMA KATHOLIK SANCTISSIMA TRINITAS | Kab. Manggarai Barat | 113       | 111      | 2       | Hijau       |
| 62  | 66        | SMA NEGERI 3 KOMODO               | Kab. Manggarai Barat | 54        | 58       | 4       | Hijau       |
| 67  | 71        | SMAN 1 KOMODO                     | Kab. Manggarai Barat | 1243      | 1242     | 1       | Hijau       |
| 69  | 73        | SMAN 1 LEMBOR                     | Kab. Manggarai Barat | 227       | 228      | 1       | Hijau       |
| 72  | 76        | SMAN 1 MBELILING                  | Kab. Manggarai Barat | 85        | 86       | 1       | Hijau       |
| 75  | 79        | SMAN 1 WELAK                      | Kab. Manggarai Barat | 220       | 219      | 1       | Hijau       |
| 91  | 95        | SMK NEGERI 2 WELAK                | Kab. Manggarai Barat | 107       | 108      | 1       | Hijau       |
| 93  | 97        | SMK NEGERI RESTORASI PULAU KOMODO | Kab. Manggarai Barat | 124       | 123      | 1       | Hijau       |
| 97  | 101       | SMKN 1 KUWUS                      | Kab. Manggarai Barat | 521       | 520      | 1       | Hijau       |
| 98  | 102       | SMKN 1 LABUAN BAJO                | Kab. Manggarai Barat | 1635      | 1634     | 1       | Hijau       |
| 102 | 106       | SMKS STELLA MARIS LABUAN BAJO     | Kab. Manggarai Barat | 1632      | 1645     | 13      | Hijau       |
| 110 | 114       | SMAN 1 ELAR                       | Kab. Manggarai Timur | 157       | 158      | 1       | Biru        |
| 118 | 122       | SMAN 2 LAMBA LEDA                 | Kab. Manggarai Timur | 87        | 88       | 1       | Merah       |
| 153 | 157       | SMK MUHAMMADIYAH MANGGARAI TIMUR  | Kab. Manggarai Timur | 82        | 79       | 3       | Biru        |
| 173 | 177       | SMA NEGERI 2 RIUNG BARAT          | Kab. Ngada           | 83        | 81       | 2       | Biru        |
| 179 | 183       | SMAN 1 GOLEWA                     | Kab. Ngada           | 564       | 563      | 1       | Hijau       |
| 184 | 188       | SMAN 1 SOA                        | Kab. Ngada           | 756       | 754      | 2       | Hijau       |
| 185 | 189       | SMAN 2 BAJAWA                     | Kab. Ngada           | 416       | 417      | 1       | Hijau       |
| 186 | 190       | SMAS KATOLIK KEJORA RIUNG         | Kab. Ngada           | 141       | 138      | 3       | Biru        |
| 188 | 192       | SMAS REGINA PACIS BAJAWA          | Kab. Ngada           | 1201      | 1200     | 1       | Hijau       |

> Perbaikan: kolom H dan I pada 22 baris yang belum kuning telah diberi fill kuning solid `FFFFFF00`. Warna baris (kolom A–G, J) tetap dipertahankan.

## 5. Sekolah Bermasalah (Merah — 32)

Contoh keterangan (`J`):

- `ttd kepsek` (15)
- `ttd kepsek, pengawas` / `ttd ops, kepsek dan pengawas` (11)
- `ttd Kepsek tidak ada meterai` (4)
- `tidak ada data sekolah yang di kirim` (1 — SMK MUHAMMADIYAH GOLO MORI)
- `665 sptjm 663` (1 — SMK SWASTA ST. ALOISIUS)

Distribusi merah: Manggarai 6, Manggarai Barat 5, Manggarai Timur 17, Ngada 4.

## 6. Catatan

- Baris putih = `PD (SPTJM)` kosong, `PD (Dapo)` ada → indikasi belum kirim, tidak dihitung sebagai selisih.
- File `SPTJM_filled_new.xlsx` telah disimpan dengan koreksi warna kuning pada H:I untuk semua selisih.

