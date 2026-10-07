(async () => {
  // FETCH ATS v1 — overlay + select multiple kabupaten 240000 NTT
  // Wil HTML only (GET /rangkuman/ats-by-wilayah/{kode}?tabulasi=wilayah), individu POST /ambil-data-tabel-individu/.../4/wil
  // Pakai: buka https://ats.data.kemendikdasmen.go.id/index.php/rangkuman/ats-by-wilayah/240000?tabulasi=wilayah&status=verifikasi (login)
  //        F12 > Sources > Snippets > paste > Ctrl+Enter
  const PROV = '240000';
  const URL_WIL = k => `https://ats.data.kemendikdasmen.go.id/index.php/rangkuman/ats-by-wilayah/${k}?tabulasi=wilayah&status=verifikasi`;
  const URL_ATS = (k,t) => `https://ats.data.kemendikdasmen.go.id/index.php/ambil-data-tabel-individu/by-wilayah/${k}/4/${t}?stat_ver=verifikasi`;
  const CONCURRENCY = 6, RETRIES = 3;
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const stripTags = s => String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
  const extractKV = html => {
    const d=document.createElement('div'); d.innerHTML=String(html||'');
    const kv={};
    for(const tr of d.querySelectorAll('tr')){
      const tds=[...tr.querySelectorAll('td')];
      if(tds.length>=3){
        const k=(tds[0].textContent||'').trim().toLowerCase().replace(/\s+/g,'_').replace(/:$/,'');
        const v=(tds[2].textContent||'').trim();
        if(k) kv[k]=v;
      } else if(tds.length===2){
        const k=(tds[0].textContent||'').trim().toLowerCase().replace(/\s+/g,'_').replace(/:$/,'');
        const v=(tds[1].textContent||'').trim();
        if(k) kv[k]=v;
      }
    }
    if(!Object.keys(kv).length){
      const txt=d.innerText||d.textContent||'';
      for(const l of txt.split('\n')){ const m=l.match(/^\s*([^:]+?)\s*:\s*(.*)\s*$/); if(m) kv[m[1].trim().toLowerCase().replace(/\s+/g,'_')]=m[2].trim(); }
    }
    return kv;
  };
  const getKV = v => extractKV(v);
  const parseATSRow = (cells,i) => {
    const p=getKV(cells[1]||''), o=getKV(cells[2]||''), s=getKV(cells[3]||''), ver=getKV(cells[4]||'');
    let ats_id=''; const m=String((cells[5]||'')+(cells[4]||'')).match(/muatDetailSiswa(?:BpB)?\s*\(\s*['"]([0-9A-Fa-f-]{36})['"]/); if(m) ats_id=m[1];
    const vs=/Sudah Verifikasi/i.test(String(cells[5]||''))?'Sudah Verifikasi':/Belum Verifikasi/i.test(String(cells[5]||''))?'Belum Verifikasi':'';
    const sr=(ver.status||'').toUpperCase(), status_ats=/^(BPB|DO|LTM)$/.test(sr)?sr:'';
    let nisn=p.nisn||''; if(cells[1]&&/<a/i.test(cells[1])){ const d=document.createElement('div'); d.innerHTML=cells[1]; const a=d.querySelector('a'); if(a) nisn=(a.textContent||'').trim()||nisn; }
    return { no:stripTags(cells[0]||'')||String(i+1), nisn, nama:p.nama||'', jk:p.jenis_kelamin||'', usia:p.usia||'', ayah:o.nama_ayah||'', ibu:o.nama_ibu||'', alamat:o.alamat||'', npsn:(s.npsn||'').trim(), nama_sekolah:s.nama_sekolah||'', tingkat:s.tingkat_pendidikan||'', status_ats, verifikasi_status:vs, alasan_verifikasi:ver.alasan_verifikasi||'', alasan_lainnya:ver.alasan_lainnya||'', keterangan:ver.keterangan||'', ats_id };
  };
  const parseATSJson = j => { const d=j&&j.data?j.data:[]; return d.map((r,i)=>parseATSRow(r,i)).filter(r=>r.nama||r.nisn||r.ats_id); };
  const isChallenge = (res,b) => res&&res.status===468 || (b&&/Akses Ditolak|SUPPORT ID|sl-waf-script|sl_verify|_sl_waf|safeline/i.test(b.slice(0,4000)));
  const pool = async (items, worker, conc) => { const out=new Array(items.length); let idx=0; const runners=Array(Math.min(conc,items.length)).fill(0).map(async()=>{ while(true){ const i=idx++; if(i>=items.length) break; out[i]=await worker(items[i],i); }}); await Promise.all(runners); return out; };

  // overlay
  const el = (tag,cls,...kids)=>{ const n=document.createElement(tag); if(typeof cls==='string') n.className=cls; else if(cls&&typeof cls==='object') for(const [k,v] of Object.entries(cls)) n[k]=v; for(const k of kids) if(k!=null) n.append(typeof k==='string'?document.createTextNode(k):k); return n; };
  const overlayCSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
#__fp2o{position:fixed;inset:0;z-index:2147483000;background:linear-gradient(160deg,#0d1117 0%,#010409 100%);color:#e6edf3;font:13px/1.5 'Inter','Segoe UI',Arial,sans-serif;display:flex;flex-direction:column}
#__fp2o *{box-sizing:border-box}
#__fp2o .hd{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#161b22;border-bottom:1px solid #30363d;flex:none}
#__fp2o .hd .dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#58a6ff,#1f6feb);flex:none}
#__fp2o .hd .t{font-weight:700;color:#58a6ff}
#__fp2o .hd .cnt{margin-left:auto;color:#8b949e;font-size:11px}
#__fp2o .hd button{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:5px 10px;border-radius:8px;cursor:pointer;font:inherit}
#__fp2o .content{flex:1;overflow:auto;padding:14px}
#__fp2o .log{border-top:1px solid #30363d;background:#0d1117;padding:8px 14px;font:11px/1.5 Consolas,monospace;color:#8b949e;max-height:32vh;overflow:auto;flex:none}
#__fp2o .log div{white-space:pre-wrap;word-break:break-word}
#__fp2o .dlg{max-width:720px;width:96%;margin:18px auto;padding:18px;background:#161b22;border:1px solid #30363d;border-radius:12px;box-shadow:0 16px 50px rgba(0,0,0,.5)}
#__fp2o .dt{font-size:15px;font-weight:700;color:#58a6ff;margin-bottom:6px}
#__fp2o .dd{color:#c9d1d9;margin-bottom:12px;white-space:pre-wrap;line-height:1.5}
#__fp2o .dlgbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
#__fp2o select{width:100%;min-height:220px;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:8px;padding:6px;font:13px 'Inter',sans-serif}
#__fp2o select option{padding:6px 8px}
#__fp2o select option:checked{background:#1f6feb;color:#fff}
#__fp2o button{padding:7px 12px;border-radius:8px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;cursor:pointer;font:inherit}
#__fp2o button:hover{background:#30363d}
#__fp2o button.go{background:linear-gradient(180deg,#2ea043,#238636);border-color:#238636;color:#fff;font-weight:700}
#__fp2o button.bad{background:linear-gradient(180deg,#e5534b,#da3633);border-color:#da3633;color:#fff}
#__fp2o .prog{padding:18px;background:#0d1117;border:1px solid #30363d;border-radius:10px;margin-top:12px}
#__fp2o .ptitle{font-weight:700;color:#58a6ff;margin-bottom:10px}
#__fp2o .pbar{height:16px;background:#010409;border:1px solid #30363d;border-radius:999px;overflow:hidden}
#__fp2o .pfill{height:100%;width:0;background:linear-gradient(90deg,#238636,#3fb950);transition:width .2s}
#__fp2o .pstat{margin-top:8px;color:#8b949e;font-size:12px}
#__fp2o .pnow{margin-top:6px;color:#c9d1d9;font-size:12px;min-height:16px}
`;
  const style=el('style'); style.textContent=overlayCSS; document.head.appendChild(style);
  const root=el('div'); root.id='__fp2o';
  const head=el('div','hd', el('span','dot'), el('span','t','Fetch ATS — NTT 240000'), el('span','cnt',''), el('button',{},'Tutup'));
  const content=el('div','content');
  const logEl=el('div','log');
  root.append(head,content,logEl); document.body.appendChild(root);
  const cntEl=head.querySelector('.cnt');
  head.querySelector('button').addEventListener('click',()=>root.remove());
  const log=(...a)=>{ const d=el('div',{},'['+new Date().toLocaleTimeString()+'] '+a.join(' ')); logEl.append(d); logEl.scrollTop=logEl.scrollHeight; console.log(...a); };
  const setStatus=t=> cntEl.textContent=t;
  const askSelectKab=(kabs)=>new Promise(resolve=>{
    content.innerHTML='';
    const box=el('div','dlg');
    box.append(el('div','dt','Pilih Kabupaten — NTT 240000 (22)'));
    box.append(el('div','dd','Pilih kabupaten yang ingin diekspor. Tahan Ctrl/Cmd untuk multi-pilih. Kosong = semua 22.\nContoh valid: 240100 KAB. KUPANG → 24 kec 240110-240136 sudah terbukti fetch HTML.'));
    const sel=el('select'); sel.multiple=true; sel.size=Math.min(12, kabs.length);
    for(const k of kabs){ const o=el('option',{}, `${k.kode} — ${k.nama}`); o.value=k.kode; sel.append(o); }
    box.append(sel);
    const bar=el('div','dlgbar');
    const bAll=el('button',{},'Pilih Semua'), bNone=el('button',{},'Kosongkan'), bGo=el('button','go','Lanjut'), bCancel=el('button','bad','Batal');
    bAll.addEventListener('click',()=>{ [...sel.options].forEach(o=>o.selected=true); });
    bNone.addEventListener('click',()=>{ [...sel.options].forEach(o=>o.selected=false); });
    bGo.addEventListener('click',()=>{
      const codes=[...sel.selectedOptions].map(o=>o.value);
      const picked=codes.length? kabs.filter(k=>codes.includes(k.kode)) : kabs.slice();
      resolve(picked);
    });
    bCancel.addEventListener('click',()=>{ root.remove(); resolve(null); });
    bar.append(bAll,bNone,bGo,bCancel); box.append(bar); content.append(box);
    sel.focus();
  });

  const fetchHtml = async kode => {
    let t=0; while(true){ try{ const r=await fetch(URL_WIL(kode),{credentials:'include', signal: AbortSignal.timeout(20000)}); const h=await r.text(); if(isChallenge(r,h)){ log('[WAF] wil',kode,'— selesaikan validasi lalu Enter'); await new Promise(ok=>{ const fn=e=>{ if(e.key==='Enter'){ document.removeEventListener('keydown',fn); ok(); }}; document.addEventListener('keydown',fn); }); continue; } if(!r.ok) throw new Error('HTTP '+r.status); return h; }catch(e){ if(t>=RETRIES-1) throw e; t++; await sleep(1200*t); }}
  };
  const fetchWilayah = async kode => {
    const html=await fetchHtml(kode); const doc=new DOMParser().parseFromString(html,'text/html');
    return [...doc.querySelectorAll('#ats_wilayah tbody tr')].map(tr=>{ const a=tr.querySelector('a'); const href=a?a.href:''; const m=href.match(/\/(\d{6,8}[A-Z]*)/); if(!m) return null; return { kode:m[1], nama:(a.textContent||a.innerText||'').trim() }; }).filter(Boolean);
  };
  const fetchATSIndividu = async (kode,tipe) => {
    tipe=tipe||'wil'; let t=0; while(true){ try{ const r=await fetch(URL_ATS(kode,tipe),{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body:'draw=1&start=0&length=-1'}); const txt=await r.text(); if(isChallenge(r,txt)){ log('[WAF] ats',kode); await sleep(3000); continue; } if(!r.ok) throw new Error('HTTP '+r.status); let j=null; try{ j=JSON.parse(txt);}catch(e){ throw new Error('ATS JSON '+kode+': '+txt.slice(0,200)); } return parseATSJson(j); }catch(e){ if(t>=RETRIES-1) throw e; t++; await sleep(1000*t); }}
  };

  log('=== FETCH ATS — NTT 240000 (overlay + select kab) ===');
  setStatus('fetch 22 kab...');
  const kabs=await fetchWilayah(PROV);
  log(`Prov ${PROV}: ${kabs.length} kab`, kabs.map(k=>k.kode).join(', '));
  if(!kabs.length){ log('0 kab — cek login/WAF'); return; }
  content.innerHTML='';
  const picked=await askSelectKab(kabs);
  if(!picked){ log('dibatalkan'); return; }
  log(`dipilih ${picked.length}/${kabs.length} kab:`, picked.map(k=>k.kode).join(', '));
  setStatus(`kec ${picked.length} kab...`);
  content.innerHTML='';
  const progKec=el('div','prog'); progKec.innerHTML=`<div class="ptitle">Ambil Kecamatan — ${picked.length} kab</div><div class="pbar"><div class="pfill"></div></div><div class="pstat">0 / ${picked.length}</div><div class="pnow"></div>`; content.append(progKec);
  const pfKec=progKec.querySelector('.pfill'), psKec=progKec.querySelector('.pstat'), pnKec=progKec.querySelector('.pnow');
  let doneKec=0;
  const kabWithKec=await pool(picked, async kab=>{
    pnKec.textContent=kab.kode+' '+kab.nama+' ...';
    try{ const kec=await fetchWilayah(kab.kode); log(` kec ${kab.kode} ${kab.nama}: ${kec.length}`); doneKec++; pfKec.style.width=Math.round(doneKec/picked.length*100)+'%'; psKec.textContent=`${doneKec} / ${picked.length}`; return {...kab,kec}; }
    catch(e){ log(` kec gagal ${kab.kode} ${String(e).slice(0,80)}`); doneKec++; pfKec.style.width=Math.round(doneKec/picked.length*100)+'%'; return {...kab,kec:[]}; }
  }, CONCURRENCY);
  const allKec=kabWithKec.flatMap(k=>k.kec.map(c=>({...c,_kab:k}))); log(`Total kec: ${allKec.length}`); setStatus(`desa ${allKec.length} kec...`);
  progKec.querySelector('.ptitle').textContent=`Selesai Kecamatan — ${allKec.length} kec`;
  const progDesa=el('div','prog'); progDesa.innerHTML=`<div class="ptitle">Ambil Desa AA — ${allKec.length} kec</div><div class="pbar"><div class="pfill"></div></div><div class="pstat">0 / ${allKec.length}</div><div class="pnow"></div>`; content.append(progDesa);
  const pfDesa=progDesa.querySelector('.pfill'), psDesa=progDesa.querySelector('.pstat'), pnDesa=progDesa.querySelector('.pnow');
  let doneDesa=0;
  const kecWithDesa=await pool(allKec, async kec=>{
    pnDesa.textContent=kec._kab.nama+' / '+kec.nama+' ...';
    try{ const desa=await fetchWilayah(kec.kode); doneDesa++; pfDesa.style.width=Math.round(doneDesa/allKec.length*100)+'%'; psDesa.textContent=`${doneDesa} / ${allKec.length}`; return {...kec,desa}; }
    catch(e){ doneDesa++; pfDesa.style.width=Math.round(doneDesa/allKec.length*100)+'%'; return {...kec,desa:[]}; }
  }, CONCURRENCY);
  const kecMap=new Map(kecWithDesa.map(k=>[k.kode,k.desa]));
  for(const kab of kabWithKec) for(const kec of kab.kec) kec.desa=kecMap.get(kec.kode)||[];
  const allDesa=kecWithDesa.flatMap(k=>(k.desa||[]).map(d=>({...d,_kec:k,_kab:k._kab}))); log(`Total desa AA: ${allDesa.length}`); setStatus(`${allDesa.length} desa`);
  progDesa.querySelector('.ptitle').textContent=`Selesai Desa — ${allDesa.length} desa AA`;
  if(!allDesa.length){ content.append(el('div','dlg', el('div','dt','Tidak ada desa AA'), el('div','dd','Tidak ada desa AA dari kabupaten terpilih.'))); return; }
  const progATS=el('div','prog'); progATS.innerHTML=`<div class="ptitle">Ambil Individu ATS — ${allDesa.length} desa (wil union)</div><div class="pbar"><div class="pfill"></div></div><div class="pstat">0 / ${allDesa.length} — 0 individu</div><div class="pnow"></div>`; content.append(progATS);
  const pfATS=progATS.querySelector('.pfill'), psATS=progATS.querySelector('.pstat'), pnATS=progATS.querySelector('.pnow');
  const allRows=[]; const seen=new Set(); let doneATS=0;
  await pool(allDesa, async d=>{
    pnATS.textContent=d.kode+' '+d.nama+' ...';
    try{ const rows=await fetchATSIndividu(d.kode,'wil'); let add=0; for(const r of rows){ const key=r.ats_id||`${d.kode}|${r.nisn}|${r.nama}`; if(r.ats_id&&seen.has(r.ats_id)) continue; seen.add(key); allRows.push({ kode_desa:d.kode, desa:d.nama, kecamatan:d._kec.nama, kec_kode:d._kec.kode, kabupaten:d._kab.nama, kab_kode:d._kab.kode, ...r }); add++; } log(` ${d.kode} ${d.nama}: ${rows.length} (+${add})`); }
    catch(e){ log(` individu gagal ${d.kode} ${String(e).slice(0,80)}`); }
    doneATS++; pfATS.style.width=Math.round(doneATS/allDesa.length*100)+'%'; psATS.textContent=`${doneATS} / ${allDesa.length} — ${allRows.length} individu`;
  }, CONCURRENCY);
  log(`=== SELESAI ${allRows.length} individu (dedup ${seen.size}) dari ${allDesa.length} desa ===`); setStatus(`selesai ${allRows.length}`);
  progATS.querySelector('.ptitle').textContent=`Selesai — ${allRows.length} individu`;
  console.table(allRows.slice(0,30));
  const header=['kode_desa','desa','kecamatan','kec_kode','kabupaten','kab_kode','no','nisn','nama','jk','usia','ayah','ibu','alamat','npsn','nama_sekolah','tingkat','status_ats','verifikasi_status','alasan_verifikasi','alasan_lainnya','keterangan','ats_id'];
  const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const lines=[header.map(esc).join(',')]; for(const r of allRows) lines.push(header.map(k=>esc(r[k])).join(','));
  const base=`ats_${PROV}_${picked.map(k=>k.kode).join('-').slice(0,40)}_${new Date().toISOString().slice(0,10)}_individu`;
  const csv=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}), json=new Blob([JSON.stringify(allRows,null,2)],{type:'application/json;charset=utf-8'});
  const dl=(b,n)=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=n; a.click(); log('download '+n); };
  window._ats={ rows:allRows, kabs:kabWithKec, desas:allDesa, downloadCsv:()=>dl(csv,base+'.csv'), downloadJson:()=>dl(json,base+'.json') };
  const doneBox=el('div','dlg');
  doneBox.append(el('div','dt','Selesai — '+allRows.length+' ATS'));
  doneBox.append(el('div','dd',`Kab: ${picked.map(k=>k.nama).join(', ')}\nDesa AA: ${allDesa.length} — Individu: ${allRows.length} (dedup ${seen.size})\nFile: ${base}.csv / .json`));
  const bar=el('div','dlgbar');
  const bCsv=el('button','go','Download CSV'), bJson=el('button',{},'Download JSON'), bBoth=el('button',{},'Keduanya'), bClose=el('button','bad','Tutup');
  bCsv.addEventListener('click',()=>dl(csv,base+'.csv')); bJson.addEventListener('click',()=>dl(json,base+'.json')); bBoth.addEventListener('click',()=>{ dl(csv,base+'.csv'); dl(json,base+'.json'); }); bClose.addEventListener('click',()=>root.remove());
  bar.append(bCsv,bJson,bBoth,bClose); doneBox.append(bar); content.append(doneBox);
  dl(csv,base+'.csv');
})();
