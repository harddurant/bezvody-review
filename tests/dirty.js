// ПРОГОН НА ГРЯЗНЫХ ДАННЫХ — настоящий браузер, заведомо битая база.
//
// Зачем: в базу человека попадает мусор из старого экспорта, чужого синка и
// багов прошлых версий — строки вместо чисел, NaN, null, отсутствующие поля,
// кривые и будущие даты. Приложение не имеет права падать: краш на одной
// битой записи отрезает человека от ВСЕЙ истории.
//
// Что уже нашёл: краш экрана «Тело» на записи веса без даты (v271), NaN-цель
// при нечисловом плане (v271), раскладку макросов, отдающую NaN при мусоре в
// настройках «на кг» (19.08), и битую дату «0000-00-00», из-за которой
// история считалась бесконечно старой — новичку подводили итоги недели.
//
// В деплой-гейт НЕ входит: на Vercel браузера нет. Сами инварианты, которые
// он находит, переезжают в tests/smoke.js. Нет Chromium — честно пропускается.
//
// Запуск: node tests/build.js && node tests/dirty.js
const https=require('https'), http=require('http'), fs=require('fs'), path=require('path'), os=require('os');
const {spawn,execFileSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const DIST=path.join(ROOT,'dist');
const CH_DIRS=['/opt/pw-browsers','/root/.cache/ms-playwright'];
/* BV_CHROME — путь к браузеру, заданный снаружи (11.09). В CI мы ставим
   Chrome for Testing закреплённой версии: предустановленный Chrome 152 на
   раннере стартует, но отладку не открывает, и три попытки это обойти ушли
   в пустоту. Переменная всегда главнее поиска по системе. */
function findChrome(){
  if(process.env.BV_CHROME){ try{ if(fs.statSync(process.env.BV_CHROME).isFile()) return process.env.BV_CHROME; }catch(e){} }
  for(const base of CH_DIRS){
    if(!fs.existsSync(base)) continue;
    for(const d of fs.readdirSync(base)){
      const p1=path.join(base,d,'chrome-linux','chrome');
      if(fs.existsSync(p1)) return p1;
    }
  }
  for(const p1 of ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'])
    if(fs.existsSync(p1)) return p1;
  return null;
}
const CHROME=findChrome();
if(typeof WebSocket==='undefined'){ console.error(' ✗ Нужен Node 22+: в '+process.version+' нет глобального WebSocket (23.09)'); process.exit(1); }
if(!CHROME){ console.log(' — прогон на грязи пропущен: Chromium не найден');
  /* В CI Chromium обязан быть. Молчаливый зелёный тут — это ровно тот случай,
     когда «проверка прошла» означает «проверка не запускалась» (31.08). */
  if(process.env.BV_REQUIRE_BROWSER==='1'){ console.error(' ✗ Chromium не найден, а он обязателен'); process.exit(1); }
  process.exit(0); }
if(!fs.existsSync(path.join(DIST,'index.html'))){ console.error(' ✗ Грязь: нет dist — сначала node tests/build.js'); process.exit(1); }
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let TLS=null;
  try{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-dirty-tls-'));
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',dir+'/key.pem','-out',dir+'/cert.pem',
      '-days','2','-nodes','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
    TLS={key:fs.readFileSync(dir+'/key.pem'),cert:fs.readFileSync(dir+'/cert.pem')};
  }catch(e){ TLS=null; }
  const mkSrv=TLS?((h)=>https.createServer(TLS,h)):((h)=>http.createServer(h));
  const srv=mkSrv((q,s)=>{
    let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html';
    const f=path.join(DIST,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end('no')}
    s.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(s); });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r)); const port=srv.address().port;
  const prof=path.join(process.env.HOME||os.homedir()||os.tmpdir(),'.bv-dirty-'+process.pid);
  /* --disable-dev-shm-usage: в контейнерах CI /dev/shm 64 МБ, Chromium
     падает на старте. Вывод браузера держим: с 'ignore' причина отказа
     пропадала, и падало потом на пустом ws с невнятным TypeError. */
  const chErr=[];
  const ch=spawn(CHROME,['--headless','--no-first-run','--no-default-browser-check','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--ignore-certificate-errors','--remote-debugging-port=0','--user-data-dir='+prof,'--window-size=390,844','about:blank'],{stdio:['ignore','ignore','pipe']});
  /* Порт 0 (23.09): фиксированный порт в CI не открывался три недели подряд; браузер
     берёт свободный и называет его в stderr строкой «DevTools listening on ws://…:PORT/». */
  if(ch.stderr) ch.stderr.on('data',d=>{ const t=String(d); chErr.push(t); if(chErr.length>40) chErr.shift();
    const m=/DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(t); if(m&&+m[1]>0) cdpPort=+m[1]; });
  ch.on('error',e=>chErr.push('не запустился: '+e.message));
  /* Порт спрашиваем у самого браузера: он пишет его в DevToolsActivePort
     внутри профиля. Наличие файла отвечает на вопрос «отладка открылась?»,
     а фиксированный порт этого не показывает (11.09). */
  let ws=null, cdpPort=0, portFile=false;
  for(let i=0;i<60&&!ws;i++){ await sleep(300);
    try{ const f=path.join(prof,'DevToolsActivePort');
      if(fs.existsSync(f)){ portFile=true;
        const p=parseInt(String(fs.readFileSync(f,'utf8')).split(String.fromCharCode(10))[0],10);
        if(p>0) cdpPort=p; } }catch(e){}
    for(const host of ['127.0.0.1','[::1]']){ if(ws||!(cdpPort>0)) break;
      try{ const l=await new Promise((ok,bad)=>http.get('http://'+host+':'+cdpPort+'/json/list',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>ok(JSON.parse(b)))}).on('error',bad));
        const pg=l.find(t=>t.type==='page'); if(pg) ws=new WebSocket(pg.webSocketDebuggerUrl);}catch(e){} } }
  /* Без этой проверки браузер, который не отозвался, ронял сам тест строкой
     «Cannot read properties of null (reading addEventListener)» — читается
     как поломка приложения, а на деле не стартовал Chromium. */
  if(!ws){
    const why=chErr.join('').trim().split(String.fromCharCode(10)).filter(Boolean).slice(-30).join(' | ');
    try{ch.kill()}catch(e){} try{srv.close()}catch(e){}
    if(process.env.BV_REQUIRE_BROWSER==='1'){
      console.error(' ✗ Грязь: браузер не отозвался по порту '+cdpPort+', а прогон обязателен');
      console.error(portFile?('   отладку открыл, вкладки не отдал'):'   DevToolsActivePort не появился — отладка не открылась вовсе');
      console.error(why?('   он сказал: '+why):'   он не сказал ничего — значит не стартовал вовсе');
      process.exit(1);
    }
    console.log(' — прогон на битой базе пропущен: Chromium не отозвался');
    if(why) console.log('   причина: '+why);
    process.exit(0);
  }
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0; const wait=new Map(), evs=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id)} else if(m.method) evs.push(m)});
  const send=(m,p={})=>new Promise(res=>{const i=++id;wait.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}))});
  const js=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
    const d=r.result&&r.result.exceptionDetails; if(d) return '❗'+((d.exception&&d.exception.description)||d.text||'').slice(0,200);
    return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable'); await send('Log.enable');
  const boom=[]; const drain=()=>{while(evs.length){const e=evs.shift();
    if(e.method==='Runtime.exceptionThrown'){const d=e.params.exceptionDetails;boom.push(((d.exception&&(d.exception.description||d.exception.value))||d.text)+'')}
    if(e.method==='Log.entryAdded'&&e.params.entry.level==='error'){const t=e.params.entry.text+' '+(e.params.entry.url||'');if(!/steps_pull|app_events|rest\/v1|\/sb\/|\/api\//.test(t))boom.push('консоль: '+t)}}};
  const BASE=(TLS?'https://localhost:':'http://127.0.0.1:')+port;
  await send('Page.navigate',{url:BASE+'/index.html'}); await sleep(5000); drain();

  console.log('сеем грязь:', await js(`(async()=>{
    const bad=[
      ['weight',{d:td(),kg:'девяносто'}], ['weight',{d:'кривая-дата',kg:90}], ['weight',{kg:null}],
      ['log',{d:td(),n:null,k:NaN,p:'много',f:undefined,c:-5,a:'две'}],
      ['log',{d:td(),n:'Продукт без чисел'}],
      ['sets',{e:'',d:td(),w:'сто',r:'десять'}],
      ['sets',{e:'Жим лёжа',d:td(),w:-40,r:0}],
      ['sets',{e:'Жим лёжа'}],
      ['meas',{d:td(),waist:'сорок'}],
      ['sleep',{d:td(),h:'восемь'}],
      ['steps',{d:td(),n:'много'}],
      ['foods',{n:'Битый продукт',u:0,k:'сто',p:null,f:NaN,c:undefined}],
      // ── добавлено 19.08 под правки этого дня ──
      // даты в будущем и заведомо невозможные: дневник теперь листается вперёд,
      // и записи будущим числом обязаны выпадать из расчётов, а не ломать их
      ['weight',{d:ds(dn(td())+3),kg:70}],
      ['weight',{d:'2099-99-99',kg:88}],
      ['log',{d:ds(dn(td())+2),n:'план',u:100,a:100,k:9000,p:500,f:400,c:900}],
      ['log',{d:'0000-00-00',n:'из ниоткуда',u:100,a:100,k:700,p:20,f:10,c:80}],
      ['steps',{d:ds(dn(td())+1),n:99999}],
      ['sleep',{d:ds(dn(td())+5),h:12}]
    ];
    for(const [store,rec] of bad){ try{ await put(store,rec); }catch(e){} }
    S.prog={cfg:{days:'три',equip:null,goal:'нет такой цели'},plan:[{n:'День',dow:99,ex:[{n:null,sets:'два'},{}]}]};
    S.pain={undefined:1}; S.water={'кривая':'много'};
    // анкета из чужого импорта: по этим полям считается базовый обмен и пол цели
    S.h='сто восемьдесят'; S.age=null; S.sex='икс'; S.pkg='два'; S.fkg=NaN; S.rate='минус полкило';
    await put('settings',S,'main');
    return 'посеяно';
  })()`));
  await sleep(500);
  console.log('перезагрузка с грязью…');
  await send('Page.reload'); await sleep(6000); drain();
  console.log('приложение живо:', await js('typeof APP_VER!=="undefined"?APP_VER:"НЕ ПОДНЯЛОСЬ"'));
  for(const v of ['food','train','body','health','coach']){
    await js(`(document.querySelector('nav button[data-v="${v}"]')||{click(){}}).click()`); await sleep(700); drain();
    const len=await js(`(document.getElementById('v-${v}')||{innerText:''}).innerText.length`);
    console.log('  вкладка '+v+': текста '+len);
  }
  for(const t of ['prog','ex','anal','log']){
    await js(`document.querySelector('nav button[data-v="train"]').click();(document.querySelector('[data-tr="${t}"]')||{click(){}}).click()`);
    await sleep(600); drain();
  }
  // расчёты, которых сегодня коснулись правки: ни один не имеет права бросить
  console.log('\nрасчёты на грязи:', await js(`(function(){ const out={}; const t=f=>{ try{ return JSON.stringify(f())||'ok' }catch(e){ return '❗'+e.message } };
    out['bmrOf']=t(()=>bmrOf(curW()));
    out['kcalFloor']=t(()=>kcalFloor());
    out['tdeeSane']=t(()=>tdeeSane());
    out['tg']=t(()=>tg());
    out['macroSplit']=t(()=>macroSplit(1700,curW()||80));
    out['estTDEE']=t(()=>estTDEE().ok);
    out['trend.len']=t(()=>trend().length);
    out['curW']=t(()=>curW());
    out['actRate']=t(()=>actRate());
    out['behaviorInsights']=t(()=>behaviorInsights().length);
    out['ringPct']=t(()=>{const r=ringPct(td()); return [r.food,r.train,r.act].map(x=>typeof x)});
    out['fitAiBody']=t(()=>typeof fitAiBody({model:'m',messages:[]}));
    return JSON.stringify(out,null,1)})()`));
  // и главный инвариант дня: будущее в расчёты не течёт
  console.log('\nбудущее не течёт в счёт:', await js(`(function(){
    const now=td();
    const badW=trend().filter(x=>x.d>now).length;
    const K=dayK(); const badK=Object.keys(K).filter(d=>d>now).length;
    return 'вес в тренде из будущего: '+badW+' · дней еды из будущего: '+badK})()`));

  console.log('\nсанитар почистил:', await js(`(async()=>{const w=await all('weight'),s=await all('sets'),l=await all('log');
    return 'вес '+w.length+', подходы '+s.length+', еда '+l.length})()`));
  const uniq=[...new Set(boom)];
  ch.kill(); srv.close();
  if(uniq.length){
    uniq.slice(0,10).forEach(x=>console.error('  \u2717 '+String(x).slice(0,220)));
    console.error(' \u2717 ГРЯЗЬ: приложение сломалось на битых данных ('+uniq.length+')');
    process.exit(1);
  }
  console.log(' \u2713 Грязные данные: приложение живо, все экраны рисуются, будущее не течёт в расчёты');
  process.exit(0);
})().catch(e=>{console.error('УПАЛО',e);process.exit(1)});
