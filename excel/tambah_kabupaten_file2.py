#!/usr/bin/env python3
"""
Tambah kolom Kabupaten/Kota ke file-2.xlsx sesuai file-1.xlsx (mapping NPSN -> Kabupaten/Kota).
- file-1: sheet1 col B NPSN, col D Kabupaten/Kota
- file-2: sheet1 row3 header, data row4.. col B "(NPSN) NAMA", col E Kecamatan; sisip col F baru Kabupaten/Kota, geser F..N -> G..O
- Edit langsung xl/worksheets/sheet1.xml via zipfile (hindari openpyxl Fill bug).

Usage:
  python excel/tambah_kabupaten_file2.py
  python excel/tambah_kabupaten_file2.py --map excel/file-1.xlsx --in excel/file-2.xlsx --out excel/file-2.xlsx
"""
import argparse
import re
import zipfile
import shutil
from pathlib import Path
import xml.etree.ElementTree as ET

NS = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def parse_sheet_xml(data: str):
    """return list of rows: {rn, cells: [(ref, value_text, cell_xml_inner)]} naive but enough."""
    rows = re.findall(r'<row[^>]*r="(\d+)"[^>]*>(.*?)</row>', data, re.S)
    out = []
    for rn, content in rows:
        cells = re.findall(r'<c[^>]*r="([A-Z]+\d+)"[^>]*>(.*?)</c>', content, re.S)
        parsed = []
        for cr, inner in cells:
            m = re.search(r'<is><t>(.*?)</t></is>', inner, re.S)
            if m:
                parsed.append((cr, m.group(1).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")))
            else:
                mv = re.search(r'<v>(.*?)</v>', inner, re.S)
                if mv:
                    parsed.append((cr, mv.group(1)))
                else:
                    mt = re.search(r'<t>(.*?)</t>', inner, re.S)
                    parsed.append((cr, mt.group(1) if mt else ""))
        out.append((rn, parsed, content))
    return out

def col_letter(col_idx: int) -> str:
    """0->A, 13->N, 14->O"""
    s = ""
    n = col_idx
    while True:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s

def col_to_idx(letter: str) -> int:
    n = 0
    for ch in letter:
        n = n * 26 + (ord(ch) - 64)
    return n - 1

def xml_escape(t: str) -> str:
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def build_inline_cell(ref: str, value: str, style: str = "2") -> str:
    # s="2" matches header style in file-2
    v = xml_escape(value)
    return f'<c t="inlineStr" r="{ref}" s="{style}"><is><t>{v}</t></is></c>'

def extract_npsn(text: str) -> str:
    m = re.search(r"\((\d{6,8})\)", text or "")
    return m.group(1) if m else ""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", default=str(Path(__file__).parent / "file-1.xlsx"), help="file-1.xlsx mapping")
    ap.add_argument("--in", dest="inp", default=str(Path(__file__).parent / "file-2.xlsx"), help="file-2 input")
    ap.add_argument("--out", default=None, help="output (default overwrite inp)")
    args = ap.parse_args()
    map_path = Path(args.map)
    in_path = Path(args.inp)
    out_path = Path(args.out) if args.out else in_path

    # 1. mapping NPSN -> Kabupaten
    z1 = zipfile.ZipFile(map_path)
    d1 = z1.read("xl/worksheets/sheet1.xml").decode()
    rows1 = re.findall(r'<row[^>]*r="(\d+)"[^>]*>(.*?)</row>', d1, re.S)
    mapping: dict[str, str] = {}
    for rn, content in rows1:
        if rn == "1":
            continue
        cells = {cr: val for cr, val in _cells(content)}
        npsn = cells.get(f"B{rn}", "").strip()
        kab = cells.get(f"D{rn}", "").strip()
        if npsn:
            mapping[npsn] = kab
    print(f"Mapping file-1: {len(mapping)} NPSN")

    # 2. read file-2 sheet1.xml
    z2 = zipfile.ZipFile(in_path)
    sheet_data = z2.read("xl/worksheets/sheet1.xml").decode()
    # keep other files
    other_files = {n: z2.read(n) for n in z2.namelist() if n != "xl/worksheets/sheet1.xml"}

    # idempotent / repair: cek header row3 berapa kolom Kabupaten/Kota
    hdr_cells = {cr: v for cr, v in _cells(re.search(r'<row[^>]*r="3"[^>]*>(.*?)</row>', sheet_data, re.S).group(1))}
    kab_count = sum(1 for v in hdr_cells.values() if v.strip() == "Kabupaten/Kota")
    if kab_count >= 1:
        # jika sudah benar 1 kolom (F3 Kab, G3 Rombel), skip insert
        has_f = hdr_cells.get("F3", "") == "Kabupaten/Kota"
        has_g_rombel = any("Rombel" in v for v in hdr_cells.values())
        if kab_count == 1 and has_f and has_g_rombel:
            print("Sudah ada 1 kolom Kabupaten/Kota di F3 — skip, tidak duplikat.")
            return
        if kab_count >= 2:
            print(f"Terdeteksi {kab_count} kolom Kabupaten/Kota — repair: hapus duplikat dulu (restore dari .bak lebih cepat).")
            # hapus kolom G (duplikat kedua) jika ada, shift H..P -> G..O
            # Sederhana: restore dari .bak jika ada, lalu lanjut 1x insert
            bak = in_path.with_suffix(in_path.suffix + ".bak")
            if bak.exists():
                print(f"  Restore dari {bak} lalu insert 1 kolom...")
                z2b = zipfile.ZipFile(bak)
                sheet_data = z2b.read("xl/worksheets/sheet1.xml").decode()
                other_files = {n: z2b.read(n) for n in z2b.namelist() if n != "xl/worksheets/sheet1.xml"}
            else:
                # fallback: hapus G col manual
                sheet_data = re.sub(r'<c[^>]*r="G3"[^>]*>.*?</c>', '', sheet_data)
                sheet_data = re.sub(r'<c[^>]*r="G\d+"[^>]*>.*?</c>', '', sheet_data)
                # shift H..P -> G..O
                def _shift_back(m):
                    ref = m.group(1)
                    mm = re.match(r"([A-Z]+)(\d+)", ref)
                    letters, num = mm.groups()
                    idx = col_to_idx(letters)
                    if idx >= 7:  # H onwards
                        idx -= 1
                    return m.group(0).replace(f'r="{ref}"', f'r="{col_letter(idx)}{num}"', 1)
                sheet_data = re.sub(r'<c[^>]*r="([A-Z]+\d+)"', _shift_back, sheet_data)
                sheet_data = sheet_data.replace('ref="A1:P1"', 'ref="A1:O1"').replace('ref="A2:P2"', 'ref="A2:O2"')
                sheet_data = re.sub(r'<col min="7"[^>]*?/>', '', sheet_data)
                # renumber cols 8..16 -> 7..15
                def _col_back(m):
                    minv=int(m.group(1)); maxv=int(m.group(2)); rest=m.group(3)
                    if minv >= 8:
                        return f'<col min="{minv-1}" max="{maxv-1}"{rest}/>'
                    return m.group(0)
                sheet_data = re.sub(r'<col min="(\d+)" max="(\d+)"([^>]*?)/>', _col_back, sheet_data)

    # shift: insert new col after E (col idx 4). Old F..N (5..13) -> G..O (6..14)
    # Update: <cols>, <mergeCells>, and each <c r="Xrow">
    # cols
    def shift_cols(xml: str) -> str:
        def repl_col(m):
            minv = int(m.group(1)); maxv = int(m.group(2)); rest = m.group(3)
            if minv >= 6:
                return f'<col min="{minv+1}" max="{maxv+1}"{rest}/>'
            if maxv >= 6:
                return f'<col min="{minv}" max="{maxv+1}"{rest}/>'
            return m.group(0)
        xml = re.sub(r'<col min="(\d+)" max="(\d+)"([^>]*?)/>', repl_col, xml)
        if '<col min="6"' not in xml:
            xml = xml.replace('</cols>', '<col min="6" max="6" width="25" customWidth="1"/></cols>')
        return xml

    def shift_ref(ref: str) -> str:
        m = re.match(r"([A-Z]+)(\d+)", ref)
        if not m:
            return ref
        letters, num = m.groups()
        idx = col_to_idx(letters)
        if idx >= 5:  # F index 5
            idx += 1
        return f"{col_letter(idx)}{num}"

    def shift_row_cells(content: str) -> str:
        # replace each <c ... r="F4"> -> G4 etc
        def repl(m):
            full = m.group(0)
            ref = m.group(1)
            new_ref = shift_ref(ref)
            return full.replace(f'r="{ref}"', f'r="{new_ref}"', 1)
        return re.sub(r'<c[^>]*r="([A-Z]+\d+)"', repl, content)

    # apply to whole sheet
    # 1) cols
    new_sheet = shift_cols(sheet_data)
    # 2) mergeCells A1:N1 -> A1:O1 etc
    new_sheet = new_sheet.replace('ref="A1:N1"', 'ref="A1:O1"').replace('ref="A2:N2"', 'ref="A2:O2"')
    # dimension if present (not in these files, but handle)
    new_sheet = re.sub(r'ref="A1:N(\d+)"', r'ref="A1:O\1"', new_sheet)

    # 3) rows: shift cells and insert Kabupaten cell
    # parse rows and rebuild
    rows = re.findall(r'(<row[^>]*r="(\d+)"[^>]*>)(.*?)(</row>)', new_sheet, re.S)
    rebuilt = []
    miss = []
    hit = 0
    for full_open, rn, inner, close in rows:
        shifted_inner = shift_row_cells(inner)
        if rn == "3":
            kab_cell = build_inline_cell("F3", "Kabupaten/Kota", style="2")
            # find start of <c ... r="G3"
            m = re.search(r'<c[^>]*r="G3"', shifted_inner)
            if m:
                idx = m.start()
                shifted_inner = shifted_inner[:idx] + kab_cell + shifted_inner[idx:]
            else:
                shifted_inner = shifted_inner + kab_cell
        elif int(rn) >= 4:
            cells = {cr: val for cr, val in _cells(shifted_inner)}
            b_val = cells.get(f"B{rn}", "")
            npsn = extract_npsn(b_val)
            kab = mapping.get(npsn, "") if npsn else ""
            if kab:
                hit += 1
            else:
                miss.append((rn, b_val, npsn))
            kab_cell = build_inline_cell(f"F{rn}", kab or "-", style="2")
            gref = f'G{rn}'
            m = re.search(r'<c[^>]*r="' + re.escape(gref) + r'"', shifted_inner)
            if m:
                shifted_inner = shifted_inner[:m.start()] + kab_cell + shifted_inner[m.start():]
            else:
                shifted_inner += kab_cell
        rebuilt.append(f"{full_open}{shifted_inner}{close}")

    # replace rows block
    # rebuild sheet: replace old rows with new
    # Use regex to replace whole sheetData inner
    new_sheet = re.sub(r"<sheetData>.*?</sheetData>", "<sheetData>" + "".join(rebuilt) + "</sheetData>", new_sheet, flags=re.S)

    # 4) write zip
    if out_path == in_path:
        bak = in_path.with_suffix(in_path.suffix + ".bak")
        if not bak.exists():
            shutil.copy2(in_path, bak)
            print(f"Backup: {bak}")
    tmp = out_path.with_suffix(".tmp.xlsx")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zw:
        for name, data in other_files.items():
            zw.writestr(name, data)
        zw.writestr("xl/worksheets/sheet1.xml", new_sheet.encode())
    # atomic replace
    if tmp != out_path:
        shutil.move(str(tmp), str(out_path))
    else:
        # tmp is out_path.tmp, need move
        pass
    # if tmp path is different handle
    if tmp.exists():
        if tmp.resolve() != out_path.resolve():
            shutil.move(str(tmp), str(out_path))
        else:
            # tmp is .tmp.xlsx next to out, already moved? ensure
            pass
    # Actually tmp is out.tmp.xlsx, move to out
    alt_tmp = out_path.parent / (out_path.stem + ".tmp.xlsx")
    if alt_tmp.exists():
        shutil.move(str(alt_tmp), str(out_path))

    total_data = len([r for r in rows if int(r[1]) >= 4])
    print(f"Selesai: {out_path}")
    print(f"  Data rows: {total_data}, match: {hit}, miss: {len(miss)}")
    if miss[:10]:
        print("  Miss sample (row, B, npsn):", miss[:10])
    print("  Kolom baru F = Kabupaten/Kota (setelah E Kecamatan), G..O geser.")

def _cells(content: str):
    cells = re.findall(r'<c[^>]*r="([A-Z]+\d+)"[^>]*>(.*?)</c>', content, re.S)
    for cr, inner in cells:
        m = re.search(r"<is><t>(.*?)</t></is>", inner, re.S)
        if m:
            yield cr, m.group(1).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        else:
            mv = re.search(r"<v>(.*?)</v>", inner, re.S)
            if mv:
                yield cr, mv.group(1)
            else:
                mt = re.search(r"<t>(.*?)</t>", inner, re.S)
                yield cr, mt.group(1) if mt else ""

if __name__ == "__main__":
    main()
