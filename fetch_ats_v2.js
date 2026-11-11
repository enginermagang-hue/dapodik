(() => {
  window.__API_CAPTURE = window.__API_CAPTURE || [];
  if (window.__fetchHooked) { console.log("API logger sudah aktif,", window.__API_CAPTURE.length, "entri"); return; }
  window.__fetchHooked = true;
  const SKIP = /\.(css|ico|png|jpg|jpeg|svg|woff2?)($|\?)/i;
  function push(e){ window.__API_CAPTURE.push(e); console.groupCollapsed("[API] " + e.method + " " + e.status + " " + e.url); console.log(e); console.groupEnd(); }
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = typeof args[0]==="string" ? args[0] : args[0]?.url;
    const method = (args[1]?.method || "GET").toUpperCase();
    const res = await origFetch(...args);
    try {
      if (!SKIP.test(url)) {
        const clone = res.clone();
        const text = await clone.text();
        let body = text.slice(0, 50000);
        try { body = JSON.parse(text); } catch {}
        push({tool:"fetch", method, url, status: res.status, time: new Date().toISOString(), body});
      }
    } catch(e){ console.warn("fetch log gagal", url, e); }
    return res;
  };
  const origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m,u){ this._m=m; this._u=u; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(b){
    this.addEventListener("load", function(){
      try {
        if (!SKIP.test(this._u)) {
          let body = (this.responseText||"").slice(0,50000);
          try { body = JSON.parse(this.responseText); } catch {}
          push({tool:"xhr", method:(this._m||"GET").toUpperCase(), url:this._u, status:this.status, time:new Date().toISOString(), body});
        }
      } catch(e){}
    });
    return origSend.apply(this, arguments);
  };
  window.apiLog = (f="") => window.__API_CAPTURE.filter(e=>!f||e.url.includes(f));
  window.apiShow = (f="") => { console.table(window.apiLog(f).map(e=>({method:e.method,status:e.status,url:e.url}))); return window.apiLog(f); };
  window.apiSave = (f="") => {
    const data = window.apiLog(f);
    const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download="api-capture.json"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    console.log("tersimpan", data.length, "response");
  };
  window.apiClear = () => { window.__API_CAPTURE.length=0; console.log("cleared"); };
  console.log("%cAPI logger aktif. Pakai: apiShow(), apiShow('keyword'), apiSave(), apiClear()","font-weight:bold");
})();