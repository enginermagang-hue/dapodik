(async () => {
  const URL_REKAP = 'https://datadik.kemendikdasmen.go.id/ma74/rekapsp';
  const URL_REF = 'https://datadik.kemendikdasmen.go.id/refsp/q/B0C3969D-F031-43FD-888F-7C6A280ABBBA';
  const URL_PD = id => `https://datadik.kemendikdasmen.go.id/ma74/sekolahpd/${id}/`;
  const URL_DET = (pd_id, sekolah_id) => `https://datadik.kemendikdasmen.go.id/manage/detailpd/${pd_id}/${sekolah_id}`;
const RETRIES = 3;
const DELAY_PAGE_MS = 0;
const CONCURRENCY = 28;
const SCHOOL_CONCURRENCY = 6;
const PAGE_PREFETCH = 3;
const PAGE_SOFT_EAGER = 2;
const PF_CONC = 16;
const CACHE_TTL_DAYS = 30;

  const setTitle = t => { try { document.title = t; } catch (e) {} };
  const slug = s => String(s).replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_').slice(0, 80);
  const pad = (n) => String(n).padStart(2, '0');
  const ts = () => `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:${pad(new Date().getSeconds())}`;
  const notes = [];
  const note = (...a) => {
    notes.push({ t: ts(), msg: a.join(' ') });
    if (notes.length > 200) notes.shift();
  };
  const lvlOf = (m) => {
    if (/^[⚠]/.test(m)) return 'warn';
    if (/^[⏹]/.test(m)) return 'stop';
    if (/^detail ▸/.test(m)) return 'sch';
    if (/⏳/.test(m) || /diblokir|block/i.test(m)) return 'block';
    if (/WAF|SafeLine/i.test(m)) return 'waf';
    if (/^[🧹⏱✓]/.test(m) || /selesai:|terdownload|diperpanjang|cache selesai/i.test(m)) return 'ok';
    if (/gagal|error/i.test(m)) return 'err';
    return 'info';
  };

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
  const wafFloor = () => Math.max(4, Math.floor(ctrl.targetConc / 4));
  const throttleForWaf = (msg) => {
    const f = wafFloor();
    if (ctrl.schoolConc > f) { ctrl.schoolConc = f; note(msg + ' — paralel turun ke ' + f + ' (floor).'); updConcWidget(); }
  };
  let concWidget = null;
  const updConcWidget = () => {
    if (!concWidget) return;
    const throttled = ctrl.schoolConc < ctrl.targetConc;
    concWidget.textContent = '⚡ ' + ctrl.schoolConc + (throttled ? ' / ' + ctrl.targetConc : '');
    concWidget.className = 'conc' + (throttled ? ' warn' : '');
    concWidget.title = 'Paralel detail fetch. WAF floor=' + wafFloor() + ', recovery 30dtk (tidak jatuh ke 1).';
  };
  const withBtnSpin = (btn, fn) => {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.prepend(el('span', 'spin'));
    return Promise.resolve().then(fn).finally(() => { btn.disabled = false; btn.innerHTML = prev; });
  };
  const pauseWhile = async () => { while (ctrl.paused) await sleep(200); };

  let idbDB = null;
  let nCacheHits = 0;
  const openDB = () => new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    if (idbDB) return resolve(idbDB);
    const req = indexedDB.open('__dapodik_fetch', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('det')) db.createObjectStore('det', { keyPath: 'id' });
    };
    req.onsuccess = () => { idbDB = req.result; resolve(idbDB); };
    req.onerror = () => resolve(null);
  });
  const dbGet = (id) => openDB().then(db => new Promise((res) => {
    if (!db) return res(null);
    try {
      const rq = db.transaction('det', 'readonly').objectStore('det').get(id);
      rq.onsuccess = () => {
        const rec = rq.result;
        if (rec && rec.det && Date.now() - (rec.ts || 0) < CACHE_TTL_DAYS * 864e5) res(rec.det);
        else res(null);
      };
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  }));
  const dbSet = (id, det, sid = null) => openDB().then(db => new Promise((res) => {
    if (!db) return res();
    try {
      const tx = db.transaction('det', 'readwrite');
      tx.objectStore('det').put({ id, det, ts: Date.now(), sid });
      res();
    } catch (e) { res(); }
  }));
  const dbClear = () => openDB().then(db => new Promise((res) => {
    if (!db) return res();
    try {
      const tx = db.transaction('det', 'readwrite');
      tx.objectStore('det').clear();
      res();
    } catch (e) { res(); }
  }));
  const dbRefresh = () => openDB().then(db => new Promise((res) => {
    if (!db) return res(0);
    try {
      const tx = db.transaction('det', 'readwrite');
      const store = tx.objectStore('det');
      const req = store.openCursor();
      let n = 0;
      req.onsuccess = e => {
        const cur = e.target.result;
        if (cur) {
          const v = cur.value;
          cur.update({ ...v, ts: Date.now() });
          n++;
          cur.continue();
        } else res(n);
      };
      req.onerror = () => res(n);
    } catch (e) { res(0); }
  }));
  const cachedDistricts = async () => {
    const db = await openDB();
    if (!db) return new Set();
    return new Promise(resolve => {
      try {
        const tx = db.transaction('det', 'readonly');
        const store = tx.objectStore('det');
        const req = store.openCursor();
        const sids = new Set();
        req.onsuccess = e => {
          const cur = e.target.result;
          if (cur) { const v = cur.value; if (v && v.sid) sids.add(v.sid); cur.continue(); }
          else {
            const map = new Map(schools.map(s => [s.id, s.kab]));
            const set = new Set();
            for (const sid of sids) { const k = map.get(sid); if (k) set.add(k); }
            resolve(set);
          }
        };
        req.onerror = () => resolve(new Set());
      } catch (e) { resolve(new Set()); }
    });
  };

  const wafHits = [];
  const wafHit = () => {
    const now = Date.now();
    wafHits.push(now);
    while (wafHits.length && now - wafHits[0] > 30000) wafHits.shift();
    if (wafHits.length >= 3 && ctrl.schoolConc > wafFloor()) {
      throttleForWaf('WAF berulang (3x/30dtk)');
    }
  };
  const wafWatchdog = setInterval(() => {
    const now = Date.now();
    if (ctrl.schoolConc < ctrl.targetConc && (!wafHits.length || now - wafHits[wafHits.length - 1] > 30000)) {
      ctrl.schoolConc = ctrl.targetConc;
      note('WAF bersih 30dtk — paralel kembali ke', ctrl.targetConc);
      updConcWidget();
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
      const ok = await app.ask({
        title: 'WAF/SafeLine terdeteksi',
        desc: `Saat: ${ctx}\n\nSelesaikan validasi SafeLine/challenge di halaman, lalu klik OK untuk lanjut. Klik Batal untuk berhenti.`,
        buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Batal', value: false }]
      });
      if (ok === false) throw new Error('dihentikan user (WAF)');
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
          const waitMs = Math.min(20000, 3000 * (2 ** tries)) + Math.random() * 2000;
          note(`⏳ diblokir SafeLine (${res.status}) ${url} — tunggu ${Math.round(waitMs / 1000)}s`);
          throttleForWaf('⏳ diblokir SafeLine');
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

  const fetchDetail = async (PD_id, sekolah_id, { force = false } = {}) => {
    if (!PD_id) return { ok: false, error: 'no PD_id' };
    if (!force) {
      const cached = await dbGet(PD_id);
      if (cached) { nCacheHits++; return { ok: true, det: cached, cached: true }; }
    }
    let result;
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
        if (isChallenge(r2, t2)) result = { ok: false, error: 'WAF after retry', wafAbort: true };
        else if (isBlock(r2, t2)) result = { ok: false, status: r2.status, error: 'blocked' };
        else if (!r2.ok) result = { ok: false, status: r2.status, raw: t2.slice(0, 200) };
        else {
          let det2 = parseDetText(t2);
          if (!det2) det2 = parseDet(new DOMParser().parseFromString(t2, 'text/html'));
          result = { ok: true, det: det2 };
        }
      } else if (isBlock(res, text)) {
        note(`⏳ diblokir SafeLine (${res.status}) detailpd`);
        throttleForWaf('⏳ diblokir SafeLine detailpd');
        result = { ok: false, status: res.status, error: 'blocked' };
      } else if (!res.ok) {
        result = { ok: false, status: res.status, raw: text.slice(0, 200) };
      } else {
        let det = parseDetText(text);
        if (!det) det = parseDet(new DOMParser().parseFromString(text, 'text/html'));
        result = { ok: true, det };
      }
    } catch (e) {
      if (/dihentikan user/.test(String(e))) result = { ok: false, error: String(e), wafAbort: true };
      else result = { ok: false, error: String(e) };
    }
    if (result.ok && result.det) dbSet(PD_id, result.det, sekolah_id);
    return result;
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
    const romanMap = { XIII: 13, XII: 12, XI: 11, X: 10, IX: 9, VIII: 8, VII: 7, VI: 6, V: 5, IV: 4, III: 3, II: 2, I: 1 };
    for (const f of fields) {
      if (f == null || f === '') continue;
      const raw = norm(f).toUpperCase();
      if (!raw) continue;
      const m = raw.match(/\bXIII\b|\bXII\b|\bXI\b|\bX\b|\bIX\b|\bVIII\b|\bVII\b|\bVI\b|\bV\b|\bIV\b|\bIII\b|\bII\b|\bI\b/);
      if (m) return romanMap[m[0]];
      const d = raw.match(/\b(1[0-3]|[1-9])\b/);
      if (d) {
        const n = parseInt(d[0], 10);
        if (n >= 1 && n <= 13) return n;
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

  let rawSample = null;
  let klsFilter = null;
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
      poolLine = `↳ ${s.npsn} ${before}->${students.length} siswa (kelas ${[...klsFilter].sort((a,b)=>a-b).join(',')})`;
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

  const overlayCSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
#__fp2o{position:fixed;inset:0;z-index:2147483000;background:linear-gradient(160deg,#0d1117 0%,#010409 100%);color:#e6edf3;font:13px/1.5 'Inter','Segoe UI',Arial,sans-serif;display:flex;flex-direction:column;font-feature-settings:'cv11','ss01';box-shadow:0 0 0 1px #30363d,0 24px 80px rgba(0,0,0,.6)}
#__fp2o *{box-sizing:border-box}
#__fp2o ::-webkit-scrollbar{width:10px;height:10px}
#__fp2o ::-webkit-scrollbar-track{background:transparent}
#__fp2o ::-webkit-scrollbar-thumb{background:#30363d;border-radius:8px;border:2px solid transparent;background-clip:padding-box}
#__fp2o ::-webkit-scrollbar-thumb:hover{background:#484f58;background-clip:padding-box}
#__fp2o{scrollbar-width:thin;scrollbar-color:#30363d transparent}
#__fp2o .hd{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(22,27,34,.92);backdrop-filter:blur(6px);border-bottom:1px solid #30363d;flex:none;position:sticky;top:0;z-index:6}
#__fp2o .hd .dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#58a6ff,#1f6feb);box-shadow:0 0 10px rgba(31,111,235,.7);flex:none}
#__fp2o .hd .t{font-weight:700;color:#58a6ff;letter-spacing:.2px}
#__fp2o .hd .cnt{margin-left:auto;color:#8b949e;font-size:11px;font-weight:500}
#__fp2o .content{flex:1;display:flex;flex-direction:column;overflow:hidden}
#__fp2o .log{flex:1;overflow:auto;padding:10px 14px;background:#0d1117;border-top:1px solid #30363d;font-family:Consolas,Menlo,monospace;font-size:11px;color:#8b949e}
#__fp2o .log div{white-space:pre-wrap;word-break:break-word;padding:1px 0}
#__fp2o .log .lh{padding:4px 2px 8px;color:#58a6ff;font-weight:700;font-size:12px;letter-spacing:.3px;border-bottom:1px solid #21262d;margin-bottom:6px}
#__fp2o .log .lg{padding:2px 6px 2px 9px;border-left:3px solid transparent;white-space:pre-wrap;word-break:break-word;line-height:1.5}
#__fp2o .log .lg-ts{color:#6e7681}
#__fp2o .log .lg-info{color:#8b949e;border-left-color:#30363d}
#__fp2o .log .lg-warn{color:#d29922;border-left-color:#d29922}
#__fp2o .log .lg-err{color:#f85149;border-left-color:#f85149}
#__fp2o .log .lg-stop{color:#f85149;border-left-color:#f85149}
#__fp2o .log .lg-block{color:#db6d28;border-left-color:#db6d28}
#__fp2o .log .lg-waf{color:#bc8cff;border-left-color:#bc8cff}
#__fp2o .log .lg-ok{color:#3fb950;border-left-color:#3fb950}
#__fp2o .log .lg-sch{color:#39c5cf;border-left-color:#39c5cf}
#__fp2o .dlg{max-width:680px;width:94%;margin:26px auto;padding:20px;background:#161b22;border:1px solid #30363d;border-radius:12px;max-height:calc(100% - 52px);overflow:auto;flex:none;box-shadow:0 16px 50px rgba(0,0,0,.55);animation:fpIn .18s ease-out}
#__fp2o .dt{font-size:16px;font-weight:700;color:#58a6ff;margin-bottom:10px;letter-spacing:.2px}
#__fp2o .dd{color:#c9d1d9;margin-bottom:14px;white-space:pre-wrap;word-break:break-word;line-height:1.55}
#__fp2o .dlgbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#__fp2o .chklist{display:flex;flex-direction:column;gap:4px;max-height:46vh;overflow:auto;border:1px solid #21262d;border-radius:8px;padding:8px;background:#0d1117}
#__fp2o .chk{display:flex;align-items:center;gap:8px;cursor:pointer;padding:5px 6px;border-radius:6px;transition:background .12s}
#__fp2o .chk:hover{background:#21262d}
#__fp2o .chk input{flex:none;accent-color:#58a6ff;width:15px;height:15px}
#__fp2o .chk .badge{flex:none;margin-left:auto;font-size:10px;font-weight:700;color:#7ee787;background:linear-gradient(180deg,#16331f,#0f2417);border:1px solid #2ea043;border-radius:999px;padding:2px 9px;letter-spacing:.4px;box-shadow:inset 0 0 8px rgba(46,160,67,.25)}
#__fp2o .dspin{color:#8b949e;text-align:center;padding:40px 16px;font-size:13px}
#__fp2o .tb{display:flex;gap:8px;align-items:center;padding:10px 14px;background:rgba(22,27,34,.92);backdrop-filter:blur(6px);border-bottom:1px solid #30363d;flex-wrap:wrap;flex:none;position:sticky;top:0;z-index:5}
#__fp2o input[type=search]{flex:1;min-width:170px;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:7px 10px;border-radius:8px;transition:border-color .12s,box-shadow .12s;font:inherit}
#__fp2o input[type=search]:focus{outline:none;border-color:#1f6feb;box-shadow:0 0 0 3px rgba(31,111,235,.25)}
#__fp2o input[type=search]::placeholder{color:#6e7681}
#__fp2o button{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:7px 12px;border-radius:8px;cursor:pointer;font:inherit;font-weight:500;transition:background .12s,border-color .12s,transform .06s}
#__fp2o button:hover{background:#30363d;border-color:#484f58}
#__fp2o button:active{transform:translateY(1px)}
#__fp2o button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(31,111,235,.35)}
#__fp2o button.go{background:linear-gradient(180deg,#2ea043,#238636);border-color:#238636;color:#fff;font-weight:700;box-shadow:0 1px 0 rgba(0,0,0,.2),0 4px 14px rgba(35,134,54,.35)}
#__fp2o button.go:hover{background:linear-gradient(180deg,#34b653,#2ea043);border-color:#2ea043}
#__fp2o button.go:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
#__fp2o button.bad{background:linear-gradient(180deg,#e5534b,#da3633);border-color:#da3633;color:#fff;box-shadow:0 4px 14px rgba(218,54,51,.3)}
#__fp2o button.bad:hover{background:linear-gradient(180deg,#f0655d,#e5534b)}
#__fp2o .cols{display:none;padding:10px 14px;background:#161b22;border-bottom:1px solid #30363d;max-height:44vh;overflow:auto;flex:none}
#__fp2o .cols.open{display:block;animation:fpIn .15s ease-out}
#__fp2o .cols .colgrp{border:1px solid #30363d;border-radius:10px;margin-bottom:10px;padding:8px 12px;background:#0d1117;box-shadow:0 2px 10px rgba(0,0,0,.25)}
#__fp2o .cols .coltab{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#58a6ff;font-weight:700;margin-bottom:6px}
#__fp2o .cols .coltab input{accent-color:#58a6ff}
#__fp2o .cols .coltab .cnt{color:#8b949e;font-weight:500;margin-left:auto}
#__fp2o .cols .colsub{color:#8b949e;font-size:11px;margin:8px 0 4px;border-top:1px solid #21262d;padding-top:6px;grid-column:1/-1}
#__fp2o .cols .colgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 14px;margin-top:6px}
#__fp2o .cols .colc{display:flex;align-items:flex-start;gap:6px;margin:3px 0;padding-left:18px;white-space:normal;overflow:visible;word-break:break-word;min-width:0;cursor:pointer;line-height:1.4;font-size:12px}
#__fp2o .cols .colc input{accent-color:#58a6ff;margin-top:2px}
#__fp2o .cols .hint{color:#8b949e;font-size:12px}
#__fp2o .lst{flex:1;overflow:auto;padding:10px 14px}
#__fp2o .g{margin-bottom:14px;border:1px solid #30363d;border-radius:10px;overflow:hidden;background:#161b22;box-shadow:0 2px 12px rgba(0,0,0,.3)}
#__fp2o .gh{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#21262d}
#__fp2o .gh b{font-size:13px;font-weight:600}
#__fp2o .gh .gmeta{color:#8b949e;font-size:11px;font-weight:500}
#__fp2o .gh .chev{color:#8b949e;width:14px;text-align:center;flex:none;transition:transform .15s}
#__fp2o .gh input{accent-color:#58a6ff}
#__fp2o .gb{max-height:60vh;overflow:auto}
#__fp2o table{width:100%;border-collapse:collapse;table-layout:fixed}
#__fp2o th{position:sticky;top:0;z-index:2;background:#161b22;color:#8b949e;font-weight:600;text-align:left;padding:7px 8px;border-bottom:1px solid #30363d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;letter-spacing:.3px}
#__fp2o td{text-align:left;padding:6px 8px;border-top:1px solid #21262d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}
#__fp2o tbody tr:nth-child(even){background:#11161d}
#__fp2o tbody tr:hover{background:#1c2128}
#__fp2o td.c{max-width:160px}
#__fp2o td.jk{text-align:center}
#__fp2o td.jk .pill{display:inline-block;min-width:20px;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}
#__fp2o td.jk.L .pill{color:#79c0ff;background:#0d2a4d;border:1px solid #1f6feb}
#__fp2o td.jk.P .pill{color:#ff9bce;background:#3d0f29;border:1px solid #db61a2}
#__fp2o .dtl{background:none;border:1px solid #1f6feb;color:#58a6ff;padding:2px 8px;font-size:11px;cursor:pointer;border-radius:6px;transition:background .12s,color .12s}
#__fp2o .dtl:hover{background:#1f6feb;color:#fff}
#__fp2o .mdl{position:fixed;inset:0;background:rgba(1,4,9,.66);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:10;animation:fpFade .15s ease-out}
#__fp2o .mdl .mb{background:#161b22;border:1px solid #30363d;border-radius:12px;max-width:680px;width:92%;max-height:84%;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.6);animation:fpPop .18s ease-out}
#__fp2o .mdl .mt{padding:12px 14px;font-weight:700;border-bottom:1px solid #30363d;display:flex;align-items:center;color:#e6edf3;font-size:14px}
#__fp2o .mdl .mc{overflow:auto;padding:12px 14px}
#__fp2o .mdl .mtab{margin-bottom:14px}
#__fp2o .mdl .mtab h4{margin:0 0 6px;color:#58a6ff;font-size:13px;font-weight:600}
#__fp2o .mdl table{margin-top:4px}
#__fp2o .mdl tbody tr:nth-child(even){background:#11161d}
#__fp2o .mdl td{border-top:1px solid #21262d;font-size:12px}
#__fp2o .mdl td:first-child{color:#8b949e;width:42%}
#__fp2o .mdl .close{margin-left:auto;cursor:pointer;color:#8b949e;font-size:16px;line-height:1;padding:2px 6px;border-radius:6px;transition:background .12s,color .12s}
#__fp2o .mdl .close:hover{background:#30363d;color:#e6edf3}
#__fp2o .prog{padding:28px}
#__fp2o .ptitle{font-size:16px;font-weight:700;color:#58a6ff;margin-bottom:14px}
#__fp2o .pbar{height:18px;background:#0d1117;border:1px solid #30363d;border-radius:999px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
#__fp2o .pfill{height:100%;width:0;background:linear-gradient(90deg,#238636,#2ea043,#3fb950);background-size:200% 100%;animation:fpShimmer 1.4s linear infinite;transition:width .25s}
#__fp2o .pstat{margin-top:10px;color:#8b949e;font-size:12px}
#__fp2o .pnow{margin-top:8px;color:#c9d1d9;font-size:12px;min-height:16px}
#__fp2o .conc{margin-left:8px;font-size:11px;font-weight:600;color:#3fb950;background:#0d2a1a;border:1px solid #238636;border-radius:999px;padding:2px 9px;white-space:nowrap;transition:color .2s,background .2s,border-color .2s}
#__fp2o .conc.warn{color:#f0b429;background:#2b2410;border-color:#bb8009;animation:fpPulse 1.1s ease-in-out infinite}
#__fp2o .spin{width:13px;height:13px;margin-right:6px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;display:inline-block;vertical-align:-2px;animation:fpSpin .7s linear infinite}
#__fp2o button:disabled{opacity:.7;cursor:default}
@keyframes fpIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@keyframes fpFade{from{opacity:0}to{opacity:1}}
@keyframes fpPop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
@keyframes fpShimmer{from{background-position:200% 0}to{background-position:0 0}}
@keyframes fpSpin{to{transform:rotate(360deg)}}
@keyframes fpPulse{0%,100%{box-shadow:0 0 0 0 rgba(240,180,41,.4)}50%{box-shadow:0 0 0 5px rgba(240,180,41,0)}}
#__fp2o .g{animation:fpIn .2s ease-out}
`;

  const createApp = () => {
    const style = el('style');
    style.textContent = overlayCSS;
    document.head.appendChild(style);
    const root = el('div');
    root.id = '__fp2o';
    const head = el('div', 'hd');
    const dot = el('span', 'dot');
    const headTitle = el('span', 't', 'Fetch PD Dapodik');
    const cw = el('span', 'conc', '⚡ …');
    const cnt = el('span', 'cnt', '');
    const logBtn = el('button', {}, 'Log');
    head.append(dot, headTitle, cw, cnt, logBtn);
    concWidget = cw;
    updConcWidget();
    const content = el('div', 'content');
    const logEl = el('div', 'log');
    logEl.style.display = 'none';
    root.append(head, content, logEl);
    document.body.appendChild(root);
    const renderLog = () => {
      logEl.innerHTML = '';
      logEl.append(el('div', 'lh', 'Log Aktivitas'));
      for (const e of notes) {
        const d = el('div', 'lg lg-' + lvlOf(e.msg));
        d.append(el('span', 'lg-ts', '[' + e.t + '] '), document.createTextNode(e.msg));
        logEl.append(d);
      }
      logEl.scrollTop = logEl.scrollHeight;
    };
    logBtn.addEventListener('click', () => { logEl.style.display = logEl.style.display === 'none' ? '' : 'none'; });
    const ask = ({ title, desc, buttons = [] }) => new Promise(resolve => {
      content.innerHTML = '';
      const box = el('div', 'dlg');
      box.append(el('div', 'dt', title));
      if (desc) box.append(el('div', 'dd', desc));
      const bar = el('div', 'dlgbar');
      for (const b of buttons) {
        const btn = el('button', b.primary ? 'go' : '', b.label);
        btn.addEventListener('click', () => resolve(b.value));
        bar.append(btn);
      }
      box.append(bar);
      content.append(box);
    });
    const askChecklist = (title, items, opts = {}) => new Promise(resolve => {
      content.innerHTML = '';
      const box = el('div', 'dlg');
      box.append(el('div', 'dt', title));
      const listEl = el('div', 'chklist');
      const state = new Set();
      items.forEach((it, i) => {
        const row = el('label', 'chk');
        const cb = el('input', { type: 'checkbox' });
        cb.addEventListener('change', () => { if (cb.checked) state.add(i); else state.delete(i); });
        row.append(cb, document.createTextNode(' ' + it));
        const b = opts.badge ? opts.badge(it, i) : null;
        if (b) { const sp = el('span', 'badge', String(b)); row.append(sp); }
        listEl.append(row);
      });
      box.append(listEl);
      const bar = el('div', 'dlgbar');
      const allBtn = el('button', {}, 'Pilih Semua');
      allBtn.addEventListener('click', () => { state.clear(); [...listEl.querySelectorAll('input')].forEach(c => c.checked = true); items.forEach((_, i) => state.add(i)); });
      const noneBtn = el('button', {}, 'Kosongkan');
      noneBtn.addEventListener('click', () => { state.clear(); [...listEl.querySelectorAll('input')].forEach(c => c.checked = false); });
      const okBtn = el('button', 'go', opts.confirmLabel || 'Lanjut');
      okBtn.addEventListener('click', () => {
        const labels = [...state].map(i => items[i]);
        resolve(labels.length ? new Set(labels) : null);
      });
      bar.append(allBtn, noneBtn, okBtn);
      box.append(bar);
      content.append(box);
    });
    const showDone = (title, html) => {
      content.innerHTML = '';
      const box = el('div', 'dlg');
      box.append(el('div', 'dt', title));
      const dd = el('div', 'dd');
      dd.innerHTML = html;
      box.append(dd);
      const bar = el('div', 'dlgbar');
      const close = el('button', 'go', 'Tutup');
      close.addEventListener('click', () => root.remove());
      bar.append(close);
      box.append(bar);
      content.append(box);
    };
    return {
      root, content, logEl, renderLog,
      log: (...a) => { note(...a); renderLog(); },
      setHead: t => headTitle.textContent = t,
      setStatus: t => cnt.textContent = t,
      ask, askChecklist, showDone
    };
  };

  let ovS = null;
  const showSelection = (gathered) => new Promise(resolve => {
    app.content.innerHTML = '';
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
    app.content.append(tb, colsPanel, list);

    const ov = {
      root: app.root, groups: gathered.map(({ school, sid, students }) => ({ school, sid, students, built: false, expanded: false, rowEls: null })),
      cols: [], chosen: new Set(), selected: new Set(), query: '', openCols: false,
      fixedChosen: new Set([...schoolCols, ...pdCols].map(c => c.key))
    };
    ovS = ov;

    ov.updCount = () => {
      const total = ov.groups.reduce((a, g) => a + g.students.length, 0);
      app.setStatus(`terpilih ${ov.selected.size} / ${total} siswa`);
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
        const valOf = c => c.from === 'list' ? (getPath(pd, c.path) || '-') : (det ? getPath(det, c.path) || '-' : '-');
        const tr = el('tr');
        const cb = el('input', { type: 'checkbox', checked: ov.selected.has(pd) });
        cb.addEventListener('change', () => {
          if (cb.checked) ov.selected.add(pd);
          else ov.selected.delete(pd);
          ov.updCount();
          ov.syncGroupCheck(g);
        });
        const jk = pd.jenis_kelamin || '';
        const jkCls = /^(l|p)/i.test(jk) ? (/^l/i.test(jk) ? 'L' : 'P') : '';
        const jkTd = el('td', 'jk' + (jkCls ? ' ' + jkCls : ''), '');
        if (jkCls) jkTd.append(el('span', 'pill', jk)); else jkTd.textContent = jk;
        const tds = [
          el('td', {}, cb),
          el('td', 'c', pd.nama || ''),
          el('td', 'c', pd.nisn || ''),
          jkTd,
          el('td', 'c', pd.tanggal_lahir || ''),
          el('td', 'c', [pd.rombel, pd.tingkat].filter(Boolean).join(' / '))
        ];
        chosenCols.forEach(c => tds.push(el('td', 'c', valOf(c))));
        const dtBtn = el('button', 'dtl', 'Detail');
        dtBtn.addEventListener('click', () => withBtnSpin(dtBtn, () => openDetail(pd, g.sid)));
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

    const hasCol = (path) => ov.cols.some(c => c.path.length === path.length && c.path.every((x, i) => x === path[i]));
    ov.addListCols = (pd) => {
      const flat = [];
      const walk = (o, path) => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === 'object') walk(v, [...path, k]);
          else flat.push([...path, k]);
        }
      };
      walk(pd, []);
      for (const p of flat) {
        if (fixedLeafSet.has(p[p.length - 1])) continue;
        if (!hasCol(p)) ov.cols.push({ path: p, label: p.join(' > '), from: 'list' });
      }
    };
    ov.addDetailCols = (det) => {
      const flat = [];
      const walk = (o, path) => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === 'object') walk(v, [...path, k]);
          else flat.push([...path, k]);
        }
      };
      walk(det, []);
      for (const p of flat) {
        if (fixedLeafSet.has(p[p.length - 1])) continue;
        if (!hasCol(p)) ov.cols.push({ path: p, label: p.join(' > '), from: 'detail' });
      }
    };
    ov.seedDetailOnce = async () => {
      if (ov.detailSeeded) return;
      ov.detailSeeded = true;
      const g0 = ov.groups.find(g => g.students.length);
      if (!g0) return;
      const pd = g0.students[0];
      const PD_id = pd.peserta_didik_id;
      if (!PD_id) return;
      const r = await fetchDetail(PD_id, g0.sid);
      if (r.ok) { ov.addDetailCols(r.det); renderCols(); ov.rebuildTables(); }
    };

    const renderCols = () => {
      colsPanel.innerHTML = '';
      const renderFixed = (title, colsArr) => {
        const g = el('div', 'colgrp');
        const gh = el('label', 'coltab');
        const cb = el('input', { type: 'checkbox', checked: colsArr.every(c => ov.fixedChosen.has(c.key)) });
        cb.addEventListener('change', () => {
          colsArr.forEach(c => cb.checked ? ov.fixedChosen.add(c.key) : ov.fixedChosen.delete(c.key));
        });
        const n = colsArr.filter(c => ov.fixedChosen.has(c.key)).length;
        gh.append(cb, el('b', {}, title), el('span', 'cnt', `${n}/${colsArr.length}`));
        const grid = el('div', 'colgrid');
        g.append(gh, grid);
        for (const c of colsArr) {
          const l = el('label', 'colc');
          const ccb = el('input', { type: 'checkbox', checked: ov.fixedChosen.has(c.key) });
          ccb.addEventListener('change', () => {
            if (ccb.checked) ov.fixedChosen.add(c.key);
            else ov.fixedChosen.delete(c.key);
          });
          l.title = c.label;
          l.append(ccb, c.label);
          grid.append(l);
        }
        colsPanel.append(g);
      };
      renderFixed('Sekolah', schoolCols);
      renderFixed('Peserta Didik', pdCols);
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
            l.title = c.path.join(' > ');
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
      app.root.append(m);
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
        ov.addDetailCols(det);
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
      if (ov.openCols) { renderCols(); withBtnSpin(bCols, () => ov.seedDetailOnce()); }
    });
    go.addEventListener('click', () => {
      const items = [];
      const map = new Map(ov.groups.flatMap(g => g.students.map(pd => [pd, { school: g.school, sid: g.sid, pd }])));
      for (const pd of ov.selected) {
        const it = map.get(pd);
        if (it) items.push(it);
      }
      ov.phase = 'progress';
      tb.style.display = 'none';
      colsPanel.style.display = 'none';
      list.innerHTML = '';
      const prog = el('div', 'prog');
      prog.innerHTML = '<div class="ptitle">Menarik detail peserta didik…</div><div class="pbar"><div class="pfill"></div></div><div class="pstat"></div><div class="pnow"></div>';
      list.append(prog);
      ov.prog = prog;
      resolve(items);
    });
    bad.addEventListener('click', () => { app.root.remove(); resolve('__CANCEL__'); });

    app.setHead('Pilih Peserta Didik');
    ov.groups.forEach(ov.buildGroup);
    if (rawSample) ov.addListCols(rawSample);
    ov.updCount();
    q.focus();
  });

  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const pdKeys = ['nama', 'jenis_kelamin', 'tanggal_lahir', 'nama_ibu_kandung', 'nik', 'nisn', 'last_update', 'rombel', 'tingkat', 'peserta_didik_id', 'rombongan_belajar_id'];
  const schoolCols = [
    { key: 'sekolah_id', label: 'sekolah_id', get: (_p, _d, _s, sid) => sid },
    { key: 'npsn', label: 'npsn', get: (_p, _d, s) => s.npsn },
    { key: 'nama_sekolah', label: 'nama_sekolah', get: (_p, _d, s) => s.nama },
    { key: 'bentuk', label: 'bentuk', get: (_p, _d, s) => s.bentuk },
    { key: 'kecamatan', label: 'kecamatan', get: (_p, _d, s) => s.kec },
    { key: 'kabupaten', label: 'kabupaten', get: (_p, _d, s) => s.kab }
  ];
  const pdCols = pdKeys.map(k => ({ key: 'pd:' + k, label: k, get: (pd) => pd[k] }));
  const fixedLeafSet = new Set([...schoolCols.map(c => c.key), ...pdKeys]);
  const chosenCols = () => ovS ? [...ovS.chosen].sort((a, b) => a - b).map(i => ovS.cols[i]) : [];
  const chosenExportCols = () => {
    if (!ovS) return [];
    const fixed = ovS.fixedChosen;
    return [
      ...schoolCols.filter(c => fixed.has(c.key)),
      ...pdCols.filter(c => fixed.has(c.key)),
      ...chosenCols()
    ];
  };
  let headerLine = [];
  const lines = [];
  const jsonRows = [];
  const doDownload = (msg) => {
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `peserta_didik_${filterName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    if (msg) note(msg);
    note(`CSV terdownload: ${lines.length - 1} baris`);
  };
  const doDownloadJson = (msg) => {
    const blob = new Blob([JSON.stringify(jsonRows, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `peserta_didik_${filterName}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    if (msg) note(msg);
    note(`JSON terdownload: ${jsonRows.length} baris`);
  };

  let nPd = 0, nErr = 0, nDetailFetched = 0, nDetailCached = 0, nDetailFail = 0, t0 = Date.now(), curSchool = 0, gatheredCount = 0;
  let nowSchool = null;
  const detailSchoolsLogged = new Set();
  let phase2 = false;
  let phase2Total = 0;
  let poolLine = '';
  let aborted = false;
  let filtered = [];

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
        cacheHits: nCacheHits,
        errorSekolah: nErr,
        ratePerDetik: elapsed ? +((phase2 ? nPd : gatheredCount) / elapsed).toFixed(1) : 0,
        paused: ctrl.paused
      };
    },
    download: doDownload,
    downloadJson: doDownloadJson,
    clearCache: async () => { await dbClear(); detailCache.clear(); note('🧹 cache detail dihapus'); },
    forceRefresh: async () => { if (!gatheredList.length) { note('⚠ belum ada data siswa terkumpul'); return 0; } await runForceRefreshMode(); return nPd; },
    refreshCache: async () => { const n = await dbRefresh(); note(`⏱ cache diperpanjang: ${n} record (TTL dihitung ulang, ${CACHE_TTL_DAYS} hari)`); return n; },
    setConcurrency: (n) => {
      if (!n) return ctrl.targetConc;
      n = Math.max(1, parseInt(n) || 0);
      ctrl.targetConc = n;
      if (ctrl.schoolConc < n) ctrl.schoolConc = n;
      note('⚙ concurrency diatur ke ' + n);
      updConcWidget();
      return n;
    },
    audit: () => window._fetchAudit || null,
    getDropped: () => window._fetchAudit ? { npsn: window._fetchAudit.droppedNpsn, jenjang: window._fetchAudit.droppedJenjang } : null
  };

  const buildStatus = () => {
    const elapsed = (Date.now() - t0) / 1000;
    const prog = phase2 ? nPd : gatheredCount;
    const rate = elapsed ? (prog / elapsed).toFixed(1) : '0.0';
    const msg = `siswa ${prog} | sekolah ${phase2 && nowSchool ? nowSchool.npsn : curSchool}/${filtered.length} | detail fetched ${nDetailFetched}, cache-hit ${nCacheHits}, cached ${nDetailCached}, gagal ${nDetailFail} | ${rate}/dtk`;
    setTitle(msg);
    return msg;
  };
  const updProg = () => {
    if (!ovS || ovS.phase !== 'progress' || !ovS.prog) return;
    const total = phase2Total || 1;
    const pct = Math.min(100, Math.round((nPd / total) * 100));
    const fill = ovS.prog.querySelector('.pfill');
    const st = ovS.prog.querySelector('.pstat');
    if (fill) fill.style.width = pct + '%';
    if (st) st.textContent = `siswa ${nPd}/${total} (${pct}%) · fetched ${nDetailFetched}, cache-hit ${nCacheHits}, gagal ${nDetailFail} · ${(t0 ? (nPd / ((Date.now() - t0) / 1000)).toFixed(1) : 0)}/dtk`;
    const now = ovS.prog.querySelector('.pnow');
    if (now) now.textContent = nowSchool ? 'Sekolah: ' + nowSchool.npsn + ' · ' + nowSchool.nama : '';
  };
  const render = () => {
    app.renderLog();
    app.setStatus(buildStatus());
    updProg();
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

  const app = createApp();
  app.setHead('Fetch PD Dapodik v2.5');
  app.log('━━━ FETCH PD DAPODIK v2.5 ━━━');
  app.log('filter: hanya SISWA AKTIF + rombel & tingkat terisi');
  app.log(`detail: paralel=${CONCURRENCY} (hanya siswa terpilih & kolom detail) — cache IndexedDB ${CACHE_TTL_DAYS} hari`);
  app.log(`WAF: floor ${Math.max(4, Math.floor(CONCURRENCY / 4))} paralel, recovery 30dtk — parity tak lagi jatuh ke 1. Atur live: window._fetch.setConcurrency(n)`);
  app.log('kontrol: window._fetch.pause() / .resume() / .stop() / .download() / .downloadJson() / .clearCache() / .forceRefresh() / .setConcurrency(n)');
  app.log('console: hanya dipakai sebagai pinger ke server (jaga WAF).');

  const base = {
    postkolom: 'yes', sp_nama: 'on', sp_npsn: 'on', sp_bentuk: 'on',
    sp_kecamatan: 'on', sp_kab: 'on', bentukpendidikan: '0', statussekolah: '0'
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  setTitle('[1/5] ambil rekapsp...');
  app.setHead('[1/5] Ambil rekapsp...');
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
    app.log(`rekapsp field="${extra}": ${rows.length} sekolah, kolom id=${idCol} (${header[idCol] || '-'})`);
    if (idCol >= 0) break;
  }
  if (!rows.length) { app.log('gagal ambil rekapsp:', JSON.stringify(header).slice(0, 300)); return; }

  const field = h => header.indexOf(h);
  const provCol = header.findIndex(h => /^prov/i.test(String(h)));
  let schoolsRaw = rows.map(r => ({
    id: idCol >= 0 ? r[idCol] : null,
    nama: r[field('Nama Satuan Pendidikan')] ?? r[0],
    npsn: String(r[field('NPSN')] ?? r[1] ?? '').trim(),
    bentuk: String(r[field('Bentuk Pendidikan')] ?? r[2] ?? '').trim(),
    kec: r[field('Kecamatan')] ?? r[3],
    kab: r[field('Kabupaten/Kota')] ?? r[4],
    prov: provCol >= 0 ? r[provCol] : ''
  }));
  const droppedNpsn = schoolsRaw.filter(s => !/^\d{8}$/.test(s.npsn));
  // v2.5 permissive NPSN: tetap tampilkan semua 1040 (termasuk NPSN non-8-digit seperti NP259283), hanya log warning
  let schools = schoolsRaw.filter(s => String(s.npsn).trim() !== '');
  if (droppedNpsn.length) {
    app.log(`ℹ NPSN tidak 8 digit: ${droppedNpsn.length} sekolah (tetap ditampilkan, permissive) — ` + droppedNpsn.slice(0,5).map(s=>`"${s.npsn}" ${s.nama} [${s.bentuk}]`).join(' | ') + (droppedNpsn.length>5?` (+${droppedNpsn.length-5} lagi)`:''));
    app.log(`   → total setelah NPSN permissive: ${schools.length} (raw ${schoolsRaw.length}, strict 8-digit would be ${schoolsRaw.length - droppedNpsn.length})`);
  }
  if (provCol < 0) app.log('⚠ kolom provinsi tak ditemukan di rekapsp — opsi Provinsi dinonaktifkan.');

  // v2.5 permissive: tampilkan semua jenjang, hanya log yang non-SMA/SMK/SLB/MA (tidak dibuang)
  const allowed = /^(SMA|SMK|SLB|MA)\b/i;
  const droppedJenjang = schools.filter(s => !allowed.test(s.bentuk));
  if (droppedJenjang.length) {
    app.log(`ℹ jenjang non-SMA/SMK/SLB/MA: ${droppedJenjang.length} sekolah (tetap ditampilkan, permissive) — ` + droppedJenjang.slice(0,5).map(s=>`[${s.bentuk||'?'}] ${s.npsn} ${s.nama}`).join(' | ') + (droppedJenjang.length>5?` (+${droppedJenjang.length-5} lagi)`:''));
  } else {
    app.log(`filter jenjang: 0 dibuang (permissive) — semua ${schools.length} sekolah ditampilkan (SMA/SMK/SLB/MA + lainnya)`);
  }
  // audit hooks — tanpa membuang data (sinkron 1040)
  const schoolsStrict = schools.filter(s => allowed.test(s.bentuk) && /^\d{8}$/.test(s.npsn));
  if (schoolsStrict.length !== schools.length) {
    app.log(`ℹ mode strict (8-digit + SMA/SMK/SLB/MA) akan jadi ${schoolsStrict.length} sekolah (selisih ${schools.length - schoolsStrict.length})`);
  }
  window._fetchAudit = { rawRows: rows.length, afterNpsn: schools.length, droppedNpsn, droppedJenjang, strictCount: schoolsStrict.length, schoolsAll: schools };

  const kabList = [...new Set(schools.map(s => s.kab).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const provList = [...new Set(schools.map(s => s.prov).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const provAvail = provList.length > 0;

  app.setHead('Filter — level');
  const level = await app.ask({
    title: 'Pilih level filter',
    desc: 'Kosong/Semua = semua sekolah. Pilih salah satu level untuk memfilter.',
    buttons: [
      { label: 'Semua', value: '' },
      ...(provAvail ? [{ label: 'Provinsi', value: 'prov' }] : []),
      { label: 'Kabupaten', value: 'kab' },
      { label: 'Kecamatan', value: 'kec' },
      { label: 'Sekolah', value: 'sek' }
    ]
  });

  filtered = schools;
  let filterName = 'semua';
  if (level === 'prov' || level === 'kab' || level === 'kec' || level === 'sek') {
    if (provAvail && level === 'prov') {
      app.setHead('Pilih Provinsi');
      const pickedProv = await app.askChecklist('Pilih provinsi (kosong = semua)', provList);
      const provSet = pickedProv || new Set(provList);
      filtered = schools.filter(s => provSet.has(s.prov));
      filterName = [...provSet].sort().join('-');
    } else {
      app.setHead('Pilih Kabupaten');
      const cachedKab = await cachedDistricts();
      const pickedKab = await app.askChecklist('Pilih kabupaten (kosong = semua)', kabList, { badge: k => cachedKab.has(k) ? 'cache' : null });
      const kabSet = pickedKab || new Set(kabList);
      const kabNames = [...kabSet].sort();
      if (level === 'kab') {
        filtered = schools.filter(s => kabSet.has(s.kab));
        filterName = kabNames.join('-');
      } else {
        const baseSchools = schools.filter(s => kabSet.has(s.kab));
        const kecList = [...new Set(baseSchools.map(s => s.kec).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        app.setHead('Pilih Kecamatan');
        const pickedKec = await app.askChecklist('Pilih kecamatan (kosong = semua)', kecList);
        const kecSet = pickedKec || new Set(kecList);
        const kecNames = [...kecSet].sort();
        if (level === 'kec') {
          filtered = baseSchools.filter(s => kecSet.has(s.kec));
          filterName = kabNames.join('-') + '_' + kecNames.join('-');
        } else {
          const subset = baseSchools.filter(s => kecSet.has(s.kec));
          app.setHead('Pilih Sekolah');
          const pickedSek = await app.askChecklist('Pilih sekolah (kosong = semua)', subset.map(s => `${s.nama} — ${s.npsn} — ${s.kab} — ${s.kec}`));
          if (pickedSek) {
            const set = new Set(subset.map(s => `${s.nama} — ${s.npsn} — ${s.kab} — ${s.kec}`));
            filtered = subset.filter(s => set.has(`${s.nama} — ${s.npsn} — ${s.kab} — ${s.kec}`));
          } else {
            filtered = subset;
          }
          filterName = filtered.map(s => s.nama).join('-');
        }
      }
    }
  }
  filterName = slug(filterName);
  app.log(`filter: ${filtered.length} sekolah (dari ${schools.length})`);
  if (!filtered.length) { app.log('tidak ada hasil'); return; }

  app.setHead('Filter Kelas');
  const klsSet = await app.askChecklist('Filter kelas? (kosong = semua)', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
  klsFilter = (() => {
    if (!klsSet) return null;
    const arr = [...klsSet].map(Number).filter(n => n >= 1 && n <= 13);
    return arr.length ? new Set(arr) : null;
  })();
  if (klsFilter) app.log('filter kelas:', [...klsFilter].sort((a,b)=>a-b).join(', '));

  setTitle(`[2/5] kumpulkan siswa (paralel=${SCHOOL_CONCURRENCY})...`);
  app.setHead('[2/5] Mengumpulkan siswa...');
  ctrl.targetConc = SCHOOL_CONCURRENCY;
  ctrl.schoolConc = SCHOOL_CONCURRENCY;
  const gatherAll = async () => {
    gatheredCount = 0;
    let res = await dynamicPool(filtered, gatherSchool);
    gatheredList = res.filter(Boolean);
    const totalGathered = gatheredList.reduce((a, g) => a + g.students.length, 0);
    if (klsFilter && totalGathered === 0) {
      app.log('⚠ filter kelas tak cocok dengan data (0 siswa) — filter dimatikan, ulangi tanpa filter.');
      klsFilter = null;
      res = await dynamicPool(filtered, gatherSchool);
      gatheredList = res.filter(Boolean);
    }
  };

  let gatheredList = [];
  await gatherAll();
  const totalGathered = gatheredList.reduce((a, g) => a + g.students.length, 0);
  app.log(`terkumpul ${totalGathered} siswa dari ${gatheredList.length} sekolah`);
  if (ctrl.stopped || aborted) {
    cleanup();
    app.log('⏹ dihentikan saat kumpul siswa — tidak ada CSV.');
    app.showDone('Dihentikan', 'Tidak ada CSV. Lihat log untuk detail.');
    return;
  }

  const tarikDetail = async (sel, needDetail, force = false) => {
    phase2 = true;
    phase2Total = sel.length;
    detailSchoolsLogged.clear();
    nowSchool = null;
    ctrl.targetConc = CONCURRENCY;
    ctrl.schoolConc = CONCURRENCY;
    updConcWidget();
    return dynamicPool(sel, async (item) => {
      const { school, sid, pd } = item;
      nowSchool = school;
      if (!detailSchoolsLogged.has(sid)) { detailSchoolsLogged.add(sid); note('detail ▸ ' + school.npsn + ' · ' + school.nama); }
      const PD_id = pd.peserta_didik_id;
      let det = null;
      if (needDetail) {
        det = force ? null : detailCache.get(PD_id);
        if (!det) {
          const r = await fetchDetail(PD_id, sid, { force });
          if (r.ok) {
            det = r.det;
            detailCache.set(PD_id, det);
            nDetailFetched++;
            if (ctrl.schoolConc === 1) await sleep(20);
          } else {
            if (r.wafAbort) { aborted = true; ctrl.stopped = true; }
            nDetailFail++;
          }
        } else nDetailCached++;
      }
      nPd++;
      updProg();
      return { item, det };
    });
  };

  const runCacheMode = async () => {
    const sel = gatheredList.flatMap(g => g.students.map(pd => ({ school: g.school, sid: g.sid, pd })));
    if (!sel.length) { cleanup(); app.log('tidak ada siswa untuk di-cache.'); return; }
    app.log(`cache mode: ${sel.length} siswa akan di-cache`);
    setTitle(`[3/5] cache detail ${sel.length} siswa...`);
    app.setHead(`[3/5] Cache detail ${sel.length} siswa`);
    await tarikDetail(sel, true);
    cleanup();
    setTitle(`[4/5] cache selesai: ${nPd} siswa`);
    if (aborted) app.log('⚠ dihentikan saat validasi WAF — cache sebagian tersimpan.');
    if (ctrl.stopped) app.log('⏹ dihentikan via window._fetch.stop() — cache sebagian tersimpan.');
    app.log(`cache selesai: ${nPd} siswa, fetched ${nDetailFetched}, cache-hit ${nCacheHits}, cached ${nDetailCached}, gagal ${nDetailFail}`);
    app.showDone('Cache Selesai',
      `<b>${nPd} siswa</b> di-cache.<br>fetched ${nDetailFetched}, cache-hit ${nCacheHits} (IndexedDB), cached ${nDetailCached} (session), gagal ${nDetailFail}<br>Cache di IndexedDB (TTL ${CACHE_TTL_DAYS} hari). Jalankan lagi nanti → detail tidak di-fetch ulang.`);
    setTitle('[5/5] cache selesai');
  };

  const runRefreshMode = async () => {
    cleanup();
    const n = await dbRefresh();
    app.log(`cache diperpanjang: ${n} record (TTL dihitung ulang dari sekarang, ${CACHE_TTL_DAYS} hari)`);
    app.showDone('Cache Diperpanjang',
      `<b>${n} record</b> cache diperbarui.<br>TTL dihitung ulang dari sekarang (${CACHE_TTL_DAYS} hari).`);
    setTitle('cache selesai');
  };

  const runForceRefreshMode = async () => {
    pageCache.clear();
    detailCache.clear();
    await gatherAll();
    const sel = gatheredList.flatMap(g => g.students.map(pd => ({ school: g.school, sid: g.sid, pd })));
    if (!sel.length) { cleanup(); app.log('tidak ada siswa untuk di-tarik ulang.'); return; }
    app.log(`tarik ulang cache: ${sel.length} siswa (force re-fetch, overwrite IndexedDB)`);
    setTitle(`[3/5] tarik ulang cache ${sel.length} siswa...`);
    app.setHead(`[3/5] Tarik Ulang Cache ${sel.length} siswa`);
    await tarikDetail(sel, true, true);
    cleanup();
    setTitle(`[4/5] tarik ulang selesai: ${nPd} siswa`);
    if (aborted) app.log('⚠ dihentikan saat validasi WAF — cache sebagian diperbarui.');
    if (ctrl.stopped) app.log('⏹ dihentikan via window._fetch.stop() — cache sebagian diperbarui.');
    app.log(`tarik ulang selesai: ${nPd} siswa, fetched ${nDetailFetched}, cache-hit ${nCacheHits}, cached ${nDetailCached}, gagal ${nDetailFail}`);
    app.showDone('Tarik Ulang Cache Selesai',
      `<b>${nPd} siswa</b> di-refresh & disimpan ke IndexedDB.<br>fetched ${nDetailFetched}, cache-hit ${nCacheHits} (IndexedDB), cached ${nDetailCached} (session), gagal ${nDetailFail}<br>Cache di IndexedDB (TTL ${CACHE_TTL_DAYS} hari).`);
    setTitle('[5/5] tarik ulang selesai');
  };

  app.setHead('Pilih Mode');
  const mode = await app.ask({
    title: 'Pilih tindakan',
    desc: 'Cache Data Siswa: ambil & simpan detail ke IndexedDB untuk SEMUA siswa hasil filter — tanpa CSV/JSON. Ambil & Export CSV: alur biasa (pilih siswa lalu export). Ambil & Export JSON: sama tapi export file .json (array of objects).',
    buttons: [
      { label: 'Cache Data Siswa', value: 'cache' },
      { label: 'Ambil & Export CSV', value: 'export' },
      { label: 'Ambil & Export JSON', value: 'export_json' },
      { label: 'Perpanjang Cache', value: 'refresh' },
      { label: 'Tarik Ulang Cache', value: 'forcerefresh' },
      { label: 'Batal', value: '__CANCEL__' }
    ]
  });
  if (mode === '__CANCEL__') { cleanup(); app.log('dibatalkan.'); return; }
  if (mode === 'cache') { await runCacheMode(); return; }
  if (mode === 'refresh') { await runRefreshMode(); return; }
  if (mode === 'forcerefresh') { await runForceRefreshMode(); return; }

  const exportJson = mode === 'export_json';

  app.setHead('[3/5] Pilih Peserta Didik');
  setTitle('[3/5] pilih siswa di overlay...');
  const sel = await showSelection(gatheredList);
  if (sel === '__CANCEL__') {
    cleanup();
    app.log('pemilihan dibatalkan — tidak ada CSV.');
    return;
  }
  if (!sel.length) {
    cleanup();
    app.log('tidak ada siswa dipilih — tidak ada CSV.');
    return;
  }
  app.log(`dipilih ${sel.length} siswa`);

  const expCols = chosenExportCols();
  if (!expCols.length) {
    cleanup();
    app.log('tidak ada kolom dipilih untuk export — tidak ada CSV.');
    return;
  }
  headerLine = expCols.map(c => c.label);
  lines.push(headerLine.map(esc).join(','));

  phase2 = true;
  phase2Total = sel.length;
  ctrl.targetConc = CONCURRENCY;
  ctrl.schoolConc = CONCURRENCY;
  setTitle(`[4/5] tarik detail ${sel.length} siswa (paralel=${CONCURRENCY})...`);
  app.setHead(`[4/5] Tarik detail ${sel.length} siswa`);
  const cols = chosenCols();
  const needDetail = cols.some(c => c.from === 'detail');
  const results = await tarikDetail(sel, needDetail);

  for (const r of results) {
    if (!r) continue;
    const { item, det } = r;
    const { school, sid, pd } = item;
    const row = expCols.map(c => c.get ? c.get(pd, det, school, sid) : (c.from === 'list' ? getPath(pd, c.path) : getPath(det, c.path)));
    lines.push(row.map(esc).join(','));
    const rowObj = {};
    expCols.forEach((c, idx) => { rowObj[c.label] = row[idx]; });
    jsonRows.push(rowObj);
  }

  cleanup();
  setTitle(`[4/5] selesai: ${nPd} siswa`);
  if (aborted) app.log('⚠ dihentikan user saat validasi WAF — hasil sebagian terdownload.');
  if (ctrl.stopped) app.log('⏹ dihentikan user via window._fetch.stop() — hasil sebagian terdownload.');
  app.log(`selesai: ${filtered.length} sekolah, ${nPd} peserta didik, ${nErr} sekolah error, detail fetched ${nDetailFetched}, cached ${nDetailCached}, gagal ${nDetailFail}`);
  const today = new Date().toISOString().slice(0, 10);
  if (exportJson) {
    app.showDone('Selesai', `<b>${nPd} siswa</b> terunduh.<br>file JSON: <code>peserta_didik_${filterName}_${today}.json</code><br>detail fetched ${nDetailFetched}, cache-hit ${nCacheHits}, cached ${nDetailCached}, gagal ${nDetailFail}`);
  } else {
    app.showDone('Selesai', `<b>${nPd} siswa</b> terunduh.<br>file CSV: <code>peserta_didik_${filterName}_${today}.csv</code><br>JSON juga tersedia via window._fetch.downloadJson()<br>detail fetched ${nDetailFetched}, cache-hit ${nCacheHits}, cached ${nDetailCached}, gagal ${nDetailFail}`);
  }
  app.renderLog();
  app.setStatus('');
  if (exportJson) {
    doDownloadJson();
    setTitle('[5/5] JSON terdownload');
  } else {
    doDownload();
    setTitle('[5/5] CSV terdownload');
  }
})();
