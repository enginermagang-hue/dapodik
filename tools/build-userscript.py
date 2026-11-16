#!/usr/bin/env python3
"""
build-userscript.py — hasilkan scrape-lulusan.user.js (Tampermonkey)
dari sumber tunggal scrape-lulusan.js.

Yang dilakukan:
  1. Membaca scrape-lulusan.js (hasil build-scrape.py, sudah berisi NPSN+WILAYAH).
  2. Mengganti komentar header dengan metadata ==UserScript==.
  3. Menyuntikkan tools/ui-panel.fragment.js (fungsi mountUI).
  4. Mengganti baris bootstrap otomatis dengan pemanggilan mountUI().
  5. Menulis scrape-lulusan.user.js + verifikasi node --check.

Pakai:
  python tools/build-userscript.py
  python tools/build-userscript.py --check
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "scrape-lulusan.js"
FRAGMENT = ROOT / "tools" / "ui-panel.fragment.js"
OUT = ROOT / "scrape-lulusan.user.js"

HEADER = """// ==UserScript==
// @name         Dapodik - Scrape Lulusan NTT 2022-2026
// @namespace    dapodik.local
// @version      1.0.0
// @description  Ambil daftar peserta didik lulus 2022-2026 per sekolah (SMA/SMK/SLB NTT) dari Dapodik, ekspor CSV/rekap
// @author       lokal
// @match        https://datadik.kemendikdasmen.go.id/manage*
// @match        https://datadik.kemendikdasmen.go.id/
// @match        https://datadik.kemendikdasmen.go.id/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/* Panel muncul di kanan bawah. Klik "Mulai" untuk menjalankan.
   Fungsi console tetap tersedia: __dapo.stats(), __dapo.probe(), __dapo.stop(),
   __dapo.probe2(), __dapo.delay(ms), __dapo.reset().
   WAF Dapodik menolak request paralel (HTTP 468) -> CONCURRENCY = 1. */
"""

BOOT_RE = re.compile(
    r"\n\s*if \(CFG\.MODE === 'probe'\) probe\(\);\s*\n"
    r"\s*else if \(CFG\.MODE === 'probe2'\) probe2\(\);\s*\n"
    r"\s*else start\(\);\s*\n"
)

HEADER_RE = re.compile(r"^/\* =+[\s\S]*?=+ \*/\n", re.M)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verifikasi saja")
    args = ap.parse_args()

    for p in (CORE, FRAGMENT):
        if not p.exists():
            sys.exit(f"tidak ditemukan: {p}")

    core = CORE.read_text(encoding="utf-8")
    frag = FRAGMENT.read_text(encoding="utf-8")

    new, n_head = HEADER_RE.subn(HEADER + "\n", core, count=1)
    if not n_head:
        sys.exit("header komentar di scrape-lulusan.js tidak ditemukan")

    if not BOOT_RE.search(new):
        sys.exit("baris bootstrap (MODE probe/probe2/run) tidak ditemukan")

    new = BOOT_RE.sub("\n  /* entry point userscript: pasang panel, jalan lewat tombol */\n  mountUI();\n", new, count=1)

    # sisipkan fragmen tepat sebelum bootstrap
    marker = "  /* entry point userscript: pasang panel, jalan lewat tombol */"
    if marker not in new:
        sys.exit("gagal menyisipkan fragmen")
    new = new.replace(marker, frag.rstrip() + "\n\n" + marker, 1)

    # sanity check
    wajib = ["mountUI", "const mountUI", "@match", "NPSN_RAW", "WILAYAH_RAW", "sekolahpd"]
    kurang = [w for w in wajib if w not in new]
    if kurang:
        sys.exit("hasil tidak lengkap, hilang: " + ", ".join(kurang))

    if new.count("mountUI") < 2:
        sys.exit("mountUI tidak terdefinisi/dipanggil dengan benar")

    print(f"sumber       : {CORE.name} ({len(core.encode('utf-8')):,} byte)")
    print(f"fragmen UI   : {FRAGMENT.name} ({len(frag.encode('utf-8')):,} byte)")
    print(f"hasil        : {len(new.encode('utf-8')):,} byte")

    if args.check:
        print("check OK (tidak menulis file)")
        return

    OUT.write_text(new, encoding="utf-8", newline="")
    print(f"OK ditulis   : {OUT}")

    if shutil.which("node"):
        r = subprocess.run(["node", "--check", str(OUT)], capture_output=True, text=True)
        if r.returncode == 0:
            print("node --check : OK")
        else:
            print("node --check : GAGAL")
            print(r.stderr.strip()[:800])
            sys.exit(1)


if __name__ == "__main__":
    main()
