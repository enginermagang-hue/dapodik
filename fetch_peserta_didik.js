(async () => {
  const URL_REKAP = 'https://datadik.kemendikdasmen.go.id/ma74/rekapsp';
  const URL_REF = 'https://datadik.kemendikdasmen.go.id/refsp/q/B0C3969D-F031-43FD-888F-7C6A280ABBBA';
  const URL_PD = id => `https://datadik.kemendikdasmen.go.id/ma74/sekolahpd/${id}/`;
  const URL_DET = (pd_id, sekolah_id) => `https://datadik.kemendikdasmen.go.id/manage/detailpd/${pd_id}/${sekolah_id}`;
  const RETRIES = 3;
  const DELAY_SCHOOL_MS = 400;
  const DELAY_PAGE_MS = 100;
  const CONCURRENCY = 4;
  const SCHOOL_CONCURRENCY = 2;
  const LOG_EVERY = 25;

  const setTitle = t => { try { document.title = t; } catch (e) {} };
  const slug = s => String(s).replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_').slice(0, 80);
  const pad = (n) => String(n).padStart(2, '0');
  const ts = () => `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:${pad(new Date().getSeconds())}`;
  const log = (...a) => console.log(`[${ts()}]`, ...a);
  const banner = () => {
    console.log('%c━━━ FETCH PD DAPODIK ━━━', 'color:#0af;font-weight:bold;font-size:14px');
    console.log('  • kontrol:    window._fetch.pause() / .resume() / .stop()');
    console.log('  • status:     window._fetch.stats()');
    console.log('  • csv cepat:   window._fetch.download()');
    log('  • delay:      sekolah', DELAY_SCHOOL_MS, 'page', DELAY_PAGE_MS, 'ms');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━', 'color:#0af');
  };

  const cleanFetch = (() => {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    document.body.appendChild(f);
    return f.contentWindow.fetch.bind(f.contentWindow);
  })();

  const ctrl = { paused: false, stopped: false, schoolConc: SCHOOL_CONCURRENCY };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pauseWhile = async () => { while (ctrl.paused) await sleep(200); };
  const wafHits = [];
  const wafHit = () => {
    const now = Date.now();
    wafHits.push(now);
    while (wafHits.length && now - wafHits[0] > 30000) wafHits.shift();
    if (wafHits.length >= 3 && ctrl.schoolConc > 1) {
      ctrl.schoolConc = 1;
      log('⚠ WAF berulang (3x/30dtk) — paralel sekolah turun ke 1. Akan naik lagi setelah 2 menit bersih.');
    }
  };
  const wafWatchdog = setInterval(() => {
    const now = Date.now();
    if (ctrl.schoolConc === 1 && (!wafHits.length || now - wafHits[wafHits.length - 1] > 120000)) {
      ctrl.schoolConc = SCHOOL_CONCURRENCY;
      log('WAF bersih 2 menit — paralel sekolah kembali ke', SCHOOL_CONCURRENCY);
    }
  }, 30000);

  const isWaf = (res, body) => {
    if (res && res.status === 468) return true;
    if (body && /SafeLine|challenge|Access Forbidden/i.test(body.slice(0, 4000))) return true;
    return false;
  };
  const waitForWAF = async (ctx) => {
    wafHit();
    log('⚠ WAF/SafeLine terdeteksi saat:', ctx);
    setTitle('[WAF] selesaikan validasi SafeLine di halaman...');
    while (true) {
      const ok = prompt('Validasi SafeLine/WAF muncul di halaman? Selesaikan dulu (challenge), lalu klik OK untuk lanjut. (Klik Cancel untuk berhenti)');
      if (ok === null) throw new Error('dihentikan user (WAF)');
      try {
        const r = await cleanFetch('https://datadik.kemendikdasmen.go.id/manage', {
          method: 'GET', credentials: 'include', signal: AbortSignal.timeout(15000)
        });
        const t = await r.text();
        if (!isWaf(r, t)) { log('WAF selesai, lanjut...'); return; }
      } catch (e) { log('probe WAF gagal:', String(e)); }
      log('WAF masih aktif, ulangi validasi...');
    }
  };

  const withRetry = async (url, opts) => {
    for (let a = 1; a <= RETRIES; a++) {
      try {
        const res = await cleanFetch(url, opts);
        const text = await res.text();
        if (isWaf(res, text)) {
          await waitForWAF(url);
          continue;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return { ok: true, data: JSON.parse(text) };
      } catch (e) {
        if (/dihentikan user/.test(String(e))) return { ok: false, error: String(e), wafAbort: true };
        if (a === RETRIES) return { ok: false, error: String(e) };
        await new Promise(s => setTimeout(s, 2000 * a));
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
  const fetchAgama = async (PD_id, sekolah_id) => {
    for (let a = 1; a <= 2; a++) {
      try {
        const res = await cleanFetch(URL_DET(PD_id, sekolah_id), {
          method: 'GET',
          headers: { 'Accept': 'text/html,application/xhtml+xml', 'Referer': 'https://datadik.kemendikdasmen.go.id/manage' },
          signal: AbortSignal.timeout(10000)
        });
        const text = await res.text();
        if (isWaf(res, text)) {
          await waitForWAF(PD_id);
          continue;
        }
        if (!res.ok) return { ok: false, status: res.status, raw: text.slice(0, 200) };
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const dts = doc.querySelectorAll('dt');
        for (const dt of dts) {
          if (dt.textContent.trim().toLowerCase() === 'agama') {
            const dd = dt.nextElementSibling;
            if (dd) return { ok: true, agama: dd.textContent.trim().replace(/\s+/g, ' '), raw: text };
          }
        }
        return { ok: false, status: 200, raw: text.slice(0, 200), note: 'agama dt not found' };
      } catch (e) {
        if (/dihentikan user/.test(String(e))) return { ok: false, error: String(e), wafAbort: true };
        if (a === 2) return { ok: false, error: String(e) };
      }
    }
  };
  const agamaCache = new Map();
  const runPool = async (items, limit, worker) => {
    const results = new Array(items.length);
    let i = 0;
    const inFlight = new Array(limit).fill(0).map(async () => {
      while (true) {
        await pauseWhile();
        if (ctrl.stopped) return;
        const idx = i++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
      }
    });
    await Promise.all(inFlight);
    return results;
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
    log(`rekapsp field="${extra}": ${rows.length} sekolah, kolom id=${idCol} (${header[idCol] || '-'})`);
    if (idCol >= 0) break;
  }
  if (!rows.length) return log('gagal ambil rekapsp:', JSON.stringify(header).slice(0, 300));

  const field = h => header.indexOf(h);
  const schools = rows.map(r => ({
    id: idCol >= 0 ? r[idCol] : null,
    nama: r[field('Nama Satuan Pendidikan')] ?? r[0],
    npsn: String(r[field('NPSN')] ?? r[1] ?? ''),
    bentuk: r[field('Bentuk Pendidikan')] ?? r[2],
    kec: r[field('Kecamatan')] ?? r[3],
    kab: r[field('Kabupaten/Kota')] ?? r[4]
  })).filter(s => /^\d{8}$/.test(s.npsn));

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
  const level = prompt('Pilih level filter:\n1. Kabupaten\n2. Kecamatan\n3. Sekolah\n(kosong = semua)');

  let filtered = schools;
  let filterName = 'semua';
  if (level === '1' || level === '2' || level === '3') {
    const pickedKab = askPick(kabList, 'kabupaten');
    const kabSet = pickedKab || new Set(kabList);
    const kabNames = [...kabSet].sort();
    if (level === '1') {
      filtered = schools.filter(s => kabSet.has(s.kab));
      filterName = kabNames.join('-');
    } else {
      const baseSchools = schools.filter(s => kabSet.has(s.kab));
      const kecList = [...new Set(baseSchools.map(s => s.kec).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const pickedKec = askPick(kecList, 'kecamatan');
      const kecSet = pickedKec || new Set(kecList);
      const kecNames = [...kecSet].sort();
      if (level === '2') {
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
  filterName = slug(filterName);
  log(`filter: ${filtered.length} sekolah (dari ${schools.length})`);
  if (!filtered.length) return log('tidak ada hasil');

  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const pdKeys = ['nama', 'jenis_kelamin', 'tanggal_lahir', 'nama_ibu_kandung', 'nik', 'nisn', 'last_update', 'rombel', 'tingkat', 'peserta_didik_id', 'rombongan_belajar_id'];
  const headerLine = ['sekolah_id', 'npsn', 'nama_sekolah', 'bentuk', 'kecamatan', 'kabupaten', 'agama', ...pdKeys];
  const lines = [headerLine.map(esc).join(',')];
  const doDownload = (note) => {
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `peserta_didik_${filterName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    if (note) log(note);
    log(`CSV terdownload: ${lines.length - 1} baris`);
  };

  let nPd = 0, nErr = 0, nNoAgama = 0, nSampled = 0, t0 = Date.now(), curSchool = 0;
  let aborted = false;

  window._fetch = {
    pause: () => { ctrl.paused = true; log('⏸ pause — request berjalan selesai, sisanya tertahan'); },
    resume: () => { ctrl.paused = false; log('▶ resume'); },
    stop: () => { ctrl.stopped = true; log('⏹ stop — selesai setelah request aktif selesai'); },
    stats: () => {
      const elapsed = (Date.now() - t0) / 1000;
      return {
        sekolah: curSchool,
        totalSekolah: filtered.length,
        siswa: nPd,
        agamaKosong: nNoAgama,
        errorSekolah: nErr,
        ratePerDetik: elapsed ? +(nPd / elapsed).toFixed(1) : 0,
        paused: ctrl.paused
      };
    },
    download: doDownload
  };

  const keepAlive = setInterval(() => {
    cleanFetch('https://datadik.kemendikdasmen.go.id/manage', { method: 'GET', credentials: 'include', signal: AbortSignal.timeout(15000) })
      .catch(() => {});
  }, 60000);

  setTitle(`[2/5] mulai loop sekolah (paralel=${SCHOOL_CONCURRENCY}, siswa-pool=${CONCURRENCY})...`);
  await dynamicPool(filtered, async (s, i) => {
    if (ctrl.stopped) return;
    curSchool = i + 1;
    if ((i + 1) % 5 === 0 || i === 0) log(`[${i + 1}/${filtered.length}] ${s.npsn} ${s.kab}`);

    let sid = s.id;
    if (!sid) {
      const ref = await postForm(URL_REF, { q: s.npsn });
      if (ref.wafAbort) { aborted = true; ctrl.stopped = true; return; }
      if (ref.ok && Array.isArray(ref.data) && ref.data.length && ref.data[0][0]) sid = ref.data[0][0];
    }
    if (!sid) {
      nErr++;
      lines.push([esc(''), s.npsn, s.nama, s.bentuk, s.kec, s.kab, '', ...pdKeys.map(() => '')].map(esc).join(','));
      await sleep(DELAY_SCHOOL_MS);
      return;
    }

    const students = [];
    let page = 1;
    while (true) {
      const res = await getJson(URL_PD(sid) + page);
      if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) break;
      for (const pd of res.data) students.push(pd);
      page++;
      await sleep(DELAY_PAGE_MS);
    }

    if (students.length) log(`  ↳ ${s.npsn} ${students.length} siswa, pool agama...`);
    const results = await runPool(students, CONCURRENCY, async (pd) => {
      const PD_id = pd.peserta_didik_id;
      if (!PD_id) return { ...pd, __agama: '' };
      if (agamaCache.has(PD_id)) return { ...pd, __agama: agamaCache.get(PD_id) };
      const r = await fetchAgama(PD_id, sid);
      let ag = '';
      if (r.ok) {
        ag = r.agama || '';
        if (nSampled === 0) log('  [sample detailpd]', PD_id, 'agama=', JSON.stringify(ag));
      } else {
        if (r.wafAbort) { aborted = true; ctrl.stopped = true; }
        log('  [agama-gagal]', PD_id, r.status || r.error);
      }
      return { ...pd, __agama: ag };
    });

    for (let j = 0; j < results.length; j++) {
      const pd = results[j];
      nSampled++;
      const ag = pd.__agama || '';
      if (!ag) nNoAgama++;
      const row = [sid, s.npsn, s.nama, s.bentuk, s.kec, s.kab, esc(ag), ...pdKeys.map(k => esc(pd[k]))];
      lines.push(row.map(esc).join(','));
      nPd++;
      if (pd.__agama) agamaCache.set(pd.peserta_didik_id, ag);

      if (nSampled % LOG_EVERY === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = (nPd / elapsed).toFixed(1);
        const msg = `[siswa] ${nPd} total | sekolah ${curSchool}/${filtered.length} | agama-kosong ${nNoAgama} | rate ${rate}/s`;
        log(msg);
        setTitle(msg);
      }
    }

    await sleep(DELAY_SCHOOL_MS);
  });

  clearInterval(keepAlive);
  clearInterval(wafWatchdog);
  setTitle(`[4/5] selesai: ${nPd} siswa`);
  if (aborted) log('⚠ dihentikan user saat validasi WAF — hasil sebagian terdownload.');
  if (ctrl.stopped) log('⏹ dihentikan user via window._fetch.stop() — hasil sebagian terdownload.');
  log(`selesai: ${filtered.length} sekolah, ${nPd} peserta didik, ${nErr} sekolah error, ${nNoAgama} tanpa agama`);
  doDownload();
  setTitle('[5/5] CSV terdownload');
})();
