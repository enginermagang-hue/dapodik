// ats_dashboard_v2.js — dashboard overlay ATS v2 (list + filter + detail + export)
// BASIS: https://ats.data.kemendikdasmen.go.id/hasil-verifikasi/progres (paste di halaman itu, sudah login).
// Filter jenjang SMA/SMK/SLB = client-side via detail-anak (endpoint siswa mengabaikan param jenjang/bentuk).
// Cache hibrida TTL 7 hari: in-memory + localStorage (wilayah) + IndexedDB (list siswa, detail-anak).
(() => {
  if (document.getElementById('__atsdash')) { document.getElementById('__atsdash').remove(); }
  const CONFIG = { KODE_WILAYAH: '240000', PER_PAGE: 100, DELAY: 300, MAX_AUTO_PAGES: 20, DET_CONC_MAX: 3, DET_DELAY: 400, DET_CAP: 3000, TTL_MS: 7 * 24 * 3600 * 1000, LIST_MAX: 1000, DET_MAX: 20000 };
  const getBearer = () => {
    const deepFind = (o, d = 0) => {
      if (!o || d > 4) return '';
      if (typeof o === 'string') {
        const s = o.trim();
        if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(s)) return s;
        if (/^[\{\[]/.test(s)) { try { const j = JSON.parse(s); return deepFind(j, d + 1); } catch {} return ''; }
        return '';
      }
      if (typeof o !== 'object') return '';
      for (const k of ['access_token', 'token', 'bearer', 'jwt']) if (typeof o[k] === 'string' && o[k].length > 20) return o[k].trim();
      for (const v of Object.values(o)) { const f = deepFind(v, d + 1); if (f) return f; }
      return '';
    };
    for (const k of ['ats-sesi', 'access_token', 'token']) {
      try { const raw = localStorage.getItem(k); if (raw) { const f = deepFind(raw); if (f) return f; } } catch {}
    }
    return '';
  };
  const TOKEN = getBearer();
  if (!TOKEN) { alert('Token tidak ketemu. Login ulang.'); return; }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const csvEsc = v => { if (v == null) return ''; const s = String(v).replace(/\r?\n/g, ' '); return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const state = { rows: [], page: 0, total: 0, loading: false, stop: false, q: '', kat: '', stat: '', sort: 'nama', jj: { sma: false, smk: false, slb: false }, skipCache: false, cache: { hit: 0, miss: 0, oldest: 0 } };
  // --- Cache hibrida (TTL 7 hari) ---
  const nowMs = () => Date.now();
  const ageDays = (t) => t ? ((nowMs() - t) / 86400000).toFixed(1) + 'h' : '-';
  const lsGet = (k) => { try { const j = JSON.parse(localStorage.getItem(k) || 'null'); if (j && nowMs() - j.t < CONFIG.TTL_MS) return j; } catch {} return null; };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify({ t: nowMs(), v })); } catch {} };
  let _idb = null;
  const idb = () => new Promise((res, rej) => {
    if (_idb) return res(_idb);
    try {
      const rq = indexedDB.open('atsdash-v2', 1);
      rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('list'); db.createObjectStore('detail'); };
      rq.onsuccess = () => { _idb = rq.result; res(_idb); };
      rq.onerror = () => rej(rq.error);
    } catch (e) { rej(e); }
  });
  const idbRec = async (store, key) => {
    try {
      const db = await idb();
      const r = await new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      if (r && nowMs() - r.t < CONFIG.TTL_MS) return r;
    } catch {}
    return null;
  };
  const idbDel = async (store, key) => { try { const db = await idb(); await new Promise((res, rej) => { const q = db.transaction(store, 'readwrite').objectStore(store).delete(key); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); } catch {} };
  const idxGet = (k) => { try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const idbSetCap = async (store, key, v, max, idxKey) => {
    try {
      const db = await idb();
      await new Promise((res, rej) => { const q = db.transaction(store, 'readwrite').objectStore(store).put({ t: nowMs(), v }, key); q.onsuccess = () => res(); q.onerror = () => rej(q.error); });
      let a = idxGet(idxKey).filter(k => k !== key); a.push(key);
      if (a.length > max) { const ev = a.slice(0, a.length - max); a = a.slice(a.length - max); for (const k of ev) await idbDel(store, k); }
      try { localStorage.setItem(idxKey, JSON.stringify(a)); } catch {}
    } catch {}
  };
  const idbClearAll = async () => {
    try { const db = await idb(); for (const s of ['list', 'detail']) await new Promise((res, rej) => { const q = db.transaction(s, 'readwrite').objectStore(s).clear(); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); } catch {}
    try { localStorage.removeItem('atsv2:listidx'); localStorage.removeItem('atsv2:detidx'); } catch {}
    for (let i = localStorage.length - 1; i >= 0; i--) { try { const k = localStorage.key(i); if (k && k.indexOf('atsv2:wil:') === 0) localStorage.removeItem(k); } catch {} }
  };
  const noteHit = (t) => { state.cache.hit++; if (t && (!state.cache.oldest || t < state.cache.oldest)) state.cache.oldest = t; };
  // Filter jenjang (basis: ref/jenjang + ref/bentuk-pendidikan + sampel detail; bentuk lowercase).
  // SMA = bentuk sma | SMK = bentuk smk | SLB = grup {slb,sdlb,smplb,smlb} + fallback nama.
  const SLB_GROUP = ['slb', 'sdlb', 'smplb', 'smlb'];
  const _unknownBentuk = new Set();
  const detOf = x => x._det || {};
  const matchJj = (x) => {
    const on = state.jj;
    if (!on.sma && !on.smk && !on.slb) return true;
    const d = detOf(x);
    if (!d.bentuk && !d.nama) return false;
    const b = (d.bentuk || '').toLowerCase();
    const nm = (d.nama || '').toUpperCase();
    if (on.sma && (b === 'sma' || (b === '' && /\bSMA\b/.test(nm) && !/SMK/.test(nm)))) return true;
    if (on.smk && (b === 'smk' || (b === '' && /SMK/.test(nm)))) return true;
    if (on.slb && (SLB_GROUP.includes(b) || (b === '' && /S?LB/.test(nm)))) return true;
    if (b && !['sma', 'smk', ...SLB_GROUP].includes(b) && !_unknownBentuk.has(b)) { _unknownBentuk.add(b); console.warn('[ATS] bentuk tak dikenal:', b, nm); }
    return false;
  };
  const jjActive = () => state.jj.sma || state.jj.smk || state.jj.slb;
  const KABUPATEN = [{"kode_wilayah":"240600","nama":"Kab. Alor"},{"kode_wilayah":"240500","nama":"Kab. Belu"},{"kode_wilayah":"240900","nama":"Kab. Ende"},{"kode_wilayah":"240700","nama":"Kab. Flores Timur"},{"kode_wilayah":"240100","nama":"Kab. Kupang"},{"kode_wilayah":"241400","nama":"Kab. Lembata"},{"kode_wilayah":"242200","nama":"Kab. Malaka"},{"kode_wilayah":"241100","nama":"Kab. Manggarai"},{"kode_wilayah":"241600","nama":"Kab. Manggarai Barat"},{"kode_wilayah":"242000","nama":"Kab. Manggarai Timur"},{"kode_wilayah":"241700","nama":"Kab. Nagekeo"},{"kode_wilayah":"241000","nama":"Kab. Ngada"},{"kode_wilayah":"241500","nama":"Kab. Rote Ndao"},{"kode_wilayah":"242100","nama":"Kab. Sabu Raijua"},{"kode_wilayah":"240800","nama":"Kab. Sikka"},{"kode_wilayah":"241300","nama":"Kab. Sumba Barat"},{"kode_wilayah":"241900","nama":"Kab. Sumba Barat Daya"},{"kode_wilayah":"241800","nama":"Kab. Sumba Tengah"},{"kode_wilayah":"241200","nama":"Kab. Sumba Timur"},{"kode_wilayah":"240300","nama":"Kab. Timor Tengah Selatan"},{"kode_wilayah":"240400","nama":"Kab. Timor Tengah Utara"},{"kode_wilayah":"246000","nama":"Kota Kupang"}];
  const wilCache = new Map();
  const loadWilayah = async (parent) => {
    if (wilCache.has(parent)) return wilCache.get(parent);
    const ck = lsGet('atsv2:wil:' + parent);
    if (ck) { wilCache.set(parent, ck.v); return ck.v; }
    const res = await fetch(`/ats-v2/api/v1/publik/referensi/wilayah?parent=${encodeURIComponent(parent)}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('wilayah HTTP ' + res.status);
    const j = await res.json();
    const d = (j && j.data) || [];
    wilCache.set(parent, d); lsSet('atsv2:wil:' + parent, d);
    return d;
  };
  const activeKode = () => {
    const dv = document.querySelector('#__atsdash #__desa')?.value || '';
    if (dv) return dv;
    const kv = document.querySelector('#__atsdash #__kec')?.value || '';
    if (kv) return kv;
    return document.querySelector('#__atsdash #__kab')?.value || CONFIG.KODE_WILAYAH;
  };

  const css = `#__atsdash{position:fixed;inset:0;z-index:999999;background:#0d1117;color:#e6eddf;font:13px 'Segoe UI',Arial;display:flex;flex-direction:column}
  #__atsdash .hd{display:flex;gap:8px;align-items:center;padding:10px 14px;background:#161b22;border-bottom:1px solid #30363d;flex-wrap:wrap}
  #__atsdash .hd b{color:#58a6ff} #__atsdash .hd .sp{flex:1}
  #__atsdash input,#__atsdash select{background:#0d1117;border:1px solid #30363d;color:#e6eddf;border-radius:6px;padding:6px 8px;font:inherit}
  #__atsdash button{background:#21262d;border:1px solid #30363d;color:#e6eddf;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit}
  #__atsdash button.go{background:#238636;border-color:#238636;color:#fff;font-weight:700}
  #__atsdash table{width:100%;border-collapse:collapse;font-size:12px} #__atsdash th,#__atsdash td{border-bottom:1px solid #21262d;padding:6px 8px;text-align:left;white-space:nowrap}
  #__atsdash th{position:sticky;top:0;background:#161b22;color:#58a6ff} #__atsdash .wrap{flex:1;overflow:auto;padding:0 14px}
  #__atsdash .bar{display:flex;gap:8px;padding:10px 14px;align-items:center;flex-wrap:wrap;border-top:1px solid #30363d}
  #__atsdash .modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:1000000}
  #__atsdash .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px;max-width:640px;width:92%;max-height:84vh;overflow:auto}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = '__atsdash';
  root.innerHTML = `<div class="hd"><b>ATS Dashboard v2</b><span id="__st">siap</span><span class="sp"></span>
    <input id="__q" placeholder="cari nama/nik/nisn/desa..." style="width:260px">
    <select id="__kat"><option value="">semua kategori</option><option value="bpb">bpb</option><option value="do">do</option><option value="ltm">ltm</option></select>
    <select id="__stat"><option value="">semua status</option><option value="belum">belum</option><option value="ats">ats</option></select>
    <select id="__sort"><option value="nama">sort nama</option><option value="usia">sort usia</option><option value="desa">sort desa</option></select>
    <label title="Filter jenjang via detail sekolah"><input type="checkbox" id="__jsma"> SMA</label>
    <label title="Filter jenjang via detail sekolah"><input type="checkbox" id="__jsmk"> SMK</label>
    <label title="SLB/SDLB/SMPLB/SMLB via detail sekolah"><input type="checkbox" id="__jslb"> SLB</label>
    <button id="__det" title="Fetch detail-anak untuk baris yang sudah dimuat (wajib untuk filter SMA/SMK/SLB)">Detail++</button>
    <select id="__kab"><option value="240000">Prov. NTT (semua)</option></select>
    <select id="__kec" disabled><option value="">semua kecamatan</option></select>
    <select id="__desa" disabled><option value="">semua desa</option></select>
    <button id="__load" class="go">Muat</button><button id="__more">+20 pg</button><button id="__all" title="Muat seluruh total sekaligus (bisa lama untuk provinsi)">Muat semua</button><button id="__stop">Stop</button>
    <button id="__refresh" title="Muat ulang tanpa cache (TTL 7 hari diabaikan)">Segarkan</button><button id="__clear" title="Hapus seluruh cache tersimpan (disarankan berkala: data PII)">Hapus cache</button>
    <button id="__csv">CSV</button><button id="__close">Tutup</button></div>
    <div class="wrap"><table><thead><tr><th>#</th><th>Nama</th><th>L/P</th><th>Usia</th><th>Kat</th><th>Status</th><th>Desa</th><th>KodeWil</th><th>NISN</th><th>Ibu</th><th>Domisili</th><th>Sekolah</th><th>Aksi</th></tr></thead><tbody id="__tb"></tbody></table></div>
    <div class="bar"><span id="__info">0 baris</span></div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector(id);
  const setSt = t => { $('#__st').textContent = t; };
  const filtered = () => {
    const q = state.q.toLowerCase();
    let r = state.rows.filter(x => {
      const d = detOf(x);
      const hay = (x.nama + ' ' + x.nik + ' ' + x.nisn + ' ' + x.desa + ' ' + (d.ibu || '') + ' ' + (d.ayah || '') + ' ' + (d.alamat || '') + ' ' + (d.d_kec || '') + ' ' + (d.d_kab || '')).toLowerCase();
      return (!state.kat || x.kategori === state.kat) && (!state.stat || x.status_verifikasi === state.stat) &&
        matchJj(x) && (!q || hay.includes(q));
    });
    if (state.sort === 'nama') r.sort((a, b) => a.nama.localeCompare(b.nama));
    if (state.sort === 'usia') r.sort((a, b) => (a.usia || 0) - (b.usia || 0));
    if (state.sort === 'desa') r.sort((a, b) => (a.desa || '').localeCompare(b.desa || ''));
    return r;
  };
  const render = () => {
    const r = filtered().slice(0, 2000);
    const detMissing = state.rows.filter(x => !x._det).length;
    $('#__tb').innerHTML = r.map((x, i) => { const d = detOf(x); const dom = [d.alamat, d.d_desa, d.d_kec].filter(Boolean).join(', '); return `<tr><td>${i + 1}</td><td>${x.nama || ''}</td><td>${x.jenis_kelamin || ''}</td><td>${x.usia ?? ''}</td><td>${x.kategori || ''}</td><td>${x.status_verifikasi || ''}</td><td>${x.desa || ''}</td><td>${x.kode_wilayah || ''}</td><td>${x.nisn || ''}</td><td>${d.ibu || ''}</td><td>${dom}</td><td>${d.bentuk ? d.bentuk + ' - ' + (d.nama || '') : (d.nama || '')}</td><td><button data-id="${x.ats_id}">Detail</button></td></tr>`; }).join('');
    $('#__info').textContent = `${r.length} tampil / ${state.rows.length} dimuat / total ${state.total} (page ${state.page})` + (detMissing ? ` | butuh detail: ${detMissing} (klik Detail++)` : '') + (_unknownBentuk.size ? ` | bentuk asing: ${[..._unknownBentuk].join(',')} (cek console)` : '') + ` | cache H${state.cache.hit}/M${state.cache.miss}` + (state.cache.oldest ? ` tertua ${ageDays(state.cache.oldest)}` : '');
    $('#__tb').querySelectorAll('button').forEach(b => b.onclick = () => showDetail(b.dataset.id));
  };
  let detConc = CONFIG.DET_CONC_MAX, okStreak = 0, wafUntil = 0, wafHits = 0;
  const isWafBody = (txt, ct) => /text\/html/i.test(ct || '') || /Akses Ditolak|SUPPORT ID|sl-waf-script|_sl_waf|safeline/i.test((txt || '').slice(0, 3000));
  const waitWaf = async () => { while (Date.now() < wafUntil) { const s = Math.ceil((wafUntil - Date.now()) / 1000); setSt(`diblok WAF — jeda ${s}s (data aman, lanjut otomatis)`); await sleep(Math.min(1000, wafUntil - Date.now())); } };
  async function fetchJSON(url, retries = 6) {
    let lastErr = null;
    for (let a = 0; ; a++) {
      await waitWaf();
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN } });
      const txt = await res.text();
      const ct = res.headers.get('content-type') || '';
      if (res.status === 401) throw new Error('401: login ulang');
      if (res.status === 429 || res.status === 468 || res.status >= 500 || isWafBody(txt, ct)) {
        wafHits++;
        detConc = Math.max(1, Math.floor(detConc / 2)); okStreak = 0;
        const ra = parseFloat(res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset') || '0');
        const cool = Math.min((isNaN(ra) || !ra ? 15 : ra) * (isWafBody(txt, ct) ? 1000 : 1000) * Math.pow(1.6, Math.min(wafHits, 4)), 180000);
        wafUntil = Math.max(wafUntil, Date.now() + cool);
        lastErr = new Error(isWafBody(txt, ct) ? 'WAF: permintaan detail diblok sementara' : 'HTTP ' + res.status);
        await waitWaf();
        if (a >= retries) throw lastErr;
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (!txt.trim()) {
        lastErr = new Error('respon kosong');
        await sleep(Math.min(1000 + Math.random() * 1000 + a * 800, 10000));
        if (a >= retries) throw lastErr;
        continue;
      }
      try {
        const j = JSON.parse(txt);
        okStreak++; wafHits = 0;
        if (okStreak >= 25 && detConc < CONFIG.DET_CONC_MAX) { detConc++; okStreak = 0; }
        return j;
      } catch (e) {
        lastErr = new Error('JSON rusak');
        await sleep(Math.min(1000 + Math.random() * 1000 + a * 800, 10000));
        if (a >= retries) throw lastErr;
      }
    }
  }
  async function ensureDetails() {
    const need = state.rows.filter(x => !x._det).slice(0, CONFIG.DET_CAP);
    if (!need.length) { render(); return; }
    if (state.loading) return; state.loading = true; state.stop = false;
    let i = 0, done = 0, fail = 0, wafStop = false;
    setSt(`detail 0/${need.length}...`);
    const flatOf = (j) => { const v = (j || {}).data || {}, s = (v.pendidikan || {}).sekolah_terakhir || {}, idn = v.identitas || {}, w = v.wilayah || {}; return { bentuk: (s.bentuk || '').toLowerCase(), jenjang: (s.jenjang || '').toLowerCase(), nama: s.nama || '', tingkat: s.tingkat || '', ibu: idn.nama_ibu || '', ayah: idn.nama_ayah || '', alamat: idn.alamat_jalan || '', rt: idn.rt ?? '', rw: idn.rw ?? '', lintang: idn.lintang ?? '', bujur: idn.bujur ?? '', d_desa: w.desa || '', d_kec: w.kecamatan || '', d_kab: w.kabupaten || '', d_prov: w.provinsi || '' }; };
    const worker = async () => {
      while (i < need.length && !state.stop && !wafStop) {
        const x = need[i++];
        const hit = await idbRec('detail', x.ats_id);
        if (hit) { x._det = flatOf(hit.v); noteHit(hit.t); }
        else {
          try {
            const j = await fetchJSON(`/ats-v2/api/v1/verifikasi/detail-anak/${encodeURIComponent(x.ats_id)}`);
            x._det = flatOf(j); state.cache.miss++; fail = 0;
            await idbSetCap('detail', x.ats_id, j, CONFIG.DET_MAX, 'atsv2:detidx');
          } catch (e) {
            const m = String(e && e.message || e);
            fail++;   // jangan set _det: biar bisa dicoba lagi nanti
            if (/WAF/i.test(m) && fail >= 5) { wafStop = true; state.stop = true; }
          }
          await sleep(CONFIG.DET_DELAY);
        }
        done++;
        if (done % 10 === 0 || done === need.length) { setSt(`detail ${done}/${need.length} (gagal ${state.rows.filter(r => !r._det).length})...`); render(); }
      }
    };
    await Promise.all(Array(Math.min(detConc, need.length)).fill(0).map(worker));
    state.loading = false;
    const left = state.rows.filter(r => !r._det).length;
    setSt(wafStop ? `detail dihentikan WAF: ${done}/${need.length}, ${left} belum terisi. Tunggu beberapa menit lalu klik Detail++.` : `detail selesai ${done}/${need.length}${left ? ', ' + left + ' gagal (bisa ulang)' : ''}${need.length >= CONFIG.DET_CAP ? ' (cap ' + CONFIG.DET_CAP + ')' : ''}.`);
    render();
  }
  async function loadPages(n) {
    if (state.loading) return; state.loading = true; state.stop = false;
    const wil = activeKode();
    const skip = state.skipCache; state.skipCache = false;
    try {
      for (let i = 0; i < n && !state.stop; i++) {
        const p = state.page + 1;
        const lk = `${wil}:${p}:${CONFIG.PER_PAGE}`;
        let j = null;
        if (!skip) { const rec = await idbRec('list', lk); if (rec) { j = rec.v; noteHit(rec.t); } }
        if (!j) {
          setSt(`page ${p}...`);
          state.cache.miss++;
          j = await fetchJSON(`/ats-v2/api/v1/verifikasi/siswa?kode_wilayah=${encodeURIComponent(wil)}&page=${p}&per_page=${CONFIG.PER_PAGE}`);
          await idbSetCap('list', lk, j, CONFIG.LIST_MAX, 'atsv2:listidx');
          await sleep(CONFIG.DELAY);
        }
        state.total = (j.meta && j.meta.total) || state.total;
        if (!j.data || !j.data.length) break;
        state.rows.push(...j.data); state.page = p;
        render();
        if (j.data.length < CONFIG.PER_PAGE) break;
        if (state.total && state.page * CONFIG.PER_PAGE >= state.total) break;
      }
      setSt(`selesai p${state.page} (${state.rows.length}/${state.total})`);
    } catch (e) { setSt('error: ' + e.message); }
    state.loading = false;
    if (!state.stop && state.rows.some(x => !x._det)) await ensureDetails();
  }
  async function showDetail(atsId) {
    setSt('detail ' + atsId.slice(0, 8) + '...');
    try {
      let j = null;
      const hit = await idbRec('detail', atsId);
      if (hit && hit.v && hit.v.data) { j = hit.v; noteHit(hit.t); }
      else {
        j = await fetchJSON(`/ats-v2/api/v1/verifikasi/detail-anak/${encodeURIComponent(atsId)}`);
        await idbSetCap('detail', atsId, j, CONFIG.DET_MAX, 'atsv2:detidx');
      }
      const d = j.data || {}, id = d.identitas || {}, w = d.wilayah || {}, p = d.pendidikan || {}, rg = d.registrasi || {};
      const st0 = p.sekolah_terakhir || {};
      const row = state.rows.find(x => x.ats_id === atsId);
      if (row) row._det = flatOf(j);
      const m = document.createElement('div'); m.className = 'modal';
      m.innerHTML = `<div class="card"><b>${id.nama || atsId}</b> (${id.jenis_kelamin || ''}, ${id.usia ?? ''} th)<br>
        NIK: ${id.nik || ''} | NISN: ${id.nisn || ''}<br>Lahir: ${id.tempat_lahir || ''}, ${id.tanggal_lahir || ''}<br>
        Sekolah: ${(p.sekolah_terakhir || {}).nama || ''} (${(p.sekolah_terakhir || {}).npsn || ''}) | Kat: ${p.kategori || ''} | Verif: ${rg.status_verifikasi || ''}<br>
        <br><b>Keluarga dan domisili</b><br>
        Nama ibu kandung: ${id.nama_ibu || '-'}<br>Nama ayah: ${id.nama_ayah || '-'}<br>
        Alamat: ${id.alamat_jalan || '-'} RT${id.rt ?? '-'}/RW${id.rw ?? '-'}<br>
        Desa/kelurahan: ${w.desa || '-'}<br>Kecamatan: ${w.kecamatan || '-'}<br>
        Kabupaten/kota: ${w.kabupaten || '-'}<br>Provinsi: ${w.provinsi || '-'}<br>
        Masalah: ${(d.permasalahan || []).map(x => x.jenis_permasalahan).join(' | ') || '-'}<br><br>
        <button id="__mclose">Tutup</button></div>`;
      m.querySelector('#__mclose').onclick = () => m.remove();
      m.onclick = e => { if (e.target === m) m.remove(); };
      root.appendChild(m); setSt('siap');
    } catch (e) { setSt('detail gagal: ' + e.message); }
  }
  const fillSel = (sel, items, firstLabel) => {
    sel.innerHTML = `<option value="">${firstLabel}</option>` + items.map(x => `<option value="${x.kode_wilayah}">${x.nama}</option>`).join('');
    sel.disabled = !items.length;
  };
  const resetData = () => { state.rows = []; state.page = 0; state.total = 0; state.cache.hit = 0; state.cache.miss = 0; state.cache.oldest = 0; render(); };
  for (const k of KABUPATEN) { const o = document.createElement('option'); o.value = k.kode_wilayah; o.textContent = k.nama; $('#__kab').appendChild(o); }
  $('#__kab').onchange = async e => {
    const kab = e.target.value || '240000';
    fillSel($('#__kec'), [], 'semua kecamatan'); fillSel($('#__desa'), [], 'semua desa'); resetData();
    if (kab === '240000') { setSt('provinsi dipilih. Klik Muat.'); return; }
    setSt('memuat kecamatan ' + kab + '...');
    try { fillSel($('#__kec'), await loadWilayah(kab), 'semua kecamatan'); setSt('kecamatan dimuat. Pilih lalu Muat.'); }
    catch (err) { setSt('kecamatan gagal: ' + err.message); }
  };
  $('#__kec').onchange = async e => {
    const kec = e.target.value || '';
    fillSel($('#__desa'), [], 'semua desa'); resetData();
    if (!kec) { setSt('siap. Klik Muat.'); return; }
    setSt('memuat desa ' + kec + '...');
    try { fillSel($('#__desa'), await loadWilayah(kec), 'semua desa'); setSt('desa dimuat. Pilih lalu Muat.'); }
    catch (err) { setSt('desa gagal: ' + err.message); }
  };
  $('#__desa').onchange = () => resetData();
  const onJj = () => {
    state.jj.sma = $('#__jsma').checked; state.jj.smk = $('#__jsmk').checked; state.jj.slb = $('#__jslb').checked;
    render();
    if (jjActive() && state.rows.some(x => !x._det)) ensureDetails();
  };
  $('#__jsma').onchange = onJj; $('#__jsmk').onchange = onJj; $('#__jslb').onchange = onJj;
  $('#__det').onclick = () => ensureDetails();
  $('#__q').oninput = e => { state.q = e.target.value; render(); };
  $('#__kat').onchange = e => { state.kat = e.target.value; render(); };
  $('#__stat').onchange = e => { state.stat = e.target.value; render(); };
  $('#__sort').onchange = e => { state.sort = e.target.value; render(); };
  $('#__load').onclick = () => { state.rows = []; state.page = 0; state.total = 0; state.cache.hit = 0; state.cache.miss = 0; state.cache.oldest = 0; loadPages(CONFIG.MAX_AUTO_PAGES); };
  $('#__more').onclick = () => loadPages(20);
  $('#__all').onclick = () => { const need = state.total ? Math.ceil(state.total / CONFIG.PER_PAGE) - state.page : 20000; setSt(`muat semua (${need} page)...`); loadPages(Math.max(need, 0)); };
  $('#__stop').onclick = () => { state.stop = true; };
  $('#__refresh').onclick = () => { const n = state.page || CONFIG.MAX_AUTO_PAGES; state.rows = []; state.page = 0; state.total = 0; state.skipCache = true; setSt('segarkan: muat ulang tanpa cache...'); loadPages(n); };
  $('#__clear').onclick = async () => { setSt('menghapus cache...'); await idbClearAll(); state.cache.hit = 0; state.cache.miss = 0; state.cache.oldest = 0; setSt('cache dihapus. Klik Muat.'); render(); };
  $('#__close').onclick = () => root.remove();
  $('#__csv').onclick = () => {
    const r = filtered().map(x => { const d = detOf(x); const o = { ...x }; delete o._det; if (d.bentuk || d.nama || d.ibu || d.alamat) { o.d_bentuk = d.bentuk || ''; o.d_jenjang = d.jenjang || ''; o.d_sekolah = d.nama || ''; o.d_tingkat = d.tingkat || ''; o.d_ibu = d.ibu || ''; o.d_ayah = d.ayah || ''; o.d_alamat = d.alamat || ''; o.d_rt = d.rt ?? ''; o.d_rw = d.rw ?? ''; o.d_lintang = d.lintang ?? ''; o.d_bujur = d.bujur ?? ''; o.d_desa = d.d_desa || ''; o.d_kec = d.d_kec || ''; o.d_kab = d.d_kab || ''; o.d_prov = d.d_prov || ''; } return o; });
    if (!r.length) return;
    const cols = Object.keys(r[0]);
    const out = [cols.join(',')].concat(r.map(x => cols.map(c => csvEsc(x[c])).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'text/csv' }));
    a.download = `ats-dashboard-${activeKode()}.csv`; a.click();
  };
  if (!location.pathname.includes('/hasil-verifikasi/progres')) setSt('peringatan: tempel script ini di halaman /hasil-verifikasi/progres. Siap. Klik Muat (20 page awal).');
  else setSt('siap. Klik Muat (20 page awal).');
})();
