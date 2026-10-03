// ОБХОД ПО КРУГУ — ищет дыры БЕЗ повода, а не попутно новой функции.
//
// Зачем он есть. Владелец 02.09: «я очень часто сталкиваюсь с фразой "нашёл
// настоящую дыру". Если я не строю новую функцию, проблема живёт». Он прав,
// и причина механическая: все наши правила в гейте — ПАМЯТЬ о прошлых
// поломках. Они стерегут то, что уже ломалось. Поломку, которая ещё ни разу
// не случалась, не стережёт ничто — и находится она только тогда, когда я
// случайно прохожу мимо, строя соседнее.
//
// Этот обход ищет иначе: он не знает наших прошлых багов и ничего не
// «проверяет по списку». Он берёт ВСЁ, что есть на экранах и в листах, и
// сверяет с четырьмя механическими свойствами, у которых нет исключений:
//
//   1. МЁРТВАЯ КНОПКА  — выглядит нажимаемой, но нажатие ничего не вызывает.
//   2. НЕМАЯ КНОПКА    — нажимаемое без подписи и без aria-label: человек
//                        не знает, что это, а незрячий не знает тем более.
//   3. ПУСТОЙ ЛИСТ     — лист открывается и не показывает ничего.
//   4. ТОЛЬКО В ПОЛНОМ — функция существует, но в простом режиме её нет.
//                        Это НЕ ошибка: это список того, чего не видит
//                        человек, не переключивший режим. Ровно так месяц
//                        «отсутствовало» сравнение фото (найдено 02.09).
//
// Это ОТЧЁТ, а не ворота: он ничего не запрещает и в buildCommand не входит.
// Падает он только если сам не смог отработать — молчаливый зелёный здесь
// был бы худшим исходом.
//
//   node tests/audit.js            — обход и отчёт
//   node tests/audit.js --strict   — ненулевой код возврата, если есть находки
const http=require('http'), https=require('https'), fs=require('fs'), path=require('path');
const {spawn,execFileSync}=require('child_process'), os=require('os');
const ROOT=path.resolve(__dirname,'..'), DIST=path.join(ROOT,'dist');
const CHROME=['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/usr/bin/chromium','/usr/bin/google-chrome']
  .find(p=>{try{return fs.statSync(p).isFile()}catch(e){return false}});
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.json':'application/json',
  '.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const STRICT=process.argv.includes('--strict');
/* --list печатает опись листов: чем они называются и сколько в них кнопок.
   Из неё пишется реестр обещаний SPEC.md — руками, потому что колонку
   «что обязана делать» ни один скрипт за человека не заполнит. */
const СПИСОК=process.argv.includes('--list');
/* --inventory: из каких «языков строк» собран каждый лист и страница настроек
   (решение владельца 27.09 «дальше главного экрана всё несуразное»): счёт
   классов набора и не-набора, чтобы перевод на один набор шёл по описи, а не
   по двум скриншотам. */
const ОПИСЬ=process.argv.includes('--inventory');
const PORT=9334;   // НЕ 9333: обход и browser.js должны уживаться рядом

if(!CHROME){ console.log(' — обход пропущен: Chromium не найден'); process.exit(0); }
if(!fs.existsSync(path.join(DIST,'index.html'))){ console.error(' ✗ Обход: нет dist — сначала node tests/build.js'); process.exit(1); }

let TLS=null;
try{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-audit-tls-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',dir+'/key.pem','-out',dir+'/cert.pem',
    '-days','2','-nodes','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  TLS={key:fs.readFileSync(dir+'/key.pem'),cert:fs.readFileSync(dir+'/cert.pem')};
}catch(e){ TLS=null; }

(async()=>{
  const mk=TLS?(h=>https.createServer(TLS,h)):http.createServer.bind(http);
  const srv=mk((q,s)=>{
    let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html';
    const f=path.join(DIST,p);
    if(!f.startsWith(DIST)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ s.writeHead(404); return s.end('no'); }
    let buf; try{ buf=fs.readFileSync(f); }catch(e){ s.writeHead(500); return s.end('err'); }
    s.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});
    s.end(buf);
  });
  srv.on('clientError',(e,sock)=>{ try{ sock.destroy(); }catch(_){} });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port=srv.address().port;

  /* Занятый порт отладки — не результат, а сломанный стенд: подключившись к
     чужой вкладке, обход выдаст выдуманные находки (напоролись 31.08). */
  await new Promise(res=>{
    const q=http.get('http://127.0.0.1:'+PORT+'/json/version',r=>{ r.resume();
      console.error(' ✗ Порт отладки '+PORT+' занят — обход подключится к чужой вкладке. Закрой прошлый прогон.');
      process.exit(1); });
    q.on('error',()=>res()); q.setTimeout(1500,()=>{ try{q.destroy()}catch(_){}; res(); });
  });
  const prof=path.join(os.tmpdir(),'bv-audit-'+process.pid);
  const ch=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--ignore-certificate-errors',
    '--remote-debugging-port='+PORT,'--user-data-dir='+prof,'--window-size=390,844','about:blank'],{stdio:'ignore'});
  const done=code=>{ try{ch.kill()}catch(e){} try{srv.close()}catch(e){}
    try{fs.rmSync(prof,{recursive:true,force:true})}catch(e){} process.exit(code); };

  let ws=null;
  for(let i=0;i<60&&!ws;i++){ await sleep(300);
    try{
      const list=await new Promise((ok,bad)=>{ http.get('http://127.0.0.1:'+PORT+'/json/list',r=>{
        let b=''; r.on('data',c=>b+=c); r.on('end',()=>ok(JSON.parse(b))); }).on('error',bad); });
      const pg=list.find(t=>t.type==='page'); if(pg) ws=new WebSocket(pg.webSocketDebuggerUrl);
    }catch(e){}
  }
  if(!ws){ console.log(' — обход пропущен: Chromium не отозвался'); return done(0); }
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0; const waiting=new Map();
  ws.addEventListener('message',ev=>{ const m=JSON.parse(ev.data);
    if(m.id&&waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
  const send=(method,params={})=>new Promise(res=>{ const i=++id; waiting.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
  const js=async expr=>{
    const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
    const d=r.result&&r.result.exceptionDetails;
    if(d) return {__err:(d.text||'')+' '+((d.exception&&d.exception.description)||'')};
    return r.result&&r.result.result?r.result.result.value:undefined;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await send('Page.navigate',{url:'https://localhost:'+port+'/index.html'});
  await sleep(4500);

  /* Обход идёт по ЗАПОЛНЕННОМУ приложению: на пустом половина карточек не
     смонтирована, и «ничего не нашлось» будет значить «нечего было искать». */
  const готов=await js(`(async()=>{ try{
    S.gated=1; S.onboardDone=1; S.ui='pro'; S.sex='m'; S.age=34; S.h=182; S.rate=-0.5;
    S.prog=genProgram({days:3,equip:'gym',goal:'hyper',exp:'mid',inj:[],dows:[1,2,3,4,5,6,7]});
    S.water=Object.assign({},S.water||{}); S.water[td()]=1400;
    await put('weight',{d:ds(dn(td())-1),kg:92});
    await put('weight',{d:td(),kg:91.6});
    await put('settings',S,'main'); await loadAll(); try{applyUI()}catch(e){} renderAll();
    return 'ок'; }catch(e){ return 'СБОЙ ПОДГОТОВКИ: '+e.message } })()`);
  if(готов!=='ок'){ console.error(' ✗ Обход не состоялся: '+JSON.stringify(готов)); return done(1); }
  await sleep(900);

  /* Функция «живая», если нажатие куда-то доходит: свой onclick, onclick
     предка, слушатель на нём или на предке, либо один из немногих
     делегированных селекторов приложения. Список делегатов короткий и
     собран из исходника: 364 обработчика назначаются напрямую, делегируются
     единицы. Если делегатов станет больше — этот список надо пополнить,
     иначе обход начнёт врать в сторону ложных находок (а не пропусков). */
  /* .dis-x — крестик предупреждений (v514): один слушатель на документе,
     обход 05.09 счёл его мёртвым, а браузерное правило крестиков видит,
     что он убирает сообщение. */
  const ДЕЛЕГАТЫ=['[data-sturl]','[data-ui-full]','#bdGoFull','[data-theme-set]','[data-onbv]','[data-act]','[data-v]','.dis-x'];

  const ЖИВОСТЬ=`(function(el){
    for(let n=el;n&&n!==document;n=n.parentElement){
      if(n.onclick||n.onchange||n.onsubmit) return 1;
      if(n.tagName==='A'&&n.getAttribute('href')) return 1;
      if(n.tagName==='LABEL'||n.tagName==='SUMMARY'||n.tagName==='INPUT'
        ||n.tagName==='SELECT'||n.tagName==='TEXTAREA'||n.tagName==='OPTION') return 1;
      if(n.getAttribute&&n.getAttribute('onclick')) return 1;
      try{ if(__DEL.some(s=>n.matches&&n.matches(s))) return 1; }catch(_){}
    }
    return 0;
  })`;
  await js('window.__DEL='+JSON.stringify(ДЕЛЕГАТЫ));

  const мёртвые=[], немые=[], пустые=[], только_полный=[], безОписания=[];
  /* Реестр обещаний SPEC.md сгниёт молча, если его не с чем сверять: новая
     функция появится, строку про неё никто не напишет, и через месяц файл
     будет описывать позапрошлое приложение. Поэтому обход читает реестр и
     называет то, чего в нём нет. Это единственный способ, каким документ
     может не отстать от кода. */
  let SPEC=''; try{ SPEC=fs.readFileSync(path.join(ROOT,'SPEC.md'),'utf8'); }catch(_){ SPEC=null; }

  /* ── ЭКРАНЫ ── */
  const ЭКРАНЫ=[['food','Еда'],['train','Зал'],['body','Тело'],['health','Здоровье'],['coach','Коуч'],['set','Настройки']];
  for(const [v,имя] of ЭКРАНЫ){
    const r=await js(`(async()=>{ try{
      /* «Настройки» — не вкладка, а лист sh-s. Первая версия обхода мерила
         document.querySelector('.view.on') и для настроек получала ПРЕДЫДУЩИЙ
         экран: строка «Настройки» в отчёте была дословной копией строки
         «Коуч», и я чуть не назвал владельцу удвоенное число. Корень берём
         именно тот, который открыли. */
      let корень=null;
      if('${v}'==='set'){ if(typeof openSet==='function') openSet();
        await new Promise(r=>setTimeout(r,700)); корень=document.getElementById('sh-s'); }
      else { goView('${v}'); await new Promise(r=>setTimeout(r,700));
        корень=document.getElementById('v-${v}'); }
      if(!корень||getComputedStyle(корень).display==='none') return JSON.stringify({сбой:'экран не открылся'});
      const кл=[...корень.querySelectorAll('button,.btn,.chip,[role="button"],.tap,.wcheck')]
        .filter(e=>{ const b=e.getBoundingClientRect(); return b.width>0&&b.height>0&&getComputedStyle(e).display!=='none'; });
      const имяЭл=e=>((e.getAttribute('aria-label')||e.title||e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,44))||('#'+(e.id||e.className||'?'));
      const мёртв=[], нем=[];
      кл.forEach(e=>{
        if(!${ЖИВОСТЬ}(e)) мёртв.push(имяЭл(e)+(e.id?' #'+e.id:''));
        const t=(e.textContent||'').trim();
        if(!t&&!e.getAttribute('aria-label')&&!e.title) нем.push('#'+(e.id||e.className||'?'));
      });
      const проф=[...корень.querySelectorAll('.pro')].map(e=>{
        const h=e.querySelector('h2,h3,.t,.hd h2');
        return (h?h.textContent:(e.textContent||'')).trim().replace(/\\s+/g,' ').slice(0,46); }).filter(Boolean);
      return JSON.stringify({кнопок:кл.length,мёртв,нем,проф:[...new Set(проф)]});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    let d; try{ d=JSON.parse(r) }catch(_){ d={сбой:'не разобрать ответ'} }
    if(d.сбой){ console.error('   экран «'+имя+'»: '+d.сбой); continue; }
    d.мёртв.forEach(x=>мёртвые.push(имя+' → '+x));
    d.нем.forEach(x=>немые.push(имя+' → '+x));
    d.проф.forEach(x=>только_полный.push(имя+' → '+x));
    console.log('   '+имя.padEnd(11)+' нажимаемых '+String(d.кнопок).padStart(3)
      +' · мёртвых '+d.мёртв.length+' · немых '+d.нем.length+' · только в полном '+d.проф.length);
  }

  /* ── ЛИСТЫ ──
     Лист, который открывается пустым, — это функция, которой как бы нет:
     человек её нашёл, ткнул и увидел ничего. Часть листов честно пуста без
     своего повода (нет продукта, нет анализа) — такие названы отдельно,
     а не спрятаны, чтобы решение принимал человек, а не тест. */
  if(ОПИСЬ){
    const СЧЁТ="(el)=>{ const q=s=>el.querySelectorAll(s).length; return {lrow:q('.lrow'),btn:q('.btn:not(.sec):not(.sm):not(.dgr)'),sec:q('.btn.sec'),sm:q('.btn.sm'),dgr:q('.btn.dgr'),det:q('details.det'),chip:q('.chip'),field:q('.field'),note:q('.note'),card:q('.card'),stat:q('.stat'),seg:q('.seg'),lst:q('.lst')}; }";
    const строки=[];
    const страницы=JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#sh-s .setpg')].map(p=>p.id))`)||'[]');
    for(const pg of страницы){
      const r=await js(`(async()=>{ try{ if(typeof openSet==='function') openSet(); await new Promise(r=>setTimeout(r,300));
        document.querySelectorAll('#sh-s .setpg').forEach(p=>{ p.hidden=(p.id!=='${pg}'); }); document.querySelectorAll('#sh-s .setpg details').forEach(d=>d.open=true);
        const el=document.getElementById('${pg}'); return JSON.stringify((${СЧЁТ})(el)); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      строки.push(['настройки/'+pg,JSON.parse(r||'{}')]);
    }
    try{ await js(`(function(){ try{ sheet('sh-s',false); }catch(_){} return 1 })()`); }catch(_){}
    const ЛИСТЫ0=JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.sheet[id^="sh-"]')].map(e=>e.id))`)||'[]');
    for(const sid of ЛИСТЫ0){ if(sid==='sh-s') continue;
      const r=await js(`(async()=>{ try{ sheet('${sid}',true); await new Promise(r=>setTimeout(r,300)); const el=document.getElementById('${sid}');
        const видно=!!(el&&getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().height>0); const o=(${СЧЁТ})(el); o.видно=видно; try{ sheet('${sid}',false); }catch(_){} return JSON.stringify(o); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      строки.push([sid,JSON.parse(r||'{}')]);
    }
    for(const [v] of [['food'],['train'],['body'],['health'],['coach']]){
      const r=await js(`(async()=>{ try{ goView('${v}'); await new Promise(r=>setTimeout(r,400)); document.querySelectorAll('#v-${v} details').forEach(d=>d.open=true); const el=document.getElementById('v-${v}'); return JSON.stringify((${СЧЁТ})(el)); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      строки.push(['вкладка/'+v,JSON.parse(r||'{}')]);
    }
    console.log('\nОПИСЬ КОМПОНЕНТОВ (lrow · btn · sec · sm · dgr · det · chip · field · note · card · stat · seg · lst)');
    строки.forEach(([k,o])=>{ if(o.сбой){ console.log('   '+k.padEnd(18)+' сбой: '+o.сбой); return; } if(o.видно===false) return;
      console.log('   '+k.padEnd(18)+[o.lrow,o.btn,o.sec,o.sm,o.dgr,o.det,o.chip,o.field,o.note,o.card,o.stat,o.seg,o.lst].map(x=>String(x).padStart(3)).join(' ')); });
    process.exit(0);
  }
  const ЛИСТЫ=await js(`JSON.stringify([...document.querySelectorAll('.sheet[id^="sh-"]')].map(e=>e.id))`);
  const листы=JSON.parse(ЛИСТЫ||'[]');
  let открыто=0;
  for(const sid of листы){
    const r=await js(`(async()=>{ try{
      sheet('${sid}',true); await new Promise(r=>setTimeout(r,420));
      const el=document.getElementById('${sid}');
      const видно=!!(el&&getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().height>0);
      const текст=el?(el.textContent||'').trim().replace(/\\s+/g,' '):'';
      const h=el?el.querySelector('h2,h3,.sh-t,b'):null;
      const ttl=h?(h.textContent||'').trim().replace(/\\s+/g,' ').slice(0,44):'';
      const кл=el?[...el.querySelectorAll('button,.btn,.chip,[role="button"]')].filter(e=>{
        const b=e.getBoundingClientRect(); return b.width>0&&b.height>0}):[];
      const мёртв=kl=>kl.filter(e=>!${ЖИВОСТЬ}(e)).map(e=>((e.getAttribute('aria-label')||e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40))||('#'+(e.id||'?')));
      try{ sheet('${sid}',false); }catch(_){}
      return JSON.stringify({видно,ttl,длина:текст.length,кнопок:кл.length,мёртв:мёртв(кл)});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    let d; try{ d=JSON.parse(r) }catch(_){ d={сбой:'не разобрать'} }
    if(d.сбой){ console.error('   лист '+sid+': '+d.сбой); continue; }
    if(SPEC!==null&&SPEC.indexOf('`'+sid+'`')<0) безОписания.push(sid+(d.ttl?' («'+d.ttl+'»)':''));
    if(!d.видно) continue;                     // не открылся сам по себе — ему нужен повод
    открыто++;
    if(СПИСОК) console.log('   '+sid.padEnd(12)+' '+String(d.кнопок).padStart(2)+' кн · '+(d.ttl||'(без заголовка)'));
    if(d.длина<40) пустые.push(sid+' (текста '+d.длина+' знаков)');
    d.мёртв.forEach(x=>мёртвые.push('лист '+sid+' → '+x));
    await sleep(120);
  }
  console.log('   листов открылось без повода: '+открыто+' из '+листы.length);

  /* Считаем РАЗНЫЕ находки, а не их экземпляры: один и тот же кружок подхода
     без подписи встречается двадцать раз, и «находок 20» соврало бы про
     масштаб — чинится он одной правкой. */
  const uniq=a=>[...new Set(a)];
  const о=[];
  const блок=(t,arr,пояс)=>{ const u=uniq(arr); if(!u.length) return;
    о.push(''); о.push(t+' — '+u.length+(u.length!==arr.length?' (мест на экране: '+arr.length+')':''));
    if(пояс) о.push('  '+пояс);
    u.slice(0,40).forEach(x=>о.push('  · '+x));
    if(u.length>40) о.push('  … и ещё '+(u.length-40)); };
  блок('МЁРТВЫЕ КНОПКИ',мёртвые,'выглядят нажимаемыми, но нажатие никуда не приходит');
  блок('НЕМЫЕ КНОПКИ',немые,'без подписи и без aria-label: непонятно зрячему, невидимо незрячему');
  /* Ниже — не находки, а СПРАВКА. Разделение принципиальное: список, который
     кричит на каждом прогоне, перестают читать, и вместе с ним перестают
     читать настоящие находки. Лист без своего повода (нет продукта, нет
     упражнения) пуст законно; в полном режиме функции живут по решению
     владельца. Человек смотрит сюда, когда сам спрашивает «а это у нас
     есть?» — и получает ответ вместо догадки. */
  if(SPEC===null) о.push(String.fromCharCode(10)+'РЕЕСТР SPEC.md НЕ НАЙДЕН — сверять обещания не с чем');
  блок('ФУНКЦИИ БЕЗ ОПИСАНИЯ В SPEC.md',безОписания,'функция есть, а что она обязана делать — нигде не записано');
  блок('СПРАВКА · листы, пустые без повода',пустые,'откроются наполненными только со своим поводом — сами по себе это не баг');
  блок('СПРАВКА · только в полном режиме',только_полный,'функции есть, но человек в простом режиме их не видит вовсе');

  console.log(о.join('\n'));
  const находок=uniq(мёртвые).length+uniq(немые).length+uniq(безОписания).length;
  console.log('');
  console.log(находок
    ? ' ⚑ Обход: находок '+находок+' — мёртвые и немые кнопки выше. В справке: листов без повода '
      +uniq(пустые).length+', функций только в полном режиме '+uniq(только_полный).length
    : ' ✓ Обход: ни одной мёртвой и ни одной немой кнопки, все функции описаны в SPEC.md. В справке: листов без повода '
      +uniq(пустые).length+', функций только в полном режиме '+uniq(только_полный).length);
  return done(STRICT&&находок?1:0);
})().catch(e=>{ console.error(' ✗ Обход сорвался: '+(e&&e.stack||e)); process.exit(1); });
