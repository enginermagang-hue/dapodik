(async () => {
  const URL_REKAP = 'https://datadik.kemendikdasmen.go.id/ma74/rekapsp';
  const URL_REF = 'https://datadik.kemendikdasmen.go.id/refsp/q/B0C3969D-F031-43FD-888F-7C6A280ABBBA';
  const URL_PD = id => `https://datadik.kemendikdasmen.go.id/ma74/sekolahpd/${id}/`;
  const RETRIES = 3;
  const SCHOOL_CONCURRENCY = 6;
  const PAGE_PREFETCH = 3;
  const PAGE_SOFT_EAGER = 2;

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
    if (/⏳/.test(m) || /diblokir|block/i.test(m)) return 'block';
    if (/WAF|SafeLine/i.test(m)) return 'waf';
    if (/^[🧹⏱✓]/.test(m) || /selesai:|terdownload|diperpanjang/i.test(m)) return 'ok';
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
    concWidget.title = 'Paralel fetch. WAF floor=' + wafFloor() + ', recovery 30dtk.';
  };
  const pauseWhile = async () => { while (ctrl.paused) await sleep(200); };

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
        if (n >= 1 && n <= 12) return n;
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
      if (foundEmpty) break;
    }
    return pages;
  };

  let rawSample = null;
  let klsFilter = null;
  let filtered = [];
  let hasSLB = false;
  let gatheredCount = 0;
  let curSchool = 0;
  let nErr = 0;
  let aborted = false;

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
    if (!sid) { nErr++; return { school: s, sid: null, count: 0, totalRaw: 0 }; }

    const cached = pageCache.get(sid);
    const pageObjs = cached || await fetchPagesParallel(sid, ctrl.schoolConc);
    if (!cached) pageCache.set(sid, pageObjs);

    const students = [];
    for (const p of pageObjs) {
      for (const pd of (p.data || [])) students.push(pd);
    }
    const totalRaw = students.length;
    if (statusField === null && students.length) detectStatusField(students[0]);
    if (!rawSample && students.length) rawSample = students[0];

    const beforeFilter = students.length;
    const dropAktif = students.filter(pd => !isActive(pd)).length;
    // hanya filter aktif (tidak pakai rombelTingkatTerisi sesuai permintaan)
    for (let x = students.length - 1; x >= 0; x--) {
      if (!isActive(students[x])) students.splice(x, 1);
    }
    if (beforeFilter !== students.length)
      note(`filter aktif: ${s.npsn} ${beforeFilter}->${students.length} (buang non-aktif ${dropAktif})`);

    // filter kelas jika ada — opsi A: SLB auto 1-12 jika kabupaten ada SLB
    const isSLB = /^SLB/i.test(s.bentuk);
    if (klsFilter && !(isSLB && hasSLB)) {
      const beforeKls = students.length;
      for (let x = students.length - 1; x >= 0; x--) {
        if (!klsFilter.has(klsOf(students[x]))) students.splice(x, 1);
      }
      if (beforeKls !== students.length) note(`filter kelas ${s.npsn}: ${beforeKls}->${students.length}`);
    } else if (isSLB && hasSLB) {
      // SLB otomatis 1-12: abaikan filter kelas, biarkan semua lolos
      if (klsFilter) note(`SLB auto 1-12: ${s.npsn} ${students.length} siswa (filter kelas diabaikan)`);
    }

    const count = students.length;
    gatheredCount += count;
    return { school: s, sid, count, totalRaw };
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
#__fp2o .lst{flex:1;overflow:auto;padding:10px 14px}
#__fp2o .g{margin-bottom:14px;border:1px solid #30363d;border-radius:10px;overflow:hidden;background:#161b22;box-shadow:0 2px 12px rgba(0,0,0,.3)}
#__fp2o table{width:100%;border-collapse:collapse;table-layout:fixed}
#__fp2o th{position:sticky;top:0;z-index:2;background:#161b22;color:#8b949e;font-weight:600;text-align:left;padding:7px 8px;border-bottom:1px solid #30363d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;letter-spacing:.3px}
#__fp2o td{text-align:left;padding:6px 8px;border-top:1px solid #21262d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}
#__fp2o tbody tr:nth-child(even){background:#11161d}
#__fp2o tbody tr:hover{background:#1c2128}
#__fp2o td.c{max-width:190px}
#__fp2o td.n{ text-align:right; font-variant-numeric: tabular-nums; }
#__fp2o .sum{padding:12px 14px;background:#161b22;border-top:1px solid #30363d;display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-weight:600}
#__fp2o .sum b{color:#58a6ff}
#__fp2o .prog{padding:28px}
#__fp2o .ptitle{font-size:16px;font-weight:700;color:#58a6ff;margin-bottom:14px}
#__fp2o .pbar{height:18px;background:#0d1117;border:1px solid #30363d;border-radius:999px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
#__fp2o .pfill{height:100%;width:0;background:linear-gradient(90deg,#238636,#2ea043,#3fb950);background-size:200% 100%;animation:fpShimmer 1.4s linear infinite;transition:width .25s}
#__fp2o .pstat{margin-top:10px;color:#8b949e;font-size:12px}
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
`;

  const createApp = () => {
    const style = el('style');
    style.textContent = overlayCSS;
    document.head.appendChild(style);
    const root = el('div');
    root.id = '__fp2o';
    const head = el('div', 'hd');
    const dot = el('span', 'dot');
    const headTitle = el('span', 't', 'Hitung Peserta Didik');
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

  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

  // --- app init ---
  const app = createApp();
  app.setHead('Hitung Peserta Didik — load rekapsp');
  app.log('━━━ HITUNG PESERTA DIDIK (aktif) ━━━');
  app.log('Sumber: datadik.kemendikdasmen.go.id — hanya hitung jumlah, tanpa tarik detail.');
  app.log(`Paralel sekolah=${SCHOOL_CONCURRENCY}, page prefetch=${PAGE_PREFETCH}`);
  app.log('Kontrol: window._hitung.pause() / .resume() / .stop() / .downloadCSV() / .setConcurrency(n)');

  let t0 = Date.now();
  let filterName = 'semua';

  // expose early for pause/stop even before filtered defined
  window._hitung = {
    pause: () => { ctrl.paused = true; note('⏸ pause'); },
    resume: () => { ctrl.paused = false; note('▶ resume'); },
    stop: () => { ctrl.stopped = true; note('⏹ stop'); },
    stats: () => ({ sekolah: curSchool, totalSekolah: filtered.length, totalAktif: gatheredCount, errorSekolah: nErr, paused: ctrl.paused }),
    setConcurrency: (n) => {
      if (!n) return ctrl.targetConc;
      n = Math.max(1, parseInt(n) || 0);
      ctrl.targetConc = n;
      if (ctrl.schoolConc < n) ctrl.schoolConc = n;
      note('⚙ concurrency diatur ke ' + n);
      updConcWidget();
      return n;
    }
  };

  const buildStatus = () => {
    const elapsed = (Date.now() - t0) / 1000;
    const rate = elapsed ? (gatheredCount / elapsed).toFixed(1) : '0.0';
    const msg = `siswa aktif ${gatheredCount} | sekolah ${curSchool}/${filtered.length || 0} | error ${nErr} | ${rate}/dtk`;
    setTitle(msg);
    return msg;
  };
  const render = () => {
    app.renderLog();
    app.setStatus(buildStatus());
  };
  const renderTimer = setInterval(render, 1000);
  const keepAlive = setInterval(() => {
    cleanFetch('https://datadik.kemendikdasmen.go.id/manage', { method: 'GET', credentials: 'include', signal: AbortSignal.timeout(15000) }).catch(() => {});
  }, 60000);
  const cleanup = () => {
    clearInterval(keepAlive);
    clearInterval(wafWatchdog);
    clearInterval(renderTimer);
  };

  // --- 1. ambil rekapsp ---
  setTitle('[1/4] ambil rekapsp...');
  app.setHead('[1/4] Ambil rekapsp...');
  const base = { postkolom: 'yes', sp_nama: 'on', sp_npsn: 'on', sp_bentuk: 'on', sp_kecamatan: 'on', sp_kab: 'on', bentukpendidikan: '0', statussekolah: '0' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  if (!rows.length) { app.log('gagal ambil rekapsp'); cleanup(); app.showDone('Gagal', 'Tidak bisa ambil rekapsp. Coba refresh halaman dan pastikan sudah login.'); return; }

  const field = h => header.indexOf(h);
  const provCol = header.findIndex(h => /^prov/i.test(String(h)));
  let schools = rows.map(r => ({
    id: idCol >= 0 ? r[idCol] : null,
    nama: r[field('Nama Satuan Pendidikan')] ?? r[0],
    npsn: String(r[field('NPSN')] ?? r[1] ?? ''),
    bentuk: r[field('Bentuk Pendidikan')] ?? r[2],
    kec: r[field('Kecamatan')] ?? r[3],
    kab: r[field('Kabupaten/Kota')] ?? r[4],
    prov: provCol >= 0 ? r[provCol] : ''
  })).filter(s => /^\d{8}$/.test(s.npsn));
  if (provCol < 0) app.log('⚠ kolom provinsi tak ditemukan — opsi Provinsi dinonaktifkan.');

  const allowed = /^(SMA|SMK|SLB|MA)(\s|$)/i;
  const discard = schools.filter(s => !allowed.test(s.bentuk)).length;
  if (discard) app.log(`filter jenjang: buang ${discard} sekolah, sisa ${schools.filter(s=>allowed.test(s.bentuk)).length} (SMA/SMK/SLB/MA).`);
  schools = schools.filter(s => allowed.test(s.bentuk));

  const kabList = [...new Set(schools.map(s => s.kab).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const provList = [...new Set(schools.map(s => s.prov).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const provAvail = provList.length > 0;

  app.setHead('Filter — level');
  const level = await app.ask({
    title: 'Pilih level filter',
    desc: 'Pilih cakupan sekolah yang akan dihitung. Kosong/Semua = semua sekolah.',
    buttons: [
      { label: 'Semua', value: '' },
      ...(provAvail ? [{ label: 'Provinsi', value: 'prov' }] : []),
      { label: 'Kabupaten', value: 'kab' },
      { label: 'Kecamatan', value: 'kec' },
      { label: 'Sekolah', value: 'sek' }
    ]
  });

  filtered = schools;
  if (level === 'prov' || level === 'kab' || level === 'kec' || level === 'sek') {
    if (provAvail && level === 'prov') {
      app.setHead('Pilih Provinsi');
      const pickedProv = await app.askChecklist('Pilih provinsi (kosong = semua)', provList);
      const provSet = pickedProv || new Set(provList);
      filtered = schools.filter(s => provSet.has(s.prov));
      filterName = [...provSet].sort().join('-');
    } else {
      app.setHead('Pilih Kabupaten');
      const pickedKab = await app.askChecklist('Pilih kabupaten (kosong = semua)', kabList);
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
          const labels = subset.map(s => `${s.nama} — ${s.npsn} — ${s.kab} — ${s.kec}`);
          const pickedSek = await app.askChecklist('Pilih sekolah (kosong = semua)', labels);
          if (pickedSek) {
            const set = new Set([...pickedSek]);
            filtered = subset.filter(s => set.has(`${s.nama} — ${s.npsn} — ${s.kab} — ${s.kec}`));
          } else {
            filtered = subset;
          }
          filterName = filtered.map(s => s.npsn).join('-') || kabNames.join('-') + '_' + kecNames.join('-');
        }
      }
    }
  }
  filterName = slug(filterName || 'semua');
  app.log(`filter: ${filtered.length} sekolah (dari ${schools.length})`);
  if (!filtered.length) { app.log('tidak ada hasil filter'); cleanup(); app.showDone('Selesai', 'Tidak ada sekolah sesuai filter.'); return; }

  app.setHead('Filter Kelas');
  const klsSet = await app.askChecklist('Filter kelas? (kosong = semua)', ['10', '11', '12']);
  klsFilter = (() => {
    if (!klsSet) return null;
    const arr = [...klsSet].map(Number).filter(n => n === 10 || n === 11 || n === 12);
    return arr.length ? new Set(arr) : null;
  })();
  hasSLB = filtered.some(s => /^SLB/i.test(s.bentuk));
  if (klsFilter) app.log('filter kelas:', [...klsFilter].sort((a,b)=>a-b).join(', ') + (hasSLB ? ' (SLB auto 1-12)' : ''));
  else app.log('filter kelas: semua' + (hasSLB ? ' (SLB auto 1-12)' : ''));

  // --- 3. hitung ---
  setTitle(`[2/4] hitung peserta didik aktif (paralel=${SCHOOL_CONCURRENCY})...`);
  app.setHead('[2/4] Menghitung peserta didik aktif...');
  app.content.innerHTML = '';
  const prog = el('div', 'prog');
  prog.innerHTML = '<div class="ptitle">Menghitung jumlah peserta didik aktif…</div><div class="pbar"><div class="pfill"></div></div><div class="pstat"></div><div class="pnow"></div>';
  app.content.append(prog);
  const updProg = () => {
    const total = filtered.length || 1;
    const pct = Math.min(100, Math.round((curSchool / total) * 100));
    const fill = prog.querySelector('.pfill');
    const st = prog.querySelector('.pstat');
    const now = prog.querySelector('.pnow');
    if (fill) fill.style.width = pct + '%';
    if (st) st.textContent = `sekolah ${curSchool}/${filtered.length} (${pct}%) · siswa aktif ${gatheredCount} · error ${nErr}`;
    if (now) now.textContent = curSchool>0 && filtered[curSchool-1] ? `Terakhir: ${filtered[curSchool-1].npsn} · ${filtered[curSchool-1].nama}` : '';
  };
  const progTimer = setInterval(updProg, 500);

  t0 = Date.now();
  curSchool = 0;
  gatheredCount = 0;
  rawSample = null;
  statusField = null;

  const results = await dynamicPool(filtered, gatherSchool);
  clearInterval(progTimer);
  const perSekolah = results.filter(Boolean);
  const totalAktif = perSekolah.reduce((a, r) => a + (r.count || 0), 0);
  const totalRaw = perSekolah.reduce((a, r) => a + (r.totalRaw || 0), 0);

  app.log(`terhitung ${totalAktif} siswa aktif (dari ${totalRaw} total raw) di ${perSekolah.length} sekolah`);

  if (ctrl.stopped || aborted) {
    cleanup();
    app.log('⏹ dihentikan — menampilkan hasil sebagian.');
  }

  // --- 4. tampilkan rekap + export csv ---
  const showRekap = () => {
    app.content.innerHTML = '';
    const tb = el('div', 'tb');
    const q = el('input', { type: 'search', placeholder: 'cari npsn / nama sekolah...' });
    const csvBtn = el('button', 'go', 'Download CSV');
    const closeBtn = el('button', {}, 'Tutup');
    tb.append(q, csvBtn, closeBtn);
    const lst = el('div', 'lst');
    const tableWrap = el('div', 'g');
    const tbl = el('table');
    const thead = el('thead');
    const trh = el('tr');
    ['No','NPSN','Nama Sekolah','Bentuk','Kabupaten','Kecamatan','Jumlah Aktif'].forEach(h => trh.append(el('th', {}, h)));
    thead.append(trh);
    tbl.append(thead);
    const tbody = el('tbody');
    perSekolah.forEach((r, idx) => {
      const tr = el('tr');
      tr.append(
        el('td', 'n', String(idx + 1)),
        el('td', 'c', r.school.npsn),
        el('td', 'c', r.school.nama),
        el('td', 'c', r.school.bentuk),
        el('td', 'c', r.school.kab),
        el('td', 'c', r.school.kec),
        el('td', 'n', String(r.count))
      );
      tr.dataset.search = `${r.school.npsn} ${r.school.nama} ${r.school.kab} ${r.school.kec}`.toLowerCase();
      tbody.append(tr);
    });
    // total row
    const trTot = el('tr');
    trTot.style.fontWeight = '700';
    trTot.style.background = '#1f2a33';
    trTot.append(el('td', '', ''), el('td', '', ''), el('td', 'c', 'TOTAL'), el('td', '', ''), el('td', '', ''), el('td', '', ''), el('td', 'n', String(totalAktif)));
    tbody.append(trTot);
    tbl.append(tbody);
    tableWrap.append(tbl);
    lst.append(tableWrap);
    const sum = el('div', 'sum');
    sum.innerHTML = `<span>Total sekolah: <b>${perSekolah.length}</b></span><span>Total siswa aktif: <b>${totalAktif}</b></span><span>Filter: <b>${filterName}</b></span><span>Error sekolah: <b>${nErr}</b></span>`;
    app.content.append(tb, lst, sum);
    app.setHead(`Hasil Hitung — ${totalAktif} siswa aktif dari ${perSekolah.length} sekolah`);
    app.setStatus(`total ${totalAktif} siswa aktif`);

    const applyFilter = () => {
      const qq = q.value.trim().toLowerCase();
      let visible = 0;
      for (const tr of tbody.querySelectorAll('tr')) {
        if (tr === trTot) continue;
        const show = !qq || (tr.dataset.search || '').includes(qq);
        tr.style.display = show ? '' : 'none';
        if (show) visible++;
      }
      trTot.style.display = '';
    };
    q.addEventListener('input', applyFilter);

    const doDownloadCSV = () => {
      const headerRow = ['npsn','nama_sekolah','bentuk','kabupaten','kecamatan','jumlah_aktif'];
      const lines = [headerRow.map(esc).join(',')];
      for (const r of perSekolah) {
        const row = [r.school.npsn, r.school.nama, r.school.bentuk, r.school.kab, r.school.kec, String(r.count)];
        lines.push(row.map(esc).join(','));
      }
      // total baris
      lines.push(['TOTAL','','','','', String(totalAktif)].map(esc).join(','));
      const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hitung_peserta_didik_${filterName}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      note(`CSV terdownload: ${perSekolah.length} sekolah, total ${totalAktif} siswa aktif`);
      app.renderLog();
    };
    csvBtn.addEventListener('click', doDownloadCSV);
    closeBtn.addEventListener('click', () => app.root.remove());

    // expose
    window._hitung.downloadCSV = doDownloadCSV;
    window._hitung.results = perSekolah;
    window._hitung.total = totalAktif;

    // auto-download optional? tidak, user klik manual sesuai request
  };

  showRekap();
  cleanup();
  setTitle(`[4/4] selesai: ${totalAktif} siswa aktif`);

  // update window._hitung final
  window._hitung.stats = () => ({
    filter: filterName,
    sekolah: perSekolah.length,
    totalSekolah: filtered.length,
    totalAktif,
    totalRaw,
    errorSekolah: nErr,
    kelasFilter: klsFilter ? [...klsFilter].sort().join(',') : 'semua'
  });

})();
