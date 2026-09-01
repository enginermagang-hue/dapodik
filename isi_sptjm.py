import csv, re
import openpyxl
from pathlib import Path

PD_CSV = Path(r"D:\Project\dapodik\pd-dapodik.csv")
SPTJM_XLSX = Path(r"D:\Project\dapodik\SPTJM.xlsx")

def norm_nama(s):
    if s is None:
        return ""
    return re.sub(r'\s+', ' ', str(s).strip().lower())

# 1. load pd-dapodik.csv by NPSN and by normalized nama
pd_by_npsn = {}
pd_by_nama = {}
with open(PD_CSV, encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    # header already clean: npsn,nama_sekolah,bentuk,kabupaten,kecamatan,jumlah_aktif
    for row in reader:
        npsn = str(row["npsn"]).strip()
        nama = str(row["nama_sekolah"]).strip()
        jumlah = str(row["jumlah_aktif"]).strip()
        try:
            jumlah_int = int(jumlah) if jumlah else 0
        except:
            jumlah_int = 0
        if npsn:
            pd_by_npsn[npsn] = jumlah_int
        norm = norm_nama(nama)
        if norm:
            # if duplicate nama, keep first; nama should be unique
            if norm not in pd_by_nama:
                pd_by_nama[norm] = jumlah_int

print(f"pd-dapodik.csv: {len(pd_by_npsn)} entri NPSN, {len(pd_by_nama)} entri nama unik")

# 2. load SPTJM.xlsx
wb = openpyxl.load_workbook(SPTJM_XLSX)
if "SPTJM" not in wb.sheetnames:
    raise SystemExit(f"Sheet SPTJM tidak ditemukan. Sheets: {wb.sheetnames}")
ws = wb["SPTJM"]

# header di baris 3, data mulai baris 5
# kolom: B=Nama (2), C=NPSN (3), I=PD (Dapo) (9)
header_nama = ws.cell(3, 2).value
header_npsn = ws.cell(3, 3).value
header_pd = ws.cell(3, 9).value
print(f"Header SPTJM: B={header_nama}, C={header_npsn}, I={header_pd}")

start_row = 5
max_row = ws.max_row
# cari batas data aktual (baris terakhir dengan NPSN)
actual_max = start_row - 1
for r in range(start_row, max_row + 1):
    npsn = ws.cell(r, 3).value
    nama = ws.cell(r, 2).value
    if npsn is None and nama is None:
        continue
    if npsn is not None and str(npsn).strip():
        actual_max = r
    elif nama is not None and str(nama).strip():
        actual_max = r

print(f"Baris data SPTJM: {start_row}..{actual_max} (max_row wb={max_row})")

n_match_npsn = 0
n_match_nama = 0
n_notfound = 0
notfound_list = []

for r in range(start_row, actual_max + 1):
    npsn_cell = ws.cell(r, 3).value
    nama_cell = ws.cell(r, 2).value
    if npsn_cell is None and nama_cell is None:
        continue
    npsn = str(npsn_cell).strip() if npsn_cell is not None else ""
    # npsn di excel mungkin numeric -> jadi '50303346.0' ? handle
    if npsn.endswith(".0"):
        npsn = npsn[:-2]
    # bersihkan spasi
    npsn = npsn.strip()
    nama = str(nama_cell).strip() if nama_cell else ""
    jumlah = None
    method = ""

    if npsn and npsn in pd_by_npsn:
        jumlah = pd_by_npsn[npsn]
        method = "npsn"
        n_match_npsn += 1
    else:
        norm = norm_nama(nama)
        if norm in pd_by_nama:
            jumlah = pd_by_nama[norm]
            method = "nama"
            n_match_nama += 1
        else:
            n_notfound += 1
            notfound_list.append((r, npsn, nama))
            jumlah = None

    # tulis ke kolom I (9) = PD (Dapo)
    target_cell = ws.cell(r, 9)
    if jumlah is not None:
        target_cell.value = jumlah
    else:
        target_cell.value = None  # kosongkan jika tidak ketemu
    # optional: bisa isi 0 jika mau
    # target_cell.value = jumlah if jumlah is not None else 0

print(f"Match NPSN: {n_match_npsn}, Match Nama (fallback): {n_match_nama}, Tidak ketemu: {n_notfound}")
if notfound_list:
    print("Tidak ketemu (5 contoh):")
    for r, npsn, nama in notfound_list[:5]:
        print(f"  baris {r}: NPSN={npsn} Nama={nama}")

# simpan
# backup dulu
backup_path = SPTJM_XLSX.with_name("SPTJM_backup.xlsx")
wb.save(backup_path)
print(f"Backup disimpan: {backup_path}")

try:
    wb.save(SPTJM_XLSX)
    print(f"SPTJM.xlsx berhasil diupdate (kolom I = PD Dapo terisi)")
except PermissionError:
    alt = SPTJM_XLSX.with_name("SPTJM_filled.xlsx")
    wb.save(alt)
    print(f"SPTJM.xlsx terkunci (mungkin dibuka di Excel). Disimpan ke: {alt}")
    print("Tutup Excel lalu rename manual SPTJM_filled.xlsx -> SPTJM.xlsx jika perlu")

# ringkas
total_data = actual_max - start_row + 1
print(f"Total baris SPTJM diproses: {total_data}, terisi: {n_match_npsn + n_match_nama}, kosong: {n_notfound}")
