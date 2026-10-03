// Скриншоты публичной копии на СИНТЕТИЧЕСКИХ данных. Свежий профиль Chromium,
// локальный статический сервер; запросы к /sb, /api, /media отвечают 404 —
// продовая база не затрагивается. Выход: каталог из argv[2].
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),{spawn}=require('child_process');
const ROOT=process.argv[2], OUT=process.argv[3];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const srv=http.createServer((q,s)=>{
  let u=decodeURIComponent(q.url.split('?')[0]); if(u==='/') u='/index.html';
  const f=path.join(ROOT,u);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ s.writeHead(404); return s.end(); }
  s.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(s);
});
(async()=>{
  await new Promise(r=>srv.listen(0,'127.0.0.1',r)); const port=srv.address().port;
  const CH='/opt/pw-browsers/'+fs.readdirSync('/opt/pw-browsers').find(d=>/^chromium-/.test(d))+'/chrome-linux/chrome';
  const CDP=9611, prof=fs.mkdtempSync(path.join(os.tmpdir(),'bv-shots-'));
  const ch=spawn(CH,['--headless','--no-first-run','--no-sandbox','--disable-dev-shm-usage','--force-color-profile=srgb',
    '--remote-debugging-port='+CDP,'--user-data-dir='+prof,'--window-size=390,844','about:blank'],{stdio:'ignore'});
  const bye=()=>{ try{ch.kill()}catch(e){} try{srv.close()}catch(e){} try{fs.rmSync(prof,{recursive:true,force:true})}catch(e){} };
  process.on('exit',bye);
  let ws=null;
  for(let i=0;i<80&&!ws;i++){ await sleep(300); try{
    const l=await new Promise((ok,bad)=>{ http.get('http://127.0.0.1:'+CDP+'/json/list',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>ok(JSON.parse(b)))}).on('error',bad); });
    const pg=l.find(t=>t.type==='page'); if(pg) ws=new WebSocket(pg.webSocketDebuggerUrl); }catch(e){} }
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0; const w=new Map();
  ws.addEventListener('message',ev=>{ const m=JSON.parse(ev.data); if(m.id&&w.has(m.id)){ w.get(m.id)(m); w.delete(m.id); } });
  const send=(m,p={})=>new Promise(r=>{ const i=++id; w.set(i,r); ws.send(JSON.stringify({id:i,method:m,params:p})); });
  const js=async e=>{ const r=await send('Runtime.evaluate',{expression:'(async()=>{ '+e+' })()',awaitPromise:true,returnByValue:true});
    if(!r.result){ console.log('   ! CDP: '+JSON.stringify(r.error||r).slice(0,120)); return null; }
    const d=r.result.exceptionDetails; if(d) { console.log('   ! '+((d.exception&&d.exception.description)||d.text).split('\n')[0]); return null; } return r.result.result.value; };
  fs.mkdirSync(OUT,{recursive:true}); let n=0;
  const shot=async(name,ms)=>{ await sleep(ms||700); const r=await send('Page.captureScreenshot',{format:'png'});
    n++; const f=path.join(OUT,String(n).padStart(2,'0')+'_'+name+'.png'); fs.writeFileSync(f,Buffer.from(r.result.data,'base64')); console.log('   '+path.basename(f)); };
  const close="try{ while(NAV.stack.length) navPop('code'); }catch(e){} document.querySelectorAll('.sheet.on').forEach(s=>s.classList.remove('on')); try{ document.getElementById('exPick').classList.remove('on'); }catch(e){} await new Promise(r=>setTimeout(r,300));";
  const tab=v=>close+" goView('"+v+"'); scrollTo(0,0);";
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  const boot=async()=>{ for(let i=0;i<200;i++){ if(await js('return window.__bvBoot===true&&typeof APP_VER!=="undefined"')) break; await sleep(250);} await sleep(1200); };
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'}); await boot();
  await js("try{ history.back=function(){}; }catch(e){} return 1");

  // ── первый запуск ──
  await shot('first_run_gate',600);
  await js("document.getElementById('gLocal').click(); return 1"); await shot('onboarding_q1_sex',800);
  await js("document.querySelector('[data-onbv=\"m\"]').click(); return 1"); await shot('onboarding_q2_age',500);
  const ANS={age:'31',h:'178',w:'82.4',goal:'recomp',equip:'gym',days:'3',exp:'mid'};
  for(let i=0;i<10;i++){
    const k=await js("const q=ONBQ[onbStep]; return q?q.k:null"); if(!k) break;
    if(k==='goal') await shot('onboarding_q5_goal',300);
    await js("const q=ONBQ[onbStep]; const A="+JSON.stringify(ANS)+"; if(q.num){ document.getElementById('onbNum').value=A[q.k]; document.getElementById('onbNext').click(); } else { document.querySelector('[data-onbv=\"'+A[q.k]+'\"]').click(); } return 1");
    await sleep(500);
  }
  await shot('onboarding_done_program_built',1800);
  await js("document.getElementById('onbGo').click(); return 1");
  await shot('train_first_day_after_onboarding',1200);

  // ── пустые состояния (простой режим, только знакомство) ──
  await js(tab('food')); await shot('food_empty_simple_mode',800);
  await js(tab('body')); await shot('body_empty_simple_mode',800);
  await js(tab('health')); await shot('health_empty',800);
  await js(tab('coach')); await shot('coach_empty_simple_mode',800);

  // ── синтетическая история: 4 недели веса, 7 дней еды, 3 тренировки, шаги ──
  const seeded=await js(`
    const D=k=>new Date(Date.now()-k*864e5).toLocaleDateString('sv-SE');
    for(let k=27;k>=0;k--){ await put('weight',{d:D(k),kg:Math.round((82.6-k*0.03-(27-k)*0.02+Math.sin(k*1.7)*0.45)*10)/10}); }
    const FOOD=[['Овсянка на молоке',300,330,12,9,50],['Творог 5%',200,242,34,10,6],['Куриная грудка',180,198,42,3,0],['Гречка варёная',200,220,8,2,44],['Банан',120,107,1,0,27],['Омлет из трёх яиц',170,265,19,20,2],['Рис варёный',180,234,5,1,51],['Говядина тушёная',150,330,32,22,0]];
    for(let k=6;k>=0;k--){ for(let i=0;i<(k===0?3:4);i++){ const f=FOOD[(k*3+i)%FOOD.length]; await put('log',{d:D(k),n:f[0],u:100,un:'г',a:f[1],k:f[2],p:f[3],f:f[4],c:f[5]}); } }
    for(let k=13;k>=0;k--){ await put('steps',{d:D(k),n:6000+((k*1373)%5500)}); }
    const day=(S.prog&&S.prog.plan||[]).find(d=>d&&d.ex&&d.ex.length);
    let ns=0; if(day){ for(const k of [9,6,2]){ for(const [j,e] of day.ex.slice(0,5).entries()){ for(let s=0;s<3;s++){ await put('sets',{d:D(k),e:e.n,w:[60,40,20,30,15][j]+(k===2?2.5:0),r:[8,10,12,10,12][j]-(s===2?1:0)}); ns++; } }
      await put('sess',{d:D(k),start:'18:10',end:'19:22',min:72,rpe:7}); } }
    return ns;`);
  console.log('   синтетических подходов: '+seeded);
  await send('Page.reload',{}); await boot(); await js("try{ history.back=function(){}; }catch(e){} return 1"); await sleep(3500);

  // ── основные экраны с данными ──
  await js(tab('food')); await shot('food_main_with_data',900);
  await js("scrollTo(0,700); return 1"); await shot('food_diary_scrolled',600);
  await js(close+" goView('food'); openFind(); return 1"); await shot('food_search_sheet',900);
  await js(close+" goView('food'); openF(true,{n:'Сырники'}); return 1"); await shot('food_add_manual_product',700);
  await js(close+" goView('food'); sheet('sh-scan',true); return 1"); await shot('food_scan_menu_photo_barcode_label',700);
  await js(close+" goView('food'); window.__f=window.fetch; window.fetch=(u,o)=>/openfoodfacts/.test(String(u))?new Promise(()=>{}):window.__f(u,o); openOffSearch('творог'); return 1"); await shot('food_off_search_loading_state',1200);
  await js(close+" window.fetch=(u,o)=>/openfoodfacts/.test(String(u))?Promise.reject(new TypeError('Load failed')):window.__f(u,o); openOffSearch('творог'); await new Promise(r=>setTimeout(r,2000)); window.fetch=window.__f; return 1"); await shot('food_off_search_error_state',300);
  await js(tab('train')); await shot('train_today',1600);
  await js("scrollTo(0,800); return 1"); await shot('train_today_scrolled',600);
  await js(close+" goView('train'); vDay=new Date(Date.now()-2*864e5).toLocaleDateString('sv-SE'); rTrain(); scrollTo(0,0); return 1"); await shot('train_past_workout_with_sets',1200);
  await js("scrollTo(0,700); return 1"); await shot('train_past_workout_scrolled',700);
  await js(close+" vDay=td(); rTrain(); return 1");
  await js(close+" goView('train'); const b=[...document.querySelectorAll('[data-tr]')].find(x=>x.dataset.tr==='prog'); if(b) b.click(); scrollTo(0,0); return 1"); await shot('train_program_tab',900);
  await js(close+" goView('train'); const b=document.getElementById('bGenProg'); if(b) b.click(); else sheet('sh-prog',true); return 1"); await shot('program_generator_sheet',900);
  await js(close+" goView('train'); sheet('sh-cat',true); return 1"); await shot('program_catalog_sheet',900);
  await js(close+" goView('train'); const b=[...document.querySelectorAll('[data-tr]')].find(x=>x.dataset.tr==='log'); if(b) b.click(); const d=(S.prog.plan||[]).find(x=>x.ex&&x.ex.length); showEx(EX.find(e=>e.n===d.ex[0].n)||EX[0]); return 1"); await shot('exercise_sheet',1200);
  await js(close+" goView('train'); sheet('sh-sess',true); return 1"); await shot('close_workout_sheet',800);
  await js(tab('body')); await shot('body_weight_trend',1000);
  await js(close+" goView('body'); const b=[...document.querySelectorAll('[data-bd]')].find(x=>x.dataset.bd==='prg'); if(b) b.click(); scrollTo(0,0); return 1"); await shot('body_measurements',900);
  await js(tab('health')); await shot('health_labs_empty_full_mode',800);
  await js(close+" goView('health'); const b=[...document.querySelectorAll('[data-hl]')].find(x=>x.dataset.hl==='s'); if(b) b.click(); scrollTo(0,0); return 1"); await shot('health_supplements',800);
  await js(close+" goView('health'); document.getElementById('bAddLab').click(); return 1"); await shot('health_add_labs_sheet',800);
  await js(tab('coach')); await shot('coach_main_full_mode',1000);
  await js("scrollTo(0,800); return 1"); await shot('coach_scrolled',600);
  await js(close+" try{ coachCards(); }catch(e){} sheet('sh-ask',true); renderAsk(); return 1"); await shot('ai_coach_chat_sheet',1200);
  await js("document.getElementById('askQ').value='Почему вес стоит?'; document.getElementById('bAskGo').click(); await new Promise(r=>setTimeout(r,2500)); return 1"); await shot('ai_coach_without_key_or_beta',300);
  await js(close+" openSet(); return 1"); await shot('settings_root',900);
  for(const [sec,name] of [['Prof','settings_profile'],['Data','settings_data_and_cloud'],['Key','settings_ai_key'],['Sub','settings_subscription_prices'],['Notif','settings_notifications']]){
    await js(close+" openSet('"+sec+"'); return 1"); await shot(name,900); }
  await js(close+" sheet('sh-sync',true); return 1"); await shot('account_sync_sign_in_sheet',800);
  await js(close+" goView('food'); return 1"); await shot('food_back_to_main',600);
  bye(); process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
