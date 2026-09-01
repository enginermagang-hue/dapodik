(async () => {
  const URL_REKAP = 'https://datadik.kemendikdasmen.go.id/ma74/rekapsp';
  const URL_REF = 'https://datadik.kemendikdasmen.go.id/refsp/q/B0C3969D-F031-43FD-888F-7C6A280ABBBA';
  const URL_PD = id => `https://datadik.kemendikdasmen.go.id/ma74/sekolahpd/${id}/`;
  const URL_DET = (pd_id, sekolah_id) => `https://datadik.kemendikdasmen.go.id/manage/detailpd/${pd_id}/${sekolah_id}`;
const RETRIES = 3;
const DELAY_PAGE_MS = 0;
const CONCURRENCY = 12;
const SCHOOL_CONCURRENCY = 3;
const PAGE_PREFETCH = 3;
const PAGE_SOFT_EAGER = 2;
const PF_CONC = 6;

  const setTitle = t => { try { document.title = t; } catch (e) {} };
  const slug = s => String(s).replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_').slice(0, 80);
  const pad = (n) => String(n).padStart(2, '0');
  const ts = () => `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:${pad(new Date().getSeconds())}`;
  const notes = [];
  const note = (...a) => {
    notes.push(`[${ts()}] ${a.join(' ')}`);
    if (notes.length > 60) notes.shift();
  };
  const banner = () => {
    console.log('%c━━━ FETCH PD DAPODIK V2 ━━━', 'color:#0af;font-weight:bold;font-size:14px');
    console.log('  • kontrol:    window._fetch.pause() / .resume() / .stop()');
    console.log('  • status:     window._fetch.stats()');
    console.log('  • csv cepat:   window._fetch.download()');
    console.log('  • pilih siswa via checkbox di overlay');
    console.log(`  • delay:      sekolah 0 page ${DELAY_PAGE_MS} ms (jitter hanya saat WAF), paralel=${SCHOOL_CONCURRENCY}`);
    console.log('  • filter:     hanya SISWA AKTIF + rombel & tingkat terisi');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━', 'color:#0af');
  };

  const cleanFetch = (() => {
    let ifetch;
    const ready = new Promise(resolve => {
      const f = document.createElement('iframe');
      f.style.display = 'none';
      f.src = location.origin + '/manage';
      f.onload = () => {
        try { ifetch = f.contentWindow.fetch.bind(f.contentWindow); resolve(); }
        catch (e) { note('iframe init gagal:', String(e)); resolve(); }
      };
      document.body.appendChild(f);
    });
    return async (...args) => { await ready; return ifetch(...args); };
  })();

  const ctrl = { paused: false, stopped: false, schoolConc: SCHOOL_CONCURRENCY, targetConc: SCHOOL_CONCURRENCY };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pauseWhile = async () => { while (ctrl.paused) await sleep(200); };
  const wafHits = [];
  const wafHit = () => {
    const now = Date.now();
    wafHits.push(now);
    while (wafHits.length && now - wafHits[0] > 30000) wafHits.shift();
    if (wafHits.length >= 3 && ctrl.schoolConc > 1) {
      ctrl.schoolConc = 1;
      note('WAF berulang (3x/30dtk) — paralel turun ke 1. Akan naik lagi setelah 2 menit bersih.');
    }
  };
  const wafWatchdog = setInterval(() => {
    const now = Date.now();
    if (ctrl.schoolConc === 1 && (!wafHits.length || now - wafHits[wafHits.length - 1] > 120000)) {
      ctrl.schoolConc = ctrl.targetConc;
      note('WAF bersih 2 menit — paralel kembali ke', ctrl.targetConc);
    }
  }, 30000);

  const isChallenge = (res, body) => {
    if (res && res.status === 468) return true;
    if (body && /sl-waf-script|sl_verify|_sl_waf|safeline[-_ ]?challenge/i.test(body.slice(0, 4000))) return true;
    return false;
  };
  const isBlock = (res, body) => {
    if (!res) return false;
    if (res.status === 468) return false;
    if (res.status === 429) return true;
    if (/^4\d\d$/.test(String(res.status)) && body && /SafeLine|\.safeline\/|Access Forbidden|slg-title/i.test(body.slice(0, 2000))) return true;
    return false;
  };
  const waitForWAF = async (ctx) => {
    wafHit();
    note('WAF/SafeLine terdeteksi saat:', ctx);
    setTitle('[WAF] selesaikan validasi SafeLine di halaman...');
    while (true) {
      const ok = prompt('Validasi SafeLine/WAF muncul di halaman? Selesaikan dulu (challenge), lalu klik OK untuk lanjut. (Klik Cancel untuk berhenti)');
      if (ok === null) throw new Error('dihentikan user (WAF)');
      try {
        const r = await cleanFetch('https://datadik.kemendikdasmen.go.id/manage', {
          method: 'GET', credentials: 'include', signal: AbortSignal.timeout(15000)
        });
        const t = await r.text();
        if (!isChallenge(r, t)) { note('WAF selesai, lanjut...'); return; }
      } catch (e) { note('probe WAF gagal:', String(e)); }
      note('WAF masih aktif, ulangi validasi...');
    }
  };

  const withRetry = async (url, opts) => {
    let tries = 0;
    while (true) {
      try {
        const res = await cleanFetch(url, opts);
        const text = await res.text();
        if (isChallenge(res, text)) {
          await waitForWAF(url);
          tries = 0;
          continue;
        }
        if (isBlock(res, text)) {
          const waitMs = Math.min(60000, 5000 * (2 ** tries)) + Math.random() * 2000;
          note(`⏳ diblokir SafeLine (${res.status}) ${url} — tunggu ${Math.round(waitMs / 1000)}s`);
          if (ctrl.schoolConc > 1) ctrl.schoolConc = 1;
          await sleep(waitMs);
          tries++;
          if (tries > 6) return { ok: false, error: 'HTTP ' + res.status };
          continue;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return { ok: true, data: JSON.parse(text) };
      } catch (e) {
        if (/dihentikan user/.test(String(e))) return { ok: false, error: String(e), wafAbort: true };
        if (tries >= RETRIES - 1) return { ok: false, error: String(e) };
        tries++;
        await new Promise(s => setTimeout(s, 2000 * tries));
      }
    }
  };

  const postForm = (url, form) => withRetry(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(30000)
  });
  const getJson = url => withRetry(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });

  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const titleCase = s => norm(s).replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());

  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const parseDetText = (text) => {
    try {
      const cleaned = text
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');

      const linkRe = /<(a|button)\b[^>]*?(?:href|data-target)\s*=\s*["'](#?)([^"'\s>]+)["'][^>]*>([\s\S]*?)<\/\1>|<li\b[^>]*class\s*=\s*["'][^"']*\b(active)?\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
      const tabLabels = new Map();
      let m;
      while ((m = linkRe.exec(cleaned)) !== null) {
        const id = m[3];
        const inner = m[4] || m[6] || '';
        const label = titleCase(stripTags(inner));
        if (id && label) tabLabels.set(id, label);
      }

      const paneRe = /<div\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*\bclass\s*=\s*["']([^"']*\btab-pane\b[^"']*)["'][^>]*>([\s\S]*?)<\/div>\s*(?=<(?:div|section)\b[^>]*\bid\s*=|$)/gi;
      const panes = [];
      while ((m = paneRe.exec(cleaned)) !== null) {
        const id = m[1], body = m[3];
        panes.push({ id, label: tabLabels.get(id) || titleCase(id), body });
      }

      const det = {};
      const collect = (body, target) => {
        let parent = null;
        const setv = (k, v) => {
          if (parent) {
            target[parent] = target[parent] || {};
            target[parent][k] = v;
          } else target[k] = v;
        };
        const dtRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
        while ((m = dtRe.exec(body)) !== null) {
          const label = norm(stripTags(m[1]));
          const val = norm(stripTags(m[2]));
          if (!label) continue;
          if (/^(ayah|ibu kandung|wali)/i.test(label) && (!val || val === ':')) {
            parent = titleCase(label.replace(/:.*$/, ''));
            continue;
          }
          setv(label, val);
        }
        const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
        while ((m = trRe.exec(body)) !== null) {
          const row = m[1];
          const cells = [];
          const cellRe = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
          let cm;
          while ((cm = cellRe.exec(row)) !== null) cells.push(norm(stripTags(cm[2])));
          const th = cells.filter((_, i) => /<th[\s\S]*?<\/th>/i.test(row) && i < cells.length);
          const all = cells;
          if (all.length && all.length % 2 === 0 && all.every(Boolean)) {
            for (let i = 0; i < all.length; i += 2) setv(all[i], all[i + 1]);
          }
        }
      };

      if (panes.length) {
        for (const p of panes) { det[p.label] = det[p.label] || {}; collect(p.body, det[p.label]); }
      } else {
        det['Detail'] = det['Detail'] || {};
        collect(cleaned, det['Detail']);
      }

      const hasAny = Object.values(det).some(v => v && typeof v === 'object' && Object.keys(v).length);
      return hasAny ? det : null;
    } catch (e) {
      return null;
    }
  };

  const parseDet = (root) => {
    const det = {};
    const collect = (el, target) => {
      let parent = null;
      const setv = (k, v) => {
        if (parent) {
          target[parent] = target[parent] || {};
          target[parent][k] = v;
        } else target[k] = v;
      };
      el.querySelectorAll('dt').forEach(dt => {
        const label = norm(dt.textContent);
        const dd = dt.nextElementSibling;
        const val = dd ? norm(dd.textContent) : '';
        if (!label) return;
        if (/^(ayah|ibu kandung|wali)/i.test(label) && (!val || val === ':')) {
          parent = titleCase(label.replace(/:.*$/, ''));
          return;
        }
        setv(label, val);
      });
      el.querySelectorAll('table').forEach(tbl => {
        [...tbl.querySelectorAll('tr')].forEach(tr => {
          const th = [...tr.querySelectorAll('th')].map(norm);
          const td = [...tr.querySelectorAll('td')].map(norm);
          if (th.length && th.length === td.length) th.forEach((k, i) => setv(k, td[i]));
          else if (!th.length && td.length === 2) setv(td[0], td[1]);
        });
      });
    };
    const panes = [...root.querySelectorAll('.tab-pane,[role="tabpanel"]')];
    if (panes.length) {
      const links = [...root.querySelectorAll('a[data-toggle="tab"],a[role="tab"],button[data-bs-toggle="pill"],a[href^="#"]')];
      for (const pane of panes) {
        const id = pane.id;
        const link = links.find(l => {
          const href = l.getAttribute('href') || '';
          const dt = l.getAttribute('data-target') || '';
          return href === '#' + id || dt === '#' + id || dt === id;
        });
        const label = link ? titleCase(norm(link.textContent)) : 'Detail';
        det[label] = det[label] || {};
        collect(pane, det[label]);
      }
    } else {
      det['Detail'] = det['Detail'] || {};
      collect(root, det['Detail']);
    }
    return det;
  };

  const fetchDetail = async (PD_id, sekolah_id) => {
    try {
      const res = await cleanFetch(URL_DET(PD_id, sekolah_id), {
        method: 'GET',
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(10000)
      });
      const text = await res.text();
      if (isChallenge(res, text)) {
        await waitForWAF(PD_id);
        const r2 = await cleanFetch(URL_DET(PD_id, sekolah_id), {
          method: 'GET',
          headers: { 'Accept': 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(10000)
        });
        const t2 = await r2.text();
        if (isChallenge(r2, t2)) return { ok: false, error: 'WAF after retry', wafAbort: true };
        if (isBlock(r2, t2)) return { ok: false, status: r2.status, error: 'blocked' };
        if (!r2.ok) return { ok: false, status: r2.status, raw: t2.slice(0, 200) };
        let det2 = parseDetText(t2);
        if (!det2) det2 = parseDet(new DOMParser().parseFromString(t2, 'text/html'));
        return { ok: true, det: det2 };
      }
      if (isBlock(res, text)) {
        note(`⏳ diblokir SafeLine (${res.status}) detailpd`);
        if (ctrl.schoolConc > 1) ctrl.schoolConc = 1;
        return { ok: false, status: res.status, error: 'blocked' };
      }
      if (!res.ok) return { ok: false, status: res.status, raw: text.slice(0, 200) };
      let det = parseDetText(text);
      if (!det) det = parseDet(new DOMParser().parseFromString(text, 'text/html'));
      return { ok: true, det };
    } catch (e) {
      if (/dihentikan user/.test(String(e))) return { ok: false, error: String(e), wafAbort: true };
      return { ok: false, error: String(e) };
    }
  };
  const getPath = (obj, path) => {
    let v = obj;
    for (const k of path) {
      if (!v || typeof v !== 'object') return '';
      v = v[k];
    }
    return v == null || v === '' ? '' : String(v);
  };
  const klsOf = pd => {
    const fields = [pd.tingkat, pd.nama_tingkat, pd.tingkat_pendidikan, pd.kelas, pd.rombel];
    for (const f of fields) {
      if (f == null || f === '') continue;
      const raw = norm(f).toUpperCase();
      if (!raw) continue;
      const m = raw.match(/\bXII\b|\bXI\b|\bX\b/);
      if (m) {
        if (m[0] === 'XII') return 12;
        if (m[0] === 'XI') return 11;
        return 10;
      }
      const d = raw.match(/\d{1,2}/);
      if (d) {
        const n = parseInt(d[0], 10);
        if (n >= 10 && n <= 12) return n;
      }
    }
    return null;
  };

  const STATUS_FIELD_CANDIDATES = ['keadaan_keluar', 'id_keadaan_keluar', 'status', 'status_data', 'status_pd', 'aktif', 'is_aktif'];
  const NON_AKTIF_LABEL = /(lulus|keluar|pindah|mutasi|drop[\s-]?out|putus|wafat|meninggal|alih|tidak\s*aktif|non[\s-]?aktif)/i;
  const isBlank = v => v == null || norm(v) === '';
  let statusField = null;
  const detectStatusField = (pd) => {
    if (statusField !== null) return;
    const keys = Object.keys(pd || {}).map(k => k.toLowerCase());
    const hit = STATUS_FIELD_CANDIDATES.find(c => keys.includes(c));
    statusField = hit || '';
    if (hit) note('auto-detect field status aktif:', hit, '=', JSON.stringify(pd[hit]));
    else note('⚠ field status aktif tak ditemukan — filter aktif dilewati (semua dianggap aktif).');
  };
  const isActive = (pd) => {
    if (!statusField) return true;
    const v = pd[statusField];
    if (isBlank(v)) return true;
    const s = norm(v);
    if (NON_AKTIF_LABEL.test(s)) return false;
    if (/^\d+$/.test(s) && ['2', '3', '4', '5', '6', '8', '9'].includes(s)) return false;
    return true;
  };
  const rombelTingkatTerisi = (pd) => !isBlank(pd.rombel) && !isBlank(pd.tingkat);

  const detailCache = new Map();
  const pageCache = new Map();
  let nPrefetched = 0;
  const prefetchFlag = { running: false };
  const prefetchDetails = async (items) => {
    if (!items || !items.length) return;
    prefetchFlag.running = true;
    let i = 0;
    let active = 0;
    let done = false;
    let resolveAll;
    const allDone = new Promise(r => resolveAll = r);
    const maybeSpawn = () => {
      while (prefetchFlag.running && active < PF_CONC && i < items.length && !done && !ctrl.stopped) {
        const item = items[i++];
        active++;
        (async () => {
          while (prefetchFlag.running && ctrl.schoolConc === 1 && !done && !ctrl.stopped) await sleep(200);
          if (prefetchFlag.running && !done && !ctrl.stopped) {
            const PD_id = item.pd.peserta_didik_id;
            if (PD_id && !detailCache.has(PD_id)) {
              const r = await fetchDetail(PD_id, item.sid);
              if (r.ok) { detailCache.set(PD_id, r.det); nPrefetched++; }
              if (r.wafAbort) { done = true; ctrl.stopped = true; }
            }
          }
          active--;
          if ((done || ctrl.stopped || !prefetchFlag.running || i >= items.length) && active === 0) resolveAll();
          else maybeSpawn();
        })();
      }
    };
    maybeSpawn();
    await allDone;
  };
  const fetchPagesParallel = async (sid, schoolConc) => {
    const pages = [];
    let page = 1;
    while (true) {
      const res = await getJson(URL_PD(sid) + page);
      if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) break;
      pages.push({ page, data: res.data, status: res.status });
      if (res.data.length < 200) break;
      const nextPage = page + 1;
      const prefetch = [];
      for (let i = 1; i <= PAGE_PREFETCH && (nextPage + i - 1) <= (page + PAGE_SOFT_EAGER); i++) {
        const p = nextPage + i - 1;
        prefetch.push(getJson(URL_PD(sid) + p).then(r => ({ page: p, data: r.ok && Array.isArray(r.data) ? r.data : [], status: r.status, ok: r.ok })).catch(() => ({ page: p, data: [], status: 0, ok: false })));
      }
      const results = await Promise.all(prefetch);
      let foundEmpty = false;
      for (const r of results) {
        if (r.data.length === 0) { foundEmpty = true; break; }
        pages.push({ page: r.page, data: r.data, status: r.status });
      }
      page = results.length ? Math.max(...results.map(r => r.page)) + 1 : nextPage;
      if (foundEmpty || pages.length >= schoolConc * 4) break;
    }
    return pages;
  };

  const gatherSchool = async (s, i) => {
    if (ctrl.stopped) return null;
    curSchool = i + 1;
    if ((i + 1) % 5 === 0 || i === 0) note(`[${i + 1}/${filtered.length}] ${s.npsn} ${s.kab}`);

    let sid = s.id;
    if (!sid) {
      const ref = await postForm(URL_REF, { q: s.npsn });
      if (ref.wafAbort) { aborted = true; ctrl.stopped = true; return null; }
      if (ref.ok && Array.isArray(ref.data) && ref.data.length && ref.data[0][0]) sid = ref.data[0][0];
    }
    if (!sid) { nErr++; return null; }

    const cached = pageCache.get(sid);
    const pageObjs = cached || await fetchPagesParallel(sid, ctrl.schoolConc);
    if (!cached) pageCache.set(sid, pageObjs);

    const students = [];
    for (const p of pageObjs) {
      for (const pd of (p.data || [])) students.push(pd);
    }
    if (!rawSample && students.length) rawSample = students[0];
    detectStatusField(rawSample);
    const beforeFilter = students.length;
    const dropAktif = students.filter(pd => !isActive(pd)).length;
    const dropRombel = students.filter(pd => !rombelTingkatTerisi(pd)).length;
    for (let x = students.length - 1; x >= 0; x--) {
      if (!isActive(students[x]) || !rombelTingkatTerisi(students[x])) students.splice(x, 1);
    }
    if (beforeFilter !== students.length)
      note(`filter aktif+rombel: ${beforeFilter}->${students.length} (buang non-aktif ${dropAktif}, rombel/tingkat kosong ${dropRombel})`);
    const before = students.length;
    if (klsFilter) {
      if (!rawSample && before) rawSample = students[0];
      for (let x = students.length - 1; x >= 0; x--) {
        if (!klsFilter.has(klsOf(students[x]))) students.splice(x, 1);
      }
      poolLine = `↳ ${s.npsn} ${before}->${students.length} siswa (kelas ${[...klsFilter].sort().join(',')})`;
    } else {
      poolLine = `↳ ${s.npsn} ${students.length} siswa`;
    }
    gatheredCount += students.length;
    return { school: s, sid, students };
  };
  const dynamicPool = async (items, worker) => {
    const results = new Array(items.length);
    let i = 0, active = 0, done = 0;
    let resolveAll;
    const allDone = new Promise(r => resolveAll = r);
    const maybeSpawn = () => {
      while (active < ctrl.schoolConc && i < items.length && !ctrl.stopped) {
        const idx = i++;
        active++;
        (async () => {
          try {
            await pauseWhile();
            if (!ctrl.stopped && idx < items.length) results[idx] = await worker(items[idx], idx);
          } finally {
            active--;
            done++;
            if (done >= items.length || ctrl.stopped) resolveAll();
            else maybeSpawn();
          }
        })();
      }
    };
    maybeSpawn();
    await allDone;
    return results;
  };

  const base = {
    postkolom: 'yes', sp_nama: 'on', sp_npsn: 'on', sp_bentuk: 'on',
    sp_kecamatan: 'on', sp_kab: 'on', bentukpendidikan: '0', statussekolah: '0'
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  banner();
  setTitle('[1/5] ambil rekapsp...');
  let header = [], rows = [], idCol = -1;
  const candidates = [null, 'sp_sekolah_id', 'sp_id', 'sp_id_sekolah', 'sp_sekolahid'];
  for (const extra of candidates) {
    const form = { ...base };
    if (extra) form[extra] = 'on';
    const r = await postForm(URL_REKAP, form);
    if (!r.ok || !Array.isArray(r.data) || r.data.length < 2) continue;
    header = r.data[0];
    rows = r.data[1];
    idCol = header.findIndex(h => /sekolah[_ ]?id|^id$/i.test(String(h)));
    if (idCol < 0) {
      for (let c = 0; c < (rows[0] || []).length; c++) {
        if (UUID.test(String(rows[0][c] || ''))) { idCol = c; break; }
      }
    }
    note(`rekapsp field="${extra}": ${rows.length} sekolah, kolom id=${idCol} (${header[idCol] || '-'})`);
    if (idCol >= 0) break;
  }
  if (!rows.length) return note('gagal ambil rekapsp:', JSON.stringify(header).slice(0, 300));

  const field = h => header.indexOf(h);
  const provCol = header.findIndex(h => /^prov/i.test(String(h)));
  const schools = rows.map(r => ({
    id: idCol >= 0 ? r[idCol] : null,
    nama: r[field('Nama Satuan Pendidikan')] ?? r[0],
    npsn: String(r[field('NPSN')] ?? r[1] ?? ''),
    bentuk: r[field('Bentuk Pendidikan')] ?? r[2],
    kec: r[field('Kecamatan')] ?? r[3],
    kab: r[field('Kabupaten/Kota')] ?? r[4],
    prov: provCol >= 0 ? r[provCol] : ''
  })).filter(s => /^\d{8}$/.test(s.npsn));
  if (provCol < 0) note('⚠ kolom provinsi tak ditemukan di rekapsp — opsi Provinsi dinonaktifkan.');

  const jenjangFilter = schools.map(s => s.bentuk).filter(Boolean);
  const allowed = /^(SMA|SMK|SLB|MA)(\s|$)/i;
  const keep = jenjangFilter.filter(v => allowed.test(v)).join(', ');
  const discard = jenjangFilter.filter(v => !allowed.test(v)).length;
  if (discard) note(`filter jenjang: buang ${discard} sekolah, sisa ${schools.length} (SMA/SMK/SLB/MA).`);
  const kept = schools.filter(s => allowed.test(s.bentuk));
  schools.length = 0;
  schools.push(...kept);

  const pickNums = (n, raw) => {
    if (!raw || !raw.trim()) return null;
    const set = new Set();
    for (const part of raw.split(',').map(p => p.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) { for (let i = +m[1]; i <= +m[2]; i++) set.add(i); }
      else if (/^\d+$/.test(part)) set.add(+part);
    }
    return [...set].filter(i => i >= 1 && i <= n);
  };
  const askPick = (list, label) => {
    const text = [
      `Pilih ${label} (angka, pisah koma, kosong = semua):`,
      ...list.map((k, i) => `  ${i + 1}. ${k}`)
    ].join('\n');
    const out = prompt(text);
    const idx = pickNums(list.length, out);
    if (!idx) return null;
    return new Set(idx.map(i => list[i - 1]));
  };

  const kabList = [...new Set(schools.map(s => s.kab).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const provList = [...new Set(schools.map(s => s.prov).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const provAvail = provList.length > 0;
  const off = provAvail ? 1 : 0;
  const L_PROV = 1, L_KAB = 1 + off, L_KEC = 2 + off, L_SEK = 3 + off;
  const levelOptions = provAvail
    ? '1. Provinsi\n2. Kabupaten\n3. Kecamatan\n4. Sekolah'
    : '1. Kabupaten\n2. Kecamatan\n3. Sekolah';
  const level = prompt('Pilih level filter:\n' + levelOptions + '\n(kosong = semua)');

  let filtered = schools;
  let filterName = 'semua';
  if (level === String(L_KAB) || level === String(L_KEC) || level === String(L_SEK) || level === String(L_PROV)) {
    if (provAvail && level === String(L_PROV)) {
      const pickedProv = askPick(provList, 'provinsi');
      const provSet = pickedProv || new Set(provList);
      filtered = schools.filter(s => provSet.has(s.prov));
      filterName = [...provSet].sort().join('-');
    } else {
      const pickedKab = askPick(kabList, 'kabupaten');
      const kabSet = pickedKab || new Set(kabList);
      const kabNames = [...kabSet].sort();
      if (level === String(L_KAB)) {
        filtered = schools.filter(s => kabSet.has(s.kab));
        filterName = kabNames.join('-');
      } else {
        const baseSchools = schools.filter(s => kabSet.has(s.kab));
        const kecList = [...new Set(baseSchools.map(s => s.kec).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const pickedKec = askPick(kecList, 'kecamatan');
        const kecSet = pickedKec || new Set(kecList);
        const kecNames = [...kecSet].sort();
        if (level === String(L_KEC)) {
          filtered = baseSchools.filter(s => kecSet.has(s.kec));
          filterName = kabNames.join('-') + '_' + kecNames.join('-');
        } else {
          const subset = baseSchools.filter(s => kecSet.has(s.kec));
          const schoolList = subset.map((s, i) => `${i + 1}. ${s.nama} — ${s.npsn} — ${s.kab} — ${s.kec}`);
          const pickedIdx = pickNums(subset.length, prompt('Pilih sekolah (angka, pisah koma, kosong = semua):\n' + schoolList.join('\n')));
          if (pickedIdx) {
            const set = new Set(pickedIdx.map(i => subset[i - 1].npsn));
            filtered = subset.filter(s => set.has(s.npsn));
          } else {
            filtered = subset;
          }
          filterName = filtered.map(s => s.nama).join('-');
        }
      }
    }
  }
  filterName = slug(filterName);
  note(`filter: ${filtered.length} sekolah (dari ${schools.length})`);
  if (!filtered.length) return note('tidak ada hasil');

  const klsInput = prompt('Filter kelas? (10, 11, 12, pisah koma, kosong = semua)');
  let klsFilter = (() => {
    const arr = pickNums(12, klsInput);
    if (!arr || !arr.length) return null;
    const set = new Set(arr.filter(n => n === 10 || n === 11 || n === 12));
    return set.size ? set : null;
  })();
  if (klsFilter) note('filter kelas:', [...klsFilter].sort().join(', '));

  const el = (tag, cls, ...kids) => {
    const n = document.createElement(tag);
    if (typeof cls === 'string') n.className = cls;
    else if (cls && typeof cls === 'object') for (const [k, v] of Object.entries(cls)) n[k] = v;
    for (const k of kids) {
      if (k == null) continue;
      n.append(typeof k === 'string' ? document.createTextNode(k) : k);
    }
    return n;
  };

  const overlayCSS = `
#__fp2o{position:fixed;inset:0;z-index:2147483000;background:#0d1117;color:#e6edf3;font:12px/1.4 Segoe UI,Arial,sans-serif;display:flex;flex-direction:column}
#__fp2o *{box-sizing:border-box}
#__fp2o .hd{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#161b22;border-bottom:1px solid #30363d}
#__fp2o .hd .t{font-weight:700;color:#58a6ff}
#__fp2o .hd .cnt{margin-left:auto;color:#8b949e}
#__fp2o .tb{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#161b22;border-bottom:1px solid #30363d;flex-wrap:wrap}
#__fp2o input[type=search]{flex:1;min-width:160px;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:5px 8px;border-radius:6px}
#__fp2o button{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:5px 10px;border-radius:6px;cursor:pointer}
#__fp2o button:hover{background:#30363d}
#__fp2o button.go{background:#238636;border-color:#238636;color:#fff;font-weight:700}
#__fp2o button.go:disabled{opacity:.4}
#__fp2o button.bad{background:#da3633;border-color:#da3633;color:#fff}
#__fp2o .cols{display:none;padding:8px 12px;background:#161b22;border-bottom:1px solid #30363d}
#__fp2o .cols.open{display:block}
#__fp2o .cols .colgrp{border:1px solid #30363d;border-radius:6px;margin-bottom:8px;padding:6px 10px}
#__fp2o .cols .coltab{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#58a6ff;font-weight:700;margin-bottom:4px}
#__fp2o .cols .coltab .cnt{color:#8b949e;font-weight:400;margin-left:auto}
#__fp2o .cols .colsub{color:#8b949e;font-size:11px;margin:6px 0 2px;border-top:1px solid #21262d;padding-top:4px;grid-column:1/-1}
#__fp2o .cols .colgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:2px 14px;margin-top:4px}
@media (max-width:900px){#__fp2o .cols .colgrid{grid-template-columns:repeat(3,1fr)}}
#__fp2o .cols .colc{display:flex;align-items:center;gap:6px;margin:2px 0;padding-left:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;cursor:pointer}
#__fp2o .cols .hint{color:#8b949e}
#__fp2o .lst{flex:1;overflow:auto;padding:8px 12px}
#__fp2o .g{margin-bottom:14px;border:1px solid #30363d;border-radius:8px;overflow:hidden}
#__fp2o .gh{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#21262d}
#__fp2o .gh b{font-size:13px}
#__fp2o .gh .gmeta{color:#8b949e}
#__fp2o .gh .chev{color:#8b949e;width:14px;text-align:center;flex:none}
#__fp2o .gb{max-height:60vh;overflow:auto;border-top:1px solid #30363d}
#__fp2o table{width:100%;border-collapse:collapse;table-layout:fixed}
#__fp2o th,#__fp2o td{text-align:left;padding:4px 6px;border-top:1px solid #21262d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#__fp2o th{background:#161b22;color:#8b949e;font-weight:600}
#__fp2o td.c{max-width:150px}
#__fp2o tr:hover{background:#161b22}
#__fp2o .dtl{background:none;border:1px solid #1f6feb;color:#58a6ff;padding:1px 6px;font-size:11px;cursor:pointer}
#__fp2o .mdl{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10}
#__fp2o .mdl .mb{background:#161b22;border:1px solid #30363d;border-radius:8px;max-width:640px;width:92%;max-height:82%;display:flex;flex-direction:column}
#__fp2o .mdl .mt{padding:8px 12px;font-weight:700;border-bottom:1px solid #30363d;display:flex;align-items:center}
#__fp2o .mdl .mc{overflow:auto;padding:8px 12px}
#__fp2o .mdl .mtab{margin-bottom:12px}
#__fp2o .mdl .mtab h4{margin:0 0 4px;color:#58a6ff}
#__fp2o .mdl .close{margin-left:auto;cursor:pointer;color:#8b949e}
`;

  let ovS = null;
  const buildOverlay = (gathered) => new Promise(resolve => {
    const style = el('style');
    style.textContent = overlayCSS;
    document.head.appendChild(style);
    const root = el('div');
    root.id = '__fp2o';
    const hd = el('div', 'hd');
    const cnt = el('span', 'cnt');
    hd.append(el('span', 't', 'Pilih Peserta Didik'), cnt);
    const tb = el('div', 'tb');
    const q = el('input', { type: 'search', placeholder: 'cari nama / NISN...' });
    const bAll = el('button', {}, 'Pilih semua');
    const bNone = el('button', {}, 'Kosongkan');
    const bCols = el('button', {}, 'Kolom');
    const go = el('button', 'go', 'Lanjut (0)');
    go.disabled = true;
    const bad = el('button', 'bad', 'Batal');
    tb.append(q, bAll, bNone, bCols, go, bad);
    const colsPanel = el('div', 'cols');
    const list = el('div', 'lst');
    root.append(hd, tb, colsPanel, list);
    document.body.appendChild(root);

    const ov = {
      root, groups: gathered.map(({ school, sid, students }) => ({ school, sid, students, built: false, expanded: false, rowEls: null })),
      cols: [], chosen: new Set(), selected: new Set(), query: '', openCols: false
    };
    ovS = ov;

    ov.updCount = () => {
      const total = ov.groups.reduce((a, g) => a + g.students.length, 0);
      cnt.textContent = `terpilih ${ov.selected.size} / ${total} siswa`;
      go.textContent = `Lanjut (${ov.selected.size})`;
      go.disabled = ov.selected.size === 0;
    };

    ov.updGmeta = g => {
      let txt = `${g.school.npsn} · ${g.school.kab} / ${g.school.kec} · ${g.students.length} siswa`;
      if (ov.query && g.match !== undefined) txt += ` · ${g.match} cocok`;
      g.gmeta.textContent = txt;
    };

    ov.syncGroupCheck = g => {
      const n = g.students.filter(pd => ov.selected.has(pd)).length;
      g.gc.checked = n > 0 && n === g.students.length;
      g.gc.indeterminate = n > 0 && n < g.students.length;
    };

    ov.buildTable = g => {
      const chosenCols = [...ov.chosen].sort((a, b) => a - b).map(i => ov.cols[i]);
      const tbl = el('table');
      const trh = el('tr');
      trh.append(el('th', {}, ''), el('th', {}, 'Nama'), el('th', {}, 'NISN'), el('th', {}, 'JK'), el('th', {}, 'Tgl Lahir'), el('th', {}, 'Rombel'));
      chosenCols.forEach(c => trh.append(el('th', {}, c.label)));
      trh.append(el('th', {}, ''));
      tbl.append(el('thead', {}, trh));
      const tbody = el('tbody');
      const rowEls = new Map();
      for (const pd of g.students) {
        const det = pd.peserta_didik_id ? detailCache.get(pd.peserta_didik_id) : null;
        const tr = el('tr');
        const cb = el('input', { type: 'checkbox', checked: ov.selected.has(pd) });
        cb.addEventListener('change', () => {
          if (cb.checked) ov.selected.add(pd);
          else ov.selected.delete(pd);
          ov.updCount();
          ov.syncGroupCheck(g);
        });
        const tds = [
          el('td', {}, cb),
          el('td', 'c', pd.nama || ''),
          el('td', 'c', pd.nisn || ''),
          el('td', 'c', pd.jenis_kelamin || ''),
          el('td', 'c', pd.tanggal_lahir || ''),
          el('td', 'c', [pd.rombel, pd.tingkat].filter(Boolean).join(' / '))
        ];
        chosenCols.forEach(c => tds.push(el('td', 'c', det ? getPath(det, c.path) || '-' : '-')));
        const dtBtn = el('button', 'dtl', 'Detail');
        dtBtn.addEventListener('click', () => openDetail(pd, g.sid));
        tds.push(el('td', {}, dtBtn));
        tr.append(...tds);
        tbody.append(tr);
        rowEls.set(pd, tr);
      }
      tbl.append(tbody);
      g.gb.innerHTML = '';
      g.gb.append(tbl);
      g.rowEls = rowEls;
      ov.applyFilter();
    };

    ov.buildGroup = g => {
      g.gEl = el('div', 'g');
      const gh = el('div', 'gh');
      gh.addEventListener('click', ev => {
        if (ev.target.tagName === 'INPUT' || ev.target.classList.contains('dtl')) return;
        g.expanded = !g.expanded;
        if (g.expanded && !g.built) { ov.buildTable(g); g.built = true; }
        g.gb.style.display = g.expanded ? '' : 'none';
        g.chev.textContent = g.expanded ? '▾' : '▸';
      });
      g.gc = el('input', { type: 'checkbox' });
      g.gc.addEventListener('click', ev => ev.stopPropagation());
      g.gc.addEventListener('change', () => {
        if (g.gc.checked) g.students.forEach(pd => ov.selected.add(pd));
        else g.students.forEach(pd => ov.selected.delete(pd));
        ov.updCount();
        ov.syncGroupCheck(g);
      });
      g.chev = el('span', 'chev', '▸');
      g.gmeta = el('span', 'gmeta', '');
      gh.append(g.gc, g.chev, el('b', {}, g.school.nama), g.gmeta);
      g.gb = el('div', 'gb');
      g.gb.style.display = 'none';
      g.gEl.append(gh, g.gb);
      list.append(g.gEl);
      ov.syncGroupCheck(g);
      ov.updGmeta(g);
    };

    ov.applyFilter = () => {
      const qq = ov.query.trim().toLowerCase();
      for (const g of ov.groups) {
        if (g.rowEls) {
          let n = 0;
          for (const [pd, tr] of g.rowEls) {
            const m = qq === '' || (pd.nama || '').toLowerCase().includes(qq) || (pd.nisn || '').toLowerCase().includes(qq);
            tr.style.display = m ? '' : 'none';
            if (m) n++;
          }
          g.match = qq ? n : undefined;
          g.gEl.style.display = (qq && n === 0) ? 'none' : '';
        } else if (qq) {
          g.match = g.students.reduce((c, pd) => c + (((pd.nama || '').toLowerCase().includes(qq) || (pd.nisn || '').toLowerCase().includes(qq)) ? 1 : 0), 0);
          g.gEl.style.display = g.match === 0 ? 'none' : '';
        } else {
          g.match = undefined;
          g.gEl.style.display = '';
        }
        ov.updGmeta(g);
      }
    };

    ov.rebuildTables = () => {
      for (const g of ov.groups) {
        if (g.built) ov.buildTable(g);
      }
    };

    ov.addCols = (det) => {
      const flat = [];
      const walk = (o, path) => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === 'object') walk(v, [...path, k]);
          else flat.push([...path, k]);
        }
      };
      walk(det, []);
      for (const p of flat) {
        if (!ov.cols.some(c => c.path.length === p.length && c.path.every((x, i) => x === p[i]))) {
          ov.cols.push({ path: p, label: p.join(' > ') });
        }
      }
    };

    const renderCols = () => {
      colsPanel.innerHTML = '';
      if (!ov.cols.length) {
        colsPanel.append(el('span', 'hint', 'Belum ada field detail. Klik tombol Detail pada baris siswa untuk memuat kolom dari halaman /detailpd.'));
        return;
      }
      const shortLabel = c => c.path.length >= 3 ? c.path.slice(2).join(' > ') : c.path[1];
      const tabs = new Map();
      ov.cols.forEach((c, i) => {
        const tab = c.path[0];
        if (!tabs.has(tab)) tabs.set(tab, []);
        tabs.get(tab).push({ c, i });
      });
      for (const [tab, list] of tabs) {
        const g = el('div', 'colgrp');
        const gh = el('label', 'coltab');
        const cb = el('input', { type: 'checkbox', checked: list.every(({ i }) => ov.chosen.has(i)) });
        cb.addEventListener('change', () => {
          if (cb.checked) list.forEach(({ i }) => ov.chosen.add(i));
          else list.forEach(({ i }) => ov.chosen.delete(i));
          ov.rebuildTables();
        });
        const n = list.filter(({ i }) => ov.chosen.has(i)).length;
        gh.append(cb, el('b', {}, tab), el('span', 'cnt', `${n}/${list.length}`));
        const grid = el('div', 'colgrid');
        g.append(gh, grid);
        const parents = new Map();
        for (const { c, i } of list) {
          const p = c.path.length >= 3 ? c.path[1] : null;
          if (!parents.has(p)) parents.set(p, []);
          parents.get(p).push({ c, i });
        }
        for (const [p, sub] of parents) {
          if (p) grid.append(el('div', 'colsub', p));
          for (const { c, i } of sub) {
            const l = el('label', 'colc');
            const ccb = el('input', { type: 'checkbox', checked: ov.chosen.has(i) });
            ccb.addEventListener('change', () => {
              if (ccb.checked) ov.chosen.add(i);
              else ov.chosen.delete(i);
              ov.rebuildTables();
            });
            l.append(ccb, shortLabel(c));
            grid.append(l);
          }
        }
        colsPanel.append(g);
      }
    };

    const showModal = (pd, det) => {
      const m = el('div', 'mdl');
      const mb = el('div', 'mb');
      const mt = el('div', 'mt', norm(pd.nama) || 'Detail Peserta Didik');
      const cx = el('span', 'close', '✕');
      cx.addEventListener('click', () => m.remove());
      mt.append(cx);
      const mc = el('div', 'mc');
      for (const [tab, obj] of Object.entries(det)) {
        const tEl = el('div', 'mtab');
        tEl.append(el('h4', {}, tab));
        const flat = [];
        const walk = (o, path) => {
          for (const [k, v] of Object.entries(o)) {
            if (v && typeof v === 'object') walk(v, [...path, k]);
            else flat.push([...path, k, v]);
          }
        };
        walk(obj, []);
        const tbl = el('table');
        const tbody = el('tbody');
        for (const [k, v] of flat) {
          const tr = el('tr');
          tr.append(el('td', 'c', k), el('td', 'c', String(v)));
          tbody.append(tr);
        }
        tbl.append(tbody);
        tEl.append(tbl);
        mc.append(tEl);
      }
      mb.append(mt, mc);
      m.append(mb);
      root.append(m);
    };

    const openDetail = async (pd, sid) => {
      const PD_id = pd.peserta_didik_id;
      if (!PD_id) return;
      let det = detailCache.get(PD_id);
      if (!det) {
        const r = await fetchDetail(PD_id, sid);
        if (!r.ok) {
          note('detail gagal:', String(r.error || r.status || r.note || '?'));
          return;
        }
        det = r.det;
        detailCache.set(PD_id, det);
        ov.addCols(det);
        renderCols();
        ov.rebuildTables();
      }
      showModal(pd, det);
    };

    let qTimer;
    q.addEventListener('input', () => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { ov.query = q.value; ov.applyFilter(); }, 200);
    });
    bAll.addEventListener('click', () => {
      ov.selected = new Set(ov.groups.flatMap(g => g.students));
      ov.groups.forEach(ov.syncGroupCheck);
      ov.updCount();
    });
    bNone.addEventListener('click', () => {
      ov.selected.clear();
      ov.groups.forEach(ov.syncGroupCheck);
      ov.updCount();
    });
    bCols.addEventListener('click', () => {
      ov.openCols = !ov.openCols;
      colsPanel.classList.toggle('open', ov.openCols);
    });
    go.addEventListener('click', () => {
      const items = [];
      const map = new Map(ov.groups.flatMap(g => g.students.map(pd => [pd, { school: g.school, sid: g.sid, pd }])));
      for (const pd of ov.selected) {
        const it = map.get(pd);
        if (it) items.push(it);
      }
      root.remove();
      resolve(items);
    });
    bad.addEventListener('click', () => { root.remove(); resolve('__CANCEL__'); });

    ov.groups.forEach(ov.buildGroup);
    ov.updCount();
    q.focus();
  });

  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const pdKeys = ['nama', 'jenis_kelamin', 'tanggal_lahir', 'nama_ibu_kandung', 'nik', 'nisn', 'last_update', 'rombel', 'tingkat', 'peserta_didik_id', 'rombongan_belajar_id'];
  const chosenPaths = () => ovS ? [...ovS.chosen].sort((a, b) => a - b).map(i => ovS.cols[i].path) : [];
  let headerLine = [];
  const lines = [];
  const doDownload = (msg) => {
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `peserta_didik_${filterName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    if (msg) note(msg);
    note(`CSV terdownload: ${lines.length - 1} baris`);
  };

  let nPd = 0, nErr = 0, nDetailFetched = 0, nDetailCached = 0, nDetailFail = 0, t0 = Date.now(), curSchool = 0, gatheredCount = 0;
  let phase2 = false;
  let poolLine = '';
  let aborted = false;

  window._fetch = {
    pause: () => { ctrl.paused = true; note('⏸ pause — request berjalan selesai, sisanya tertahan'); },
    resume: () => { ctrl.paused = false; note('▶ resume'); },
    stop: () => { ctrl.stopped = true; note('⏹ stop — selesai setelah request aktif selesai'); },
    stats: () => {
      const elapsed = (Date.now() - t0) / 1000;
      return {
        sekolah: curSchool,
        totalSekolah: filtered.length,
        siswa: phase2 ? nPd : gatheredCount,
        detailFetched: nDetailFetched,
        detailCached: nDetailCached,
        detailGagal: nDetailFail,
        errorSekolah: nErr,
        ratePerDetik: elapsed ? +((phase2 ? nPd : gatheredCount) / elapsed).toFixed(1) : 0,
        paused: ctrl.paused
      };
    },
    download: doDownload
  };

  const buildStatus = () => {
    const elapsed = (Date.now() - t0) / 1000;
    const prog = phase2 ? nPd : gatheredCount;
    const rate = elapsed ? (prog / elapsed).toFixed(1) : '0.0';
    const msg = `siswa ${prog} | sekolah ${curSchool}/${filtered.length} | detail fetched ${nDetailFetched}, prefetch ${nPrefetched}, cached ${nDetailCached}, gagal ${nDetailFail} | ${rate}/dtk`;
    setTitle(msg);
    return msg;
  };
  const render = () => {
    console.clear();
    banner();
    for (const l of notes) console.log(l);
    if (poolLine) console.log('%c' + poolLine, 'color:#0f0;font-weight:bold');
    console.log('%c' + buildStatus(), 'color:#0af;font-weight:bold');
  };
  const renderTimer = setInterval(render, 1000);

  const keepAlive = setInterval(() => {
    cleanFetch('https://datadik.kemendikdasmen.go.id/manage', { method: 'GET', credentials: 'include', signal: AbortSignal.timeout(15000) })
      .catch(() => {});
  }, 60000);

  const cleanup = () => {
    clearInterval(keepAlive);
    clearInterval(wafWatchdog);
    clearInterval(renderTimer);
  };

  setTitle(`[2/5] kumpulkan siswa (paralel=${SCHOOL_CONCURRENCY})...`);
  ctrl.targetConc = SCHOOL_CONCURRENCY;
  ctrl.schoolConc = SCHOOL_CONCURRENCY;
  let rawSample = null;
  const gatherAll = async () => {
    gatheredCount = 0;
    let res = await dynamicPool(filtered, gatherSchool);
    gatheredList = res.filter(Boolean);
    const totalGathered = gatheredList.reduce((a, g) => a + g.students.length, 0);
    if (klsFilter && totalGathered === 0) {
      note('⚠ filter kelas tak cocok dengan data (0 siswa) — filter dimatikan, ulangi tanpa filter.');
      if (rawSample) console.log('sampel siswa mentah:', rawSample);
      klsFilter = null;
      res = await dynamicPool(filtered, gatherSchool);
      gatheredList = res.filter(Boolean);
    }
  };

  let gatheredList = [];
  await gatherAll();
  const totalGathered = gatheredList.reduce((a, g) => a + g.students.length, 0);
  note(`terkumpul ${totalGathered} siswa dari ${gatheredList.length} sekolah`);
  if (ctrl.stopped || aborted) {
    cleanup();
    note('⏹ dihentikan saat kumpul siswa — tidak ada CSV.');
    render();
    return;
  }

  setTitle('[3/5] pilih siswa di overlay...');
  const allStudents = gatheredList.flatMap(g => g.students.map(pd => ({ pd, sid: g.sid })));
  const selPromise = buildOverlay(gatheredList);
  void prefetchDetails(allStudents).catch(() => {});
  const sel = await selPromise;
  prefetchFlag.running = false;
  if (sel === '__CANCEL__') {
    cleanup();
    note('pemilihan dibatalkan — tidak ada CSV.');
    render();
    return;
  }
  if (!sel.length) {
    cleanup();
    note('tidak ada siswa dipilih — tidak ada CSV.');
    render();
    return;
  }
  note(`dipilih ${sel.length} siswa`);

  headerLine = ['sekolah_id', 'npsn', 'nama_sekolah', 'bentuk', 'kecamatan', 'kabupaten', ...pdKeys, ...chosenPaths().map(p => p.join(' > '))];
  lines.push(headerLine.map(esc).join(','));

  phase2 = true;
  ctrl.targetConc = CONCURRENCY;
  ctrl.schoolConc = CONCURRENCY;
  setTitle(`[4/5] tarik detail ${sel.length} siswa (paralel=${CONCURRENCY})...`);
  const paths = chosenPaths();
  const needDetail = paths.length > 0;
  const results = await dynamicPool(sel, async (item) => {
    const { school, sid, pd } = item;
    const PD_id = pd.peserta_didik_id;
    let det = null;
    if (needDetail) {
      det = detailCache.get(PD_id);
      if (!det) {
        const r = await fetchDetail(PD_id, sid);
        if (r.ok) {
          det = r.det;
          detailCache.set(PD_id, det);
          nDetailFetched++;
          if (ctrl.schoolConc === 1) await sleep(40);
        } else {
          if (r.wafAbort) { aborted = true; ctrl.stopped = true; }
          nDetailFail++;
        }
      } else nDetailCached++;
    }
    nPd++;
    return { item, det };
  });

  for (const r of results) {
    if (!r) continue;
    const { item, det } = r;
    const { school, sid, pd } = item;
    const row = [sid, school.npsn, school.nama, school.bentuk, school.kec, school.kab, ...pdKeys.map(k => pd[k]), ...paths.map(p => getPath(det, p))];
    lines.push(row.map(esc).join(','));
  }

  cleanup();
  setTitle(`[4/5] selesai: ${nPd} siswa`);
  if (aborted) note('⚠ dihentikan user saat validasi WAF — hasil sebagian terdownload.');
  if (ctrl.stopped) note('⏹ dihentikan user via window._fetch.stop() — hasil sebagian terdownload.');
  note(`selesai: ${filtered.length} sekolah, ${nPd} peserta didik, ${nErr} sekolah error, detail fetched ${nDetailFetched}, cached ${nDetailCached}, gagal ${nDetailFail}`);
  doDownload();
  render();
  setTitle('[5/5] CSV terdownload');
})();
