(function(){
  const params=new URLSearchParams((location.hash||'').replace(/^#/,'').replace(/&/g,'&'));
  // support #d=... and #t=...
  const hash=location.hash.slice(1);
  const map={};
  hash.split('&').forEach(p=>{const i=p.indexOf('='); if(i>0) map[p.slice(0,i)]=decodeURIComponent(p.slice(i+1));});
  if(map.d) localStorage.setItem('DATA_PATH', map.d);
  if(map.t) localStorage.setItem('APP_TOKEN', map.t);
  const d=localStorage.getItem('DATA_PATH');
  document.getElementById('app').textContent = d ? 'Desk · Plan B · path locked' : 'Open with #d=… once';
})();
