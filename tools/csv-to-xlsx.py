#!/usr/bin/env python3
"""
csv-to-xlsx.py — gabungkan CSV hasil scrape menjadi satu file Excel.

Input  : lulusan_ntt_*.csv  dan  rekap_lulusan_ntt.csv
Output : satu .xlsx dengan 2 sheet: "Lulusan" dan "Rekap"

Fitur:
  - streaming (write_only) -> aman untuk ratusan ribu baris
  - header tebal + latar abu, baris header dibekukan, autofilter aktif
  - baris "sep=," dan BOM UTF-8 otomatis dibuang
  - NIK / NISN tetap teks (nol di depan tidak hilang)

Pakai:
  python tools/csv-to-xlsx.py
  python tools/csv-to-xlsx.py --src "C:\\Users\\Admin\\Downloads" --out data-lulusan\\lulusan_ntt.xlsx
  python tools/csv-to-xlsx.py --src data-lulusan          # kalau CSV sudah dipindah ke proyek
"""

import argparse
import csv
import glob
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HEADER_FONT = Font(bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="1F6FB2")
HEADER_ALIGN = Alignment(horizontal="center", vertical="center")


def read_csv_rows(path):
    """Yield list-of-str, melewati BOM dan baris 'sep=,' (kalau ada)."""
    with open(path, "r", encoding="utf-8-sig") as probe:
        has_sep = probe.readline().lstrip().lower().startswith("sep=")
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        if has_sep:
            next(reader, None)
        for row in reader:
            yield row


def write_sheet_multi(wb, title, files, widths=None, numeric_cols=()):
    """Header hanya diambil dari file pertama; file berikutnya dianggap data."""
    ws = wb.create_sheet(title)
    ws.freeze_panes = "A2"
    total = 0
    header_done = False
    ncols = 0

    for path in files:
        for row in read_csv_rows(path):
            if not any(x.strip() for x in row):
                continue
            if not header_done:
                cells = []
                for h in row:
                    c = WriteOnlyCell(ws, value=h)
                    c.font = HEADER_FONT
                    c.fill = HEADER_FILL
                    c.alignment = HEADER_ALIGN
                    cells.append(c)
                ws.append(cells)
                ncols = len(cells)
                header_done = True
                continue
            # file berikutnya: lewati baris header-nya
            if path != files[0] and row and row[0].strip().lower() == "npsn":
                continue
            if numeric_cols:
                row = [
                    (int(v.strip()) if i in numeric_cols and v.strip().isdigit() else v)
                    for i, v in enumerate(row)
                ]
            ws.append(row)
            total += 1

    if widths:
        for idx, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(idx)].width = w

    if total > 0 and ncols:
        ws.auto_filter.ref = f"A1:{get_column_letter(ncols)}{total + 1}"
    return total


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(Path.home() / "Downloads"),
                    help="folder berisi CSV hasil scrape (default: Downloads)")
    ap.add_argument("--out", default="data-lulusan/lulusan_ntt.xlsx",
                    help="path file .xlsx hasil")
    ap.add_argument("--pattern", default="lulusan_ntt_*.csv")
    ap.add_argument("--rekap", default="rekap_lulusan_ntt.csv")
    ap.add_argument("--kabupaten", default="rekap_kabupaten_ntt.csv")
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    if not out.is_absolute():
        out = Path(__file__).resolve().parent.parent / out

    if not src.is_dir():
        sys.exit(f"folder tidak ditemukan: {src}")

    files = sorted(glob.glob(str(src / args.pattern)))
    rekap = src / args.rekap
    kab = src / args.kabupaten

    if not files and not rekap.exists() and not kab.exists():
        sys.exit(f"tidak ada CSV yang cocok di {src}\n"
                 f"  pola  : {args.pattern}\n  rekap : {args.rekap}\n  kab   : {args.kabupaten}")

    print(f"sumber        : {src}")
    print(f"file lulusan  : {len(files)}")
    print(f"rekap         : {'ada' if rekap.exists() else 'tidak ada'}")
    print(f"rekap kab     : {'ada' if kab.exists() else 'tidak ada'}")

    wb = Workbook(write_only=True)
    total_lulusan = 0

    if files:
        total_lulusan = write_sheet_multi(
            wb, "Lulusan", files,
            widths=[11, 52, 26, 24, 12, 30, 13, 13, 18, 12, 30],
            numeric_cols={4},
        )
        print(f"baris Lulusan : {total_lulusan:,}")

    if rekap.exists():
        n = write_sheet_multi(
            wb, "Rekap", [str(rekap)],
            widths=[11, 52, 26, 24, 10, 10, 10, 10, 10, 10],
            numeric_cols={4, 5, 6, 7, 8, 9},
        )
        print(f"sekolah Rekap : {n:,}")

    if kab.exists():
        n = write_sheet_multi(
            wb, "Rekap Kabupaten", [str(kab)],
            widths=[28, 12, 11, 11, 11, 11, 11, 11],
            numeric_cols={1, 2, 3, 4, 5, 6, 7},
        )
        print(f"kabupaten     : {n:,}")

    if not wb.worksheets:
        sys.exit("tidak ada worksheet yang dibuat")

    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    size = out.stat().st_size
    print(f"OK ditulis    : {out}  ({size / 1048576:.1f} MB)")


if __name__ == "__main__":
    main()
