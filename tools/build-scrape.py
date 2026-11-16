#!/usr/bin/env python3
"""
build-scrape.py — suntik daftar sekolah.json ke scrape-lulusan.js

Yang dilakukan:
  1. Membaca `daftar sekolah.json` (harus ada di root proyek).
  2. Mengganti blok `NPSN_RAW`      -> daftar NPSN (dipisah spasi).
  3. Mengganti blok `WILAYAH_RAW`   -> baris "NPSN|Kabupaten|Kecamatan".
  4. Menulis ulang `scrape-lulusan.js` (bagian lain tidak disentuh).

Pakai:
  python tools/build-scrape.py
  python tools/build-scrape.py --check     # hanya verifikasi, tidak menulis
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "daftar sekolah.json"
JS_PATH = ROOT / "scrape-lulusan.js"

NPSN_RE = re.compile(r"(const NPSN_RAW = `\n)(.*?)(\n`;)", re.S)
WILAYAH_RE = re.compile(r"(const WILAYAH_RAW = `\n)(.*?)(\n`;)", re.S)


def wrap_tokens(tokens, width=100):
    lines, cur = [], ""
    for t in tokens:
        if not cur:
            cur = t
        elif len(cur) + 1 + len(t) <= width:
            cur += " " + t
        else:
            lines.append(cur)
            cur = t
    if cur:
        lines.append(cur)
    return "\n".join(lines)


def clean(v):
    v = (v or "").replace("|", "/")
    # aman di dalam template literal JS
    v = v.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    return v.replace("\r", " ").replace("\n", " ").strip()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verifikasi saja, jangan tulis")
    args = ap.parse_args()

    for p in (JSON_PATH, JS_PATH):
        if not p.exists():
            sys.exit(f"tidak ditemukan: {p}")

    schools = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    if not isinstance(schools, list) or not schools:
        sys.exit("daftar sekolah.json kosong / format tidak dikenal")

    npsn_list, wil_lines, seen = [], [], set()
    for s in schools:
        npsn = str(s.get("npsn", "")).strip()
        if not npsn or npsn in seen:
            continue
        seen.add(npsn)
        npsn_list.append(npsn)
        wil_lines.append(
            "|".join([npsn, clean(s.get("kabupaten_kota")), clean(s.get("kecamatan"))])
        )

    js = JS_PATH.read_text(encoding="utf-8")
    newline = "\r\n" if "\r\n" in js[:2000] else "\n"

    npsn_block = wrap_tokens(npsn_list)
    wil_block = "\n".join(wil_lines)

    js_new, n1 = NPSN_RE.subn(lambda m: m.group(1) + npsn_block + m.group(3), js, count=1)
    js_new, n2 = WILAYAH_RE.subn(lambda m: m.group(1) + wil_block + m.group(3), js_new, count=1)

    if not n1 or not n2:
        sys.exit("blok NPSN_RAW / WILAYAH_RAW tidak ditemukan di scrape-lulusan.js")

    # verifikasi hasil
    got_npsn = NPSN_RE.search(js_new).group(2).split()
    got_wil = [l for l in WILAYAH_RE.search(js_new).group(2).splitlines() if l.strip()]
    kab_set = sorted({l.split("|")[1] for l in got_wil if len(l.split("|")) > 1})

    print(f"sekolah di JSON      : {len(schools)}")
    print(f"NPSN unik            : {len(npsn_list)}")
    print(f"baris WILAYAH        : {len(got_wil)}")
    print(f"kabupaten/kota unik  : {len(kab_set)}")
    print(f"file JS              : {len(js_new.encode('utf-8')):,} byte")

    if got_npsn != npsn_list:
        sys.exit("GAGAL: daftar NPSN hasil substitusi tidak cocok dengan sumber")

    if args.check:
        print("check OK (tidak menulis file)")
        return

    if newline != "\n":
        js_new = js_new.replace("\r\n", "\n").replace("\n", "\r\n")

    JS_PATH.write_text(js_new, encoding="utf-8", newline="")
    print(f"✅ ditulis: {JS_PATH}")

    # turunan: versi Tampermonkey
    gen = ROOT / "tools" / "build-userscript.py"
    if gen.exists():
        print()
        sys.stdout.flush()
        subprocess.run([sys.executable, str(gen)], check=False)


if __name__ == "__main__":
    main()
