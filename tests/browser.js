// ПРОВЕРКА В НАСТОЯЩЕМ БРАУЗЕРЕ — то, чего не видит фейковый DOM.
//
// Зачем: smoke и полевые тесты гоняют логику в поддельном DOM. Он честно ловит
// краши и расчёты, но не знает ни про CSS, ни про то, ЧТО человек реально видит
// на экране. 18.08 это стоило ошибки: простой режим (v265) по разметке выглядел
// урезанным, а в браузере первые экраны новичка оказались почти такими же, как
// в полном. Нашлось только здесь.
//
// Зависимостей нет: системный Chromium + CDP через встроенный WebSocket Node 22.
// НЕ часть buildCommand — на Vercel браузера нет. Запускать руками перед пушем
// заметных правок интерфейса:  node tests/browser.js
// Нет Chromium — тест не падает, а честно говорит, что пропущен.
const http=require('http'), https=require('https'), fs=require('fs'), path=require('path');
const {spawn,execFileSync}=require('child_process'), os=require('os');
const ROOT=path.resolve(__dirname,'..');
const DIST=path.join(ROOT,'dist');
/* Путь к браузеру ищем, а не прибиваем гвоздём (11.09). Здесь стоял
   '/opt/pw-browsers/chromium-1194/...' — с номером сборки внутри. Любое
   обновление окружения меняет номер, путь перестаёт находиться, и прогон
   «пропускается» молча. Та же болезнь, что и тихий пропуск ниже: правило,
   которое умеет не запуститься незаметно, однажды не запустится. */
/* BV_CHROME — путь к браузеру, заданный снаружи (11.09). В CI мы ставим
   Chrome for Testing закреплённой версии: предустановленный Chrome 152 на
   раннере стартует, но отладку не открывает, и три попытки это обойти ушли
   в пустоту. Переменная всегда главнее поиска по системе. */
const CHROME=(function(){
  if(process.env.BV_CHROME){ try{ if(fs.statSync(process.env.BV_CHROME).isFile()) return process.env.BV_CHROME; }catch(e){} }
  for(const base of ['/opt/pw-browsers','/root/.cache/ms-playwright']){
    try{ if(!fs.existsSync(base)) continue;
      for(const d of fs.readdirSync(base)){
        const p1=path.join(base,d,'chrome-linux','chrome');
        if(fs.existsSync(p1)) return p1;
      } }catch(e){}
  }
  for(const p1 of ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'])
    try{ if(fs.statSync(p1).isFile()) return p1; }catch(e){}
  return null;
})();
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.json':'application/json',
  '.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* Глобальный WebSocket есть в Node 22+. В Node 20 его нет, и `new WebSocket`
   падал ReferenceError внутри try/catch — прогон в CI три недели сообщал
   «браузер вкладки не отдал», а виноват был не браузер (23.09). Проверяем
   вслух и до запуска браузера. */
if(typeof WebSocket==='undefined'){ console.error(' ✗ Нужен Node 22+: в '+process.version+' нет глобального WebSocket, а без него с браузером не поговорить'); process.exit(1); }
if(!CHROME){ console.log(' — браузерная проверка пропущена: Chromium не найден');
  /* В CI Chromium обязан быть. Молчаливый зелёный тут — это ровно тот случай,
     когда «проверка прошла» означает «проверка не запускалась» (31.08). */
  if(process.env.BV_REQUIRE_BROWSER==='1'){ console.error(' \u2717 Chromium не найден, а он обязателен'); process.exit(1); }
  process.exit(0); }
if(!fs.existsSync(path.join(DIST,'index.html'))){ console.error(' ✗ Браузер: нет dist — сначала node tests/build.js'); process.exit(1); }

const fail=[];
const chk=(cond,msg)=>{ if(!cond) fail.push(msg); };

/* Стенд поднимаем по HTTPS: service worker живёт только в защищённом
   контексте, а без него нельзя проверить главное полевое обещание —
   что приложение открывается без сети. Сертификат самоподписанный,
   браузеру велено не ругаться. Нет openssl — офлайн-часть пропускаем. */
let TLS=null;
try{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-tls-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',dir+'/key.pem','-out',dir+'/cert.pem',
    '-days','2','-nodes','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  TLS={key:fs.readFileSync(dir+'/key.pem'),cert:fs.readFileSync(dir+'/cert.pem'),dir};
}catch(e){ TLS=null; }

(async()=>{
  const mk=TLS?(h=>https.createServer(TLS,h)):http.createServer.bind(http);
  const srv=mk((q,s)=>{
    let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html';
    /* ── СТРАНИЦА С ВЫРЕЗОМ (v620) ──
       Chromium не умеет эмулировать env(safe-area-inset-*), а проверять их
       надо именно рендером: в CSS они могут стоять, а числа, которые от них
       считаются в JS, — отставать. Отдаём ту же сборку, где env() заменены
       переменными с числами iPhone 16 Pro (вырез 59 pt, полоса хоум-свайпа
       34 pt). Ничего, кроме четырёх значений, не меняется. */
    if(p==='/notch.html'){
      let src=fs.readFileSync(path.join(DIST,'index.html'),'utf8');
      [['env(safe-area-inset-top,0px)','var(--sim-sat)'],['env(safe-area-inset-top, 0px)','var(--sim-sat)'],
       ['env(safe-area-inset-bottom,0px)','var(--sim-sab)'],['env(safe-area-inset-bottom, 0px)','var(--sim-sab)'],
       ['env(safe-area-inset-top)','var(--sim-sat)'],['env(safe-area-inset-bottom)','var(--sim-sab)'],
       ['env(safe-area-inset-left)','var(--sim-sal)'],['env(safe-area-inset-right)','var(--sim-sar)']
      ].forEach(([x,y])=>{ src=src.split(x).join(y); });
      src=src.replace('<head>','<head><style>:root{--sim-sat:59px;--sim-sab:34px;--sim-sal:0px;--sim-sar:0px}</style>');
      s.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store'});
      return s.end(src);
    }
    const f=path.join(DIST,p);
    if(!f.startsWith(DIST)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ s.writeHead(404); return s.end('no'); }
    /* Отдаём файл ЦЕЛИКОМ из буфера, а не потоком. Поток здесь трижды за
       день ронял регистрацию service worker: «Failed to update a
       ServiceWorker … unknown error when fetching the script», и прогон
       падал на ровном месте — на следующем запуске всё было зелено.
       Мигающее правило хуже отсутствующего: оно учит не верить гейту.
       Файлы сборки маленькие, читать их синхронно дешевле, чем ловить
       гонку; no-store — чтобы проверка обновления SW не получала кэш. */
    let buf; try{ buf=fs.readFileSync(f); }catch(e){ s.writeHead(500); return s.end('err'); }
    s.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream',
      'cache-control':'no-store','service-worker-allowed':'/'});
    s.end(buf);
  });
  srv.on('clientError',(e,sock)=>{ try{ sock.destroy(); }catch(_){} });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port=srv.address().port;
  /* ── ВТОРОЙ ПРОГОН НА ТОМ ЖЕ ПОРТУ ВРЁТ, А НЕ ПАДАЕТ ──
     Выведено 31.08. Порт отладки зашит числом, и когда прогон запустили
     дважды, второй подключился к чужой вкладке первого. Результат не был
     похож на поломку стенда: одиннадцать «нарушений» с осмысленными
     формулировками — «до первого упражнения -1 px», «в настройках нет ни
     одной галочки», «поле lab_d на 0 при листе 0..0». Я почти отчитался
     о регрессии, которой не было. Занятый порт — это НЕ результат, и
     говорить об этом надо до прогона, а не гадать по его выводу. */
  await new Promise(res=>{
    const q=http.get('http://127.0.0.1:9333/json/version',r=>{ r.resume();
      console.error(' \u2717 Порт отладки 9333 уже занят: на нём висит другой Chromium.');
      console.error('   Второй прогон подключится к ЧУЖОЙ вкладке и выдаст выдуманные нарушения.');
      console.error('   Закрой прошлый прогон и запусти заново.');
      process.exit(1); });
    q.on('error',()=>res()); q.setTimeout(1500,()=>{ try{q.destroy()}catch(_){}; res(); });
  });
  /* Профиль кладём в ДОМАШНЮЮ папку, а не в /tmp (11.09). В CI Chromium
     приходит snap-пакетом (chromium-browser на Ubuntu 24.04 — транзитный
     пакет к snap), а у snap свой изолированный /tmp: профиль уезжал в
     чужое пространство имён, браузер не поднимался как надо и отладочный
     порт не отвечал. Домашняя папка видна snap-у всегда. */
  const prof=path.join(process.env.HOME||require('os').homedir()||require('os').tmpdir(),'.bv-chrome-'+process.pid);
  /* --disable-dev-shm-usage: в контейнерах CI /dev/shm всего 64 МБ, и
     Chromium падает на старте молча. Стандартная беда, не наша особенность.
     stdio: раньше стоял 'ignore', и при отказе браузера мы видели только
     «не отозвался» без единого слова о причине — прогон полгода мог
     пропускаться, и никто бы не узнал. Держим хвост его вывода. */
  /* ── ЗАПУСК С ПОВТОРОМ И ОПИСЬЮ (11.09) ──
     CI ответил однозначно: DevToolsActivePort не появился, то есть Chrome
     стартовал (видно его вывод), но отладку не открыл вовсе. Форма ключа
     headless у разных сборок разная, и проверить обе локально нельзя —
     здесь Chromium 141, там Chrome 152. Поэтому пробуем обе по очереди,
     каждый раз на чистом профиле, и в отказе показываем, что в профиле
     реально лежит. Гадать вслепую я уже пробовал дважды. */
  const chErr=[];
  /* ПОРТ 0 (23.09): фиксированный 9333 в CI занят или не открывается — три
     недели красных прогонов, и Chromium из Playwright 1.56.1 (тот же, что
     здесь) в CI повёл себя так же. Локальная проба показала и второе: с
     фиксированным портом DevToolsActivePort не появляется даже там, где
     браузер отвечает, — стенд выживал только прямым стуком в 9333. С портом 0
     браузер берёт свободный, пишет его в файл и в stderr строкой
     «DevTools listening on ws://127.0.0.1:PORT/…» — читаем оба источника. */
  let ch=null, ws=null, cdpPort=0, portFile=false, triedForms=[];
  const prof0=prof;
  const done=code=>{ try{ch&&ch.kill()}catch(e){} try{srv.close()}catch(e){}
    try{fs.rmSync(prof0,{recursive:true,force:true})}catch(e){} process.exit(code); };

  for(const form of ['--headless','--headless=new']){
    if(ws) break;
    triedForms.push(form);
    try{ fs.rmSync(prof,{recursive:true,force:true}); }catch(e){}
    try{ fs.mkdirSync(prof,{recursive:true}); }catch(e){}
    /* --disable-dev-shm-usage: в контейнерах CI /dev/shm всего 64 МБ, и
       браузер падает на старте молча. stdio: раньше стоял 'ignore', и при
       отказе мы видели только «не отозвался» без единого слова о причине —
       прогон полгода мог пропускаться, и никто бы не узнал. */
    ch=spawn(CHROME,[form,'--no-first-run','--no-default-browser-check','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--ignore-certificate-errors','--remote-debugging-port=0',
      '--user-data-dir='+prof,'--window-size=390,844','about:blank'],{stdio:['ignore','ignore','pipe']});
    if(ch.stderr) ch.stderr.on('data',d=>{ const t=String(d); chErr.push(t); if(chErr.length>40) chErr.shift();
      const m=/DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(t); if(m&&+m[1]>0) cdpPort=+m[1]; });
    ch.on('error',e=>chErr.push('не запустился: '+e.message));

    /* ПОРТ БЕРЁМ У САМОГО БРАУЗЕРА. Спрашивать заранее назначенный —
       гадание: Chrome вправе взять другой. Он пишет настоящий порт в
       DevToolsActivePort внутри профиля, первой строкой. */
    for(let i=0;i<40&&!ws;i++){
      await sleep(300);
      try{ const f=path.join(prof,'DevToolsActivePort');
        if(fs.existsSync(f)){ portFile=true;
          const p=parseInt(String(fs.readFileSync(f,'utf8')).split(String.fromCharCode(10))[0],10);
          if(p>0) cdpPort=p; } }catch(e){}
      for(const host of ['127.0.0.1','[::1]']){
        if(ws||!(cdpPort>0)) break;
        try{
          const list=await new Promise((ok,bad)=>{ http.get('http://'+host+':'+cdpPort+'/json/list',r=>{
            let b=''; r.on('data',c=>b+=c); r.on('end',()=>ok(JSON.parse(b))); }).on('error',bad); });
          const page=list.find(t=>t.type==='page');
          if(page) ws=new WebSocket(page.webSocketDebuggerUrl);
        }catch(e){}
      }
    }
    if(!ws){ try{ch.kill()}catch(e){} }
  }
  if(!ws){
    /* Весь хвост, а не шесть строк: в CI 23.09 шесть последних строк были
       про dbus и GCM, а причина отказа порта (если он её называет) стояла
       выше и в отчёт не попадала. Диагноз, обрезанный до шума, — не диагноз. */
    const why=chErr.join('').trim().split(String.fromCharCode(10)).filter(Boolean).slice(-30).join(' | ');
    let inside='';
    try{ inside=fs.readdirSync(prof).slice(0,12).join(', ')||'(пусто)'; }catch(e){ inside='(папки нет: '+e.code+')'; }
    if(process.env.BV_REQUIRE_BROWSER==='1'){
      console.error(' ✗ Браузер не отозвался по порту '+cdpPort+', а прогон обязателен');
      console.error('   пробовали формы: '+triedForms.join(' и '));
      console.error(portFile
        ? '   отладку он открыл (DevToolsActivePort есть, порт '+cdpPort+'), но вкладки не отдал'
        : '   DevToolsActivePort в профиле НЕ появился — отладка не открылась вовсе');
      console.error('   в профиле лежит: '+inside);
      if(why) console.error('   он сказал: '+why);
      else console.error('   он не сказал ничего — значит не стартовал вовсе');
      return done(1);
    }
    console.log(' — браузерная проверка пропущена: Chromium не отозвался');
    if(why) console.log('   причина: '+why);
    return done(0);
  }
  await new Promise(r=>ws.addEventListener('open',r));

  let id=0; const waiting=new Map(), events=[];
  ws.addEventListener('message',ev=>{ const m=JSON.parse(ev.data);
    if(m.id&&waiting.has(m.id)){ waiting.get(m.id)(m); waiting.delete(m.id); } else if(m.method) events.push(m); });
  const send=(method,params={})=>new Promise(res=>{ const i=++id; waiting.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
  const js=async expr=>{
    const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
    /* v635: ошибку протокола (контекст уничтожен, страница ушла) отдаём как __err,
       а не как undefined: undefined читается стендами как «пусто», и восемь
       проверок падают с «undefined» вместо одной честной причины. */
    if(r&&r.error) return {__err:'CDP: '+(r.error.message||JSON.stringify(r.error))};
    const d=r.result&&r.result.exceptionDetails;
    if(d) return {__err:d.text+' '+((d.exception&&d.exception.description)||'')};
    return r.result&&r.result.result?r.result.result.value:undefined;
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

  /* Сетевые 404 к Supabase в оффлайн-стенде — это стенд, а не баг приложения.
     С v497 сюда же /media/: картинки справочника лежат в R2 и ходят через
     прокси боевого домена, а стенд отдаёт только dist/. Промах по ним
     приложение обрабатывает само (onerror прячет кадр), то есть это не
     ошибка приложения, а отсутствие хранилища у харнесса. Исключение узкое:
     ровно префикс /media/, всё остальное по-прежнему валит прогон. */
  const NETNOISE=/steps_pull|app_events|rest\/v1|\/sb\/|\/api\/|\/media\//;
  const boom=[];
  /* ── ТЕЛЕМЕТРИЯ НЕ УХОДИТ СО СТЕНДА (правило 30.08) ──
     Замер в боевой базе: 179 «людей» при двух живых. Каждый запуск с пустым
     хранилищем — стенд, превью ветки, второй браузер — заводил новый anon_id
     и ложился в ту же таблицу, что живые люди; ворота 31 октября по таким
     цифрам не посчитать. Стенд работает на localhost, то есть заведомо не
     прод: ни одного запроса в app_events и client_errors быть не должно.
     Правило меряет ВЫХОД — сетевые запросы, а не наличие проверки в коде. */
  const телеметрия=[];
  const drain=()=>{ while(events.length){ const e=events.shift();
    if(e.method==='Network.requestWillBeSent'){
      const u=(e.params&&e.params.request&&e.params.request.url)||'';
      if(/\/rest\/v1\/(app_events|client_errors)/.test(u)) телеметрия.push(u.slice(0,80));
    }
    if(e.method==='Runtime.exceptionThrown'){ const d=e.params.exceptionDetails;
      boom.push('исключение: '+((d.exception&&(d.exception.description||d.exception.value))||d.text)); }
    if(e.method==='Log.entryAdded'&&e.params.entry.level==='error'){
      const t=e.params.entry.text+' '+(e.params.entry.url||'');
      if(!NETNOISE.test(t)) boom.push('ошибка в консоли: '+t); }
  }};

  const BASE=(TLS?'https://localhost:':'http://127.0.0.1:')+port;
  await send('Network.enable');

  /* ── ГОТОВНОСТЬ ЖДЁМ ПО ПРИЗНАКУ, А НЕ ПО ТАЙМЕРУ (долг v463 закрыт 30.08) ──
     Было: navigate + sleep(4500) и сразу замеры. Таймер — это НАДЕЖДА, что
     старт уложился, а не знание. Один прогон дал четыре нарушения подряд
     («пустые кольца», «вода 0/2500», «нет приветствия», «три раза 0/0»),
     следующий на том же коде — чисто: замеры успевали к недорисованному
     экрану, где данные из IndexedDB ещё не подняты. Мигающее правило хуже
     отсутствующего: оно учит не верить гейту.
     Приложение уже говорит о готовности само — window.__bvBoot=true ставится
     в конце старта (и в ветке ошибки тоже, поэтому проверяем ещё и APP_VER).
     Тот же класс, что «фикстура обязана ЗАДАВАТЬ состояние явно»: ждём
     признак, а не время, и если он не пришёл — падаем громко и по делу. */
  const ready=async(what)=>{
    for(let i=0;i<120;i++){
      if(await js('window.__bvBoot===true&&typeof APP_VER!=="undefined"')) { await sleep(250); return true; }
      await sleep(250);
    }
    fail.push('приложение не сообщило о готовности за 30 с ('+what+') — дальше меряли бы недорисованный экран');
    return false;
  };

  /* Замедляем процессор на время старта — так открывает приложение человек
     со слабым телефоном. Замер 30.08: под 20-кратным замедлением прежняя
     версия проверки (фиксированный таймер) дала ровно те четыре нарушения,
     что владелец видел в поле, а ожидание признака готовности держится.
     Замедление оставлено насовсем: без него правило зелено на любой машине
     и не поймает возврат таймера. */
  await send('Emulation.setCPUThrottlingRate',{rate:20});
  /* ── ЭМУЛЯТОР КЛАВИАТУРЫ iOS ──
     Ставится ДО загрузки, чтобы приложение подписалось уже на него. Пока
     __kbd(0,0) — ведёт себя ровно как настоящий visualViewport, на остальные
     правила не влияет. Зачем нужен: настоящая клавиатура НЕ уменьшает окно,
     она уменьшает только видимую область и вдобавок сдвигает её вниз
     (offsetTop). Эмуляция устройства (setDeviceMetricsOverride) ужимает ОБА
     окна сразу — а значит расхождения, на котором живут все баги с
     клавиатурой, в ней не существует, и правило 390×420 их не видело.
     Полевой скриншот 31.08 (ввод бренда: на экране одна кнопка «Добавить»,
     поле ушло за верхний край) — ровно этот случай. */
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(function(){
    var KB=0, TOP=0, tgt=new EventTarget();
    var fake={ get height(){ return Math.round(window.innerHeight-KB) },
      get width(){ return window.innerWidth }, get offsetTop(){ return TOP },
      get offsetLeft(){ return 0 }, get pageTop(){ return window.scrollY },
      get pageLeft(){ return window.scrollX }, get scale(){ return 1 },
      addEventListener:function(){ return tgt.addEventListener.apply(tgt,arguments) },
      removeEventListener:function(){ return tgt.removeEventListener.apply(tgt,arguments) },
      dispatchEvent:function(){ return tgt.dispatchEvent.apply(tgt,arguments) } };
    try{ Object.defineProperty(window,'visualViewport',{configurable:true,get:function(){ return fake }}); }
    catch(e){ window.__kbdFail='defineProperty: '+e.message }
    window.__kbd=function(px,top){ KB=px|0; TOP=top|0;
      tgt.dispatchEvent(new Event('resize')); tgt.dispatchEvent(new Event('scroll')); return fake.height };
  })()`});
  await send('Page.navigate',{url:BASE+'/index.html'});
  const __t0=Date.now();
  await ready('первый запуск');
  console.log('   старт под 20-кратным замедлением: '+Math.round((Date.now()-__t0)/100)/10+' с');
  await send('Emulation.setCPUThrottlingRate',{rate:1});
  drain();

  // 1. Приложение вообще стартовало и показало себя
  const ver=await js('typeof APP_VER!=="undefined"?APP_VER:null');
  chk(!!ver,'приложение не стартовало: APP_VER недоступен');
  chk((await js('document.body.innerText.length'))>200,'экран пустой — человек увидит белый лист');

  // 2. Ежедневный минимум виден глазами, а не «есть в разметке»
  const seen=id=>js(`(function(){const e=document.getElementById("${id}");
    return !!e&&e.offsetParent!==null&&e.getBoundingClientRect().width>0})()`);
  /* ПЕРВЫЕ ДЕСЯТЬ МИНУТ — ВЫЧИТАНИЕМ (24.08). Правило перевёрнуто: раньше тест
     требовал, чтобы кольца и вода были видны СРАЗУ. Замер показал, что у
     человека без единой записи это приборы с нулями — «Цели пока нет»,
     «0 / 2500», «0 / 8000», всего 1643 px пустоты на экране 844. Пустой прибор
     не мотивирует, а выглядит как уже сломанное приложение.
     Теперь проверяем ОБЕ стороны: у новичка их нет, после первого действия —
     обязаны вернуться. Иначе «спрятали» легко превращается в «потеряли». */
  chk(await seen('qSearch'),'поиск еды не виден на первом экране');
  /* v634: кольца нет; шкала калорий живёт в таблице БЖУ и без цели прячется
     вместе с ней, а на её месте стоит одна строка с действием. */
  chk(!(await seen('kcalRow')),'новичку без единой записи показана шкала калорий с нулями — читается как сломанное приложение');
  chk(await seen('macHint'),'без цели на первом экране нет строки «заполни рост и вес» — новичок видит пустую карточку');
  chk(!(await seen('wVal')),'новичку без единой записи показана вода «0 / 2500» — считать ещё нечего');
  chk((await js(`document.body.innerText.indexOf('Добро пожаловать')>=0`)),'новичка не встречает приветствие');
  {
    await js(`(async()=>{ await put('weight',{d:td(),kg:82.4}); W=await all('weight'); renderAll(); })()`);
    await sleep(900);
    /* v634: кольца нет. Один вес цели не даёт (нужны рост и возраст), поэтому
       шкала калорий здесь и не обязана появиться — обещание «приборы
       возвращаются после первого действия» несёт вода строкой ниже. */
    chk(await seen('wVal'),'записал вес — а вода не вернулась');
    chk(!(await js(`document.body.innerText.indexOf('Добро пожаловать')>=0`)),'записал вес — а приложение всё ещё встречает его как новичка');
    await js(`(async()=>{ for(const w of (W||[])) await del('weight',w.d); W=await all('weight'); renderAll(); })()`);
    await sleep(700);
  }

  // 2б. Новичка не встречает стена нулей (первое впечатление = сломано)
  const zeros=await js(`(function(){const v=document.getElementById('v-food');
    return v?v.innerText.split('0'+String.fromCharCode(47)+'0').length-1:0})()`);
  chk(zeros===0,'на первом экране новичка '+zeros+' раз написано «0/0» — выглядит как сломанное приложение');

  /* 2в. Пустое приложение не встречает человека прочерками и упрёком.
     Тот же класс, что «0/0»: таблица из пяти «—» читается в первый день как
     «приложение не работает», а строка «Профиль неполный» дублирует карточку
     первых двух недель, где те же пункты уже поданы как план (прогон
     первого запуска 19.08). С 04.09 — по форме CRAFT: переход по вкладке
     тапом из Node, замер коротким синхронным вызовом с одним повтором,
     а не ответ одного длинного async-вызова — тот приходил пустым при
     исправном приложении и ронял прогон на JSON.parse(undefined). */
  {
    /* Замер — синхронный вызов; промолчала страница — один повтор через
       400 мс. Ответ разбираем сами: пустота и ошибка контекста — «сбой»
       правила, а не краш прогона. Вкладка — тапом по нижнему меню, как палец;
       что она открылась, спрашиваем у DOM (#v-….on), а не верим тапу. */
    const спроси=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); }
      if(r==null||r==='') return {сбой:'не разобрать'}; if(typeof r==='object') return {сбой:String(r.__err||'не разобрать')};
      try{ return JSON.parse(r); }catch(e){ return {сбой:'не разобрать: '+r}; } };
    const тап=async v=>{ await js(`(document.querySelector('nav button[data-v="${v}"]')||{click(){}}).click()`); await sleep(400); };
    /* Прочерки: по каждой вкладке — тап, затем счёт видимых «-», «–», «—». */
    const d={}, сбой=[];
    for(const v of ['food','train','body','coach']){
      await тап(v);
      const o=await спроси(`(function(){ try{ const root=document.getElementById('v-${v}');
        return JSON.stringify({на:!!document.querySelector('#v-${v}.on'),
          n:root?[...root.querySelectorAll('*')].filter(e=>e.children.length===0
            && e.offsetParent!==null
            && ['-','\u2013','\u2014'].indexOf((e.textContent||'').trim())>=0).length:0}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      if(o.сбой) сбой.push(v+': '+o.сбой); else d[v]=o;
    }
    chk(!сбой.length,'замер прочерков сорвался: '+сбой.join('; ')+' — проверка пустых вкладок ничего не проверила');
    Object.keys(d).forEach(v=>chk(d[v].на===true,'вкладка «'+v+'» не открылась тапом — проверка прочерков ничего не проверила'));
    Object.keys(d).forEach(v=>chk(d[v].n<=2,
      'на пустой вкладке «'+v+'» видно '+d[v].n+' прочерков подряд — в первый день это читается как сломанное приложение'));
    /* Упрёк: «Зал» — тап, затем читаем текст вкладки. */
    await тап('train');
    const nag=await спроси(`(function(){ try{ const t=document.getElementById('v-train').innerText;
      return JSON.stringify({на:!!document.querySelector('#v-train.on'),
        оба:t.indexOf('Первые две недели')>=0 && t.indexOf('Профиль неполный')>=0}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    chk(!nag.сбой,'замер упрёка на «Зале» сорвался: '+nag.сбой);
    if(!nag.сбой){
      chk(nag.на===true,'вкладка «Зал» не открылась тапом — проверка упрёка ничего не проверила');
      chk(nag.оба===false,'новичку одновременно показаны план первых двух недель и упрёк «Профиль неполный» — один и тот же список дважды, второй раз укором');
    }
    /* Первый шаг пути первых двух недель — записать вес. Значит на вкладке,
       которая про вес, должен быть видимый способ это сделать. До 19.08 ввод
       жил только на «Еде» в свёрнутой раскрывашке, а «Тело» встречало пустым
       графиком с надписью «нужно минимум 2 взвешивания» и ни одной кнопкой.
       С 04.09 — та же форма: «Тело» тапом из Node, поле считаем синхронно. */
    await тап('body');
    const wIn=await спроси(`(function(){ try{ const root=document.getElementById('v-body');
      return JSON.stringify({на:!!document.querySelector('#v-body.on'),
        /* v616: поля дробного ввода стали type="text" с inputmode="decimal" (запятая iOS) —
           ищем поле ЧИСЛА по клавиатуре, а не по типу, иначе правило считает пустоту. */
        n:[...root.querySelectorAll('input[type=number],input[inputmode="decimal"],input[inputmode="numeric"]')].filter(e=>e.offsetParent!==null).length}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    chk(!wIn.сбой,'замер поля веса на «Теле» сорвался: '+wIn.сбой);
    if(!wIn.сбой){
      chk(wIn.на===true,'вкладка «Тело» не открылась тапом — проверка поля веса ничего не проверила');
      chk(wIn.n>=1,'на вкладке «Тело» у новичка нет поля для записи веса — приложение просит взвешиваться и не даёт где');
    }
    if(process.env.BVDBG) console.log('   DBG пустые вкладки: '+JSON.stringify({прочерки:d,упрёк:nag,поле:wIn}));
  }
  await js(`document.querySelector('nav button[data-v="food"]').click()`); await sleep(400);
  /* Вес — утреннее действие ровно один раз в день: форма стоит наверху, пока
     сегодня не взвешивались, и уходит сразу после записи. Иначе она занимает
     место весь день ради того, к чему уже не вернутся. */
  const wTop=async()=>await js(`(function(){const e=document.getElementById('wTop');
    return !!(e&&e.offsetParent!==null)})()`);
  chk((await wTop())===true,'утром форма веса не показана — человеку негде записать вес там, где он начинает день');
  await js(`(async()=>{ await put('weight',{d:td(),kg:80}); W=await all('weight'); rFood(); return 1 })()`);
  await sleep(500);
  chk((await wTop())===false,'вес за сегодня записан, а форма всё равно занимает верх экрана до конца дня');
  await js(`(async()=>{ const all_=await all('weight');
    for(const w of all_) if(w.d===td()) await del('weight',w.id);
    W=await all('weight'); rFood(); return 1 })()`);
  await sleep(400); drain();
  await js(`document.querySelector('nav button[data-v="food"]').click()`); await sleep(400); drain();

  // 3. Ничего не вылезает за ширину телефона
  const wide=await js(`document.documentElement.scrollWidth-innerWidth`);
  chk(wide<=2,'экран шире телефона на '+wide+' px — появится горизонтальная прокрутка');

  /* 3а. И ОТДЕЛЬНО — ЧТО ОБРЕЗАЛОСЬ ВНУТРИ.
     Страница может быть ровно по ширине, а смысл при этом пропасть: строка с
     ellipsis молча съедает то, что стоит в ней последним. Замер на 320 px:
     ярлык «без готовки» уезжал за край на 62 px и обрезался целиком — человек
     выбирал, что съесть, не видя, надо ли это готовить. Правило: ни один
     видимый элемент не имеет права уезжать за край экрана, если его не
     листают горизонтально. Проверяем и на узком телефоне (320 px): именно там
     такое вылезает первым. */
  /* 3а-бис. ВЫЛЕЗЛО ИЗ СВОЕЙ СТРОКИ — а не только за экран.
     Проверка ниже смотрела на край ЭКРАНА, и этого не хватило: кнопка
     «Записать» с flex-basis:auto при .btn{width:100%} требовала всю ширину
     строки, выдавливала поле ввода в полоску и уезжала за край КАРТОЧКИ —
     оставаясь при этом на экране. Владелец увидел это первым, тест молчал
     (поле 23.08). Правило: ребёнок строки не имеет права выходить за неё,
     а поле ввода — схлопываться в ничто. */
  /* 3а-четырежды. МУСОР В НАСТРОЙКАХ НЕ ДОХОДИТ ДО ЭКРАНА.
     v357 закрыл это для сторов (сон, готовность), но поля настроек тогда не
     трогали — и «Абонемент заканчивается через NaN дн.» спокойно висело на
     Зале, если в S.gym оказалась не дата (старый бэкап, синк со старой
     версии, правка файла). Найдено глазами на скриншоте 23.08. Правило: с
     любым мусором в настройках ни на одном экране нет ни NaN, ни undefined,
     ни [object Object]. */
  {
    const JUNK=`(function(){ const bad=[];
      const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n;
      while((n=w.nextNode())){
        const t=(n.nodeValue||'').trim(); if(!t) continue;
        const el=n.parentElement; if(!el) continue;
        if(el.closest('.sheet:not(.on),#gate,#splash,script,style')) continue;
        const st=getComputedStyle(el);
        if(st.display==='none'||st.visibility==='hidden') continue;
        if(el.closest('details:not([open])')&&!el.matches('summary,summary *')) continue;
        if(el.checkVisibility&&!el.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) continue;
        ['NaN','undefined','[object Object]','Infinity'].forEach(function(k){
          if(t.indexOf(k)>=0) bad.push(k+' → «'+t.slice(0,50)+'»'); });
      }
      return [...new Set(bad)].slice(0,4); })()`;
    await js(`(async()=>{ window.__wasSet=JSON.stringify({gym:S.gym,wg:S.waterGoal,sg:S.stepGoal,wG:S.wGoal});
      S.gym='Спорт-клуб'; S.waterGoal='много'; S.stepGoal=NaN; S.wGoal='восемьдесят';
      try{ renderAll(); }catch(e){} return 1; })()`);
    await sleep(500);
    for(const v of ['food','train','body','health','coach']){
      await js(`document.querySelector('nav button[data-v="${v}"]').click()`); await sleep(450);
      const junk=await js(JUNK);
      chk(Array.isArray(junk),'проверка мусора в тексте не вернула список ('+JSON.stringify(junk)+') — она ничего не проверила');
      chk(!junk||!junk.length,'с мусором в настройках на вкладке «'+v+'» на экран уехало: '+(junk||[]).join(' · '));
    }
    await js(`(async()=>{ try{ const o=JSON.parse(window.__wasSet||'{}');
      S.gym=o.gym; S.waterGoal=o.wg; S.stepGoal=o.sg; S.wGoal=o.wG;
      await put('settings',S,'main'); renderAll(); }catch(e){} return 1; })()`);
    await sleep(400); drain();
  }

  /* 3а-трижды. РЯД ВКЛАДОК ПОМЕЩАЕТСЯ ЦЕЛИКОМ.
     Полевая жалоба владельца 23.08: «строка Тренировка·Программа·Техника·
     Разбор должна умещаться на одном экране и быть ровной». Замер: ряду в
     Зале нужно было 416 px при 358 доступных — «Разбор» уезжал за край и его
     приходилось листать; на Еде не влезал «Перекус». Ряд теперь подгоняет
     кегль и поля под ширину (segFit). Правило: ни один ряд вкладок не
     прокручивается вбок и ни одна подпись не обрезана. */
  const SEGS=`(function(){
    const bad=[];
    document.querySelectorAll('.seg').forEach(sg=>{
      const st=getComputedStyle(sg);
      if(st.display==='none'||sg.closest('.sheet:not(.on),#gate,#splash')) return;
      const r=sg.getBoundingClientRect(); if(r.width<=0||r.height<=0) return;
      const over=sg.scrollWidth-sg.clientWidth;
      const names=[...sg.children].map(c=>c.textContent.trim()).join('·');
      if(over>1) bad.push(names+' не влезает на '+Math.round(over)+' px');
      [...sg.children].forEach(c=>{
        const b=c.getBoundingClientRect(); if(b.width<=0) return;
        if(b.right>r.right+1) bad.push('«'+c.textContent.trim()+'» обрезана краем ряда');
        if(c.scrollWidth>c.clientWidth+1) bad.push('«'+c.textContent.trim()+'» обрезана внутри кнопки');
      });
    });
    return [...new Set(bad)].slice(0,5);
  })()`;
  const ROWS=`(function(){
    const out=[];
    const vis=e=>{ const st=getComputedStyle(e);
      if(st.display==='none'||st.visibility==='hidden'||+st.opacity===0) return false;
      if(e.closest('.sheet:not(.on),#gate,#splash')) return false;
      if(e.closest('details:not([open])')&&!e.matches('summary,summary *')) return false;
      if(e.checkVisibility&&!e.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return false;
      const r=e.getBoundingClientRect(); return r.width>0&&r.height>0; };
    document.querySelectorAll('.row,.g2,.g3').forEach(r=>{
      if(!vis(r)) return;
      let p=r,scr=false; while(p&&p!==document.body){ if(/auto|scroll/.test(getComputedStyle(p).overflowX)){scr=true;break;} p=p.parentElement; }
      if(scr) return;
      const rr=r.getBoundingClientRect();
      [...r.children].forEach(c=>{ if(!vis(c)) return;
        const b=c.getBoundingClientRect();
        const off=Math.max(b.right-rr.right, rr.left-b.left);
        if(off>1.5) out.push(((c.textContent||c.getAttribute('placeholder')||c.tagName).trim().slice(0,20))+' вылезло из строки на '+Math.round(off)+' px');
        if(b.width<40&&/^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName))
          out.push('поле «'+((c.getAttribute('placeholder')||c.id||'—')).slice(0,18)+'» схлопнулось до '+Math.round(b.width)+' px');
      });
    });
    return [...new Set(out)].slice(0,5);
  })()`;
  const OVER=`(function(){
    const W=innerWidth, bad=[];
    [...document.querySelectorAll('body *')].forEach(e=>{
      const st=getComputedStyle(e);
      if(st.display==='none'||st.visibility==='hidden'||+st.opacity===0) return;
      // закрытый <details> отдаёт призрачные координаты потомков
      if(e.closest('details:not([open])')&&!e.matches('summary,summary *')) return;
      if(e.checkVisibility&&!e.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return;
      if(e.closest('.sheet:not(.on),#gate,#splash')) return;
      const r=e.getBoundingClientRect();
      if(r.width<=0||r.height<=0||r.width>W+1) return;
      if(r.left>=-1&&r.right<=W+1) return;
      let p=e.parentElement, scr=false;
      while(p&&p!==document.body){ const ps=getComputedStyle(p);
        if(/auto|scroll/.test(ps.overflowX)){ scr=true; break; } p=p.parentElement; }
      if(!scr) bad.push(((e.textContent||'').trim().slice(0,30)||e.tagName)+' → '+Math.round(r.right-W)+' px за краем');
    });
    return [...new Set(bad)].slice(0,5);
  })()`;
  /* 3б. СЛОВО, РАЗОРВАННОЕ ПОСРЕДИ СЕБЯ.
     Русские подписи длинные, и кнопка в сетке соглашалась стать уже своего
     самого длинного слова: «Кладовая» превращалась в «Кладов/ая», «Голосом»
     в «Голосо/м», «Записать» в «Записат/ь» — последнее на ЛЮБОМ телефоне,
     не только на узком (замер 22.08, пятнадцать мест). Ловим отрисовкой:
     у слова, разорванного переносом, Range даёт прямоугольники на двух
     строках. Перенос по дефису законен — такие слова пропускаем. */
  const SPLIT=`(function(){
    const bad=new Set();
    const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let n;
    while((n=walk.nextNode())){
      const t=n.nodeValue; if(!t||!/\\S/.test(t)) continue;
      const el=n.parentElement; if(!el) continue;
      if(el.closest('.sheet:not(.on),#gate,#splash,script,style')) continue;
      const st=getComputedStyle(el);
      if(st.display==='none'||st.visibility==='hidden'||+st.opacity===0) continue;
      if(el.closest('details:not([open])')&&!el.matches('summary,summary *')) continue;
      if(el.checkVisibility&&!el.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) continue;
      const re=/[\\p{L}\\p{N}][\\p{L}\\p{N}\\u0301]*/gu; let m;
      while((m=re.exec(t))){
        const w=m[0]; if(w.length<4) continue;
        const r=document.createRange(); r.setStart(n,m.index); r.setEnd(n,m.index+w.length);
        const rects=[...r.getClientRects()].filter(x=>x.width>0.5&&x.height>0.5);
        if(rects.length<2) continue;
        if(new Set(rects.map(x=>Math.round(x.top))).size<2) continue;
        bad.add(w+' ('+el.tagName.toLowerCase()+'.'+String(el.className).slice(0,18)+')');
      }
    }
    return [...bad].slice(0,6);
  })()`;
  /* 3в. ШАПКИ КАРТОЧЕК УПРАЖНЕНИЙ — ОДИНАКОВЫЕ.
     Поле 23.08: у «Жима ногами» четыре кнопки стояли на строке заголовка, а у
     «Отжиманий на брусьях» название оказалось длиннее — и вся группа кнопок
     уезжала на отдельную строку. Соседние карточки одного экрана выглядели
     по-разному: именно это владелец называет «поехало». Обратная крайность не
     лучше: если запретить перенос на узком экране, название лезет НА кнопки.
     Правило на класс, а не на место: на любой ширине либо у ВСЕХ карточек
     кнопки на строке заголовка, либо у ВСЕХ на своей, и название никогда не
     вылезает за свою колонку. */
  const HEADS=`(function(){
    const bad=[], modes=new Set();
    /* v496: название и ряд кнопок больше не в одном контейнере — кнопки
       переехали на строку задания. Ищем обоих внутри РАЗДЕЛА упражнения:
       правило про «не налезает и все карточки одинаковы» от переезда не
       меняется, меняется только где искать. */
    document.querySelectorAll('.wc').forEach(h=>{
      const n=h.querySelector('.wc-n'), a=h.querySelector('.wc-acts');
      if(!n||!a) return;
      if(h.closest('.sheet:not(.on),#gate,#splash')) return;
      if(h.closest('details:not([open])')) return;
      if(h.checkVisibility&&!h.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return;
      const nb=n.getBoundingClientRect(), ab=a.getBoundingClientRect();
      if(nb.width<=0||ab.width<=0) return;
      const txt=(n.textContent||'').replace(/\\s+/g,' ').trim().slice(0,26);
      modes.add(Math.abs(nb.top-ab.top)<nb.height?'рядом':'под названием');
      const over=n.scrollWidth-n.clientWidth;
      if(over>1) bad.push('«'+txt+'» вылезает из своей колонки на '+Math.round(over)+' px');
      if(ab.left<nb.right-1&&Math.abs(nb.top-ab.top)<nb.height) bad.push('«'+txt+'» налезает на кнопки');
    });
    if(modes.size>1) bad.push('карточки оформлены по-разному: кнопки '+[...modes].join(' и '));
    /* И раскрывашки одной роли — одним стилем. До 23.08 «Суть и техника» и
       «История» были лаймовые, а «почему такой совет» — серая пунктирная:
       одинаковые по смыслу ссылки читались как разное по важности. */
    /* ── ПРАВИЛО СНЯТО ВМЕСТЕ СО СВОИМ ПРЕДМЕТОМ (v499) ──
       Оно требовало, чтобы одинаковые по роли ссылки карточки выглядели
       одинаково: до 23.08 «Суть и техника» и «История» были лаймовые, а
       «почему такой совет» — серая пунктирная. К v499 в карточке не осталось
       ни одной такой ссылки: техника и история уехали в лист, а лист
       открывается тапом по названию (решение владельца: «зачем внизу разбор,
       его же можно по тапу открыть»). Ряд под таблицей остаётся только под
       действие «+ подводящие» — одна ссылка одной роли, сравнивать не с чем.
       Держать правило на пустой выборке нельзя: зелёный на пустоте — ложь.
       Стиль теперь держит один класс .wc-links a, то есть конструкция, а не
       проверка. Вернётся вторая ссылка той же роли — вернём и правило. */
    const tog=[];
    /* Мерить только те упражнения, что попали в сгенерированную программу, —
       значит проверять десятую часть справочника. В колонку названия обязано
       влезать САМОЕ ДЛИННОЕ слово из всех 230+ названий: «Концентрированный»,
       «Гакк-приседания», «Джефферсон-скручивание». Иначе завтра тренер
       поставит такое упражнение — и человек увидит текст поверх кнопок. */
    let слово='', словоW=0, колонка=0;
    // колонку берём у РЕАЛЬНОЙ шапки с кнопками: «.wc-h > .wc-n» встречается и
    // там, где кнопок нет, и тогда замер падал на null (напоролся 23.08)
    let col=null, рядом=false;
    document.querySelectorAll('.wc').forEach(h=>{ if(col) return;
      const n=h.querySelector('.wc-n'), a=h.querySelector('.wc-acts'); if(!n||!a) return;
      const nb=n.getBoundingClientRect(), ab=a.getBoundingClientRect();
      if(nb.width<=0||ab.width<=0) return;
      col=n; рядом=Math.abs(nb.top-ab.top)<nb.height; });
    if(col&&typeof EX!=='undefined'){
      колонка=Math.floor(col.clientWidth);
      const probe=document.createElement('div');
      probe.className='wc-n';
      probe.style.cssText='position:absolute;left:-9999px;top:0;white-space:nowrap;flex:none;width:auto';
      document.body.appendChild(probe);
      // переносить можно по дефису — меряем куски, а не слово целиком
      const seen=new Set();
      EX.forEach(x=>String(x.n||'').split(/[\\s\\u00A0]+/).forEach(w=>{
        String(w).split('-').forEach((part,i,all)=>{
          const s=(i<all.length-1?part+'-':part).replace(/^[«(]+|[»),.:]+$/g,'');
          if(!s||seen.has(s)) return; seen.add(s);
          probe.textContent=s; const ww=Math.ceil(probe.getBoundingClientRect().width);
          if(ww>словоW){ словоW=ww; слово=s; } }); }));
      probe.remove();
      if(рядом&&словоW>колонка)
        bad.push('самое длинное название справочника («'+слово+'», '+словоW+' px) не влезает в колонку '+колонка+' px — на таком упражнении текст полезет на кнопки');
    }
    return {плохо:[...new Set(bad)].slice(0,5), шапок:document.querySelectorAll('.wc .wc-acts').length,
      раскрывашек:tog.length, слово:слово, словоW:словоW, колонка:колонка};
  })()`;
  /* 3и. РИТМ: НИЧТО НЕ ПРИКЛЕЕНО ВПЛОТНУЮ И НИЧЕГО НЕ РАЗОРВАНО ЩЕЛЬЮ.
     Три находки аудита 23.08 одного корня — инлайновый отступ спорит с
     системой отступов:
     · кнопки в конце тренировки упирались в следующую карточку в 0 px, при
       том что выше на том же экране шаги 22 и 16;
     · «Экспорт JSON» и «Импорт» стояли рядом, но нижние края пилюль не
       сходились на 4 px: <label> в роли кнопки уносил вниз отступ подписи;
     · в «Кладовой» и «Закупке» сгруппированный список раскрывашек был
       порван щелью — квадратные углы смотрели в пустоту, а разделительная
       линия висела ни на чём. */
  const RHYTHM=`(function(){
    const bad=[];
    /* closest() включает сам элемент — и закрытый <details> отфильтровывал
       сам себя. Прячет содержимое ПОТОМКОВ, поэтому смотрим от родителя. */
    const vis=e=>{ if(e.closest('.sheet:not(.on),#gate,#splash')) return false;
      if(e.parentElement&&e.parentElement.closest('details:not([open])')) return false;
      if(e.checkVisibility&&!e.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return false;
      const r=e.getBoundingClientRect(); return r.width>0&&r.height>0; };
    /* 1. Соседние карточки не слипаются. Сравниваем не по nextElementSibling
       (карточки лежат на разной глубине — хвост тренировки внутри #nextBox,
       а следующая карточка снаружи), а по порядку сверху вниз. */
    {
      /* Прозрачная обёртка (.card.flat) — не поверхность: человек видит не
         её край, а низ последнего элемента внутри. Замер 03.09 на дне
         отдыха: кнопка кончалась на 458, следующая карточка начиналась на
         474 — зазор в 16 px есть, но обёртка растянулась на эти 16 px
         (отступ кнопки лежал внутри неё), и правило считало 0. Меряем то,
         что видно: у прозрачной карточки низ — низ её содержимого. */
      const низ=c=>{ if(getComputedStyle(c).backgroundColor!=='rgba(0, 0, 0, 0)') return c.getBoundingClientRect().bottom;
        let b=c.getBoundingClientRect().top;
        c.querySelectorAll('*').forEach(k=>{ if(!vis(k)) return; const r=k.getBoundingClientRect(); if(r.height>0&&r.bottom>b) b=r.bottom; });
        return b; };
      const cards=[...document.querySelectorAll('.view.on .card')].filter(vis)
        .filter(c=>!c.parentElement.closest('.card'))
        .map(c=>{ const r=c.getBoundingClientRect(); return {e:c,r:{top:r.top,bottom:низ(c)}}; })
        .sort((a,b)=>a.r.top-b.r.top);
      for(let i=1;i<cards.length;i++){
        const g=cards[i].r.top-cards[i-1].r.bottom;
        if(g<-1) continue;                       // вложенные/наложенные — не ряд
        if(g<6) bad.push('карточка «'+(cards[i-1].e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,18)+
          '» приклеена к следующей: '+Math.round(g*10)/10+' px');
      }
    }
    // 2. кнопки одного ряда стоят на общем нижнем крае
    document.querySelectorAll('.row').forEach(r=>{
      if(!vis(r)) return;
      const bs=[...r.children].filter(k=>k.matches('.btn')&&vis(k));
      if(bs.length<2) return;
      const bot=bs.map(k=>k.getBoundingClientRect().bottom);
      const d=Math.max.apply(null,bot)-Math.min.apply(null,bot);
      if(d>1.5) bad.push('в ряду «'+bs.map(k=>k.textContent.trim().slice(0,10)).join(' | ')+'» кнопки не сходятся низом на '+Math.round(d*10)/10+' px');
    });
    /* 3. Группа кнопок не разъезжается по разным строкам. Стоило цифре в
       карточке воды стать длиннее, как «+250» и «+500» переносились по одной:
       одна на вторую строку, вторая на третью и под навигацию (23.08). */
    document.querySelectorAll('.view.on div,.sheet.on div').forEach(g=>{
      if(!vis(g)) return;
      const kids=[...g.children].filter(vis);
      if(kids.length<2||kids.length>4) return;
      if(!kids.every(k=>k.matches('button,.btn'))) return;
      const gs=getComputedStyle(g);
      if(gs.display!=='flex') return;
      // столбик кнопок сложен так нарочно (хвост тренировки) — это не разъезд
      if(/column/.test(gs.flexDirection)) return;
      const tops=kids.map(k=>Math.round(k.getBoundingClientRect().top));
      if(new Set(tops).size>1)
        bad.push('группа кнопок «'+kids.map(k=>k.textContent.trim().slice(0,8)).join(' | ')+
          '» разъехалась по '+new Set(tops).size+' строкам — переносится по одной вместо целой группы');
    });
    // 4. сгруппированный список раскрывашек склеен, а не порван щелью
    document.querySelectorAll('.sheet.on details.det').forEach(d=>{
      const n=d.nextElementSibling;
      if(!n||!n.matches('details.det')) return;
      if(!vis(d)||!vis(n)) return;
      const g=n.getBoundingClientRect().top-d.getBoundingClientRect().bottom;
      if(g>1.5) bad.push('список раскрывашек порван щелью в '+Math.round(g*10)/10+' px перед «'+
        ((n.querySelector('summary')||{}).textContent||'').replace(/\\s+/g,' ').trim().slice(0,20)+'»');
    });
    /* 5. СТРОКА ТЕКСТА СТОИТ НА ЦЕЛОМ ЧИСЛЕ ПИКСЕЛЕЙ.
       Полевой отчёт владельца 28.08 про «Зал»: «все шрифты надписи разные».
       Горизонталь чинилась гуттером, но половина беды была вертикальной.
       body задаёт font:14px/1.5, а безразмерный 1.5 наследуется КОЭФФИЦИЕНТОМ:
       каждый размер считает интерлиньяж от себя. У нечётных ступеней шкалы
       (11 и 17) выходило 16.5 и 25.5, а один и тот же 14-й шрифт получал
       то 21.7, то 16.1 — соседние абзацы одного вида шли с разным шагом
       строки, и глаз это видит, даже когда человек не может назвать причину.
       Замер до починки: 27 дробных блоков из 98 на одном «Зале».
       Правило меряет ВЫХОД, а не токены: у каждого видимого блока с
       собственным текстом computed line-height — целое число пикселей.
       Ступени шкалы чётные, роль строки одна на размер — тогда это держится
       само; вернёшь дробный коэффициент или нечётную ступень — правило
       назовёт блок и число. */
    {
      const seen={};
      document.querySelectorAll('.view.on *,.sheet.on *').forEach(e=>{
        if(![...e.childNodes].some(c=>c.nodeType===3&&(c.textContent||'').trim().length>1)) return;
        if(!vis(e)) return;
        const st=getComputedStyle(e), lh=parseFloat(st.lineHeight); if(!lh) return;
        if(Math.abs(lh-Math.round(lh))<0.01) return;
        const k=lh.toFixed(2);
        if(seen[k]) return; seen[k]=1;
        bad.push('строка текста встала на дробную высоту '+k+' px при шрифте '+st.fontSize+
          ' («'+(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,22)+
          '») — соседние абзацы пойдут с разным шагом строки');
      });
    }
    /* 6. ТЕКСТ АБЗАЦЕВ НАЧИНАЕТСЯ НА ОДНОМ КРАЕ.
       Отчёт владельца 28.08: «всё так хаотично, ничего не выровнено», и
       назвать конкретную надпись он не смог — потому что дефект не в
       надписи, а в том, что абзацы стартуют с разных вертикалей.
       Прошлая версия правила мерила РАМКУ блока и поэтому врала: отступ
       внутри рамки её не двигает. Меряем начало ПЕРВОЙ СТРОКИ текста
       через Range — то, что человек и видит. Два механизма отступа на
       одном блоке (padding + margin) дают 56 вместо 36; поймано этим. */
    {
      const L={};
      document.querySelectorAll('.view.on .note,.view.on .wc-sub,.view.on .ib,.view.on .wb,.view.on .eb,.view.on .ob').forEach(e=>{
        if(!vis(e)) return;
        const r=e.getBoundingClientRect(); if(r.height<4||r.top>900) return;
        if(![...e.childNodes].some(c=>c.nodeType===3&&(c.textContent||'').trim().length>1)) return;
        /* Не всякий левый край — гуттер. Центрованная подпись начинается там,
           где её центрует строка, а ячейка таблицы — там, где стоит колонка.
           Считать их «съехавшими» — значит поднимать ложную тревогу, а
           правило, которое кричит без дефекта, обесценивает все остальные. */
        const sa=getComputedStyle(e).textAlign;
        if(sa==='center'||sa==='right'||sa==='end') return;
        const pp=e.parentElement;
        if(pp){ const ps=getComputedStyle(pp);
          if(/flex|grid/.test(ps.display)&&[...pp.children].filter(vis).length>1) return; }
        /* Range по СОДЕРЖИМОМУ блока, а не по первому текстовому узлу:
           абзац, начинающийся с <b>, давал бы левый край текста ПОСЛЕ
           жирного — 131 вместо 36. Первая строка блока — это то, что
           человек и видит как начало абзаца. */
        const rg=document.createRange(); rg.selectNodeContents(e);
        const first=rg.getClientRects()[0]; if(!first||first.width<20) return;
        const k=Math.round(first.left);
        (L[k]=L[k]||[]).push((e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,20));
      });
      const ks=Object.keys(L).map(Number).filter(x=>x<140);
      if(ks.length>1) bad.push('абзацы начинаются на '+ks.length+' разных краях ('+ks.join('/')+
        ') — например «'+L[ks[0]][0]+'» и «'+L[ks[ks.length-1]][0]+'»; текст в приложении живёт на одном гуттере');
    }
    /* 7. ИКОНКА РИСУЕТСЯ, А НЕ НАБИРАЕТСЯ.
       Сплошной прогон 28.08 по 54 экранам: крестик закрытия был текстовым ×
       на ВСЕХ тридцати листах — то есть самый повторяемый символ приложения
       брал форму, толщину и оптический центр из шрифта, стоя вплотную к
       рисованному набору. Это самый дешёвый признак «собрано на коленке»,
       и он не виден по одному экрану — виден по всем сразу.
       Правило: если нажимаемое состоит ТОЛЬКО из символа-картинки, это
       иконка, и она обязана быть нарисована. Текст рядом с символом —
       не нарушение: там символ работает как знак препинания. */
    {
      /* Дефис стоит ПОСЛЕДНИМ в наборе и не экранируется. Экранирование \-
         внутри шаблонной строки схлопывается в обычный дефис, тот становится
         диапазоном + … − и захватывает всю кириллицу — правило начинает
         звать иконкой слово «Тренировка». Та же ловушка, что с \s. */
      const GLYPH=/^[‹›▸▾◂▴✓✔✕✖✗✎✂⚡◌→←↑↓▼▶►×✚➕+−–—•·…※★☆-]+$/;
      document.querySelectorAll('.view.on button,.view.on a,.view.on summary,.sheet.on button,.sheet.on a,.sheet.on summary').forEach(e=>{
        if(!vis(e)) return;
        if(e.querySelector('svg,img')) return;
        const t=(e.textContent||'').trim();
        if(t&&GLYPH.test(t)) bad.push('«'+t+'» нарисовано символом шрифта, а не иконкой ('+
          e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+') — рядом с рисованным набором это видно сразу');
      });
    }
    return [...new Set(bad)].slice(0,5);
  })()`;
  /* ── НАРИСОВАННАЯ ССЫЛКА ОБЯЗАНА РАБОТАТЬ ──
     Полевой отчёт владельца 28.08: «перенести на сегодня не кликается».
     Ссылка рисовалась в обычном дне, а обработчик стоял ТОЛЬКО в ветке
     «сегодня отдых» — то есть разметка и обработчик заводились в разных
     местах, и на пропущенной тренировке ссылка была нарисована и мертва.
     Ни один прежний тест такого не видел: DOM в порядке, текст на месте,
     стили на месте — не работает только палец.
     Правило меряет ВЫХОД: у каждого элемента, который ВЫГЛЯДИТ нажимаемым
     (курсор-палец), обязан быть обработчик. Настоящие кнопки, ссылки с href,
     ярлыки формы и строки-раскрывашки исключены — они нажимаются сами. */
  const DEAD=`(function(){
    const bad=[];
    const own=e=>!!(e.onclick||e.onmousedown||e.onpointerdown);
    document.querySelectorAll('.view.on [style*="cursor:pointer"],.sheet.on [style*="cursor:pointer"]').forEach(e=>{
      if(e.closest('.sheet:not(.on),#gate,#splash')) return;
      if(e.parentElement&&e.parentElement.closest('details:not([open])')) return;
      if(e.checkVisibility&&!e.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return;
      const r=e.getBoundingClientRect(); if(r.width<=0||r.height<=0) return;
      if(e.matches('button,summary,label,select,input,textarea')) return;
      if(e.matches('a[href]')) return;
      /* обработчик мог висеть на родителе — делегирование это норма */
      let p=e; for(let i=0;i<6&&p;i++){ if(own(p)) return; p=p.parentElement; }
      bad.push('«'+(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,26)+'» ('+
        (e.tagName.toLowerCase())+(e.dataset&&Object.keys(e.dataset)[0]?' data-'+Object.keys(e.dataset)[0]:'')+
        ') нарисована как нажимаемая, но обработчика нет');
    });
    return [...new Set(bad)].slice(0,5);
  })()`;
  /* 3з. ПОДПИСЬ И ЕЁ ЦИФРА ЖИВУТ НА ОДНОЙ СТРОКЕ.
     Аудит 23.08: карточка «Жидкость». Кнопки +250/+500 съедали ряд, шапке
     оставалось 133 px — и она рассыпалась: капля отдельной строкой,
     «Жидкость» отдельной, карандаш ✎ отдельной, «мл» отрывалось от числа.
     Карточка росла с 77 до 121 px. Правило на класс: короткая пара
     «подпись — значение», разведённая по краям строки, обязана остаться
     однострочной. Длинный текст сюда не попадает: он законно переносится. */
  const RAGGED=`(function(){
    const bad=[];
    document.querySelectorAll('.card [style*="space-between"],.card .wcard-h,.card .hd').forEach(h=>{
      if(h.closest('.sheet:not(.on),#gate,#splash')) return;
      if(h.closest('details:not([open])')) return;
      if(h.checkVisibility&&!h.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return;
      const st=getComputedStyle(h); if(st.display!=='flex') return;
      const kids=[...h.children].filter(k=>{ const b=k.getBoundingClientRect(); return b.width>0&&b.height>0; });
      if(kids.length<2||kids.length>3) return;
      const texts=kids.map(k=>(k.textContent||'').replace(/\\s+/g,' ').trim());
      if(texts.some(t=>!t||t.length>24)) return;              // длинное — переносится законно
      // ряд управления — не подпись; и составной блок «подпись сверху, цифра
      // снизу» сложен так НАРОЧНО, его двухстрочность не дефект. Отличаем по
      // display: пара «подпись — значение» набрана строчными элементами
      kids.forEach((k,i)=>{
        if(k.matches('button,input,select,a,label')||k.querySelector('button,input,select')) return;
        /* Составной блок «подпись сверху, цифра снизу» сложен так НАРОЧНО —
           его двухстрочность не дефект. Отличаем по СОДЕРЖИМОМУ: у подписи
           внутри только строчное (span, svg, b), у составного блока — div'ы.
           По самому ребёнку отличить нельзя: флекс блокифицирует детей, и
           display у всех одинаково «block» (напоролся 23.08 — правило из-за
           этого не срабатывало вообще). */
        if([...k.children].some(c=>/^(block|flex|grid|list-item|table)/.test(getComputedStyle(c).display))) return;
        /* Считаем ФАКТИЧЕСКИЕ строки отрисовки, а не высоту коробки с полями.
           Верхушки прямоугольников внутри ОДНОЙ строки не совпадают: иконка
           и текст выровнены по базовой линии и отличаются на пару пикселей.
           Поэтому не считаем уникальные top'ы, а группируем их: новая строка
           начинается, когда разрыв больше половины интерлиньяжа. */
        const lh=parseFloat(getComputedStyle(k).lineHeight)||18;
        const rg=document.createRange(); rg.selectNodeContents(k);
        const tops=[...rg.getClientRects()].filter(x=>x.width>0.5&&x.height>0.5)
          .map(x=>x.top).sort((a,b)=>a-b);
        let строк=tops.length?1:0;
        for(let q=1;q<tops.length;q++) if(tops[q]-tops[q-1]>lh*0.6) строк++;
        if(строк>1) bad.push('«'+texts[i]+'» рассыпалось на '+строк+' строки — подпись оторвалась от своей цифры');
      });
    });
    return [...new Set(bad)].slice(0,5);
  })()`;
  /* 3ж. КОРОТКАЯ ПОДПИСЬ НЕ ОБРЕЗАЕТСЯ МНОГОТОЧИЕМ.
     Аудит 23.08: на 320 px колонка «было» в карточке упражнения схлопывалась
     до 24 px — заголовок показывался как «Б…», прошлый подход как «62…».
     Ни одно правило этого не ловило: OVER смотрит выход за КРАЙ ЭКРАНА, ROWS —
     выход ребёнка из строки, SPLIT — перенос посреди слова. А тут текст режет
     собственный overflow:hidden внутри ячейки, и снаружи всё «ровно».
     Длинные названия продуктов человек вводит сам, им многоточие законно.
     А короткая подпись, которую написало приложение, обрезаться не имеет
     права: «Б…» вместо «было» — это потеря смысла, а не воздуха. */
  const CUT=`(function(){
    const bad=[];
    document.querySelectorAll('body *').forEach(e=>{
      if(e.children.length) return;
      if(e.closest('.sheet:not(.on),#gate,#splash')) return;
      if(e.closest('details:not([open])')&&!e.matches('summary,summary *')) return;
      if(e.checkVisibility&&!e.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return;
      const r=e.getBoundingClientRect(); if(r.width<=0||r.height<=0) return;
      const st=getComputedStyle(e);
      if(st.textOverflow!=='ellipsis'||st.overflow==='visible') return;
      const cut=e.scrollWidth-e.clientWidth; if(cut<=1) return;
      const t=(e.textContent||'').replace(/\\s+/g,' ').trim();
      if(!t||t.length>14) return;   // длинное человек ввёл сам — многоточие законно
      bad.push('«'+t+'» обрезано на '+Math.round(cut)+' px внутри своей ячейки');
    });
    return [...new Set(bad)].slice(0,5);
  })()`;
  /* 3д. КНОПКА БЕЗ ПОДПИСИ: КРУГ, А НЕ ОВАЛ — И НЕ МЕЛЬЧЕ НА БОЛЬШОМ ЭКРАНЕ.
     Аудит 23.08 нашёл нелепицу: нижний предел ширины `.btn.sm` жил ТОЛЬКО
     в медиазапросе для 320 px. На узком экране «‹», «›» и «+» честно держали
     36 px, а на 390 и 430 схлопывались до 30.7 при высоте 37 — то есть на
     большом телефоне палец получал меньше, чем на маленьком, и круглая
     кнопка становилась овалом. Отсюда два инварианта: кнопка без подписи
     обязана быть примерно квадратной, и ни одна кнопка не имеет права
     УМЕНЬШИТЬСЯ, когда экран стал шире. */
  const TAPS=`(function(){
    const out={};
    document.querySelectorAll('button,input[type=checkbox],input[type=radio]').forEach(e=>{
      if(e.closest('.sheet:not(.on),#gate,#splash')) return;
      if(e.closest('details:not([open])')&&!e.matches('summary,summary *')) return;
      if(e.checkVisibility&&!e.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return;
      const r=e.getBoundingClientRect(); if(r.width<=0||r.height<=0) return;
      const st=getComputedStyle(e); if(st.visibility==='hidden') return;
      const txt=(e.textContent||'').replace(/\\s+/g,' ').trim();
      // «без подписи» — пусто, одна иконка или один знак вроде ‹ › + ✕ ⋯
      let ico=txt.length<=1||(!txt&&!!e.querySelector('svg'));
      /* Но ШКАЛА — не иконки. Ряд «1 2 3 4 5» состоит из односимвольных кнопок,
         и они обязаны быть широкими: это сегментный выбор, где палец метит в
         полосу, а не в кружок. Отличаем по соседям: три и больше односимвольных
         кнопок в одном родителе — это шкала (напоролся на своём же правиле
         23.08, когда вопрос готовности переехал в Зал). */
      if(ico&&e.parentElement){
        const sib=[...e.parentElement.children].filter(x=>x.matches&&x.matches('button'));
        if(sib.length>=3&&sib.every(x=>(x.textContent||'').trim().length===1)) ico=false;
      }
      const key=e.id?('#'+e.id):(e.tagName.toLowerCase()+'.'+String(e.className).trim().split(/\\s+/).slice(0,3).join('.')+'|'+txt.slice(0,12));
      out[key]={ш:Math.round(r.width*10)/10, в:Math.round(r.height*10)/10, ико:ico, txt:txt.slice(0,12)};
    });
    return out;
  })()`;
  const tapBy={};
  /* Обход делаем в ПОЛНОМ режиме и с данными: в простом половина карточек не
     смонтирована, и проверка молча смотрит на пустой экран (напоролся 22.08 —
     кнопка «Записать» с зашитой шириной не показывалась ни в одной вкладке,
     и мутация проходила мимо теста). */
  /* С 04.09 — по форме CRAFT: прежний режим читаем ОТДЕЛЬНЫМ синхронным
     вызовом (с одним повтором, если страница промолчала) и держим в Node,
     а не берём из ответа длинного async-вызова; сама фикстура идёт короткими
     шагами — по одной записи в хранилище за вызов — и её ответ ни одной
     проверке не нужен: состояние после неё спрашивается отдельно. */
  let uiWas=await js(`(function(){ return S.ui||''; })()`);
  if(typeof uiWas!=='string'){ await sleep(400); uiWas=await js(`(function(){ return S.ui||''; })()`); }
  const режимПрочитан=typeof uiWas==='string'; if(!режимПрочитан) uiWas='';
  await js(`(function(){ try{ S.ui='pro'; S.gated=1; S.onboardDone=1;
    S.sex='m'; S.age=34; S.h=182; S.rate=-0.5;
    // программу заводим на ВСЕ дни недели: иначе сегодня окажется выходным,
    // Зал покажет пустой экран и проверка шапок карточек ничего не увидит
    S.prog=genProgram({days:3,equip:'gym',goal:'hyper',exp:'mid',inj:[],dows:[1,2,3,4,5,6,7]});
    /* dows — это РАЗРЕШЁННЫЕ дни, а не расписание: при days:3 генератор берёт
       пн/ср/пт, и в субботу «сегодня» всё равно выходной. До v614 это прятала
       кнопка «Перенести сюда» (шаг старта нажимал её вместо «Начать»), теперь
       её нет — говорим намерение прямо: сегодня обязан быть тренировочным. */
    { const tw=dowOf(td()), pl=S.prog.plan||[];
      if(!pl.some(d=>d.dow===tw&&(d.ex||[]).some(e=>!e.hidden))){
        const d=pl.find(x=>(x.ex||[]).some(e=>!e.hidden)); const занял=pl.find(x=>x.dow===tw);
        if(d){ if(занял) занял.dow=d.dow; d.dow=tw; } } }
    // вода набрана: строка «1400 / 2800 мл» длиннее пустой и честно давит на ряд
    S.water=Object.assign({},S.water||{}); S.water[td()]=1400; return 1; }catch(e){ return 'ERR '+e.message } })()`);
  // вес пишем ВЧЕРАШНИЙ: карточка «Вес сегодня» на Еде показывается ровно
  // до тех пор, пока сегодняшний не записан, — иначе обход её не увидит
  await js(`(async()=>{ try{ await put('weight',{d:ds(dn(td())-1),kg:92}); }catch(e){} return 1; })()`);
  await js(`(async()=>{ try{ await put('settings',S,'main'); }catch(e){} return 1; })()`);
  await js(`(async()=>{ try{ await loadAll(); }catch(e){} return 1; })()`);
  await js(`(function(){ try{applyUI()}catch(e){} renderAll(); return 1; })()`);
  await sleep(900); drain();
  /* Страж фикстуры: спрашиваем СОСТОЯНИЕ, а не ответ вызова. Не встала —
     обход ниже смотрит не на тот экран, и об этом надо сказать вслух. */
  const ФИКС=`(function(){ try{ return JSON.stringify({ui:S.ui, план:!!(S.prog&&S.prog.plan&&S.prog.plan.length), вода:(S.water||{})[td()],
    вес:(W||[]).some(x=>x&&x.d===ds(dn(td())-1))}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`;
  let фикс=await js(ФИКС); if(typeof фикс!=='string'||!фикс){ await sleep(400); фикс=await js(ФИКС); }
  let фо={}; try{ фо=JSON.parse(фикс)||{} }catch(e){}
  chk(режимПрочитан&&фо.ui==='pro'&&фо.план===true&&фо.вода===1400&&фо.вес===true,
    'фикстура обхода вёрстки не встала (прежний режим '+(режимПрочитан?'прочитан':'не прочитан')+', состояние '+String(фикс).slice(0,160)+') — обход смотрит не на тот экран');
  for(const w of [390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:844,deviceScaleFactor:2,mobile:true});
    await sleep(500);
    for(const v of ['food','train','body','coach']){
      await js(`document.querySelector('nav button[data-v="${v}"]').click()`); await sleep(450);
      const out=await js(OVER);
      chk(!out||!out.length,'на '+w+' px во вкладке «'+v+'» содержимое уезжает за край и обрезается: '+(out||[]).join(' · '));
      const sg=await js(SEGS);
      chk(Array.isArray(sg),'проверка рядов вкладок не вернула список ('+JSON.stringify(sg)+') — она ничего не проверила');
      chk(!sg||!sg.length,'на '+w+' px во вкладке «'+v+'» ряд вкладок не помещается на экран: '+(sg||[]).join(' · '));
      /* И внутри листов: там ряд рисуется скрытым, ширины у него нет, и
         подгонка его пропускала — «Из наличия» и «Закупка» уезжали за край,
         как только лист открывали (23.08). Открываем как приложение. */
      if(v==='food'){
        for(const sid of ['sh-meal','sh-rec','sh-shop']){
          await js(`try{ sheet('${sid}',true); }catch(e){}`); await sleep(500);
          const s2=await js(SEGS);
          chk(!s2||!s2.length,'на '+w+' px в листе «'+sid+'» ряд вкладок не помещается: '+(s2||[]).join(' · '));
          const r2=await js(RHYTHM);
          chk(!r2||!r2.length,'на '+w+' px в листе «'+sid+'» ритм сбит: '+(r2||[]).join(' · '));
          await js(`try{ sheet('${sid}',false); }catch(e){}`); await sleep(250);
        }
        drain();
      }
      const rw=await js(ROWS);
      chk(Array.isArray(rw),'проверка строк не вернула список ('+JSON.stringify(rw)+') — она ничего не проверила');
      chk(!rw||!rw.length,'на '+w+' px во вкладке «'+v+'» строка разъехалась: '+(rw||[]).join(' · '));
      const dl=await js(DEAD);
      chk(Array.isArray(dl),'проверка мёртвых ссылок не вернула список ('+JSON.stringify(dl)+') — она ничего не проверила');
      chk(!dl||!dl.length,'на '+w+' px во вкладке «'+v+'» ссылка нарисована, но мертва: '+(dl||[]).join(' · '));
      const sp=await js(SPLIT);
      chk(Array.isArray(sp),'проверка разорванных слов не вернула список ('+JSON.stringify(sp)+') — она ничего не проверила');
      chk(!sp||!sp.length,'на '+w+' px во вкладке «'+v+'» слово разорвано посреди себя: '+(sp||[]).join(' · '));
      /* Карточки упражнений есть только у НАЧАТОЙ тренировки — иначе проверка
         шапок молча смотрит в пустоту (страж «шапок» ниже). */
      if(v==='train'){
        /* Пилюля «Разминка по плану · N · Начать» тоже содержит «Начать»: на второй
           ширине, когда тренировка уже начата и кнопки «Начать тренировку» нет,
           поиск попадал в неё и раскрывал разминку на 727 px — и замер пути до
           первого упражнения ниже мерил раскрытую разминку (всплыло 16.09, среда:
           в день с разминкой по плану). Пилюли разминки и самочувствия — не старт. */
        const _нажал=await js(`(function(){const b=[...document.querySelectorAll('#tr-log button')]
          .filter(x=>!x.hasAttribute('data-wutog')&&!x.hasAttribute('data-rdtog'))
          .find(x=>/Начать тренировку|Начать/.test(x.textContent)); if(b)b.click(); return b?(b.id||b.className||'')+':'+(b.textContent||'').trim().slice(0,30):'—';})()`);
        await sleep(700); drain();
        if(process.env.BVDBG) console.log('   DBG старт дня на '+w+': нажал «'+_нажал+'», wuOpen='+await js(`String(S.wuOpen)`)+', sess='+await js(`String(!!(typeof gymSess==='function'&&gymSess(td())&&gymSess(td()).start))`));
        const hd=await js(HEADS);
        chk(hd&&hd.шапок>0,'на '+w+' px карточки упражнений не смонтированы — проверка шапок ничего не проверила');
        // сторож выборки снят вместе с правилом о стиле раскрывашек (v499)
        chk(hd&&hd.словоW>100,'на '+w+' px не удалось измерить самое длинное название из справочника — проверка колонки ничего не проверила');
        if(process.env.BVDBG) console.log('   DBG '+w+': колонка '+(hd&&hd.колонка)+' px, самое длинное «'+(hd&&hd.слово)+'» '+(hd&&hd.словоW)+' px');
        chk(hd&&!(hd.плохо||[]).length,'на '+w+' px шапки карточек упражнений разъехались: '+((hd&&hd.плохо)||[]).join(' · '));
        /* ПРОШЕДШИЙ ДЕНЬ — ОТДЕЛЬНЫЙ ЭКРАН, И ЕГО НАДО ОТКРЫТЬ.
           Мёртвая ссылка «перенести на сегодня» жила именно там, а проверка,
           стоящая на сегодняшнем дне, до неё не доходила. Урок правила
           выравнивания (28.08): правило, которое не добирается до состояния,
           молчит на любой поломке. Листаем на день назад стрелкой ‹ — тем же
           жестом, что и человек, — и меряем там. */
        /* Состояние для прошедшего дня задаём ЯВНО. Иначе «вчера» окажется
           программным днём или нет в зависимости от того, какой сегодня день
           недели, — и проверка была бы то живой, то слепой, по календарю. */
        await js(`(function(){ try{
          const yd=ds(dn(td())-1), yw=dowOf(yd);
          const P=S.prog; if(!P||!P.plan||!P.plan.length) return 0;
          if(!P.plan.some(x=>x.dow===yw&&(x.ex||[]).some(e=>!e.hidden))){
            const d=P.plan.find(x=>(x.ex||[]).some(e=>!e.hidden))||P.plan[0];
            const занял=P.plan.find(x=>x.dow===yw); if(занял) занял.dow=d.dow;
            d.dow=yw;
          }
          for(let i=SETS.length-1;i>=0;i--) if(SETS[i].d===yd) SETS.splice(i,1);
          /* v534: день до рождения программы — не пропуск; фикстуре нужна
             программа старше вчерашнего дня, иначе ссылки нет по закону */
          if(!P.created||P.created>yd) P.created=ds(dn(td())-8);
          delete S.dayMap; S.moveWk=null;
          renderAll(); return 1;
        }catch(e){ return 'ERR '+e.message } })()`);
        await sleep(700);
        const ушли=await js(`(function(){const b=document.getElementById('wPrev'); if(!b) return 0; b.click(); return 1})()`);
        await sleep(800); drain();
        chk(ушли===1,'на '+w+' px стрелка ‹ на прошлый день не найдена — проверка прошедшего дня ничего не проверила');
        if(ушли===1){
          /* Подсказки .note скрыты CSS-ом. Пока они закрыты, проверка смотрит
             в пустоту — ровно та ловушка, на которой сгорело правило
             выравнивания. Раскрываем их насильно и меряем содержимое тоже.
             Раньше здесь кликали по кнопке «Подробнее»; с 31.08 её на рабочих
             экранах нет вовсе (проза уехала в «Справку»), и клик стал кликом
             в никуда — правило само сообщило, что проверяет пустоту. Ставим
             класс напрямую: тест обязан видеть текст, человек — нет. */
          const раскрыто=await js(`(function(){const b=[...document.querySelectorAll('.view.on .note')];b.forEach(x=>x.classList.add('open'));return b.length})()`);
          await sleep(400);
          chk(раскрыто>0,'на '+w+' px на прошедшем дне не нашлось ни одной подсказки — проверка их содержимого ничего не проверила');
          /* Страж: если ссылки переноса на прошедшем дне нет вовсе, проверка
             мёртвых ссылок смотрит в пустоту и промолчит на любой поломке. */
          const естьПеренос=await js(`(function(){const e=document.querySelector('.view.on [data-shift]');
            if(!e) return 0; const r=e.getBoundingClientRect(); return r.height>0?1:2})()`);
          chk(естьПеренос===1,'на '+w+' px на прошедшем дне ссылка переноса '+
            (естьПеренос===0?'не нарисована вовсе':'нарисована, но невидима')+
            ' — проверка мёртвых ссылок ничего не проверила');
          const dlp=await js(DEAD);
          chk(!dlp||!dlp.length,'на '+w+' px на ПРОШЕДШЕМ дне ссылка нарисована, но мертва: '+(dlp||[]).join(' · '));
          const rhp=await js(RHYTHM);
          chk(!rhp||!rhp.length,'на '+w+' px на ПРОШЕДШЕМ дне ритм сбит: '+(rhp||[]).join(' · '));
          /* Закрываем обратно: дальше по прогону стоит правило «на рабочем
             экране нет ни пикселя прозы», и оставленный нами .open стал бы
             его ложным срабатыванием — тест ловил бы сам себя. */
          await js(`(function(){document.querySelectorAll('.note.open').forEach(x=>x.classList.remove('open'));return 1})()`);
          await js(`(function(){const b=document.getElementById('wNext'); if(b) b.click(); return 1})()`);
          await sleep(700); drain();
        }
      }
      {
        /* ── «ПОДРОБНЕЕ» ОБЯЗАНО ЧТО-ТО ПОКАЗАТЬ ──
           Полевой отчёт владельца 30.08: «раскрываю подробнее на белках,
           жирах и углеводах — там ничего, причём неважно, заполнено или
           нет». Кнопка вешалась на каждую подсказку без разбора, а часть
           подсказок заполняется по условию: на карточке БЖУ объяснение
           появляется, только когда раскладку ужали под дефицит. Всё
           остальное время кнопка обещала объяснение, которого нет.
           Правило меряет ВЫХОД: жмём каждую «Подробнее» на экране и
           смотрим, появился ли текст. Ни одна не имеет права раскрыться
           в пустоту. */
        /* С 04.09 — по форме CRAFT: каждый тап по «Подробнее» — отдельный
           короткий вызов из Node по настоящей кнопке, пауза — в Node, замер
           текста — отдельный синхронный вызов с одним повтором, если
           страница промолчала. Кнопки берём по номеру в открытой вкладке;
           «было ли раскрыто» держим в Node, чтобы вернуть как было. Любой
           несостоявшийся замер — «не вернула список», а не тишина. */
        const спроси=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); }
          if(typeof r!=='string'||!r) return null; try{ return JSON.parse(r); }catch(e){ return null; } };
        const кнопка=i=>`document.querySelectorAll('.view.on .hintq')[${i}]`;
        let пусто=null, сбойП='';
        const счёт=await спроси(`(function(){ try{ return JSON.stringify({n:document.querySelectorAll('.view.on .hintq').length}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
        if(!счёт||typeof счёт.n!=='number') сбойП='число кнопок не измерено'+(счёт&&счёт.сбой?' ('+счёт.сбой+')':'');
        else {
          const bad=[];
          for(let i=0;i<счёт.n&&!сбойП;i++){
            /* Замер 1: над подсказкой ли кнопка, раскрыта ли она уже, чья карточка. */
            const до=await спроси(`(function(){ try{ const b=${кнопка(i)}; const n=b&&b.nextElementSibling;
              const c=b&&b.closest('.card'), h=c&&c.querySelector('h2');
              return JSON.stringify({есть:!!b, надПодсказкой:!!(n&&n.classList.contains('note')), было:!!(n&&n.classList.contains('open')),
                карточка:((h&&h.textContent)||'').trim().slice(0,24)||'карточка'}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
            if(!до||!до.есть){ сбойП='кнопка №'+(i+1)+' не измерена'+(до&&до.сбой?' ('+до.сбой+')':''); break; }
            if(!до.надПодсказкой){ bad.push('кнопка «Подробнее» стоит не над подсказкой'); continue; }
            /* Переход: тап по настоящей кнопке, как палец; пауза — в Node. */
            if(!до.было){ await js(`(function(){ const b=${кнопка(i)}; if(b) b.click(); return !!b; })()`); await sleep(100); }
            /* Замер 2: появился ли текст. */
            const после=await спроси(`(function(){ try{ const b=${кнопка(i)}; const n=b&&b.nextElementSibling;
              if(!n) return JSON.stringify({сбой:'подсказка под кнопкой пропала'});
              const t=(n.textContent||'').replace(/\\s+/g,' ').trim(); const r=n.getBoundingClientRect();
              return JSON.stringify({пусто:t.length<2&&!(r.height>2&&n.children.length)}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
            if(!после||typeof после.пусто!=='boolean') сбойП='кнопка №'+(i+1)+' после тапа не измерена'+(после&&после.сбой?' ('+после.сбой+')':'');
            else if(после.пусто) bad.push('«'+до.карточка+'» раскрывается в пустоту');
            /* Возвращаем, как было: второй тап по той же кнопке. */
            if(!до.было){ await js(`(function(){ const b=${кнопка(i)}; if(b) b.click(); return !!b; })()`); await sleep(60); }
          }
          if(!сбойП) пусто=[...new Set(bad)].slice(0,4);
        }
        chk(Array.isArray(пусто),'проверка пустых подсказок не вернула список'+(сбойП?' ('+сбойП+')':''));
        chk(!пусто||!пусто.length,'на '+w+' px во вкладке «'+v+'» кнопка «Подробнее» обещает объяснение, которого нет: '+(пусто||[]).join(' · '));
      }
      {
        const rh=await js(RHYTHM);
        chk(Array.isArray(rh),'проверка ритма не вернула список ('+JSON.stringify(rh)+')');
        chk(!rh||!rh.length,'на '+w+' px во вкладке «'+v+'» ритм сбит: '+(rh||[]).join(' · '));
      }
      {
        const rg=await js(RAGGED);
        chk(Array.isArray(rg),'проверка рассыпавшихся подписей не вернула список ('+JSON.stringify(rg)+')');
        chk(!rg||!rg.length,'на '+w+' px во вкладке «'+v+'» шапка карточки рассыпалась: '+(rg||[]).join(' · '));
      }
      {
        const ct=await js(CUT);
        chk(Array.isArray(ct),'проверка обрезанных подписей не вернула список ('+JSON.stringify(ct)+') — она ничего не проверила');
        chk(!ct||!ct.length,'на '+w+' px во вкладке «'+v+'» короткая подпись обрезана многоточием: '+(ct||[]).join(' · '));
      }
      {
        const tp=await js(TAPS);
        chk(tp&&Object.keys(tp).length>3,'на '+w+' px во вкладке «'+v+'» не нашлось ни одной кнопки — проверка зоны нажатия ничего не проверила');
        if(tp&&!tp.__err){ tapBy[w+'|'+v]=tp;
          const oval=Object.keys(tp).filter(k=>tp[k].ико&&Math.abs(tp[k].ш-tp[k].в)>8)
            .map(k=>k+' '+tp[k].ш+'×'+tp[k].в);
          chk(!oval.length,'на '+w+' px во вкладке «'+v+'» кнопка без подписи вытянута в овал: '+oval.slice(0,4).join(' · '));
        }
      }
      /* Страж самой проверки: если экран не смонтирован, обход молча смотрит
         в пустоту и всё «проходит». Берём кнопку, которая на Теле есть
         всегда (на Еде карточка веса прячется, как только вес за сегодня
         записан, — и это правильно). */
      if(v==='body'&&process.env.BVDBG){ console.log('   DBG '+w+' body bW2='+await js(`(function(){var e=document.getElementById('bW2');
        if(!e) return 'нет'; var r=e.getBoundingClientRect(); var cs=getComputedStyle(e);
        var n=[...e.childNodes].find(x=>x.nodeType===3&&/\\S/.test(x.nodeValue));
        var rects=0; if(n){var rg=document.createRange(); rg.selectNodeContents(n); rects=[...rg.getClientRects()].length;}
        return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),flex:cs.flex,ow:cs.overflowWrap,rects:rects,txt:e.textContent.trim()}); })()`)); }
      if(v==='body'){ const seenW=await js(`(function(){var e=document.getElementById('bW2');
        if(!e) return 0; var r=e.getBoundingClientRect(); return (r.width>0&&r.height>0)?1:0; })()`);
        chk(seenW===1,'на '+w+' px карточка веса на Теле не смонтирована — обход вёрстки смотрит на пустой экран и ничего не проверяет'); }
    }
    drain();
  }
  /* 3е. ГАЛОЧКА — КВАДРАТ, А НЕ ПОЛОСКА.
     Аудит 23.08: общее правило для полей рисует рамку через box-shadow, а
     двенадцать галочек по всему приложению носили инлайновый width:auto —
     коробка выходила 13×20, и нарисованная рамка торчала на 3.5 px сверху и
     снизу самого квадратика. Живут они в листах, куда обход вкладок не
     заходит, — поэтому открываем лист настроек явно. */
  {
    await js(`try{ sheet('sh-s',true); }catch(e){}`); await sleep(600);
    // галочки живут внутри свёрнутых <details> — разворачиваем, иначе
    // у потомков закрытого details координаты призрачные, а checkVisibility
    // честно говорит «не видно», и проверка молча смотрит в пустоту
    /* С v509 настройки — список и страницы: тумблеры лежат на странице «Зал»
       (и «О приложении» → Приватность). Правило заходит на страницу, а не
       ищет тумблеры на первом экране, где их по замыслу нет. */
    await js(`(function(){ if(typeof setPage==='function') setPage('grpGym'); document.querySelectorAll('#sh-s details').forEach(d=>d.open=true);return 1})()`);
    await sleep(500);
    const cb=await js(`(function(){
      const out=[], bad=[];
      document.querySelectorAll('#sh-s input[type=checkbox]').forEach(e=>{
        /* Переключатель — не галочка: он и обязан быть 51×31, это форма
           тумблера, а не квадратика. Правило написано 25.08 про рамку,
           торчащую за квадрат, и оно остаётся в силе для настоящих
           галочек; тумблеры проверяются своим правилом ниже. */
        if(e.classList.contains('sw')) return;
        if(e.closest('details:not([open])')) return;
        if(e.checkVisibility&&!e.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return;
        const r=e.getBoundingClientRect(); if(r.width<=0||r.height<=0) return;
        out.push(Math.round(r.width)+'×'+Math.round(r.height));
        if(Math.abs(r.width-r.height)>2) bad.push('галочка «'+(e.id||'—')+'» нарисована '+Math.round(r.width)+'×'+Math.round(r.height)+' — рамка торчит за квадратик');
        if(Math.min(r.width,r.height)<18) bad.push('галочка «'+(e.id||'—')+'» мельче 18 px — в неё не попасть пальцем');
      });
      /* ТУМБЛЕР: форма пилюли, цель под палец, состояние видно цветом.
         Проверяем то, что видит человек: ширина заметно больше высоты,
         высота не меньше 28, включённый и выключенный различаются фоном. */
      const sw=[...document.querySelectorAll('#sh-s input.sw')].filter(e=>{
        if(e.parentElement&&e.parentElement.closest('details:not([open])')) return false;
        const r=e.getBoundingClientRect(); return r.width>0&&r.height>0; });
      if(sw.length){
        const r0=sw[0].getBoundingClientRect();
        if(r0.width<r0.height*1.4) bad.push('переключатель '+Math.round(r0.width)+'×'+Math.round(r0.height)+
          ' — не читается как тумблер, выглядит квадратом');
        if(r0.height<28) bad.push('переключатель ниже 28 px — в него не попасть пальцем');
        /* У тумблера фон меняется ПЛАВНО (transition .2s). Сразу после
           переключения getComputedStyle отдаёт ещё старый цвет — оба замера
           возвращали одно и то же, и правило кричало «состояние не видно»
           на исправном переключателе. Снимаем переход на время замера:
           меряем цвет, к которому он идёт, а не тот, где он сейчас. */
        const was=sw[0].checked, tr=sw[0].style.transition;
        sw[0].style.transition='none';
        sw[0].checked=true;  sw[0].getBoundingClientRect();
        const on=getComputedStyle(sw[0]).backgroundColor;
        sw[0].checked=false; sw[0].getBoundingClientRect();
        const off=getComputedStyle(sw[0]).backgroundColor;
        sw[0].checked=was; sw[0].style.transition=tr;
        if(on===off) bad.push('переключатель не меняет цвет при включении — состояние не видно');
      }
      return {всего:out.length, тумблеров:sw.length, размеры:[...new Set(out)], плохо:[...new Set(bad)].slice(0,4)};})()`);
    /* Страж переписан 29.08. Квадратных галочек в настройках не осталось
       вовсе — все переключатели стали тумблерами, и страж «нашлись хотя бы
       четыре галочки» валил исправный экран. Он охраняет не галочку, а то,
       что проверке ЕСТЬ ЧТО МЕРИТЬ: считаем и галочки, и тумблеры. */
    /* Порог «больше трёх» стоял, когда все двенадцать переключателей лежали в
       одном листе. С v509 правило заходит на страницу «Зал», где их ровно три —
       и трёх достаточно, чтобы форму было на чём мерить. */
    chk(cb&&(cb.всего+ (cb.тумблеров||0))>=3,'в листе настроек не нашлось ни галочек, ни переключателей — проверка их формы ничего не проверила ('+JSON.stringify(cb).slice(0,120)+')');
    chk(cb&&!(cb.плохо||[]).length,'галочки в настройках: '+((cb&&cb.плохо)||[]).join(' · '));
    // тот же лист — единственное место, где «Экспорт JSON» и «Импорт» стоят
    // рядом: <label> в роли кнопки уносил вниз отступ подписи
    const rs=await js(RHYTHM);
    chk(Array.isArray(rs),'проверка ритма в настройках не вернула список');
    chk(!rs||!rs.length,'в листе настроек ритм сбит: '+(rs||[]).join(' · '));
    if(process.env.BVDBG) console.log('   DBG галочки: '+JSON.stringify(cb));
    await js(`try{ sheet('sh-s',false); }catch(e){}`); await sleep(300); drain();
  }
  /* Сравниваем ОДНУ И ТУ ЖЕ кнопку на узком и широком экране. Широкий экран
     не имеет права дать пальцу меньше, чем узкий: это не «дизайн под ширину»,
     это забытый нижний предел. Порог 1.5 px — на округление. */
  {
    let сравнили=0;
    ['food','train','body','coach'].forEach(v=>{
      const узк=tapBy['320|'+v], шир=tapBy['390|'+v];
      if(!узк||!шир) return;
      Object.keys(узк).forEach(k=>{
        if(!шир[k]) return;
        /* Сравниваем только кнопки БЕЗ подписи. У кнопки с текстом на узком
           экране подпись переносится на две строки, и она честно становится
           выше — это не дефект, а перенос («Голосом» 80×55 против 103×37). */
        if(!узк[k].ико||!шир[k].ико) return;
        сравнили++;
        const dw=узк[k].ш-шир[k].ш, dh=узк[k].в-шир[k].в;
        if(dw>1.5||dh>1.5) chk(false,'во вкладке «'+v+'» кнопка '+k+' на широком экране МЕНЬШЕ, чем на узком: '+
          шир[k].ш+'×'+шир[k].в+' на 390 против '+узк[k].ш+'×'+узк[k].в+' на 320 — палец не уменьшился');
      });
    });
    chk(сравнили>10,'сравнить размеры кнопок без подписи между ширинами не удалось ('+сравнили+' штук) — проверка ничего не проверила');
    if(process.env.BVDBG) console.log('   DBG сравнено кнопок без подписи между 320 и 390: '+сравнили);
  }
  /* ── ДЕНЬ ОТДЫХА — ОТДЕЛЬНЫМ ПРОХОДОМ, А НЕ ПО КАЛЕНДАРЮ ──
     Засев выше обещает «программу на все дни недели», но days:3 с семью
     dows даёт три тренировочных дня, и какой окажется сегодня — решает
     календарь. 02.09 (среда) прогон видел тренировочную шапку, 03.09
     (четверг) — впервые шапку дня отдыха, и она сразу дала два нарушения:
     обёртка без нижнего отступа слипалась со следующей карточкой в 0 px, а
     подзаголовок «0 из 3 · сегодня отдых» уезжал за край на 320 на 35 px.
     Правило, которое зависит от дня недели, зелёное шесть дней из семи.
     Здесь оба состояния шапки проходят ширины 390 и 320 ЯВНО. */
  {
    const было=await js(`(function(){ return JSON.stringify((S.prog&&S.prog.plan||[]).map(d=>d.dow)); })()`);
    /* Прежние правила уже нажали «Начать тренировку» и записали подходы за
       сегодня — с ними день «начат» и шапка отдыха не рисуется. Снимаем
       старт сессии и сегодняшние подходы на время замера, потом возвращаем. */
    const отдых=await js(`(async function(){ try{
      const tw=dowOf(td()); (S.prog.plan||[]).forEach(d=>{ if(d.dow===tw) d.dow=(tw%7)+1; });
      const ss=gymSess(td()); window.__restSess=ss?{...ss}:null;
      if(ss){ await put('sess',{...ss,start:null,end:null,min:null}); SESS=await all('sess'); }
      window.__restSets=SETS.filter(x=>x.d===td()); SETS=SETS.filter(x=>x.d!==td());
      /* v614: у программы восьмидневной давности (фикстура прошлого дня выше) в
         выходной встаёт долг из очереди — а здесь меряется именно шапка отдыха.
         Программа «рождена сегодня» на время замера: до рождения долга нет. */
      window.__restCreated=S.prog.created||null; S.prog.created=td(); delete S.roll; delete S.daySkip;
      delete S.dayMap; S.moveWk=null; renderAll(); return 'ок'; }catch(e){ return 'ERR '+e.message } })()`);
    await sleep(300);
    /* Спрашиваем СОСТОЯНИЕ, а не ответ вызова: контекст страницы иногда
       возвращает пустоту на длинный async-вызов (прогон 04.09 — undefined
       при выполненной фикстуре). */
    const сост=JSON.parse(await js(`(function(){ try{ const tw=dowOf(td());
      return JSON.stringify({отдых:!(S.prog.plan||[]).some(d=>d.dow===tw), старт:!!((gymSess(td())||{}).start), сеты:SETS.filter(x=>x.d===td()).length});
    }catch(e){ return JSON.stringify({err:e.message}) } })()`)||'{}');
    chk(сост.отдых===true&&сост.старт===false&&сост.сеты===0,'не удалось сделать сегодня днём отдыха ('+JSON.stringify(сост)+', ответ вызова: '+отдых+') — шапка дня отдыха не проверена');
    for(const w of [390,320]){
      await send('Emulation.setDeviceMetricsOverride',{width:w,height:844,deviceScaleFactor:2,mobile:true});
      await sleep(400);
      await js(`document.querySelector('nav button[data-v="train"]').click()`); await sleep(450);
      /* v517: день отдыха — заголовок «Отдых» и факты строками (следующая,
         шаги), без предупреждения с крестиком и без лаймовой кнопки. */
      const о=JSON.parse(await js(`(function(){ try{
        const h=document.querySelector('#nextBox .dhd'); const t=h&&h.querySelector('.dhd-t');
        const b=document.getElementById('bAddEx');
        return JSON.stringify({заголовок:t?t.textContent.trim():'', факты:/Следующая ·/.test(h?h.textContent:'')&&!!h.querySelector('.rest-status-card .rs-t'),
          крестик:!!document.querySelector('#nextBox .dis-x'), лайм:!!(b&&!/gho|sec|lrow/.test(b.className))});   /* v611: факты — карточка, кнопка — строка списка */
      }catch(e){ return JSON.stringify({сбой:e.message}) } })()`)||'{}');
      chk(о.заголовок==='Отдых','на '+w+' px шапка дня отдыха не показалась (заголовок «'+о.заголовок+'») — проверка дня отдыха ничего не проверила');
      chk(о.факты===true,'на '+w+' px в шапке дня отдыха нет фактов «Следующая ·» и «Шаги ·»');
      chk(о.крестик===false,'на '+w+' px в день отдыха на экране предупреждение с крестиком — отдых подан как ошибка');
      chk(о.лайм===false,'на '+w+' px в день отдыха «+ Упражнение» лаймовая — главного действия в день отдыха нет');
      const out=await js(OVER);
      chk(!out||!out.length,'на '+w+' px в день отдыха содержимое уезжает за край: '+(out||[]).join(' · '));
      const r=await js(RHYTHM);
      chk(!r||!r.length,'на '+w+' px в день отдыха ритм сбит: '+(r||[]).join(' · '));
    }
    await js(`(async function(){ try{ const dows=${было}; (S.prog.plan||[]).forEach((d,i)=>{ d.dow=dows[i]; });
      if(window.__restSess){ await put('sess',window.__restSess); SESS=await all('sess'); }
      (window.__restSets||[]).forEach(x=>SETS.push(x)); window.__restSess=null; window.__restSets=null;
      if(window.__restCreated) S.prog.created=window.__restCreated; else delete S.prog.created; window.__restCreated=null;
      delete S.dayMap; S.moveWk=null; delete S.roll; renderAll(); }catch(e){} return 1; })()`);
    await sleep(300); drain();
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await sleep(400);
  // вернуть режим, каким он был: дальше идёт сравнение простого с полным.
  // С 04.09 — по форме CRAFT: запись в хранилище — отдельным коротким
  // вызовом, на её ответ ничего не опирается.
  await js(`(function(){ S.ui=${JSON.stringify(uiWas||'')}; return 1; })()`);
  await js(`(async()=>{ try{ await put('settings',S,'main'); }catch(e){} return 1; })()`);
  await js(`(function(){ try{applyUI()}catch(e){} renderAll(); return 1; })()`);
  await sleep(600);
  await js(`document.querySelector('nav button[data-v="food"]').click()`); await sleep(400); drain();

  /* 3к. ШАПКА ОДНОЙ ВЫСОТЫ НА ВСЕХ ВКЛАДКАХ.
     Пустой подзаголовок схлопывался, и заголовок вкладки прыгал вверх: у
     «Здоровья» без добавок шапка была ниже соседних (сверка 23.08). */
  {
    const hh={};
    for(const v of ['food','train','body','health','coach']){
      await js(`(function(){const b=document.querySelector('nav button[data-v="${v}"]'); if(b)b.click(); return 1})()`);
      await sleep(500);
      hh[v]=await js(`(function(){const h=document.querySelector('header'); return h?Math.round(h.getBoundingClientRect().height*10)/10:0})()`);
    }
    const vals=Object.values(hh);
    chk(vals.every(x=>x>20),'шапку не удалось измерить ни на одной вкладке — проверка её высоты ничего не проверила ('+JSON.stringify(hh)+')');
    const spread=Math.max.apply(null,vals)-Math.min.apply(null,vals);
    chk(spread<=1,'шапка разной высоты на разных вкладках (разброс '+Math.round(spread*10)/10+' px): '+
      JSON.stringify(hh)+' — заголовок прыгает при переключении');
    drain();
  }
  /* 3л. КОЛЬЦА: ЦВЕТ — ЭТО ИМЯ ПОКАЗАТЕЛЯ.
     Решение v370: одно горячее кольцо (калории) плюс монохром на остальном —
     метрики не равноправны, и светофор из трёх цветов делает их равными.
     Светлая тема это правило не получила и осталась светофором: оливковый,
     бирюзовый, индиговый (сверка 23.08). Правило самокалибрующееся: два
     второстепенных кольца обязаны быть монохромны — насыщенность у них ниже,
     чем у акцента, и близка друг к другу. */
  {
    for(const th of ['dark','light']){
      await js(`(function(){ document.documentElement.setAttribute('data-theme','${th}'); return 1 })()`);
      await sleep(300);
      const rg=await js(`(function(){
        const px=c=>{const m=String(c).match(/[\\d.]+/g)||[0,0,0,1];return [+m[0],+m[1],+m[2]]};
        const sat=c=>{const mx=Math.max(c[0],c[1],c[2]), mn=Math.min(c[0],c[1],c[2]);
          return mx===0?0:Math.round((mx-mn)/mx*100)/100;};
        const p=document.createElement('span');
        p.style.cssText='position:absolute;left:-9999px'; document.body.appendChild(p);
        const tok=t=>{ p.style.color='var('+t+')'; return px(getComputedStyle(p).color); };
        const hue=c=>{const r=c[0]/255,g=c[1]/255,b=c[2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
          if(!d) return -1; let h; if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4;
          h*=60; return (h+360)%360;};
        const o={rg1:sat(tok('--rg1')), rg2:sat(tok('--rg2')), rg3:sat(tok('--rg3')),
          h1:hue(tok('--rg1')), h2:hue(tok('--rg2')), h3:hue(tok('--rg3'))};
        p.remove(); return o;})()`);
      chk(rg&&rg.rg1!=null,'в теме «'+th+'» не удалось померить цвета колец');
      if(rg&&rg.rg1!=null){
        /* Мерить «похожесть насыщенностей» мало: бирюза и индиго обе яркие и
           по насыщенности близки, а глазами это чистый светофор (мутация
           прошла мимо правила 23.08). Монохром — это ОТСУТСТВИЕ цвета:
           у второстепенных колец насыщенность обязана быть низкой. */
        /* ПРАВИЛО ПЕРЕВЁРНУТО 29.08 ПО РЕШЕНИЮ ВЛАДЕЛЬЦА.
           Было (v370): второстепенные кольца обязаны быть монохромны, иначе
           «светофор делает метрики равными». Владелец прислал пять экранов
           Apple Fitness+ и сказал: «смысл правил, если люди зайдут, увидят
           дизайн и уйдут». Он прав: три ярких кольца — подпись того жанра,
           в котором мы работаем, а монохром делал прибор похожим на отчёт.
           Теперь охраняется ОБРАТНОЕ и более полезное: цвет закреплён за
           величиной, поэтому три кольца обязаны РАЗЛИЧАТЬСЯ — иначе цвет
           перестаёт быть именем показателя и снова становится украшением.
           Меряем тон, а не насыщенность: бирюза и индиго близки по
           насыщенности, но это разные имена; а вот два оттенка зелёного
           человек не различит и по цвету показатель не узнает. */
        const H=c=>{const r=c[0]/255,g=c[1]/255,b2=c[2]/255,mx=Math.max(r,g,b2),mn=Math.min(r,g,b2),d=mx-mn;
          if(!d) return -1; let h; if(mx===r) h=((g-b2)/d)%6; else if(mx===g) h=(b2-r)/d+2; else h=(r-g)/d+4;
          h*=60; return (h+360)%360;};
        const hs=[rg.h1,rg.h2,rg.h3];
        const dist=(x,y)=>{const d=Math.abs(x-y)%360; return Math.min(d,360-d);};
        const pairs=[[0,1],[0,2],[1,2]].map(([i,j])=>Math.round(dist(hs[i],hs[j])));
        chk(hs.every(h=>h>=0)&&Math.min.apply(null,pairs)>=40,
          'в теме «'+th+'» кольца не различаются по цвету: тона '+hs.map(Math.round).join('°/')+
          '°, ближайшая пара '+Math.min.apply(null,pairs)+'° при пороге 40° — цвет перестаёт быть именем показателя');
        chk(rg.rg1>=0.5&&rg.rg2>=0.5&&rg.rg3>=0.5,
          'в теме «'+th+'» кольцо выцвело: насыщенности '+[rg.rg1,rg.rg2,rg.rg3].join(' / ')+
          ' при пороге 0.5 — серое кольцо читается как неработающий прибор');
        /* Проверка «второстепенные тише главного» снята вместе с доктриной
           монохрома: у равных по важности величин нет старшего. */
      }
      if(process.env.BVDBG) console.log('   DBG кольца '+th+': '+JSON.stringify(rg));
    }
    await js(`(function(){ document.documentElement.setAttribute('data-theme',(S&&S.theme)||'dark'); return 1 })()`);
    await sleep(300); drain();
  }
  /* 3г. ТРЕВОГА НЕ МОЖЕТ БЫТЬ ТИШЕ СНОСКИ.
     Аудит 23.08 нашёл целый класс: в светлой теме `--wn` и `--bd` вообще не
     переопределялись, и оранжевый #ffb44d давал на белом 1.5:1, красный
     #ff6b6b — 2.5:1. То есть баннер «Данные только на этом устройстве»,
     «Слабое место, которое надо знать», кнопка «Удалить все данные» и
     значения анализов вне нормы выглядели бледнее обычного серого текста —
     цвет тревоги переставал тревожить. Двадцать пять мест, один корень.
     Правило самокалибрующееся, поэтому годится для обеих тем: цвет со
     СМЫСЛОМ обязан быть контрастнее самого тихого тона текста (--t3).
     Порог не выдуман — он берётся из самой темы. */
  {
    const CONTRAST=`(function(){
      const px=c=>{ const m=String(c).match(/[\\d.]+/g)||[0,0,0,1];
        return [+m[0],+m[1],+m[2], m[3]==null?1:+m[3]]; };
      const over=(fg,bg)=>{ const a=fg[3];
        return [fg[0]*a+bg[0]*(1-a), fg[1]*a+bg[1]*(1-a), fg[2]*a+bg[2]*(1-a), 1]; };
      const lum=c=>{ const f=v=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
        return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
      const ratio=(a,b)=>{ const l1=lum(a), l2=lum(b);
        return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
      // подложка — реальный фон карточки поверх фона страницы
      const card=document.createElement('div'); card.className='card';
      card.style.cssText='position:absolute;left:-9999px;top:0;width:100px;height:40px';
      document.body.appendChild(card);
      const pageBg=px(getComputedStyle(document.body).backgroundColor);
      const bg=over(px(getComputedStyle(card).backgroundColor), pageBg[3]?pageBg:[255,255,255,1]);
      const probe=document.createElement('span'); card.appendChild(probe);
      const col=tok=>{ probe.style.color='var('+tok+')';
        return over(px(getComputedStyle(probe).color), bg); };
      const base=ratio(col('--t3'),bg);
      const out={фон:'rgb('+bg.slice(0,3).map(Math.round).join(',')+')', сноска:Math.round(base*100)/100, плохо:[]};
      [['--wn','цвет предупреждения'],['--bd','цвет опасности']].forEach(([t,nm])=>{
        const r=ratio(col(t),bg); out[t]=Math.round(r*100)/100;
        if(r<base-0.01) out.плохо.push(nm+' ('+t+') читается хуже обычной сноски: '+
          (Math.round(r*100)/100)+':1 против '+(Math.round(base*100)/100)+':1 — тревога выглядит тише примечания'); });
      /* Акцент — не тревога, его порог другой: он должен просто ЧИТАТЬСЯ.
         Держим норму AA для обычного текста (4.5:1). В светлой теме лайм
         давал 3.27:1 — ссылки и «21 день подряд» выглядели выцветшими.
         Мерить на белой карточке МАЛО: половина мест, где акцент работает, —
         это подложки (серая плашка .ob, акцентная подкраска чипов и активной
         вкладки). На них запас съедается целиком: при 4.52 на белом плашки
         давали 3.8 (замер 23.08). Поэтому проверяем каждую подложку. */
      { const plates=[['карточка',bg],
          ['серая плашка .ob',(function(){ const d=document.createElement('div'); d.className='ob';
            d.style.cssText='position:absolute;left:-9999px;top:0;width:120px'; document.body.appendChild(d);
            const c=over(px(getComputedStyle(d).backgroundColor),bg); d.remove(); return c; })()],
          ['акцентная подкраска',(function(){ probe.style.background='var(--acw)';
            const c=over(px(getComputedStyle(probe).backgroundColor),bg); probe.style.background=''; return c; })()]];
        plates.forEach(([nm,pb])=>{ const r=ratio(col('--ac'),pb);
          out['--ac на «'+nm+'»']=Math.round(r*100)/100;
          if(r<4.5) out.плохо.push('акцент на «'+nm+'» не дотягивает до нормы: '+(Math.round(r*100)/100)+
            ':1 при минимуме 4.5:1 — ссылки и цифры выглядят выцветшими'); }); }
      /* И подпись НА заливке акцентом. Без этой пары любое затемнение акцента
         молча роняет читаемость текста на главной кнопке. */
      { const fill=over(px((function(){ probe.style.background='var(--ac-fill)';
          const c=getComputedStyle(probe).backgroundColor; probe.style.background=''; return c; })()),bg);
        const on=over(px((function(){ probe.style.color='var(--on-ac)';
          return getComputedStyle(probe).color; })()),fill);
        const r=ratio(on,fill); out['на заливке']=Math.round(r*100)/100;
        if(r<4.5) out.плохо.push('подпись на заливке акцентом читается '+(Math.round(r*100)/100)+
          ':1 при минимуме 4.5:1 — текст на главной кнопке сливается с ней'); }
      card.remove();
      return out;
    })()`;
    /* И отдельно — чипы с зашитым тёмным фоном: в светлой теме правило
       `[data-theme="light"] .tag` той же силы, но стоит выше по файлу и
       проигрывает `.tag.ai`/`.tag.wn`. Чип оставался чёрным пятном. */
    const CHIPS=`(function(){
      const px=c=>{ const m=String(c).match(/[\\d.]+/g)||[0,0,0,1];
        return [+m[0],+m[1],+m[2], m[3]==null?1:+m[3]]; };
      const lum=c=>{ const f=v=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
        return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
      const over=(fg,bg)=>{ const a=fg[3];
        return [fg[0]*a+bg[0]*(1-a), fg[1]*a+bg[1]*(1-a), fg[2]*a+bg[2]*(1-a), 1]; };
      const card=document.createElement('div'); card.className='card';
      card.style.cssText='position:absolute;left:-9999px;top:0;width:200px';
      document.body.appendChild(card);
      const cardC=px(getComputedStyle(card).backgroundColor), cardL=lum(cardC);
      const bad=[];
      // полупрозрачную подкраску (--acw и подобные) композитим на карточку:
      // без этого rgba(111,156,0,.13) считалась тёмно-зелёной заливкой
      ['ac','sup','ai','wn'].forEach(k=>{
        const s=document.createElement('span'); s.className='tag '+k; s.textContent='т'; card.appendChild(s);
        const b=over(px(getComputedStyle(s).backgroundColor),cardC);
        const d=Math.abs(lum(b)-cardL);
        if(d>0.45) bad.push('чип .tag.'+k+' залит фоном чужой темы — на карточке это пятно');
        s.remove(); });
      card.remove();
      return bad;
    })()`;
    for(const th of ['dark','light']){
      await js(`(function(){ document.documentElement.setAttribute('data-theme','${th}'); return 1; })()`);
      await sleep(350);
      const c=await js(CONTRAST);
      chk(c&&c.сноска>1.5,'в теме «'+th+'» не удалось померить контраст — проверка ничего не проверила ('+JSON.stringify(c).slice(0,120)+')');
      chk(c&&!(c.плохо||[]).length,'в теме «'+th+'»: '+((c&&c.плохо)||[]).join(' · '));
      /* Кнопка обязана быть отличима от карточки, на которой лежит: либо
         своей заливкой, либо контуром. Заливка `.btn.gho` задана БЕЛЫМ с
         прозрачностью — на тёмной карточке видна, на белой исчезает вместе с
         кнопкой, и «Пересчитать» превращается в обычный текст (сверка 23.08). */
      const btn=await js(`(function(){
        const px=c=>{const m=String(c).match(/[\\d.]+/g)||[0,0,0,1];return [+m[0],+m[1],+m[2],m[3]==null?1:+m[3]]};
        const over=(f,b)=>{const a=f[3];return [f[0]*a+b[0]*(1-a),f[1]*a+b[1]*(1-a),f[2]*a+b[2]*(1-a),1]};
        const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
          return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])};
        const card=document.createElement('div'); card.className='card';
        card.style.cssText='position:absolute;left:-9999px;top:0;width:220px'; document.body.appendChild(card);
        const cardC=px(getComputedStyle(card).backgroundColor), cardL=lum(cardC);
        const bad=[];
        ['btn','btn sec','btn gho','btn dgr'].forEach(cls=>{
          const b=document.createElement('button'); b.className=cls; b.textContent='Тест'; card.appendChild(b);
          const cs=getComputedStyle(b);
          const fill=over(px(cs.backgroundColor),cardC);
          const виденФон=Math.abs(lum(fill)-cardL)>0.006;
          const естьКонтур=(cs.boxShadow&&cs.boxShadow!=='none')||(parseFloat(cs.borderTopWidth)>0.5&&cs.borderTopStyle!=='none');
          if(!виденФон&&!естьКонтур) bad.push('кнопка .'+cls.split(' ').join('.')+' не отличима от карточки: ни заливки, ни контура — выглядит просто текстом');
          b.remove(); });
        card.remove(); return bad;})()`);
      /* И сама карточка обязана быть отличима от фона страницы — фоном или
         контуром. В тёмной теме мелкая тень выключена (на почти чёрном её не
         видно), и край держался только на разнице #101319 против #07080b —
         1.08:1. На «Здоровье», где строки идут по карточке без разделителей,
         таблица от этого казалась висящей в воздухе (сверка 23.08). */
      const crd=await js(`(function(){
        const px=c=>{const m=String(c).match(/[\\d.]+/g)||[0,0,0,1];return [+m[0],+m[1],+m[2],m[3]==null?1:+m[3]]};
        const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
          return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])};
        const rat=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)};
        const page=px(getComputedStyle(document.body).backgroundColor);
        const c=document.createElement('div'); c.className='card';
        c.style.cssText='position:absolute;left:-9999px;top:0;width:200px;height:60px';
        document.body.appendChild(c);
        const cs=getComputedStyle(c);
        const r=Math.round(rat(px(cs.backgroundColor),page)*1000)/1000;
        const контур=(cs.boxShadow&&cs.boxShadow!=='none')||(parseFloat(cs.borderTopWidth)>0.5&&cs.borderTopStyle!=='none');
        c.remove();
        return {край:r, контур:контур};})()`);
      chk(crd&&crd.край!=null,'не удалось померить край карточки');
      chk(crd&&(crd.край>=1.12||crd.контур),
        'в теме «'+th+'» карточка не отличима от фона: '+((crd&&crd.край)||'?')+
        ':1 и ни тени, ни контура — содержимое выглядит висящим в воздухе');
      if(process.env.BVDBG) console.log('   DBG карточка '+th+': '+JSON.stringify(crd));
      chk(Array.isArray(btn),'проверка кнопок не вернула список');
      chk(!btn||!btn.length,'в теме «'+th+'»: '+(btn||[]).join(' · '));
      const ch2=await js(CHIPS);
      chk(Array.isArray(ch2),'в теме «'+th+'» проверка чипов не вернула список');
      chk(!ch2||!ch2.length,'в теме «'+th+'»: '+(ch2||[]).join(' · '));
      if(process.env.BVDBG) console.log('   DBG тема '+th+': '+JSON.stringify(c));
    }
    await js(`(function(){ document.documentElement.setAttribute('data-theme',(S&&S.theme)||'dark'); return 1; })()`);
    await sleep(300); drain();
  }

  /* 3б. НИЖНИЕ ПОЛОСЫ НЕ КРАДУТ ПОСЛЕДНИЙ ЭКРАН.
     Над навигацией живут ещё две закреплённые полосы: таймер отдыха и строка
     «вышла новая версия». Отступ страницы снизу их не учитывал (78 px — ровно
     под навигацию), а сами полосы стояли на фиксированной высоте. Замер 22.08:
     в самом низу, когда доскроллить уже некуда, 80 px содержимого оказывались
     ПОД полосами — нажать было физически нельзя; и друг друга полосы
     перекрывали на 50 px. Правило: сколько бы полос ни было видно, самый
     нижний край содержимого обязан оставаться выше их всех, а сами полосы
     не имеют права накладываться. */
  {
    const MEAS=`(function(){
      const H=innerHeight;
      const bars=[...document.querySelectorAll('nav,.rest.on,#updBar')]
        .map(e=>{const r=e.getBoundingClientRect();
          return {id:e.id||String(e.className).slice(0,10),top:Math.round(r.top),bot:Math.round(r.bottom)};})
        .filter(b=>b.bot>b.top);
      const topBar=bars.length?Math.min.apply(null,bars.map(b=>b.top)):H;
      let low=0, lowEl='';
      [...document.querySelectorAll('body *')].forEach(e=>{
        const st=getComputedStyle(e);
        if(st.position==='fixed'||e.closest('nav,.rest,#updBar,.toast,.sheet,#gate,#splash')) return;
        // закрытый <details> прячет содержимое через content-visibility:
        // getBoundingClientRect у потомков отдаёт ПРИЗРАЧНЫЕ координаты
        if(e.closest('details:not([open])')&&!e.matches('summary,summary *')) return;
        if(e.checkVisibility&&!e.checkVisibility({contentVisibilityAuto:true,opacityProperty:true,visibilityProperty:true})) return;
        const r=e.getBoundingClientRect(); if(r.height<=0||r.width<=0) return;
        if(r.bottom>low){ low=r.bottom; lowEl=(e.textContent||'').trim().slice(0,40); } });
      const cross=[];
      for(let i=0;i<bars.length;i++) for(let j=i+1;j<bars.length;j++){
        const o=Math.min(bars[i].bot,bars[j].bot)-Math.max(bars[i].top,bars[j].top);
        if(o>2) cross.push(bars[i].id+' и '+bars[j].id+' на '+Math.round(o)+' px'); }
      return {covered:Math.round(Math.max(0,low-topBar)), lowEl, cross, bars:bars.length};
    })()`;
    const toEnd=async()=>{ await js('scrollTo(0,document.documentElement.scrollHeight)'); await sleep(500); };
    await js(`document.querySelector('nav button[data-v="train"]').click()`); await sleep(600); drain();
    await toEnd();
    const b0=await js(MEAS);
    chk(b0&&b0.covered<=2,'внизу экрана '+((b0||{}).covered)+' px содержимого под навигацией, и доскроллить уже некуда — «'+((b0||{}).lowEl)+'» не нажать');
    // а теперь как во время тренировки: идёт отдых и ждёт обновление
    await js(`try{ startRest(90); }catch(e){} try{ showUpdateBar(); }catch(e){}`); await sleep(500);
    await toEnd();
    const b1=await js(MEAS);
    chk(b1&&b1.bars>=3,'таймер отдыха или строка обновления не показались — проверка полос ничего не проверила');
    chk(b1&&!(b1.cross||[]).length,'закреплённые полосы налезают друг на друга: '+((b1||{}).cross||[]).join('; '));
    chk(b1&&b1.covered<=2,'во время отдыха '+((b1||{}).covered)+' px содержимого уходит под полосы — «'+((b1||{}).lowEl)+'» не нажать, а страница уже кончилась');
    await js(`try{ stopRest(); }catch(e){} var u=document.getElementById('updBar'); if(u) u.remove(); try{ barsSync(); }catch(e){}`);
    await sleep(300); drain();
    await js(`document.querySelector('nav button[data-v="food"]').click()`); await sleep(400); drain();

    /* ── МЕЖДУ ЗАКРЕПЛЁННЫМИ ПОЛОСАМИ НЕТ ПОЛОСЫ ФОНА ──
       Полевой скриншот владельца 30.08: «пробел под "Записать еду" через
       весь экран». Панель ввода стояла на зашитых 77 px от низа — числе от
       старой плавающей пилюли; когда панель вкладок прижали к краю, между
       ними осталась щель на всю ширину, сквозь которую просвечивал текст
       страницы. Прежнее правило ловило НАЛОЖЕНИЕ полос и было слепо к
       разрыву: две полосы, стоящие в 15 px друг от друга, его устраивали.
       Меряем то же самое с другой стороны: полосы, стоящие одна на другой,
       обязаны соприкасаться. Порог 4 px — это уже видимая полоса фона. */
    await sleep(500);
    const шов=await js(`(function(){
      const nv=document.querySelector('nav'), fb=document.getElementById('foodBar');
      if(!nv||!fb) return {нет:1};
      const n=nv.getBoundingClientRect(), f=fb.getBoundingClientRect();
      if(!(f.height>0)||!(n.height>0)) return {нет:2};
      return {зазор:Math.round(n.top-f.bottom), полосаВнизу:Math.round(innerHeight-n.bottom)};})()`);
    chk(шов&&шов.нет==null,'панель ввода или панель вкладок не найдены — проверка шва ничего не проверила ('+JSON.stringify(шов)+')');
    if(шов&&шов.нет==null){
      chk(шов.зазор<=4&&шов.зазор>=-4,'между «Записать еду» и панелью вкладок полоса фона в '+шов.зазор+
        ' px на всю ширину экрана — сквозь неё просвечивает страница');
      chk(шов.полосаВнизу<=1,'под панелью вкладок осталось '+шов.полосаВнизу+
        ' px фона — панель не доходит до нижнего края экрана');
    }
    drain();
  }

  /* ── ЛИСТ С ФОРМОЙ НЕ ПРЕВРАЩАЕТСЯ В ЩЕЛЬ ──
     Полевой скриншот владельца 30.08 с телефона: «+ Вручную», клавиатура,
     и от листа осталась полоска с одним полем — «Числа указаны», ккал, БЖУ
     и кнопка «Добавить» за кадром. Его слова: «чтоб эта строка была вверху».
     Клавиатуру в headless-браузере не вызвать, но её эффект воспроизводится
     точно: видимая область становится вдвое ниже. Ставим экран 390×420 —
     это ровно то, что остаётся от телефона под русской клавиатурой, —
     и требуем, чтобы лист крепился СВЕРХУ и первое поле было видно.
     С 04.09 — по форме CRAFT: открытие листа, тап в поле и подкрутка —
     отдельные короткие вызовы с паузой в Node, замер — синхронный. */
  {
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:420,deviceScaleFactor:2,mobile:true});
    await sleep(600);
    await js(`document.querySelector('nav button[data-v="food"]').click()`); await sleep(500);
    /* Проверяем ВСЕ листы приложения, а не один. Сплошной проход 30.08
       нашёл шесть, где поле ввода уезжало на середину экрана или ниже, —
       и ни один из них владелец ещё не открывал.
       Правило меряет ИСХОД, а не раскладку: тыкаем в поле, ждём, пока
       приложение доведёт его до видимой области, и смотрим, видно ли его
       и осталась ли достижимой главная кнопка листа. Строгий замер «поле
       в верхней трети» я пробовал — он честно валит длинные анкеты, где
       прокрутка нормальна и приложение само подкручивает к полю. */
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного
       (CRAFT 04.09): длинный async-вызов на весь лист иногда возвращал
       «не разобрать» при исправном приложении. Открытие листа, тап в поле,
       подкрутка — отдельные вызовы из Node с паузой; каждый замер —
       синхронный, с одним повтором, если страница промолчала. Между
       вызовами переменные страницы не живут: лист, тело и поля ищем по
       селектору заново в каждом вызове, исключение sheet() — в window.__shErr. */
    const спроси=async expr=>{
      let r=await js(expr); if(r===undefined||r===null||r===''){ await sleep(400); r=await js(expr); }
      if(r&&r.__err) return {сбой:r.__err};
      if(typeof r!=='string') return {сбой:'не разобрать'};
      try{ return JSON.parse(r) }catch(e){ return {сбой:'не разобрать: '+r} }
    };
    const ЛИСТ=id=>`const sh=document.getElementById(${JSON.stringify(id)}), inn=sh&&sh.querySelector('.in');
      const поля=inn?[...inn.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),textarea')].filter(e=>e.getBoundingClientRect().height>0):[];
      const поле=поля[поля.length-1];`;
    let листы=await js(`[...document.querySelectorAll('.sheet')].map(s=>s.id)`);
    if(!Array.isArray(листы)){ await sleep(400); листы=await js(`[...document.querySelectorAll('.sheet')].map(s=>s.id)`); }
    const беды=[]; let сбой='';
    for(const id of (Array.isArray(листы)?листы:[])){
      if(id==='sh-find') continue;             // у него свой, более старый механизм
      /* Закрыть прежние листы и открыть этот. sheet() — вызов функции: своей
         кнопки на экране у каждого листа нет; ответ вызова не нужен. */
      await js(`document.querySelectorAll('.sheet.on').forEach(x=>x.classList.remove('on','kb'))`); await sleep(100);
      await js(`(function(){ try{ sheet(${JSON.stringify(id)},true); window.__shErr=''; }catch(e){ window.__shErr=String(e.message).slice(0,40); } return 1 })()`); await sleep(400);
      /* Замер 1: лист открылся, у него есть тело и видимые поля. */
      const о=await спроси(`(function(){ try{ ${ЛИСТ(id)}
        return JSON.stringify({err:window.__shErr||'', нет:!inn, полей:поля.length,
          ттл:((inn&&inn.querySelector('h3')||{}).textContent||'').replace(/\\s+/g,' ').trim().slice(0,22)}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      if(о.сбой){ сбой=сбой||(id+': '+о.сбой); continue; }
      if(о.err||о.нет){ беды.push(id+' не открылся ('+JSON.stringify(о.err?{err:о.err}:{нет:1})+')'); continue; }
      if(!о.полей) continue;
      /* Самое дальнее поле — худший случай: если видно его, видно и все
         остальные. Именно туда человек и доходит, заполняя форму.
         Тап в поле и подкрутка к нему — отдельные вызовы, пауза в Node. */
      await js(`(function(){ ${ЛИСТ(id)} if(поле) поле.focus(); return !!поле })()`); await sleep(500);
      await js(`(function(){ ${ЛИСТ(id)} try{ if(поле) поле.scrollIntoView({block:'center'}); }catch(e){} return 1 })()`); await sleep(250);
      /* Замер 2: видно ли дальнее поле. */
      const п=await спроси(`(function(){ try{ ${ЛИСТ(id)} const f=поле.getBoundingClientRect();
        return JSON.stringify({полеВидно:(f.top>=-2&&f.bottom<=innerHeight+2), полеY:Math.round(f.top), экран:innerHeight}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      /* Подкрутка к главной кнопке листа (последняя видимая .btn). */
      await js(`(function(){ ${ЛИСТ(id)} const btns=inn?[...inn.querySelectorAll('.btn')].filter(b=>b.getBoundingClientRect().height>0):[];
        const гл=btns.length?btns[btns.length-1]:null; if(гл) гл.scrollIntoView({block:'center'}); return !!гл })()`); await sleep(200);
      /* Замер 3: достижима ли главная кнопка (нет кнопки — считаем достижимой, как и раньше). */
      const к=await спроси(`(function(){ try{ ${ЛИСТ(id)} const btns=[...inn.querySelectorAll('.btn')].filter(b=>b.getBoundingClientRect().height>0);
        const гл=btns.length?btns[btns.length-1]:null; let кнопкаВидна=true;
        if(гл){ const g=гл.getBoundingClientRect(); кнопкаВидна=g.top>=-2&&g.bottom<=innerHeight+2; }
        return JSON.stringify({кнопкаВидна}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      await js(`(function(){ ${ЛИСТ(id)} if(поле) поле.blur(); return 1 })()`);
      if(п.сбой||к.сбой){ сбой=сбой||(id+': '+(п.сбой||к.сбой)); continue; }
      if(!п.полеВидно) беды.push('«'+о.ттл+'»: до дальнего поля не добраться — оно на '+п.полеY+' px при экране '+п.экран);
      else if(!к.кнопкаВидна) беды.push('«'+о.ттл+'»: до главной кнопки не добраться');
    }
    chk(!сбой,'замер листов при клавиатуре сорвался: '+сбой);
    chk(листы&&листы.length>10,'листов найдено '+((листы||[]).length)+' — проверка при клавиатуре ничего не проверила');
    chk(!беды.length,'на экране высотой 420 px (столько остаётся под клавиатурой) заполнить форму нельзя: '+беды.slice(0,4).join(' · '));
    await js(`(function(){ document.querySelectorAll('.sheet.on').forEach(x=>x.classList.remove('on','kb')); delete window.__shErr; return 1 })()`);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await sleep(500); drain();
  }

  /* ── ТАЙМЕР ОТДЫХА ──
     Решение владельца 31.08: «делай таймер отдыха, он должен работать при
     выключенном экране». Слой, который можно проверить машиной, — этот:
     отсчёт, пауза, сигнал, блокировка экрана и то, что таймер не врёт после
     заморозки. Заморозка — главное: на телефоне JS замирает, когда экран
     гаснет, и таймер, считающий свои тики, после возврата покажет старое
     время и промолчит. Считать можно только от абсолютной метки.
     С 04.09 — по форме CRAFT: запуск и тап — отдельными короткими вызовами,
     ожидание — в Node, замер — синхронный с одним повтором, а не ответ
     одного длинного async-вызова. */
  {
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await js(`document.querySelector('nav button[data-v="train"]').click()`); await sleep(500);
    /* Замеры: число — счётчик соглядатая, спроси — JSON состояния. Промолчала
       страница — один повтор через 400 мс; пустота и ошибка контекста —
       «сбой» правила, а не краш прогона. */
    const число=async expr=>{ let r=await js(expr); if(typeof r!=='number'){ await sleep(400); r=await js(expr); } return r; };
    const спроси=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); }
      if(r==null||r==='') return {сбой:'не разобрать'}; if(typeof r==='object') return {сбой:String(r.__err||'не разобрать')};
      try{ return JSON.parse(r); }catch(e){ return {сбой:'не разобрать: '+String(r).slice(0,80)}; } };
    /* Соглядатаи вместо угадывания: считаем НАШИ обращения к аппаратуре.
       Разрешит ли headless-браузер блокировку экрана и услышит ли кто-то
       звук — не наше дело; наше дело их запросить. */
    await js(`(()=>{ window.__spy={wake:0,tone:0};
      try{ if(!navigator.wakeLock) navigator.wakeLock={request:null};
        navigator.wakeLock.request=()=>{ __spy.wake++;
          return Promise.resolve({release(){},addEventListener(){}}); };
      }catch(e){ window.__spyFail='wake: '+e.message }
      try{ const C=window.AudioContext||window.webkitAudioContext;
        const real=C.prototype.createOscillator;
        C.prototype.createOscillator=function(){ __spy.tone++; return real.apply(this,arguments); };
      }catch(e){ window.__spyFail=(window.__spyFail||'')+' tone: '+e.message }
      return 1 })()`);
    const spyOk=await js(`!window.__spyFail`);
    chk(spyOk===true,'соглядатаи таймера не встали ('+String(await js('window.__spyFail||""'))
      +') — проверка сигнала и блокировки экрана ничего не проверила');

    /* 1. Заморозка. Останавливаем тики так же, как это делает погасший экран,
          ждём три секунды и возвращаемся. Таймер обязан показать реальное
          оставшееся время, а не то, на котором его застали. */
    await js(`(()=>{ S.restMute=0; S.restNoWake=0; startRest(60); return 1 })()`);
    await sleep(300);
    const до=await js(`document.getElementById('restT').textContent`);
    await js(`clearInterval(restIv)`);                 // ровно то, что делает iOS
    await sleep(3200);
    await js(`resumeRest()`);
    const после=await js(`document.getElementById('restT').textContent`);
    const сек=t=>{ const m=String(t||'').split(':'); return (+m[0]||0)*60+(+m[1]||0); };
    const ушло=сек(до)-сек(после);
    chk(ушло>=3&&ушло<=5,'после заморозки экрана таймер показывает «'+после+'» вместо «'+до
      +'» минус три секунды (ушло '+ушло+') — он считает свои тики, а не время. '
      +'На телефоне JS замирает вместе с экраном, и такой таймер соврёт на всю паузу');

    /* 2. Блокировка экрана запрашивается на отдых и отпускается по «Пропустить». */
    /* Снимаем предыдущий отдых: блокировка экрана держится одна на таймер,
       и не отпустив её, мы измерили бы «повторный запрос», которого и не
       должно быть. Первая версия правила именно на это и налетела. */
    const wake1=await js(`(()=>{ stopRest(); __spy.wake=0; startRest(45); return __spy.wake })()`);
    chk(wake1>=1,'таймер не просит держать экран включённым — телефон погаснет посреди отдыха');
    const wakeOff2=await js(`(()=>{ stopRest(); return typeof _wake==='undefined'?'нет':(_wake===null?'снята':'ДЕРЖИТСЯ') })()`);
    chk(wakeOff2==='снята','после «Пропустить» блокировка экрана '+wakeOff2
      +' — подсветка останется гореть до конца тренировки');
    await js(`(function(){ S.restNoWake=1; __spy.wake=0; startRest(45); return 1 })()`);
    await sleep(120);
    const wakeOffCfg=await число(`__spy.wake`);
    await js(`(function(){ stopRest(); S.restNoWake=0; return 1 })()`);
    chk(wakeOffCfg===0,'выключатель «не гасить экран» снят, а блокировка всё равно запрошена ('
      +wakeOffCfg+') — настройка ничего не решает');

    /* 3. Сигнал: отсчёт последних трёх секунд и три тона в конце. Проверяем
          ВЫХОД — сколько тонов реально прозвучало, а не наличие функции. */
    await js(`(function(){ __spy.tone=0; S.restMute=0; startRest(3); return 1 })()`);
    await sleep(4200);                                   // ждём в Node, а не в странице
    const tones=await число(`__spy.tone`);
    chk(tones>=4,'за последние три секунды и финал прозвучало тонов: '+tones
      +' — человек не услышит, что отдых кончился');
    await js(`(function(){ S.restMute=1; __spy.tone=0; startRest(2); return 1 })()`);
    await sleep(3200);
    const muted=await число(`__spy.tone`);
    await js(`(function(){ S.restMute=0; return 1 })()`);
    chk(muted===0,'звук выключен в настройках, а таймер всё равно пикнул '+muted
      +' раз — в зале без наушников это чужая проблема');

    /* 4. Пауза не даёт времени утекать: подошли поговорить — отдых стоит. */
    await js(`(function(){ startRest(90); return 1 })()`);
    /* Пауза — тапом по настоящей кнопке, как палец */
    await js(`(document.getElementById('restPause')||{click(){}}).click()`); await sleep(100);
    const паузаА=await спроси(`(function(){ return JSON.stringify({a:document.getElementById('restT').textContent}) })()`);
    await sleep(2600);
    const паузаБ=await спроси(`(function(){ return JSON.stringify({b:document.getElementById('restT').textContent,
      кн:document.getElementById('restPause').textContent}) })()`);
    await js(`(document.getElementById('restPause')||{click(){}}).click()`);   // снять паузу, как человек
    await js(`(function(){ stopRest(); return 1 })()`);
    const пауза=(паузаА.сбой||паузаБ.сбой)?{сбой:паузаА.сбой||паузаБ.сбой}:{...паузаА,...паузаБ};
    { const o=пауза;
      chk(!o.сбой,'замер паузы таймера сорвался: '+o.сбой);
      if(!o.сбой){
        chk(o.a===o.b,'на паузе время утекает: было '+o.a+', стало '+o.b);
        chk(o.кн==='Пуск','кнопка паузы не переключилась на «Пуск» — не видно, что таймер стоит'); } }
    /* Вторая сторона паузы, и она важнее первой: остановилась не только
       ЦИФРА, но и сам отсчёт. Мутация M651 показала, что правило выше ловит
       лишь показания — таймер под ним продолжал считать и досчитал бы до
       сигнала, пока человек стоит на паузе и разговаривает. */
    await js(`(function(){ S.restMute=0; startRest(2); return 1 })()`);
    /* Тап по «Пауза» и обнуление счётчика — вместе: тон до паузы не в счёт */
    await js(`(function(){ (document.getElementById('restPause')||{click(){}}).click(); __spy.tone=0; return 1 })()`);
    await sleep(3400);
    const пауза2=await спроси(`(function(){ return JSON.stringify({on:document.getElementById('restBar').classList.contains('on'), t:__spy.tone}) })()`);
    await js(`(document.getElementById('restPause')||{click(){}}).click()`);   // снять паузу, как человек
    await js(`(function(){ stopRest(); return 1 })()`);
    { const o=пауза2;
      chk(!o.сбой,'замер отсчёта под паузой сорвался: '+o.сбой);
      if(!o.сбой){
        chk(o.on===true,'таймер стоял на паузе и всё равно закончился сам — отдых нельзя поставить на паузу');
        chk(o.t===0,'на паузе прозвучало тонов: '+o.t+' — таймер продолжает считать под паузой'); } }

    /* 5. v626: «+30» переехал на саму цифру. Тап по ней обязан добавить
          время и НЕ развернуть полосу на весь экран — иначе каждое добавление
          накрывает тренировку чёрным экраном. */
    const кнопки=await js(`(()=>{ startRest(60);
      document.getElementById('restBump').click();
      const big=document.getElementById('restBar').classList.contains('big');
      const t=document.getElementById('restT').textContent;
      const вспышка=document.getElementById('restBump').classList.contains('bump');
      stopRest(); return JSON.stringify({big,t,вспышка}); })()`);
    { const o=JSON.parse(кнопки||'{}');
      chk(o.big===false,'тап по цифре развернул таймер на весь экран — тренировка закрыта');
      chk(o.t==='1:30','тап по цифре дал «'+o.t+'» вместо 1:30');
      chk(o.вспышка===true,'тап по цифре не отвечает вспышкой — непонятно, засчитано или нет'); }

    /* 5а. v626: долгое нажатие по цифре заканчивает отдых, а короткое — нет.
          Жест настоящий: pointerdown → выдержка → pointerup, как палец.
          Проверяем обе стороны, потому что цена ошибки разная: не сработало —
          человек подержит ещё раз; сработало от обычного тапа — отдых
          погаснет молча посреди подхода. */
    const держать=async ms=>{
      /* Без звука: в headless у страницы нет касания, play() тишины
         отвергается, и полоса честно уходит в состояние «нажми — вернуть
         сигнал», где ПЕРВЫЙ тап возвращает звук, а не время. Здесь мы
         проверяем жест, а не это состояние. */
      await js(`(()=>{ S.restMute=1; startRest(60);
        const e=document.getElementById('restBump'), r=e.getBoundingClientRect();
        const o={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:1,pointerType:'touch'};
        window.__lpO=o; window.__lpE=restEndAt;
        e.dispatchEvent(new PointerEvent('pointerdown',o)); return 1 })()`);
      await sleep(ms);
      /* палец отпущен — и следом настоящий click, как его шлёт сам браузер:
         именно он проверяет, что после удержания тап не сработает вторым
         действием и не добавит тридцать секунд поверх окончания отдыха */
      return js(`(()=>{ const e=document.getElementById('restBump');
        e.dispatchEvent(new PointerEvent('pointerup',window.__lpO));
        e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        return JSON.stringify({идёт:restEndAt>0,добавлено:Math.round((restEndAt-window.__lpE)/1000)}); })()`);
    };
    { const коротко=JSON.parse(await держать(150)||'{}');
      chk(коротко.идёт===true,'обычное нажатие по цифре закончило отдых — таймер будет гаснуть сам посреди тренировки');
      chk(коротко.добавлено===30,'обычное нажатие по цифре дало '+коротко.добавлено+' с вместо 30');
      const долго=JSON.parse(await держать(750)||'{}');
      chk(долго.идёт===false,'долгое нажатие по цифре не закончило отдых — закончить его стало нечем');
      await js(`(()=>{ stopRest(); S.restMute=0; return 1 })()`); }

    /* 5б. ПОЛОСА ЦЕЛИКОМ ВЛЕЗАЕТ В ЭКРАН.
       Поймано моим же скриншотом 31.08 ещё до владельца: на 390 px крупная
       цифра и четыре кнопки со словами не поместились — «1:31» обрезано
       слева, «Пропустить» справа. Метрики «на глаз» этого не показывают,
       поэтому меряем на самом узком телефоне, который мы поддерживаем. */
    for(const w of [320,390]){
      await send('Emulation.setDeviceMetricsOverride',{width:w,height:844,deviceScaleFactor:2,mobile:true});
      await sleep(350);
      const ш=await js(`(()=>{ startRest(92);
        const b=document.getElementById('restBar'), br=b.getBoundingClientRect();
        const out=[];
        [...b.querySelectorAll('.num,button')].forEach(e=>{ const r=e.getBoundingClientRect();
          if(r.left<br.left-0.5||r.right>br.right+0.5)
            out.push('«'+(e.textContent||'').trim()+'» '+Math.round(r.left)+'..'+Math.round(r.right)); });
        const дет=b.scrollWidth-Math.round(br.width);
        stopRest(); return JSON.stringify({out,дет}); })()`);
      const o=JSON.parse(ш||'{}');
      chk((o.out||[]).length===0,'на '+w+' px полоса отдыха обрезает свои же элементы: '
        +(o.out||[]).join(' · ')+' — цифру и кнопку не прочитать');
      chk(o.дет<=1,'на '+w+' px содержимое полосы отдыха шире её самой на '+o.дет+' px');
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await sleep(300);

    /* 5в. v626: полоса едет ОДНОЙ композитной анимацией на весь остаток.
          Ширина остаётся 100 % и не трогается вовсе — иначе каждый тик
          пересчитывал бы раскладку полосы; едет только масштаб. */
    const анимация=await js(`(()=>{ startRest(60);
      const f=document.getElementById('restFill'), cs=getComputedStyle(f);
      const o={свойство:cs.transitionProperty,секунд:parseFloat(cs.transitionDuration),
        ширина:Math.round(parseFloat(cs.width)),полоса:Math.round(document.getElementById('restBar').getBoundingClientRect().width),
        цель:f.style.transform,инлайнШирина:f.style.width||''};
      stopRest(); return JSON.stringify(o); })()`);
    { const o=JSON.parse(анимация||'{}');
      chk(o.свойство==='transform','полоса отдыха анимируется не масштабом, а «'+o.свойство+'» — это работа для главного потока');
      chk(o.секунд>=55,'полоса отдыха едет перебежками по '+o.секунд+' с вместо одной анимации на весь остаток');
      chk(o.инлайнШирина==='','полосе отдыха снова пишут ширину в стиль: «'+o.инлайнШирина+'»');
      chk(Math.abs(o.ширина-o.полоса)<=1,'полоса отдыха шириной '+o.ширина+' px при полосе '+o.полоса+' px — масштаб считается от неверной базы');
      chk(/scaleX\(0\)/.test(o.цель||''),'полоса отдыха едет не в ноль, а в «'+o.цель+'»'); }

    /* 6. Полный экран — только руками, и цифра в нём читается через зал. */
    const полный=await js(`(()=>{ startRest(60); document.getElementById('restBar').click();
      const px=parseFloat(getComputedStyle(document.getElementById('restT')).fontSize);
      document.getElementById('restBar').click();
      const обратно=document.getElementById('restBar').classList.contains('big');
      stopRest(); return JSON.stringify({px,обратно}); })()`);
    { const o=JSON.parse(полный||'{}');
      chk(o.px>=80,'в развёрнутом таймере цифра '+Math.round(o.px)+' px — с двух метров не прочитать');
      chk(o.обратно===false,'из развёрнутого таймера не выйти тапом — тренировка останется закрытой'); }

    /* 7. Полоса переживает перерисовку экрана: записал подход — таймер на месте. */
    const живёт=await js(`(()=>{ startRest(75); renderAll();
      const on=document.getElementById('restBar').classList.contains('on');
      const t=document.getElementById('restT').textContent; stopRest();
      return JSON.stringify({on,t}); })()`);
    { const o=JSON.parse(живёт||'{}');
      chk(o.on===true&&o.t!=='','перерисовка экрана гасит таймер отдыха — записал подход и отсчёт пропал'); }

    /* 8. Истёк, пока экран был выключен, — сказать словами. Раньше полоса
          просто исчезала, и человек не знал, две минуты он отдыхал или семь. */
    const тихо=await js(`(()=>{ startRest(60); restEndAt=Date.now()-4000;
      try{ localStorage.setItem('restEndAt',String(restEndAt)); }catch(e){}
      resumeRest();
      const t=(document.getElementById('toast')||{}).textContent||'';
      return JSON.stringify({on:document.getElementById('restBar').classList.contains('on'),t:t.slice(0,60)}); })()`);
    { const o=JSON.parse(тихо||'{}');
      chk(o.on===false,'отдых истёк, пока экран был выключен, а полоса всё ещё висит');
      chk(/отдых/i.test(o.t),'вернулся после погасшего экрана — приложение молча убрало таймер, не сказав, что отдых кончился'); }

    /* 9. Фактический отдых попадает в запись подхода: он нужен прогрессии,
          а не отчёту. Подход после сорока секунд и после трёх минут —
          это разные подходы, и подсказка веса обязана их различать. */
    /* Имя упражнения и сегодняшние записи — синхронным замером; каждая
       запись в хранилище — свой короткий вызов, ответ ей не нужен, ошибка
       ложится в window.__фактСбой; две секунды между подходами ждём в Node;
       результат — снова синхронным замером. */
    const факт=await (async()=>{
      const имя=await спроси(`(function(){ try{
        const name=(S.prog&&S.prog.plan&&(S.prog.plan.find(d=>(d.ex||[]).some(e=>!e.hidden))||{}).ex||[])
          .filter(e=>!e.hidden)[0]; if(!name) return JSON.stringify({сбой:'нет упражнения'});
        const d=td(); window.__фактСбой='';
        return JSON.stringify({n:name.n,d,uids:SETS.filter(x=>x.d===d&&x.e===name.n).map(x=>x.uid)});
      }catch(e){ return JSON.stringify({сбой:'ERR '+e.message}) } })()`);
      if(имя.сбой) return String(имя.сбой);
      const N=JSON.stringify(имя.n), D=JSON.stringify(имя.d);
      const шаг=async code=>{ await js(`(async()=>{ try{ ${code} }catch(e){ window.__фактСбой=(window.__фактСбой||'')+' ERR '+e.message } return 1 })()`); };
      for(const uid of (имя.uids||[])) await шаг(`await del('sets',${JSON.stringify(uid)});`);
      await шаг(`SETS=await all('sets');`);
      await шаг(`await logWorkSet(${N},50,10,${D});`);
      await sleep(2100);
      await шаг(`await logWorkSet(${N},50,10,${D});`);
      await шаг(`SETS=await all('sets');`);
      await sleep(200);
      const o=await спроси(`(function(){ try{ const d=${D}, n=${N};
        const мои=SETS.filter(x=>x.d===d&&x.e===n&&!x.wu).sort((a,b)=>a.ua-b.ua);
        return JSON.stringify({подходов:мои.length, первыйБезОтдыха:мои[0]&&мои[0].rst==null,
          второй:мои[1]?мои[1].rst:null, сбой:window.__фактСбой||undefined});
      }catch(e){ return JSON.stringify({сбой:'ERR '+e.message}) } })()`);
      await js(`window.__фактСбой=null`);
      return o.сбой?String(o.сбой):o;
    })();
    { const o=(факт&&typeof факт==='object')?факт:null;
      chk(!!o,'проверка фактического отдыха не отработала: '+String(факт).slice(0,80));
      if(o){
        chk(o.первыйБезОтдыха===true,'первому подходу упражнения приписан отдых — отдыхать было не от чего');
        chk(o.второй>=2&&o.второй<=6,'фактический отдых между подходами записан как '+o.второй
          +' с вместо ~2 — прогрессия будет считать по выдуманной цифре'); }
    }
    await js(`(()=>{ stopRest(); S.restMute=0; S.restNoWake=0; return 1 })()`);
    await sleep(300); drain();
  }

  /* ── КАЖДОЕ ПОЛЕ КАЖДОГО ЛИСТА ОСТАЁТСЯ НА ВИДУ ПРИ НАСТОЯЩЕЙ КЛАВИАТУРЕ ──
     Полевой скриншот владельца 31.08: вводит бренд в «Добавить» — на экране
     одна кнопка «Добавить», само поле ушло за верхний край. Его вопрос
     справедлив: «почему не была проведена проверка?» Проверка была — правило
     выше, 390×420. Она не могла это поймать, и вот почему.
     `setDeviceMetricsOverride` ужимает БУМАЖНОЕ окно вместе с видимым, а
     настоящая клавиатура бумажное окно не трогает: остаётся 844 px разметки,
     из которых видно 500, и видимая область ещё и СДВИНУТА вниз на offsetTop.
     Именно на этом расхождении живёт весь класс: `inset:0` привязывает лист
     к бумажному окну, `scrollIntoView({block:'center'})` целится в его
     середину — оба «правильны» в эмуляции устройства и оба промахиваются
     на телефоне.
     Здесь мы включаем клавиатуру честно: окно 844, видно 498, сдвиг 200 —
     и тыкаем в КАЖДОЕ поле КАЖДОГО листа. До починки правило нашло
     20 полей в 17 листах; владелец видел одно из них.
     С 04.09 — по форме CRAFT: каждый переход (закрыть листы, открыть лист,
     фокус в поле) — отдельный короткий вызов и пауза в Node, замер —
     синхронный вызов с одним повтором, а не ответ одного длинного. */
  {
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await sleep(400);
    const жив=await js(`typeof __kbd==='function'`);
    chk(жив===true,'эмулятор клавиатуры не встал ('+String(await js('window.__kbdFail||"нет причины"'))
      +') — проверка полей при клавиатуре ничего не проверила');
    if(жив===true){
      const листы2=await js(`[...document.querySelectorAll('.sheet')].map(s=>s.id)`);
      const мимо=[];
      let проверено=0;
      /* Замер — синхронный вызов; промолчала страница — один повтор через
         400 мс, после него поле пропускается и считается в «молчало».
         Переход — отдельный короткий вызов и пауза в Node; на его ответ
         ни одна проверка не опирается. */
      let молчало=0; const сбои=[];
      const спроси=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); }
        if(typeof r!=='string'||!r){ молчало++; return null; } try{ return JSON.parse(r) }catch(e){ молчало++; return null } };
      for(const id of листы2||[]){
        /* Переход 1: закрыть открытые листы, убрать клавиатуру */
        await js(`(function(){ document.querySelectorAll('.sheet.on').forEach(x=>x.classList.remove('on','kb')); __kbd(0,0); return 1 })()`);
        await sleep(80);
        /* Переход 2: открыть лист. Кнопки «на каждый id» у листов нет —
           открываем функцией, как и раньше, — и раскрыть все details */
        await js(`(function(){ try{ sheet('${id}',true); }catch(e){ const s=document.getElementById('${id}'); if(s) s.classList.add('on'); }
          const s=document.getElementById('${id}'); if(s) s.querySelectorAll('details').forEach(d=>d.open=true); return 1 })()`);
        await sleep(350);
        /* Замер: видимые поля ввода листа */
        const поля=await спроси(`(function(){ try{ const s=document.getElementById('${id}'); if(!s) return JSON.stringify([]);
          return JSON.stringify([...s.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),textarea')]
            .filter(e=>e.getBoundingClientRect().height>0&&e.offsetParent!==null)
            .map((e,i)=>e.id||('__'+i)).filter(x=>x.indexOf('__')!==0)); }catch(e){ return JSON.stringify([]) } })()`);
        for(const fid of поля||[]){
          /* Переход 3: клавиатура убрана — потом фокус в поле и клавиатура
             поднята (346 px, сдвиг 200), как на телефоне */
          await js(`(function(){ __kbd(0,0); return 1 })()`); await sleep(80);
          await js(`(function(){ const s=document.getElementById('${id}'); const e=s&&s.querySelector('#'+CSS.escape(${JSON.stringify(fid)}));
            if(e){ e.focus(); __kbd(346,200); } return !!e })()`);
          await sleep(600);
          /* Замер: где поле относительно видимой области */
          const r=await спроси(`(function(){ try{
            const s=document.getElementById('${id}'), e=s&&s.querySelector('#'+CSS.escape(${JSON.stringify(fid)})); if(!e) return JSON.stringify({нет:1});
            const vv=visualViewport, top=vv.offsetTop, vh=vv.height, b=e.getBoundingClientRect();
            const inn=s.querySelector('.in'), ir=inn.getBoundingClientRect();
            const ттл=((inn.querySelector('h3')||{}).textContent||'').replace(/\\s+/g,' ').trim().slice(0,22);
            return JSON.stringify({ттл, ок:(b.top>=top-2&&b.bottom<=top+vh+2), y:Math.round(b.top),
              обл:Math.round(top)+'..'+Math.round(top+vh), панель:Math.round(ir.top)+'..'+Math.round(ir.bottom)});
          }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
          /* Переход 4: снять фокус */
          await js(`(function(){ const s=document.getElementById('${id}'); const e=s&&s.querySelector('#'+CSS.escape(${JSON.stringify(fid)})); if(e) e.blur(); return 1 })()`);
          if(!r||r.нет) continue;
          if(r.сбой){ сбои.push('${id}/'+fid+': '+r.сбой); continue; }
          проверено++;
          if(!r.ок) мимо.push('«'+r.ттл+'» → '+fid+': поле на '+r.y+', видно '+r.обл+', лист '+r.панель);
        }
      }
      chk(проверено>20,'при клавиатуре проверено всего '+проверено+' полей — правило смотрит в пустоту'
        +(молчало?' (страница промолчала '+молчало+' раз)':''));
      chk(!сбои.length,'замер поля при клавиатуре сорвался — '+сбои.length+' шт.: '+сбои.slice(0,3).join(' · '));
      chk(!мимо.length,'при настоящей клавиатуре (окно 844, видно 498, сдвиг 200) поле ввода уходит с экрана — '
        +мимо.length+' шт., человек видит только кнопку: '+мимо.slice(0,3).join(' · '));
      await js(`(()=>{ __kbd(0,0); document.querySelectorAll('.sheet.on').forEach(x=>x.classList.remove('on','kb')); return 1 })()`);
      await sleep(400); drain();
    }
  }

  /* ── ЗНАКОМСТВО ПРОХОДИТСЯ ЦЕЛИКОМ И ЗАКАНЧИВАЕТСЯ ПРОГРАММОЙ ──
     Смоук стережёт форму и подключение, но у него нет честного асинхронного
     хранилища: сборка программы и запись веса там не проверяются. Здесь —
     настоящий браузер и настоящая IndexedDB, поэтому идём путём человека:
     восемь ответов, потом смотрим, что получилось. Условия владельца
     (02.09): пропускаемое, после него — «Зал». С 04.09 — по форме CRAFT:
     каждый ответ — тапом из Node, каждый замер — коротким синхронным
     вызовом с одним повтором, а не один длинный вызов на весь путь. */
  {
    /* Замер — синхронный и короткий; промолчала страница — спрашиваем ещё
       раз. На ответ длинных вызовов (запись в хранилище) ни одна проверка
       не опирается. */
    const спросить=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); } return r; };
    /* Фикстура: ни программы, ни отметки о пройденном знакомстве — как у
       новичка. Программу назад не кладём нарочно: собрать её — предмет
       проверки; отметку ставим обратно в конце. */
    await js(`(function(){ try{ S.prog=null; S.onboardDone=0; onbShow(); return 1 }catch(e){ return 'ERR '+e.message } })()`);
    await sleep(800);
    const видно=await спросить(`(function(){const o=document.getElementById('onb');
      return !!(o&&getComputedStyle(o).display!=='none')})()`);
    chk(видно===true,'знакомство не открылось — новичок сразу попадает в приложение без плана');
    // отвечаем на все вопросы: выбором или значением по умолчанию —
    // каждый ответ отдельным тапом из Node, как палец; сначала смотрим,
    // какой вопрос на экране, потом жмём
    let шагов=0;
    for(let i=0;i<20;i++){
      const экран=await спросить(`(function(){ return JSON.stringify({q:!!document.querySelector('.onb-q'),
        num:!!document.getElementById('onbNum'), opt:!!document.querySelector('[data-onbv]')}) })()`);
      let э=null; try{ э=JSON.parse(экран) }catch(e){}
      if(!э||!э.q||!(э.num||э.opt)) break;
      if(э.num) await js(`(document.getElementById('onbNext')||{click(){}}).click()`);
      else await js(`(document.querySelector('[data-onbv]')||{click(){}}).click()`);
      шагов++; await sleep(150);
    }
    /* Последний ответ запускает сборку: «Собираю программу…», через 650 мс
       onbApply пишет вес и настройки в хранилище и рисует последний экран.
       Ждём в Node, а не внутри страницы. */
    await sleep(2300); drain();
    /* ── ПОСЛЕДНИЙ ЭКРАН ЗНАКОМСТВА ──
       Он обязан целиком помещаться в экран вместе с кнопкой: человек только
       что ответил на восемь вопросов, и просить его ещё и прокручивать —
       это ровно та воронка, за которую ругают конкурентов. Меряем ВЫХОД,
       а не количество строк в коде: шесть умений вместо четырёх сюда не
       влезают, и правило это увидит само. */
    const финал=await спросить(`(function(){
      const o=document.getElementById('onb');
      if(!o||getComputedStyle(o).display==='none') return JSON.stringify({нет:1});
      const in_=document.querySelector('.onb-in');
      const go=document.getElementById('onbGo');
      const gb=go?go.getBoundingClientRect():null;
      const sk=document.getElementById('onbSkip');
      return JSON.stringify({
        фактов:document.querySelectorAll('.onb-fx>div').length,
        умений:document.querySelectorAll('.can').length,
        текст:(document.querySelector('.onb-fx')||{textContent:''}).textContent,
        кнопка:go?go.textContent.trim():'',
        низ:gb?Math.round(gb.top+gb.height):0,
        высота:in_?Math.round(in_.scrollHeight):0,
        окно:Math.round(window.innerHeight),
        пропуск:!!(sk&&getComputedStyle(sk).display!=='none')});
    })()`);
    let ф={нет:1}; try{ if(typeof финал==='string'&&финал) ф=JSON.parse(финал) }catch(e){}
    chk(!ф.нет,'после восьми вопросов знакомство закрылось молча — человек не увидел ни что собралось, ни что приложение умеет');
    if(!ф.нет){
      chk(ф.фактов>=2,'на последнем экране '+ф.фактов+' строк фактов — «программа собрана» без цифр это лозунг');
      chk(/ккал/.test(ф.текст),'последний экран молчит про калории, хотя знакомство спрашивало пол, рост и вес ради них');
      chk(ф.умений>=3,'на последнем экране '+ф.умений+' умений — сказать о себе нечем');
      chk(!!ф.кнопка,'на последнем экране нет кнопки выхода — тупик после восьми вопросов');
      chk(ф.высота<=ф.окно+2,'последний экран знакомства не помещается: '+ф.высота+' px при экране '+ф.окно+' — за кнопкой надо прокручивать');
      chk(ф.низ>0&&ф.низ<=ф.окно,'кнопка с последнего экрана уехала за нижний край ('+ф.низ+' при '+ф.окно+')');
      chk(ф.пропуск===false,'на последнем экране осталась кнопка «Пропустить» — пропускать уже нечего');
      /* И она обязана работать: кнопка без обработчика выглядит так же. */
      await js(`(()=>{const b=document.getElementById('onbGo'); if(b)b.click(); return 1})()`);
      await sleep(900); drain();
    }
    const итог=await спросить(`(function(){
      const o=document.getElementById('onb');
      const v=document.querySelector('.view.on');
      const days=(S.prog&&S.prog.plan)?S.prog.plan.filter(d=>d.ex&&d.ex.length).length:0;
      return JSON.stringify({закрыто:!(o&&getComputedStyle(o).display!=='none'),
        вкладка:v?v.id:'?', дней:days, вес:(typeof curW==='function'?curW():0),
        пол:S.sex||'', готово:!!S.onboardDone,
        неполно:(typeof profileReady==='function'?profileReady().map(m=>m.k).join(','):'?')});
    })()`);
    let it=null; try{ if(typeof итог==='string'&&итог) it=JSON.parse(итог) }catch(e){}
    chk(шагов>=6,'знакомство закончилось за '+шагов+' шагов — вопросы не задаются');
    chk(!!it,'после знакомства не удалось прочитать состояние — проверка ничего не проверила');
    if(it){
      chk(it.закрыто===true,'знакомство не закрылось по кнопке с последнего экрана — человек застрял в нём');
      chk(it.дней>0,'восемь ответов не превратились в программу — ритуал есть, плана нет');
      chk(it.вес>0,'вес из знакомства не записан — первая точка графика потеряна');
      chk(!!it.пол,'ответы не легли в профиль — значит рядом с анкетой завели вторую');
      chk(it.готово===true,'знакомство не помечено пройденным — покажется снова');
      chk(it.вкладка==='v-train','после знакомства открылась вкладка «'+it.вкладка+'», а не «Зал»');
      chk(it.неполно==='','после знакомства профиль всё ещё неполный: '+it.неполно);
    }
    /* И пропуск: он обязан выпускать из знакомства, а не быть украшением.
       Открыть — отдельным вызовом, кнопку — увидеть, тап — по настоящей
       кнопке, «закрылось ли» — спросить потом. */
    await js(`(function(){ try{ S.onboardDone=0; onbShow(); return 1 }catch(e){ return 'ERR '+e.message } })()`);
    await sleep(300);
    const кнопкаПропуска=await спросить(`(function(){ const b=document.getElementById('onbSkip');
      return !!(b&&getComputedStyle(b).display!=='none') })()`);
    await js(`(function(){ const b=document.getElementById('onbSkip'); if(b) b.click(); return !!b })()`);
    await sleep(700);
    const закрытоПосле=await спросить(`(function(){ const o=document.getElementById('onb');
      return (o&&getComputedStyle(o).display!=='none')?'не закрылось':'закрылось' })()`);
    const пропуск=кнопкаПропуска!==true?'нет кнопки':(typeof закрытоПосле==='string'&&закрытоПосле?закрытоПосле:'не разобрать');
    chk(пропуск==='закрылось','«Пропустить» не выпускает из знакомства ('+пропуск+') — это тот самый незакрывающийся экран, за который ругают конкурентов');
    /* Отметку о пройденном знакомстве — обратно и в хранилище тоже; одна
       запись за вызов, на её ответ ничего не опирается. */
    await js(`(async()=>{ S.onboardDone=1; await put('settings',S,'main'); })()`);
    await sleep(400); drain();
    const отметка=await спросить(`(function(){ return S.onboardDone?1:0 })()`);
    chk(отметка===1,'после проверки знакомства отметка о пройденном не вернулась — оно выскочит в следующем правиле');
  }

  // 4. Простой режим ОБЯЗАН быть короче полного — именно на первых экранах.
  //    Считаем то, что видно человеку, а не то, что помечено в разметке.
  //    С 04.09 — по форме CRAFT: переход по вкладке — тапом из Node,
  //    каждый счёт — коротким синхронным вызовом с одним повтором.
  const snapshot=async()=>{
    const тап=async(v,ms)=>{ await js(`(document.querySelector('nav button[data-v="${v}"]')||{click(){}}).click()`); await sleep(ms); };
    const счёт=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); } return r; };
    const s={};
    s.режим=await счёт('document.documentElement.dataset.ui||"?"');
    s.вкладок=await счёт(`[...document.querySelectorAll('nav button')].filter(b=>b.offsetParent!==null).length`);
    /* С v513 «Коуч» разрезан: крупные карточки ушли в листы, чтиво — в
       настройки, база продуктов — в «Еду». Различие режимов здесь теперь —
       группы строк (.lst.pro «Отчёт тренеру»), считаем и их. */
    await тап('coach',400);
    /* Считаем ВИДИМЫЕ пункты, а не только крупные блоки (переписано 11.09).
       До v565 «Коуч» был набором карточек, и упрощение убирало карточки.
       После переделки раздел — один список, а простой режим прячет строки
       ВНУТРИ него: блоков и там и там по одному, и правило «полный больше
       простого» падало на исправном экране. Меряем то, что человек видит
       как отдельный пункт: блоки плюс строки списка плюс крупную кнопку. */
    s.коуч=await счёт(`[...document.querySelectorAll('#v-coach .card, #v-coach > details, #v-coach > .lst, #v-coach > .lst-h, #v-coach .coachlst > .lrow, #v-coach > .chero')].filter(c=>c.offsetParent!==null).length`);
    /* Считаем карточки И кнопки подвкладок: с v512 под тренировкой в обоих
       режимах одна и та же пара карточек («Закрыть тренировку» ушла в лист,
       активность — в «Разбор»), а различие режимов в «Зале» теперь живёт в
       ряду подвкладок — «Разбор» есть только в полном. */
    await тап('train',450);
    s.зал=await счёт(`(function(){ const vis=e=>e.offsetParent!==null&&getComputedStyle(e).display!=='none';
      return [...document.querySelectorAll('#v-train .card')].filter(vis).length
        +[...document.querySelectorAll('#v-train .seg button')].filter(vis).length })()`);
    /* ПУТЬ ДО ПЕРВОГО УПРАЖНЕНИЯ — в пикселях, а не в карточках.
       Полевой отчёт владельца 28.08: «за 4 скриншота даже до тренировки не
       дошёл». Замер до правки: 744 px — 0.83 экрана — и РОВНО СТОЛЬКО ЖЕ
       в простом режиме. Счёт карточек этого не ловил: карточек в простом
       было меньше, а прокрутки — столько же. Меряем то, что человек
       прокручивает большим пальцем. Разминка не считается упражнением:
       ищем карточку с шапкой .wc-h. Вкладка та же, что у счёта зала, —
       второй тап не нужен. */
    s.путь=await счёт(`(function(){ const v=document.querySelector('#v-train'); if(!v) return -1;
      const top=v.getBoundingClientRect().top;
      const c=[...v.querySelectorAll('.wc')].filter(e=>{const r=e.getBoundingClientRect();
        return r.height>0&&r.width>0&&e.querySelector('.wc-h');})[0];
      return c?Math.round(c.getBoundingClientRect().top-top):-1 })()`);
    /* Отладка замера (v611): что именно стоит над первой карточкой — печатается только под BVDBG. */
    if(process.env.BVDBG) console.log('   DBG путь: '+await js(`(function(){ const v=document.querySelector('#v-train'); const top=v.getBoundingClientRect().top;
      const dump=el=>[...el.children].filter(c=>c.getBoundingClientRect().height>0).map(c=>(c.id||String(c.className).slice(0,18))+'@'+Math.round(c.getBoundingClientRect().top-top)+'/'+Math.round(c.getBoundingClientRect().height));
      const wc=[...v.querySelectorAll('.wc')].filter(e=>e.getBoundingClientRect().height>0&&e.querySelector('.wc-h'))[0];
      return JSON.stringify({где:wc?(wc.closest('#nextBox')?'nextBox':wc.closest('#startBox')?'startBox':(wc.parentElement.id||wc.parentElement.className)):null,
        vtrain:dump(v), trlog:document.getElementById('tr-log')?dump(document.getElementById('tr-log')):null, nb:document.getElementById('nextBox')?dump(document.getElementById('nextBox')):null,
        card:document.querySelector('#nextBox .card.flat')?dump(document.querySelector('#nextBox .card.flat')).slice(0,7):null, vDay:(typeof vDay==='undefined')?'?':vDay, шапка:(document.querySelector('#nextBox .dhd')||{}).className}); })()`));
    /* Якорем был поиск внутри карточки — а он 27.08 переехал в закреплённую
       панель внизу, к большому пальцу. Карточка действий осталась на месте
       (.card.t), по ней и считаем: правило про «простой режим короче»
       должно мерить упрощение, а не искать конкретную кнопку. */
    await тап('food',400);
    /* v636: помощники «Еды» — чипы в листе записи; считаем видимые там (в простом
       режиме .pro скрыты и в листе). Лист открываем и закрываем сами. */
    s.едаКнопок=await счёт(`(function(){ const c=document.getElementById('eatChips');
      return c?[...c.querySelectorAll('button')].filter(b=>getComputedStyle(b).display!=='none').length:0 })()`);
    return s;
  };
  /* СЕГОДНЯ ОБЯЗАНО БЫТЬ ТРЕНИРОВОЧНЫМ ДНЁМ — ИНАЧЕ МЕРИТЬ НЕЧЕГО.
     Прогон 29.08 выпал на субботу. Программа на 3 дня в неделю честно
     показала выходной, карточек упражнений на экране не оказалось вовсе,
     и путь до первого упражнения замерился как -1: правило про «полэкрана
     до упражнения» молча ничего не проверило, а зелёный прогон соврал.
     Та же техника, что и на прошедшем дне: отдаём сегодняшнему дню недели
     один из дней программы, и замер перестаёт зависеть от календаря. */
  const деньЕсть=await js(`(function(){ try{
    if(!S.prog||!S.prog.plan||!S.prog.plan.length)
      S.prog=genProgram({days:3,equip:'gym',goal:'hyper',exp:'mid',inj:[],dows:[1,2,3,4,5,6,7]});
    const tw=dowOf(td()), P=S.prog;
    if(!P.plan.some(x=>x.dow===tw&&(x.ex||[]).some(e=>!e.hidden))){
      const d=P.plan.find(x=>(x.ex||[]).some(e=>!e.hidden))||P.plan[0];
      const занял=P.plan.find(x=>x.dow===tw); if(занял) занял.dow=d.dow;
      d.dow=tw;
    }
    delete S.dayMap; S.moveWk=null; renderAll(); return 1;
  }catch(e){ return 'ERR '+e.message } })()`);
  /* ── И ДЕНЬ ОБЯЗАН БЫТЬ ЕЩЁ НЕ НАЧАТЫМ ──
     С v495 у дня два состояния: до старта — заголовок дня, факты и кнопка
     «Начать тренировку»; после — имя, счёт и полоса. Мерить путь надо в
     ПЕРВОМ: он самый длинный (то есть худший случай для предела в полэкрана),
     и только в нём вообще есть содержимое, зависящее от режима. Прогон 01.09
     пришёл сюда с двумя записанными подходами от прошлых проверок, увидел
     сжатую шапку в обоих режимах и объявил, что простой режим не короче, —
     правило сравнивало два экрана, которые и не должны различаться.
     С 04.09 — по форме CRAFT: каждая запись в хранилище — отдельный короткий
     вызов, а сколько подходов осталось на сегодня, спрашиваем потом
     синхронно, с одним повтором, и на ответ записи не опираемся. */
  let деньЧист='не разобрать';
  {
    /* Замер — синхронный вызов; промолчала страница — один повтор через
       паузу. Исключение внутри страницы js() отдаёт как {__err} — это тоже
       сбой замера. */
    const замер=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); }
      if(r&&r.__err) return {сбой:r.__err};
      try{ return JSON.parse(r)||{сбой:'страница промолчала'} }catch(e){ return {сбой:'страница промолчала ('+JSON.stringify(r)+')'} } };
    /* Что удалять — читаем синхронно, ключи держим в Node */
    const сегодня=await замер(`JSON.stringify({sets:SETS.filter(x=>x.d===td()).map(s=>s.id),
      sess:(SESS||[]).filter(x=>x.d===td()).map(e=>e.id!=null?e.id:e.d)})`);
    if(сегодня.сбой) деньЧист='ERR '+сегодня.сбой;
    else{
      /* Одна запись за вызов; на её ответ ни одна проверка не опирается —
         сколько осталось, спрашиваем у состояния ниже */
      for(const id of сегодня.sets||[]) await js(`(async()=>{ try{ await del('sets',${JSON.stringify(id)}) }catch(e){} return 1 })()`);
      for(const id of сегодня.sess||[]) await js(`(async()=>{ try{ await del('sess',${JSON.stringify(id)}) }catch(e){} return 1 })()`);
      await js(`(async()=>{ try{ SETS=await all('sets') }catch(e){} return 1 })()`);
      await js(`(async()=>{ try{ SESS=await all('sess') }catch(e){} return 1 })()`);
      await js(`(function(){ renderAll(); return 1 })()`); await sleep(300);
      const после=await замер(`JSON.stringify({n:SETS.filter(x=>x.d===td()).length})`);
      деньЧист=после.сбой?'ERR '+после.сбой:после.n;
    }
  }
  await sleep(700); drain();
  chk(деньЧист===0,'не удалось очистить сегодняшние подходы ('+деньЧист+
    ') — путь мерился бы по сжатой шапке начатой тренировки, где режимы и не различаются');
  await sleep(900); drain();
  chk(деньЕсть===1,'не удалось сделать сегодня тренировочным днём ('+деньЕсть+
    ') — замер пути до упражнения смотрел бы на выходной');

  const simple=await snapshot(); drain();
  chk(simple.режим==='simple','чистая установка открылась не в простом режиме: '+simple.режим);

  // «Показать всё» — обязателен и обязан работать
  chk(await js(`[...document.querySelectorAll('[data-ui-full]')].some(b=>b.offsetParent!==null)`),
      'в простом режиме нет видимой кнопки «Показать всё» — экран урезан без выхода');
  await js(`(document.querySelector('[data-ui-full]')||{click(){}}).click()`);
  await sleep(1200); drain();
  const full=await snapshot(); drain();
  chk(full.режим==='pro','кнопка «Показать всё» не включила полный режим');
  /* Ярлык в настройках обязан говорить то же, что показывает экран — включая
     случай, когда режим выбрало САМО приложение (по данным), без переключателя
     и без applyTheme. Именно там ярлык и оставался прежним. С 04.09 — по
     форме CRAFT: каждый шаг фикстуры — отдельный короткий вызов, ярлык
     читается синхронно, с одним повтором, а не ответом одного длинного. */
  let lbl=null;
  {
    /* Замер — синхронный вызов; промолчала страница — один повтор через
       паузу. Шаг фикстуры — короткий вызов, чей ответ не нужен; исключение
       в нём — сбой проверки, а не «ярлык не совпал». */
    const замер=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); }
      if(r&&r.__err) return {сбой:r.__err};
      try{ return JSON.parse(r)||{сбой:'страница промолчала'} }catch(e){ return {сбой:'страница промолчала ('+JSON.stringify(r)+')'} } };
    const сбои=[];
    const шаг=async expr=>{ const r=await js(expr); if(r&&r.__err) сбои.push(r.__err); };
    const ЯРЛЫК=`JSON.stringify({mode:document.documentElement.dataset.ui||'?',label:(document.getElementById('uiSt')||{}).textContent||''})`;
    /* Фикстура: три взвешивания — история, по которой приложение выберет
       «полный»; пока что простой режим выбором человека — ярлык честно
       говорит «простой». W в памяти, как и раньше, остаётся до конца прогона. */
    await шаг(`(function(){ W=[{d:td(),kg:80},{d:td(),kg:80},{d:td(),kg:80}];
      S.ui='simple'; applyUI(); applyTheme(); return 1 })()`); await sleep(200);
    const до=await замер(ЯРЛЫК);
    chk(до.mode==='simple'&&/прост/i.test(String(до.label)),'фикстура ярлыка не встала (режим «'+до.mode+'», ярлык «'+(до.label||до.сбой)+'») — проверка ярлыка мерила бы не тот случай');
    /* Выбор снят — решает приложение, и по истории оно выбирает «полный» */
    await шаг(`(function(){ S.ui=null; delete S.uiAuto; applyUI(); return 1 })()`); await sleep(200);
    /* Настройки — вызовом, как и раньше: на пути замера у листа своей кнопки нет */
    await шаг(`(function(){ if(typeof openSet==='function') openSet(); return 1 })()`); await sleep(400);
    const л=await замер(ЯРЛЫК);
    if(л.сбой) сбои.push(л.сбой); else lbl=л;
    /* Откат: лист закрываем, как и раньше, снятием класса */
    await шаг(`(function(){ document.querySelectorAll('.sheet.on').forEach(x=>x.classList.remove('on')); return 1 })()`); await sleep(200);
    chk(!сбои.length,'проверка ярлыка режима сорвалась: '+сбои.join('; '));
  }
  chk(!!lbl&&((lbl.mode==='pro')===/полн/i.test(String(lbl.label))),
      'в настройках «Вид приложения» показывает «'+(lbl&&lbl.label)+'», а на экране режим «'+(lbl&&lbl.mode)+'»');

  chk(full.вкладок>simple.вкладок,'число вкладок в режимах одинаково ('+simple.вкладок+') — режим ничего не убрал');
  chk(full.коуч>simple.коуч,'Коуч одинаков в обоих режимах ('+simple.коуч+' блоков) — упрощение только на бумаге');
  /* v615: «Зал» одинаков в обоих режимах ПО ЗАМЫСЛУ — всё тяжёлое из него уехало
     («Разбор» был единственным отличием); упрощение меряется на «Коуче», «Еде» и вкладках. */
  chk(full.зал>=simple.зал,'в простом режиме «Зал» больше, чем в полном ('+simple.зал+' против '+full.зал+')');
  chk(full.едаКнопок>simple.едаКнопок,'Еда одинакова в обоих режимах ('+simple.едаКнопок+' кнопок) — упрощение только на бумаге');
  /* Путь до первого упражнения. Верхний предел — половина экрана (422 px при
     844): человек пришёл тренироваться, и то, ЧТО он делает, обязано быть
     видно без прокрутки. И простой режим не имеет права быть длиннее
     полного — до 28.08 они были в пиксель одинаковы. */
  chk(full.путь>0&&simple.путь>0,'путь до первого упражнения не измерен (полный '+full.путь+', простой '+simple.путь+') — проверка ничего не проверила');
  chk(full.путь<=422,'до первого упражнения в полном режиме '+full.путь+' px — больше половины экрана: человек пришёл тренироваться, а видит служебные блоки');
  /* Строго меньше, а не «не больше»: до 28.08 режимы были РАВНЫ в пиксель
     (744 и 744), и нестрогая проверка пропустила бы ровно ту поломку,
     ради которой написана. Равенство здесь — это и есть дефект. */
  chk(simple.путь<full.путь,'в простом режиме до первого упражнения '+simple.путь+' px против '+full.путь+' в полном — простой режим не короче');

  /* ── ЧТО ОБЯЗАНО БЫТЬ ВИДНО И В ПРОСТОМ РЕЖИМЕ (решение владельца 02.09) ──
     Обход 02.09 показал: 30 блоков живут только в полном режиме, и среди них
     были фото прогресса — они же месяц числились «не сделанными» в очереди
     именно потому, что их не видно. Решение: три вещи, которые не требуют
     понимания и отвечают на живой вопрос, видны всем. Правило меряет ВЫХОД
     в настоящем простом режиме: класс `pro`, поставленный обратно, гасит
     элемент, и замер это увидит. С 04.09 — в форме коротких вызовов: переход
     тапом из Node, замер синхронный, с одним повтором (CRAFT, 04.09). */
  {
    /* Переход — тапом по настоящей кнопке, как палец; замер — синхронный
       и короткий, промолчала страница — спрашиваем ещё раз. Исключение
       внутри страницы js() отдаёт как {__err} — это тоже сбой замера. */
    const вп={};
    const мера=async expr=>{
      let r; for(let i=0;i<2;i++){ r=await js(expr); if(r!=null&&r!=='') break; await sleep(400); }
      if(r&&r.__err){ вп.сбой=вп.сбой||r.__err; return {}; }
      try{ return JSON.parse(r) }catch(e){ вп.сбой=вп.сбой||'не разобрать'; return {}; }
    };
    const тап=async(sel,ms)=>{ await js(`(document.querySelector('${sel}')||{click(){}}).click()`); await sleep(ms); };
    const вид=`const вид=e=>!!(e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0);`;
    /* Фикстура: простой режим как выбор человека (uiAuto=0 — иначе applyUI
       по истории вернул бы полный). Что было — читаем ДО записи и в конце
       возвращаем целиком, включая uiAuto. */
    const было=await мера(`JSON.stringify({ui:S.ui,auto:S.uiAuto})`);
    await js(`(function(){ S.ui='simple'; S.uiAuto=0; applyUI(); renderAll(); return 1 })()`); await sleep(400);
    const режим=(await мера(`JSON.stringify({ui:document.documentElement.dataset.ui||'?'})`)).ui;
    chk(режим==='simple','простой режим для замера не включился (на экране «'+режим+'») — правило смотрело бы на полный экран, где видно всё');
    /* «Тело» → «Замеры»: карточка прогресс-фото */
    await тап('nav button[data-v="body"]',400);
    await тап('[data-bd="prg"]',400);
    Object.assign(вп,await мера(`(function(){ ${вид}
      return JSON.stringify({фотоК:[...document.querySelectorAll('#v-body .card')].filter(вид)
        .some(c=>/Прогресс-фото/.test((c.querySelector('h2')||{}).textContent||''))}); })()`));
    /* «Еда»: кнопка «Что съесть» и её ширина */
    await тап('nav button[data-v="food"]',400);
    /* v636: «Что съесть» живёт чипом в листе записи — открываем лист, меряем, закрываем */
    await js(`(function(){ try{ openFind(); }catch(e){} return 1 })()`); await sleep(500);
    Object.assign(вп,await мера(`(function(){ ${вид} const bm=document.getElementById('bMeal');
      return JSON.stringify({съесть:вид(bm),ширина:bm?Math.round(bm.getBoundingClientRect().width):0}); })()`));
    await js(`(function(){ try{ while(NAV.stack.length) navPop('code'); }catch(e){} return 1 })()`); await sleep(300);
    /* Готовность в простом режиме идёт пилюлей шапки, а не карточкой:
       замер 02.09 показал, что она там уже работает — пять быстрых ответов
       и объём режется. Стережём именно этот путь, а не карточку. */
    await тап('nav button[data-v="train"]',500);
    Object.assign(вп,await мера(`JSON.stringify({пил:[...document.querySelectorAll('.dhd-p button')].some(b=>/сегодня|готов/i.test(b.textContent||''))})`));
    /* Откат: режим и uiAuto — как были; выбора не было — снимаем, и applyUI
       решит по данным, как решал до нас. */
    await js(`(function(){ const б=${JSON.stringify(было)};
      if(б.ui==null) delete S.ui; else S.ui=б.ui;
      if(б.auto==null) delete S.uiAuto; else S.uiAuto=б.auto;
      applyUI(); renderAll(); return 1 })()`); await sleep(300);
    const назад=(await мера(`JSON.stringify({ui:document.documentElement.dataset.ui||'?'})`)).ui;
    chk(было.ui==null||назад===было.ui,'после замера режим не вернулся: был «'+было.ui+'», стал «'+назад+'» — следующие правила мерили бы не тот экран');
    chk(!вп.сбой,'замер простого режима сорвался: '+вп.сбой);
    if(!вп.сбой){
      chk(вп.фотоК===true,'прогресс-фото не видно в простом режиме — самая наглядная обратная связь снова спрятана за переключателем');
      chk(вп.съесть===true,'кнопки «Что съесть» нет в простом режиме — вопрос «осталось 600 ккал, что взять» остался без ответа');
      chk(вп.ширина>=44,'«Что съесть» в простом режиме шириной '+вп.ширина+' px — чип не влез (v636: чип, а не половинка сетки)');
      chk(вп.пил===true,'в простом режиме нет пилюли готовности — а именно она, а не карточка, режет объём');
    }
  }

  /* ── ЗАКОН ДВУХ ЭКРАНОВ (владелец, 03.09) ──
     «Максимум два экрана прокрутки на телефоне, всё остальное — внутри
     функций». Меряем высоту вкладки в полном режиме с данными против двух
     видимых областей (минус шапка и нижнее меню). Зал во время тренировки
     пока вне закона: 1822 px — сами упражнения, сворачивать сделанные —
     отдельное решение владельца. Коуч после разреза (v513) — под законом. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного:
       прогоны 04.09 дважды вернули «не разобрать» — контекст страницы
       иногда молчит на долгий async-вызов, и правило падало на ровном
       месте (CRAFT: «спрашивай состояние, а не ответ»). Переход по вкладке —
       тапом по нижнему меню, как палец; замер — синхронный, с одним
       повтором, если страница промолчала. */
    const d={};
    const видимо=await js(`innerHeight-64-88`);
    if(!(видимо>0)) d.сбой='окно не измерено ('+видимо+')';
    else for(const v of ['food','body','health','coach']){
      await js(`(document.querySelector('nav button[data-v="${v}"]')||{click(){}}).click()`); await sleep(500);
      let h=null;
      for(let i=0;i<2&&!(h>0);i++){ h=await js(`(function(){ const el=document.getElementById('v-${v}'); return el?Math.round(el.scrollHeight||el.getBoundingClientRect().height):0; })()`); if(!(h>0)) await sleep(400); }
      d[v]=h>0?Math.round(h/видимо*100)/100:0;
    }
    await js(`(document.querySelector('nav button[data-v="food"]')||{click(){}}).click()`); await sleep(300);
    chk(!d.сбой,'замер высоты вкладок сорвался: '+d.сбой);
    if(!d.сбой) for(const [v,n] of Object.entries(d)){
      chk(n>0,'высота вкладки «'+v+'» не измерена — проверка двух экранов ничего не проверила');
      chk(n<=2.05,'вкладка «'+v+'» — '+n+' экрана прокрутки при законе «не больше двух»: крупное должно жить внутри функций, а не на экране');
    }
    if(process.env.BVDBG) console.log('   DBG экранов прокрутки: '+JSON.stringify(d));
  }

  /* ── КРЕСТИК НА ПРЕДУПРЕЖДЕНИИ, С РАЗДЕЛЕНИЕМ ВРАЧА (03.09) ──
     Путь человека: на «Здоровье» с отмеченной болью стоит предупреждение
     «Болит не упражнение, а колено» с крестиком; тап — исчезло; перерисовка —
     не вернулось; наступил новый день — вернулось (врач: боль в суставе
     не убирается навсегда). Обычное предупреждение после крестика не
     возвращается и назавтра. С 04.09 — по форме CRAFT: переход тапом из
     Node, замер коротким синхронным вызовом, а не один длинный вызов. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного:
       длинный async-вызов на весь путь иногда возвращал «не разобрать» при
       исправном приложении. Каждый тап — отдельный вызов и пауза в Node;
       каждый замер — синхронный, с одним повтором, если страница промолчала;
       ответы складываются в d, сбой любого замера — в d.сбой. */
    const d={};
    const замер=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); }
      if(r&&r.__err){ d.сбой=(d.сбой?d.сбой+'; ':'')+r.__err; return; }
      let o=null; try{ o=JSON.parse(r) }catch(e){}
      if(!o){ d.сбой=(d.сбой?d.сбой+'; ':'')+'страница промолчала ('+JSON.stringify(r)+')'; return; }
      if(o.сбой) d.сбой=(d.сбой?d.сбой+'; ':'')+o.сбой; else Object.assign(d,o); };
    const ВИД=`const вид=e=>!!(e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0);`;
    const БОЛЬ=`[...document.querySelectorAll('#v-health .wb[data-med]')].find(e=>/Болит не упражнение/.test(e.textContent))`;
    /* v633: баннер «только на этом устройстве» переехал с экрана «Еда»
       в лист настроек, а крестики по замыслу ставятся ТОЛЬКО на экранах
       (в листах их нет и не было). Значит на нём ветку «убрать насовсем»
       больше не проверить — и это не потеря правила, а переезд: ветку
       проверяем на другом обычном предупреждении, которое осталось на
       экране, — «планируешь наперёд» на завтрашнем дне «Еды». Что баннер
       ушёл с главного экрана, стережёт правило v633 в смоуке. */
    const ОБ=`[...document.querySelectorAll('#v-food .ib, #v-food .wb')].find(e=>/Планируешь наперёд/.test(e.textContent))`;
    const ЗАВТРА=`(function(){ try{ vDate=ds(dn(td())+1); rFood(); }catch(e){} return 1 })()`;
    const СЕГОДНЯ=`(function(){ try{ vDate=null; rFood(); }catch(e){} return 1 })()`;
    /* Фикстура: две боли на одном суставе и пустой список убранного. Прежнее
       состояние — в window.__disWas, вернём в конце. */
    await js(`(function(){ try{ window.__disWas={pain:S.pain,dis:S.dis};
      S.pain={'Выпады':{d:td(),n:'Выпады'},'Сисси-присед':{d:td(),n:'Сисси-присед'}}; S.dis={};
      renderAll(); return 1 }catch(e){ return 'ERR '+e.message } })()`);
    await sleep(200);
    await js(`(document.querySelector('nav button[data-v="health"]')||{click(){}}).click()`); await sleep(500);
    await замер(`(function(){ try{ ${ВИД} const el=${БОЛЬ};
      return JSON.stringify({фикстура:Object.keys(S.pain||{}).length===2&&!Object.keys(S.dis||{}).length&&!!document.querySelector('#v-health.on'),
        было:вид(el),крест:!!(el&&el.querySelector('.dis-x'))}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Тап по крестику — по настоящей кнопке, как палец */
    await js(`(function(){ const el=${БОЛЬ}; const x=el&&el.querySelector('.dis-x'); if(x) x.click(); return !!x })()`); await sleep(200);
    await замер(`(function(){ try{ ${ВИД} return JSON.stringify({скрыто:!вид(${БОЛЬ})}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Перерисовка — как после любой записи: renderAll и снова та же вкладка */
    await js(`(function(){ renderAll(); return 1 })()`);
    await js(`(document.querySelector('nav button[data-v="health"]')||{click(){}}).click()`); await sleep(400);
    await замер(`(function(){ try{ ${ВИД} return JSON.stringify({послеПерерисовки:!вид(${БОЛЬ})}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Новый день: ключ врача хранит дату — сдвигаем на вчера */
    await js(`(function(){ Object.keys(S.dis||{}).forEach(k=>{ if(k.startsWith('med:')) S.dis[k]=ds(dn(td())-1); }); renderAll(); return 1 })()`);
    await js(`(document.querySelector('nav button[data-v="health"]')||{click(){}}).click()`); await sleep(400);
    await замер(`(function(){ try{ ${ВИД} return JSON.stringify({назавтра:вид(${БОЛЬ})}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Обычное предупреждение на экране: «Планируешь наперёд» на завтрашнем дне */
    await js(`(document.querySelector('nav button[data-v="food"]')||{click(){}}).click()`); await sleep(400);
    await js(ЗАВТРА); await sleep(500);
    await замер(`(function(){ try{ ${ВИД} const об=${ОБ};
      return JSON.stringify({обВидно:вид(об),обКрест:!!(об&&об.querySelector('.dis-x')),
        баннерНаЭкране:/только на этом устройстве/.test((document.getElementById('v-food')||{textContent:''}).textContent)}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    await js(`(function(){ const об=${ОБ}; const x=об&&об.querySelector('.dis-x'); if(x) x.click(); return !!x })()`); await sleep(200);
    /* «Назавтра» для обычного: его ключ «*», дата его не трогает */
    await js(`(function(){ Object.keys(S.dis||{}).forEach(k=>{ if(!k.startsWith('med:')&&S.dis[k]!=='*') S.dis[k]=ds(dn(td())-1); }); renderAll(); return 1 })()`);
    await js(ЗАВТРА); await sleep(500);
    await замер(`(function(){ try{ ${ВИД} return JSON.stringify({обНазавтра:вид(${ОБ})}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    await js(СЕГОДНЯ); await sleep(300);
    /* Крестик пишет настройки в хранилище — восстанавливаем и ТАМ тоже,
       иначе перезагрузка без сети ниже поднимет боль и «убранное» обратно
       и «Первые две недели» уступит место «Сообщениям тренера». Одна запись
       за вызов; на её ответ ни одна проверка не опирается. */
    await js(`(async()=>{ try{ const w=window.__disWas; if(w){ S.pain=w.pain; S.dis=w.dis||{}; window.__disWas=null;
      await put('settings',S,'main'); renderAll(); } }catch(e){} return 1 })()`);
    await sleep(300);
    await js(`(document.querySelector('nav button[data-v="food"]')||{click(){}}).click()`); await sleep(300);
    chk(!d.сбой,'замер крестиков сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.фикстура===true,'фикстура крестика не встала (две боли, пустой список убранного, вкладка «Здоровье») — проверка крестика ничего не проверила');
      chk(d.было===true,'предупреждение о боли не показалось на «Здоровье» — проверка крестика ничего не проверила');
      chk(d.крест===true,'у предупреждения о боли нет крестика — убрать его нечем');
      chk(d.скрыто===true&&d.послеПерерисовки===true,'крестик не убирает предупреждение или оно возвращается перерисовкой');
      chk(d.назавтра===true,'предупреждение врача не вернулось на следующий день — разделение врача не выполнено: боль в суставе нельзя убрать навсегда');
      chk(d.обВидно===true,'обычное предупреждение «планируешь наперёд» не показалось на завтрашнем дне — проверка крестика ничего не проверила');
      chk(d.обКрест===true,'у обычного предупреждения на «Еде» нет крестика');
      chk(d.баннерНаЭкране===false,'баннер «данные только на этом устройстве» снова на экране «Еда» — его место в настройках (v633)');
      chk(d.обНазавтра===false,'обычное предупреждение вернулось назавтра после крестика — «насовсем» не насовсем');
    }
    if(process.env.BVDBG) console.log('   DBG крестики: '+JSON.stringify(d));
  }

  /* ── «ЗАКРЫТЬ ТРЕНИРОВКУ» — ИЗ ШАПКИ, ЛИСТОМ (закон двух экранов, 03.09) ──
     Замер: карточка стояла 316 px под тренировкой, нужна три секунды в день.
     Меряем путь человека: в шапке начатой тренировки есть кнопка, тап
     открывает лист с полем тяжести, а под тренировкой карточки больше нет.
     С 04.09 — по форме CRAFT: переход тапом из Node, замер коротким
     синхронным вызовом с одним повтором, а не ответ одного длинного. */
  {
    /* Замер — синхронный вызов; промолчала страница — один повтор через
       400 мс. Ответ разбираем сами: пустота и ошибка контекста — «сбой»
       правила, а не краш прогона. */
    const спроси=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); }
      if(r==null||r==='') return {сбой:'не разобрать'}; if(typeof r==='object') return {сбой:String(r.__err||'не разобрать')};
      try{ return JSON.parse(r); }catch(e){ return {сбой:'не разобрать: '+r}; } };
    /* Переход: вкладка «Зал» — тапом по нижнему меню, как палец. */
    await js(`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`); await sleep(400);
    /* Фикстура: день обязан быть начат. Кнопка «Начать тренировку» (или
       «Перенести сюда» снята в v614) есть только до старта — жмём её, если она есть. */
    await js(`(function(){ const b=[...document.querySelectorAll('#tr-log button')].find(x=>/Начать тренировку/.test(x.textContent)); if(b) b.click(); return !!b; })()`); await sleep(600);
    /* Замер 1: шапка начатой тренировки, кнопка в ней, карточки под тренировкой нет. */
    const шапка=await спроси(`(function(){ try{
      const вид=e=>!!(e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0);
      return JSON.stringify({начата:!!document.querySelector('#nextBox .dhd.go'), кнопка:вид(document.getElementById('wEnd')),
        карточка:[...document.querySelectorAll('#tr-log .card h2')].some(h=>/Закрыть тренировку/.test(h.textContent))});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Переход: тап по «Закрыть тренировку» в шапке. */
    await js(`(document.getElementById('wEnd')||{click(){}}).click()`); await sleep(500);
    /* Замер 2: лист открыт, в нём поле тяжести. */
    const лист=await спроси(`(function(){ try{
      const вид=e=>!!(e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0);
      const л=document.getElementById('sh-sess');
      return JSON.stringify({открыт:!!(л&&л.classList.contains('on')), поле:вид(document.getElementById('ss_rpe'))});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Чистим: закрываем лист крестиком, как человек. */
    await js(`(function(){ const л=document.getElementById('sh-sess'); const x=л&&л.querySelector('[data-close]'); if(x) x.click(); return !!x; })()`); await sleep(300);
    const d={...шапка,...лист,сбой:шапка.сбой||лист.сбой};
    chk(!d.сбой,'замер «закрыть тренировку» сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.начата===true,'тренировка не началась — шапки начатого дня нет, проверка «закрыть тренировку» ничего не проверила');
      chk(d.кнопка===true,'в шапке начатой тренировки нет кнопки «Закрыть тренировку» — закрыть сессию нечем');
      chk(d.карточка===false,'карточка «Закрыть тренировку» снова стоит под тренировкой — 316 px ради трёх секунд в день');
      chk(d.открыт===true&&d.поле===true,'тап по «Закрыть тренировку» не открыл лист с полем тяжести ('+(d.открыт?'лист есть, поля нет':'лист не открылся')+')');
    }
  }

  /* ── СДЕЛАННОЕ УПРАЖНЕНИЕ СВОРАЧИВАЕТСЯ В СТРОКУ (решение владельца 03.09, v514) ──
     Путь человека: записал все подходы по плану — карточка стала тусклой
     строкой «Название · 3 из 3 ✓»; тап по строке — раскрылась целиком, внизу
     «Свернуть»; тап по «Свернуть» — снова строка. Правило жмёт, а не двигает
     wcKeep руками: подмена data-wcopen (M781) проходила мимо смоука.
     С 04.09 — в форме коротких вызовов: тап из Node, замер синхронный. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного
       (CRAFT 04.09): каждый тап — отдельный вызов из Node и пауза, каждый
       замер — синхронный, с одним повтором, если страница промолчала.
       Фикстура — подходы в памяти (SETS) с метками id «m0…», как и раньше;
       снимок «было» между вызовами не живёт, поэтому убираем по метке. */
    const d={};
    const спроси=async expr=>{
      let r=await js(expr); if(r===undefined||r===null||r===''){ await sleep(400); r=await js(expr); }
      if(r&&r.__err) return {сбой:r.__err};
      if(typeof r!=='string') return {сбой:'не разобрать'};
      try{ return JSON.parse(r) }catch(e){ return {сбой:'не разобрать: '+r} }
    };
    const шаг=async expr=>{ const r=await спроси(expr); if(r.сбой){ if(!d.сбой) d.сбой=r.сбой; } else Object.assign(d,r); };
    /* Тап или запись: ответ не нужен, но исключение на пути человека — это сбой. */
    const тап=async expr=>{ const r=await js(expr); if(r&&r.__err&&!d.сбой) d.сбой=r.__err; };
    /* Общая шапка каждого вызова в странице: имя и план — из Node, помощники — как были. */
    const шапка=()=>`const name=${JSON.stringify(d.name||'')}, план=${+d.план||0};
      const вид=e=>!!(e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0);
      const строка=()=>[...document.querySelectorAll('#nextBox .wc.wc-done')].find(e=>e.dataset.wcopen===name);
      const свернуть=()=>[...document.querySelectorAll('#nextBox [data-wcclose]')].find(e=>e.dataset.wcclose===name);`;
    /* Вкладка «Зал» и начатая тренировка — тапом, как палец. */
    await тап(`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`); await sleep(400);
    await тап(`(function(){ const b=[...document.querySelectorAll('#tr-log button')].find(x=>/Начать тренировку/.test(x.textContent)); if(b) b.click(); return !!b; })()`); await sleep(600);
    /* Имя — из плана, а не из текста карточки: в .wc-n к имени приклеен
       бейдж «база», и подходы уехали бы к несуществующему движению. */
    await шаг(`(function(){
      const dw=typeof effDow==='function'?effDow(td()):dowOf(td());
      const day=(S.prog&&S.prog.plan||[]).find(x=>x.dow===dw)||{};
      const item=(day.ex||[]).find(e=>!e.hidden&&(+e.sets||0)>0);
      return JSON.stringify(item?{name:item.n,план:+item.sets}:{сбой:'в плане дня нет упражнения с планом подходов'}); })()`);
    /* Фикстура: все подходы по плану — в память, как записал бы человек; одна запись за вызов. */
    if(!d.сбой){
      await тап(`(function(){ ${шапка()} const D0=td();
        for(let i=0;i<план;i++) SETS.push({d:D0,e:name,w:40,r:8,ua:Date.now()+i,id:'m'+i});
        if(typeof wcKeep!=='undefined') wcKeep.clear(); rNext(); return 1; })()`);
      await sleep(300);
    }
    /* Замер 1: строка на месте, в ней счёт. Заодно — что фикстура взялась. */
    if(!d.сбой) await шаг(`(function(){ ${шапка()} const s=строка();
      return JSON.stringify({записано:SETS.filter(x=>x.d===td()&&x.e===name).length,
        свернулось:вид(s), счёт:!!(s&&new RegExp(план+' из '+план).test(s.textContent))}); })()`);
    /* Тап по строке — раскрыть. */
    if(!d.сбой){ await тап(`(function(){ ${шапка()} const s=строка(); if(s) s.click(); return !!s; })()`); await sleep(300); }
    /* Замер 2: раскрылось, внизу «Свернуть». В раскрытой карточке к имени
       приклеен бейдж («база»), поэтому — по началу строки. */
    if(!d.сбой) await шаг(`(function(){ ${шапка()}
      const раскрылось=!строка()&&[...document.querySelectorAll('#nextBox .wc:not(.wc-done) .wc-n')].some(e=>e.textContent.trim().startsWith(name));
      return JSON.stringify({раскрылось, ссылка:вид(свернуть())}); })()`);
    /* Тап по «Свернуть». */
    if(!d.сбой){ await тап(`(function(){ ${шапка()} const св=свернуть(); if(св) св.click(); return !!св; })()`); await sleep(300); }
    /* Замер 3: снова строка. */
    if(!d.сбой) await шаг(`(function(){ ${шапка()} return JSON.stringify({снова:вид(строка())}); })()`);
    /* Уборка — всегда, и после сбоя тоже: подходы фикстуры по метке id, wcKeep, перерисовка. */
    await тап(`(function(){ for(let i=SETS.length-1;i>=0;i--) if(typeof SETS[i].id==='string'&&/^m\\d+$/.test(SETS[i].id)) SETS.splice(i,1);
      if(typeof wcKeep!=='undefined') wcKeep.clear(); rNext(); return 1; })()`);
    await sleep(300);
    chk(!d.сбой,'замер сворачивания сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.записано>=d.план,'фикстура сворачивания не задалась: в памяти '+d.записано+' подходов «'+d.name+'» при плане '+d.план);
      chk(d.свернулось===true,'упражнение «'+d.name+'» с '+d.план+'/'+d.план+' подходами не свернулось в строку — экран тренировки растёт на каждое сделанное');
      chk(d.счёт===true,'в свёрнутой строке нет счёта «'+d.план+' из '+d.план+'»');
      chk(d.раскрылось===true,'тап по свёрнутой строке не раскрыл упражнение');
      chk(d.ссылка===true,'в раскрытом сделанном упражнении нет «Свернуть»');
      chk(d.снова===true,'тап по «Свернуть» не свернул упражнение обратно');
    }
  }

  /* ── «ЕЩЁ ПОДХОД» — РОВНО ОДИН РЯД (владелец 04.09, v515) ──
     Полевой отчёт: «ставлю дополнительный подход — он потом каждый раз
     формирует ещё подход, и я не могу ни удалить, ни закрыть». Путь
     человека: раскрыл сделанное → «+ ещё подход» → ряд ввода → записал
     галочкой → карточка свернулась «3 из 3 +1» → раскрыл снова → ряда нет,
     есть кнопка. Подходы пишутся в хранилище настоящей галочкой, потому что
     запись идёт через logWorkSet и перечитывает хранилище.
     С 04.09 — в форме коротких вызовов: переход тапом из Node, замер
     синхронно, с одним повтором, если страница промолчала. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного
       (CRAFT 04.09): каждый тап — отдельный вызов из Node и пауза, каждый
       замер — синхронный вызов, читающий текущий DOM, с одним повтором,
       если страница промолчала; запись в хранилище — по одному шагу на
       вызов, и состояние после неё спрашивается отдельно. Ответ
       async-вызова для chk не используется. */
    const d={};
    const спросить=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); } return r; };
    const замер=async expr=>{ const r=await спросить(expr); let o;
      if(r&&r.__err) o={сбой:r.__err}; else { try{ o=JSON.parse(r); }catch(e){ o={сбой:'не разобрать'}; } }
      if(o&&o.сбой) d.сбой=d.сбой||o.сбой; else Object.assign(d,o||{}); };
    /* Переход — тапом по нижнему меню, как палец; тренировка — кнопкой шапки. */
    await js(`(function(){ const b=document.querySelector('nav button[data-v="train"]'); if(b) b.click(); else goView('train'); })()`); await sleep(400);
    await js(`(function(){ const b=[...document.querySelectorAll('#tr-log button')].find(x=>/Начать тренировку/.test(x.textContent)); if(b) b.click(); return !!b })()`); await sleep(600);
    /* Имя — из плана, а не из текста карточки: в .wc-n к имени приклеен бейдж «база». */
    await замер(`(function(){ const dw=typeof effDow==='function'?effDow(td()):dowOf(td());
      const day=(S.prog&&S.prog.plan||[]).find(x=>x.dow===dw)||{};
      const item=(day.ex||[]).find(e=>!e.hidden&&(+e.sets||0)>0);
      if(!item) return JSON.stringify({сбой:'в плане дня нет упражнения с планом подходов'});
      return JSON.stringify({name:item.n,sets:+item.sets,D0:td(),было:(SETS||[]).map(s=>s.id)}) })()`);
    if(!d.сбой){
      const NAME=JSON.stringify(d.name), D0=JSON.stringify(d.D0), БЫЛО=JSON.stringify(d.было);
      /* Общие куски замера вставляются в каждый вызов целиком — вызов самодостаточен. */
      const ВИД=`const вид=e=>!!(e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0);`;
      const СТРОКА=`const строка=[...document.querySelectorAll('#nextBox .wc.wc-done')].find(e=>e.dataset.wcopen===${NAME});`;
      const КАРТОЧКА=`const к=[...document.querySelectorAll('#nextBox .wc:not(.wc-done)')].find(c=>((c.querySelector('.wc-n')||{}).textContent||'').trim().startsWith(${NAME})); const wi=к&&к.querySelector('input.wi[id^="wkg_"]'), ri=к&&к.querySelector('input.wi[id^="wrep_"]');`;
      const КНОПКА=`const кн=[...document.querySelectorAll('#nextBox [data-extraset]')].find(x=>x.dataset.extraset===${NAME});`;
      /* Фикстура: план подходов в хранилище — по одному подходу на вызов, потом перечитать и перерисовать. */
      for(let i=0;i<d.sets;i++) await js(`(async()=>{ await put('sets',{d:${D0},e:${NAME},w:40,r:8,ua:Date.now()+${i}}); })()`);
      await js(`(async()=>{ SETS=await all('sets'); wcKeep.clear(); extraSet.clear(); rNext(); })()`); await sleep(300);
      /* план по ЭКРАНУ: срез готовности мог уменьшить sets — читаем строку, а не план */
      await замер(`(function(){ ${ВИД}${СТРОКА} const было=new Set(${БЫЛО});
        const m=/(\\d+) из (\\d+)/.exec((строка||{}).textContent||'');
        return JSON.stringify({записано:(SETS||[]).filter(s=>!было.has(s.id)).length,свернулось:вид(строка),план:m?+m[2]:${d.sets}}) })()`);
      const план=d.план||d.sets;
      await js(`(function(){ ${СТРОКА} if(строка) строка.click(); })()`); await sleep(300);
      await замер(`(function(){ ${ВИД}${КНОПКА} return JSON.stringify({кнопка:вид(кн)}) })()`);
      await js(`(function(){ ${КНОПКА} if(кн) кн.click(); })()`); await sleep(300);
      await замер(`(function(){ ${ВИД}${КАРТОЧКА} return JSON.stringify({ряд:вид(wi)}) })()`);
      /* 30 кг, не 41: вес выше сорока стал бы личным рекордом, а рекорд
         вибрирует — без настоящего тапа Chrome пишет об этом в консоль, и
         правило «консоль чиста» ругалось бы на вибрацию, а не на подход. */
      await js(`(function(){ ${КАРТОЧКА} if(wi&&ri){ wi.value='30'; ri.value='8'; const g=к.querySelector('[data-add]'); if(g) g.click(); } })()`); await sleep(1200);
      await замер(`(function(){ ${ВИД}${СТРОКА}
        return JSON.stringify({свернулосьСнова:вид(строка),счёт:!!(строка&&new RegExp(${план}+' из '+${план}+' \\\\+1').test(строка.textContent))}) })()`);
      await js(`(function(){ ${СТРОКА} if(строка) строка.click(); })()`); await sleep(300);
      await замер(`(function(){ ${ВИД}${КАРТОЧКА}${КНОПКА} return JSON.stringify({рядВернулся:вид(wi),кнопкаСнова:вид(кн)}) })()`);
      /* чистим за собой в хранилище: всё, чего не было до фикстуры, — по одному удалению на вызов, потом перечитать и перерисовать */
      const лишние=await спросить(`(function(){ const было=new Set(${БЫЛО}); return JSON.stringify((SETS||[]).filter(s=>!было.has(s.id)).map(s=>s.id)) })()`);
      for(const id of (typeof лишние==='string'?JSON.parse(лишние):[])) await js(`(async()=>{ await del('sets',${JSON.stringify(id)},true); })()`);
      await js(`(async()=>{ SETS=await all('sets'); wcKeep.clear(); extraSet.clear(); rNext(); })()`); await sleep(300);
      const остаток=await спросить(`(function(){ const было=new Set(${БЫЛО}); return (SETS||[]).filter(s=>!было.has(s.id)).length })()`);
      chk(остаток===0,'фикстура «ещё подход» не убрана за собой: в хранилище осталось '+остаток+' чужих подходов — следующие правила меряют не своё');
    }
    chk(!d.сбой,'замер «ещё подход» сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.записано===d.sets,'фикстура «ещё подход» не легла в хранилище: '+d.записано+' из '+d.sets+' подходов');
      chk(d.свернулось===true&&d.кнопка===true,'фикстура «ещё подход» не задалась: строка '+d.свернулось+', кнопка '+d.кнопка);
      chk(d.ряд===true,'тап по «+ ещё подход» не дал ряда ввода');
      chk(d.свернулосьСнова===true,'после записи дополнительного подхода карточка «'+d.name+'» не свернулась — «ещё подход» стал вечным');
      chk(d.счёт===true,'в свёрнутой строке после доп. подхода нет счёта «'+d.план+' из '+d.план+' +1»');
      chk(d.рядВернулся===false,'раскрыл после доп. подхода — ряд ввода снова на месте: система добавляет подход сама');
      chk(d.кнопкаСнова===true,'раскрыл после доп. подхода — кнопки «+ ещё подход» нет, следующий сверх плана не добавить');
    }
    if(process.env.BVDBG) console.log('   DBG ещё подход: '+JSON.stringify(d));
  }

  /* ── СОСТОЯНИЕ «ПОСЛЕ»: ЗАКРЫЛ ТРЕНИРОВКУ — ШАПКА СТАЛА ИТОГОМ (v515) ──
     Путь человека: «Закрыть тренировку» → лист → время и тяжесть → «Записать
     нагрузку». Шапка: «Сделано · 52 мин · N подходов», входы «Разбор
     тренировки» и «Тяжесть 7 · править», пилюль нет; тап по «Разбор
     тренировки» открывает лист разбора. С 04.09 — по форме коротких вызовов:
     переход тапом из Node, замер синхронно с одним повтором. */
  {
    const d={};
    /* Замер: короткий синхронный вызов, ответ — строка JSON; промолчала
       страница — один повтор через 400 мс. */
    const спроси=async expr=>{ let r=null;
      for(let i=0;i<2&&typeof r!=='string';i++){ r=await js(expr); if(typeof r!=='string') await sleep(400); }
      return typeof r==='string'?JSON.parse(r):{сбой:'не разобрать'+(r&&r.__err?' ('+r.__err+')':'')}; };
    await js(`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`); await sleep(400);
    await js(`(function(){ const b=[...document.querySelectorAll('#tr-log button')].find(x=>/Начать тренировку/.test(x.textContent)); if(b) b.click(); return !!b; })()`); await sleep(600);
    const кн=await спроси(`JSON.stringify({есть:!!document.getElementById('wEnd')})`);
    if(кн.сбой) d.сбой=кн.сбой; else if(кн.есть!==true) d.сбой='нет кнопки закрытия';
    if(!d.сбой){
      /* что было в сессии до закрытия — держим на окне, чтобы вернуть после */
      await js(`(function(){ const ss=gymSess(td()); window.__afterSess=ss?{...ss}:null; return !!ss; })()`);
      /* v535: закрытие без рабочих подходов — честно «не засчитана», а не
         «Сделано». Итог меряем на тренировке с одним рабочим подходом —
         вес и повторы в лаймовый ряд и галочка, тем же жестом, что и человек. */
      await js(`(function(){ window.__afterT0=Date.now(); const r=document.querySelector('#nextBox .wrow.cur'); if(!r) return 'нет ряда'; const w=r.querySelectorAll('.wi'); if(w.length<2) return 'нет полей'; w[0].value='40'; w[1].value='8'; const c=r.querySelector('.wcheck'); if(c) c.click(); return 'ок'; })()`); await sleep(900);
      /* фикстура: отдых идёт — закрытие обязано его погасить (v523) */
      await js(`(function(){ try{ startRest(45,'между подводящими'); }catch(_){} return restEndAt>0; })()`);
      await js(`document.getElementById('wEnd').click()`); await sleep(500);
      await js(`(function(){ document.getElementById('ss_start').value='10:00'; document.getElementById('ss_end').value='10:52'; document.getElementById('ss_rpe').value='7'; return 1; })()`);
      await js(`document.getElementById('bSess').click()`); await sleep(1200);
      /* разбор открывается сам после закрытия — закрываем крестиком, как человек */
      await js(`(function(){ const ai=document.getElementById('sh-ai'); const x=ai&&ai.classList.contains('on')&&ai.querySelector('[data-close]'); if(x) x.click(); return !!x; })()`); await sleep(300);
      const м=await спроси(`(function(){ try{
        const вид=e=>!!(e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0);
        const шапка=document.querySelector('#nextBox .dhd.fin');
        const текст=(шапка&&шапка.textContent)||'';
        const ss=gymSess(td())||{};
        return JSON.stringify({шапка:!!шапка, итог:/Сделано/.test(текст)&&/52 мин/.test(текст), тяжесть:/Тяжесть 7/.test(текст),
          пилюли:!!document.querySelector('#nextBox [data-rdtog],#nextBox [data-wutog]'), вход:вид(document.getElementById('wDebrief')),
          таймер:!(restEndAt>0)&&!(document.getElementById('restBar')||{classList:{contains:()=>false}}).classList.contains('on'),
          закрыта:ss.end==='10:52'&&ss.rpe===7});
      }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      Object.assign(d,м);
      await js(`(function(){ const b=document.getElementById('wDebrief'); if(b) b.click(); return !!b; })()`); await sleep(500);
      const р=await спроси(`(function(){ try{ const ai=document.getElementById('sh-ai'); return JSON.stringify({разбор:!!(ai&&ai.classList.contains('on'))}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      d.разбор=р.разбор; if(р.сбой&&!d.сбой) d.сбой=р.сбой;
      await js(`(function(){ const ai=document.getElementById('sh-ai'); const x=ai&&ai.classList.contains('on')&&ai.querySelector('[data-close]'); if(x) x.click(); return !!x; })()`); await sleep(300);
      /* чистим: сессия обратно в открытую — одна запись в хранилище, потом
         перерисовка отдельным вызовом */
      await js(`(async()=>{ try{ const ss=gymSess(td()), w=window.__afterSess;
        if(ss){ await put('sess',{...ss,start:w?w.start:null,end:w?w.end:null,min:w?w.min:null,rpe:w?w.rpe:null}); SESS=await all('sess'); }
        return 'ок'; }catch(e){ return 'ERR '+e.message } })()`);
      /* Уборка — тоже состояние: сессия обязана вернуться к снимку, иначе
         следующее правило («до первого упражнения») увидит шапку-итог и
         обвинит не того. */
      /* и подход фикстуры — из хранилища, чтобы следующие правила меряли свой день */
      await js(`(async()=>{ try{ const mine=SETS.filter(x=>x.d===td()&&x.w===40&&x.r===8&&(+x.ua||0)>=(window.__afterT0||0)); for(const s of mine){ if(s.id!=null) await del('sets',s.id); } SETS=await all('sets'); return 'ок'; }catch(e){ return 'ERR '+e.message } })()`);
      const у=await спроси(`(function(){ const ss=gymSess(td())||{}, w=window.__afterSess||{}; const left=SETS.filter(x=>x.d===td()&&x.w===40&&x.r===8&&(+x.ua||0)>=(window.__afterT0||0)).length; return JSON.stringify({вернулась:(ss.end||null)===(w.end||null)&&(ss.rpe||null)===(w.rpe||null)&&left===0}); })()`);
      chk(у.сбой==null&&у.вернулась===true,'фикстура «после» не убрана за собой: сессия дня осталась закрытой — следующие правила меряют шапку-итог вместо тренировки');
      await js(`(function(){ window.__ssEditD=null; window.__afterSess=null; rNext(); return 1; })()`); await sleep(200);
    }
    chk(!d.сбой,'замер состояния «после» сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.закрыта===true,'фикстура «после» не задалась: сессия не закрылась записью 10:00–10:52 · тяжесть 7');
      chk(d.шапка===true&&d.итог===true,'после закрытия тренировки шапка не стала итогом («Сделано · 52 мин»)');
      chk(d.тяжесть===true,'записанная тяжесть 7 не видна в шапке — человек не знает, что оценка принята');
      chk(d.пилюли===false,'после закрытия тренировки в шапке остались пилюли разминки/готовности');
      chk(d.таймер===true,'после «Закрыть тренировку» таймер отдыха идёт дальше — полоса поверх итога, вибрация в раздевалке');
      chk(d.вход===true&&d.разбор===true,'«Разбор тренировки» из шапки не открывает лист разбора');
    }
    if(process.env.BVDBG) console.log('   DBG состояние «после»: '+JSON.stringify(d));
  }

  /* Замер 22.09 (v638, медиана трёх): обработчик 0.6 · первый кадр 0.6 · худший
     разрыв кадров 18.2 мс — это перерисовка карточки после записи в IndexedDB.
     Порог — храповик: не хуже нынешнего с запасом на шум, не больше. Закон
     говорит 15; обработчик его держит, разрыв кадров — пока нет, и это
     записано в CRAFT как открытая клетка, а не как «соблюдается». */
  const LAT_WORST=40;
  /* ── ОТКЛИК НА ВВОД v638 (Кодекс, закон 4) ──
     Закон говорит «отклик на ввод подхода или еды ≤ 15 мс», а гейт до сих пор
     мерил только вкладки. Меряем ВЫХОД на нормальном процессоре тем же
     жестом, что у человека: 40×8 в лаймовый ряд и тап по кружку. Три числа:
     синхронная работа обработчика (сколько главный поток занят ДО того, как
     отпустит палец), время до первого кадра и самый длинный разрыв между
     кадрами в следующие 600 мс — это и есть «экран замер». Три пробы,
     медиана; подход фикстуры и отдых убираются между пробами. */
  {
    const спроси=async expr=>{ let r=null; for(let i=0;i<2&&typeof r!=='string';i++){ r=await js(expr); if(typeof r!=='string') await sleep(400); } return typeof r==='string'?JSON.parse(r):{сбой:'не разобрать'+(r&&r.__err?' ('+r.__err+')':'')}; };
    await js(`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`); await sleep(400);
    await js(`(function(){ const b=[...document.querySelectorAll('#tr-log button')].find(x=>/Начать тренировку/.test(x.textContent)); if(b) b.click(); return !!b; })()`); await sleep(600);
    await js(`(function(){ const ss=gymSess(td()); window.__latSess=ss?{...ss}:null; window.__latT0=Date.now(); return 1; })()`);
    const пробы=[];
    for(let k=0;k<3;k++){
      const о=await спроси(`(async function(){ try{
        const r=document.querySelector('#nextBox .wrow.cur'); if(!r) return JSON.stringify({сбой:'нет ряда'});
        const w=r.querySelectorAll('.wi'); if(w.length<2) return JSON.stringify({сбой:'нет полей'});
        w[0].value='40'; w[1].value='8'; const c=r.querySelector('.wcheck'); if(!c) return JSON.stringify({сбой:'нет кружка'});
        const t0=performance.now(); c.click(); const синхр=performance.now()-t0;
        let первый=null, худший=0, прошлый=t0;
        await new Promise(res=>{ (function f(){ const now=performance.now(); if(первый==null) первый=now-t0; if(now-прошлый>худший) худший=now-прошлый; прошлый=now; if(now-t0<600) requestAnimationFrame(f); else res(); })(); });
        return JSON.stringify({синхр:Math.round(синхр*10)/10,первый:Math.round(первый*10)/10,худший:Math.round(худший*10)/10});
      }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      пробы.push(о); await sleep(500);
      await js(`(async()=>{ try{ stopRest(); const mine=SETS.filter(x=>x.d===td()&&x.w===40&&x.r===8&&(+x.ua||0)>=(window.__latT0||0)); for(const s of mine){ if(s.id!=null) await del('sets',s.id); } SETS=await all('sets'); rNext(); return 'ок'; }catch(e){ return 'ERR '+e.message } })()`); await sleep(400);
    }
    /* сессия — обратно к снимку, как у стенда «после» */
    await js(`(async()=>{ try{ const ss=gymSess(td()), w=window.__latSess; if(ss) { await put('sess',{...ss,start:w?w.start:null,end:w?w.end:null,min:w?w.min:null,rpe:w?w.rpe:null}); SESS=await all('sess'); } window.__latSess=null; rNext(); return 'ок'; }catch(e){ return 'ERR '+e.message } })()`); await sleep(300);
    const сбой=пробы.find(p=>p.сбой);
    chk(!сбой,'замер отклика на подход сорвался: '+(сбой||{}).сбой);
    if(!сбой){
      const мед=k=>пробы.map(p=>p[k]).sort((a,b)=>a-b)[1];
      const синхр=мед('синхр'), первый=мед('первый'), худший=мед('худший');
      console.log('   отклик на подход, мс (медиана трёх): обработчик '+синхр+' · первый кадр '+первый+' · худший разрыв кадров '+худший);
      chk(синхр<=15,'обработчик подхода держит главный поток '+синхр+' мс до отпускания пальца — закон 4 говорит 15');
      chk(худший<=LAT_WORST,'после записи подхода экран замирает на '+худший+' мс (предел '+LAT_WORST+') — палец ждёт кадра');
      const остаток=await спроси(`JSON.stringify({лишних:SETS.filter(x=>x.d===td()&&x.w===40&&x.r===8&&(+x.ua||0)>=(window.__latT0||0)).length})`);
      chk(остаток.лишних===0,'фикстура отклика не убрана за собой: подходов 40×8 осталось '+остаток.лишних);
    }
  }


  /* ── ДО ПЕРВОГО УПРАЖНЕНИЯ — ТОЛЬКО ШАПКА (закон экрана 01.09, v516) ──
     Замер 04.09: при срезе по готовности над первым упражнением стояла
     карточка объяснения на 196 px, путь 406 px при экране 700. Теперь факт
     несёт пилюля («Готовность 41 · −2 подх.»), объяснение — по тапу на неё.
     Меряем выход: верх первой карточки минус верх экрана дня, в начатой
     тренировке, с низкой готовностью. Порог 240 при замеренных 200.
     Форма 04.09: переход — тапом из Node, замер — коротким синхронным
     вызовом с одним повтором, если страница промолчала. */
  {
    /* Синхронный замер с одним повтором: пустой ответ — не поломка
       приложения, а повод спросить состояние ещё раз (CRAFT, 04.09). */
    const спросить=async expr=>{ let s=null; for(let i=0;i<2;i++){ s=await js(expr); if(typeof s==='string'&&s) break; await sleep(400); }
      if(typeof s==='string'&&s){ try{ return JSON.parse(s); }catch(e){ return {сбой:'не разобрать: '+s.slice(0,80)}; } }
      return {сбой:s&&s.__err?s.__err:'страница промолчала дважды'}; };
    /* Фикстура: сегодняшняя готовность низкая, панель закрыта. RDY живёт в
       памяти — правим и возвращаем на месте, хранилище не трогаем; прежний
       список держим в окне, чтобы вернуть те же объекты. */
    await js(`(function(){ try{ window.__rdyWas=RDY.slice(); RDY.length=0; RDY.push({d:td(),sleep:4,sq:1,sore:1,en:1,mot:1,str:1}); rdOpen=false; renderAll(); return 1; }catch(e){ return 'ERR '+e.message } })()`);
    await sleep(300);
    await js(`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`); await sleep(500);
    const ф=await спросить(`(function(){ try{ const r=(RDY||[]).filter(x=>x&&x.d===td()); const v=document.getElementById('v-train');
      return JSON.stringify({низкая:r.length===1&&r[0].sq===1&&r[0].en===1, закрыто:rdOpen===false, было:Array.isArray(window.__rdyWas), вкладка:!!(v&&v.classList.contains('on'))});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    chk(!ф.сбой&&ф.низкая===true&&ф.закрыто===true&&ф.было===true&&ф.вкладка===true,'фикстура низкой готовности не встала ('+JSON.stringify(ф)+') — путь до первого упражнения меряется не в том состоянии');
    /* Начать тренировку — тапом по кнопке, как палец; если прежние правила
       уже начали день, кнопки нет и начинать нечего. */
    await js(`(function(){ const b=[...document.querySelectorAll('#tr-log button')].find(x=>/Начать тренировку/.test(x.textContent)); if(b) b.click(); return b?'тап':'уже'; })()`); await sleep(600);
    const d=await спросить(`(function(){ try{
      const box=document.getElementById('nextBox'), first=box&&box.querySelector('.wc');
      const путь=first?Math.round(first.getBoundingClientRect().top-box.getBoundingClientRect().top):null;
      const пилюля=document.querySelector('#nextBox [data-rdtog]'); const метка=(пилюля&&пилюля.textContent)||'';
      /* Опись того, что стоит над первой карточкой: без неё «279 px при пороге 240» — цифра без причины. */
      const над=first?[...(first.parentElement?first.parentElement.children:[])].filter(e=>e!==first&&(e.compareDocumentPosition(first)&Node.DOCUMENT_POSITION_FOLLOWING)).map(e=>(String(e.className||e.tagName).split(' ')[0]||e.tagName)+':'+Math.round(e.getBoundingClientRect().height)+':'+(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,24)):[];
      return JSON.stringify({путь,метка,срезано:/подход/.test(метка),объяснение:!!document.querySelector('#nextBox [data-rdundo]'),над});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Тап по пилюле — переход; что открылось — отдельный вопрос состоянию. */
    await js(`(document.querySelector('#nextBox [data-rdtog]')||{click(){}}).click()`); await sleep(300);
    const т=await спросить(`(function(){ try{ return JSON.stringify({открыто:rdOpen===true, объяснениеПоТапу:!!document.querySelector('#nextBox [data-rdundo]')}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Чистим на месте: панель закрыта, готовность прежняя, экран перерисован. */
    await js(`(function(){ try{ rdOpen=false; if(Array.isArray(window.__rdyWas)){ RDY.length=0; window.__rdyWas.forEach(x=>RDY.push(x)); } window.__rdyWas=null; renderAll(); return 1; }catch(e){ return 'ERR '+e.message } })()`);
    await sleep(300);
    chk(!d.сбой&&!т.сбой,'замер пути до первого упражнения сорвался: '+(d.сбой||т.сбой));
    if(!d.сбой&&!т.сбой){
      chk(d.срезано===true,'при низкой готовности пилюля не говорит, сколько срезано («'+d.метка+'») — фикстура не задалась или факт потерян');
      chk(d.путь!=null&&d.путь<=240,'до первого упражнения '+d.путь+' px при пороге 240 — над ним снова что-то выросло: '+JSON.stringify(d.над||[]));
      chk(d.объяснение===false,'объяснение среза висит над упражнениями при закрытой пилюле');
      chk(т.объяснениеПоТапу===true,'тап по пилюле готовности не показывает объяснение среза и «верни план»');
    }
  }

  /* ── ЛИСТ ЗАКРЫВАЕТ ЭКРАН ЦЕЛИКОМ, СТРАНИЦА ПОД НИМ ЗАПЕРТА ──
     Полевой скриншот владельца 03.09: настройки открылись поверх «Еды», ниже
     листа осталась живая страница — видна и листается, два скроллера на
     одном экране. Меряем выход: точка у нижнего края экрана при открытом
     листе принадлежит листу, а не странице; прокрутка документа не двигается;
     настройки — во весь экран от верха. С 04.09 — в форме коротких вызовов:
     переход тапом из Node, замер синхронный, с одним повтором. */
  {
    /* Ответ страницы разбираем бережно: не строка или не JSON — она
       «промолчала», и правило спросит ещё раз, а не упадёт на JSON.parse. */
    const разбор=t=>{ try{ return typeof t==='string'?JSON.parse(t):null }catch(_){ return null } };
    /* Путь человека: «Еда» — тапом по нижнему меню, настройки — тапом по
       шестерёнке в шапке, а не вызовом goView()/openSet(). */
    await js(`window.scrollTo(0,0)`);
    await js(`(document.querySelector('nav button[data-v="food"]')||{click(){}}).click()`); await sleep(300);
    let yДо=await js(`window.scrollY`); if(typeof yДо!=='number'){ await sleep(400); yДо=await js(`window.scrollY`); } yДо=Number(yДо)||0;
    await js(`(document.getElementById('bSet')||{click(){}}).click()`); await sleep(500);
    let открыт=null;
    for(let i=0;i<2&&typeof открыт!=='boolean';i++){ открыт=await js(`(function(){ const s=document.getElementById('sh-s'); return !!(s&&s.classList.contains('on')); })()`); if(typeof открыт!=='boolean') await sleep(400); }
    chk(открыт===true,'тап по шестерёнке не открыл лист настроек — проверка листа ничего не проверила');
    /* Крутим НАСТОЯЩИМ колесом через CDP, а не window.scrollBy: программная
       прокрутка обходит overflow:hidden и меряла бы не то, что делает палец. */
    for(let i=0;i<4;i++){ await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:195,y:700,deltaX:0,deltaY:300}); await sleep(80); }
    await sleep(200);
    /* Замер — синхронный, читает состояние здесь и сейчас; y до открытия
       листа подставлен из Node. Повтор один, если страница промолчала. */
    const ЗАМЕР=`(function(){ try{
      const s=document.getElementById('sh-s'); if(!s) return JSON.stringify({сбой:'нет листа sh-s'});
      const внизу=document.elementFromPoint(Math.round(innerWidth/2), innerHeight-40);
      const внизуВЛисте=!!(внизу&&(внизу===s||s.contains(внизу)));
      const сдвиг=Math.abs(window.scrollY-${yДо});
      const r=s.querySelector('.in').getBoundingClientRect();
      const полный=s.classList.contains('kb')&&r.top<=Math.max(2,parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vvt'))||0)+2;
      const заперто=document.documentElement.classList.contains('shlock');
      return JSON.stringify({внизуВЛисте,сдвиг,полный,заперто});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`;
    let d=разбор(await js(ЗАМЕР)); if(!d){ await sleep(400); d=разбор(await js(ЗАМЕР)); }
    if(!d) d={сбой:'не разобрать'};
    /* Закрываем КРЕСТИКОМ — путём человека, а не функцией. Первая версия
       звала sheet('sh-s',false) и была зелёной, пока крестик оставлял замок
       (полевой отчёт 03.09: «внутри всё мёртвое»). Закрытие — отдельный шаг,
       и он идёт всегда, даже если замер выше сорвался: лист не должен
       остаться открытым для следующих правил. */
    await js(`(function(){ const s=document.getElementById('sh-s'); const x=s&&s.querySelector('[data-close]'); if(x) x.click(); else if(typeof sheet==='function') sheet('sh-s',false); return 1; })()`);
    await sleep(300);
    let отперто=null;
    for(let i=0;i<2&&typeof отперто!=='boolean';i++){ отперто=await js(`!document.documentElement.classList.contains('shlock')`); if(typeof отперто!=='boolean') await sleep(400); }
    chk(!d.сбой,'замер листа настроек сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.внизуВЛисте===true,'при открытых настройках нижняя часть экрана — это страница, а не лист: под шторкой живая «Еда»');
      chk(d.сдвиг<2,'при открытом листе страница под ним прокрутилась на '+d.сдвиг+' px — два скроллера на одном экране');
      chk(d.полный===true,'настройки открылись шторкой снизу, а не экраном от верха — решение владельца 03.09 не выполнено');
      chk(d.заперто===true&&отперто===true,'замок документа: при открытом листе '+(d.заперто?'стоит':'НЕ стоит')+', после закрытия крестиком '+(отперто?'снят':'НЕ снят'));
    }
    /* После закрытия крестиком страница обязана листаться: настоящее колесо. */
    { /* v636: первый экран «Еды» стал короче экрана — листать бывает нечего.
         Тогда замок проверяем по самому замку: класс снят и overflow не hidden. */
      const можно=await js(`(function(){ return document.documentElement.scrollHeight>innerHeight+100 })()`);
      const y0=await js(`window.scrollY`);
      for(let i=0;i<4;i++){ await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:195,y:500,deltaX:0,deltaY:300}); await sleep(80); }
      await sleep(200);
      const y1=await js(`window.scrollY`);
      const замка=await js(`(function(){ return document.documentElement.classList.contains('shlock')||getComputedStyle(document.body).overflow==='hidden' })()`);
      chk(можно?((y1-y0)>50):(замка===false),'после закрытия настроек крестиком страница не листается (сдвиг '+(y1-y0)+' px'+(можно?'':', листать нечего, замок '+замка)+') — замок остался, приложение мёртвое');
      await js(`window.scrollTo(0,0)`); }
  }

  /* ── ПОДПИСКА — ДВЕ СТРОКИ И «ПОДРОБНЕЕ» ──
     Обещание SPEC с v510 («две строки и ссылка»). Замер 05.09 по форме
     владельца: абзац занимал пять строк, под ним стояла серая отключённая
     кнопка «Скоро — ранний доступ первым 100» ещё на две. Смоук считает
     знаки в исходнике, здесь считаем настоящие строки: высота абзаца делится
     на его line-height. Путь человека: шестерёнка → строка «Данные и облако»
     тапом; замер синхронный с одним повтором; закрытие — крестиком. */
  { const разбор=t=>{ try{ return typeof t==='string'?JSON.parse(t):null }catch(_){ return null } };
    await js(`(document.getElementById('bSet')||{click(){}}).click()`); await sleep(500);
    await js(`(function(){ const b=[...document.querySelectorAll('#setList .lrow[data-setpg]')].find(x=>/Данные и облако/.test(x.textContent||'')); if(b) b.click(); return 1; })()`); await sleep(900);
    const ЗАМЕР=`(function(){ try{
      const box=document.getElementById('subBox'); if(!box) return JSON.stringify({сбой:'нет subBox'});
      const ib=box.querySelector('.ib'); if(!ib) return JSON.stringify({сбой:'абзац подписки не отрисован'});
      const lh=parseFloat(getComputedStyle(ib).lineHeight)||0; const h=ib.getBoundingClientRect().height;
      const строк=lh?Math.round(h/lh):-1;
      const det=box.querySelector('details'); const подробнее=!!(det&&/Подробнее о подписке/.test(det.textContent||''));
      const мёртвая=!!box.querySelector('button[disabled]');
      return JSON.stringify({строк,подробнее,мёртвая,открыта:!!(det&&det.open)});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`;
    let d=разбор(await js(ЗАМЕР)); if(!d||d.сбой==='абзац подписки не отрисован'){ await sleep(600); d=разбор(await js(ЗАМЕР)); }
    if(!d) d={сбой:'не разобрать'};
    await js(`(function(){ const s=document.getElementById('sh-s'); const x=s&&s.querySelector('[data-close]'); if(x) x.click(); else if(typeof sheet==='function') sheet('sh-s',false); return 1; })()`);
    await sleep(300);
    chk(!d.сбой,'замер блока подписки сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.строк>=1&&d.строк<=2,'абзац подписки занимает '+d.строк+' строк вместо двух — обещание SPEC «две строки и «Подробнее»» не выполнено');
      chk(d.подробнее===true&&d.открыта===false,'у подписки нет закрытой раскрывашки «Подробнее о подписке» — тарифы либо пропали, либо снова стеной');
      chk(d.мёртвая===false,'в блоке подписки отключённая кнопка — мёртвая кнопка, нажимать нечего');
    }
  }

  /* ── «ПОДРОБНЕЕ» У ГОТОВНОСТИ ВЕДЁТ К ФОРМЕ, А НЕ В ДРУГУЮ ВКЛАДКУ ──
     Найдено замером 02.09: ссылка открывала «Тело» → «Шаги и сон», где
     развёрнутой формы нет вовсе — она живёт в «Зале», в подвкладке «Разбор».
     Ссылка осталась с тех пор, когда опросник жил в «Теле» (переехал в v494),
     и переезд её не заметил. Обход такое не ловит: обработчик у кнопки есть,
     значит для него она живая. Правило меряет, ЧТО человек увидел после
     нажатия, а не то, что нажатие куда-то дошло. С 04.09 — в форме «переход
     тапом из Node, замер коротким синхронным вызовом» (CRAFT). */
  for(const режим of ['pro','simple']){
    /* Переход — отдельным коротким вызовом с тапом по живому элементу, замер —
       отдельным синхронным вызовом с одним повтором, если страница промолчала:
       один длинный async-вызов возвращал «не разобрать» при исправном
       приложении. Ответы шагов — только для диагностики; чем кончилось,
       спрашиваем у состояния. */
    const спроси=async expr=>{ let r=null; for(let i=0;i<2&&typeof r!=='string';i++){ r=await js(expr); if(typeof r!=='string') await sleep(400); } return typeof r==='string'?r:null; };
    let сбой='';
    const шаг=async(имя,код,ms)=>{ const r=await js(`(function(){ try{ ${код}; return 'ок' }catch(e){ return 'ERR '+e.message } })()`); if(r&&(r.__err||/^ERR/.test(r))) сбой=сбой||(имя+': '+(r.__err||r)); await sleep(ms); };
    const пил=`[...document.querySelectorAll('.dhd-p button')].find(b=>/сегодня|готов/i.test(b.textContent||''))`;
    /* Слепок «до»: правило обязано вернуть приложение таким, каким взяло.
       Ответ на готовность режет объём, а раскрытая подвкладка «Разбор»
       оставляет на экране прозу — и следующие правила прогона начинают
       мерить последствия ЭТОГО правила, а не приложение (напоролся здесь
       же 02.09: четыре ложных нарушения «проза вне жеста»). */
    const слепок=await спроси(`(function(){ return JSON.stringify({готовность:(RDY||[]).find(r=>r&&r.d===td())||null, ui:S.ui||'', uiAuto:S.uiAuto||0, open:!!rdOpen}); })()`);
    const до=слепок?JSON.parse(слепок):null;
    if(!до) сбой='слепок «до» не снят';
    const d={};
    if(до){
      /* Режим — руками, панель готовности — закрыта: первый тап по пилюле
         обязан её открыть, а не закрыть то, что оставил сосед. */
      await шаг('режим',`rdOpen=false; S.ui='${режим}'; S.uiAuto=0; applyUI(); renderAll()`,300);
      d.режим=await спроси(`document.documentElement.dataset.ui||''`);
      /* Путь человека: «Зал» → пилюля «Как ты сегодня?» → быстрый ответ →
         пилюля снова (после ответа панель свёрнута) → «подробнее». */
      await шаг('вкладка «Зал»',`(document.querySelector('nav button[data-v="train"]')||{click(){ goView('train') }}).click()`,500);
      await шаг('пилюля готовности',`const p=${пил}; if(p) p.click()`,400);
      await шаг('быстрый ответ',`const q=document.querySelector('[data-rdv]'); if(q) q.click()`,600);
      /* Быстрый ответ пишет хранилище асинхронно — ждём запись в СОСТОЯНИИ,
         а не верим тапу. */
      for(let i=0;i<2&&d.ответ==null;i++){ const о=await спроси(`(function(){ const r=(RDY||[]).find(x=>x&&x.d===td()); return JSON.stringify({en:r&&r.en!=null?r.en:null}) })()`); d.ответ=о?JSON.parse(о).en:null; if(d.ответ==null) await sleep(400); }
      await шаг('пилюля после ответа',`const p=${пил}; if(p) p.click()`,500);
      const ссылка=await спроси(`JSON.stringify(!!document.querySelector('[data-rdfull]'))`);
      if(ссылка==null) сбой=сбой||'наличие ссылки «подробнее» не разобрать';
      else if(ссылка!=='true') d.нетСсылки=1;
      else{
        await шаг('тап «подробнее»',`document.querySelector('[data-rdfull]').click()`,900);
        /* v615: подробная форма живёт в листе «Тренер» («Моё состояние»), не в подвкладке «Зала» */
        const з=await спроси(`(function(){ const v=document.querySelector('.view.on'); const rf=document.getElementById('rdForm'); const sh=document.getElementById('sh-ask');
          return JSON.stringify({вкладка:v?v.id:'?', лист:!!(sh&&sh.classList.contains('on')), видна:!!(rf&&getComputedStyle(rf).display!=='none'&&rf.getBoundingClientRect().height>0), вопросов:rf?rf.querySelectorAll('[data-rq]').length:0}); })()`);
        if(з) Object.assign(d,JSON.parse(з)); else сбой=сбой||'замер после тапа «подробнее» не разобрать';
      }
      /* Прибираем за собой: подвкладка обратно на «Тренировку», раскрытая
         карточка снова спрятана, ответы готовности за сегодня удалены —
         кроме тех, что были до нас. Уборка идёт и по пути «ссылки нет»:
         ответ-то уже записан. */
      await шаг('уборка экрана',`try{ sheet('sh-ask',false); }catch(e){}
        const lg=document.querySelector('[data-tr="log"]'); if(lg) lg.click()`,200);
      /* Хранилище ready ключуется ДАТОЙ (keyPath:'d'), а не id: первая версия
         этой уборки удаляла по r.id, то есть по undefined, и не удаляла
         ничего — прогон честно показал те же четыре ложных нарушения.
         Запись — один короткий async-шаг; что осталось, спрашиваем отдельно. */
      await js(`(async function(){ try{ const было=${JSON.stringify(до.готовность)};
        if(было) await put('ready',было); else await del('ready',td(),true);
        RDY=await all('ready'); return 'ок' }catch(e){ return 'ERR '+e.message } })()`);
      await sleep(300);
      await шаг('возврат режима',`rdOpen=${до.open}; S.ui=${JSON.stringify(до.ui)}; S.uiAuto=${до.uiAuto}; applyUI(); renderAll()`,400);
      d.уборка=await спроси(`(function(){ return JSON.stringify({готовность:(RDY||[]).find(r=>r&&r.d===td())||null, ui:S.ui||'', open:!!rdOpen}) })()`);
    }
    chk(!сбой,'замер «подробнее» ('+режим+') сорвался: '+сбой);
    if(до){
      chk(d.режим===режим,'режим '+режим+' не включился для замера «подробнее» (на экране «'+d.режим+'») — проверка меряла не тот режим');
      chk(d.ответ!=null,'быстрый ответ на готовность ('+режим+') не записался — до ссылки «подробнее» после ответа не дошли');
    }
    chk(!d.нетСсылки,'в режиме '+режим+' после ответа нет ссылки «подробнее» — к развёрнутой форме не попасть');
    if(!сбой&&!d.нетСсылки){
      chk(d.вкладка==='v-train','«подробнее» ('+режим+') увело на вкладку «'+d.вкладка+'» — лист открывается над «Залом», человек оказался неизвестно где');
      chk(d.лист===true,'«подробнее» ('+режим+') не открыло лист «Тренер» — с v615 форма живёт там');
      chk(d.видна===true,'«подробнее» ('+режим+') не показало развёрнутую форму — ссылка ведёт в никуда');
      chk(d.вопросов>=4,'в развёрнутой форме ('+режим+') '+d.вопросов+' вопросов — это уже не подробности');
    }
    if(process.env.BVDBG) console.log('   DBG «подробнее» ('+режим+'): '+JSON.stringify(d));
  }

  // 5. Прогулка по всем вкладкам полного режима не должна ничего ронять
  for(const v of ['food','train','body','health','coach']){
    await js(`(document.querySelector('nav button[data-v="${v}"]')||{click(){}}).click()`);
    await sleep(500); drain();
  }
  for(const t of ['prog','ex','anal','log']){
    await js(`document.querySelector('nav button[data-v="train"]').click();
      (document.querySelector('[data-tr="${t}"]')||{click(){}}).click()`);
    await sleep(500); drain();
  }
  for(const b of ['prg','reg','w']){
    await js(`document.querySelector('nav button[data-v="body"]').click();
      (document.querySelector('[data-bd="${b}"]')||{click(){}}).click()`);
    await sleep(500); drain();
  }
  /* ГЛАВНОЕ ПОЛЕВОЕ ОБЕЩАНИЕ: приложение открывается без сети. Ради этого
     поднимался свой сервер и переписывался service worker (ТСПУ не рвёт
     соединение, а вешает его). Проверяем буквально: ставим SW, рубим сеть,
     перезагружаем — приложение обязано подняться, показать экран и принять
     запись. Работает только на https-стенде. */
  if(TLS){
    const sw=await js(`navigator.serviceWorker.getRegistrations().then(r=>!!(r[0]&&(r[0].active||r[0].installing)))`);
    chk(sw===true,'service worker не зарегистрировался — без сети приложение не откроется');
    await sleep(2500);   // дать оболочке докэшироваться
    await js(`(async()=>{await put('weight',{d:td(),kg:91.1});return 1})()`);
    await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await send('Page.reload',{ignoreCache:false});
    await ready('перезагрузка без сети'); drain();
    const alive=await js('typeof APP_VER!=="undefined"?APP_VER:null');
    chk(!!alive,'без сети приложение не поднялось — человек в зале увидит белый экран');
    // приложение возвращает последнюю вкладку — идём на «Еду» и смотрим там
    await js(`(document.querySelector('nav button[data-v="food"]')||{click(){}}).click()`);
    await sleep(900); drain();
    chk((await js('document.body.innerText.length'))>200,'без сети экран почти пустой');
    chk(await seen('macCard'),'без сети не видно таблицы калорий и БЖУ — оболочка поднялась пустой');
    /* С 04.09 — по форме CRAFT: чтение и запись хранилища — отдельные
       короткие шаги, их ответ никуда не идёт; что вышло, спрашиваем
       синхронным замером с одним повтором, если страница промолчала.
       Прочитанное держим в окне (страничные переменные вызов не переживают),
       в конце — стираем. */
    const спроси=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); }
      if(r==null||r==='') return {сбой:'не разобрать'}; if(typeof r==='object') return {сбой:String(r.__err||'не разобрать')};
      try{ return JSON.parse(r); }catch(e){ return {сбой:'не разобрать: '+r}; } };
    /* Шаг чтения: вес из хранилища — в окно; ответ не используем. */
    await js(`(async()=>{ try{ window.__offW=await all('weight') }catch(e){ window.__offW='ошибка: '+e.message } return 1 })()`);
    await sleep(200);
    /* Шаг записи: подход без сети — тем же put(), что и кнопка; ответ не используем. */
    await js(`(async()=>{ try{ await put('sets',{e:'Жим лёжа',d:td(),w:60,r:8,ua:Date.now()}); window.__offPut='ок' }catch(e){ window.__offPut='ошибка: '+e.message } return 1 })()`);
    await sleep(200);
    /* Шаг чтения: подходы из хранилища — в окно; ответ не используем. */
    await js(`(async()=>{ try{ window.__offSets=await all('sets') }catch(e){ window.__offSets='ошибка: '+e.message } return 1 })()`);
    await sleep(200);
    /* Замер — синхронный: что лежит в окне после трёх шагов. */
    const безСети=await спроси(`(function(){ try{ const w=window.__offW, s=window.__offSets, p=window.__offPut;
      return JSON.stringify({kept:Array.isArray(w)&&w.length>0&&w.some(x=>x.kg===91.1),
        wrote:p==='ок'&&Array.isArray(s)&&s.length>0,
        почему:p!=='ок'?String(p):(Array.isArray(s)?'подходов в хранилище '+s.length:String(s))});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    await js(`(function(){ window.__offW=null; window.__offPut=null; window.__offSets=null; return 1 })()`);
    chk(!безСети.сбой,'замер без сети сорвался: '+безСети.сбой);
    if(!безСети.сбой){
      chk(безСети.kept===true,'без сети пропали локальные данные');
      chk(безСети.wrote===true,'без сети нельзя записать подход — тренировка в подвале потеряна: '+безСети.почему);
    }
    await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  } else {
    console.log('   (офлайн-проверка пропущена: нет openssl для https-стенда)');
  }

  /* КРУГ БЭКАПА: экспорт → «потерял телефон» → импорт. Это единственная
     страховка данных человека, и она молча теряла анкету (v277). Проверяем
     буквально: собираем файл тем же обработчиком, что и кнопка, стираем всё,
     импортируем через настоящее поле — и смотрим, что вернулось.
     С 04.09 — по форме CRAFT: тап по кнопке и каждая запись в хранилище —
     отдельные короткие шаги, замер — синхронный вызов с одним повтором. */
  {
    /* Ответ страницы разбираем сами: пустота — один повтор, снова пустота
       или ошибка контекста — «сбой» правила, а не краш прогона. Файл экспорта
       между вызовами живёт в window.__json (страничные переменные вызов не
       переживают), в конце — стираем. */
    const спроси=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); }
      if(r==null||r==='') return {сбой:'не разобрать'}; if(typeof r==='object') return {сбой:String(r.__err||'не разобрать')};
      try{ return JSON.parse(r); }catch(e){ return {сбой:'не разобрать: '+r}; } };
    /* Фикстура, шаг 1 (синхронно): анкета с секретами и программа — в память. */
    await js(`(function(){ try{ S.sex='m';S.age=34;S.h=182;S.rate=-0.5;S.wGoal=85;S.key='sk-СЕКРЕТ';S.sbPass='пароль';
      S.prog=genProgram({days:3,equip:'gym',goal:'hyper',exp:'mid',inj:[],dows:[1,3,5]}); return 1 }catch(e){ return 'ERR '+e.message } })()`);
    /* Фикстура, шаг 2 (запись): шесть дней веса, еды и подходов плюс настройки; ответ не используем. */
    await js(`(async()=>{ try{
      for(let i=5;i>=0;i--){ const d=ds(dn(td())-i);
        await put('weight',{d,kg:92-i*0.1});
        await put('log',{d,n:'Еда '+i,u:100,a:200,k:400,p:30,f:10,c:40});
        await put('sets',{e:'Жим лёжа',d,w:60+i,r:8,ua:Date.now()+i}); }
      await put('settings',S,'main'); }catch(e){} return 1 })()`);
    await sleep(300);
    /* Фикстура, шаг 3 (чтение): записанное — в память; ответ не используем. */
    await js(`(async()=>{ try{ await loadAll() }catch(e){} return 1 })()`);
    await sleep(1200);
    const ф=await спроси(`(function(){ try{ return JSON.stringify({w:W.length,l:LOG.length,s:SETS.length,prog:!!S.prog,h:S.h,key:S.key||''}) }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    chk(!ф.сбой&&ф.w>=6&&ф.l>=6&&ф.s>=6&&ф.prog===true&&ф.h===182&&ф.key==='sk-СЕКРЕТ','фикстура круга бэкапа не встала ('+JSON.stringify(ф)+') — экспорт собирал бы не то');
    /* Соглядатаи: ссылку на blob и «скачивание» перехватываем, чтобы файл
       остался в окне, а не улетел в загрузки стенда. Прежние функции — тоже
       в окне, вернём сразу после тапа. */
    await js(`(function(){ try{ window.__capBlob=null; window.__json=null;
      window.__bkSpy={oU:URL.createObjectURL,oC:HTMLAnchorElement.prototype.click};
      URL.createObjectURL=function(b){ window.__capBlob=b; return 'blob:x'; };
      HTMLAnchorElement.prototype.click=function(){}; return 1 }catch(e){ return 'ERR '+e.message } })()`);
    /* Тап по «Экспорт JSON» — по настоящей кнопке, как палец. */
    await js(`(document.getElementById('bExp')||{click(){}}).click()`); await sleep(600);
    const СНЯТЬ=`(function(){ const s=window.__bkSpy; if(s){ URL.createObjectURL=s.oU; HTMLAnchorElement.prototype.click=s.oC; window.__bkSpy=null; } return 1 })()`;
    await js(СНЯТЬ);
    /* Шаг чтения: текст файла из blob — в окно; ответ не используем. */
    await js(`(async()=>{ try{ window.__json=window.__capBlob?await window.__capBlob.text():null }catch(e){ window.__json=null } return 1 })()`);
    await sleep(200);
    const exp=await спроси(`(function(){ try{ const j=window.__json; return JSON.stringify({собран:typeof j==='string',len:typeof j==='string'?j.length:0,
      secret:typeof j==='string'&&(j.indexOf('sk-СЕКРЕТ')>=0||j.indexOf('пароль')>=0)}) }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    chk(!exp.сбой,'замер экспорта сорвался: '+exp.сбой);
    if(!exp.сбой){
      chk(exp.собран===true&&exp.len>500,'экспорт не собрал файл — человеку нечем страховаться');
      chk(!exp.собран||!exp.secret,'в файле экспорта лежат секреты (ключ ИИ или пароль хранилища)');
    }

    /* «Потерял телефон», шаг 1 (запись): стереть все хранилища; ответ не используем. */
    await js(`(async()=>{
      for(const st of ['foods','log','weight','meas','photos','sets','sess','ready','steps','labs','subs','adh','sleep','combos','tomb'])
        { try{ await clr(st) }catch(e){} }
      return 1 })()`);
    await sleep(200);
    /* Шаг 2 (запись + чтение): заводские настройки в хранилище, память перечитана, экран перерисован. */
    await js(`(async()=>{ try{
      S={h:180,age:30,sex:'m',rate:-0.5,pkg:2,fkg:0.9,tdee:null,target:null,prog:null,ua:Date.now()};
      await rawput('settings',S,'main'); await loadAll(); renderAll(); }catch(e){} return 1 })()`);
    await sleep(800);
    const пусто=await спроси(`(function(){ try{ return JSON.stringify({w:W.length,l:LOG.length,s:SETS.length,h:S.h,prog:!!S.prog,поле:!!document.getElementById('impI'),файл:typeof window.__json==='string'&&window.__json.length>0}) }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    chk(!пусто.сбой&&пусто.w===0&&пусто.l===0&&пусто.s===0&&пусто.h===180&&пусто.prog===false,'«потерял телефон» не стёр данные ('+JSON.stringify(пусто)+') — импорт проверял бы не восстановление');
    /* Импорт — через настоящее поле файла: файл в него, событие change, как из системного выбора. */
    await js(`(function(){ try{ const inp=document.getElementById('impI'); if(!inp||typeof window.__json!=='string') return false;
      const dt=new DataTransfer(); dt.items.add(new File([window.__json],'tracker.json',{type:'application/json'}));
      inp.files=dt.files; inp.dispatchEvent(new Event('change')); return true }catch(e){ return 'ERR '+e.message } })()`);
    /* v675: импорт спрашивает подтверждение с числом записей — тапаем «Импортировать», как человек. */
    await sleep(700);
    await js(`(function(){ const ok=document.getElementById('dlgOk'); if(ok&&ok.offsetParent!==null) ok.click(); return 1 })()`);
    await sleep(3000);
    /* Шаг чтения: память перечитана из хранилища; ответ не используем. */
    await js(`(async()=>{ try{ await loadAll() }catch(e){} return 1 })()`);
    await sleep(200);
    const после=await спроси(`(function(){ try{ return JSON.stringify({w:W.length,l:LOG.length,s:SETS.length,prog:!!S.prog,h:S.h,age:S.age,goal:S.wGoal,key:S.key||''}) }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Чистим окно: файл и blob больше никому не нужны, соглядатаи точно сняты. */
    await js(СНЯТЬ);
    await js(`(function(){ window.__json=null; window.__capBlob=null; return 1 })()`);
    const back=пусто.поле===false?null:после;
    chk(!после.сбой,'замер импорта сорвался: '+после.сбой);
    chk(!!back,'импорт не отработал — поля восстановления нет');
    if(back&&!back.сбой){
      chk(back.w>=6&&back.l>=6&&back.s>=6,'после восстановления часть записей пропала: вес '+back.w+', еда '+back.l+', подходы '+back.s);
      chk(back.prog,'после восстановления пропала программа тренировок');
      chk(back.h===182&&back.age===34,'после восстановления анкета взялась из заводских дефолтов, а не из файла: рост '+back.h+', возраст '+back.age);
      chk(back.goal===85,'после восстановления пропал целевой вес');
      chk(!back.key,'импорт затащил ключ ИИ из файла — секреты не восстанавливаются');
    }
    drain();
  }

  /* ── ЗАКРЫТАЯ ШТОРКА НЕ ОСТАЁТСЯ ПОВЕРХ ЭКРАНА ──
     У ухода шторки появилась анимация (v282), а значит появился и способ
     сломать приложение незаметно: если класс не снимется, прозрачный слой
     на весь экран останется висеть и молча съест каждый тап. Пользователь
     увидит «приложение зависло», а в разметке всё на месте. */
  {
    const st=async e=>await js(e);
    await st(`sheet('sh-s',true)`); await sleep(400);
    chk((await st(`document.getElementById('sh-s').classList.contains('on')`))===true,
        'шторка не открывается');
    chk((await st(`(function(){var e=document.elementFromPoint(190,700);return !!(e&&e.closest('.sheet'))})()`))===true,
        'открытая шторка не принимает тапы — под ней остаётся приложение');
    await st(`sheet('sh-s',false)`); await sleep(80);
    chk((await st(`(function(){var e=document.elementFromPoint(190,700);return !!(e&&e.closest('.sheet'))})()`))===false,
        'уходящая шторка перехватывает тапы — пока доигрывает анимация, приложение не отвечает');
    await sleep(600);
    chk((await st(`getComputedStyle(document.getElementById('sh-s')).display`))==='none',
        'закрытая шторка осталась в разметке видимой — прозрачный слой съедает все тапы');
    // и после ухода приложение снова открывает ту же шторку
    await st(`sheet('sh-s',true)`); await sleep(350);
    chk((await st(`getComputedStyle(document.getElementById('sh-s')).display`))==='flex',
        'после закрытия шторка больше не открывается');
    await st(`sheet('sh-s',false)`); await sleep(400);
    drain();
  }

  /* ── ТЯЖЁЛЫЙ ЗАПРОС УЖИМАЕТСЯ ДО ОТПРАВКИ ──
     Урок отпуска: на LTE длинный аплоад рвётся, и человек видит «Load failed».
     Чат тренера весит 8.8 КБ и не при чём — рвут кадры: один занимает
     300–600 КБ в base64, пачка из четырёх даёт больше двух мегабайт.
     Здесь настоящий canvas, поэтому проверяем не маршрут, а факт сжатия.
     С 04.09 — по форме CRAFT: кадр, ужимание и замеры — отдельными короткими
     вызовами, замер синхронный с одним повтором, а не ответ одного длинного. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного:
       один async-вызов на всё (нарисовать кадр, ужать, посчитать) при пустом
       ответе ронял JSON.parse и с ним весь прогон. Кадр живёт в
       window.__aiFix, ужатое тело — в window.__aiOut; на ответ ужимания
       (единственного async-вызова) ни одна проверка не опирается —
       состояние спрашивается потом синхронно; сбой любого замера — в d.сбой. */
    const d={};
    const замер=async(expr,молчит='страница промолчала')=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); }
      if(r&&r.__err){ d.сбой=(d.сбой?d.сбой+'; ':'')+r.__err; return; }
      let o=null; try{ o=JSON.parse(r) }catch(e){}
      if(!o){ d.сбой=(d.сбой?d.сбой+'; ':'')+молчит+' ('+JSON.stringify(r)+')'; return; }
      if(o.сбой) d.сбой=(d.сбой?d.сбой+'; ':'')+o.сбой; else Object.assign(d,o); };
    /* Тело запроса: две копии одного кадра и строка текста — пачка фото из зала */
    const MK=`const mk=()=>{ const b64=(window.__aiFix||{}).b64||''; return {model:'m',max_tokens:10,messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},
        {type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},
        {type:'text',text:'что на фото'}]}]}; };`;
    /* Фикстура: настоящий JPEG с шумом — такой не сожмётся до нуля. Размер
       держим скромным: JSON.stringify по многомегабайтной строке считается
       несколько раз, и на большом кадре проверка уходит в минуты. Кадр
       рисуется синхронно и ложится в window.__aiFix; ответ вызова не нужен. */
    await js(`(function(){ try{
      const N=1200;
      const c=document.createElement('canvas'); c.width=N; c.height=N;
      const x=c.getContext('2d');
      const im=x.createImageData(N,N);
      for(let i=0;i<im.data.length;i+=4){
        im.data[i]=(i*7)%255; im.data[i+1]=(i*13)%255; im.data[i+2]=(i*29)%255; im.data[i+3]=255;
      }
      x.putImageData(im,0,0);
      window.__aiFix={b64:(c.toDataURL('image/jpeg',.95)||'').split(',')[1]||''}; window.__aiOut=null; window.__aiOutErr=null;
      return 1 }catch(e){ return 'ERR '+e.message } })()`);
    await sleep(100);
    /* Замер 1: кадр нарисован, вес тела до ужимания и потолок */
    await замер(`(function(){ try{ ${MK}
      return JSON.stringify({фикстура:!!(window.__aiFix&&window.__aiFix.b64.length>1000), before:aiBodySize(mk()), max:AI_BODY_MAX}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Ужимание — то, что aiFetch делает перед отправкой. Элемента у него нет,
       поэтому вызов функции; он async (кадр декодируется через Image), но его
       ответ никуда не идёт: результат ложится в window.__aiOut. */
    await js(`(async()=>{ try{ ${MK} window.__aiOut=await fitAiBody(mk()); }catch(e){ window.__aiOutErr=e.message } return 1 })()`);
    await sleep(200);
    /* Замер 2: ужатое тело — синхронно; его ещё нет — пустой ответ, и замер повторится */
    await замер(`(function(){ try{ const o=window.__aiOut;
      if(!o) return window.__aiOutErr?JSON.stringify({сбой:'fitAiBody: '+window.__aiOutErr}):'';
      return JSON.stringify({after:aiBodySize(o), кадров:aiImgParts(o).length}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`,
      'ужатое тело так и не появилось — fitAiBody не завершилось');
    /* Уборка: кадр и ужатое тело со страницы */
    await js(`(function(){ window.__aiFix=null; window.__aiOut=null; window.__aiOutErr=null; return 1 })()`);
    chk(!d.сбой,'замер ужимания сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.фикстура===true,'фикстура тяжёлого запроса не встала (кадр не нарисован) — проверка ужимания ничего не проверила');
      chk(d.before>d.max,'тестовая пачка кадров оказалась легче потолка ('+d.before+') — проверка ничего не значит');
      chk(d.after<d.before,'пачка фото ушла в сеть несжатой: '+d.before+' → '+d.after+' байт');
      chk(d.after<=d.max,'после ужимания тело всё ещё выше потолка: '+d.after+' байт при потолке '+d.max);
      chk(d.кадров===2,'при ужимании потерялись кадры: осталось '+d.кадров+' из 2');
    }
    if(process.env.BVDBG) console.log('   DBG ужимание: '+JSON.stringify(d));
  }
  drain();

  /* ── ПРИЛОЖЕНИЕ САМО ГОВОРИТ, ЧТО ВЫШЛА НОВАЯ ВЕРСИЯ ──
     Полевой вопрос владельца 19.08: «почему у меня до сих пор 281». Деплой был
     выкачен, но приложение молчало: новый service worker берёт управление, а
     открытая страница остаётся старой до полного перезапуска. Проверяем, что
     на ПЕРВОЙ установке полоски нет (иначе она встречала бы каждого новичка),
     а при появлении новой версии — есть, и она не закрывает навигацию. */
  if(TLS){
    // у position:fixed элементов offsetParent всегда null — меряем прямоугольник
    const bar=async()=>await js(`(function(){const e=document.getElementById('updBar');
      if(!e) return false; const r=e.getBoundingClientRect();
      return r.height>0&&getComputedStyle(e).display!=='none'})()`);
    chk((await bar())===false,'полоса «вышла новая версия» показана на первой установке — так она встретит каждого новичка');
    // имитируем ровно тот случай: контроллер уже есть, приехал новый SW
    await js(`(function(){ try{ showUpdateBar(); }catch(e){} })()`);
    await sleep(400);
    chk((await bar())===true,'приложение не сообщает о новой версии — человек остаётся на старой и не знает почему');
    const geom=await js(`(function(){const e=document.getElementById('updBar'),n=document.querySelector('nav');
      if(!e||!n) return null; const a=e.getBoundingClientRect(), b=n.getBoundingClientRect();
      return JSON.stringify({перекрываетНавигацию:a.bottom>b.top+1, ширеЭкрана:a.width>innerWidth,
        кнопка:!!document.getElementById('updGo')})})()`);
    const g=geom?JSON.parse(geom):null;
    chk(!!g,'полоса обновления не нашлась в разметке');
    if(g){
      chk(g.перекрываетНавигацию===false,'полоса обновления закрывает нижнюю навигацию');
      chk(g.ширеЭкрана===false,'полоса обновления шире экрана');
      chk(g.кнопка===true,'в полосе обновления нет кнопки — человеку нечего нажать');
    }
    await js(`(function(){const e=document.getElementById('updBar'); if(e) e.remove(); __updShown=false;})()`);
    drain();
  }

  /* ── СОСТОЯНИЕ ВИДНО, НЕ ЧИТАЯ ТЕКСТА ──
     Скриншот 19.08: невыполненные движения разминки были залитыми серыми
     кругами с галочкой — в любом другом приложении это читается как «уже
     сделано». Проверяем не разметку, а то, что видит глаз: у невыполненного
     кружок без заливки, у выполненного — заливка акцентом. */
  {
    await js(`goView('train')`); await sleep(700);
    /* Класс .on несёт ещё и анимацию «пыха» — читать стиль сразу после
       добавления нельзя, вернётся кадр анимации. Ждём и читаем отдельно. */
    /* Читаем ЗАЛИВКУ ВИДИМОГО КРУГА, а не фон самой кнопки: с v496 круг
       рисует ::before (зона нажатия 44, круг 30), и правило, смотревшее на
       кнопку, увидело бы прозрачное в обоих состояниях и сказало «не
       отличается» про экран, где всё видно. Правило меряет то, что человек
       видит, где бы это ни было нарисовано. */
    const flat=sel=>js(`(function(){const b=document.querySelector('${sel}'); if(!b) return '';
      const c=getComputedStyle(b), p=getComputedStyle(b,'::before');
      const clr=v=>v==='rgba(0, 0, 0, 0)'||v==='transparent';
      const bg=clr(c.backgroundColor)?p.backgroundColor:c.backgroundColor;
      return bg+'|'+c.color})()`);
    const off=await flat('.wcheck:not(.on)');
    await js(`(function(){const b=document.querySelector('.wcheck:not(.on)'); if(b) b.classList.add('on')})()`);
    await sleep(700);
    const on=await flat('.wcheck.on');
    const clear=v=>v==='rgba(0, 0, 0, 0)'||v==='transparent';
    const wc=(off&&on)?JSON.stringify({пустойБезЗаливки:clear(off.split('|')[0]),
      галочкаНеЯркая:off.split('|')[1]!==on.split('|')[1],
      выполненныйЗалит:!clear(on.split('|')[0])}):'';
    const w=wc?JSON.parse(wc):null;
    chk(!!w,'в тренировке нет ни одного чекбокса разминки — движение без отметки не выполняют');
    if(w){
      chk(w.пустойБезЗаливки===true,'невыполненное движение разминки залито — читается как «уже сделано», и человек его пропустит');
      chk(w.выполненныйЗалит===true,'выполненное движение ничем не отличается от невыполненного');
      chk(w.галочкаНеЯркая===true,'галочка у невыполненного такая же яркая, как у выполненного');
    }
    drain();
  }

  /* ── ОДНО ГЛАВНОЕ ДЕЙСТВИЕ НА РЯД ──
     На «Коуче» в один ряд стояли три кнопки трёх разных видов: залитая,
     серо-лаймовая и контурная — три приоритета у трёх равных действий.
     Глаз читает вес, а не подпись: если ярких две, не выделена ни одна. */
  {
    await js(`goView('coach')`); await sleep(700);
    const row=await js(`(function(){
      /* ПЕРЕПИСАНО 11.09 под «Коуч» v565. Плит входа .ecard больше нет:
         владелец переделал раздел в одну крупную кнопку действия плюс
         список строк, цвет ушёл в значок. Меряем то же по сути — что
         равные входы выглядят равными, а главное действие одно. */
      const hero=[...document.querySelectorAll('#v-coach .chero')].filter(x=>{
        const r=x.getBoundingClientRect(); return r.width>0&&r.height>0; });
      const rows=[...document.querySelectorAll('#v-coach .coachlst .lrow')].filter(x=>{
        const r=x.getBoundingClientRect(); return r.width>0&&r.height>0; });
      const hs=rows.map(x=>Math.round(x.getBoundingClientRect().height));
      /* «Залитая» — это то, что видит глаз: непрозрачный фон. Сверять с --ac
         по строке нельзя, браузер отдаёт rgb(), а токен — hex.
         Без регулярок: код уезжает в браузер внутри шаблонной строки, и
         обратный слэш там съедается — regexp тихо перестаёт совпадать. */
      const clear=v=>v==='rgba(0, 0, 0, 0)'||v==='transparent';
      const filledRows=rows.filter(x=>!clear(getComputedStyle(x).backgroundColor));
      /* Цвет живёт в значке, а не в заливке строки: у каждой функции свой. */
      const icons=rows.map(x=>x.querySelector('.li')).filter(Boolean);
      const iconColors=new Set(icons.map(x=>{const c=getComputedStyle(x);
        return c.backgroundColor+'|'+c.color+'|'+c.backgroundImage;}));
      return JSON.stringify({героев:hero.length, строк:rows.length,
        залитыхСтрок:filledRows.length, значков:icons.length, цветовЗначков:iconColors.size,
        высотаРазброс: hs.length?Math.max.apply(null,hs)-Math.min.apply(null,hs):0})})()`);
    const r=row?JSON.parse(row):null;
    chk(!!r,'на «Коуче» не удалось измерить входы раздела');
    if(r){
      /* Обещание то же, что охранялось у плит: равные входы выглядят равно
         важными, ни один не притворяется второстепенным, и ровно одно
         действие подано крупно. Разметка другая — правило под неё. */
      chk(r.героев===1,'крупных кнопок действия на «Коуче» '+r.героев+
        ' вместо одной — либо ежедневное действие утонуло, либо их стало несколько');
      chk(r.строк>=2,'строк входа на «Коуче» '+r.строк+' — список раздела потерялся');
      chk(r.высотаРазброс<=4,'строки «Коуча» разной высоты (разброс '+r.высотаРазброс+
        ' px) — равные входы выглядят по-разному важными');
      chk(r.залитыхСтрок===0,'у '+r.залитыхСтрок+' строк «Коуча» залит фон — цвет обязан жить в значке, иначе строка кричит громче остальных');
      chk(r.значков===r.строк,'значков у строк «Коуча» '+r.значков+' при '+r.строк+
        ' строках — строка без значка читается как чужая');
      /* Порог считается от числа ВИДИМЫХ строк: в простом режиме их две
         (остальные .pro скрыты), и жёсткая тройка уронила бы исправный
         экран. Требуем столько же цветов, сколько строк, но не больше
         четырёх — два значка серые осознанно (расход и отчёт). */
      var нужноЦветов=Math.min(4,Math.max(2,r.строк-2));
      chk(r.цветовЗначков>=нужноЦветов,'у значков «Коуча» всего '+r.цветовЗначков+
        ' разных цветов при '+r.строк+' строках — цвет перестал различать функции');
    }
    drain();
  }

  /* ── ДО ПЕРВОГО СОДЕРЖИМОГО НЕ ДОЛЖНО БЫТЬ СТЕНЫ ФИЛЬТРОВ ──
     На «Технике» одиннадцать чипов в четыре ряда съедали 350 px, и первое
     упражнение начиналось за сгибом. Меряем то, что видит глаз: попадает ли
     первая строка списка в экран без прокрутки. */
  /* v615: справочник живёт в «Коуче» карточкой «База знаний»; меряем то же —
     от шапки карточки до первой строки списка не должно быть стены фильтров. */
  {
    await js(`goView('coach')`); await sleep(700);
    await js(`(function(){ const k=document.getElementById('kbCard'); if(k){ k.open=true; k.scrollIntoView({block:'start'}); } })()`); await sleep(300);
    const geo=await js(`(function(){const l=document.getElementById('exList'), k=document.getElementById('kbCard');
      if(!l||!l.firstElementChild||!k) return '';
      const r=l.firstElementChild.getBoundingClientRect(), kr=k.getBoundingClientRect();
      const c=document.getElementById('exChips');
      return JSON.stringify({доПервого:Math.round(r.top-kr.top),экран:innerHeight,
        рядЧипов:c?Math.round(c.getBoundingClientRect().height):0})})()`);
    const g=geo?JSON.parse(geo):null;
    chk(!!g,'в «Коуче» нет списка упражнений (База знаний)');
    if(g){
      chk(g.доПервого<=160,'первая строка справочника в '+g.доПервого+' px от шапки «Базы знаний» — до содержимого стена фильтров');
      chk(g.рядЧипов<=70,'ряд чипов занял '+g.рядЧипов+' px — это несколько рядов, а не одна прокручиваемая строка');
    }
    await js(`(function(){ const k=document.getElementById('kbCard'); if(k) k.open=false; })()`);
    await js(`goView('train')`); await sleep(300);
    drain();
  }

  /* ГЛАВНАЯ ЦИФРА ДНЯ — НА ПЕРВОМ ЭКРАНЕ, ДАЖЕ В ХУДШЕМ СОСТОЯНИИ.
     Блоки над кольцами хороши по отдельности и не знают друг о друге. Стопка
     «баннер бэкапа» + «С возвращением» уносила кольца на y=726 при экране 667
     (iPhone SE): человек, вернувшийся после пропуска, открывал приложение и не
     видел ни калорий, ни воды — ровно того, ради чего открывал. Проверяем на
     САМОМ МАЛЕНЬКОМ распространённом экране и в САМОМ ХУДШЕМ состоянии: без
     синхронизации (баннер) и с дырой во вчера (карточка возвращения). */
  {
    // самый маленький распространённый экран, а не наш обычный 390x844
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:667,deviceScaleFactor:2,mobile:true});
    await js(`(async()=>{
      delete S.sbEmail; delete S.sbAt; delete S.gapAck; S.bkN=1;
      /* дыра во вчера: чистим ВСЕ три источника активности (еда, подходы,
         вес) — иначе gapInfo видит сегодняшнее взвешивание и молчит */
      const D0=td(), D1=ds(dn(td())-1);
      LOG=(LOG||[]).filter(l=>l.d!==D0&&l.d!==D1);
      SETS=(SETS||[]).filter(s=>s.d!==D0&&s.d!==D1);
      W=(W||[]).filter(w=>w.d!==D0&&w.d!==D1);
      await put('settings',S,'main'); renderAll();
      const b=document.querySelector('nav button[data-v="food"]'); if(b) b.click();
      window.scrollTo(0,0);
    })()`);
    await sleep(1200);
    /* v634: кольца нет — цифра дня живёт в таблице БЖУ (#macCard), её и меряем. */
    const fold=await js(`(function(){
      const r=document.getElementById('macCard'); if(!r) return '';
      const box=r.getBoundingClientRect();
      const bk=document.getElementById('bkWarn'), gb=document.getElementById('gapBox');
      return JSON.stringify({кольца:Math.round(box.top),экран:innerHeight,
        баннер:bk?Math.round(bk.getBoundingClientRect().height):0,
        возвращение:gb?Math.round(gb.getBoundingClientRect().height):0,
        возвращениеЕсть:!!(gb&&gb.textContent.trim())});})()`);
    const f=fold?JSON.parse(fold):null;
    chk(!!f,'на «Еде» нет карточки БЖУ — проверка первого экрана ничего не проверяет');
    if(f){
      chk(f.возвращениеЕсть,'карточка «С возвращением» не показалась — худшее состояние не воспроизвелось, проверка холостая');
      chk(f.кольца<f.экран-120,
        'цифра дня начинается за сгибом (y='+f.кольца+' при экране '+f.экран+'): над ней стоят баннер '+f.баннер+'px и «С возвращением» '+f.возвращение+'px — человек открыл приложение и не увидел ни калорий, ни воды');
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    drain();
  }

  /* ── ЦВЕТ ЗАКРЕПЛЁН ЗА ВЕЛИЧИНОЙ: ЧИСЛО И ЕГО ПОЛОСКА ОДНОГО ЦВЕТА ──
     Решение владельца 29.08 отменило правило «у акцента одна работа»: белок
     малиновый, жиры оранжевые, углеводы синие — везде, где эта величина
     показана. На «Еде» число уже красилось своей величиной, а полоска под
     ним оставалась лаймовой со времён монохрома: три разноцветных числа
     стояли над тремя одинаковыми зелёными полосками, и цвет переставал
     что-либо значить ровно там, где на него смотрят. Правило меряет ВЫХОД:
     заливка полоски совпадает с цветом числа над ней. Перебор (больше цели
     на 10 %) красит полоску тревожным — это состояние, не величина, и оно
     имеет право перебивать; такие полоски правило пропускает. */
  {
    await js(`goView('food')`); await sleep(700);
    const mac=await js(`(function(){
      const out=[], bad=[];
      /* v634: калории — первая строка той же таблицы (.kc), закон цвета тот же */
      document.querySelectorAll('#macBars .kc, #macBars .mc').forEach(mc=>{
        const v=mc.querySelector('.vl'), b=mc.querySelector('.bar>i');
        if(!v||!b) return;
        const nm=(mc.querySelector('.nm')||{}).textContent||'?';
        const cv=getComputedStyle(v).color, cb=getComputedStyle(b).backgroundColor;
        out.push(nm);
        if(cv!==cb) bad.push('«'+nm.trim()+'»: число '+cv+', полоска '+cb);
      });
      return JSON.stringify({полосок:out.length, плохо:bad});})()`);
    const m=mac?JSON.parse(mac):null;
    chk(m&&m.полосок===4,'на «Еде» не нашлось четырёх полосок (калории и три макроса), нашлось '+((m||{}).полосок)+
      ' — проверка цвета величины ничего не проверила');
    chk(m&&!m.плохо.length,'полоска макроса красится не своим цветом: '+((m||{}).плохо||[]).join(' · ')+
      ' — число говорит одно, полоска под ним другое');
    drain();
  }

  /* ── НИ ОДИН ЭКРАН ПРИЛОЖЕНИЯ НЕ МОЖЕТ БЫТЬ ПУСТЫМ ──
     Аудит 25.08 в настоящем браузере: «Тело → Прогресс» в простом режиме
     показывал 16 знаков собственного содержимого — две кнопки-переключателя и
     «Показать всё». Живая кнопка, ведущая в пустоту: обе панели «Прогресса»
     помечены как полный режим, а переключатель остался. Ни одно правило это
     не ловило, потому что все они смотрят логику, а не то, что видит человек.
     Обходим КАЖДУЮ вкладку и КАЖДУЮ подвкладку у свежего пользователя и
     требуем осмысленного содержимого. Порог 60 знаков — это примерно одна
     фраза: меньше означает, что человеку не сказали вообще ничего. */
  {
    const TABS=['Еда','Зал','Тело','Здоровье','Коуч'];
    for(const t of TABS){
      await js(`(()=>{const b=[...document.querySelectorAll('.nav button,nav button,[data-tab]')].find(x=>/${t}/.test(x.textContent||''));if(b)b.click();return 1})()`);
      await sleep(700);
      const raw=await js(`(()=>{
        const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document;
        return JSON.stringify([...v.querySelectorAll('.seg button')].filter(b=>{
          const st=getComputedStyle(b), r=b.getBoundingClientRect();
          return st.display!=='none'&&r.width>0;
        }).map(b=>b.textContent.trim()));
      })()`);
      let segList=[]; try{ segList=JSON.parse(raw); }catch(e){}
      for(const sg of segList){
        await js(`(()=>{const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document;
          const b=[...v.querySelectorAll('.seg button')].find(x=>x.textContent.trim()===${JSON.stringify(sg)});if(b)b.click();return 1})()`);
        await sleep(600);
        const got=await js(`(()=>{
          const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document.body;
          const vis=el=>{const st=getComputedStyle(el);const r=el.getBoundingClientRect();
            return st.display!=='none'&&st.visibility!=='hidden'&&r.width>0&&r.height>0};
          let txt='';
          v.querySelectorAll('*').forEach(el=>{ if(el.children.length===0&&vis(el)&&el.textContent.trim()) txt+=el.textContent.trim()+' | '; });
          const seg=[...v.querySelectorAll('.seg button')].map(b=>b.textContent.trim()).join(' | ')+' | ';
          return String(txt.split(seg).join('').replace(/Показать всё[^|]*\|/,'').trim().length);
        })()`);
        /* Мерим НЕ длину текста. Метрика в знаках сама гонит писать прозу —
           доказано на живом случае 25.08: правило «не меньше 60 знаков»
           породило три пронумерованных абзаца там, где хватало графика.
           Экран считается живым, если на нём есть действие (кнопка или поле)
           ЛИБО данные — цифра, метка, состояние. Слова здесь ни при чём. */
        const alive=await js(`(()=>{
          const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document.body;
          const vis=el=>{const st=getComputedStyle(el);const r=el.getBoundingClientRect();
            return st.display!=='none'&&st.visibility!=='hidden'&&r.width>0&&r.height>0};
          const act=[...v.querySelectorAll('button,input,select,textarea,[role=button]')]
            .filter(el=>vis(el)&&!el.closest('.seg')&&!/Показать всё/.test(el.textContent||'')).length;
          const data=[...v.querySelectorAll('.bn,.bnum,.stat,.item,canvas,svg,.chip,.empty,h2')]
            .filter(vis).length;
          return act+':'+data;
        })()`);
        const [act,data]=String(alive).split(':').map(x=>+x||0);
        chk(act+data>0,'экран «'+t+' → '+sg+'» пуст: ни одного действия и ни одной цифры — человек нажал кнопку и не получил ничего');
      }
    }
    drain();
  }

  /* ── ЗАКОН ЭКРАНА: ИНТЕРФЕЙС НЕ ОБЪЯСНЯЕТ САМ СЕБЯ ──
     Правило владельца 25.08: «представь, чтобы в инстаграме под лайком была
     надпись "нажмите сюда, если вам нравится это фото"». Замер тогда показал
     756 знаков прозы по приложению: 492 в «Коуче», 151 в «Теле», 113 в «Зале».
     Граница: подпись, объясняющая ИНТЕРФЕЙС, удаляется навсегда; объяснение,
     откуда взялась ЦИФРА, живёт за жестом — то есть внутри .note или .empty.
     Проверяем ВЫХОД: на видимом экране не должно быть длинных фраз вне них. */
  {
    const TABS2=['Еда','Зал','Тело','Здоровье','Коуч'];
    /* ── ПРАВИЛО ХОДИТ ПО ПОДВКЛАДКАМ, А НЕ ПО ПЯТИ ГЛАВНЫМ ЭКРАНАМ ──
       Аудит 27.08: правило смотрело только то, что открывается по умолчанию,
       и молчало про «Тело → Прогресс», «Зал → Разбор», «Здоровье → Анализы».
       А человек живёт именно там: из пятнадцати экранов проверялись пять.
       И вторая дыра, крупнее: исключение было выписано на КЛАСС (.note,
       .empty), а не на жест. Любую лекцию достаточно было завернуть в .note —
       и правило зеленело. Оно и зеленело: «Сантиметр честнее весов…»,
       «Сделай первое фото — это точка отсчёта. Весы врут на дефиците…»,
       и пустое состояние анализов на 36 слов, которое ТЕКСТОМ показывало
       пальцем на раскрывашку ниже. Это и есть «нажмите сюда, если вам
       нравится это фото».
       Граница теперь по смыслу, и она проверяема:
       · .empty — это ПРЕДЛОЖЕНИЕ ДЕЙСТВИЯ, не лекция: не длиннее 12 слов;
       · .note — объясняет ЦИФРУ, которая рядом. Нет цифры в карточке —
         значит это инструкция к интерфейсу, и её место за жестом;
       · всё остальное длиннее 9 слов на виду — нарушение.
       Данные со знаком «·» (мышцы дня, состав) прозой не считаем: меряем
       самый длинный кусок между разделителями. */
    const SCAN=`(()=>{
      const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document.body;
      const vis=el=>{const st=getComputedStyle(el);const r=el.getBoundingClientRect();
        return st.display!=='none'&&st.visibility!=='hidden'&&r.width>0&&r.height>0};
      const words=t=>Math.max.apply(null,String(t).split('·').map(x=>x.trim().split(/\\s+/).filter(Boolean).length));
      const out=[];
      v.querySelectorAll('.empty').forEach(e=>{ if(!vis(e))return;
        const t=(e.textContent||'').replace(/\\s+/g,' ').trim(); const w=words(t);
        if(w>12) out.push('пустое состояние длиннее одной строки (слов: '+w+') — «'+t.slice(0,70)+'…»'); });
      /* Считаем СВОЙ текст элемента, а не textContent: проза почти всегда
         лежит прямо в карточке рядом с <b> и <br>, и проверка «только листья»
         не видела её вовсе — поймано 27.08 на карточке разгрузки. */
      v.querySelectorAll('*').forEach(el=>{
        if(!vis(el)) return;
        if(el.closest('.empty')||el.closest('button')||el.closest('summary')||el.closest('details:not([open])')) return;
        /* Берём САМЫЙ ДЛИННЫЙ кусок собственного текста, а не их склейку:
           у списка «<b>Плечи</b> — 0 подх/нед; <b>Спина</b> — 2 подх/нед»
           склейка выглядит абзацем на полсотни слов, хотя это данные.
           Живая фраза всегда лежит одним куском. */
        let t=''; el.childNodes.forEach(n=>{ if(n.nodeType===3){
          const p=String(n.nodeValue).replace(/\\s+/g,' ').trim(); if(p.length>t.length) t=p; } });
        if(!t) return;
        const w=words(t); if(w<10) return;
        const note=el.closest('.note');
        if(note){
          const card=note.parentElement;
          const around=card?(card.textContent||'').replace(note.textContent||'',''):'';
          if(/\\d/.test(around)) return;
          out.push('инструкция к интерфейсу (слов: '+w+') — «'+t.slice(0,70)+'…»'); return;
        }
        out.push('проза вне жеста (слов: '+w+') — «'+t.slice(0,70)+'…»');
      });
      return JSON.stringify(out);
    })()`;
    /* ── ЭКРАН СМОТРИМ И ПОЛНЫМ, И ПУСТЫМ ──
       Мутация 27.08 это и поймала: я вернул в пустое состояние анализов
       лекцию на 36 слов, а правило осталось зелёным. Потому что к тому
       моменту в приложении уже лежал восстановленный бэкап — анализы были,
       и пустого состояния на экране просто не существовало. Проверять
       пустые состояния на человеке с данными нельзя: их видит НОВИЧОК,
       и ровно он от них уходит. */
    /* И смотрим в ПОЛНОМ режиме: в простом часть экранов (Режим, прогресс-фото,
       техника) просто не существует, и лекция на них правилу не видна.
       Поймано мутацией: вернул абзац на «Тело → Прогресс» — правило смолчало,
       потому что карточка помечена .pro. Полный режим — надмножество. */
    /* Прежний режим — отдельным синхронным чтением с повтором, запись — своим
       шагом, её ответ не нужен (форма CRAFT, 04.09). */
    let uiBefore=await js(`(function(){ return S.ui||'' })()`); if(typeof uiBefore!=='string'){ await sleep(400); uiBefore=await js(`(function(){ return S.ui||'' })()`); }
    if(typeof uiBefore!=='string') uiBefore='';
    await js(`(async()=>{ try{ S.ui='pro'; applyUI(); await put('settings',S,'main'); }catch(e){} return 1 })()`);
    await sleep(400);
    /* Третье состояние: особые режимы программы. Мезоцикл, разгрузка и план
       тренера рисуют СВОИ блоки, до которых обычный проход не доходит вовсе —
       строка «Цикл 1, неделя 1 из 4. Каждую неделю объём растёт…» висела на
       каждом экране зала каждый день и правилу была не видна (аудит 27.08). */
    for(const pass of ['с данными','особый режим','пустой']){
    if(pass==='особый режим') await js(`(()=>{ try{
      if(S.prog){ S.prog.meso={n:1,from:ds(dn(td())-7)}; }
      S.deload={from:ds(dn(td())-1),until:ds(dn(td())+3),m:'all',src:'ai'};
      renderAll();
      }catch(e){} return 1 })()`), await sleep(900);
    /* Пустой проход обязан ПЕРЕРИСОВАТЬ экран. Первая версия просто чистила
       массивы и кликала по подвкладке — а подвкладка только переключает
       display, рендер не зовёт. Правило смотрело на вчерашний DOM и не
       видело ни одного пустого состояния. */
    if(pass==='пустой'){ await js(`(()=>{ try{ delete S.deload; if(S.prog) delete S.prog.meso;
      [LABS,SUBS,M,SETS,LOG,SLP,STEPS,RDY].forEach(a=>{ if(Array.isArray(a)) a.length=0 });
      renderAll();
      }catch(e){} return 1 })()`); await sleep(900); }
    for(const t of TABS2){
      await js(`(()=>{const b=[...document.querySelectorAll('.nav button,nav button,[data-tab]')].find(x=>/${t}/.test(x.textContent||''));if(b)b.click();return 1})()`);
      await sleep(700);
      let subs=[];
      try{ subs=JSON.parse(await js(`(()=>{const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document.body;
        const vis=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&r.width>0};
        return JSON.stringify([...v.querySelectorAll('.seg button')].filter(vis).map(b=>b.textContent.trim()).slice(0,7))})()`)||'[]'); }catch(e){}
      for(const sb of [null].concat(subs)){
        if(sb){ await js(`(()=>{const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document.body;
          const b=[...v.querySelectorAll('.seg button')].find(x=>x.textContent.trim()===${JSON.stringify(sb)});
          if(b)b.click(); return 1})()`); await sleep(700); }
        const where=t+(sb?' → '+sb:'')+' ('+pass+')';
        if(process.env.BVDBG) console.log('   скан:',where);
        /* Разбор ответа не глотаем молча: сломанный SCAN возвращал строку
           с ошибкой, JSON.parse падал, bad оставался пустым — и правило
           зеленело при любом нарушении. Так оно и стояло, пока мутация не
           показала. */
        let bad=null; const _raw=await js(SCAN);
        try{ bad=JSON.parse(_raw||'[]'); }catch(e){}
        chk(Array.isArray(bad),'скан экрана «'+where+'» не отдал список — правило смотрит в пустоту: '+String(_raw).slice(0,80));
        if(!Array.isArray(bad)) bad=[];
        chk(bad.length===0,'экран «'+where+'»: '+(bad[0]||'')
          +' Интерфейс не объясняет сам себя: подпись-инструкция удаляется, объяснение цифры живёт за жестом');
        /* ── КАРТОЧКА, КОТОРАЯ МОЛЧИТ ──
           Аудит 27.08: «Здоровье → Препараты» у новичка — заголовок «Приём
           добавок», кнопка и две трети чёрного экрана. Пустое состояние в
           коде было — `<div class="note">Отметь первый приём…`, — но `.note`
           без класса `.keep` скрыт правилом стилей всегда. То есть текст
           писали, тестом не мерили, и человек его не видел ни разу.
           Правило простое и на выходе: у новичка видимая карточка обязана
           сказать либо данные, либо «пока пусто». Заголовок с кнопкой — не
           ответ на вопрос «а что тут вообще происходит». */
        if(pass==='пустой'){
          let mute=[];
          try{ mute=JSON.parse(await js(`(()=>{
            const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document.body;
            const vis=el=>{const st=getComputedStyle(el);const r=el.getBoundingClientRect();
              return st.display!=='none'&&st.visibility!=='hidden'&&r.width>0&&r.height>0};
            const out=[];
            v.querySelectorAll('.card').forEach(c=>{
              if(!vis(c)||c.querySelector('.card')) return;
              if(c.querySelector('.empty')&&vis(c.querySelector('.empty'))) return;
              const hd=c.querySelector('.hd'), name=((hd&&hd.textContent)||(c.textContent||'')).trim().slice(0,30);
              let body='';
              [...c.children].forEach(el=>{ if(el===hd||!vis(el)) return; body+=(el.textContent||''); });
              body=body.replace(/\\s+/g,'').trim();
              const acts=[...c.querySelectorAll('input,select,textarea,canvas,svg,details')].filter(vis).length;
              if(body.length<3&&!acts) out.push(name);
            });
            return JSON.stringify(out);
          })()`)||'[]'); }catch(e){}
          chk(mute.length===0,'экран «'+where+'»: карточка «'+(mute[0]||'')
            +'» у новичка молчит — заголовок и кнопка, а что тут происходит и с чего начать, не сказано ничем');
        }
        /* Вторая сторона того же закона: жест обязан ПРЯТАТЬ. Замер 25.08:
           закрытая раскрывашка «Что делает каждая кнопка» (open:false) занимала
           318x166 пикселей — класс .keep перебивал скрытие. */
        let lk=[];
        try{ lk=JSON.parse(await js(`(()=>{
          const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document.body;
          const out=[];
          v.querySelectorAll('details:not([open])').forEach(d=>{
            [...d.children].forEach(el=>{
              if(el.tagName==='SUMMARY') return;
              const r=el.getBoundingClientRect();
              if(r.height>2&&r.width>2) out.push((el.textContent||'').trim().slice(0,50));
            });
          });
          return JSON.stringify(out);
        })()`)||'[]'); }catch(e){}
        chk(lk.length===0,'экран «'+where+'»: свёрнутая раскрывашка показывает содержимое — «'
          +(lk[0]||'')+'…». Шеврон обещает спрятанный текст, а текст лежит на экране');
        /* ── НА РАБОЧЕМ ЭКРАНЕ НЕТ НИ ОДНОЙ СТРОКИ «ПОДРОБНЕЕ» ──
           Полевой отчёт владельца 31.08 по «Тело → Шаги и сон»: «эта вся
           лишняя вода с подробнее и твои тексты — мы о них начинаем забывать
           на важных экранах, и меня и жену они просто раздражают». Замер:
           125 подсказок, 26 798 символов, и на одной подвкладке ТРИ строки
           «Подробнее» подряд. Прошлое правило разрешало прозу «за жестом» —
           но сам жест и есть мебель: он стоит вечно, а объяснение читают один
           раз. Теперь объяснение живёт в «Настройки → Справка», а на рабочем
           экране его нет вовсе. Меряем ВЫХОД: ни кнопки, ни пикселя. */
        let wtr=[];
        try{ wtr=JSON.parse(await js(`(()=>{
          const v=[...document.querySelectorAll('section.view')].find(x=>x.classList.contains('on'))||document.body;
          const vis=el=>{const st=getComputedStyle(el);const r=el.getBoundingClientRect();
            return st.display!=='none'&&st.visibility!=='hidden'&&r.width>0&&r.height>0};
          const out=[];
          /* Кнопку ищем по ВСЕМУ документу, а не в текущем экране: с 31.08
             её нет и в листах настроек тоже — «убери и в настройках, везде». */
          document.querySelectorAll('.hintq').forEach(b=>{ out.push('строка «'+(b.textContent||'').trim()+'»'); });
          v.querySelectorAll('.note:not(.keep)').forEach(n=>{ if(!vis(n)) return;
            out.push('подсказка на '+Math.round(n.getBoundingClientRect().height)+' px — «'+(n.textContent||'').replace(/\\s+/g,' ').trim().slice(0,50)+'…»'); });
          return JSON.stringify(out);
        })()`)||'[]'); }catch(e){}
        chk(wtr.length===0,'экран «'+where+'»: '+(wtr[0]||'')
          +' — проза вернулась на рабочий экран. Её место в «Настройки → Справка»: объяснение читают один раз, а строка стоит вечно');
      }
    }
    }
    await js(`(async()=>{ S.ui=${JSON.stringify(uiBefore||'')}; applyUI(); await put('settings',S,'main'); return 1 })()`);
    drain();
  }

  /* ── СПИСОК, А НЕ ЛЕНТА, И СТРОКА ПЛОТНАЯ ──
     Полевой отчёт владельца 27.08, два захода. Сначала: «блюда и продукты
     занимают слишком много места» — семь строк по 135 px, 841 из 1844 на
     странице. Я ответил горизонтальной лентой, и это была ошибка: «в первую
     очередь мы всегда вводим продукты, которые были в нашем рационе, и лучше
     чтоб он открывался списком, а не листанием вбок; список того, что я ем,
     уже внушителен». Он прав, и так же устроены MyFitnessPal, Cronometer,
     Lifesum, MacroFactor, Yazio — вертикальный список своих продуктов.
     Высота решается ПЛОТНОСТЬЮ строки, а не разворотом: 60 px вместо 135.
     Правило держит оба требования сразу. */
  {
    /* Список своих продуктов проверяем на человеке, у которого они ЕСТЬ:
       у пустого пользователя там законно пусто, и правило мерило бы не то. */
    await js(`(async()=>{ try{
      for(const [n,k,p2,f2,c2] of [['Творог 5%',121,17,5,1.8],['Куриная грудка',165,31,3.6,0],['Рис отварной',130,2.7,0.3,28]])
        await put('foods',{n,u:100,un:'г',k,p:p2,f:f2,c:c2,used:5,last:150});
      FOODS=await all('foods'); rFood(); }catch(e){} return 1 })()`);
    await sleep(900);
    await js(`(()=>{const b=[...document.querySelectorAll('.nav button,nav button,[data-tab]')].find(x=>/Еда/.test(x.textContent||''));if(b)b.click();return 1})()`);
    await sleep(800);
    /* v636: список своих живёт в листе записи (на первом экране его нет по решению автора) */
    await js(`(function(){ try{ openFind(); }catch(e){} return 1 })()`); await sleep(600);
    let m=null;
    try{ m=JSON.parse(await js(`(()=>{
      const rows=[...document.querySelectorAll('#qList2 .qrow')].filter(e=>e.getBoundingClientRect().height>0);
      if(!rows.length) return JSON.stringify({нет:true,лента:!!document.querySelector('#qList2 .qstrip')});
      const r0=rows[0].getBoundingClientRect(), r1=rows[1]?rows[1].getBoundingClientRect():null;
      return JSON.stringify({строк:rows.length,высота:Math.round(r0.height),
        вертикально:r1?(r1.top>r0.top+4&&Math.abs(r1.left-r0.left)<2):true});
    })()`)||'null'); }catch(e){}
    await js(`(function(){ try{ while(NAV.stack.length) navPop('code'); }catch(e){} return 1 })()`); await sleep(300);
    chk(!!(m&&!m.нет),'в листе записи нет списка своих продуктов'+(m&&m.лента?' — вместо него снова горизонтальная лента':'')
      +'. Человек записывает то, что ест обычно, и это список, а не карусель');
    if(m&&!m.нет){
      chk(m.вертикально===true,'подсказки на «Еде» выложены вбок — список читается глазами целиком, лента только по одному элементу');
      chk(m.высота<=72,'строка списка выросла до '+m.высота+' px — при таком росте пять позиций съедают экран, и всё начинается сначала');
      chk(m.строк>=3,'в списке своих продуктов '+m.строк+' строк — подсказывать нечем');
    }
    /* ── РЯД ДЕЙСТВИЙ НЕ ЛОМАЕТСЯ ──
       Четыре кнопки в сетке на три колонки: четвёртая уезжала на свою строку,
       а «Что съесть» вставало в два ряда — ряд читался как сломанный
       (полевой отчёт владельца 27.08). Сетка 2×2: каждая подпись в одну
       строку, высоты равные. Правило меряет ВЫХОД — высоты кнопок. */
    /* Ряд действий помечен «полный режим»: в простом его нет вовсе, и правило
       мерило бы пустоту. Включаем полный на время замера. */
    let _uiWas4=await js(`(function(){ return S.ui||'' })()`); if(typeof _uiWas4!=='string'){ await sleep(400); _uiWas4=await js(`(function(){ return S.ui||'' })()`); }
    if(typeof _uiWas4!=='string') _uiWas4='';
    await js(`(async()=>{ try{ S.ui='pro'; applyUI(); await put('settings',S,'main'); }catch(e){} return 1 })()`);
    await sleep(500);
    let ch4=null;
    await js(`(function(){ try{ openFind(); }catch(e){} return 1 })()`); await sleep(500);   // v636: четыре кнопки — чипы в листе записи
    try{ ch4=JSON.parse(await js(`(()=>{
      const ids=['bRec','bMeal','bShop','bPantry'], out=[];
      for(const id of ids){ const e=document.getElementById(id); if(!e) return JSON.stringify({нет:id});
        const r=e.getBoundingClientRect(); if(r.height<4) return JSON.stringify({скрыт:id});
        const c=getComputedStyle(e);
        const пх=(parseFloat(c.paddingTop)||0)+(parseFloat(c.paddingBottom)||0)
                +(parseFloat(c.borderTopWidth)||0)+(parseFloat(c.borderBottomWidth)||0);
        out.push({id,h:Math.round(r.height),lh:Math.round(parseFloat(c.lineHeight)||20),
          пх:Math.round(пх), мин:Math.round(parseFloat(c.minHeight)||0)}); }
      return JSON.stringify({btn:out});
    })()`)||'null'); }catch(e){}
    if(ch4&&ch4.btn){
      const hs=ch4.btn.map(b=>b.h), lh=ch4.btn[0].lh;
      chk(Math.max.apply(null,hs)-Math.min.apply(null,hs)<=1,
        'кнопки действий на «Еде» разной высоты ('+hs.join('/')+') — значит одна из подписей переносится, и ряд читается как сломанный');
      /* ПОРОГ ПЕРЕСЧИТАН 11.09. Было «высота не больше 1.8 строки» — правило
         сравнивало высоту КНОПКИ с высотой ТЕКСТА и не знало ни про отступы,
         ни про минимум 44 px, который мы задали осознанно ради пальца. На
         исправном ряду оно давало 44 против порога 36 и кричало о переносе,
         которого нет. Считаем предел честно: одна строка плюс собственные
         отступы кнопки, но не меньше её же минимальной высоты. */
      const пред=ch4.btn.map(b=>Math.max(b.мин,b.lh+b.пх)+1);
      const виновен=ch4.btn.map((b,i)=>b.h>пред[i]?(b.id+' высота '+b.h+' при пределе '+пред[i]):null).filter(Boolean);
      chk(!виновен.length,'подпись кнопки действий встала в две строки: '+виновен.join(', '));
    }
    await js(`(function(){ try{ while(NAV.stack.length) navPop('code'); }catch(e){} return 1 })()`); await sleep(300);
    /* ── КРАЯ ВЫРОВНЕНЫ (долг v459 закрыт 30.08) ──
       Полевой отчёт владельца 28.08 со скриншотом «Зала»: «всё так хаотично,
       ничего не выровнено». Замер тогда: пять разных левых краёв на одном
       экране (16 · 20 · 36 · 52). Причины починены, а ПРАВИЛА не было: обе
       прежние версии свою мутацию не поймали, потому что мерили пустоту —
       стенд видел «Зал» без программы, боли и разминки, и нужные блоки просто
       не рисовались. Правило, не поймавшее мутацию, — не правило (CRAFT).
       Теперь фикстура ЗАДАЁТ состояние явно: программа собрана, сегодня
       тренировочный день, мезоцикл заведён, движение помечено больным,
       разминка раскрыта. И только потом замер.
       Меряем то, что видит глаз: карточки экрана стоят на ОДНОМ левом крае,
       и внутри карточки её блоки — тоже на одном. Инлайн-текст не считаем:
       у него край свой по месту в строке. */
    await js(`(async()=>{ try{
      if(!S.prog||!S.prog.plan||!S.prog.plan.length)
        S.prog=genProgram({days:3,equip:'gym',goal:'hyper',exp:'mid',inj:[],dows:[1,2,3,4,5,6,7]});
      const tw=dowOf(td()), P=S.prog;
      if(!P.plan.some(x=>x.dow===tw&&(x.ex||[]).some(e=>!e.hidden))){
        const d=P.plan.find(x=>(x.ex||[]).some(e=>!e.hidden))||P.plan[0];
        const z=P.plan.find(x=>x.dow===tw); if(z) z.dow=d.dow; d.dow=tw; }
      mesoInit(P);
      const day=P.plan.find(x=>x.dow===tw)||P.plan[0];
      const nm=((day.ex||[]).filter(e=>!e.hidden)[0]||{}).n||null;
      S.pain=S.pain||{}; if(nm) S.pain[nm]=1;
      S.wuOpen=true;
      await put('settings',S,'main'); renderAll();
      return 1;
    }catch(e){ return 'ERR '+((e&&e.message)||e) }})()`);
    await sleep(600);
    /* Спрашиваем СОСТОЯНИЕ, а не ответ предыдущего вызова. Прогон 30.08 один
       раз получил на фикстуру пустой ответ (контекст страницы отвечает не
       всегда) и правило упало на ровном месте — то самое мигание, которое
       мы сегодня чинили в другом месте. Ответ вызова — это путь, состояние —
       это выход; правило меряет выход. */
    const сост=await js(`JSON.stringify({
      программа:!!(S.prog&&S.prog.plan&&S.prog.plan.some(d=>(d.ex||[]).length)),
      мезоцикл:!!(S.prog&&S.prog.meso),
      боль:Object.keys(S.pain||{}).length,
      разминка:!!S.wuOpen})`);
    let _st=null; try{ _st=JSON.parse(сост); }catch(_){}
    chk(_st&&_st.программа&&_st.мезоцикл&&_st.боль>0&&_st.разминка,
      'не удалось привести «Зал» в состояние с программой, мезоциклом, болью и разминкой ('+
      String(сост)+') — правило про края мерило бы пустоту');
    await js(`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`);
    await sleep(700);
    for(const вк of ['log','prog']){
      await js(`(document.querySelector('#v-train [data-tr="${вк}"]')||{click(){}}).click()`);
      await sleep(900);
      let кр=null;
      try{ кр=JSON.parse(await js(`(()=>{
        const v=document.getElementById('v-train'); if(!v) return JSON.stringify({нет:1});
        const блок=e=>{ const st=getComputedStyle(e);
          return /block|flex|grid|list-item/.test(st.display)&&st.position!=='absolute'&&st.position!=='fixed'; };
        const виден=e=>{ const r=e.getBoundingClientRect(); return r.height>8&&r.width>8&&e.offsetParent!==null; };
        const имя=e=>(e.textContent||'').replace(/[ ]+/g,' ').trim().slice(0,22);
        const карточки=[...v.querySelectorAll('.card,.wc')].filter(e=>виден(e)&&блок(e)
          && !e.parentElement.closest('.card,.wc'));
        const края=[...new Set(карточки.map(e=>Math.round(e.getBoundingClientRect().left)))].sort((a,b)=>a-b);
        const внутри=[];
        карточки.forEach(c=>{
          const дети=[...c.children].filter(e=>виден(e)&&блок(e));
          const kk=[...new Set(дети.map(e=>Math.round(e.getBoundingClientRect().left)))].sort((a,b)=>a-b);
          if(kk.length>1) внутри.push(имя(c)+': '+kk.join('/'));
        });
        return JSON.stringify({карточек:карточки.length,края,внутри:внутри.slice(0,4),
          пример:карточки.slice(0,3).map(имя)});
      })()`)||'null'); }catch(e){}
      /* Замер 30.08: обе подвкладки давали 4 и 3 карточки верхнего уровня.
         С v512 под тренировкой остались шапка-обёртка и «Первые две недели»:
         «Закрыть тренировку» ушла в лист, активность и история — в «Разбор»
         (закон двух экранов). Двух карточек с детьми для замера краёв
         достаточно; ноль или одна — по-прежнему «состояние не задалось». */
      /* v518: «Первые две недели» под тренировкой стоит только пока следующий
         шаг — действие вне зала; в фикстуре программа есть, значит остаётся
         одна карточка-обёртка с шестью упражнениями внутри — края внутри неё
         правило меряет по-прежнему. Состояние проверяем по числу упражнений. */
      const мин=вк==='log'?1:3;
      if(вк==='log'){ const упр=await js(`document.querySelectorAll('#nextBox .wc').length`);
        chk(упр>=3,'на подвкладке «log» видно упражнений: '+упр+' — состояние не задалось, правило про края мерило бы пустоту'); }
      const дней=await js(`(()=>{ try{ return String(workoutDays())+' дн. с подходами: '+[...new Set((SETS||[]).map(s=>s.d))].sort().join(',') }catch(e){ return '?' } })()`);
      chk(кр&&кр.карточек>=мин,'на подвкладке «'+вк+'» видно карточек: '+((кр&&кр.карточек)||0)+' при минимуме '+мин
        +' — правило про края смотрело бы в пустоту (состояние не задалось); видно: '+JSON.stringify((кр&&кр.пример)||[])+'; '+дней);
      if(кр&&кр.карточек>=мин){
        chk(кр.края.length===1,'на подвкладке «'+вк+'» карточки стоят на '+кр.края.length
          +' разных левых краях ('+кр.края.join('/')+' px) — это и есть «всё хаотично, ничего не выровнено»');
        chk(!кр.внутри.length,'внутри карточки блоки разъехались по краям: '+кр.внутри.join(' · '));
      }
    }
    await js(`(async()=>{ S.pain={}; S.wuOpen=false; await put('settings',S,'main'); renderAll(); return 1 })()`);
    await sleep(400);

    /* ── ПУСТОТА НЕ ЗАНИМАЕТ МЕСТО ──
       Полевой отчёт владельца 27.08 со скриншотом: «когда в дневник ещё не
       внесена запись, оно занимает слишком много места с кружком в середине;
       прошу, чтобы просто так, когда данных нет, место не занималось».
       Декоративный кружок ◌ и отступы 24px делали из одной строки блок на
       180 px. Пустое состояние — одна строка, и это меряется в пикселях. */
    let emp=null;
    try{ emp=JSON.parse(await js(`(()=>{
      const v=document.body;
      const out=[];
      v.querySelectorAll('.empty').forEach(e=>{ const r=e.getBoundingClientRect();
        if(r.height<4) return;
        out.push({h:Math.round(r.height),t:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,30)}); });
      return JSON.stringify(out);
    })()`)||'null'); }catch(e){}
    if(Array.isArray(emp)) emp.forEach(x=>
      chk(x.h<=60,'пустое состояние «'+x.t+'» занимает '+x.h+' px — когда данных нет, место занимать нечем'));
    await js(`(async()=>{ S.ui=${JSON.stringify(_uiWas4||'')}; applyUI(); await put('settings',S,'main'); return 1 })()`);
    await sleep(400);
    drain();
  }

  /* ── ГЛАВНЫЙ ВВОД ДОСТУПЕН БЕЗ ПРОКРУТКИ ──
     Полевой отчёт владельца 27.08: «тот ввод, который внизу сейчас, точно не
     будет использоваться, не удобен». Замер: после переноса дневника наверх
     поле поиска оказалось на 1031-й точке страницы — до главного ежедневного
     действия надо было прокрутить 263 px. Экран открывают, чтобы записать
     еду, а запись оказалась дальше всего.
     Правило меряет ВЫХОД: на «Еде» без единой прокрутки видны все три входа
     (поиск, голос, камера), и они в нижней трети экрана — там, где до них
     дотягивается большой палец. */
  {
    await js(`(()=>{const b=document.querySelector('nav button[data-v="food"]'); if(b)b.click(); window.scrollTo(0,0); return 1})()`);
    await sleep(700);
    let e=null;
    try{ e=JSON.parse(await js(`(()=>{
      const nav=document.querySelector('nav');
      const navTop=nav?nav.getBoundingClientRect().top:innerHeight;
      const out={};
      [['поиск','qSearch'],['голос','bVoice'],['камера','bScan']].forEach(([n,id])=>{
        const el=document.getElementById(id);
        if(!el){ out[n]='нет на экране'; return; }
        const r=el.getBoundingClientRect(), st=getComputedStyle(el);
        if(st.display==='none'||r.width<8||r.height<8){ out[n]='скрыт'; return; }
        if(r.top<0||r.bottom>navTop+1){ out[n]='за пределами первого экрана ('+Math.round(r.top)+'px)'; return; }
        out[n]=(r.top>=innerHeight*0.55)?'ок':'выше зоны большого пальца ('+Math.round(r.top)+'px)';
      });
      return JSON.stringify(out);
    })()`)||'null'); }catch(err){}
    chk(!!e,'ввод еды измерить не удалось — правило смотрит в пустоту');
    if(e) Object.keys(e).forEach(k=>
      chk(e[k]==='ок','ввод еды: «'+k+'» — '+e[k]
        +'. Запись еды это главное ежедневное действие: все три входа обязаны быть видны без прокрутки и в нижней трети экрана'));
    drain();
  }

  /* ── ЗАКРЫТОЕ СОЕДИНЕНИЕ С БАЗОЙ НЕ РАВНО ПОТЕРЯННОМУ ЗАПУСКУ ──
     Настоящая запись с телефона владельца 28.08 (iPhone, Safari 18.7):
     «Attempt to get records from database without an in-progress
     transaction». Safari закрывает соединение сам — вкладка висела в фоне,
     страница вернулась из bfcache, система освободила память. Для человека
     это белый экран «Не удалось запустить» при целых данных.
     Переоткрытие живёт в dbTry (одно место на все операции с базой).
     Правило меряет ВЫХОД: закрываем соединение нарочно и требуем, чтобы
     чтение прошло и вернуло ТЕ ЖЕ данные, а не пустоту. С 04.09 — по форме
     CRAFT: закрытие, чтение и замер — отдельные короткие вызовы, а не ответ
     одного длинного. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного
       (CRAFT 04.09): «было» — синхронный замер до закрытия; db.close() —
       отдельный вызов (элемента у него нет: это то, что делает Safari сам),
       он же тут же проверяет, что соединение и правда закрыто; loadAll() —
       отдельный async-вызов, исход которого страница кладёт в
       window.__dbReopen, на его ответ ни одна проверка не опирается;
       «стало» — синхронный замер после, с одним повтором, если страница
       промолчала или чтение ещё шло. Между закрытием и чтением паузы нет
       нарочно: фоновая запись успела бы переоткрыть базу раньше чтения. */
    const спроси=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); }
      if(r==null||r==='') return {сбой:'не разобрать'}; if(typeof r==='object') return {сбой:String(r.__err||'не разобрать')};
      try{ return JSON.parse(r); }catch(e){ return {сбой:'не разобрать: '+r}; } };
    const до=await спроси(`(function(){ try{ return JSON.stringify({было:(FOODS||[]).length}) }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    /* Закрываем соединение нарочно — ровно то, что делает Safari сам; закрытое
       соединение не даёт открыть транзакцию — это и есть признак фикстуры. */
    await js(`(function(){ const w=window.__dbReopen={закрыто:false}; try{ db.close(); try{ db.transaction('foods') }catch(e){ w.закрыто=true } }catch(e){ w.упало='УПАЛО: '+((e&&e.message)||e) } return 1 })()`);
    /* Чтение после закрытия — отдельный вызов; исход — в window.__dbReopen. */
    await js(`(async()=>{ const w=window.__dbReopen||(window.__dbReopen={}); try{ await loadAll(); w.ок=true }catch(e){ w.упало='УПАЛО: '+((e&&e.message)||e) } return 1 })()`);
    await sleep(200);
    const ПОСЛЕ=`(function(){ try{ const w=window.__dbReopen; if(!w||!(w.ок||w.упало)) return JSON.stringify({ждём:1});
      return JSON.stringify({закрыто:w.закрыто===true,прочлось:w.ок===true,упало:w.упало||null,стало:(FOODS||[]).length,список:Array.isArray(FOODS)}) }catch(e){ return JSON.stringify({сбой:e.message}) } })()`;
    let после=await спроси(ПОСЛЕ); if(после.ждём){ await sleep(400); после=await спроси(ПОСЛЕ); }
    if(после.ждём) после={сбой:'чтение после закрытия соединения не завершилось'};
    await js(`(function(){ window.__dbReopen=null; return 1 })()`);
    const d={...до,...после,сбой:до.сбой||после.сбой};
    chk(!d.сбой,'замер переоткрытия базы сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.закрыто===true,'соединение с базой не закрылось — фикстура не встала, проверка переоткрытия ничего не проверила');
      chk(d.прочлось===true,'после закрытия соединения база не прочиталась: '+String(d.упало)
        +' — человек получил бы белый экран «Не удалось запустить» при целых данных');
      if(d.прочлось===true) chk(d.список&&d.стало===d.было,
        'после переоткрытия базы данные не те: было '+d.было+' продуктов, стало '+d.стало);
    }
    if(process.env.BVDBG) console.log('   DBG переоткрытие базы: '+JSON.stringify(d));
    drain();
  }

  drain();
  chk(!телеметрия.length,'со стенда ушло '+телеметрия.length+' запросов телеметрии ('+
    телеметрия.slice(0,2).join(' · ')+') — прогоны и превью попадают в боевую статистику '+
    'и делают ворота удержания непосчитываемыми');

  boom.forEach(b=>fail.push(b));

  console.log('   простой: вкладок '+simple.вкладок+' · Коуч '+simple.коуч+' · Зал '+simple.зал+' · кнопок в Еде '+simple.едаКнопок);
  /* ── ИНВЕНТАРЬ ПОВЕРХНОСТЕЙ (пока отчёт, не правило) ──
     Владелец 03.09 по трём скриншотам: «получилось два фона — один у дневника,
     другой у остальных плашек; анализы вообще на другом фоне». Замер до
     этого дня: 6 разных пар фон+радиус на пяти экранах, 5 радиусов, 17 пар
     размер/насыщенность шрифта при законе «шесть размеров и три насыщенности»
     (CRAFT.md, 27.08). Закон существовал, инструмента при нём не было — и
     токены разошлись с ним молча. Строка печатается в каждом прогоне, чтобы
     дрейф был виден цифрой, а не ощущением; порогом станет после решения
     владельца по отрисованному варианту. С 04.09 — по форме CRAFT: переход
     по вкладке тапом из Node, замер каждого экрана коротким синхронным
     вызовом с одним повтором, итог складывается в Node. */
  try{
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного:
       один async-вызов на все пять вкладок иногда возвращал «не разобрать»
       при исправном приложении. Каждая вкладка — тап по нижнему меню, как
       палец, и синхронный замер её поверхностей; пары фон+радиус, радиусы
       и шрифты сливаются в Node в том же порядке вкладок, первый встреченный
       пример остаётся примером. Сбой любого замера — в инвСбой, и тогда
       инвентаря нет. */
    const bgs={}, fonts={}, radii={}; let инвСбой='';
    const ошибка=t=>{ инвСбой+=(инвСбой?'; ':'')+t; };
    for(const v of ['food','train','body','health','coach']){
      await js(`(document.querySelector('nav button[data-v="${v}"]')||{click(){}}).click()`); await sleep(500);
      const expr=`(function(){ try{
        const вид=e=>{const b=e.getBoundingClientRect(); const cs=getComputedStyle(e); return b.width>40&&b.height>20&&cs.display!=='none'&&cs.visibility!=='hidden'};
        const rgb=c=>c.replace(/\\s/g,''); const bgs={}, fonts={}, radii={};
        const root=document.getElementById('v-${v}'); if(!root) return JSON.stringify({нет:true});
        root.querySelectorAll('*').forEach(e=>{ if(!вид(e)) return; const cs=getComputedStyle(e);
          const bg=rgb(cs.backgroundColor);
          if(bg!=='rgba(0,0,0,0)'&&bg!==rgb(getComputedStyle(e.parentElement).backgroundColor)
            &&!/^(BUTTON|INPUT|SELECT|CANVAS|svg|I|B|SPAN|A|LABEL|SUMMARY)$/.test(e.tagName)){
            const r=cs.borderRadius.split(' ')[0]; const k=bg+' r'+r;
            /* Пример нужен, чтобы правило НАЗЫВАЛО лишнюю плашку, а не только считало:
               «четыре вместо трёх» без имени — это загадка, а не находка. */
            if(!bgs[k]) bgs[k]='${v} → .'+String(e.className||e.tagName).trim().split(/\\s+/).slice(0,2).join('.')+(e.id?'#'+e.id:'')+' «'+(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,24)+'»';
            radii[r]=1; }
          if([...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())) fonts[cs.fontSize+'/'+cs.fontWeight]=1; });
        return JSON.stringify({bgs,radii:Object.keys(radii),fonts:Object.keys(fonts)});
      }catch(e){ return JSON.stringify({сбой:e.message}) } })()`;
      let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); }
      if(r&&r.__err){ ошибка(v+': '+r.__err); continue; }
      let o=null; try{ o=JSON.parse(r) }catch(e){}
      if(!o){ ошибка(v+': страница промолчала ('+JSON.stringify(r)+')'); continue; }
      if(o.сбой){ ошибка(v+': '+o.сбой); continue; }
      if(o.нет) continue;
      Object.entries(o.bgs||{}).forEach(([k,ex])=>{ if(!bgs[k]) bgs[k]=ex; });
      (o.radii||[]).forEach(x=>{ radii[x]=1; }); (o.fonts||[]).forEach(x=>{ fonts[x]=1; });
    }
    await js(`(document.querySelector('nav button[data-v="food"]')||{click(){}}).click()`); await sleep(300);
    const и=инвСбой?null:{поверхностей:Object.keys(bgs).length,радиусов:Object.keys(radii).length,шрифтов:Object.keys(fonts).length,
      список:Object.entries(bgs).map(([k,v])=>k+': '+v)};
    if(и) console.log('   поверхности: разных фон+радиус '+и.поверхностей+' · радиусов '+и.радиусов+' · пар размер/насыщенность '+и.шрифтов);
    /* Порог — решение владельца 03.09 по отрисованным кадрам: поверхность одна
       (карточка), плюс два контрола (сегмент-контрол r11 и пилюля r999).
       Итого не больше ТРЁХ пар фон+радиус и трёх радиусов. Четвёртая —
       это чья-то ручная плашка, и её надо назвать, а не пропустить. */
    chk(!!и,'инвентарь поверхностей не измерен — проверка одной поверхности ничего не проверила'+(инвСбой?' ('+инвСбой+')':''));
    if(и){
      /* v598, решение владельца 14.09 (премиум-«Зал»): к трём парам добавились
         карточка упражнения r24 и групповой список r16 на той же поверхности.
         Порог поднят ровно на них; шестая пара — снова чья-то ручная плашка. */
      chk(и.поверхностей<=5,'на экранах '+и.поверхностей+' разных поверхностей (фон+радиус) при законе «одна поверхность» (+ карточка r24 и группа r16 «Зала») — появилась своя плашка: '+(и.список||[]).join(' · '));
      chk(и.радиусов<=5,'радиусов '+и.радиусов+' при пяти разрешённых (24 карточка «Зала» · 18 поверхность · 16 группа · 11 контрол · 999 пилюля)');
    }
    /* И предупреждения: у .wb/.eb нет цветного фона нигде — ни на экране,
       ни в листе. Цвет только в ярлыке. */
    /* Пробная плашка, а не поиск живых: мутация M773 (янтарная заливка
       возвращена) прошла мимо первой версии — в состоянии прогона ни одной
       видимой .wb не было, и правило смотрело на пустую выборку. Ставим
       свои .wb/.eb/.ob/.ib верхнего уровня и внутри карточки, читаем фон
       и убираем. Это меряет ВЫХОД CSS, а не удачу состояния. */
    const ПРОБА=`(function(){ const bad=[]; const root=document.getElementById('v-food'); if(!root) return JSON.stringify(['нет экрана Еды']);
      const card=document.createElement('div'); card.className='card'; root.appendChild(card);
      const ref=getComputedStyle(card).backgroundColor.replace(/\\s/g,'');
      for(const k of ['wb','eb','ob','ib']){
        const top=document.createElement('div'); top.className=k; top.textContent='проба'; root.appendChild(top);
        const bg=getComputedStyle(top).backgroundColor.replace(/\\s/g,'');
        if(bg!==ref) bad.push('.'+k+' сверху: '+bg+' вместо поверхности '+ref);
        const nest=document.createElement('div'); nest.className=k; nest.textContent='проба'; card.appendChild(nest);
        const nb=getComputedStyle(nest).backgroundColor.replace(/\\s/g,'');
        if(nb!=='rgba(0,0,0,0)') bad.push('.'+k+' в карточке: свой фон '+nb+' — вложенная коробка');
        top.remove(); }
      card.remove(); return JSON.stringify(bad); })()`;
    /* Замер синхронный; промолчала страница — один повтор через 400 мс.
       Проба ставит и убирает свои элементы, повтор ей не вредит. */
    let цветные=await js(ПРОБА); if(typeof цветные!=='string'||!цветные){ await sleep(400); цветные=await js(ПРОБА); }
    let ц=null; try{ ц=JSON.parse(цветные) }catch(e){}
    chk(Array.isArray(ц),'проба цветных сообщений (.wb/.eb/.ob/.ib) не измерена — правило про ярлык смотрело бы в пустоту');
    chk(!(ц||[]).length,'сообщение не на общей поверхности: '+(ц||[]).join(' · ')+' — по закону цвет несёт ярлык, а не коробка');
  }catch(_){}
  console.log('   полный:  вкладок '+full.вкладок+' · Коуч '+full.коуч+' · Зал '+full.зал+' · кнопок в Еде '+full.едаКнопок);
  /* ── ЭКРАН НЕ ЕЗДИТ ВБОК, НИЖНИЕ ПОЛОСЫ НЕ НАЛЕЗАЮТ ДРУГ НА ДРУГА ──
     Полевой отчёт владельца 31.08, два подряд: «могу вправо сдвинуть и
     пользоваться, что делает экран отвратительным» и «при экране таймера
     еду вообще ввести невозможно».
     Первое: поле ввода шагов уезжало ЗА ПРАВЫЙ КРАЙ. Причина — столкновение
     двух верных по отдельности правил: `.wcard` писалась как строка и
     включает перенос, а в сетке та же карточка становится колонкой, где
     перенос уносит элементы в СОСЕДНЮЮ КОЛОНКУ СПРАВА.
     Второе: таймер отдыха встал ровно на место панели «Записать еду» —
     пятый по счёту нижний отступ, который забыли пересчитать.
     Оба меряются на выходе и на данных, похожих на владельцевы: пустое
     приложение не воспроизводит ни то, ни другое. */
  {
    await js(`(async()=>{ try{
      for(let i=0;i<16;i++){ const d=ds(dn(td())-i);
        await put('weight',{d,kg:93-i*0.05,id:'ovf'+i});
        await put('log',{d,n:'Овсянка',u:100,a:80,k:300,p:10,f:6,c:50,slot:'bf'}); }
      await put('steps',{d:ds(dn(td())-1),n:5969});
      S.water={}; S.water[td()]=1480; S.stepGoal=7500;
      await put('settings',S,'main'); await loadAll(); renderAll(); return 1;
    }catch(e){ return 'ERR '+e.message } })()`);
    await sleep(1500);
    const ТАБЫ=['food','train','body','health','coach'];
    /* ── ВКЛАДКА ОТВЕЧАЕТ НА ТАП (10.09) ──
       Сигнал с телефона владельца: три тапа по «Тело» за секунду (rage).
       Это не поломка кнопки, а задержка отрисовки: человек жмёт, экран
       молчит, он жмёт снова. Меряем ВЫХОД на замедленном в 20 раз процессоре
       (грубо — телефон трёхлетней давности): от тапа по вкладке до кадра. */
    {
      await send('Emulation.setCPUThrottlingRate',{rate:20});
      const тайм={};
      /* Три тапа, берём медиану: первый после долгой работы стенда холодный
         (JIT, кэш стилей) и один давал 1249–1310 при 800–900 на втором —
         три прогона подряд 14.09 краснели на шуме, а v571/v590/v592 под
         одинаковой пробой показали одно и то же. Порог не трогали. */
      for(const t of ТАБЫ){
        const три=[];
        for(let k=0;k<3;k++){
          await js(`goView('food')`); await sleep(300);
          const ms=await js(`(async()=>{ const t0=performance.now(); goView('${t}'); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return Math.round(performance.now()-t0); })()`);
          три.push(+ms||0);
        }
        тайм[t]=три.slice().sort((a,b)=>a-b)[1];
      }
      await send('Emulation.setCPUThrottlingRate',{rate:1});
      console.log('   вкладки на 20× замедлении, мс: '+ТАБЫ.map(t=>t+' '+тайм[t]).join(' · '));
      /* Замер 10.09: food 527 · train 870 · body 296 · health 224 · coach 397.
         Порог — храповик: не хуже нынешнего «Зала» с запасом, не больше. */
      const медл=ТАБЫ.filter(t=>тайм[t]>1200);
      if(медл.length) fail.push('вкладка не отвечает на тап: '+медл.map(t=>t+' '+тайм[t]+' мс').join(', ')+' при пределе 1200 мс на 20× — человек тапает трижды');
    }
    for(const w of [320,390]){
      await send('Emulation.setDeviceMetricsOverride',{width:w,height:844,deviceScaleFactor:2,mobile:true});
      await sleep(400);
      for(const t of ТАБЫ){
        await js(`goView('${t}')`); await sleep(700);
        /* Поле шагов раскрываем: именно в раскрытом виде оно и уезжало. */
        if(t==='food'){ await js(`(()=>{ try{ stepsToggle(true); }catch(e){} return 1 })()`); await sleep(400); }
        const r=await js(`(()=>{
          const de=document.documentElement, vw=de.clientWidth, out=[];
          document.querySelectorAll('body *').forEach(e=>{
            const st=getComputedStyle(e);
            if(st.display==='none'||st.position==='fixed') return;
            const b=e.getBoundingClientRect();
            if(b.width===0||b.height===0) return;
            const p=e.parentElement?e.parentElement.getBoundingClientRect():null;
            if(b.right>vw+1&&(!p||p.right<=vw+1)){
              let n=e.tagName.toLowerCase();
              if(e.id) n+='#'+e.id; else if(typeof e.className==='string'&&e.className.trim()) n+='.'+e.className.trim().split(/\s+/)[0];
              out.push(n+' до '+Math.round(b.right)+' при экране '+vw+' «'+(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,22)+'»');
            }
          });
          return JSON.stringify(out.slice(0,4));
        })()`);
        let bad=[]; try{ bad=JSON.parse(r||'[]'); }catch(e){}
        chk(bad.length===0,'на '+w+' px экран «'+t+'» вылезает вбок: '+bad.join(' · ')
          +' — приложение можно сдвинуть вправо, и половина экрана уезжает');
      }
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await sleep(300);
    await js(`goView('food')`); await sleep(700);
    const полосы=await js(`(()=>{ startRest(120); barsSync();
      const R=(sel,n)=>{ const x=typeof sel==='string'?document.querySelector(sel):sel; if(!x) return null;
        const s=getComputedStyle(x); if(s.display==='none'||s.visibility==='hidden') return null;
        const r=x.getBoundingClientRect(); return r.height>1?{n,t:r.top,b:r.bottom}:null };
      const bars=[R('#foodBar','панель «Записать еду»'),R('#restBar','таймер отдыха'),R('nav','панель вкладок')].filter(Boolean);
      const пересеч=[];
      for(let i=0;i<bars.length;i++) for(let j=i+1;j<bars.length;j++){
        const a=bars[i],b=bars[j], ov=Math.min(a.b,b.b)-Math.max(a.t,b.t);
        if(ov>1) пересеч.push(a.n+' и '+b.n+' налезают на '+Math.round(ov)+' px'); }
      stopRest(); barsSync();
      return JSON.stringify({полос:bars.length,пересеч}); })()`);
    { const o=JSON.parse(полосы||'{}');
      chk(o.полос>=3,'нижних полос найдено '+o.полос+' из трёх — проверка перекрытия ничего не проверила');
      chk((o.пересеч||[]).length===0,'при включённом таймере '+(o.пересеч||[]).join(' · ')
        +' — до нижней ничего не дотянуться'); }

    /* ── ПОЛЕ, ПРО КОТОРОЕ БРАУЗЕРУ НЕ СКАЗАЛИ, ЧТО ЭТО ──
       Полевой скриншот 31.08: над цифровой клавиатурой при вводе шагов
       Safari предлагал сохранённый пароль и почту владельца. Он гадает про
       каждое поле, о котором не сказано, и раз для сайта сохранён пароль —
       предлагает его везде. Проверяем ВЫХОД: у каждого поля есть ответ на
       вопрос «что это». */
    const бездоки=await js(`(()=>{
      const out=[];
      document.querySelectorAll('input,textarea').forEach(e=>{
        const t=(e.type||'').toLowerCase();
        if(t==='checkbox'||t==='radio'||t==='file'||t==='hidden') return;
        if(!e.getAttribute('autocomplete')) out.push((e.id||e.name||e.tagName)+' ['+(t||'text')+']');
      });
      return JSON.stringify(out.slice(0,6));
    })()`);
    { let o=[]; try{ o=JSON.parse(бездоки||'[]'); }catch(e){}
      chk(o.length===0,'полей без пометки «что это» — '+o.length+': '+o.join(', ')
        +'. Safari будет предлагать в них сохранённый пароль и почту владельца'); }
    /* ── ЧИСЛО И ЦЕЛЬ — ОДИН КЕГЛЬ И ОДИН ЦВЕТ ──
       Решение владельца 31.08: «почему блок не может быть в одном стиле без
       серых цифр, лучше шрифт уменьшить, а шрифт цели сделать эталонным».
       Было 28 px ярким и 12 px серым — скачок в два с половиной раза внутри
       одной мысли «сколько из скольких». Правило меряет ВЫХОД: кегль обеих
       частей совпадает, а цель окрашена цветом метрики, а не серым. */
    await js(`goView('food')`); await sleep(800);
    const пары=await js(`(()=>{
      const out=[];
      document.querySelectorAll('.mrow').forEach(r=>{
        const v=r.querySelector('.mval'), g=r.querySelector('.mtgt');
        if(!v||!g) { out.push('в строке показателя нет пары «число + цель»'); return; }
        const cv=getComputedStyle(v), cg=getComputedStyle(g);
        const fv=parseFloat(cv.fontSize), fg=parseFloat(cg.fontSize);
        const имя=(r.closest('.card')||{}).id||'?';
        if(Math.abs(fv-fg)>0.6) out.push(имя+': число '+Math.round(fv)+' px, цель '+Math.round(fg)+' px');
        /* Серый — это цвет, у которого все три канала совпадают. Цвет метрики
           таким быть не может, значит серая цель ловится замером, а не глазом. */
        const m=cg.color.match(/[0-9.]+/g)||[];
        if(m.length>=3&&Math.abs(m[0]-m[1])<6&&Math.abs(m[1]-m[2])<6)
          out.push(имя+': цель снова серая ('+cg.color+'), а не цветом показателя');
        const rv=v.getBoundingClientRect(), rg=g.getBoundingClientRect();
        if(rg.top-rv.top>4) out.push(имя+': цель перенеслась на вторую строку — «сколько из скольких» разорвано');
      });
      return JSON.stringify({всего:document.querySelectorAll('.mrow').length,беды:out});
    })()`);
    { const o=JSON.parse(пары||'{}');
      chk(o.всего>=2,'строк показателя найдено '+o.всего+' — проверка их стиля ничего не проверила');
      chk((o.беды||[]).length===0,'карточки показателей разъехались по стилю: '+(o.беды||[]).join(' · ')); }

    /* ── ПОЛОСКА, КОТОРАЯ ОБЕЩАЕТ ПРОГРЕСС, ОБЯЗАНА ЕГО ПОКАЗЫВАТЬ ──
       Найдено 31.08 при проверке заливки цифры: полоски воды и шагов несли
       зашитое `width:0` со времён, когда заливка делалась шириной. После
       перехода на transform масштаб считался верно — и растягивал НОЛЬ.
       Полтора месяца обе карточки рисовали серую черту вместо прогресса,
       и ни одно правило этого не видело: доля-то была правильная.
       Меряем нарисованное, а не переменную. С 04.09 — по форме CRAFT:
       фикстура и запись в хранилище — отдельными короткими вызовами, замер —
       синхронным с одним повтором, а не ответ одного длинного. */
    {
      /* Замер — синхронный вызов; промолчала страница — один повтор через 400 мс. */
      const спроси=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); } return typeof r==='string'?r:null; };
      /* Фикстура: вода на 60 % и шаги на половину цели — обе полоски обязаны
         быть заметно заполнены. S — в памяти, шаги — одной записью в хранилище;
         ответ записи для chk не используется, состояние спрашивается замером. */
      await js(`(function(){ try{ S.water={}; S.water[td()]=Math.round(waterBase()*0.6); S.stepGoal=8000; return 1 }catch(e){ return 'ERR '+e.message } })()`);
      await js(`(async()=>{ try{ await put('steps',{d:td(),n:4000}); STEPS=await all('steps'); }catch(e){} return 1 })()`);
      await js(`(function(){ try{ renderAll(); }catch(e){} return 1 })()`); await sleep(500);
      const полоски=await спроси(`(function(){
        const out=[];
        document.querySelectorAll('.bar>i').forEach(e=>{
          if(e.offsetParent===null) return;
          const доля=parseFloat(getComputedStyle(e).getPropertyValue('--fill'))||0;
          if(доля<0.05) return;                       // пустой показатель — не про это правило
          const r=e.getBoundingClientRect(), pr=e.parentElement.getBoundingClientRect();
          const видно=pr.width>0?r.width/pr.width:0;
          if(видно<доля*0.7) out.push((e.id||'полоска')+': доля '+Math.round(доля*100)
            +'%, а нарисовано '+Math.round(видно*100)+'%');
        });
        const st=(STEPS||[]).find(x=>x.d===td());
        return JSON.stringify({фикстура:S.stepGoal===8000&&!!st&&(+st.n||0)===4000&&(+(S.water||{})[td()])>0,
          всего:document.querySelectorAll('.bar>i').length,беды:out});
      })()`);
      { let o={}; try{ o=JSON.parse(полоски||'{}'); }catch(e){}
        chk(o.фикстура===true,'фикстура полосок не встала (шаги 4000 из 8000, вода на 60 %) — проверка полосок ничего не проверила');
        chk(o.всего>=2,'полосок прогресса найдено '+o.всего+' — проверка ничего не проверила');
        chk((o.беды||[]).length===0,'полоска обещает прогресс, но нарисована пустой: '+(o.беды||[]).join(' · ')); }
    }

    /* ── ЦИФРА НАПОЛНЯЕТСЯ ПО-НАСТОЯЩЕМУ ──
       Решение владельца 31.08: «чем ближе к цели, тем цифра ближе к
       заполнению, как бутылка». Меряем ОТРИСОВКУ, а не переменную: первая
       версия правила смотрела на --fill и была зелёной, когда обрезка
       поверх цифры уже ничего не обрезала.
       И вторая половина: цифра обязана читаться при нуле. Заливка — это
       украшение поверх читаемости, а не вместо неё. С 04.09 — по форме CRAFT:
       каждая запись в хранилище — свой короткий вызов, ответ которого для chk
       не используется; замер — синхронный, с одним повтором. */
    const залив=[];
    {
      const спроси=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); } return typeof r==='string'?r:null; };
      for(const [шаг,цель] of [[0,8000],[2000,8000],[6000,8000]]){
        /* Фикстура по шагам — по одной записи на вызов: убрать сегодняшние
           (ключ хранилища «steps» — день, как в stepsWrite), записать новые,
           поднять цель в настройки и перерисовать. */
        await js(`(async()=>{ try{ for(const st of (STEPS||[]).filter(x=>x.d===td())) await del('steps',st.d); STEPS=await all('steps'); }catch(e){} return 1 })()`);
        await js(`(async()=>{ try{ await put('steps',{d:td(),n:${шаг}}); STEPS=await all('steps'); }catch(e){} return 1 })()`);
        await js(`(async()=>{ try{ S.stepGoal=${цель}; await put('settings',S,'main'); }catch(e){} try{ renderAll(); }catch(e){} return 1 })()`);
        await sleep(600);
        /* Замер — синхронный: что нарисовано у цифры прямо сейчас и встала ли фикстура. */
        const r=await спроси(`(function(){ const v=document.getElementById('stVal'); if(!v) return null;
          const a=getComputedStyle(v,'::after'), i=v.querySelector('i');
          const cs=i?getComputedStyle(i):null;
          const st=(STEPS||[]).find(x=>x.d===td());
          return JSON.stringify({фикстура:S.stepGoal===${цель}&&!!st&&(+st.n||0)===${шаг},
            clip:a.clipPath||a.webkitClipPath||'',
            тусклость:cs?parseFloat(cs.opacity):1, текст:v.textContent}); })()`);
        let o={}; try{ o=JSON.parse(r||'{}'); }catch(e){}
        залив.push(Object.assign({шаг},o));
      }
    }
    chk(залив.every(x=>x&&x.фикстура===true),
      'фикстура шагов не встала ('+залив.map(x=>x.шаг+(x.фикстура?'':' — нет')).join(' · ')+' при цели 8000) — проверка заливки цифры ничего не проверила');
    chk(залив.every(x=>x&&x.clip&&x.clip!=='none'),
      'у цифры показателя нет обрезки заливки — она больше не наполняется по мере дня');
    chk(new Set(залив.map(x=>x.clip)).size===залив.length,
      'обрезка цифры одинакова при 0, 25 и 75 % цели ('+залив.map(x=>x.clip).join(' | ')
      +') — заливка не следит за прогрессом');
    chk(залив[0]&&залив[0].тусклость>=0.4,
      'при нуле цифра приглушена до '+(залив[0]&&залив[0].тусклость)
      +' — главное число дня не прочитать утром, пока ничего не записано');
    await sleep(200); drain();
    await sleep(200); drain();
  }


  /* ── ПЛАН НЕДЕЛИ НЕ ПЕРЕСКАЗЫВАЕТ СЕГОДНЯШНЮЮ ТРЕНИРОВКУ ──
     Полевые скриншоты владельца 31.08, вкладка «Программа»: у КАЖДОГО
     упражнения КАЖДОГО дня стояло «Учти: в прошлый раз это было 1-е
     упражнение, сегодня — 8-е», «11 тренировок без сдвига», абзац про
     усталость — шесть раз дословно на одном экране.
     И это была не только стена, но и НЕПРАВДА: «сегодня — 8-е» считается по
     тому, сколько движений записано сегодня, и для упражнения из другого дня
     недели не значит ничего.
     Правило: на вкладке «Программа» нет ни одной фразы про сегодняшний день.
     С 04.09 — по форме CRAFT: переход тапом из Node, замер коротким
     синхронным вызовом с одним повтором, а не ответ одного длинного. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного:
       фикстура, тап по «Залу», перерисовка и тап по «Программе» — отдельные
       вызовы с паузой в Node; замер — синхронный, с одним повтором, если
       страница промолчала. Ответ разбираем сами: пустота и ошибка
       контекста — «сбой» правила, а не краш прогона. */
    const спроси=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); }
      if(r==null||r==='') return {сбой:'не разобрать'}; if(typeof r==='object') return {сбой:String(r.__err||'не разобрать')};
      try{ return JSON.parse(r); }catch(e){ return {сбой:'не разобрать: '+r}; } };
    /* Фикстура — в памяти (SETS), как и раньше: восемь движений сегодня
       («сегодня — 8-е») и шесть недель истории у двух упражнений
       («без сдвига»). Ответ не нужен — состояние спросим отдельно. */
    await js(`(function(){ try{ const d=td();
      for(let i=0;i<8;i++) SETS.push({d,e:'Дв'+i,w:50,r:10,uid:'pp'+i,ua:Date.now(),pos:i+1});
      for(let w=1;w<=6;w++) for(const n of ['Приседания со штангой','Жим лёжа'])
        SETS.push({d:ds(dn(d)-w*7),e:n,w:100,r:8,uid:'pl'+n+w,ua:Date.now()-w*7*864e5,pos:1});
      return 1 }catch(e){ return 'ERR '+e.message } })()`);
    /* Переход: вкладка «Зал» — тапом по нижнему меню, как палец; перерисовка
       после фикстуры — отдельным коротким вызовом, пауза — в Node. */
    await js(`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`);
    await js(`(function(){ renderAll(); return 1 })()`); await sleep(700);
    /* Переход: подвкладка «Программа» — тапом по её кнопке. */
    await js(`(function(){ const seg=[...document.querySelectorAll('#v-train .seg button')].find(b=>/Программа/.test(b.textContent)); if(seg) seg.click(); return !!seg })()`); await sleep(900);
    /* Замер: фикстура встала и «Программа» открыта; сколько упражнений на
       экране и сколько раз он говорит про сегодняшний день. */
    const пл=await спроси(`(function(){ try{
      const seg=[...document.querySelectorAll('#v-train .seg button')].find(b=>/Программа/.test(b.textContent));
      const t=(document.querySelector('#v-train')||{innerText:''}).innerText||'';
      const счёт=x=>(t.match(new RegExp(x,'g'))||[]).length;
      return JSON.stringify({
        фикстура:SETS.filter(s=>s&&/^pp\\d$/.test(String(s.uid))).length>=8
          &&SETS.filter(s=>s&&/^pl/.test(String(s.uid))).length>=12
          &&!!(seg&&seg.classList.contains('on')),
        упражнений:(t.match(/@ RIR/g)||[]).length,
        сегодня:счёт('сегодня — '), сдвиг:счёт('без сдвига'),
        усталость:счёт('После [0-9]+ упражнени'), готовность:счёт('Готовность сегодня')});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    chk(!пл.сбой,'замер плана недели сорвался: '+пл.сбой);
    if(!пл.сбой){
      chk(пл.фикстура===true,'фикстура плана недели не встала (восемь движений сегодня, история у двух упражнений, открытая «Программа») — правило про сессионные приписки ничего не проверило');
      chk((пл.упражнений||0)>=6,'на вкладке «Программа» упражнений '+(пл.упражнений||0)
        +' — правило про сессионные приписки ничего не проверило');
      chk(пл.сегодня===0,'план недели говорит «сегодня — N-е упражнение» ('+пл.сегодня
        +' раз) — для чужого дня недели это неправда, и стоит она у первого упражнения дня');
      chk(пл.сдвиг===0&&пл.усталость===0&&пл.готовность===0,
        'план недели пересказывает советы по сегодняшней тренировке: без сдвига '+пл.сдвиг
        +', про усталость '+пл.усталость+', про готовность '+пл.готовность
        +' — один и тот же абзац повторяется у каждого упражнения каждого дня');
    }
    await sleep(200); drain();
  }

  /* ── ПУТЬ ДО ПОДХОДА ──
     Полевой разбор владельца 01.09 и замер: до первой строки подхода было
     443 px при видимой части экрана около 700. Две трети пути тратились до
     того, ради чего карточку открывают. Между названием и таблицей стояли
     опросник готовности (103 px) и три раскрывашки подряд (138 px).
     Правило владельца: «делаем одну идеальную карточку и дальше по этому
     правилу переделываем остальные». Правило и есть предел пути.
     Меряем ВЫХОД в настоящем браузере: расстояние от верха карточки до
     первой строки подхода. Порог 210 px при замеренных 158 — запас на
     длинное название в две строки и на карточку с пометкой замены.
     С 04.09 — по форме CRAFT: переход тапом из Node, замер коротким
     синхронным вызовом с одним повтором, а не ответ одного длинного. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного
       (CRAFT 04.09): фикстура — по одному шагу записи за вызов, каждый
       переход — отдельный тап из Node и пауза, замер — синхронный, с одним
       повтором, если страница промолчала. Исключение на любом шаге — «сбой»
       правила, а не краш прогона и не тихий зелёный: раньше пустой ответ
       длинного вызова давал пустой список карточек и ни одной проверки. */
    let сбой=null;
    const спроси=async expr=>{ let r=await js(expr); if(r==null||r===''){ await sleep(400); r=await js(expr); }
      if(r==null||r==='') return {сбой:'не разобрать'}; if(typeof r==='object') return {сбой:String(r.__err||'не разобрать')};
      try{ return JSON.parse(r); }catch(e){ return {сбой:'не разобрать: '+r}; } };
    /* Тап или запись: ответ не нужен, но исключение на пути — это сбой. */
    const тап=async expr=>{ const r=await js(expr); if(r&&r.__err&&!сбой) сбой=r.__err; };
    /* Фикстура, шаг 1 — профиль и программа в памяти, первый день — на сегодня. */
    await тап(`(function(){ S.sex='m';S.age=34;S.h=182;S.ui='pro';
      S.prog=genProgram({days:4,split:'ul4',equip:'gym',exp:'mid',goal:'recomp',mins:85,inj:[],dows:[1,2,3,4,5,6,7]});
      S.prog.plan.forEach((d,i)=>{ if(i===0) d.dow=effDow(td()); }); return 1 })()`);
    /* Шаг 2 — вес. Шаг 3 — история: по три подхода на упражнение первого
       дня, по одной неделе за вызов (шесть недель назад → неделю назад,
       вес растёт). Номер недели — из Node: между вызовами страница ничего
       не помнит. */
    await тап(`(async()=>{ await put('weight',{d:td(),kg:93,id:'w1'}); return 1 })()`);
    for(let wk=6;wk>=1&&!сбой;wk--) await тап(`(async()=>{ const wk=${wk}; const day=S.prog.plan[0];
      for(const it of day.ex) for(let k=0;k<3;k++) await put('sets',{id:'h'+wk+it.n+k,e:it.n,d:ds(dn(td())-wk*7),w:60+(7-wk)*5,r:8});
      return 1 })()`);
    /* Шаг 4 — настройки в хранилище и перечитать всё; перерисовка — отдельно. */
    await тап(`(async()=>{ await put('settings',S,'main'); await loadAll(); return 1 })()`);
    await тап(`(function(){ renderAll(); return 1 })()`); await sleep(300);
    /* Фикстура взялась? Спрашиваем состояние, а не верим записи. */
    const ф=сбой?{}:await спроси(`(function(){ try{ const day=(S.prog&&S.prog.plan||[])[0]||{};
      return JSON.stringify({ui:S.ui||'', сегодня:day.dow===effDow(td()), упр:(day.ex||[]).length,
        история:(SETS||[]).filter(x=>typeof x.id==='string'&&/^h[1-6]/.test(x.id)).length}) }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    if(ф.сбой&&!сбой) сбой=ф.сбой;
    /* К этому месту прогон успел открыть и закрыть десяток листов. Закрываем
       всё и переключаемся вкладкой явно: иначе карточка лежит в скрытой
       секции, offsetHeight у неё ноль, и правило измерит не то. */
    await тап(`(function(){ document.querySelectorAll('.sheet.on').forEach(x=>x.classList.remove('on','kb')); return 1 })()`); await sleep(300);
    /* Переход: вкладка «Зал» — тапом по нижнему меню, как палец. */
    await тап(`(document.querySelector('nav button[data-v="train"]')||{click(){ goView('train') }}).click()`); await sleep(900);
    /* И ВКЛАДКУ ВНУТРИ ЗАЛА: карточки живут в «Тренировке», а прогон мог
       оставить открытой «Программу» или «Разбор» — тогда секция скрыта,
       высота нулевая, и измерять нечего. Тоже тапом. */
    await тап(`(function(){ const t=document.querySelector('#v-train [data-tr="log"]'); if(t) t.click(); return !!t })()`); await sleep(500);
    /* День — сегодняшний, не тот, куда сосед листнул стрелкой; перерисовка
       зала — вызовом функции: элемента у этого нет. Ответ не используется. */
    await тап(`(function(){ try{ if(typeof vDay!=='undefined') vDay=null; rTrain(); }catch(_){} return 1 })()`); await sleep(700);
    /* Замер — синхронный: карточки с техникой в «Тренировке», у первых трёх —
       путь от верха до первой строки подхода и число раскрывашек до неё. */
    const пп=сбой?{сбой}:await спроси(`(function(){ try{
      const cs=[...document.querySelectorAll('#v-train .wc')].filter(x=>x.querySelector('[data-tech]'));
      if(!cs.length) return JSON.stringify({нет:1});
      /* Диагностика на случай, если секция всё-таки скрыта: без неё правило
         говорит «0 px» и звучит как настоящая находка, а на деле не измерило
         ничего. Занятый порт научил: инструмент обязан сначала убедиться,
         что он меряет то. */
      const _lg=document.getElementById('tr-log');
      if(!cs[0].offsetHeight) return JSON.stringify({скрыто:1,
        видВкл:!!document.querySelector('#v-train.on'),
        логВид:_lg?getComputedStyle(_lg).display:'нет узла'});
      /* Меряем через offsetTop, а не через getBoundingClientRect: карточки
         ниже экрана и вне прокрутки rect отдаёт честно, но если вкладка ещё
         не показана, rect у всего нулевой и правило «находит» ноль пикселей
         вместо настоящего числа. offsetTop от общего родителя от прокрутки
         не зависит вовсе. */
      const ot=e=>{ let y=0,n=e; while(n&&n!==document.body){ y+=n.offsetTop; n=n.offsetParent; } return y; };
      const out=cs.slice(0,3).map(c=>{
        const top=ot(c);
        const п=c.querySelector('.wrow:not(.wrow-h)');
        const пy=п?ot(п):null;
        const раскр=[...c.children].filter(e=>{
          if(!(e.offsetHeight>0)) return false;
          if(пy!=null&&ot(e)>=пy) return false;
          return !!e.querySelector('.tog,details,summary');
        }).length;
        return {n:((c.querySelector('.wc-n')||{}).textContent||'').trim().slice(0,28),
                px:п?Math.round(пy-top):-1, раскр, видна:c.offsetHeight>0};
      });
      return JSON.stringify(out); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    if(пп.сбой&&!сбой) сбой=пп.сбой;
    chk(!сбой,'замер пути до подхода сорвался: '+сбой);
    if(!сбой){
      chk(ф.ui==='pro'&&ф.сегодня===true&&ф.упр>0&&ф.история>=18,'фикстура пути до подхода не встала ('+JSON.stringify(ф)+') — проверка пути до подхода ничего не проверила');
      chk(!пп.нет,'карточек упражнений на экране не нашлось — проверка пути до подхода ничего не проверила');
      chk(!пп.скрыто,'карточки есть, но секция скрыта ('+JSON.stringify(пп)+') — правило не измерило ничего');
      (Array.isArray(пп)?пп:[]).forEach(c=>{
        chk(c.видна,'карточка «'+c.n+'» не отрисована — измерять нечего, и правило ничего не проверило');
        chk(c.px>0,'в карточке «'+c.n+'» не нашлось ни одной строки подхода');
        chk(c.px>0&&c.px<=210,'в карточке «'+c.n+'» до первой строки подхода '+c.px
          +' px — человек открыл её, чтобы записать подход, а две трети экрана уходят до него. '
          +'Всё, что нужно не во время подхода, живёт в листе упражнения');
        /* И вторая половина правила: между названием и таблицей не должно быть
           стопки раскрывашек. Одна (суть и техника) законна — она раскрывается
           на месте по правилу поля v138–v144. Две и больше — снова стена. */
        chk(c.раскр<=1,'в карточке «'+c.n+'» между названием и подходами '+c.раскр
          +' раскрывашек — это снова стена ссылок, из-за которой путь и вырос до 443 px');
      });
    }
    if(process.env.BVDBG) console.log('   DBG путь до подхода: '+JSON.stringify(пп));
  }

  /* ── СТРАНИЦА НЕ ВЫГЛЯДИТ СТРАНИЦЕЙ ВХОДА ──
     Полевой скриншот владельца 31.08: открывает ПОИСК ЕДЫ — и над клавиатурой
     «пароль для этого сайта · его почта». `autocomplete="off"` (поставлен
     в v481) Safari для этой панели игнорирует: причина была не в поле поиска.
     На странице всегда висели два поля type="password" — пароль синхронизации
     и ключ ИИ, оба в ЗАКРЫТЫХ листах. Для Safari страница с полем пароля —
     страница входа, и он предлагает сохранённые доступы в любом текстовом
     поле на ней.
     Правило: пока листы закрыты, полей пароля на странице нет вовсе; поле
     становится паролем ровно тогда, когда человек до него дошёл. */
  {
    const покой=await js(`(()=>{
      document.querySelectorAll('.sheet.on').forEach(x=>x.classList.remove('on'));
      /* Ищем ВСЮ семью признаков, а не только пароли. 01.09: полей пароля
         было ноль, а поле почты с autocomplete="username" висело всегда —
         и Safari по-прежнему считал страницу входом. Логин и пароль это пара,
         и опознаётся она по любой половине. */
      const пар=[...document.querySelectorAll('input,textarea')].filter(e=>{
        const t=(e.type||'').toLowerCase(), ac=(e.getAttribute('autocomplete')||'').toLowerCase();
        return t==='password'||t==='email'||/username|email|current-password|new-password/.test(ac);
      }).map(e=>(e.id||'без id')+':'+e.type+'/'+(e.getAttribute('autocomplete')||'-'));
      const жд=[...document.querySelectorAll('input[data-pw]')].map(e=>(e.id||'?')+':'+e.type);
      return JSON.stringify({пар,жд});})()`);
    const п=JSON.parse(покой||'{}');
    chk((п.жд||[]).length>=2,'полей, которые становятся паролем по открытию листа, найдено '
      +((п.жд||[]).length)+' — правило про страницу входа ничего не проверило');
    chk((п.пар||[]).length===0,'при закрытых листах на странице есть признаки формы входа ('+(п.пар||[]).join(', ')
      +') — Safari считает страницу входом и будет предлагать сохранённый пароль в любом поле, включая ввод шагов');
    const бой=await js(`(()=>{
      sheet('sh-sync',true);
      const откр=[...document.querySelectorAll('input')].filter(e=>e.type==='password').map(e=>e.id);
      const e=document.getElementById('sy_p'); if(e) e.value='проверка';
      sheet('sh-sync',false);
      return JSON.stringify({откр,послеЗакрытия:e?{t:e.type,v:e.value}:null});})()`);
    const b2=JSON.parse(бой||'{}');
    chk((b2.откр||[]).indexOf('sy_p')>=0,
      'лист входа открыт, а поле пароля так и не стало паролем — менеджер паролей туда не подставит');
    chk(!!(b2.послеЗакрытия&&b2.послеЗакрытия.t==='text'&&b2.послеЗакрытия.v===''),
      'после закрытия листа поле пароля осталось паролем или сохранило значение: '
      +JSON.stringify(b2.послеЗакрытия));
    const поиск=await js(`(()=>{const q=document.getElementById('qSearch2');
      return q?q.type:'нет поля';})()`);
    chk(поиск==='search','поиск еды объявлен как «'+поиск
      +'», а не поиск — Safari предлагает в нём пароли и почту');
    await sleep(200); drain();
  }

  /* ── ЗАЛ: КАРТОЧКА НЕ ВРЁТ ПРО ВЕС И НЕ МОЛЧИТ ──
     Аудит зала 31.08. Две находки, обе замером, обе класса «форма обещает
     то, чего за ней нет».
     ① В базе 54 движения со своим весом (отжимания, австралийские
       подтягивания, приседания без веса) — а карточка спрашивала у них
       КИЛОГРАММЫ. Норматива к массе тела у них нет и быть не может, поэтому
       поле стояло пустым, и приложение молча спрашивало, со сколькими
       килограммами человек отжимается.
     ② У 174 движений из 268 норматива нет вовсе; 30 из них реально попадают
       в программы. Приложение честно не выдумывает число — но и не говорит
       ничего: «цель 3×10–15», пустое поле, и всё.
     С 04.09 — по форме CRAFT: переход тапом из Node, запись — своим коротким
     вызовом, замер — синхронным, с одним повтором, если страница промолчала. */
  {
    /* Меряем СОСТОЯНИЕ короткими вызовами, а не ответ одного длинного
       (CRAFT 04.09): фикстура, запись настроек и подхода — по одному шагу
       на вызов, их ответ для chk не используется (исключение на пути — сбой);
       переход на «Зал» — тапом по нижнему меню, как палец; паузы — в Node;
       каждый замер — синхронный вызов по текущему DOM, с одним повтором,
       если страница промолчала. Две стороны правила — два накопителя:
       d (карточки без записи) и з (после записи), сбой одной не глушит другую. */
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await sleep(300);
    const d={}, з={};
    const спроси=async expr=>{
      let r=await js(expr); if(r===undefined||r===null||r===''){ await sleep(400); r=await js(expr); }
      if(r&&r.__err) return {сбой:r.__err};
      if(typeof r!=='string') return {сбой:'не разобрать'};
      try{ return JSON.parse(r) }catch(e){ return {сбой:'не разобрать: '+r} }
    };
    const замер=async(o,expr)=>{ const r=await спроси(expr); if(r.сбой){ if(!o.сбой) o.сбой=r.сбой; } else Object.assign(o,r); };
    /* Шаг пути (тап, запись, перерисовка): ответ не нужен, но исключение на пути — сбой. */
    const шаг=async(o,expr)=>{ const r=await js(expr); if(r&&r.__err&&!o.сбой) o.сбой=r.__err; };
    const ИМЕНА=['Отжимания от пола','Икры сидя','Жим лёжа'];
    /* Фикстура: план на сегодня из трёх движений — со своим весом, без
       норматива и с посчитанным весом; подходы в памяти пусты, чтобы у
       «Икры сидя» не было истории. Прежний план — в window.__залWas, вернём в конце. */
    await шаг(d,`(function(){ window.__залWas=JSON.stringify(S.prog||null); SETS.length=0;
      const dw=effDow(td());
      S.prog=S.prog||{cfg:{},plan:[]};
      /* «Икры сидя» стоят ПЕРВЫМИ намеренно (11.09): подсказка первого раза
         теперь одна и живёт у текущего движения, а текущее в пустом дне —
         первое открытое. Будь первыми отжимания, подсказки не было бы нигде
         (свой вес её не получает), и правило проверяло бы пустоту. */
      S.prog.plan=[{n:'Проба',dow:dw,ex:[
        {n:'Икры сидя',sets:3,lo:10,hi:15},
        {n:'Отжимания от пола',sets:3,lo:10,hi:15},
        {n:'Жим лёжа',sets:4,lo:6,hi:10,main:true}]}];
      return 1 })()`);
    /* Настройки — в хранилище одной записью; на её ответ ничего не опирается. */
    await шаг(d,`(async()=>{ await put('settings',S,'main'); return 1 })()`);
    /* Переход: вкладка «Зал» — тапом по нижнему меню, как палец; перерисовка —
       отдельным вызовом, как и раньше; пауза — в Node. */
    await шаг(d,`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`);
    await шаг(d,`(function(){ renderAll(); return 1 })()`); await sleep(900);
    /* Замер 1: фикстура взялась; у трёх карточек — текст и подпись поля веса. */
    await замер(d,`(function(){ try{
      const карт={};
      [...document.querySelectorAll('#v-train .wc')].forEach(c=>{
        const t=(c.textContent||'').replace(/\\s+/g,' ').trim();
        const kg=[...c.querySelectorAll('input')].filter(e=>/^wkg_/.test(e.id||''))[0];
        ${JSON.stringify(ИМЕНА)}.forEach(n=>{
          if(t.indexOf(n)===0) карт[n]={текст:t.slice(0,220),подсказка:kg?kg.placeholder:null,значение:kg?kg.value:null};
        });
      });
      /* Сколько подсказок первого раза на экране и стоит ли она у того
         движения, где человек сейчас (лаймовый ряд .wrow.cur). */
      const карточки=[...document.querySelectorAll('#v-train .wc')];
      const сПодсказкой=карточки.filter(c=>((c.textContent||'').indexOf('Первый раз')>=0));
      const текущая=карточки.find(c=>c.querySelector('.wrow.cur'));
      return JSON.stringify({карт,подсказок:сПодсказкой.length,
        уТекущего:!!(текущая&&(текущая.textContent||'').indexOf('Первый раз')>=0),
        текущееЕсть:!!текущая,
        фикстура:(S.prog&&S.prog.plan||[]).some(x=>x.n==='Проба')
        &&!(SETS||[]).some(s=>s.e==='Икры сидя')&&!!document.querySelector('#v-train.on')});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    const k=(d.карт&&typeof d.карт==='object')?d.карт:{};
    chk(!d.сбой,'замер карточек зала сорвался: '+d.сбой);
    if(!d.сбой){
      chk(d.фикстура===true,'фикстура зала не встала (план «Проба» на сегодня, «Икры сидя» без истории, вкладка «Зал») — проверка веса в зале ничего не проверила');
      chk(!!(k['Отжимания от пола']&&k['Икры сидя']&&k['Жим лёжа']),
        'карточки упражнений не смонтированы — проверка веса в зале ничего не проверила');
    }
    if(k['Отжимания от пола']){
      chk(/свой вес/.test(k['Отжимания от пола'].текст),
        'движение со своим весом не сказано своим весом: «'+k['Отжимания от пола'].текст.slice(0,60)+'…»');
      chk(k['Отжимания от пола'].подсказка==='+кг',
        'у отжиманий поле веса подписано «'+k['Отжимания от пола'].подсказка
        +'» — приложение спрашивает, со сколькими килограммами человек отжимается');
    }
    /* ПЕРЕПИСАНО 11.09. Было: «у карточки без веса и без истории обязана
       быть подсказка». На свежей программе истории нет НИ У ОДНОГО движения,
       и правило было довольно шестью-семью одинаковыми надписями на одном
       экране — тем самым фоном, который учатся пролистывать. Обещание
       уточнилось: подсказка нужна, но ОДНА и там, где человек сейчас. */
    if(!d.сбой){
      chk(d.текущееЕсть===true,'на экране нет текущего упражнения (лаймового ряда) — правилу подсказки не от чего отсчитывать');
      chk(d.подсказок<=1,'подсказок «первый раз» на экране '+d.подсказок
        +' — на новой программе их столько же, сколько упражнений, и совет становится фоном');
      chk(d.подсказок===1,'подсказки «первый раз» нет нигде, хотя текущее движение без веса и без истории — человек с гантелей не знает, с чего начать');
      chk(d.уТекущего===true,'подсказка «первый раз» стоит не у того движения, где человек сейчас — совет мимо места');
    }
    if(k['Жим лёжа'])
      chk(!/Первый раз/.test(k['Жим лёжа'].текст),
        'подсказка «первый раз» вылезла там, где вес посчитан — лишняя строка на рабочем экране');
    /* И вторая сторона: как только появилась запись, строка обязана уйти.
       Запись — настоящим logWorkSet одним коротким вызовом, перерисовка —
       отдельным, пауза — в Node, итог — синхронным замером. */
    await шаг(з,`(async()=>{ await logWorkSet('Икры сидя',35,12,td()); return 1 })()`);
    await шаг(з,`(function(){ renderAll(); return 1 })()`); await sleep(700);
    await замер(з,`(function(){ try{
      const c=[...document.querySelectorAll('#v-train .wc')].find(x=>(x.textContent||'').trim().indexOf('Икры сидя')===0);
      return JSON.stringify({записано:(SETS||[]).some(s=>s.e==='Икры сидя'&&s.d===td()),
        после:c?(c.textContent||'').replace(/\\s+/g,' ').indexOf('Первый раз')>=0:'нет карточки'});
    }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    const после=з.сбой?'замер сорвался: '+з.сбой:з.после;
    if(!з.сбой) chk(з.записано===true,'подход «Икры сидя» за сегодня в память не лёг — вторая сторона правила ничего не проверила');
    chk(после===false,'после первой записи подсказка «первый раз» осталась ('+после
      +') — строка для новичка висит вечно');
    /* Уборка — всегда: подход фикстуры из хранилища, прежний план обратно
       в S и в хранилище, подходы перечитать, перерисовать. Одна запись за вызов. */
    await js(`(async()=>{ try{ const my=(SETS||[]).filter(s=>s.e==='Икры сидя'&&s.d===td()&&s.w===35&&s.r===12);
      for(const s of my) if(s.id!=null) await del('sets',s.id); SETS=await all('sets'); }catch(e){} return 1 })()`);
    await js(`(async()=>{ try{ if(typeof window.__залWas==='string'){ S.prog=JSON.parse(window.__залWas); window.__залWas=null; }
      await put('settings',S,'main'); renderAll(); }catch(e){} return 1 })()`);
    await sleep(200); drain();
  }

  /* ── СТАНДАРТ E НА ЖИВОМ ЭКРАНЕ (замеры владельца 11.09) ──
     Разметку сторожит смоук, а здесь меряем то, что видит глаз: реальную
     высоту раскрывашек, ширину текста в отчёте и пустую зону под кнопками.
     Всё три числа владелец снял руками на проде v570 — правило повторяет
     их замер, а не пересказывает намерение. */
  {
    /* Свои помощники: одноимённые из соседних блоков живут в их области
       видимости, и первая версия этого блока упала на «шаг is not defined»
       уже в браузере. Держим локальные. */
    const шагE=async expr=>{ await js(expr); };
    const замерE=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(400); r=await js(expr); }
      if(r&&r.__err) return {сбой:r.__err};
      try{ return JSON.parse(r)||{сбой:'страница промолчала'} }catch(x){ return {сбой:'страница промолчала'} } };
    let e={};
    /* Отчёт: открываем лист и меряем поле. */
    await шагE(`(function(){ try{ document.getElementById('repT').value=weekReport(); }catch(_){}
      sheet('sh-rep',true); return 1 })()`);
    await sleep(600);
    e=await замерE(`(function(){ try{
      const t=document.getElementById('repT'); if(!t) return JSON.stringify({нет:'repT'});
      const r=t.getBoundingClientRect();
      const row=document.querySelector('#sh-rep .row');
      const box=document.querySelector('#sh-rep .in');
      const rr=row?row.getBoundingClientRect():null, br=box?box.getBoundingClientRect():null;
      const btn=row?row.querySelector('button'):null;
      return JSON.stringify({
        ширина:Math.round(t.clientWidth), содержимое:Math.round(t.scrollWidth),
        высота:Math.round(r.height),
        подКнопками:(rr&&br)?Math.round(br.bottom-rr.bottom):null,
        кнопка:btn?Math.round(btn.getBoundingClientRect().height):null});
    }catch(x){ return JSON.stringify({сбой:x.message}) } })()`);
    if(!e.сбой&&!e.нет){
      chk(e.содержимое<=e.ширина+2,'в отчёте текст уезжает вбок: поле '+e.ширина
        +' px, содержимое '+e.содержимое+' px — читать можно только боковой прокруткой');
      chk(e.высота>=200,'поле отчёта высотой '+e.высота+' px — текста видно меньше экрана, хотя место есть');
      if(e.подКнопками!=null&&e.кнопка)
        chk(e.подКнопками<=e.кнопка+80,'под кнопками отчёта пустует '+e.подКнопками
          +' px при высоте кнопки '+e.кнопка+' — лист заканчивается пустотой, а текст обрезан сверху');
    } else chk(false,'замер отчёта сорвался: '+(e.сбой||e.нет));
    await шагE(`(function(){ document.querySelectorAll('.sheet.on').forEach(x=>x.classList.remove('on')); return 1 })()`);
    await sleep(200);
    /* Раскрывашки: любая ВИДИМАЯ не ниже 44 px. Меряем по всему документу —
       правило сквозное, а не про один экран. v612: единственная раскрывашка
       на экране «Зала» («Сообщения тренера») уехала в лист тренера, и правило
       осталось без объекта; открываем подвкладку «Программа» — там «История
       программы» и «Почему по опроснику» стоят всегда. */
    await шагE(`(function(){ (document.querySelector('nav button[data-v="train"]')||{click(){}}).click(); (document.querySelector('#v-train [data-tr="prog"]')||{click(){}}).click(); return 1 })()`);
    await sleep(500);
    const c2=await замерE(`(function(){ try{
      const all=[...document.querySelectorAll('summary')].filter(x=>{
        const r=x.getBoundingClientRect(); return r.width>0&&r.height>0; });
      const низкие=all.filter(x=>Math.round(x.getBoundingClientRect().height)<44)
        .slice(0,4).map(x=>((x.textContent||'').trim().slice(0,28)+' · '+Math.round(x.getBoundingClientRect().height)));
      return JSON.stringify({всего:all.length,низкие});
    }catch(x){ return JSON.stringify({сбой:x.message}) } })()`);
    if(!c2.сбой){
      chk(c2.всего>0,'на экране не нашлось ни одной раскрывашки — правило цели касания ничего не проверило');
      chk(!(c2.низкие||[]).length,'раскрывашки ниже 44 px: '+(c2.низкие||[]).join(' | ')
        +' — палец промахивается, и промах читается как «приложение не отвечает»');
    } else chk(false,'замер раскрывашек сорвался: '+c2.сбой);
    await шагE(`(function(){ (document.querySelector('#v-train [data-tr="log"]')||{click(){}}).click(); return 1 })()`); await sleep(300);
    /* Дата дня: ни одного многоточия в шапке «Зала». */
    await шагE(`(document.querySelector('nav button[data-v="train"]')||{click(){}}).click()`);
    await шагE(`(function(){ renderAll(); return 1 })()`); await sleep(700);
    const c14=await замерE(`(function(){ try{
      const d=document.querySelector('#v-train .dhd-o .d'); if(!d) return JSON.stringify({нет:'строки даты'});
      const st=getComputedStyle(d);
      return JSON.stringify({обрезка:st.textOverflow,ширина:Math.round(d.clientWidth),
        содержимое:Math.round(d.scrollWidth),текст:(d.textContent||'').trim().slice(0,40)});
    }catch(x){ return JSON.stringify({сбой:x.message}) } })()`);
    if(!c14.сбой&&!c14.нет){
      chk(c14.обрезка!=='ellipsis','строка даты в шапке «Зала» снова обрезается многоточием — «цикл 1, нед 3/4» пропадает');
      chk(c14.содержимое<=c14.ширина+2,'дата дня не помещается: '+c14.ширина+' px при содержимом '
        +c14.содержимое+' px («'+c14.текст+'») — часть строки человек не увидит');
    } else chk(false,'замер даты дня сорвался: '+(c14.сбой||c14.нет));
    drain();
  }

  /* ── СТЕК ЛИСТОВ НА ЖИВОМ ЭКРАНЕ (NAVIGATION.md §2, v591) ──
     Смоук держит стек как массив; здесь — то, что видит глаз и палец:
     ровно один видимый лист, спрятанный нижний возвращается, фон заперт
     position:fixed, свайп вниз закрывает, свайп с прокрученного листа — нет,
     фон с набранным текстом спрашивает. Касания — настоящие, через CDP. */
  {
    const шагN=async expr=>{ await js(expr); };
    const замерN=async expr=>{ let r=await js(expr); if(typeof r!=='string'||!r){ await sleep(300); r=await js(expr); }
      try{ return JSON.parse(r)||{сбой:'молчит'} }catch(x){ return {сбой:'молчит'} } };
    await шагN(`(function(){ NAV.stack.length=0; document.querySelectorAll('.sheet.on').forEach(s=>_sheetRaw(s.id,false)); return 1 })()`);
    await sleep(300);
    await шагN(`(function(){ sheet('sh-f',true); sheet('sh-a',true); return 1 })()`); await sleep(500);
    const st=await замерN(`(function(){ try{
      const vis=[...document.querySelectorAll('.sheet.on')].filter(s=>{ const r=s.querySelector('.in').getBoundingClientRect();
        return r.height>0&&getComputedStyle(s.querySelector('.in')).visibility!=='hidden'; }).map(s=>s.id);
      const f=document.getElementById('sh-f'), a=document.getElementById('sh-a');
      return JSON.stringify({видимых:vis, нижнийСпрятан:getComputedStyle(f.querySelector('.in')).visibility==='hidden',
        подложекНижнего:getComputedStyle(f,'::after').display, замок:document.documentElement.classList.contains('shlock'),
        bodyFixed:getComputedStyle(document.body).position==='fixed', стек:NAV.stack.join('>')});
    }catch(x){ return JSON.stringify({сбой:x.message}) } })()`);
    if(!st.сбой){
      chk(st.стек==='sh-f>sh-a','стек после двух открытий «'+st.стек+'»');
      chk((st.видимых||[]).length===1&&st.видимых[0]==='sh-a','видимых листов '+JSON.stringify(st.видимых)+' — на экране обязан быть один, верхний');
      chk(st.нижнийСпрятан===true,'нижний лист не спрятан — HIG «never stack sheets» нарушен на экране');
      chk(st.подложекНижнего==='none','подложку рисует и нижний лист — фон темнеет вдвое');
      chk(st.замок===true&&st.bodyFixed===true,'фон под листом не заперт position:fixed (shlock='+st.замок+', body='+st.bodyFixed+')');
    } else chk(false,'замер стека сорвался: '+st.сбой);
    /* Свайп вниз на 130 px закрывает верхний, нижний возвращается видимым */
    const r1=await замерN(`(function(){ const el=document.querySelector('#sh-a>.in'); const r=el.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+16), st:el.scrollTop}); })()`);
    if(r1&&!r1.сбой){
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r1.x,y:r1.y}]});
      for(let d=20;d<=130;d+=22){ await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r1.x,y:r1.y+d}]}); await sleep(16); }
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(400);
      const s2=await замерN(`(function(){ const f=document.getElementById('sh-f');
        return JSON.stringify({стек:NAV.stack.join('>'), нижнийВиден:getComputedStyle(f.querySelector('.in')).visibility!=='hidden'&&f.classList.contains('on')}); })()`);
      chk(s2.стек==='sh-f','свайп вниз на 130 px не закрыл верхний лист (стек «'+s2.стек+'») — грабер по-прежнему обещает жест, которого нет');
      chk(s2.нижнийВиден===true,'после ухода верхнего нижний лист не вернулся — человек остался перед пустым фоном');
    } else chk(false,'координаты для свайпа не сняты');
    /* Свайп на 60 px — не закрывает */
    const r2=await замерN(`(function(){ const el=document.querySelector('#sh-f>.in'); const r=el.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+16)}); })()`);
    if(r2&&!r2.сбой){
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r2.x,y:r2.y}]});
      for(let d=15;d<=60;d+=15){ await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r2.x,y:r2.y+d}]}); await sleep(16); }
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(400);
      const s3=await замерN(`(function(){ const el=document.querySelector('#sh-f>.in');
        return JSON.stringify({стек:NAV.stack.join('>'), сдвиг:getComputedStyle(el).transform}); })()`);
      chk(s3.стек==='sh-f','короткий свайп на 60 px закрыл лист — порог 120 не работает');
      chk(s3.сдвиг==='none'||s3.сдвиг==='matrix(1, 0, 0, 1, 0, 0)','после короткого свайпа шторка не вернулась наверх (transform='+s3.сдвиг+')');
    }
    /* Фон с набранным текстом (v603): вопрос — свой лист sh-dlg поверх, «Отмена» — лист остаётся */
    await шагN(`(function(){ document.getElementById('sh-f').setAttribute('data-dirty','1'); return 1 })()`);
    await шагN(`(function(){ document.getElementById('sh-f').click(); return 1 })()`); await sleep(500);
    const s4=await замерN(`(function(){ const d=document.getElementById('sh-dlg'); const b=d.querySelector('#dlgOk').getBoundingClientRect();
      return JSON.stringify({стек:NAV.stack.join('>'), виден:d.classList.contains('on'), заголовок:document.getElementById('dlgT').textContent, кнопка:Math.round(b.height)}); })()`);
    chk(s4.стек==='sh-f>sh-dlg'&&s4.виден===true,'тап по фону с набранным не положил вопрос поверх листа (стек «'+s4.стек+'», виден='+s4.виден+')');
    chk(s4.заголовок==='Закрыть без сохранения?','вопрос при закрытии с набранным — «'+s4.заголовок+'»');
    chk(s4.кнопка>=52,'кнопка вопроса ниже 52 px ('+s4.кнопка+')');
    await шагN(`(function(){ document.getElementById('dlgNo').click(); return 1 })()`); await sleep(500);
    const s4b=await замерN(`(function(){ return JSON.stringify({стек:NAV.stack.join('>'), нижнийВиден:document.getElementById('sh-f').classList.contains('on')&&!document.getElementById('sh-f').classList.contains('under')}); })()`);
    chk(s4b.стек==='sh-f'&&s4b.нижнийВиден===true,'после «Отмена» лист с набранным не вернулся (стек «'+s4b.стек+'», виден='+s4b.нижнийВиден+') — потеря данных или пустой фон');
    /* Уборка: всё закрыть, замок снят */
    await шагN(`(function(){ navClose('sh-f','code'); return 1 })()`); await sleep(400);
    const s5=await замерN(`(function(){ return JSON.stringify({стек:NAV.stack.length, замок:document.documentElement.classList.contains('shlock'), body:getComputedStyle(document.body).position}); })()`);
    chk(s5.стек===0&&s5.замок===false&&s5.body!=='fixed','после закрытия всего замок не снят (shlock='+s5.замок+', body='+s5.body+') — страница осталась запертой');
    drain();
  }

  /* ── ЗВОНОК ПОСРЕДИ ОТДЫХА НА ЖИВОМ <audio> (NAVIGATION.md §2.5, v592) ──
     Смоук меряет на подменённом элементе; здесь — настоящий <audio> и
     настоящее событие pause: чужая пауза возвращает тишину, отвергнутый
     play() превращает подпись полосы в призыв, тап по полосе — жест,
     который зовёт play() снова и снимает призыв, не разворачивая полосу. */
  {
    const шагA=async expr=>{ await js(expr); };
    await шагA(`(function(){ try{ stopRest(); }catch(_){} S.restMute=0; S.restNoWake=0; startRest(60,'проба'); return 1 })()`);
    await sleep(300);
    const есть=await js(`(function(){ const a=_restAud; if(!a) return 'нет';
      window.__pl=0; window.__mode='ok';
      a.play=function(){ window.__pl++; return window.__mode==='ok'?Promise.resolve():Promise.reject(new DOMException('gesture','NotAllowedError')); };
      a.dispatchEvent(new Event('pause')); return 'есть' })()`);
    chk(есть==='есть','после старта отдыха нет элемента тишины — проверка звонка смотрит в пустоту');
    await sleep(600);
    const pl=await js('window.__pl|0');
    chk(pl>=1,'чужая пауза тишины (событие pause на живом <audio>) не перезапустила play() — после звонка страница под замком уснёт без сигнала');
    await шагA(`(function(){ window.__mode='no'; restKeepOn(); return 1 })()`); await sleep(150);
    const cap=await js(`document.getElementById('restCap').textContent`);
    const mute=await js(`document.getElementById('restBar').classList.contains('mute')`);
    chk(String(cap).indexOf('нажми')>=0,'play() отвергнут после прерывания, а подпись полосы «'+cap+'» не зовёт нажать');
    chk(mute===true,'play() отвергнут, а полоса не помечена классом mute — подпись выглядит как обычная');
    await шагA(`(function(){ window.__mode='ok'; document.getElementById('restBar').click(); return 1 })()`); await sleep(150);
    const cap2=await js(`document.getElementById('restCap').textContent`);
    const big=await js(`document.getElementById('restBar').classList.contains('big')`);
    const pl2=await js('window.__pl|0');
    chk(pl2>pl,'тап по полосе при заблокированном сигнале не позвал play() — жест человека пропал зря');
    chk(String(cap2).indexOf('нажми')<0,'play() прошёл после тапа, а подпись «'+cap2+'» всё ещё зовёт нажать');
    chk(big===false,'тап при заблокированном сигнале развернул полосу на весь экран вместо возврата звука');
    await шагA(`(function(){ try{ delete _restAud.play; }catch(_){} stopRest(); return 1 })()`); await sleep(200);
    const после=await js(`(function(){ return JSON.stringify({on:document.getElementById('restBar').classList.contains('on'),end:restEndAt|0}) })()`);
    chk(после==='{"on":false,"end":0}','после «Стоп» полоса или таймер не сброшены: '+после);
    drain();
  }
  /* ── ВКЛАДКИ ПОМНЯТ ПРОКРУТКУ НА ЖИВОМ ЭКРАНЕ (NAVIGATION.md §2.4, v593) ── */
  {
    await js(`(function(){ NAV.stack.length=0; document.querySelectorAll('.sheet.on').forEach(s=>_sheetRaw(s.id,false)); goView('food');
      /* v636: первый экран короче окна — память прокрутки меряем на временной подложке */
      const v=document.getElementById('v-food'); if(v) v.style.paddingBottom='1400px'; return 1 })()`); await sleep(300);
    await js('scrollTo(0,300)'); await sleep(200);
    const y0=+await js('Math.round(scrollY)');
    await js(`goView('train')`); await sleep(300);
    const yT=+await js('Math.round(scrollY)');
    await js(`goView('food')`); await sleep(300);
    const yF=+await js('Math.round(scrollY)');
    await js(`document.querySelector('nav button[data-v="food"]').click()`); await sleep(300);
    const yF2=+await js('Math.round(scrollY)');
    chk(y0>=250,'стенд: «Еда» не прокрутилась на 300 ('+y0+') — правило памяти прокрутки смотрело бы в пустоту');
    await js(`(function(){ const v=document.getElementById('v-food'); if(v) v.style.paddingBottom=''; return 1 })()`);
    chk(yT===0,'первый заход в «Зал» не наверху: '+yT);
    chk(Math.abs(yF-y0)<=2,'возврат на «Еду» не вернул прокрутку: было '+y0+', стало '+yF+' — человек ищет, где был');
    chk(yF2===0,'тап по активной «Еде» не поднял наверх: '+yF2);
    await js('scrollTo(0,0)'); drain();
  }
  /* ── ОТКРЫТЫЙ ЛИСТ ПРИ СМЕНЕ ДНЯ НА ЖИВОМ ЭКРАНЕ (NAVIGATION.md P2, v594) ── */
  {
    const чисто=`NAV.stack.length=0; document.querySelectorAll('.sheet.on').forEach(s=>_sheetRaw(s.id,false));`;
    await js(`(function(){ ${чисто} sheet('sh-sess',true); __renderDay='2000-01-01'; return 1 })()`); await sleep(200);
    const a=await js(`(function(){ const r=dayRoll(); return JSON.stringify({r, on:document.getElementById('sh-sess').classList.contains('on'),
      тост:document.getElementById('toast').classList.contains('on')?document.getElementById('toast').textContent:''}) })()`);
    const A=JSON.parse(a||'{}');
    chk(A.r===true&&A.on===false,'смена дня при открытой «Закрыть тренировку»: лист остался со вчерашним днём ('+a+')');
    chk(String(A.тост).indexOf('смен')>=0,'лист закрыт по смене дня, а тоста нет — экран пропал молча');
    await js(`(function(){ ${чисто} sheet('sh-rep',true); document.getElementById('repT').value='вчера'; __renderDay='2000-01-01'; return 1 })()`); await sleep(200);
    const b=await js(`(function(){ dayRoll(); return JSON.stringify({on:document.getElementById('sh-rep').classList.contains('on'), v:document.getElementById('repT').value.slice(0,5)}) })()`);
    const B=JSON.parse(b||'{}');
    chk(B.on===true&&B.v!=='вчера','«Отчёт за неделю» при смене дня не перерисован на месте ('+b+')');
    await js(`(function(){ ${чисто} sheet('sh-sess',true); document.getElementById('sh-sess').setAttribute('data-dirty','1'); __renderDay='2000-01-01'; return 1 })()`); await sleep(200);
    const c=await js(`(function(){ dayRoll(); return document.getElementById('sh-sess').classList.contains('on') })()`);
    chk(c===true,'лист с набранным текстом закрыт по смене дня — атлет потерял введённое');
    await js(`(function(){ document.getElementById('sh-sess').setAttribute('data-dirty','0'); ${чисто} __renderDay=td(); return 1 })()`); await sleep(200); drain();
  }
  /* ── × НА ВЕДУЩЕМ КРАЮ НА ЖИВОМ ЭКРАНЕ (NAVIGATION.md P3, v595) ──
     На каждом листе: крестик левее заголовка и у левого края панели. */
  {
    await js(`(function(){ NAV.stack.length=0; document.querySelectorAll('.sheet.on').forEach(s=>_sheetRaw(s.id,false)); return 1 })()`); await sleep(200);
    const ids=JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.sheet')].filter(s=>s.querySelector(':scope>.in>h3>[data-close]')).map(s=>s.id))`)||'[]');
    const плохо=[]; let мерено=0;
    for(const id of ids){
      await js(`(function(){ _sheetRaw('${id}',true); return 1 })()`); await sleep(120);
      const r=await js(`(function(){ try{ const s=document.getElementById('${id}'), inn=s.querySelector(':scope>.in'), h=inn.querySelector(':scope>h3'),
        x=h.querySelector('[data-close]'), t=h.querySelector('span'); const xr=x.getBoundingClientRect(), tr=t.getBoundingClientRect(), ir=inn.getBoundingClientRect();
        if(xr.width===0) return 'скрыт'; return JSON.stringify({x:Math.round(xr.left-ir.left), t:Math.round(tr.left-ir.left), w:Math.round(xr.width)}); }catch(e){ return 'сбой '+e.message } })()`);
      await js(`(function(){ _sheetRaw('${id}',false); return 1 })()`);
      if(typeof r!=='string'||r[0]!=='{') continue;
      const o=JSON.parse(r); мерено++;
      if(!(o.x<o.t)||o.x>40) плохо.push(id+' (× на '+o.x+', заголовок на '+o.t+')');
    }
    chk(мерено>=25,'крестики померены только на '+мерено+' листах — правило смотрит в пустоту');
    chk(!плохо.length,'крестик не на ведущем краю шапки (HIG sheets: Close слева, Done справа): '+плохо.slice(0,4).join(' · '));
    await sleep(200); drain();
  }
  /* ── «РАСХОД И ЦЕЛЬ» НА ЖИВОМ ЭКРАНЕ (v596) — что видит глаз, а не что написано в CSS ── */
  {
    /* v616: ручной кнопки «Пересчитать» больше нет — расход пересчитывается сам,
       поэтому стенд зовёт тот же recalc напрямую. */
    await js(`(async function(){ NAV.stack.length=0; document.querySelectorAll('.sheet.on').forEach(s=>_sheetRaw(s.id,false)); goView('coach'); try{ await recalc(true); rFood(); rCoach(); }catch(_){} sheet('sh-tdee',true); return 1 })()`); await sleep(500);
    const r=await js(`(function(){ try{ const q=id=>document.getElementById(id), cs=e=>getComputedStyle(e), rc=e=>e.getBoundingClientRect();
      const tdV=q('tdV'), bnu=document.querySelector('#sh-tdee .bnu'), gP=q('gP'), lab=gP.parentElement.querySelector('.mini'), card=document.querySelector('#sh-tdee .card');
      const sums=[...document.querySelectorAll('#sh-tdee summary')].map(x=>({h:Math.round(rc(x).height),fw:cs(x).fontWeight,chev:getComputedStyle(x,'::after').width,left:getComputedStyle(x,'::before').display}));   // псевдоэлементы — только прямым getComputedStyle: обёртка с одним аргументом молча вернула бы стиль самого summary
      const stats=[...document.querySelectorAll('#sh-tdee .tdee-rows .stat')].map(x=>({fw:cs(x.querySelector('.l')).fontWeight,tn:cs(x.querySelector('.v')).fontVariantNumeric}));
      return JSON.stringify({heroH:Math.round(rc(tdV).height),heroFw:cs(tdV).fontWeight,heroLs:cs(tdV).letterSpacing,capBelow:rc(bnu).top>=rc(tdV).bottom-2,
        macroAbove:rc(gP).bottom<=rc(lab).top+2,macroFw:cs(gP).fontWeight,кнопка:!!q('bRe'),
        cardR:cs(card).borderRadius,cardBg:cs(card).backgroundColor,sums,stats}); }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
    const o=JSON.parse(r||'{}');
    chk(!o.сбой,'замер листа «Расход и цель» сорвался: '+o.сбой);
    if(!o.сбой){
      chk(o.heroH>0,'герой листа «Расход и цель» не виден после пересчёта — стенд без расхода, замер смотрит в пустоту');
      chk(o.кнопка===false,'в листе расхода снова ручная кнопка «Пересчитать» — человек обслуживает алгоритм руками (v616)');
      chk(o.heroFw==='800'&&o.heroLs==='-0.5px','герой расхода не доминирует: вес '+o.heroFw+', трекинг '+o.heroLs);
      chk(o.capBelow===true,'подпись героя стоит рядом с цифрой, а не под ней');
      chk(o.macroAbove===true&&o.macroFw==='700','в плитке БЖУ цифра не над подписью или не 700 (вес '+o.macroFw+')');
      chk(o.cardR==='24px'&&o.cardBg==='rgb(28, 28, 30)','карточка листа: '+o.cardR+' / '+o.cardBg+' вместо 24px / #1C1C1E');
      chk(o.sums.length>=2&&o.sums.every(x=>x.h>=48&&x.fw==='600'&&x.chev==='14px'&&x.left==='none'),'строки-переходы не нативные: '+JSON.stringify(o.sums));
      chk(o.stats.length===3&&o.stats.every(x=>x.fw==='400'&&x.tn==='tabular-nums'),'строки темпа: '+JSON.stringify(o.stats));
    }
    await js(`(function(){ NAV.stack.length=0; document.querySelectorAll('.sheet.on').forEach(s=>_sheetRaw(s.id,false)); goView('food'); return 1 })()`); await sleep(200); drain();
  }
  /* ── ВЫРЕЗ И ПОЛОСА ХОУМ-СВАЙПА (v620) ──
     Правило отвечает на один вопрос: можно ли ДОТЯНУТЬСЯ. Безопасные зоны в
     CSS стояли давно, но высоту панели вкладок мерил только обработчик
     resize, а до него в силе были запасные 62 px из CSS. На iPhone с полосой
     хоум-свайпа панель высотой 101 px — и строка поиска «Еды» заходила под
     неё на 31 px, а «Добавить упражнение» в «Зале» на 21 px: доскроллить до
     них было нельзя в принципе. Меряем то, что видит палец. */
  {
    await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:3,mobile:true});
    await send('Page.navigate',{url:BASE+'/notch.html'});
    if(await ready('страница с вырезом')){
      await js(`(function(){ const b=document.getElementById('gLocal'); if(b&&b.offsetParent!==null) b.click(); return 1 })()`);
      await sleep(1400); drain();
      /* длинный день — чтобы страница заведомо прокручивалась */
      await js(`(async function(){ const t=dn(td());
        for(let i=0;i<24;i++) await put('log',{d:t,n:'Строка дневника '+i,a:100,u:100,un:'г',k:120,p:18,f:5,c:3});
        LOG=await all('log'); renderAll(); return LOG.length })()`);
      await sleep(700);
      const H=852, SAT=59, SAB=34;
      /* Шапка: заголовок и шестерёнка обязаны стоять НИЖЕ выреза */
      const top=JSON.parse(await js(`(function(){ const r=e=>e.getBoundingClientRect();
        return JSON.stringify({заголовок:Math.round(r(document.getElementById('hT')).top),
          шестерёнка:Math.round(r(document.getElementById('bSet')).top),
          шапка:Math.round(r(document.querySelector('header')).height)}) })()`)||'{}');
      chk(top.заголовок>=SAT,'заголовок экрана заходит под вырез камеры: top='+top.заголовок+' при вырезе '+SAT);
      chk(top.шестерёнка>=SAT,'шестерёнка настроек заходит под вырез камеры: top='+top.шестерёнка);
      /* Панель вкладок: заливает полосу собой, кнопки выше полосы */
      const bot=JSON.parse(await js(`(function(){ const nv=document.querySelector('nav'), r=nv.getBoundingClientRect();
        const b=nv.querySelector('button').getBoundingClientRect(), cs=getComputedStyle(nv);
        return JSON.stringify({низПанели:Math.round(innerHeight-r.bottom),высота:Math.round(r.height),
          кнопкаВысота:Math.round(b.height),кнопкаНизОтКрая:Math.round(innerHeight-b.bottom),
          фон:cs.backgroundColor,navh:getComputedStyle(document.documentElement).getPropertyValue('--navh').trim()}) })()`)||'{}');
      chk(bot.низПанели===0,'панель вкладок не прижата к краю — под ней видна полоса фона: '+bot.низПанели+' px');
      chk(bot.кнопкаНизОтКрая>=SAB-1,'кнопки вкладок стоят в полосе хоум-свайпа: до края '+bot.кнопкаНизОтКрая+' px при полосе '+SAB);
      chk(bot.кнопкаВысота>=48,'кнопка вкладки ниже 48 px ('+bot.кнопкаВысота+') — на телефоне с полосой жеста это промах');
      chk(bot.navh===bot.высота+'px','--navh ('+bot.navh+') разошлась с настоящей высотой панели ('+bot.высота+' px) — от неё считаются все нижние полосы');
      /* Главное: до последней строки можно доскроллить так, чтобы она вышла из-под панели */
      for(const v of ['food','train']){
        const o=JSON.parse(await js(`(async function(){ goView('${v}'); await new Promise(r=>setTimeout(r,500));
          scrollTo(0,document.body.scrollHeight); await new Promise(r=>setTimeout(r,350));
          const H=innerHeight, nv=document.querySelector('nav').getBoundingClientRect();
          const ctl=new Set(['BUTTON','A','INPUT','SELECT','TEXTAREA','SUMMARY','LABEL']);
          const ink=el=>{ if(ctl.has(el.tagName)) return true;
            for(const n of el.childNodes) if(n.nodeType===3&&n.textContent.trim()) return true; return false; };
          let worst=-1, name='';
          document.querySelectorAll('main *, .fbar, .fbar *').forEach(el=>{ const cs=getComputedStyle(el);
            if(cs.display==='none'||cs.visibility==='hidden') return;
            const r=el.getBoundingClientRect();
            if(r.width<2||r.height<2||r.top>H||!ink(el)) return;
            if(r.bottom>worst){ worst=r.bottom; name=el.tagName.toLowerCase()+(el.id?'#'+el.id:''); } });
          return JSON.stringify({подПанельНа:Math.round(worst-nv.top),что:name}) })()`)||'{}');
        chk(o.подПанельНа<=0,'на вкладке «'+v+'» после прокрутки до упора «'+o.что+'» остаётся под панелью вкладок на '+o.подПанельНа+' px — дотянуться нельзя');
      }
    }
  }
  /* ── ГДЕ БОЛИТ: ФИГУРА (v628) ──
     Картинку смоук не видит: он проверяет строку разметки, а не то, куда
     попадёт палец. Здесь меряем настоящую зону попадания (elementFromPoint
     от центра во все стороны) и то, что тап красит ВСЕ пути этой зоны. */
  {
    const фиг=await js(`(async function(){
      try{ const b=document.getElementById('bGenProg'); if(b&&b.onclick) b.onclick(); }catch(e){ return JSON.stringify({сбой:String(e)}); }
      await new Promise(r=>setTimeout(r,800));
      const box=document.getElementById('pg_inj');
      if(!box) return JSON.stringify({сбой:'контейнера нет'});
      box.scrollIntoView({block:'center'});
      await new Promise(r=>setTimeout(r,250));
      const мера=k=>{ const z=box.querySelector('[data-joint="'+k+'"]'); if(!z) return null;
        const r=z.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
        const тянем=(dx,dy)=>{ let d=0; for(let i=1;i<70;i++){ const e=document.elementFromPoint(cx+dx*i,cy+dy*i);
          if(!e||!e.closest||!e.closest('[data-joint="'+k+'"]')) break; d=i; } return d; };
        return {w:тянем(-1,0)+тянем(1,0),h:тянем(0,-1)+тянем(0,1)}; };
      const зоны={}; ['shoulder','elbow','knee','back'].forEach(k=>{ зоны[k]=мера(k); });
      const было=injPick(box).slice();
      box.querySelector('[data-joint="knee"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      const колени=[...box.querySelectorAll('[data-joint="knee"]')];
      const цвет=getComputedStyle(колени[0]).fill;
      const горят=колени.filter(x=>x.classList.contains('on')).length;
      const стало=injPick(box).slice();
      const эхо=(box.querySelector('.injEcho')||{}).textContent||'';   // строка состояния — СРАЗУ после тапа
      box.querySelector('[data-joint="knee"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
      const сняли=injPick(box).slice();
      return JSON.stringify({зоны,было,стало,сняли,цвет,горят,всего:колени.length,эхо}); })()`);
    const o=JSON.parse(фиг||'{}');
    chk(!o.сбой,'фигуру «где болит» не открыть: '+o.сбой);
    if(!o.сбой){
      ['shoulder','elbow','knee','back'].forEach(k=>{
        const z=o.зоны&&o.зоны[k];
        chk(!!z,'зоны «'+k+'» на фигуре нет — ограничение движка стало недоступно');
        if(z) chk(z.w>=44&&z.h>=44,'зона «'+k+'» на фигуре ловит палец в '+z.w+'x'+z.h+' px — меньше порога 44');
      });
      chk(o.горят===o.всего,'тап по колену зажёг '+o.горят+' путей из '+o.всего+' — на второй фигуре зона осталась серой');
      chk(/255,\s*69,\s*58/.test(o.цвет||''),'отмеченная зона не системного красного цвета, а «'+o.цвет+'»');
      chk((o.стало||[]).indexOf('knee')>=0,'тап по колену не попал в выбор: '+JSON.stringify(o.стало));
      chk((o.сняли||[]).indexOf('knee')<0,'повторный тап не снимает отметку — снять боль станет нечем');
      chk(/колени/i.test(o.эхо||''),'под фигурой не сказано, что именно исключаем: «'+o.эхо+'»');
    }
    await js(`(function(){ try{ navClose(NAV.stack[NAV.stack.length-1],'button'); }catch(e){} })()`);
    await sleep(400);
  }

  /* ── ОДИН ТАП — ОДНО ДЕЙСТВИЕ (v629) ──
     Фейковый DOM гейта событий не рассылает: гонку видно только здесь.
     Три тапа подряд без ожидания — ровно то, что делает потный палец. */
  {
    const гонка=await js(`(async function(){
      try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){}
      goView('train');
      S.prog={cfg:{days:3,mins:60,goal:'hyp',inj:[]},created:'2026-01-01',
        plan:[{dow:dowOf(td()),n:'Стенд гонки',ex:[{n:'Жим лёжа',sets:3,lo:6,hi:10,main:true}]}]};
      await put('settings',S,'main'); rTrain();
      await new Promise(r=>setTimeout(r,900));
      const b=document.querySelector('[data-add]');
      if(!b) return JSON.stringify({сбой:'кнопки записи подхода нет на экране'});
      const ei=b.dataset.ei;
      const wEl=document.getElementById('wkg_'+ei), rEl=document.getElementById('wrep_'+ei);
      if(wEl) wEl.value='80'; if(rEl) rEl.value='8';
      const было=(await all('sets')).filter(x=>x.d===td()&&x.e==='Жим лёжа').length;
      b.click(); b.click(); b.click();
      await new Promise(r=>setTimeout(r,900));
      const подходы=(await all('sets')).filter(x=>x.d===td()&&x.e==='Жим лёжа');
      /* а вот повтор, который ОСМЫСЛЕН: три порции — это три записи */
      goView('food');
      await put('foods',{id:962777,n:'Стенд гонки творог',u:100,un:'г',k:120,p:18,f:5,c:3,used:9,last:150});
      FOODS=await all('foods'); LOG=await all('log'); rFood();
      await new Promise(r=>setTimeout(r,600));
      const едаБыло=(await all('log')).length;
      const q=document.querySelector('#qList [data-qa="962777"]');
      if(q){ q.click(); q.click(); q.click(); }
      await new Promise(r=>setTimeout(r,900));
      return JSON.stringify({подходовБыло:было,подходовСтало:подходы.length,
        записи:подходы.slice(-3).map(x=>x.w+'x'+x.r),
        едаБыло,едаСтало:(await all('log')).length,плиткаЕсть:!!q}); })()`);
    const o=JSON.parse(гонка||'{}');
    chk(!o.сбой,'стенд гонки не поднялся: '+o.сбой);
    if(!o.сбой){
      chk(o.подходовСтало-o.подходовБыло===1,
        'три быстрых тапа по «записать подход» записали '+(o.подходовСтало-o.подходовБыло)
        +' подхода ('+(o.записи||[]).join(' · ')+') — тоннаж завышен, прогрессия считает лишнее');
      chk(o.плиткаЕсть!==true||o.едаСтало-o.едаБыло===3,
        'три тапа по «+» в кладовой дали '+(o.едаСтало-o.едаБыло)+' записи вместо трёх — сторож съел осмысленный повтор');
    }
  }

  /* ── НАБРАННОЕ И СИСТЕМНАЯ «НАЗАД» (v629) ──
     Из трёх путей закрытия мимо кнопки (фон, свайп, «назад») предупреждали
     только два: аппаратная кнопка уносила черновик молча. */
  {
    const черновик=await js(`(async function(){
      /* На время стенда глушим НАСТОЯЩИЙ переход по истории: у прогона своя
         глубина, и один лишний history.back() уносит страницу со стенда.
         Логику NAV это не трогает — она принимает те же решения. */
      const _hb=history.back; history.back=function(){};
      try{
      while(NAV.stack.length) navPop('code');
      sheet('sh-f',true); await new Promise(r=>setTimeout(r,250));
      const el=document.getElementById('fd_n');
      if(!el) return JSON.stringify({сбой:'поля формы продукта нет'});
      el.value='черновик'; el.dispatchEvent(new Event('input',{bubbles:true}));
      const метка=document.getElementById('sh-f').getAttribute('data-dirty');
      /* аппаратная «назад» приходит в приложение одним событием popstate.
         Дёргать настоящую history.back() здесь нельзя: у прогона своя глубина
         истории, и страница уезжает со стенда целиком. */
      dispatchEvent(new PopStateEvent('popstate',{state:history.state}));
      await new Promise(r=>setTimeout(r,400));
      const листЖив=document.getElementById('sh-f').classList.contains('on');
      const спросили=document.getElementById('sh-dlg').classList.contains('on');
      /* ответим «Закрыть» — лист обязан уйти, а стек остаться чистым */
      try{ document.getElementById('dlgOk').onclick(); }catch(e){}
      await new Promise(r=>setTimeout(r,450));
      const ушёл=!document.getElementById('sh-f').classList.contains('on');
      const стек=NAV.stack.length, замок=document.documentElement.classList.contains('shlock');
      while(NAV.stack.length) navPop('code');
      return JSON.stringify({метка,листЖив,спросили,ушёл,стек,замок});
      } finally{ history.back=_hb; } })()`);
    const o=JSON.parse(черновик||'{}');
    chk(!o.сбой,'стенд черновика не поднялся: '+o.сбой);
    if(!o.сбой){
      chk(o.метка==='1','набранное в листе не помечено как черновик — предупреждать будет не о чем');
      chk(o.спросили===true,'системная «назад» закрыла лист с набранным МОЛЧА — набранное пропало без вопроса');
      chk(o.листЖив===true,'лист с набранным исчез ещё до ответа на вопрос');
      chk(o.ушёл===true&&o.стек===0,'после ответа «Закрыть» лист остался в стеке ('+o.стек+') — интерфейс заперт');
      chk(o.замок===false,'страница осталась запертой после закрытия листа — ничего не листается');
    }
  }

  /* ── ЭКРАН «ЕДА» v634 ──
     Смоук видит строку разметки, браузер — куда попадёт палец и что человек
     прочитает. Здесь: кольца в шапке нет, калории стоят первой строкой
     таблицы БЖУ и в неё влезает четырёхзначная цель, вода и шаги ужаты, но
     +250/+500 и поле шагов на месте, имя приёма не переносится, а неделя
     живёт в листе, который открывается тапом по дате. */
  {
    const экран=await js(`(async function(){
      try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){}
      goView('food');
      S.h=180;S.age=30;S.sex='m';S.tdee=2600;S.rate=0;S.target=null;S.kcalManual=0;
      const t=dn(td());
      /* чистим неделю: прошлые стенды уже писали в эти дни */
      { const было=await all('log');
        for(const x of было) if(dn(x.d)>=t-6&&dn(x.d)<=t) await del('log',x.id); }
      /* сегодня — приём с большими числами, как у владельца на живых данных:
         1282 ккал и Б 107 в одном завтраке ломали имя приёма */
      await put('log',{d:td(),n:'Стенд завтрак',a:300,u:100,un:'г',k:1282,p:107,f:29,c:144,slot:'bf'});
      for(let i=1;i<6;i++) await put('log',{d:ds(t-i),n:'Стенд',a:300,u:100,un:'г',k:i===2?4200:2400,p:100,f:60,c:200});
      await put('weight',{d:td(),kg:80});
      LOG=await all('log'); W=await all('weight'); recalc(true); rFood();
      await new Promise(r=>setTimeout(r,800));
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,300));
      window.scrollTo(0,0);
      const дата=document.getElementById('hSb');
      if(!дата) return JSON.stringify({сбой:'даты-кнопки в шапке нет'});
      const ряд=document.querySelector('.hdrow');
      if(!ряд) return JSON.stringify({сбой:'верхнего ряда .hdrow нет'});
      const цель=(el)=>{ const r=el.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height)}; };
      const top=id=>{ const e=document.getElementById(id); return e?Math.round(e.getBoundingClientRect().top+scrollY):-1; };
      const h=id=>{ const e=document.getElementById(id); return e?Math.round(e.getBoundingClientRect().height):-1; };
      /* строка калорий: число целиком в одной строке, цвет числа = цвет полосы */
      const kv=document.getElementById('kV'), kb=document.getElementById('kB');
      const kvr=kv?kv.getBoundingClientRect():null;
      /* строки считаем по НАСТОЯЩЕЙ высоте строки числа, а не по 24 px:
         на fs4 строка 40 px, и деление на 24 выдавало «две строки» там, где
         число стояло одной (ошибка стенда, пойманная первым прогоном) */
      const kvlh=kv?(parseFloat(getComputedStyle(kv).lineHeight)||24):24;
      const калории={текст:kv?kv.textContent.trim():'',строк:kvr?Math.round(kvr.height/kvlh):0,
        цвет:kv?getComputedStyle(kv).color:'',полоса:kb?getComputedStyle(kb).backgroundColor:''};
      /* имя приёма и его сосед */
      let приём=null;
      document.querySelectorAll('#v-food .dgrp summary').forEach(sm=>{
        const a=sm.children[0], b=sm.children[1]; if(!a||!b||приём) return;
        const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
        if(ra.height>0) приём={имя:(a.textContent||'').trim(),имяВ:Math.round(ra.height),имяШ:Math.round(ra.width),соседШ:Math.round(rb.width)};
      });
      /* вода и шаги: компактны, функция на месте */
      const пилюли=[...document.querySelectorAll('#waterCard .wpill')].map(цель);
      const шагиДо=document.getElementById('stInline').style.display;
      document.getElementById('stEdit').click();
      await new Promise(r=>setTimeout(r,250));
      const шагиПосле=document.getElementById('stInline').style.display;
      const полеШагов=цель(document.getElementById('stQuick'));
      document.getElementById('stEdit').click();
      /* лист дня по тапу на дату */
      дата.click();
      await new Promise(r=>setTimeout(r,600));
      const лист=document.getElementById('sh-day');
      const листОткрыт=!!(лист&&лист.classList.contains('on'));
      const wk=document.getElementById('wkRings');
      const дни=wk?[...wk.querySelectorAll('[data-wkd]')]:[];
      const мелкие=дни.map(цель).filter(z=>z.w<44||z.h<44);
      const подпись=((document.getElementById('dayUnit')||{}).textContent||'').trim();
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,400));
      return JSON.stringify({калории,приём,пилюли,шагиДо,шагиПосле,полеШагов,листОткрыт,дней:дни.length,мелкие,подпись,
        кольцо:document.querySelectorAll('#ringsRow, .rgMini, .rgArt').length,
        счётчикиВШапке:document.querySelectorAll('header .rgTip, header .rgSide, header .rgBigU, header .rgL, header .rgBig').length,
        карточкаДня:document.querySelectorAll('#todayCard').length,
        рядВысота:Math.round(ряд.getBoundingClientRect().height),
        бжуДо:top('macCard'),водаДо:top('waterCard'),водаВысота:h('waterCard'),шагиВысота:h('stepsCard'),
        дневникШапка:((document.getElementById('dSum')||{}).textContent||'').trim(),
        экран:innerHeight,узловЕда:document.querySelectorAll('#v-food *').length}); })()`);
    const o=JSON.parse(экран||'{}');
    chk(!o.сбой,'экран «Еды» не собрать: '+o.сбой);
    if(!o.сбой){
      chk(o.кольцо===0,'кольцо вернулось на экран ('+o.кольцо+') — решение автора его снять');
      chk(o.счётчикиВШапке===0,'в шапке снова текстовые счётчики ('+o.счётчикиВШапке+')');
      chk(o.карточкаДня===0,'карточка дня #todayCard вернулась на экран');
      chk(o.рядВысота<=48,'верхний ряд шапки '+o.рядВысота+' px — заголовок растит шапку');
      chk(/^\d{3,4}\/\d{3,4} ккал$/.test(o.калории.текст),'строка калорий читается как «'+o.калории.текст+'» — ждали «съедено/цель ккал»');
      chk(o.калории.строк<=1,'число калорий легло в '+o.калории.строк+' строки — четырёхзначная цель не влезает');
      chk(o.калории.цвет===o.калории.полоса,'калории: число '+o.калории.цвет+', полоса '+o.калории.полоса+' — цвет не закреплён за величиной');
      chk(!!o.приём,'в дневнике не нашлось ни одного приёма — проверка имени приёма холостая');
      if(o.приём) chk(o.приём.имяВ<=26,'имя приёма «'+o.приём.имя+'» легло в '+o.приём.имяВ+' px высоты рядом со значением '+o.приём.соседШ+' px — снова две строки');
      chk(o.пилюли.length===2&&o.пилюли.every(p=>p.h>=44),'пилюли воды после ужатия: '+JSON.stringify(o.пилюли)+' — цель ниже 44');
      chk(o.шагиДо==='none'&&o.шагиПосле!=='none','тап по шагам не раскрыл поле ввода — функция потеряна при ужатии');
      chk(o.полеШагов.h>=44,'поле шагов '+o.полеШагов.h+' px — в него не попасть');
      chk(o.водаВысота>0&&o.водаВысота<=170,'карточка воды '+o.водаВысота+' px высотой — ужатие не состоялось (было ~250)');
      chk(o.шагиВысота>0&&o.шагиВысота<=170,'карточка шагов '+o.шагиВысота+' px высотой — ужатие не состоялось');
      chk(o.бжуДо>=0&&o.бжуДо<=200,'карточка БЖУ на '+o.бжуДо+' px от верха — шапка снова съела первый экран');
      chk(o.водаДо>=0&&o.водаДо<=(o.экран||844)-100,'карточка воды на '+o.водаДо+' px при экране '+o.экран+' — ушла за первый экран');
      chk(o.дневникШапка.indexOf('ккал')<0,'в шапке дневника снова калории: «'+o.дневникШапка+'» — одно число дважды');
      chk(o.листОткрыт===true,'тап по дате не открыл лист выбора дня');
      chk(o.дней===7,'в мини-неделе '+o.дней+' дней вместо семи');
      chk((o.мелкие||[]).length===0,'дни недели мельче 44 px: '+JSON.stringify(o.мелкие));
      chk(!!o.подпись,'в листе дня пустая строка состояния');
      chk(o.узловЕда<200,'узлов на вкладке «Еда» '+o.узловЕда+' — экран снова разросся');
    }
  }

  /* ── ЛИСТ ЗАПИСИ v635: «ВРУЧНУЮ» ВНУТРИ ВЫДАЧИ, ДНЕВНИК БЕЗ КНОПОК ──
     Смоук видит разметку, браузер — где строка стоит для пальца. Главное
     здесь: при пустом поиске строка ручного ввода обязана быть ВЫШЕ
     клавиатуры iOS (~300 px снизу на 844), иначе её не найдут; тап по ней
     открывает форму с уже набранным именем; в дневнике кнопок нет. */
  {
    const лист=await js(`(async function(){
      /* navPop('code') зовёт настоящий history.back(); два листа подряд в
         цикле — и страница уезжает со стенда (контекст уничтожен, прогон 4
         от 22.09). Тот же приём, что у стенда черновика v629: на время стенда
         history.back — пустышка. */
      const _hb=history.back; history.back=function(){};
      try{
      try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){}
      goView('food');
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,300));
      const кнопокВДневнике=document.querySelectorAll('#diaryDet .g2 button, #bAddF, #bSaveCmb').length;
      openFind(); await new Promise(r=>setTimeout(r,500));
      const q=document.getElementById('qSearch2');
      const цель=el=>{ if(!el) return null; const r=el.getBoundingClientRect(); return {top:Math.round(r.top),h:Math.round(r.height),w:Math.round(r.width)}; };
      /* без запроса — тихая строка внизу подсказок */
      q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,300));
      const тихая=document.querySelector('#qList2 .qman');
      const тихаяВид=тихая?{...цель(тихая),loud:тихая.classList.contains('loud'),последняя:тихая===document.querySelector('#qList2').lastElementChild}:null;
      /* бессмысленный запрос — строка первая, заметная, над клавиатурой */
      q.value='ъъъъъъ'; q.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,400));
      const громкая=document.querySelector('#qList2 .qman');
      const громкаяВид=громкая?{...цель(громкая),loud:громкая.classList.contains('loud'),
        первая:громкая===document.querySelector('#qList2').firstElementChild,текст:(громкая.textContent||'').trim()}:null;
      /* тап — открывается форма продукта с набранным именем */
      if(громкая) громкая.click();
      await new Promise(r=>setTimeout(r,500));
      const форма=document.getElementById('sh-f'), формаОткрыта=!!(форма&&форма.classList.contains('on'));
      const имя=(document.getElementById('fd_n')||{}).value||'';
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,400));
      return JSON.stringify({кнопокВДневнике,тихаяВид,громкаяВид,формаОткрыта,имя,экран:innerHeight});
      } finally{ history.back=_hb; } })()`);
    /* стенд обязан вернуть строку при любом исходе (CRAFT, v633): не строка — это сбой стенда, а не продукта */
    const o=(typeof лист==='string')?JSON.parse(лист):{сбой:(лист&&лист.__err)||('ответ '+String(лист))};
    chk(!o.сбой,'стенд листа записи не вернул строку: '+o.сбой);
    if(!o.сбой){
    chk(o.кнопокВДневнике===0,'в дневнике снова кнопки ('+o.кнопокВДневнике+') — решение автора их снять');
    chk(!!o.тихаяВид&&!o.тихаяВид.loud&&o.тихаяВид.последняя,'без запроса тихая строка ручного ввода не последняя или кричит: '+JSON.stringify(o.тихаяВид));
    chk(!!o.тихаяВид&&o.тихаяВид.h>=44,'строка ручного ввода '+(o.тихаяВид||{}).h+' px — в неё не попасть');
    chk(!!o.громкаяВид&&o.громкаяВид.loud&&o.громкаяВид.первая,'поиск ничего не нашёл, а заметная строка ручного ввода не первая: '+JSON.stringify(o.громкаяВид));
    chk(!!o.громкаяВид&&o.громкаяВид.top<(o.экран||844)-300,'строка ручного ввода на '+(o.громкаяВид||{}).top+' px — под клавиатурой iOS её не найдут');
    chk(!!o.громкаяВид&&/ъъъъъъ/.test(o.громкаяВид.текст||''),'заметная строка не называет набранное: «'+(o.громкаяВид||{}).текст+'»');
    chk(o.формаОткрыта===true,'тап по строке ручного ввода не открыл форму продукта');
    chk(o.имя==='ъъъъъъ','форма открылась без набранного имени («'+o.имя+'») — человек напечатает дважды');
    }
  }

  /* ── ФИЗИКА ЛИСТА v637: ЛИСТ ЕДЕТ, А НЕ ПОЯВЛЯЕТСЯ, И УХОДИТ, А НЕ ПРОПАДАЕТ ──
     Смоук читает числа в CSS, браузер смотрит, что они доехали до экрана:
     лист на 120-й мс ещё в пути (translateY > 0), к 600-й стоит; при
     закрытии .closing держится и лист виден на 100-й мс, к 400-й ни .on,
     ни .closing нет. Заодно — что кривая появления и правда --ezd. */
  {
    const физика=await js(`(async function(){
      const _hb=history.back; history.back=function(){};
      try{
      try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){}
      goView('food');
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,400));
      const ty=el=>{ const m=getComputedStyle(el).transform; if(!m||m==='none') return 0; const p=m.replace(/[a-z()]/g,'').split(',').map(parseFloat); return p.length===6?p[5]:(p.length===16?p[13]:0); };
      /* Меряем обычную шторку — настройки. Полноэкранный поиск еды (#sh-find)
         сознательно без движения (animation:none): он открывается сразу с
         клавиатурой, и подъезд под ней дёргал поле (полевой скрин 04.08). */
      openSet();
      const sh=document.getElementById('sh-s'), inEl=sh&&sh.querySelector('.in');
      if(!inEl) return JSON.stringify({сбой:'лист настроек не открылся'});
      const t0=performance.now(); const пробы=[];
      await new Promise(res=>{ (function f(){ const t=performance.now()-t0; пробы.push([Math.round(t),Math.round(ty(inEl))]); if(t<650) requestAnimationFrame(f); else res(); })(); });
      const cs=getComputedStyle(inEl);
      const кривая=cs.animationTimingFunction, длит=cs.animationDuration;
      const вПути=пробы.filter(p=>p[0]>=60&&p[0]<=160).some(p=>p[1]>0);
      const доехал=пробы.filter(p=>p[0]>=520).every(p=>p[1]===0);
      /* закрытие */
      const t1=performance.now(); navPop('code');
      await new Promise(r=>setTimeout(r,100));
      const на100={closing:sh.classList.contains('closing'),on:sh.classList.contains('on'),виден:getComputedStyle(sh).display!=='none',ty:Math.round(ty(inEl))};
      await new Promise(r=>setTimeout(r,320));
      const на420={closing:sh.classList.contains('closing'),on:sh.classList.contains('on'),виден:getComputedStyle(sh).display!=='none'};
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,300));
      return JSON.stringify({кривая,длит,вПути,доехал,на100,на420,проб:пробы.length,h:inEl.getBoundingClientRect().height});
      } finally{ history.back=_hb; } })()`);
    const o=(typeof физика==='string')?JSON.parse(физика):{сбой:(физика&&физика.__err)||('ответ '+String(физика))};
    chk(!o.сбой,'стенд физики листа не вернул строку: '+o.сбой);
    if(!o.сбой){
    chk(o.длит==='0.42s','лист появляется за '+o.длит+', а не за 0.42s — CSS не доехал до экрана');
    chk(/cubic-bezier\(0\.32, 0\.72, 0, 1\)/.test(o.кривая||''),'кривая появления листа в браузере: '+o.кривая+' — не --ezd');
    chk(o.вПути===true,'на 60–160 мс лист уже стоит — появление не едет, а мигает ('+o.проб+' проб)');
    chk(o.доехал===true,'к 520 мс лист ещё не доехал — «зависло»');
    chk(o.на100.closing&&!o.на100.on&&o.на100.виден,'через 100 мс после закрытия лист не доигрывает уход: '+JSON.stringify(o.на100));
    chk(!o.на420.closing&&!o.на420.on&&!o.на420.виден,'через 420 мс после закрытия лист всё ещё на экране: '+JSON.stringify(o.на420));
    }
  }

  /* ── ЕДА БЕЗ ФОТО v639: ОЦЕНКА ПО НАЗВАНИЮ И ВВОД ТЕКСТОМ ──
     Смоук видит разметку, браузер — что путь проходится пальцем. ИИ здесь
     подменён: мы проверяем ПРОВОДКУ (кнопка → поля → заметка → флаг), а не
     модель. Второй стенд: распознавания речи нет — микрофон ведёт в ввод
     текста, напечатанное доходит до разбора (подменённый разбор отвечает
     ошибкой «стенд», и она должна встать на экран). */
  {
    const еда=await js(`(async function(){
      const _hb=history.back; history.back=function(){};
      const _ask=aiAskJson, _ready=aiReady;
      try{
      try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){}
      goView('food');
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,300));
      aiReady=()=>true;
      /* 1. оценка по названию: сходящиеся числа встают, флаг ставится */
      aiAskJson=async()=>({k:180,p:7,f:9,c:19,note:'масло 8 г'});
      openF(true,{n:'плов узбекский'});
      await new Promise(r=>setTimeout(r,300));
      const b=document.getElementById('bFEst'); const r1=b?b.getBoundingClientRect():null;
      const кнопка=r1?{h:Math.round(r1.height),w:Math.round(r1.width)}:null;
      b.click(); await new Promise(r=>setTimeout(r,400));
      const после={k:document.getElementById('fd_k').value,p:document.getElementById('fd_p').value,f:document.getElementById('fd_f').value,c:document.getElementById('fd_c').value,
        флаг:fdEst, заметка:(document.getElementById('fdWarn')||{}).textContent||'', скрыта:!!(document.getElementById('fdWarn')||{}).hidden};
      /* 2. несходящиеся числа — в поля не встают */
      aiAskJson=async()=>({k:900,p:1,f:1,c:1});
      openF(true,{n:'тест'}); await new Promise(r=>setTimeout(r,200));
      document.getElementById('bFEst').click(); await new Promise(r=>setTimeout(r,400));
      const брак={k:document.getElementById('fd_k').value, флаг:fdEst, заметка:(document.getElementById('fdWarn')||{}).textContent||''};
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,300));
      /* 3. без распознавания речи: микрофон → ввод текста → разбор */
      const _SR=window.SpeechRecognition, _wSR=window.webkitSpeechRecognition;
      window.SpeechRecognition=undefined; window.webkitSpeechRecognition=undefined;
      aiAskJson=async()=>{ throw new Error('стенд-разбор'); };
      let текст=null;
      try{
        const p=voiceAny('meal'); await new Promise(r=>setTimeout(r,500));
        const prompt=document.getElementById('sh-prompt'), окноВвода=!!(prompt&&prompt.classList.contains('on'));
        const заголовок=(document.getElementById('prT')||{}).textContent||'';
        const inp=document.getElementById('prIn'); if(inp) inp.value='плов 350 г, лагман 400 г';
        const ok=document.getElementById('prOk'); if(ok) ok.click();
        await new Promise(r=>setTimeout(r,700));
        const ai=document.getElementById('sh-ai');
        текст={окноВвода,заголовок,разборОткрыт:!!(ai&&ai.classList.contains('on')),тело:(document.getElementById('aiBody')||{}).textContent||''};
      } finally { window.SpeechRecognition=_SR; window.webkitSpeechRecognition=_wSR; }
      try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,300));
      return JSON.stringify({кнопка,после,брак,текст});
      } finally{ history.back=_hb; aiAskJson=_ask; aiReady=_ready; } })()`);
    const o=(typeof еда==='string')?JSON.parse(еда):{сбой:(еда&&еда.__err)||('ответ '+String(еда))};
    chk(!o.сбой,'стенд «еда без фото» не вернул строку: '+o.сбой);
    if(!o.сбой){
    chk(!!o.кнопка&&o.кнопка.h>=44,'кнопка «Оценить по названию» '+JSON.stringify(o.кнопка)+' — ниже 44 px');
    chk(o.после.k==='180'&&o.после.p==='7'&&o.после.f==='9'&&o.после.c==='19','оценка не встала в поля: '+JSON.stringify(o.после));
    chk(o.после.флаг===1,'после оценки флаг est не поставлен');
    chk(!o.после.скрыта&&/Оценка ИИ/.test(o.после.заметка)&&/масло/.test(o.после.заметка),'заметка об оценке не видна или без допущения модели: «'+o.после.заметка+'»');
    chk(o.брак.k===''&&o.брак.флаг===0&&/не сходятся/.test(o.брак.заметка),'несходящиеся числа ИИ прошли в поля: '+JSON.stringify(o.брак));
    chk(!!o.текст&&o.текст.окноВвода===true&&/Напиши/.test(o.текст.заголовок),'без распознавания речи микрофон не открыл ввод текста: '+JSON.stringify(o.текст));
    /* ошибка подменённого разбора на экране = напечатанное дошло до разбора (строку «Понял…» она заменяет) */
    chk(!!o.текст&&o.текст.разборОткрыт===true&&/стенд-разбор/.test(o.текст.тело),'напечатанное не дошло до разбора: '+JSON.stringify(o.текст));
    }
  }

  /* ── ОДНО ЧИСЛО — ОДИН РАЗ (Кодекс, закон 2; после v639) ──
     До этого закон держали точечные правила (кольца v630, шапка v633), а
     сквозной проверки не было. Замер на живых данных 23.09 (live.js --dup):
     ноль дублей на всех пяти вкладках. Значит порог — ноль, храповик: любая
     пара «число + единица» (ккал, г, кг, мл, шаги, %, мин, см), стоящая на
     одной вкладке в двух видимых листовых узлах, — красный. */
  {
    const дубли=await js(`(async function(){ try{ const out={};
      for(const v of ['food','train','body','health','coach']){
        try{ goView(v); }catch(e){} await new Promise(r=>setTimeout(r,400));
        const root=document.getElementById('v-'+v); const seen={};
        const els=root?root.querySelectorAll('*'):[];
        for(const el of els){ if(el.children.length) continue;
          const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
          const t=(el.textContent||'').replace(/\\s+/g,' ').trim(); if(!t) continue;
          const re=/(\\d+(?:[.,]\\d+)?)\\s?(ккал|кг|мл|г|шаг(?:ов|а)?|%|мин|см|л)(?![а-яa-z])/g; let m;
          const path=(function(){ const p=[]; let q=el; for(let i=0;i<4&&q&&q!==root;i++){ p.unshift(q.tagName.toLowerCase()+(q.id?'#'+q.id:'')+((typeof q.className==='string'&&q.className)?'.'+q.className.split(' ')[0]:'')); q=q.parentElement; } return p.join('>'); })();
          while((m=re.exec(t))){ const key=m[1].replace(',','.')+' '+m[2].replace(/^шаг.*/,'шаг'); (seen[key]=seen[key]||[]).push(path+' «'+t.slice(0,32)+'»'); } }
        out[v]=Object.entries(seen).filter(([k,a])=>a.length>1&&parseFloat(k)>3).map(([k,a])=>k+' ×'+a.length+' ['+[...new Set(a)].slice(0,3).join(' | ')+']');
      }
      try{ goView('food'); }catch(e){}
      return JSON.stringify(out); }catch(e){ return JSON.stringify({сбой:e.message}); } })()`);
    const o=(typeof дубли==='string')?JSON.parse(дубли):{сбой:(дубли&&дубли.__err)||('ответ '+String(дубли))};
    chk(!o.сбой,'сканер «одно число — один раз» сорвался: '+o.сбой);
    if(!o.сбой) for(const [v,list] of Object.entries(o)) chk(list.length===0,'вкладка '+v+': одно число дважды на экране (закон 2): '+list.join('; '));
  }

  /* ── ТЕКСТОВЫЙ ШУМ (Кодекс, закон 1; после v640) ──
     Премиальное приложение не объясняет себя текстом. Замер на живых данных
     23.09 (live.js --noise): ноль абзацев длиннее 90 знаков на всех пяти
     вкладках. Порог — ноль, храповик. Абзац — видимый узел, у которого внутри
     только строчные дети (жирное слово не рвёт его на куски); листы не
     считаются — там объяснение по тапу допустимо. */
  {
    const шум=await js(`(async function(){ try{ const out={};
      const INL=new Set(['B','I','SPAN','SMALL','A','SVG','USE','S','U','EM','STRONG','BR','SUB','SUP']);
      const блок=el=>[...el.children].every(c=>INL.has(c.tagName)&&блок(c));
      for(const v of ['food','train','body','health','coach']){
        try{ goView(v); }catch(e){} await new Promise(r=>setTimeout(r,400));
        const root=document.getElementById('v-'+v); const list=[];
        for(const el of (root?root.querySelectorAll('*'):[])){ if(!блок(el)) continue;
          if(INL.has(el.tagName)&&el.parentElement&&el.parentElement!==root&&блок(el.parentElement)) continue;
          const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
          const t=(el.textContent||'').replace(/\\s+/g,' ').trim(); if(t.length<=90) continue;
          const p=[]; let q=el; for(let i=0;i<3&&q&&q!==root;i++){ p.unshift(q.tagName.toLowerCase()+(q.id?'#'+q.id:'')+((typeof q.className==='string'&&q.className)?'.'+q.className.split(' ')[0]:'')); q=q.parentElement; }
          list.push(t.length+' зн · '+p.join('>')+' · «'+t.slice(0,60)+'…»'); }
        out[v]=list;
      }
      try{ goView('food'); }catch(e){}
      return JSON.stringify(out); }catch(e){ return JSON.stringify({сбой:e.message}); } })()`);
    const o=(typeof шум==='string')?JSON.parse(шум):{сбой:(шум&&шум.__err)||('ответ '+String(шум))};
    chk(!o.сбой,'сканер текстового шума сорвался: '+o.сбой);
    if(!o.сбой) for(const [v,list] of Object.entries(o)) chk(list.length===0,'вкладка '+v+': абзац-пояснение на экране (закон 1): '+list.join('; '));
  }

  /* Замер 23.09 (медиана трёх): обработчик 0.6 · первый кадр 0.6 · худший разрыв
     кадров 23.2 мс — запись в IndexedDB, перечитывание дневника и перерисовка
     «Еды» и «Коуча» после «+». Порог — храповик с запасом на шум; закон
     говорит 15, и клетка в CRAFT остаётся открытой. */
  const LAT_FOOD_WORST=50;
  /* ── ОТКЛИК НА ЗАПИСЬ ЕДЫ (Кодекс, закон 4; после v641) ──
     Подход меряется с v638, еда — нет. Тот же жест, что у человека: лист
     «Записать еду» → «+» у своего продукта (прошлая порция мгновенно).
     Три числа: обработчик до отпускания пальца, первый кадр, худший разрыв
     кадров в 600 мс после тапа. Три пробы, медиана; записи фикстуры
     удаляются между пробами. Порог — храповик по замеру. */
  {
    const спроси=async expr=>{ let r=null; for(let i=0;i<2&&typeof r!=='string';i++){ r=await js(expr); if(typeof r!=='string') await sleep(400); } return typeof r==='string'?JSON.parse(r):{сбой:'не разобрать'+(r&&r.__err?' ('+r.__err+')':'')}; };
    await js(`(function(){ const _hb=history.back; history.back=function(){}; try{ goView('food'); try{ while(NAV.stack.length) navPop('code'); }catch(e){} openFind(); window.__latFoodT0=Date.now(); } finally { setTimeout(()=>{ history.back=_hb; },600); } return 1; })()`);
    await sleep(700);
    const пробы=[];
    for(let k=0;k<3;k++){
      const о=await спроси(`(async function(){ try{
        const b=document.querySelector('#qList2 [data-qa]'); if(!b) return JSON.stringify({сбой:'нет строки «+» у своего продукта'});
        const t0=performance.now(); b.click(); const синхр=performance.now()-t0;
        let первый=null, худший=0, прошлый=t0;
        await new Promise(res=>{ (function f(){ const now=performance.now(); if(первый==null) первый=now-t0; if(now-прошлый>худший) худший=now-прошлый; прошлый=now; if(now-t0<600) requestAnimationFrame(f); else res(); })(); });
        return JSON.stringify({синхр:Math.round(синхр*10)/10,первый:Math.round(первый*10)/10,худший:Math.round(худший*10)/10});
      }catch(e){ return JSON.stringify({сбой:e.message}) } })()`);
      пробы.push(о); await sleep(400);
      await js(`(async()=>{ try{ const mine=LOG.filter(x=>x.d===td()&&(+x.ua||0)>=(window.__latFoodT0||0)); for(const l of mine){ if(l.id!=null) await del('log',l.id); } LOG=await all('log'); rFood(); rQuick(); return 'ок'; }catch(e){ return 'ERR '+e.message } })()`); await sleep(400);
    }
    await js(`(function(){ const _hb=history.back; history.back=function(){}; try{ while(NAV.stack.length) navPop('code'); }catch(e){} setTimeout(()=>{ history.back=_hb; },600); return 1; })()`); await sleep(500);
    const сбой=пробы.find(p=>p.сбой);
    chk(!сбой,'замер отклика на запись еды сорвался: '+(сбой||{}).сбой);
    if(!сбой){
      const мед=k=>пробы.map(p=>p[k]).sort((a,b)=>a-b)[1];
      const синхр=мед('синхр'), первый=мед('первый'), худший=мед('худший');
      console.log('   отклик на запись еды, мс (медиана трёх): обработчик '+синхр+' · первый кадр '+первый+' · худший разрыв кадров '+худший);
      chk(синхр<=15,'обработчик записи еды держит главный поток '+синхр+' мс до отпускания пальца — закон 4 говорит 15');
      chk(худший<=LAT_FOOD_WORST,'после записи еды экран замирает на '+худший+' мс (предел '+LAT_FOOD_WORST+')');
      const остаток=await спроси(`JSON.stringify({лишних:LOG.filter(x=>x.d===td()&&(+x.ua||0)>=(window.__latFoodT0||0)).length})`);
      chk(остаток.лишних===0,'фикстура отклика еды не убрана за собой: записей осталось '+остаток.лишних);
    }
  }

  /* ── ПАНЕЛЬ ДНЯ ПОД ШАПКОЙ v643 ──
     Смоук видит класс и CSS, браузер — где панель стоит для глаза: верх
     панели совпадает с низом шапки (±4 px), неделя видна в верхней трети
     экрана, второй тап по дате закрывает, свайп-обработчик её не двигает. */
  {
    const панель=await js(`(async function(){
      const _hb=history.back; history.back=function(){};
      try{
      try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){}
      goView('food'); try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,300));
      const дата=document.getElementById('hSb'); if(!дата) return JSON.stringify({сбой:'нет кнопки даты'});
      const hd=document.querySelector('header'); const шапкаНиз=hd?Math.round(hd.getBoundingClientRect().bottom):null;
      дата.click(); await new Promise(r=>setTimeout(r,500));
      const sh=document.getElementById('sh-day'), inn=sh&&sh.querySelector(':scope>.in');
      if(!inn) return JSON.stringify({сбой:'панели нет'});
      const r=inn.getBoundingClientRect(); const wk=document.getElementById('wkRings'); const wr=wk?wk.getBoundingClientRect():null;
      const открыта=sh.classList.contains('on'), шеврон=document.documentElement.classList.contains('dayOpen');
      const ручка=getComputedStyle(inn,'::before').display, заголовок=(inn.querySelector(':scope>h3')?getComputedStyle(inn.querySelector(':scope>h3')).display:'нет');
      /* Кнопку берём заново: hSubSync пересобирает её при перерисовке шапки,
         и первая ссылка к этому моменту может быть отвязана от документа —
         клик по отвязанной кнопке до обработчика на строке не доходит. */
      const дата2=document.getElementById('hSb'); const кнопкаЖива=дата.isConnected;
      /* Второй тап — ПОЗЖЕ 600 мс: замок «один тап — одно действие» (v629,
         TAP_LOCK) глушит повтор по той же кнопке раньше; стенд ждал 500 и три
         прогона подряд читал «не закрылась» там, где панель вела себя верно. */
      await new Promise(r=>setTimeout(r,250));
      (дата2||дата).click(); await new Promise(r=>setTimeout(r,400));
      const закрыта=!sh.classList.contains('on');
      /* Диагностика на случай «не закрылась»: что видел обработчик и что в стеке. */
      const почему=закрыта?'':('curV='+(typeof curV!=='undefined'?curV:'?')+' view='+((document.querySelector('.view.on')||{}).id||'-')+' стек='+((typeof NAV!=='undefined'&&NAV.stack)?NAV.stack.join(','):'?')+' asking='+((typeof NAV!=='undefined'&&NAV.asking)||'-')+' dirty='+(sh.getAttribute('data-dirty')||'-')+' closing='+sh.classList.contains('closing'));
      let закрытаКодом=null; if(!закрыта){ try{ sheet('sh-day',false); }catch(e){} await new Promise(r=>setTimeout(r,300)); закрытаКодом=!sh.classList.contains('on'); }
      return JSON.stringify({шапкаНиз,верх:Math.round(r.top),низ:Math.round(r.bottom),неделяВерх:wr?Math.round(wr.top):null,открыта,шеврон,ручка,заголовок,закрыта,кнопкаЖива,почему,закрытаКодом,экран:innerHeight});
      } finally{ history.back=_hb; } })()`);
    const o=(typeof панель==='string')?JSON.parse(панель):{сбой:(панель&&панель.__err)||('ответ '+String(панель))};
    chk(!o.сбой,'стенд панели дня не вернул строку: '+o.сбой);
    if(!o.сбой){
    chk(o.открыта===true,'тап по дате не открыл панель дня');
    chk(o.шапкаНиз!=null&&Math.abs(o.верх-o.шапкаНиз)<=4,'панель дня стоит на '+o.верх+', низ шапки на '+o.шапкаНиз+' — не под шапкой');
    chk(o.неделяВерх!=null&&o.неделяВерх<(o.экран||844)/3,'неделя на '+o.неделяВерх+' px — не в верхней трети экрана');
    chk(o.ручка==='none'&&o.заголовок==='none','у панели дня ручка или заголовок-дубль: ручка '+o.ручка+', заголовок '+o.заголовок);
    chk(o.шеврон===true,'шеврон в шапке не знает, что панель открыта');
    chk(o.закрыта===true,'второй тап по дате не закрыл панель (кнопка из шапки '+(o.кнопкаЖива?'та же':'пересобрана')+'; '+(o.почему||'')+'; кодом закрылась: '+o.закрытаКодом+')');
    }
  }

  /* ── ПОДБОР ПРАВИТСЯ НА МЕСТЕ v656 ──
     Смоук считает граммы и замены, браузер смотрит, что это можно сделать
     пальцем: поле граммов текстовое с десятичной клавиатурой (запятая iOS),
     ноль в строке сразу меняет итог тарелки, «⇄» меняет продукт в той же
     строке, а на 320 px в строке остаётся место под название и все цели
     нажатия не меньше 44. */
  {
    const подбор=await js(`(async function(){
      const _hb=history.back; history.back=function(){};
      try{
      try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){}
      goView('food'); try{ while(NAV.stack.length) navPop('code'); }catch(e){}
      await new Promise(r=>setTimeout(r,300));
      if(!tg()) return JSON.stringify({сбой:'нет цели — подбору не на что считать'});
      mlKind='ln'; mlView='solve'; document.getElementById('ml_src').value='all';
      sheet('sh-meal',true); mlRender(); await new Promise(r=>setTimeout(r,500));
      const поля=[...document.querySelectorAll('#mlOut [data-mlg]')];
      if(поля.length<2) return JSON.stringify({сбой:'в подборе меньше двух строк: '+(document.getElementById('mlOut').innerText||'').replace(/\\s+/g,' ').slice(0,160)});
      const сум=()=>((document.getElementById('mlSum')||{}).textContent||'').replace(/\\s+/g,' ').trim();
      const сум0=сум(), inp=поля[0]; inp.focus(); inp.value='0'; inp.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,120));
      const сум1=сум(), тип=inp.getAttribute('type'), клав=inp.getAttribute('inputmode');
      const имя=i=>((document.querySelector('#mlOut [data-mlrow="'+i+'"] .t')||{}).textContent||'');
      const имя0=имя(1); (document.querySelector('#mlOut [data-mlsw="1"]')||{click(){}}).click(); await new Promise(r=>setTimeout(r,200));
      const имя1=имя(1), поле0после=((document.querySelector('#mlOut [data-mlg="0"]')||{}).value||'');
      return JSON.stringify({сум0,сум1,тип,клав,имя0,имя1,поле0после});
      } finally{ history.back=_hb; } })()`);
    const o=(typeof подбор==='string')?JSON.parse(подбор):{сбой:(подбор&&подбор.__err)||('ответ '+String(подбор))};
    chk(!o.сбой,'стенд подбора не вернул строку: '+o.сбой);
    let г={};
    if(!o.сбой){
      await send('Emulation.setDeviceMetricsOverride',{width:320,height:700,deviceScaleFactor:2,mobile:true}); await sleep(300);
      const гео=await js(`(function(){ const W=innerWidth, rows=[...document.querySelectorAll('#mlOut .item')];
        const м=rows.map(r=>{ const g=r.querySelector('.t'), s=r.querySelector('.s'), b=[...r.querySelectorAll('button,input')];
          return {имя:Math.round(g.getBoundingClientRect().width), право:Math.round(Math.max(...b.map(x=>x.getBoundingClientRect().right))),
            мин:Math.round(Math.min(...b.map(x=>Math.min(x.getBoundingClientRect().height,x.getBoundingClientRect().width)))), подписьСтрок:s?Math.round(s.getBoundingClientRect().height/parseFloat(getComputedStyle(s).lineHeight)):0}; });
        return JSON.stringify({W,м}); })()`);
      г=(typeof гео==='string')?JSON.parse(гео):{сбой:'гео'};
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true}); await sleep(200);
    }
    /* И сама запись: кнопка пишет строки с меткой приёма и закрывает лист (v656: имя кнопки перекрывало чтение базы — запись шла, а лист висел) */
    let з={};
    if(!o.сбой){ const зап=await js(`(async function(){ try{ const n0=LOG.length, err=[]; const h=e=>err.push(String(e&&(e.reason||e.message)||e)); addEventListener('unhandledrejection',h);
        const b=document.getElementById('mlAll'); if(!b) return JSON.stringify({сбой:'нет кнопки записи'});
        const ждём=ML_ROWS.filter(r=>+r.g>0).length; b.click(); await new Promise(r=>setTimeout(r,900)); removeEventListener('unhandledrejection',h);
        const нов=LOG.slice(n0); return JSON.stringify({ждём,записано:нов.length,сМеткой:нов.filter(l=>l.sl==='ln').length,открыт:document.getElementById('sh-meal').classList.contains('on'),err});
      }catch(e){ return JSON.stringify({сбой:e.message}); } })()`);
      з=(typeof зап==='string')?JSON.parse(зап):{сбой:'ответ '+String(зап)}; }
    await js(`(function(){ try{ sheet('sh-meal',false); }catch(e){} return 1 })()`); await sleep(300);
    if(!o.сбой){
      chk(o.тип==='text'&&o.клав==='decimal','поле граммов type='+o.тип+' inputmode='+o.клав+' — запятая с клавиатуры iOS обнулит ввод');
      chk(o.сум1&&o.сум1!==o.сум0,'ноль в строке не поменял итог тарелки: «'+o.сум0+'» → «'+o.сум1+'»');
      chk(o.имя1&&o.имя1!==o.имя0,'«⇄» не поменял продукт в строке: «'+o.имя0+'» → «'+o.имя1+'»');
      chk(o.поле0после==='0','замена во второй строке стёрла правку в первой: там «'+o.поле0после+'» вместо 0');
      chk(!г.сбой&&(г.м||[]).every(x=>x.право<=г.W-4),'на 320 px строка подбора вылезает за экран: '+JSON.stringify(г));
      chk(!г.сбой&&(г.м||[]).every(x=>x.имя>=110),'на 320 px названию продукта остаётся меньше 110 px: '+JSON.stringify(г));
      chk(!г.сбой&&(г.м||[]).every(x=>x.подписьСтрок<=2),'подпись строки подбора на 320 px выше двух строк: '+JSON.stringify(г));
      chk(!з.сбой&&з.записано===з.ждём&&з.ждём>0,'«Записать» записал '+з.записано+' из '+з.ждём+' строк: '+JSON.stringify(з));
      chk(!з.сбой&&з.сМеткой===з.записано,'запись из подбора без метки приёма: '+JSON.stringify(з));
      chk(!з.сбой&&з.открыт===false&&!(з.err||[]).length,'после «Записать» лист не закрылся или упал: '+JSON.stringify(з));
      chk(!г.сбой&&(г.м||[]).every(x=>x.мин>=44),'в строке подбора цель нажатия меньше 44: '+JSON.stringify(г));
    }
  }

  if(fail.length){
    fail.forEach(f=>console.error('  ✗ '+f));
    console.error(' ✗ БРАУЗЕР: нарушений '+fail.length);
    return done(1);
  }
  console.log(' ✓ Настоящий браузер ('+ver+'): старт без исключений, первый экран на месте, простой режим короче'
    +(TLS?', приложение живёт и пишет без сети':'')+', бэкап восстанавливается целиком');
  done(0);
})().catch(e=>{ console.error(' ✗ БРАУЗЕР УПАЛ: '+e.message); process.exit(1); });
