// ats_cache_v3.js — panel cache-only ATS v3 (tanpa tabel): fetch list + detail paralel -> IDB -> unduh CSV
// BASIS: https://ats.data.kemendikdasmen.go.id/hasil-verifikasi/progres (paste di halaman itu, sudah login).
(() => {
  if (document.getElementById('__atsc3')) document.getElementById('__atsc3').remove();
  document.querySelectorAll('style[data-atsc3]').forEach(s => s.remove());
  const CFG = {
    PER_PAGE: 100, LIST_CONC: 3, LIST_MAX: 10, DET_CONC: 8, DET_MIN: 2, DET_MAX: 24,
    MAX_INFLIGHT: 12, GLOBAL_RPM: 900, RPM_MAX: 1200,
    WAF_COOL: [15000, 30000, 60000, 120000],
    TTL_MS: 7 * 24 * 3600 * 1000, BATCH: 50, RAMP_OK: 60,
  };
  const getBearer = () => {
    const deep = (o, d = 0) => {
      if (!o || d > 4) return '';
      if (typeof o === 'string') { const s = o.trim();
        if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(s)) return s;
        if (/^[\{\[]/.test(s)) { try { return deep(JSON.parse(s), d + 1); } catch {} return ''; } return ''; }
      if (typeof o !== 'object') return '';
      for (const k of ['access_token', 'token', 'bearer', 'jwt']) if (typeof o[k] === 'string' && o[k].length > 20) return o[k].trim();
      for (const v of Object.values(o)) { const f = deep(v, d + 1); if (f) return f; } return '';
    };
    for (const k of ['ats-sesi', 'access_token', 'token']) { try { const r = localStorage.getItem(k); if (r) { const f = deep(r); if (f) return f; } } catch {} }
    return '';
  };
  const TOKEN = getBearer();
  if (!TOKEN) { alert('Token tidak ketemu. Login ulang.'); return; }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();
  const fmtT = ms => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + 'j' : '') + (m ? m + 'm' : '') + (s % 60) + 'd'; };
  // ---- IDB (reuse store atsdash-v2 agar cache bisa dibuka dashboard v2) ----
  let _db = null, _dbP = null;
  const idb = () => {
    if (_db) return Promise.resolve(_db);
    if (_dbP) return _dbP;
    _dbP = new Promise((res, rej) => {
      try {
        const rq = indexedDB.open('atsdash-v2', 1);
        rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains('list')) d.createObjectStore('list'); if (!d.objectStoreNames.contains('detail')) d.createObjectStore('detail'); };
        rq.onsuccess = () => { _db = rq.result; res(_db); };
        rq.onerror = () => { _dbP = null; rej(rq.error); };
      } catch (e) { _dbP = null; rej(e); }
    });
    return _dbP;
  };
  const idbGet = async (st, k) => { try { const d = await idb(); const r = await new Promise((a, b) => { const q = d.transaction(st).objectStore(st).get(k); q.onsuccess = () => a(q.result); q.onerror = () => b(q.error); }); if (r && now() - r.t < CFG.TTL_MS) return r; } catch {} return null; };
  const idbBatch = async (st, pairs) => { // pairs: [[key, value]]
    if (!pairs.length) return;
    try { const d = await idb(); await new Promise((res, rej) => { const tx = d.transaction(st, 'readwrite'); const os = tx.objectStore(st); const t = now(); for (const [k, v] of pairs) os.put({ t, v }, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); } catch {}
  };
  const idbClear = async () => { try { const d = await idb(); for (const s of ['list', 'detail']) await new Promise((res, rej) => { const q = d.transaction(s, 'readwrite').objectStore(s).clear(); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); } catch {} };
  const idbAllKeys = async (st) => { try { const d = await idb(); return await new Promise((res, rej) => { const q = d.transaction(st).objectStore(st).getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); } catch { return []; } };
  const idbAll = async (st) => { try { const d = await idb(); return await new Promise((res, rej) => { const q = d.transaction(st).objectStore(st).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); } catch { return []; } };
  // ---- state ----
  const S = { run: 0, stop: false, phase: 'idle', wil: '240000', perPage: CFG.PER_PAGE,
    pages: [], pageDone: 0, pageFail: [], rows: 0, detNeed: [], detDone: 0, detFail: [],
    hit: 0, miss: 0, t0: 0, wafUntil: 0, wafN: 0, detConc: CFG.DET_CONC, listConc: CFG.LIST_CONC, rpm: CFG.GLOBAL_RPM, okStreak: 0, msg: '' };
  const flatOf = (j) => { const v = (j || {}).data || {}, s = (v.pendidikan || {}).sekolah_terakhir || {}, idn = v.identitas || {}, w = v.wilayah || {}; return { bentuk: (s.bentuk || '').toLowerCase(), jenjang: (s.jenjang || '').toLowerCase(), nama: s.nama || '', tingkat: s.tingkat || '', ibu: idn.nama_ibu || '', ayah: idn.nama_ayah || '', alamat: idn.alamat_jalan || '', rt: idn.rt ?? '', rw: idn.rw ?? '', lintang: idn.lintang ?? '', bujur: idn.bujur ?? '', d_desa: w.desa || '', d_kec: w.kecamatan || '', d_kab: w.kabupaten || '', d_prov: w.provinsi || '' }; };
  const csvCell = v => { if (v == null) return ''; let s = String(v).replace(/\r?\n/g, ' '); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",;\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // ---- token bucket global ----
  const RATE = { stamps: [] };
  const gate = async () => { for (;;) { if (now() < S.wafUntil) { const s = Math.ceil((S.wafUntil - now()) / 1000); uiStatus(`WAF — jeda ${s}s (otomatis)`); await sleep(Math.min(1000, S.wafUntil - now())); continue; } const t = now(); RATE.stamps = RATE.stamps.filter(x => t - x < 60000); if (RATE.stamps.length < S.rpm) { RATE.stamps.push(t); return; } await sleep(Math.max(200, 60000 - (t - RATE.stamps[0]) + 50)); } };
  const noteOk = () => { S.okStreak++; S.wafN = 0;
    if (S.okStreak >= CFG.RAMP_OK) { S.okStreak = 0;
      let up = '';
      if (S.detConc < CFG.DET_MAX) { S.detConc = Math.min(CFG.DET_MAX, S.detConc * 2); up += ` det x${S.detConc}`; }
      if (S.listConc < CFG.LIST_MAX) { S.listConc = Math.min(CFG.LIST_MAX, S.listConc * 2); up += ` list x${S.listConc}`; }
      if (S.rpm < CFG.RPM_MAX) { S.rpm = Math.min(CFG.RPM_MAX, Math.round(S.rpm * 1.1)); up += ` ${S.rpm}/m`; }
      if (up) uiStatus('ramp naik:' + up);
    } };
  const noteWaf = () => { S.okStreak = 0; S.detConc = Math.max(CFG.DET_MIN, Math.floor(S.detConc / 2)); S.listConc = Math.max(2, Math.floor(S.listConc / 2)); S.rpm = Math.max(240, Math.floor(S.rpm / 2)); const c = CFG.WAF_COOL[Math.min(S.wafN, 3)]; S.wafUntil = Math.max(S.wafUntil, now() + c); S.wafN++; };
  // ---- fetch ----
  const isWafCT = ct => /text\/html/i.test(ct || '');
  const isWafBody = t => /Akses Ditolak|SUPPORT ID|sl-waf-script|_sl_waf|safeline/i.test((t || '').slice(0, 2000));
  const errMsgOf = (j, fb) => { try { const m = j && (j.message || (j.meta && j.meta.message)); if (m && String(m).trim()) return String(m).trim(); } catch {} return fb; };
  async function fetchJSON(url, retries = 8) {
    let last = null;
    for (let a = 0; ; a++) {
      await gate();
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN } });
      const ct = res.headers.get('content-type') || '';
      if (res.status === 401) throw new Error('401: login ulang');
      if (isWafCT(ct) || res.status === 429 || res.status === 468 || res.status >= 500) {
        try { await res.body?.cancel(); } catch {}
        const ra = parseFloat(res.headers.get('retry-after') || '');
        last = new Error(isWafCT(ct) ? 'WAF: diblok sementara' : 'HTTP ' + res.status);
        noteWaf(); if (!isNaN(ra) && ra > 0) S.wafUntil = Math.max(S.wafUntil, now() + Math.min(ra, 180) * 1000);
        if (a >= retries) throw last; continue;
      }
      const txt = await res.text();
      if (isWafBody(txt)) { last = new Error('WAF: diblok sementara'); noteWaf(); if (a >= retries) throw last; continue; }
      if (!res.ok) {
        let body = null; try { body = txt.trim() ? JSON.parse(txt) : null; } catch {}
        if (res.status === 400 && /per_page/i.test(JSON.stringify(body || txt).slice(0, 500))) {
          const m = /maksimal\s+(\d+)/i.exec(JSON.stringify(body || '') + ' ' + txt);
          if (m) { const cap = Math.max(1, Math.min(parseInt(m[1], 10) || CFG.PER_PAGE, CFG.PER_PAGE)); const u = new URL(url, location.origin);
            if (u.searchParams.get('per_page') !== String(cap)) { u.searchParams.set('per_page', String(cap)); S.perPage = cap; url = u.pathname + u.search; if (a >= retries) throw new Error('400: ' + errMsgOf(body, 'batas server')); continue; } }
        }
        throw new Error(res.status + ': ' + errMsgOf(body, 'HTTP ' + res.status));
      }
      if (!txt.trim()) { last = new Error('respon kosong'); await sleep(1500); if (a >= retries) throw last; continue; }
      try { const j = JSON.parse(txt); noteOk(); return j; }
      catch { last = new Error('JSON rusak'); await sleep(1500); if (a >= retries) throw last; }
    }
  }
  // ---- UI ----
  const css = `#__atsc3{position:fixed;top:12px;right:12px;z-index:999999;width:410px;background:#0d1117;color:#e6eddf;border:1px solid #30363d;border-radius:12px;font:13px 'Segoe UI',Arial;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  #__atsc3 .h{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid #30363d}
  #__atsc3 .h b{color:#58a6ff} #__atsc3 .chip{padding:2px 10px;border-radius:20px;background:#21262d;border:1px solid #30363d;font-size:11px}
  #__atsc3 .b{padding:10px 12px;display:flex;flex-direction:column;gap:8px}
  #__atsc3 select,#__atsc3 button{background:#21262d;border:1px solid #30363d;color:#e6eddf;border-radius:6px;padding:6px 8px;font:inherit;cursor:pointer}
  #__atsc3 button.go{background:#238636;border-color:#238636;color:#fff;font-weight:700}
  #__atsc3 button:disabled{opacity:.45;cursor:default}
  #__atsc3 .row{display:flex;gap:6px;flex-wrap:wrap}
  #__atsc3 .bar{height:10px;background:#21262d;border-radius:6px;overflow:hidden}
  #__atsc3 .bar>i{display:block;height:100%;width:0;background:#238636;transition:width .3s}
  #__atsc3 .bar.det>i{background:#1f6feb}
  #__atsc3 .st{font-size:12px;color:#9fb3c8;white-space:pre-line;min-height:44px}`;
  const stEl = document.createElement('style'); stEl.dataset.atsc3 = '1'; stEl.textContent = css; document.head.appendChild(stEl);
  const root = document.createElement('div'); root.id = '__atsc3';
  root.innerHTML = `<div class="h"><b>ATS Cache v3</b><span class="chip" id="c-chip">idle</span><span style="flex:1"></span><button id="c-x">Tutup</button></div>
  <div class="b">
    <div class="row"><select id="c-kab" style="flex:1"><option value="240000">Prov. NTT</option></select><select id="c-kec" disabled style="flex:1"><option value="">kecamatan</option></select><select id="c-desa" disabled style="flex:1"><option value="">desa</option></select></div>
    <div>List <span id="c-lt" style="float:right">0/0</span><div class="bar"><i id="c-lb"></i></div></div>
    <div>Detail <span id="c-dt" style="float:right">0/0</span><div class="bar det"><i id="c-db"></i></div></div>
    <div class="st" id="c-st">siap. Pilih wilayah lalu Mulai.</div>
    <div class="row"><button id="c-go" class="go">Mulai</button><button id="c-resume">Lanjut</button><button id="c-stop">Stop</button><button id="c-retry">Ulangi gagal (0)</button></div>
    <div class="row"><button id="c-csv">Unduh CSV</button><button id="c-clear">Hapus cache</button></div>
  </div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector(id);
  const uiChip = t => { $('#c-chip').textContent = t; };
  const uiStatus = t => { S.msg = t; paint(); };
  function paint() {
    const lp = S.pages.length ? S.pageDone / S.pages.length : 0;
    const dp = S.detNeed.length ? S.detDone / S.detNeed.length : 0;
    $('#c-lb').style.width = (lp * 100).toFixed(1) + '%';
    $('#c-db').style.width = (dp * 100).toFixed(1) + '%';
    $('#c-lt').textContent = `${S.pageDone}/${S.pages.length || '?'}`;
    $('#c-dt').textContent = `${S.detDone}/${S.detNeed.length}`;
    const el = now() - S.t0;
    const eta = lp > 0.02 && S.phase !== 'done' ? fmtT(el / lp * (1 - lp)) : '-';
    $('#c-st').textContent = `${S.msg}\nlist ${S.pageDone}/${S.pages.length || '?'} (x${S.listConc}) · detail ${S.detDone}/${S.detNeed.length} (x${S.detConc}) · ${S.rpm}/m · hit ${S.hit}/miss ${S.miss} · gagal L${S.pageFail.length}/D${S.detFail.length} · ${fmtT(el)} · ETA ${eta}`;
    $('#c-retry').textContent = `Ulangi gagal (${S.pageFail.length + S.detFail.length})`;
    const busy = S.phase === 'run';
    $('#c-go').disabled = busy; $('#c-resume').disabled = busy;
  }
  const KAB = [{"kode_wilayah":"240600","nama":"Kab. Alor"},{"kode_wilayah":"240500","nama":"Kab. Belu"},{"kode_wilayah":"240900","nama":"Kab. Ende"},{"kode_wilayah":"240700","nama":"Kab. Flores Timur"},{"kode_wilayah":"240100","nama":"Kab. Kupang"},{"kode_wilayah":"241400","nama":"Kab. Lembata"},{"kode_wilayah":"242200","nama":"Kab. Malaka"},{"kode_wilayah":"241100","nama":"Kab. Manggarai"},{"kode_wilayah":"241600","nama":"Kab. Manggarai Barat"},{"kode_wilayah":"242000","nama":"Kab. Manggarai Timur"},{"kode_wilayah":"241700","nama":"Kab. Nagekeo"},{"kode_wilayah":"241000","nama":"Kab. Ngada"},{"kode_wilayah":"241500","nama":"Kab. Rote Ndao"},{"kode_wilayah":"242100","nama":"Kab. Sabu Raijua"},{"kode_wilayah":"240800","nama":"Kab. Sikka"},{"kode_wilayah":"241300","nama":"Kab. Sumba Barat"},{"kode_wilayah":"241900","nama":"Kab. Sumba Barat Daya"},{"kode_wilayah":"241800","nama":"Kab. Sumba Tengah"},{"kode_wilayah":"241200","nama":"Kab. Sumba Timur"},{"kode_wilayah":"240300","nama":"Kab. Timor Tengah Selatan"},{"kode_wilayah":"240400","nama":"Kab. Timor Tengah Utara"},{"kode_wilayah":"246000","nama":"Kota Kupang"}];
  for (const k of KAB) { const o = document.createElement('option'); o.value = k.kode_wilayah; o.textContent = k.nama; $('#c-kab').appendChild(o); }
  const wilCache = new Map();
  const loadWil = async (p) => {
    if (wilCache.has(p)) return wilCache.get(p);
    try { const c = JSON.parse(localStorage.getItem('atsv2:wil:' + p) || 'null'); if (c && now() - c.t < CFG.TTL_MS) { wilCache.set(p, c.v); return c.v; } } catch {}
    const r = await fetch(`/ats-v2/api/v1/publik/referensi/wilayah?parent=${encodeURIComponent(p)}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('wilayah ' + r.status);
    const d = ((await r.json()).data) || [];
    wilCache.set(p, d);
    try { localStorage.setItem('atsv2:wil:' + p, JSON.stringify({ t: now(), v: d })); } catch {}
    return d;
  };
  const fillSel = (sel, items, first) => { sel.innerHTML = `<option value="">${first}</option>` + items.map(x => `<option value="${x.kode_wilayah}">${x.nama}</option>`).join(''); sel.disabled = !items.length; };
  $('#c-kab').onchange = async e => { fillSel($('#c-kec'), [], 'kecamatan'); fillSel($('#c-desa'), [], 'desa'); const k = e.target.value || '240000'; if (k === '240000') return; try { fillSel($('#c-kec'), await loadWil(k), 'kecamatan'); } catch (err) { uiStatus('kecamatan: ' + err.message); } };
  $('#c-kec').onchange = async e => { fillSel($('#c-desa'), [], 'desa'); const k = e.target.value || ''; if (!k) return; try { fillSel($('#c-desa'), await loadWil(k), 'desa'); } catch (err) { uiStatus('desa: ' + err.message); } };
  const activeKode = () => $('#c-desa').value || $('#c-kec').value || $('#c-kab').value || '240000';
  // ---- engine ----
  const listURL = (wil, p) => `/ats-v2/api/v1/verifikasi/siswa?kode_wilayah=${encodeURIComponent(wil)}&page=${p}&per_page=${S.perPage}`;
  const detURL = id => `/ats-v2/api/v1/verifikasi/detail-anak/${encodeURIComponent(id)}`;
  async function run(fresh) {
    if (S.phase === 'run') return;
    const my = ++S.run; S.stop = false; S.phase = 'run'; S.t0 = now(); uiChip('list+detail');
    const wil = S.wil = activeKode();
    if (fresh) { S.pages = []; S.pageDone = 0; S.pageFail = []; S.rows = 0; S.detNeed = []; S.detDone = 0; S.detFail = []; S.hit = 0; S.miss = 0; S.perPage = CFG.PER_PAGE; }
    uiStatus('page 1: ambil total...');
    try {
      let first = await idbGet('list', `${wil}:1:${S.perPage}`);
      let j = first ? first.v : null;
      if (j) S.hit++; else { j = await fetchJSON(listURL(wil, 1)); S.miss++; await idbBatch('list', [[`${wil}:1:${S.perPage}`, j]]); }
      const total = (j.meta && j.meta.total) || (j.data || []).length;
      const nPages = Math.max(1, Math.ceil(total / S.perPage));
      S.pages = Array.from({ length: nPages }, (_, i) => i + 1);
      const seen = new Set();
      const pushRows = (rows) => { for (const r of rows || []) { const id = String(r.ats_id ?? ''); if (!id || seen.has(id)) continue; seen.add(id); S.detNeed.push(id); } S.rows = seen.size; };
      pushRows(j.data); S.pageDone = 1;
      // ---- scheduler tunggal: MAX_INFLIGHT slot, halaman diprioritaskan ----
      let listBuf = [], detBuf = [];
      const flushList = async () => { const b = listBuf; listBuf = []; if (b.length) await idbBatch('list', b); };
      const flushDet = async () => { const b = detBuf; detBuf = []; if (b.length) await idbBatch('detail', b); };
      const flushBoth = async () => { await flushList(); await flushDet(); };
      let li = 1, di = 0;
      const worker = async () => {
        for (;;) {
          if (my !== S.run || S.stop) break;
          // 1) halaman dulu (prioritas)
          let p = 0;
          if (li < nPages) p = ++li;
          if (p && p <= nPages) {
            const key = `${wil}:${p}:${S.perPage}`;
            const hit = await idbGet('list', key);
            if (hit) { S.hit++; pushRows(hit.v.data); }
            else { try { const jj = await fetchJSON(listURL(wil, p)); S.miss++; listBuf.push([key, jj]); pushRows(jj.data); if (listBuf.length >= CFG.BATCH) await flushList(); } catch (e) { S.pageFail.push(p); } }
            S.pageDone++; if (S.pageDone % 5 === 0) paint();
            continue;
          }
          // 2) list habis -> detail; kalau list belum selesai tapi antrean kosong, tunggu
          if (S.pageDone < nPages) { await sleep(150); continue; }
          const idx = di++;
          if (idx >= S.detNeed.length) break;
          const id = S.detNeed[idx];
          const hit = await idbGet('detail', id);
          if (hit) { S.hit++; S.detDone++; }
          else {
            try { const jj = await fetchJSON(detURL(id)); S.miss++; detBuf.push([id, jj]); if (detBuf.length >= CFG.BATCH) await flushDet(); }
            catch (e) { if (/401/.test(String(e.message))) { S.stop = true; uiStatus('401: login ulang'); break; } S.detFail.push(id); }
            S.detDone++;
          }
          if (S.detDone % 25 === 0) paint();
        }
        await flushBoth();
      };
      const slots = Math.min(CFG.MAX_INFLIGHT, S.listConc + S.detConc);
      await Promise.all(Array(slots).fill(0).map(worker));
      if (my !== S.run) return;
      // ramp lanjutan: kalau konkurensi naik dan masih ada sisa, spawn ronde tambahan
      if (!S.stop && (S.detDone < S.detNeed.length || S.pageDone < nPages)) {
        const more = Math.min(CFG.MAX_INFLIGHT, S.listConc + S.detConc);
        if (more > slots) await Promise.all(Array(more - slots).fill(0).map(worker));
      }
      S.phase = S.stop ? 'idle' : 'done';
      uiChip(S.phase); uiStatus(S.stop ? 'dihentikan. Klik Lanjut untuk resume.' : `selesai — ${S.rows} baris, gagal L${S.pageFail.length}/D${S.detFail.length}. Klik Unduh CSV.`);
    } catch (e) { S.phase = 'idle'; uiChip('idle'); uiStatus('gagal: ' + e.message); }
    paint();
  }
  async function retryFail() {
    if (S.phase === 'run' || (!S.pageFail.length && !S.detFail.length)) return;
    const my = ++S.run; S.stop = false; S.phase = 'run'; uiChip('retry');
    const wil = S.wil;
    const pf = S.pageFail; S.pageFail = [];
    for (const p of pf) { if (my !== S.run || S.stop) break; try { const j = await fetchJSON(listURL(wil, p)); await idbBatch('list', [[`${wil}:${p}:${S.perPage}`, j]]); S.pageDone++; S.miss++; } catch { S.pageFail.push(p); } paint(); }
    const df = S.detFail; S.detFail = [];
    const conc = Math.min(8, S.detConc);
    let i = 0;
    await Promise.all(Array(conc).fill(0).map(async () => { while (my === S.run && !S.stop && i < df.length) { const id = df[i++]; try { const j = await fetchJSON(detURL(id)); await idbBatch('detail', [[id, j]]); S.detDone++; S.miss++; } catch { S.detFail.push(id); } if (S.detDone % 10 === 0) paint(); } }));
    S.phase = 'done'; uiChip('done'); uiStatus(`retry selesai — sisa gagal L${S.pageFail.length}/D${S.detFail.length}.`); paint();
  }
  async function downloadCSV() {
    uiStatus('menyusun CSV dari cache...');
    const wil = activeKode();
    const keys = (await idbAllKeys('list')).filter(k => String(k).startsWith(wil + ':')).sort((a, b) => parseInt(String(a).split(':')[1]) - parseInt(String(b).split(':')[1]));
    if (!keys.length) { uiStatus('cache kosong untuk wilayah ini. Klik Mulai dulu.'); return; }
    const { readMany } = (() => ({ readMany: async (st, ks) => { const d = await idb(); return new Promise((res, rej) => { const tx = d.transaction(st); const os = tx.objectStore(st); const out = []; let i = 0; const nx = () => { if (i >= ks.length) { res(out); return; } const q = os.get(ks[i++]); q.onsuccess = () => { out.push(q.result); nx(); }; q.onerror = () => rej(q.error); }; nx(); }); } }))();
    const pages = await readMany('list', keys);
    const seen = new Set(); const rows = [];
    for (const r of pages) for (const x of ((r && r.v && r.v.data) || [])) { const id = String(x.ats_id ?? ''); if (!id || seen.has(id)) continue; seen.add(id); rows.push(x); }
    const detRecs = await readMany('detail', [...seen]);
    const detMap = new Map(); const ids = [...seen];
    detRecs.forEach((r, i) => { if (r && r.v) detMap.set(ids[i], flatOf(r.v)); });
    const out = rows.map(x => { const d = detMap.get(String(x.ats_id)) || {}; const o = { ...x }; delete o._det;
      if (d.bentuk || d.nama || d.ibu || d.alamat) { o.d_bentuk = d.bentuk || ''; o.d_jenjang = d.jenjang || ''; o.d_sekolah = d.nama || ''; o.d_tingkat = d.tingkat || ''; o.d_ibu = d.ibu || ''; o.d_ayah = d.ayah || ''; o.d_alamat = d.alamat || ''; o.d_rt = d.rt ?? ''; o.d_rw = d.rw ?? ''; o.d_lintang = d.lintang ?? ''; o.d_bujur = d.bujur ?? ''; o.d_desa = d.d_desa || ''; o.d_kec = d.d_kec || ''; o.d_kab = d.d_kab || ''; o.d_prov = d.d_prov || ''; } return o; });
    if (!out.length) { uiStatus('tidak ada baris.'); return; }
    const cols = Object.keys(out[0]);
    const txt = '﻿' + [cols.join(',')].concat(out.map(x => cols.map(c => csvCell(x[c])).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url;
    const dt = new Date(); const pad = n => String(n).padStart(2, '0');
    a.download = `ats-${wil}-${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    uiStatus(`CSV diunduh: ${out.length} baris (${cols.length} kolom).`);
  }
  $('#c-go').onclick = () => run(true);
  $('#c-resume').onclick = () => run(false);
  $('#c-stop').onclick = () => { S.stop = true; uiStatus('menghentikan...'); };
  $('#c-retry').onclick = retryFail;
  $('#c-csv').onclick = downloadCSV;
  $('#c-clear').onclick = async () => { uiStatus('menghapus cache...'); await idbClear(); try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf('atsv2:') === 0) localStorage.removeItem(k); } } catch {} S.pageDone = 0; S.detDone = 0; S.rows = 0; S.hit = 0; S.miss = 0; uiStatus('cache dihapus.'); paint(); };
  $('#c-x').onclick = () => { S.stop = true; S.run++; document.querySelectorAll('style[data-atsc3]').forEach(s => s.remove()); root.remove(); };
  paint();
})();
