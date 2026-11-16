/* =========================================================================
   ui-panel.fragment.js
   FRAGMEN — bukan file yang dijalankan langsung.
   Disuntikkan oleh tools/build-userscript.py ke dalam IIFE scrape-lulusan.js
   untuk menghasilkan scrape-lulusan.user.js (Tampermonkey).

   Menyediakan satu fungsi: mountUI()
   ========================================================================= */

  const mountUI = () => {
    if (document.getElementById('dapo-panel')) return; // sudah terpasang

    if (!mountUI.coba) {
      console.log('%c[userscript] aktif', 'color:#2ecc71', location.pathname + location.hash);
    }

    // halaman Dapodik memuat konten secara AJAX -> panel bisa dipasang setelah itu
    const adaAplikasi = !!document.querySelector('#qsekolah') ||
      /refsp\/q\//i.test(document.documentElement.innerHTML);

    if (!adaAplikasi) {
      mountUI.coba = (mountUI.coba || 0) + 1;
      if (mountUI.coba === 1) {
        console.log('%c[userscript] menunggu halaman Dapodik siap…', 'color:#e6c07b');
      }
      if (mountUI.coba <= 240) { // ~2 menit
        setTimeout(mountUI, 500);
      } else {
        console.warn('[userscript] panel tidak dipasang: elemen Dapodik tidak terdeteksi. ' +
          'Pastikan sudah login dan berada di halaman Manajemen.');
      }
      return;
    }

    ensureSess();

    const el = document.createElement('div');
    el.id = 'dapo-panel';
    el.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'width:308px',
      'z-index:2147483647', 'background:#10161d', 'color:#e6edf3',
      'border:1px solid #2d3b4a', 'border-radius:10px',
      'box-shadow:0 8px 28px rgba(0,0,0,.45)',
      'font:12px/1.45 system-ui,Segoe UI,Arial,sans-serif',
      'padding:10px 12px', 'user-select:none'
    ].join(';');

    el.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">',
      '  <strong style="font-size:12.5px;letter-spacing:.2px">Dapodik · Lulusan NTT</strong>',
      '  <span id="dp-state" style="margin-left:auto;font-size:10.5px;padding:1px 7px;border-radius:9px;background:#233;color:#9fb3c8">siap</span>',
      '  <button id="dp-min" title="ringkas" style="background:none;border:0;color:#7d8fa3;cursor:pointer;font-size:14px;line-height:1">–</button>',
      '</div>',
      '<div id="dp-body">',
      '  <div style="height:7px;background:#1b2530;border-radius:5px;overflow:hidden;margin-bottom:6px">',
      '    <div id="dp-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#1f6fb2,#2ecc71);transition:width .4s"></div>',
      '  </div>',
      '  <div id="dp-line1" style="color:#9fb3c8">0/0 · 0%</div>',
      '  <div id="dp-line2" style="color:#7d8fa3;margin-bottom:8px">belum berjalan</div>',
      '  <div style="display:flex;gap:6px;margin-bottom:8px">',
      '    <button id="dp-start" style="flex:1;padding:6px 8px;border:0;border-radius:6px;background:#1f6fb2;color:#fff;cursor:pointer;font-weight:600">Mulai</button>',
      '    <button id="dp-stop" style="padding:6px 8px;border:0;border-radius:6px;background:#37475a;color:#cfe0ee;cursor:pointer">Stop</button>',
      '    <button id="dp-probe" title="uji batas WAF" style="padding:6px 8px;border:0;border-radius:6px;background:#243240;color:#9fb3c8;cursor:pointer">?</button>',
      '    <button id="dp-dump" title="unduh rekap sekarang" style="padding:6px 8px;border:0;border-radius:6px;background:#243240;color:#9fb3c8;cursor:pointer">⤓</button>',
      '  </div>',
      '  <div style="display:flex;align-items:center;gap:8px;color:#9fb3c8">',
      '    <label>delay <input id="dp-delay" type="number" min="80" max="2000" step="10" style="width:58px;background:#0c1218;color:#e6edf3;border:1px solid #2d3b4a;border-radius:4px;padding:2px 4px">ms</label>',
      '    <label style="margin-left:auto;display:flex;align-items:center;gap:4px">mode',
      '      <select id="dp-mode" style="background:#0c1218;color:#e6edf3;border:1px solid #2d3b4a;border-radius:4px;padding:2px 4px">',
      '        <option value="lengkap">Lengkap</option>',
      '        <option value="rekap">Rekap saja</option>',
      '      </select>',
      '    </label>',
      '  </div>',
      '  <div id="dp-note" style="display:none;margin-top:7px;padding:5px 7px;border-radius:5px;background:#3a2f13;color:#e6c07b;font-size:11px"></div>',
      '</div>'
    ].join('');

    document.body.appendChild(el);

    const $ = id => document.getElementById(id);
    const bar = $('dp-bar');
    const line1 = $('dp-line1');
    const line2 = $('dp-line2');
    const chip = $('dp-state');
    const note = $('dp-note');

    const setChip = (text, bg, fg) => {
      chip.textContent = text;
      chip.style.background = bg;
      chip.style.color = fg || '#0b1117';
    };

    const noteShow = text => {
      if (!text) { note.style.display = 'none'; return; }
      note.style.display = 'block';
      note.textContent = text;
    };

    const totalDone = () => Object.keys(state.done).length;

    const render = () => {
      const s = stats();
      const total = s.total || 1;
      bar.style.width = Math.min(100, (s.sekolah_selesai / total) * 100).toFixed(1) + '%';
      line1.textContent = s.sekolah_selesai + '/' + s.total + ' · ' + s.persen + '%';
      line2.textContent = s.req_per_detik + ' req/s · delay ' + s.delay_ms + 'ms · ETA ' +
        s.eta_menit + ' mnt' + (s.gagal ? ' · gagal ' + s.gagal : '') +
        ' · ' + (CFG.MODE_DATA === 'rekap' ? 'rekap' : 'lengkap');

      const modeSel = $('dp-mode');
      if (modeSel) {
        modeSel.disabled = running;
        modeSel.style.opacity = running ? '.55' : '1';
      }

      if (running) {
        const baruDiblokir = lastBlocked &&
          (Date.now() - new Date(lastBlocked.waktu).getTime()) < CFG.COOLDOWN;
        if (baruDiblokir) {
          setChip('cooldown', '#8a6d1f', '#ffe9a8');
          noteShow('Terdeteksi blokir HTTP ' + lastBlocked.kode +
            '. Menunggu ' + Math.round(CFG.COOLDOWN / 1000) + ' detik, delay dinaikkan otomatis.');
        } else {
          setChip('jalan', '#1e5f3a', '#c8f7d8');
          noteShow('');
        }
      } else if (s.sekolah_selesai >= s.total && s.total > 0) {
        setChip('selesai', '#1e5f3a', '#c8f7d8');
        noteShow('');
      } else if (s.sekolah_selesai > 0) {
        setChip('terhenti', '#4a3b13', '#ffe9a8');
      } else {
        setChip('siap', '#233', '#9fb3c8');
      }

      $('dp-start').textContent = s.sekolah_selesai > 0 && !running ? 'Lanjutkan' : 'Mulai';
      $('dp-start').disabled = running;
      $('dp-start').style.opacity = running ? '.5' : '1';
    };

    $('dp-start').onclick = async () => {
      if (running) return;
      if (document.hidden) {
        noteShow('Tab ini sedang di background. Chrome men-throttle timer — ' +
          'biarkan tab tetap di depan agar proses tidak tersendat.');
      } else {
        noteShow('');
      }
      try {
        await start();
      } catch (e) {
        noteShow('Gagal start: ' + e.message);
      }
      render();
    };

    $('dp-stop').onclick = () => {
      window.__dapo.stop();
      setChip('berhenti', '#4a1d1d', '#ffc9c9');
    };

    $('dp-probe').onclick = async () => {
      noteShow('menjalankan probe (±20 detik)…');
      const r = await probe();
      noteShow('probe selesai — concurrency aman: ' + r.aman +
        ' · batch kabupaten: ' + (r.kabCocok > 0 ? 'bisa' : 'tidak'));
    };

    $('dp-delay').value = CFG.DELAY;
    $('dp-delay').onchange = e => window.__dapo.delay(Number(e.target.value));

    $('dp-mode').value = CFG.MODE_DATA;
    $('dp-mode').onchange = e => {
      CFG.MODE_DATA = e.target.value;
      CFG.STORE_STUDENTS = e.target.value !== 'rekap';
      noteShow(e.target.value === 'rekap'
        ? 'Mode rekap: hanya jumlah lulusan per sekolah (tanpa NIK/NISN).'
        : 'Mode lengkap: data murid ikut disimpan ke CSV.');
    };

    $('dp-dump').onclick = () => {
      try {
        const r = window.__dapo.rekap();
        noteShow('Rekap diunduh — ' + r.sekolah + ' sekolah.');
      } catch (e) {
        noteShow('Gagal membuat rekap: ' + e.message);
      }
    };

    $('dp-min').onclick = () => {
      const body = $('dp-body');
      const sembunyi = body.style.display !== 'none';
      body.style.display = sembunyi ? 'none' : 'block';
      $('dp-min').textContent = sembunyi ? '+' : '–';
    };

    setInterval(render, 1000);
    render();

    console.log('%c[userscript] panel siap', 'color:#2ecc71;font-weight:bold',
      '— ' + (NPSN.length) + ' sekolah dalam daftar · sesi ' + SESS.slice(0, 8) + '…');
  };
