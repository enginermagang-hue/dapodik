// fetch_ats_v2_bulk.js — bulk export ATS v2 (list siswa + detail-anak) ke CSV
// Pakai: login di https://ats.data.kemendikdasmen.go.id/ > F12 Console > paste file ini > Enter
// Memakai sesi browser sendiri (credentials: include). Pastikan berhak mengakses data ini.
// Untuk uji: set MAX_PAGES: 2 dulu. Untuk penuh: Infinity (118rb baris ~ 2300+ request list + 118rb detail).
// Filter jenjang (SMA/SMK) = client-side via detail-anak, karena endpoint siswa mengabaikan param jenjang/bentuk.
(async () => {
  const CONFIG = {
    KODE_WILAYAH: '240000', // '240600' untuk Kab. Alor (4924), '240000' NTT (118352)
    PER_PAGE: 10, // 10 terbukti 200 di capture; naikkan hanya jika 50 juga 200 setelah Bearer OK
    DELAY_LIST: 500,
    DELAY_DETAIL: 300,
    DETAIL_CONCURRENCY: 3,
    MAX_PAGES: 2, // ubah ke Infinity untuk penuh
    INCLUDE_DETAIL: true, // wajib true bila JENJANG diisi
    JENJANG: ['sma', 'smk'], // [] = semua jenjang; server abaikan param jenjang → filter via detail-anak
    RESUME_KEY: '__ats_v2_bulk_v1__',
  };
  const JJ = (CONFIG.JENJANG || []).map(s => String(s).toLowerCase());
  const SLB_GROUP = ['slb', 'sdlb', 'smplb', 'smlb'];
  const _unknownB = new Set();
  const matchJj = (det) => {
    if (!JJ.length) return true;
    const b = (det.d_bentuk || '').toLowerCase(), nm = (det.d_sekolah || '').toUpperCase();
    if (JJ.includes('sma') && (b === 'sma' || (b === '' && /\bSMA\b/.test(nm) && !/SMK/.test(nm)))) return true;
    if (JJ.includes('smk') && (b === 'smk' || (b === '' && /SMK/.test(nm)))) return true;
    if (JJ.includes('slb') && (SLB_GROUP.includes(b) || (b === '' && /S?LB/.test(nm)))) return true;
    if (b && !['sma', 'smk', ...SLB_GROUP].includes(b) && !_unknownB.has(b)) { _unknownB.add(b); console.warn('[ATS] bentuk tak dikenal:', b, nm); }
    return false;
  };
  if (JJ.length && !CONFIG.INCLUDE_DETAIL) { CONFIG.INCLUDE_DETAIL = true; console.log('[ATS] JENJANG aktif, INCLUDE_DETAIL dipaksa true.'); }
  const BASE_LIST = k => `/ats-v2/api/v1/verifikasi/siswa?kode_wilayah=${encodeURIComponent(k)}`;
  const URL_DETAIL = id => `/ats-v2/api/v1/verifikasi/detail-anak/${encodeURIComponent(id)}`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const csvEsc = v => {
    if (v == null) return '';
    const s = String(v).replace(/\r?\n/g, ' ');
    return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const isBlocked = (res, txt) =>
    (res && res.status === 468) || (txt && /Akses Ditolak|SUPPORT ID|sl-waf-script|_sl_waf|safeline/i.test(txt.slice(0, 4000)));

  const getBearer = () => {
    const candKeys = ['ats-sesi', 'ats_token', 'access_token', 'token', 'auth', 'ats-auth'];
    const deepFind = (o, depth = 0) => {
      if (!o || depth > 4) return '';
      if (typeof o === 'string') {
        const s = o.trim();
        if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(s)) return s;
        if (/^[\{\[]/.test(s)) {
          try { const j = JSON.parse(s); const f = deepFind(j, depth + 1); if (f) return f; } catch {}
          return '';
        }
        return '';
      }
      if (typeof o !== 'object') return '';
      for (const k of ['access_token', 'token', 'bearer', 'jwt', 'id_token', 'authorization']) {
        if (typeof o[k] === 'string' && o[k].length > 20) return o[k].trim();
      }
      for (const v of Object.values(o)) { const f = deepFind(v, depth + 1); if (f) return f; }
      return '';
    };
    for (const k of candKeys) {
      try { const raw = localStorage.getItem(k); if (!raw) continue; const f = deepFind(raw); if (f) return { token: f, src: k }; } catch {}
    }
    for (let i = 0; i < localStorage.length; i++) {
      try {
        const k = localStorage.key(i), raw = localStorage.getItem(k);
        const f = deepFind(raw); if (f) return { token: f, src: k };
      } catch {}
    }
    return { token: '', src: '' };
  };
  let AUTH = getBearer();
  console.log('[ATS] token dari:', AUTH.src || '(tidak ketemu)', 'len:', (AUTH.token || '').length, 'head:', (AUTH.token || '').slice(0, 13));
  if (!AUTH.token) throw new Error('Token tidak ketemu di localStorage. Login ulang lalu jalankan lagi.');
  if (window.__fetchHooked || window.__SITE_AUTH !== undefined) console.log('[ATS] peringatan: hook fetch lama terdeteksi. Sebaiknya reload halaman lalu paste ulang script ini saja.');

  async function fetchJSON(url, retries = 6) {
    let lastErr = null;
    for (let a = 0; a < retries; a++) {
      const res = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + AUTH.token } });
      const txt = await res.text();
      if (isBlocked(res, txt)) { await sleep(2000); lastErr = new Error('WAF-block ' + res.status); continue; }
      if (res.status === 429 || res.status >= 500) {
        const ra = parseFloat(res.headers.get('retry-after') || '0');
        await sleep(Math.min(((isNaN(ra) ? 3 : ra) * 1000) + 500 + Math.random() * 1000 + a * 1000, 60000));
        lastErr = new Error(`HTTP ${res.status} (rate-limit, coba lagi ${a + 1})`); continue;
      }
      if (res.status === 401) {
        const fresh = getBearer();
        if (fresh.token && fresh.token !== AUTH.token) {
          AUTH = fresh;
          console.log('[ATS] 401, token di-refresh dari', AUTH.src, ', coba lagi...');
          continue;
        }
        throw new Error('401 Unauthorized: token ditolak. Logout/login ulang, reload bersih, lalu jalankan bulk lagi.');
      }
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status + ' ' + txt.slice(0, 200)); await sleep(1000 * (a + 1)); continue; }
      try { return JSON.parse(txt); } catch (e) { lastErr = e; await sleep(800); }
    }
    throw lastErr || new Error('fetch gagal ' + url);
  }

  const flatList = r => ({
    registrasi_ats_id: r.registrasi_ats_id || '', ats_id: r.ats_id || '',
    nik: r.nik || '', nisn: r.nisn || '', nama: r.nama || '',
    jk: r.jenis_kelamin || '', tempat_lahir: r.tempat_lahir || '', tanggal_lahir: r.tanggal_lahir || '',
    usia: r.usia ?? '', nama_ibu: r.nama_ibu || '', alamat: r.alamat_jalan || '',
    kode_wilayah: r.kode_wilayah || '', desa: r.desa || '',
    status_verifikasi: r.status_verifikasi || '', kategori: r.kategori || '',
  });
  const flatDetail = d => {
    if (!d || !d.data) return {};
    const v = d.data, id = v.identitas || {}, w = v.wilayah || {}, p = v.pendidikan || {},
      st = p.sekolah_terakhir || {}, rg = v.registrasi || {}, pm = v.pemadanan || {};
    const masalah = (v.permasalahan || []).map(x => x.jenis_permasalahan).filter(Boolean).join(' | ');
    return {
      d_nama: id.nama || '', d_nik: id.nik || '', d_nisn: id.nisn || '',
      d_tempat_lahir: id.tempat_lahir || '', d_tanggal_lahir: id.tanggal_lahir || '', d_usia: id.usia ?? '',
      d_jk: id.jenis_kelamin || '', d_ibu: id.nama_ibu || '', d_ayah: id.nama_ayah || '',
      d_alamat: id.alamat_jalan || '', d_rt: id.rt ?? '', d_rw: id.rw ?? '',
      d_lintang: id.lintang ?? '', d_bujur: id.bujur ?? '',
      d_desa: w.desa || '', d_kec: w.kecamatan || '', d_kab: w.kabupaten || '', d_prov: w.provinsi || '',
      d_kategori: p.kategori || '', d_bentuk: (st.bentuk || '').toLowerCase(), d_jenjang: (st.jenjang || '').toLowerCase(), d_sekolah: st.nama || '', d_npsn: st.npsn || '', d_tingkat: st.tingkat || '',
      d_status_verifikasi: rg.status_verifikasi || '', d_masalah: masalah,
      d_dukcapil: pm.dukcapil ?? '', d_desil: pm.desil_dtsen ?? '',
    };
  };

  // overlay minimal
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:auto 12px 12px auto;z-index:999999;background:#111;color:#eee;padding:12px;border-radius:10px;font:12px monospace;max-width:420px';
  box.innerHTML = '<b>ATS v2 bulk</b><div id="__atsmsg">mulai...</div><div><button id="__atsstop">stop</button> <button id="__atssave">save csv</button></div>';
  document.body.appendChild(box);
  const msg = t => { box.querySelector('#__atsmsg').textContent = t; console.log('[ATS]', t); };
  const ctrl = { stopped: false };
  box.querySelector('#__atsstop').onclick = () => { ctrl.stopped = true; msg('stop diminta, menyelesaikan batch...'); };

  const rows = [];
  let page = 1, total = Infinity, nextCursor = null, skippedTotal = 0;
  try {
    while (!ctrl.stopped) {
      if (page > CONFIG.MAX_PAGES) break;
      let url = `${BASE_LIST(CONFIG.KODE_WILAYAH)}&page=${page}&per_page=${CONFIG.PER_PAGE}`;
      msg(`list page ${page} ...`);
      const j = await fetchJSON(url);
      const data = j.data || [];
      if (page === 1) total = (j.meta && j.meta.total) || data.length;
      if (!data.length) break;
      nextCursor = (j.meta && j.meta.next_cursor) || null;
      // detail per baris (concurrency kecil)
      if (CONFIG.INCLUDE_DETAIL) {
        let idx = 0;
        const worker = async () => {
          while (idx < data.length && !ctrl.stopped) {
            const r = data[idx++];
            let det = {};
            try {
              const dj = await fetchJSON(URL_DETAIL(r.ats_id));
              det = flatDetail(dj);
              await sleep(CONFIG.DELAY_DETAIL);
            } catch (e) { det = { d_error: String(e && e.message || e) }; }
            if (matchJj(det)) { rows.push({ ...flatList(r), ...det }); }
            else skippedTotal++;
            msg(`page ${page}/${Math.ceil(total / CONFIG.PER_PAGE)} simpan ${rows.length}/${total} lewati ${skippedTotal} ${r.nama || ''}`);
          }
        };
        await Promise.all(Array(Math.min(CONFIG.DETAIL_CONCURRENCY, data.length)).fill(0).map(worker));
      } else {
        for (const r of data) rows.push(flatList(r));
      }
      try { localStorage.setItem(CONFIG.RESUME_KEY, JSON.stringify({ page, n: rows.length })); } catch {}
      page++;
      if (page * CONFIG.PER_PAGE > total + CONFIG.PER_PAGE) break;
      await sleep(CONFIG.DELAY_LIST);
    }
  } catch (e) { msg('error: ' + (e && e.message || e)); }

  const saveCSV = () => {
    if (!rows.length) { msg('belum ada baris'); return; }
    const cols = Object.keys(rows[0]);
    const out = [cols.join(',')].concat(rows.map(r => cols.map(c => csvEsc(r[c])).join(','))).join('\n');
    const blob = new Blob([out], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ats-${CONFIG.KODE_WILAYAH}${JJ.length ? '-' + JJ.join('-') : ''}-p${page}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    msg(`saved ${rows.length} baris`);
  };
  box.querySelector('#__atssave').onclick = saveCSV;
  window.__ATS_BULK = { rows, saveCSV, stop: () => { ctrl.stopped = true; } };
  msg(`selesai page=${page - 1} simpan=${rows.length}/${total} lewati=${skippedTotal} next_cursor=${nextCursor ? 'ada' : 'null'}${_unknownB.size ? ' bentuk_asing=' + [..._unknownB].join(',') : ''}. Klik save csv.`);
  return { rows: rows.length, total, nextCursor: !!nextCursor };
})();
