/* ══════════════ ПРОГОН ПО ЖИВОМУ АККАУНТУ ══════════════
   Задание владельца 21.09: «делай прогон через мой аккаунт, чтоб всё можно
   было отслеживать на реальных изменениях».

   Что это. Обычный `tests/browser.js` работает на выдуманных данных в пустой
   базе браузера. Здесь — то же приложение из `dist/`, но подключённое к
   НАСТОЯЩЕМУ Supabase: вход почтой и паролем владельца, расшифровка его
   хранилища, рендер его реальных дней. Видно ровно то, что он видит
   на телефоне.

   ── ПАРОЛЬ СЮДА НЕ ПИШЕТСЯ И АГЕНТУ НЕ ГОВОРИТСЯ ──
   В этом приложении пароль — не просто вход. Из него выводится ключ, которым
   расшифровывается хранилище (`creds()` → PBKDF2 → обёртка DEK). Значит
   пароль, сказанный в чат, — это не «доступ к аккаунту», а ключ ко всем
   данным о здоровье, и он останется в расшифровке разговора, в логах сессии
   и в claude-mem. Поэтому:
     · пароль берётся ТОЛЬКО из переменных окружения;
     · их можно положить в `.env.local` — он под .gitignore (шаблон `.env.*`);
     · скрипт нигде не печатает и никуда не пишет ни почту, ни пароль:
       в отчёте только «задано / не задано»;
     · в командной строке они не передаются — иначе легли бы в историю
       оболочки и были бы видны в `ps`.

   ── ПО УМОЛЧАНИЮ — ТОЛЬКО ЧТЕНИЕ, И ЭТО МЕХАНИЗМ, А НЕ ОБЕЩАНИЕ ──
   Запрет на запись стоит в ПРОКСИ, снаружи страницы: любой POST/PATCH/
   DELETE/PUT на `/sb/rest/v1/*` отклоняется до того, как уйдёт в сеть.
   Код приложения его обойти не может. Разрешены только вход (`/auth/v1/*`)
   и чтение. Это важно: стенды вроде `tests/browser.js` пишут фикстуры и
   УДАЛЯЮТ записи за неделю — направить их на живой аккаунт значит потерять
   настоящий дневник. Такой прогон здесь невозможен физически.

   Запись включается только двумя вещами сразу: флагом `--write` И
   переменной `BV_LIVE_WRITE=1`. Одного флага мало намеренно.
   Регистрация нового аккаунта запрещена ВСЕГДА, даже с `--write`: опечатка
   в почте не должна заводить лишнего пользователя в живой базе.

   Запуск:
     node tests/build.js && node tests/live.js
     node tests/live.js --shots            # + скриншоты реальных экранов
     node tests/live.js --tab=food,train   # какие вкладки снять
     node tests/live.js --foodshots        # v657: 33 снимка всех окон «Еды» в глубину (лист записи, «Что съесть»,
                                           # рецепты, покупки, кладовая, расход, правка записи, вода, шаги, вчера)
     node tests/live.js --selftest         # проверить сам замок, доступы не нужны
     node tests/live.js --wrap             # что живые данные рвут, а выдуманные нет
     node tests/live.js --cost             # цена «перечитать всё» после одной записи (мс на живых объёмах)
   Куда кладутся скриншоты: `BV_LIVE_OUT` или временный каталог. В репозиторий
   они не кладутся никогда — это данные о здоровье живого человека.  */

const fs=require('fs'), path=require('path'), http=require('http'), https=require('https');
const os=require('os'), {spawn}=require('child_process');
const ROOT=path.join(__dirname,'..'), DIST=path.join(ROOT,'dist');
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.json':'application/json',
  '.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ARG=process.argv.slice(2);
const has=f=>ARG.some(a=>a===f||a.startsWith(f+'='));
const val=(f,d)=>{ const a=ARG.find(x=>x.startsWith(f+'=')); return a?a.slice(f.length+1):d; };

/* ── 1. Доступы: окружение, потом .env.local. Значения НЕ печатаются ── */
function creds(){
  let e=process.env.BV_LIVE_EMAIL||'', p=process.env.BV_LIVE_PASS||'';
  if(!e||!p){
    const f=path.join(ROOT,'.env.local');
    if(fs.existsSync(f)){
      for(const line of fs.readFileSync(f,'utf8').split(/\r?\n/)){
        const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line); if(!m) continue;
        let v=m[2].trim();
        if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
        if(m[1]==='BV_LIVE_EMAIL'&&!e) e=v;
        if(m[1]==='BV_LIVE_PASS'&&!p) p=v;
      }
    }
  }
  return {email:e,pass:p};
}

/* ── 2. Адрес Supabase берём из vercel.json, а не вторым экземпляром ──
   Одна величина в двух местах — всегда вопрос времени (CRAFT). */
function sbOrigin(){
  const v=JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8'));
  const r=(v.rewrites||[]).find(x=>x.source&&x.source.startsWith('/sb/'));
  if(!r) throw new Error('в vercel.json нет переписи /sb/* — не знаю, куда проксировать');
  return new URL(r.destination.replace('/:path*','')).origin;
}

/* ── САМОПРОВЕРКА ЗАМКА ──
   «Запись запрещена» — обещание ровно до тех пор, пока его не проверили.
   `--selftest` поднимает ТОТ ЖЕ сервер (не копию) без браузера и без доступов
   и стучится в него восемью пробами: чтение и вход обязаны пройти, запись,
   правка, удаление и регистрация — упереться в 423, а с `--write` запись
   обязана открыться. Доступы для этого не нужны. */
async function selftest(mkServer){
  const {srv}=mkServer(false);
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port=srv.address().port;
  /* agent:false — своё соединение на каждую пробу. С общим агентом Node
     переиспользует сокет, который сервер уже закрыл, отдав отказ, и
     следующая проба падает с обрывом: замок выглядел бы дырявым, будучи
     целым. Ошибка стенда, читаемая как находка, — худший вид ошибки. */
  const бей=(метод,путь)=>new Promise(ok=>{
    const q=http.request({host:'127.0.0.1',port,method:метод,path:путь,agent:false,
      headers:{'content-type':'application/json','connection':'close'}},r=>{ r.resume(); ok(r.statusCode); });
    q.on('error',()=>ok(0));
    q.end(метод==='GET'?undefined:'{}');
  });
  /* «Прошло» — это ответ от самого Supabase (2xx/4xx). 502 и 0 значат, что
     сети нет: такая проба ничего не доказывает, и говорить «проходит» на ней
     нельзя — это ровно тот случай, когда стенд смотрит в пустоту и всё
     «зелено». Отказ замка (423) локален и проверяется всегда. */
  const дошло=c=>(c>=200&&c<500&&c!==423);
  const пробы=[
    ['чтение проходит',       await бей('GET','/sb/rest/v1/vaults?select=version'), дошло],
    ['запись отбита',         await бей('POST','/sb/rest/v1/rpc/push_vault'),       c=>c===423],
    ['правка отбита',         await бей('PATCH','/sb/rest/v1/keyring'),             c=>c===423],
    ['удаление отбито',       await бей('DELETE','/sb/rest/v1/vaults'),             c=>c===423],
    ['регистрация отбита',    await бей('POST','/sb/auth/v1/signup'),               c=>c===423],
    ['вход проходит',         await бей('POST','/sb/auth/v1/token?grant_type=password'), дошло],
    /* Белый список — тоже правило, и он проверяется с обеих сторон: читающий
       RPC обязан пройти, пишущий сосед по тому же адресу — упереться. */
    ['читающий RPC проходит', await бей('POST','/sb/rest/v1/rpc/steps_pull'),       дошло],
    ['keyring_put отбит',     await бей('POST','/sb/rest/v1/rpc/keyring_put'),      c=>c===423],
    ['account_delete отбит',  await бей('POST','/sb/rest/v1/rpc/account_delete'),   c=>c===423],
  ];
  let плохо=0;
  for(const [имя,код,годен] of пробы){
    const ok=годен(код);
    console.log((ok?'  ✓ ':'  ✗ ')+имя+' (ответ '+код+')');
    if(!ok) плохо++;
  }
  srv.close();
  /* И обратная половина: замок обязан быть ВЫКЛЮЧАТЕЛЕМ, а не стеной.
     Стена, которая не открывается, выглядит как работающий замок ровно до
     дня, когда запись действительно понадобится. */
  { const {srv:srv2}=mkServer(true);
    await new Promise(r=>srv2.listen(0,'127.0.0.1',r));
    const p2=srv2.address().port;
    const бей2=(метод,путь)=>new Promise(ok=>{
      const q=http.request({host:'127.0.0.1',port:p2,method:метод,path:путь,agent:false,
        headers:{'content-type':'application/json','connection':'close'}},r=>{ r.resume(); ok(r.statusCode); });
      q.on('error',()=>ok(0));
      q.end(метод==='GET'?undefined:'{}');
    });
    const запись=await бей2('POST','/sb/rest/v1/rpc/push_vault');
    const рег=await бей2('POST','/sb/auth/v1/signup');
    const ok1=(запись>=200&&запись<500&&запись!==423), ok2=(рег===423);
    console.log((ok1?'  ✓ ':'  ✗ ')+'с --write запись проходит (ответ '+запись+')');
    console.log((ok2?'  ✓ ':'  ✗ ')+'регистрация отбита даже с --write (ответ '+рег+')');
    if(!ok1) плохо++;
    if(!ok2) плохо++;
    srv2.close();
  }
  if(плохо){ console.error(' ✗ ЗАМОК НЕИСПРАВЕН: '+плохо+' — живой прогон запускать нельзя'); process.exit(1); }
  console.log(' ✓ Замок держит: в режиме чтения живой аккаунт изменить нечем, а --write его открывает');
  process.exit(0);
}

(async()=>{
  const {email,pass}=creds();
  const ЗАПИСЬ=has('--write')&&process.env.BV_LIVE_WRITE==='1';
  console.log(' Живой прогон: почта '+(email?'задана':'НЕ ЗАДАНА')
    +', пароль '+(pass?'задан':'НЕ ЗАДАН')+', режим '+(ЗАПИСЬ?'ЧТЕНИЕ И ЗАПИСЬ':'только чтение'));
  if((!email||!pass)&&!has('--selftest')){
    console.error('');
    console.error(' ✗ Доступов нет, и это не ошибка скрипта — их некому было передать.');
    console.error('   Заполни форму у себя (в репозитории, под .gitignore):');
    console.error('');
    console.error('     cp .env.example .env.local   # и впиши BV_LIVE_EMAIL и BV_LIVE_PASS');
    console.error('');
    console.error('   Либо положи их в переменные окружения среды Claude Code —');
    console.error('   тогда они не лежат файлом вообще: BV_LIVE_EMAIL и BV_LIVE_PASS.');
    console.error('   Подробности и почему пароль нельзя писать в чат — SETUP.md, раздел');
    console.error('   «Прогон по живому аккаунту».');
    process.exit(2);
  }
  if(!fs.existsSync(path.join(DIST,'index.html'))){
    console.error(' ✗ Нет dist/ — сначала `node tests/build.js`'); process.exit(1);
  }
  const SB=sbOrigin();
  console.log(' Проксирую /sb/* → '+SB);

  /* ── 3. Сервер: статика из dist + прокси на Supabase с запретом записи ──
     Собирается функцией, потому что тем же кодом бьёт самопроверка замка:
     проверять копию замка — значит не проверять ничего. */
  /* Что именно отбито — не мелочь: «заблокировано 1» без адреса оставляет
     вопрос, не отрезали ли мы чтению руку. Адреса запоминаем и печатаем. */
  let блокировано=0, пропущено=0; const отбито=[];
  const mkServer=(ЗАПИСЬ)=>({счёт:()=>({блокировано,пропущено}),srv:http.createServer((q,s)=>{
    if(q.url.startsWith('/sb/')){
      const путь=q.url.slice(3);
      const метод=(q.method||'GET').toUpperCase();
      /* ЗАМОК. Читать можно всё, писать — только вход и только если явно
         разрешено. Проверка стоит ЗДЕСЬ, а не в странице: код приложения
         до этого места не дотянется. */
      /* Регистрация — не «вход». sbLogin по замыслу приложения заводит новый
         аккаунт, если почта не нашлась: для человека это удобно, для прогона
         это значит, что ОПЕЧАТКА В ПОЧТЕ создаёт лишнего пользователя в
         живой базе. Живой прогон входит в существующий аккаунт и только. */
      if(/^\/auth\/v1\/signup/.test(путь)&&метод==='POST'){
        блокировано++; отбито.push(метод+" "+путь.split("?")[0]);
        q.resume();   // дочитываем тело: иначе клиент получает обрыв вместо честного 423
        s.writeHead(423,{'content-type':'application/json'});
        return s.end(JSON.stringify({message:'live.js: регистрация запрещена — вход только в существующий аккаунт (проверь почту в .env.local)'}));
      }
      const вход=путь.startsWith('/auth/v1/');
      /* ЧИТАЮЩИЕ RPC. PostgREST шлёт любой вызов функции методом POST, в том
         числе те, что только читают. Первый живой прогон это и поймал:
         замок отбил `steps_pull`, и картина шагов вышла беднее настоящей —
         запрет, который врёт про данные, не лучше запрета, которого нет.
         Поэтому список ИМЕНной и закрытый: всё, чего в нём нет, запрещено
         (default deny). Пишущие соседи — push_vault, keyring_put,
         account_delete, pantry_add/remove, household_join/leave/invite —
         сюда не входят и не войдут. `generate_shopping_list` оставлен
         запрещённым намеренно: по имени не видно, читает он или создаёт. */
      const ЧИТАЮЩИЕ_RPC=['steps_pull','pantry_list','pantry_qty','household_info',
        'sub_status','search_recipes','search_products_fuzzy','product_by_barcode',
        'suggest_recipes','suggest_from_pantry','suggest_day','ai_job_get'];
      const мрпц=/^\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(путь);
      const чтениеRPC=!!(мрпц&&метод==='POST'&&ЧИТАЮЩИЕ_RPC.indexOf(мрпц[1])>=0);
      const пишет=(метод!=='GET'&&метод!=='HEAD'&&метод!=='OPTIONS')&&!чтениеRPC;
      if(пишет&&!вход&&!ЗАПИСЬ){
        блокировано++; отбито.push(метод+" "+путь.split("?")[0]);
        q.resume();   // дочитываем тело: иначе клиент получает обрыв вместо честного 423
        s.writeHead(423,{'content-type':'application/json'});
        return s.end(JSON.stringify({message:'live.js: запись в живой аккаунт запрещена (режим чтения)'}));
      }
      if(пишет) пропущено++;
      const h={};
      for(const k of Object.keys(q.headers)){
        if(['host','connection','content-length','accept-encoding'].includes(k)) continue;
        h[k]=q.headers[k];
      }
      h.host=new URL(SB).host;
      const up=https.request(SB+путь,{method:метод,headers:h},r=>{
        s.writeHead(r.statusCode||502,r.headers); r.pipe(s);
      });
      up.on('error',e=>{ s.writeHead(502); s.end('proxy: '+e.message); });
      return q.pipe(up);
    }
    let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html';
    const f=path.join(DIST,p);
    if(!f.startsWith(DIST)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ s.writeHead(404); return s.end('no'); }
    s.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});
    s.end(fs.readFileSync(f));
  })});
  if(has('--selftest')) return selftest(mkServer);
  const {srv}=mkServer(ЗАПИСЬ);
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port=srv.address().port;

  /* ── 4. Браузер. Профиль временный: в нём осядет токен сессии, и он
         стирается в конце вместе с каталогом. ── */
  const CH=(function(){
    if(process.env.BV_CHROME&&fs.existsSync(process.env.BV_CHROME)) return process.env.BV_CHROME;
    const base='/opt/pw-browsers';
    try{ for(const d of fs.readdirSync(base)){
      const c=path.join(base,d,'chrome-linux','chrome'); if(fs.existsSync(c)) return c;
      const c2=path.join(base,d); if(fs.statSync(c2).isFile()) return c2;
    } }catch(e){}
    for(const c of ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome']) if(fs.existsSync(c)) return c;
    return null;
  })();
  if(!CH){ console.error(' ✗ Chromium не найден — живой прогон пропущен'); srv.close(); process.exit(0); }

  const CDP=Number(process.env.BV_LIVE_PORT||9555);
  const prof=fs.mkdtempSync(path.join(os.tmpdir(),'bv-live-'));
  const ch=spawn(CH,['--headless','--no-first-run','--no-sandbox','--disable-dev-shm-usage',
    '--force-color-profile=srgb','--remote-debugging-port='+CDP,'--user-data-dir='+prof,
    '--window-size=390,844','about:blank'],{stdio:'ignore'});

  const убрать=()=>{ try{ ch.kill(); }catch(e){} try{ srv.close(); }catch(e){}
    try{ fs.rmSync(prof,{recursive:true,force:true}); }catch(e){} };
  process.on('exit',убрать);

  let ws=null;
  for(let i=0;i<80&&!ws;i++){ await sleep(300);
    try{
      const l=await new Promise((ok,bad)=>{ http.get('http://127.0.0.1:'+CDP+'/json/list',r=>{
        let b=''; r.on('data',c=>b+=c); r.on('end',()=>ok(JSON.parse(b))); }).on('error',bad); });
      const pg=l.find(t=>t.type==='page'); if(pg) ws=new WebSocket(pg.webSocketDebuggerUrl);
    }catch(e){}
  }
  if(!ws){ console.error(' ✗ Chromium не поднялся на порту '+CDP); убрать(); process.exit(1); }
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0; const w=new Map();
  ws.addEventListener('message',ev=>{ const m=JSON.parse(ev.data); if(m.id&&w.has(m.id)){ w.get(m.id)(m); w.delete(m.id); } });
  const send=(m,p={})=>new Promise(r=>{ const i=++id; w.set(i,r); ws.send(JSON.stringify({id:i,method:m,params:p})); });
  const js=async e=>{
    const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
    const d=r.result&&r.result.exceptionDetails;
    if(d) return {__err:((d.exception&&d.exception.description)||d.text||'').split('\n')[0]};
    return r.result.result.value;
  };
  const shot=async n=>{
    const out=process.env.BV_LIVE_OUT||prof;
    try{ fs.mkdirSync(out,{recursive:true}); }catch(e){}
    const r=await send('Page.captureScreenshot',{format:'png'});
    if(r.result&&r.result.data){ const f=path.join(out,n);
      fs.writeFileSync(f,Buffer.from(r.result.data,'base64')); console.log('   снимок: '+f); return f; }
    return null;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
  for(let i=0;i<200;i++){ if(await js('window.__bvBoot===true&&typeof APP_VER!=="undefined"')) break; await sleep(250); }
  const ver=await js('typeof APP_VER!=="undefined"?APP_VER:null');
  if(!ver){ console.error(' ✗ Приложение не стартовало'); убрать(); process.exit(1); }
  console.log(' Версия сборки: '+ver);

  /* ── 5. Вход и расшифровка — ТЕМ ЖЕ путём, что в приложении ──
     sbLogin даёт токен, keySetup открывает ключ. syncNow НЕ зовём: он
     двусторонний и отправил бы локальную пустоту в облако. Тянем хранилище
     напрямую и раскладываем его локально. */
  await send('Runtime.evaluate',{expression:
    'window.__bvLive={e:'+JSON.stringify(email)+',p:'+JSON.stringify(pass)+'};',returnByValue:true});
  const вход=await js(`(async function(){
    try{
      await sbLogin(window.__bvLive.e, window.__bvLive.p);
      const k=await keySetup(window.__bvLive.p);
      if(k&&k.need==='code') return JSON.stringify({сбой:'аккаунт просит код восстановления — паролем ключ не открыть'});
      if(k&&k.need==='oldpass') return JSON.stringify({сбой:'аккаунт просит прежний пароль'});
      if(!sbKey) return JSON.stringify({сбой:'ключ данных не открылся'});
      return JSON.stringify({вошли:true});
    }catch(e){ return JSON.stringify({сбой:(e&&e.message)||'вход не прошёл'}); }
  })()`);
  /* Пароль в странице больше не нужен — стираем сразу, чтобы он не жил
     в памяти вкладки дольше необходимого. */
  await js('try{ window.__bvLive=null; }catch(e){}; 1');
  const в=(()=>{ try{ return JSON.parse(вход||'{}'); }catch(e){ return {сбой:String(вход)}; } })();
  if(в.сбой||в.__err){
    console.error(' ✗ Вход не прошёл: '+(в.сбой||в.__err));
    if(блокировано>0){
      console.error('   Замок сработал '+блокировано+' раз: приложение полезло СОЗДАВАТЬ аккаунт,');
      console.error('   а значит по этой почте входа нет — почти всегда это опечатка в почте');
      console.error('   или неверный пароль. Ничего в живой базе не создано.');
    }
    console.error('   Ни почта, ни пароль нигде не печатаются — проверь их у себя в .env.local.');
    убрать(); process.exit(1);
  }
  console.log(' ✓ Вход прошёл, ключ данных открыт');

  const данные=await js(`(async function(){
    try{
      let r=await sbFetch('/rest/v1/vaults?select=version,blob&user_id=eq.'+sbUid);
      if(r.status===401&&await sbRefresh()) r=await sbFetch('/rest/v1/vaults?select=version,blob&user_id=eq.'+sbUid);
      if(!r.ok) return JSON.stringify({сбой:'хранилище не отдалось: '+r.status});
      const rows=await r.json();
      if(!rows.length) return JSON.stringify({сбой:'в облаке нет хранилища — этот аккаунт ещё ни разу не синхронизировался'});
      let remote=null;
      try{ remote=await decrypt(rows[0].blob,sbKey); }
      catch(e){ return JSON.stringify({сбой:'хранилище не расшифровалось этим ключом'}); }
      await applySnapshot(remote);
      try{ await sanitizeData(); }catch(e){}
      /* Приветственный экран снимаем ТАК ЖЕ, как это делает обработчик
         подключения в приложении. Без этого прогон входил, расшифровывал
         и считал верно, а на снимках стоял «Как хранить данные»: цифры
         настоящие, картинка — пустая заглушка. Первый живой прогон на этом
         и попался. Настройки при этом никуда не пишутся: экран снимается
         только в этой вкладке. */
      try{ S.gated=1; showGate(false); }catch(e){}
      try{ sheet('sh-sync',false); }catch(e){}
      renderAll();
      await new Promise(r2=>setTimeout(r2,1200));
      const посл=a=>{ const d=(a||[]).map(x=>x&&x.d).filter(Boolean).sort(); return d.length?d[d.length-1]:'—'; };
      return JSON.stringify({версия:rows[0].version,
        еда:(LOG||[]).length, вес:(W||[]).length, подходы:(SETS||[]).length,
        шаги:(STEPS||[]).length, сон:(SLP||[]).length, анализы:(LABS||[]).length,
        тренировки:(SESS||[]).length, добавки:(SUBS||[]).length,
        последняяЕда:посл(LOG), последнийВес:посл(W), последнийПодход:посл(SETS),
        вкладка:(document.querySelector('.view.on')||{id:''}).id});
    }catch(e){ return JSON.stringify({сбой:(e&&e.message)||'не вышло прочитать'}); }
  })()`);
  const d=(()=>{ try{ return JSON.parse(данные||'{}'); }catch(e){ return {сбой:String(данные)}; } })();
  if(d.сбой||d.__err){ console.error(' ✗ '+(d.сбой||d.__err)); убрать(); process.exit(1); }

  console.log('');
  console.log(' ── ЧТО РЕАЛЬНО ЛЕЖИТ В АККАУНТЕ (версия хранилища '+d.версия+') ──');
  console.log('   еда '+d.еда+' (последняя '+d.последняяЕда+') · вес '+d.вес+' (последний '+d.последнийВес+')');
  console.log('   подходы '+d.подходы+' (последний '+d.последнийПодход+') · тренировки '+d.тренировки);
  console.log('   шаги '+d.шаги+' · сон '+d.сон+' · анализы '+d.анализы+' · добавки '+d.добавки);
  console.log('');

  /* ── ЧТО ЖИВЫЕ ДАННЫЕ ЛОМАЮТ, А ВЫДУМАННЫЕ НЕТ ──
     Первый же живой прогон нашёл то, чего не видел ни один стенд: в дневнике
     «Завтрак» перенёсся на две строки. У владельца 1282 ккал и Б 107 в одном
     приёме, в фикстурах было 2100 и Б 120 — значение шире, и оно сжало
     название до 55 px при слове в 60. Это класс, а не место: любая строка
     из двух ячеек ломается так же, когда правая длиннее обычного.
     Ищем по всей вкладке: ячейка переносится, а её сосед — нет. */
  if(has('--wrap')){
    const рвётся=await js(`(function(){
      const вид=e=>{const r=e.getBoundingClientRect();return r.height>0&&r.width>0;};
      const плохо=[];
      document.querySelectorAll('.view.on *').forEach(e=>{
        if(e.children.length!==2||!вид(e)) return;
        const a=e.children[0], b=e.children[1];
        if(!вид(a)||!вид(b)) return;
        const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
        if(Math.abs(ra.top-rb.top)>12) return;           // не строка, а столбик
        const строкаA=Math.round(ra.height/20), строкаB=Math.round(rb.height/20);
        if(ra.height>rb.height+8&&(a.textContent||'').trim().indexOf(' ')<0)
          плохо.push({слово:(a.textContent||'').trim().slice(0,24),
            ширина:Math.round(ra.width),высота:Math.round(ra.height),
            сосед:(b.textContent||'').replace(/\s+/g,' ').trim().slice(0,34),
            соседШ:Math.round(rb.width)});
      });
      return JSON.stringify(плохо.slice(0,6),null,1); })()`);
    const п=(()=>{ try{ return JSON.parse(рвётся||'[]'); }catch(e){ return []; } })();
    console.log(' ── ОДНО СЛОВО В ДВЕ СТРОКИ (живые данные) ──');
    if(!п.length) console.log('   нет: ни одно название не перенеслось');
    else п.forEach(x=>console.log('   «'+x.слово+'» '+x.ширина+'x'+x.высота
      +' px рядом с «'+x.сосед+'» ('+x.соседШ+' px)'));
    console.log('');
  }
  /* ── ЦЕНА «ПЕРЕЧИТАТЬ ВСЁ» (v639) ──
     После каждой записи подхода или еды приложение перечитывает ВСЁ хранилище
     (SETS=await all('sets'), LOG=await all('log')). На выдуманных данных это
     ничего не стоит, на живых — тысяча подходов и восемьсот записей еды.
     Только чтение: getAll трижды, медиана. */
  if(has('--cost')){
    const c=await js(`(async()=>{ try{
      const t=async s=>{ const a=[]; let n=0; for(let i=0;i<3;i++){ const t0=performance.now(); const x=await all(s); a.push(performance.now()-t0); n=x.length; } return {n,ms:Math.round(a.sort((p,q)=>p-q)[1]*10)/10}; };
      const r={}; for(const s of ['sets','log','foods','weight']) r[s]=await t(s);
      const t0=performance.now(); try{ goView('train'); rNext(); }catch(e){} r.rNext=Math.round((performance.now()-t0)*10)/10;
      /* первый вход во вкладку против повторной отрисовки: первый — переключение, раскладка, холодный JIT; повторный — цена самого rNext */
      { const a=[]; for(let i=0;i<3;i++){ const t=performance.now(); try{ rNext(); }catch(e){} a.push(performance.now()-t); } r.rNextПовтор=Math.round(a.sort((p,q)=>p-q)[1]*10)/10; }
      const t1=performance.now(); try{ goView('food'); rFood(); }catch(e){} r.rFood=Math.round((performance.now()-t1)*10)/10;
      { const a=[]; for(let i=0;i<3;i++){ const t=performance.now(); try{ rFood(); }catch(e){} a.push(performance.now()-t); } r.rFoodПовтор=Math.round(a.sort((p,q)=>p-q)[1]*10)/10; }
      return JSON.stringify(r); }catch(e){ return JSON.stringify({сбой:e.message}); } })()`);
    console.log(' ── ЦЕНА «ПЕРЕЧИТАТЬ ВСЁ» (живые данные, мс) ──');
    console.log('   '+(typeof c==='string'?c:JSON.stringify(c)));
    console.log('');
  }
  /* ── ПРОФИЛЬ ОТРИСОВКИ «ЗАЛА» НА ЖИВЫХ ДАННЫХ (после v639) ──
     --cost показал 98 мс на rNext(); что из них чьё — говорит только
     профилировщик Chromium. Пять полных отрисовок подряд, самовремя и
     полное время по функциям, верх списка. Только чтение. */
  if(has('--profile')){
    await js(`(function(){ try{ goView('train'); rNext(); }catch(e){} return 1 })()`);
    await sleep(300);
    await send('Profiler.enable'); await send('Profiler.setSamplingInterval',{interval:100});
    await send('Profiler.start');
    const t=await js(`(function(){ const t0=performance.now(); for(let i=0;i<5;i++){ rNext(); } return Math.round((performance.now()-t0)/5*10)/10; })()`);
    const prof=await send('Profiler.stop'); await send('Profiler.disable');
    const p=prof.result&&prof.result.profile;
    if(!p){ console.log(' ── ПРОФИЛЬ: профилировщик не ответил'); }
    else {
      const byId=new Map(p.nodes.map(n=>[n.id,n])); const self=new Map(); const parent=new Map();
      p.nodes.forEach(n=>(n.children||[]).forEach(c=>parent.set(c,n.id)));
      (p.samples||[]).forEach((id,i)=>{ self.set(id,(self.get(id)||0)+(p.timeDeltas[i]||0)); });
      const name=n=>{ const f=n.callFrame||{}; return (f.functionName||'(anon)')+':'+(f.lineNumber+1); };
      const selfBy={}, inclBy={};
      for(const [id,us] of self){ let n=byId.get(id); const nm=name(n); selfBy[nm]=(selfBy[nm]||0)+us;
        const seen=new Set(); let cur=id; while(cur!=null){ const nn=byId.get(cur); const k=name(nn); if(!seen.has(k)){ seen.add(k); inclBy[k]=(inclBy[k]||0)+us; } cur=parent.get(cur); } }
      const total=[...self.values()].reduce((a,b)=>a+b,0)/1000/5;
      const top=(o,k)=>Object.entries(o).filter(([n])=>!/^\((root|program|idle|garbage)/.test(n)).sort((a,b)=>b[1]-a[1]).slice(0,k).map(([n,us])=>'   '+n.padEnd(46)+(Math.round(us/1000/5*10)/10)+' мс');
      console.log(' ── ПРОФИЛЬ rNext() на живых данных (среднее из 5, мс) ── всего '+t+' (по сэмплам '+(Math.round(total*10)/10)+')');
      console.log(' полное время (функция вместе с тем, что зовёт):'); console.log(top(inclBy,18).join('\n'));
      console.log(' самовремя (только своё тело):'); console.log(top(selfBy,14).join('\n'));
      console.log('');
    }
  }
  /* ── ОДНО ЧИСЛО — ОДИН РАЗ (Кодекс, закон 2) ──
     Сквозной проверки «это число уже есть на экране» в гейте нет. Здесь —
     замер на живых данных: по каждой вкладке все видимые листовые узлы, из
     текста берём число с единицей (ккал, г, кг, мл, шаги, %, мин, см) и
     считаем, где одна и та же пара встретилась больше одного раза. */
  if(has('--dup')){
    const d=await js(`(async function(){ const out={};
      for(const v of ['food','train','body','health','coach']){
        try{ goView(v); }catch(e){} await new Promise(r=>setTimeout(r,400));
        const root=document.getElementById('v-'+v); const seen={}; let листьев=0;
        const els=root?root.querySelectorAll('*'):[];
        for(const el of els){ if(el.children.length) continue;
          const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue; листьев++;
          const t=(el.textContent||'').replace(/\s+/g,' ').trim(); if(!t) continue;
          const re=/(\d+(?:[.,]\d+)?)\s?(ккал|кг|мл|г|шаг(?:ов|а)?|%|мин|см|л)(?![а-яa-z])/g; let m;
          while((m=re.exec(t))){ const key=m[1].replace(',','.')+' '+m[2].replace(/^шаг.*/,'шаг'); (seen[key]=seen[key]||[]).push(t.slice(0,48)); } }
        out[v]={листьев, дубли:Object.entries(seen).filter(([k,a])=>a.length>1&&parseFloat(k)>3).map(([k,a])=>k+' ×'+a.length+' ['+[...new Set(a)].slice(0,3).join(' | ')+']')};
      }
      try{ goView('food'); }catch(e){}
      return JSON.stringify(out); })()`);
    console.log(' ── ОДНО ЧИСЛО — ОДИН РАЗ (живые данные) ──');
    try{ const o=JSON.parse(d); for(const [v,x] of Object.entries(o)){ console.log('   '+v+': листьев '+x.листьев+', дублей '+x.дубли.length); x.дубли.forEach(l=>console.log('      '+l)); } }
    catch(e){ console.log('   не разобрать: '+String(d).slice(0,200)); }
    console.log('');
  }
  /* ── ТЕКСТОВЫЙ ШУМ (Кодекс, закон 1) ──
     Премиальное приложение не объясняет себя текстом. Замер: по каждой
     вкладке видимые листовые узлы с текстом длиннее 90 знаков — это
     абзацы-пояснения, а не данные. Только чтение. */
  if(has('--noise')){
    const d=await js(`(async function(){ const out={};
      for(const v of ['food','train','body','health','coach']){
        try{ goView(v); }catch(e){} await new Promise(r=>setTimeout(r,400));
        const root=document.getElementById('v-'+v); const list=[]; let знаков=0;
        /* абзац — узел, у которого внутри только строчные дети (жирное слово не рвёт его на куски) */
        const INL=new Set(['B','I','SPAN','SMALL','A','SVG','USE','S','U','EM','STRONG','BR','SUB','SUP']);
        const блок=el=>[...el.children].every(c=>INL.has(c.tagName)&&блок(c));
        for(const el of (root?root.querySelectorAll('*'):[])){ if(!блок(el)) continue;
          if(INL.has(el.tagName)&&el.parentElement&&el.parentElement!==root&&блок(el.parentElement)) continue;
          const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
          const t=(el.textContent||'').replace(/\s+/g,' ').trim(); if(!t) continue; знаков+=t.length;
          if(t.length>90){ const p=[]; let q=el; for(let i=0;i<3&&q&&q!==root;i++){ p.unshift(q.tagName.toLowerCase()+(q.id?'#'+q.id:'')+((typeof q.className==='string'&&q.className)?'.'+q.className.split(' ')[0]:'')); q=q.parentElement; }
            list.push(t.length+' зн · '+p.join('>')+' · «'+t.slice(0,70)+'…»'); } }
        out[v]={знаков,абзацев:list.length,list};
      }
      try{ goView('food'); }catch(e){}
      return JSON.stringify(out); })()`);
    console.log(' ── ТЕКСТОВЫЙ ШУМ (живые данные) ──');
    try{ const o=JSON.parse(d); for(const [v,x] of Object.entries(o)){ console.log('   '+v+': знаков '+x.знаков+', абзацев >90: '+x.абзацев); x.list.forEach(l=>console.log('      '+l)); } }
    catch(e){ console.log('   не разобрать: '+String(d).slice(0,200)); }
    console.log('');
  }
  /* ── ЗАЛ: ЧТО ВИДИТ ПРОГРАММА И ЧТО СДЕЛАНО (v644) ──
     Полевой отчёт владельца 24.09: тренировка вторника сделана в четверг,
     тренер «не видит», добавленное упражнение легло в среду. Чтобы разобрать
     такое, нужен слепок ровно того, из чего рендер строит день: план по дням
     недели, карты переноса (dayMap/roll/moveWk/daySkip), сессии и подходы
     за 10 дней. Только чтение; веса и повторы не печатаются — только имена и счёт. */
  if(has('--gym')){
    const d=await js(`(function(){ const out={};
      const P=S.prog; out.план=(P&&P.plan||[]).map(x=>x.dow+':'+x.n+' ['+(x.ex||[]).filter(i=>!i.hidden).map(i=>i.n).join(', ')+']');
      out.создана=P&&P.created||null;
      out.dayMap=S.dayMap||null; out.roll=S.roll||null; out.moveWk=S.moveWk||null; out.daySkip=S.daySkip||null;
      out.dayPlan={}; for(let i=10;i>=0;i--){ const dd=ds(dn(td())-i); if(S.dayPlan&&S.dayPlan[dd]) out.dayPlan[dd]=S.dayPlan[dd]; }
      out.сегодня=td()+' dow '+dowOf(td())+' eff '+effDow(td());
      out.сессии=SESS.filter(s=>dn(s.d)>=dn(td())-10).map(s=>s.d+' n'+(s.n||1)+' '+(s.start||'—')+'–'+(s.end||'—')+(s.act?' act':'')+(s.dow?' dow'+s.dow:'')+(s.day?' day:'+s.day:''));
      const byD={}; SETS.filter(s=>dn(s.d)>=dn(td())-10).forEach(s=>{ const k=s.d; byD[k]=byD[k]||{}; const n=(s.wu?'(р) ':'')+s.e; byD[k][n]=(byD[k][n]||0)+1; });
      out.подходы=Object.keys(byD).sort().map(k=>k+' dow'+dowOf(k)+' eff'+effDow(k)+': '+Object.entries(byD[k]).map(([n,c])=>n+'×'+c).join(', '));
      out.сырьё=SETS.filter(s=>dn(s.d)>=dn(td())-3).map(s=>s.d+' '+(s.wu?'(р) ':'')+s.e+' · ключи '+Object.keys(s).filter(k=>k!=='w'&&k!=='r').join(',')+' · id '+String(s.id||'').slice(0,24)+' · ts '+(s.ts||s.t||s.at||s.ua||s.created||'—')+(s.pos!=null?' pos'+s.pos:''));
      out.сессииСырьё=SESS.filter(s=>dn(s.d)>=dn(td())-3).map(s=>JSON.stringify(s).slice(0,300));
      try{ goView('train'); rNext(); const nb=document.getElementById('nextBox'); out.экранЗала=(nb?nb.innerText:'').replace(/\\s+/g,' ').slice(0,900); }catch(e){ out.экранЗала='сбой '+e.message; }
      try{ out.контекстТренера=(typeof coachCtx==='function'?String(coachCtx()):'').split('\\n').filter(l=>/Сегодня|пропу|очеред|сдвиг|перенес/i.test(l)).join(' | ').slice(0,700); }catch(e){ out.контекстТренера='сбой '+e.message; }
      try{ goView('food'); }catch(e){}
      return JSON.stringify(out,null,1); })()`);
    console.log(' ── ЗАЛ: план, карты переноса, сессии, подходы (живые данные) ──');
    console.log(String(d).split('\n').map(l=>'   '+l).join('\n'));
    console.log('');
  }
  /* ── «ЧТО СЪЕСТЬ» ПО ЖИВОМУ АККАУНТУ (аудит 24.09) ──
     Все четыре приёма × «Готовые» и «Из продуктов» (три источника): цель
     приёма и текст выдачи, как её видит владелец. Только чтение. */
  if(has('--meal')){
    const d=await js(`(async function(){ const out=[];
      try{ goView('food'); }catch(e){}
      try{ const _30=LOG.filter(l=>dn(td())-dn(l.d)<=30); out.push('МЕТКА ПРИЁМА в журнале за 30 дней: '+_30.filter(l=>l.sl).length+' из '+_30.length); }catch(e){}
      try{ const _ml=mealsSync(); out.push('ПРИЁМЫ ДНЯ: '+_ml.length+' — '+_ml.map(m=>m[0]+'='+m[1]+'/'+m[2]+'/до '+m[3]).join(', ')+' · S.meals='+(S.meals?'свои':'нет')+' · S.mealsN='+(S.mealsN||'—')+' · pref='+JSON.stringify(S.pref||null).slice(0,200)); }catch(e){ out.push('приёмы: сбой '+e.message); }
      for(const sl of mealsSync().map(m=>m[0])){
        mlKind=sl; mlView='pp'; try{ mlRender(); }catch(e){ out.push(sl+' pp сбой '+e.message); }
        await new Promise(r=>setTimeout(r,150));
        const gap=(document.getElementById('mlGap').innerText||'').replace(/\\s+/g,' ');
        out.push('=== '+sl+' · цель: '+gap);
        out.push('--- готовые: '+(document.getElementById('mlOut').innerText||'').replace(/\\s+/g,' ').slice(0,1400));
        if(typeof cafeRender==='function'){ mlView='cafe'; try{ mlRender(); }catch(e){ out.push(sl+' cafe сбой '+e.message); } await new Promise(r=>setTimeout(r,3500));
          out.push('--- в кафе: '+(document.getElementById('mlOut').innerText||'').replace(/\\s+/g,' ').slice(0,700)); }
        for(const src of ['new','all','mine']){
          document.getElementById('ml_src').value=src; mlView='solve'; try{ mlRender(); }catch(e){ out.push(sl+' solve сбой '+e.message); }
          await new Promise(r=>setTimeout(r,150));
          out.push('--- из продуктов ['+src+']: '+(document.getElementById('mlOut').innerText||'').replace(/\\s+/g,' ').slice(0,500));
          if(typeof ML_ROWS!=='undefined'&&ML_ROWS.length) out.push('    строки: '+ML_ROWS.map((r,i)=>r.o.n+' '+(r.o.u===1?r.g+' шт':r.g+' г')+(r.mine?' (своя)':'')+' ⇄ '+(typeof mlAlts==='function'?mlAlts(ML_ROWS,i,ML_POOL,sl).slice(0,3).map(o=>o.n+' '+mlSwapG(r.o,r.g,o,sl)).join(' / '):'—')).join(' | '));
        }
      }
      return out.join('\\n'); })()`);
    console.log(' ── «ЧТО СЪЕСТЬ» (живые данные) ──'); console.log(typeof d==='string'?d:JSON.stringify(d)); console.log('');
  }
  /* ── РАЗБОР ТРЕНИРОВКИ ПО ЖИВЫМ ДНЯМ (25.09) ── только чтение; ИИ выключен на время замера */
  if(has('--debrief')){
    const d=await js(`(async function(){ const out=[]; const _ai=aiReady; aiReady=()=>false;
      try{ const days=[...new Set(SETS.filter(s=>dn(s.d)>=dn(td())-10).map(s=>s.d))].sort();
        out.push('сегодня '+td()+' · сессии: '+SESS.filter(s=>dn(s.d)>=dn(td())-10).map(s=>s.d+' '+(s.start||'—')+'–'+(s.end||'—')).join(', '));
        for(const D of days){ try{ sessDebrief(D); }catch(e){ out.push(D+' сбой '+e.message); continue; }
          await new Promise(r=>setTimeout(r,60));
          out.push('=== '+D+' ('+DOW[dowOf(D)]+', eff '+DOW[effDow(D)]+') · '+($('aiT').textContent||'')+'\\n'+($('aiBody').innerText||'').trim()); }
      }finally{ aiReady=_ai; try{ sheet('sh-ai',false); }catch(e){} }
      return out.join('\\n'); })()`);
    console.log(' ── РАЗБОР ТРЕНИРОВКИ (живые данные) ──'); console.log(typeof d==='string'?d:JSON.stringify(d)); console.log('');
  }
  if(has('--legs')){
    const d=await js(`(async function(){ const o={};
      o.today=td(); o.sess=SESS.filter(s=>dn(s.d)>=dn(td())-6).map(s=>JSON.stringify(s).replace(/"uid":"[^"]+",?/,''));
      const nm=['Жим ногами','Жим ногами в Хаммере','Жим ногами сидя в тренажёре'];
      o.v655={flag:S.exRen655||0, created:S.prog&&S.prog.created, всего:nm.map(n=>n+': '+SETS.filter(s=>s.e===n).length+' подх.')};
      o.sets=SETS.filter(s=>nm.includes(s.e)&&dn(s.d)>=dn(td())-20).sort((a,b)=>(a.ua||0)-(b.ua||0)).map(s=>s.d+' '+s.e+' '+s.w+'×'+s.r+(s.wu?' (р)':'')+' ua '+(s.ua?new Date(s.ua).toISOString().slice(5,16):'—'));
      o.ex=nm.map(n=>{ const e=EX.find(x=>x.n===n)||{}; const em=EM[n]||{}; return n+' | eq '+em.eq+' role '+em.role+' | mk '+(e.mk||'—')+' | img '+(e.img||e.pic||'—')+' | sub '+(e.sub||[]).join(',')+' | keys '+Object.keys(e).join(','); });
      o.alias=typeof EXALIAS!=='undefined'?JSON.stringify(Object.entries(EXALIAS).filter(([k,v])=>/жим ног/i.test(k+v))):'нет EXALIAS';
      o.exImg=S.exImg?Object.keys(S.exImg).filter(k=>/жим ног/i.test(k)):'нет S.exImg';
      o.gymOff=S.gymOff?Object.keys(S.gymOff).filter(k=>/жим ног/i.test(k)):[];
      o.swapCnt=S.swapCnt?Object.entries(S.swapCnt).filter(([k])=>/жим ног/i.test(k)):[];
      o.planLegs=(S.prog&&S.prog.plan||[]).map(d=>d.dow+':'+d.n+' ['+d.ex.map(i=>i.n+(i.hidden?'(скр)':'')+' '+i.sets+'×'+i.lo+'-'+i.hi+(i.start?' st'+i.start:'')+(i.wNext?' wN'+JSON.stringify(i.wNext):'')).join('; ')+']');
      try{ const pl=(S.prog.plan||[]); o.why=[]; ['Жим ногами','Жим ногами в Хаммере'].forEach(n=>{ pl.forEach(d=>{ const it=d.ex.find(i=>i.n===n); if(!it) return; ['2026-09-22',td()].forEach(D=>{ try{ o.why.push(n+' @'+d.n+' '+D+': '+String(whyWeight(it,D)).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,420)); }catch(e){ o.why.push(n+' '+D+' сбой '+e.message); } }); }); }); }catch(e){ o.why='сбой '+e.message; }
      o.media=['Жим ногами','Жим ногами в Хаммере','Жим ногами сидя в тренажёре'].map(n=>{ const e=EX.find(x=>x.n===n); return n+' → '+(e?(exSlug(e)||'нет ролика')+' · норматив '+(STD[n]&&STD[n].r):'нет в базе'); });
      try{ const rows=[]; await sweepStaleSess(async(st,row)=>{ rows.push(row); }); o.sweep=rows.map(r=>r.d+' '+r.start+'–'+r.end+' '+r.min+' мин'+(r.fromSets?' (по подходам)':'')+(r.idleClosed?' (простой)':'')); }catch(e){ o.sweep='сбой '+e.message; }
      try{ goView('train'); rNext(); o.head=(document.getElementById('nextBox').innerText||'').replace(/\s+/g,' ').slice(0,500); }catch(e){ o.head='сбой '+e.message; }
      return JSON.stringify(o,null,1); })()`);
    console.log(' ── НОГИ (живые данные) ──'); console.log(typeof d==='string'?d:JSON.stringify(d));
  }
  if(has('--mealdbg')){
    const d=await js(`(function(){ try{ goView('food'); mlKind=${JSON.stringify(process.env.BV_DBG_SLOT||'bf')}; const SL=mlKind;
      const eaten={}; LOG.forEach(l=>eaten[l.n]=(eaten[l.n]||0)+1);
      const mine=FOODS.filter(f=>!f.sup&&f.k>0).sort((a,b)=>((eaten[b.n]||0)+(b.used||0))-((eaten[a.n]||0)+(a.used||0)));
      let pool=mine.slice(0,26).map(foodToProd);
      const g=mlTarget();
      const pf=pool.filter(o=>slotOKprod(o,SL)&&prefOK(o));
      const rows=mlSolveRows(pf,g,SL);
      const milk=pf.find(o=>/олоко 0/.test(o.n)); const sub=pf.filter(o=>/олоко 0|Творог обезжиренный|Виноград/.test(o.n)).slice(0,3);
      const LOGS=[]; const _sb=solveBasket; solveBasket=function(pool,tgt,maxN,must,cm){ const r=_sb(pool,tgt,maxN,must,cm); LOGS.push('sb['+(must||[]).map(o=>o.n.slice(0,8)).join('+')+'] pool='+pool.length+' → '+r.map(x=>x.o.n.slice(0,8)+':'+x.o.cat+':'+Math.round(x.g)).join(', ')); return r; };
      const three=pf.slice();
      const realRows=mlSolveRows(three.map(o=>Object.assign({},o)),g,SL).map(r=>r.o.n.slice(0,10)+' '+Math.round(r.g));
      const cloneRows=mlSolveRows(three.map(o=>({n:o.n,k:+o.k,p:+o.p,f:+o.f,c:+o.c,cat:o.cat,u:100})),g,SL).map(r=>r.o.n.slice(0,10)+' '+Math.round(r.g));
      solveBasket=_sb;
      const trace={three:three.map(o=>o.n+'|'+typeof o.p+'|'+o.p+'|'+o.cat+'|u'+o.u+'|cap'+o.cap), realRows, cloneRows, LOGS:LOGS.slice(0,24).map(x=>x.replace(/[\[\]"]/g,'')), pfcat:pf.map(o=>o.n.slice(0,12)+':'+o.cat+':p'+o.p)};
      const tries={trace}; [[0,9],[0,3],[0,4],[0,6],[3,9],[1,9]].forEach(([a,b])=>{ const sl2=pf.slice(a,b); tries[a+'-'+b]=sl2.map(o=>o.n.slice(0,8)+':'+o.cat).join('/')+' => '+mlSolveRows(sl2.map(o=>Object.assign({},o)),g,SL).map(r=>r.o.n.slice(0,10)+' '+Math.round(r.g)+':'+r.o.cat).join(', '); });
      const dbg={tries, codes:milk?[...milk.n].map(ch=>ch.charCodeAt(0)).join(','):null, milkKeys:milk?Object.keys(milk).join(','):null, milkRule:milk?portionRule(milk,'bf'):null, subRows:mlSolveRows(sub.map(o=>Object.assign({},o)),g,'bf').map(r=>r.o.n+' '+Math.round(r.g)), rule:portionRule({n:'Молоко 0,5%',cat:'dairy',u:100},'bf'), ps:portionSense([{o:{n:'Творог обезжиренный',cat:'dairy',p:18,k:90,u:100},g:110},{o:{n:'Молоко 0,5%',cat:'dairy',p:3,k:35,u:100},g:250},{o:{n:'Виноград',cat:'fruit',p:0.6,k:70,u:100},g:250}],'bf').map(r=>r.o.n), rx:String(MILK_RX), base:String(MILK_BASE)};
      return JSON.stringify({dbg, g:{k:Math.round(g.k),p:Math.round(g.p)}, pool:pool.map(o=>o.n+'|u'+o.u+'|p'+o.p+'|'+o.cat), после_фильтра:pf.map(o=>o.n), rows:rows.map(r=>r.o.n+' '+Math.round(r.g)+' u'+r.o.u), APP_VER:APP_VER}); }catch(e){ return 'сбой '+e.message+' '+e.stack.slice(0,300); } })()`);
    console.log(' ── ОТЛАДКА ПОДБОРА ──'); console.log(typeof d==='string'?d:JSON.stringify(d));
  }
  /* v657: «Еда» глазами — вкладка, панель дня, лист записи, «Что съесть» во всех режимах,
     рецепты, покупки, кладовая, цель. Только чтение; снимки — вне репозитория. */
  /* v660: день по часам — что видит человек на «Еде» в 7, 10, 13, 16, 19, 22 (хук часа) */
  /* v661: что тренер реально писал (ASKH), карточки хаба и данные, которые уходят в ИИ */
  /* v662: порядок в дне — как есть и после «мышца к мышце» (на копии, в базу не пишем) */
  /* v663: аудит тренировок владельца — приверженность, объём по неделям, 1ПМ по движениям, отдых, замены */
  if(has('--audit')){
    const d=await js(`(function(){ try{ const o={}; const T=dn(td());
      const wk=x=>Math.floor((T-dn(x.d))/7);
      const sess=SESS.filter(x=>!x.act&&x.start).filter(x=>T-dn(x.d)<56);
      o.sessByWeek={}; sess.forEach(s=>{ const w=wk(s); o.sessByWeek[w]=(o.sessByWeek[w]||0)+1; });
      o.planDays=S.prog&&S.prog.cfg&&S.prog.cfg.days; o.created=S.prog&&S.prog.created; o.split=S.prog&&S.prog.split; o.cfg=S.prog&&S.prog.cfg;
      o.durMin=sess.filter(s=>s.min).map(s=>s.d.slice(5)+':'+s.min+(s.rpe?'/rpe'+s.rpe:''));
      const work=SETS.filter(x=>!x.wu&&T-dn(x.d)<56&&x.r>0);
      o.volByWeek={}; work.forEach(x=>{ const w=wk(x); const e=EX.find(z=>z.n===x.e); if(!e) return; o.volByWeek[w]=o.volByWeek[w]||{}; Object.entries(e.m||{}).forEach(([m,wt])=>{ o.volByWeek[w][m]=Math.round(((o.volByWeek[w][m]||0)+wt)*10)/10; }); });
      o.plannedVol=S.prog?progVolume(S.prog):null; o.LM=LM;
      const byEx={}; work.forEach(x=>{ (byEx[x.e]=byEx[x.e]||[]).push(x); });
      o.e1rm={}; Object.entries(byEx).forEach(([n,arr])=>{ const wks={}; arr.forEach(x=>{ const w=wk(x); const v=e1rmEpley(+x.w||0,+x.r||0); if(!(v>0)) return; wks[w]=Math.max(wks[w]||0,v); }); const ks=Object.keys(wks).map(Number).sort((a,b)=>b-a); if(ks.length>=3) o.e1rm[n]=ks.map(k=>'w-'+k+':'+Math.round(wks[k])).join(' '); });
      o.repsDone={}; work.forEach(x=>{ const it=(S.prog&&S.prog.plan||[]).flatMap(dd=>dd.ex).find(i=>i.n===x.e); if(!it) return; const k=x.r<it.lo?'ниже':(x.r>it.hi?'выше':'в диапазоне'); o.repsDone[k]=(o.repsDone[k]||0)+1; });
      const rests=[]; Object.values(SETS.filter(x=>T-dn(x.d)<28&&x.ua>0).reduce((a,x)=>{ (a[x.d]=a[x.d]||[]).push(x); return a; },{})).forEach(day=>{ day.sort((a,b)=>a.ua-b.ua); for(let i=1;i<day.length;i++){ const g=(day[i].ua-day[i-1].ua)/60000; if(g>0.3&&g<12&&day[i].e===day[i-1].e) rests.push(Math.round(g*10)/10); } });
      rests.sort((a,b)=>a-b); o.restMedianMin=rests.length?rests[Math.floor(rests.length/2)]:null; o.restN=rests.length; o.restQ=[rests[Math.floor(rests.length*0.25)],rests[Math.floor(rests.length*0.75)]];
      o.swapCnt=S.swapCnt||{}; o.pain=Object.keys(S.pain||{}); o.dlLog=S.dlLog||[]; o.deload=S.deload||null; o.rdyN=(RDY||[]).length; o.gymOff=Object.keys(S.gymOff||{}); o.effort=S.effort; o.less=S.less; o.focus=typeof focusList==='function'?focusList():null;
      o.plan=(S.prog&&S.prog.plan||[]).map(dd=>dd.n+': '+dd.ex.filter(i=>!i.hidden).map(i=>i.n+' '+i.sets+'×'+i.lo+'-'+i.hi+(i.rir!=null?' rir'+i.rir:'')).join('; '));
      o.weeksUsed=(S.prog&&S.prog.plan||[]).flatMap(dd=>dd.ex).filter(i=>i.weeks).length;
      return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message+' '+e.stack.slice(0,200); } })()`);
    console.log(' ── АУДИТ ТРЕНИРОВОК ──'); console.log(d);
  }
  /* v664: доля рабочих подходов ниже диапазона — старые коридоры (по слоту) против новых (по классу движения).
     Страница при загрузке уже перевела программу (в памяти; запись блокирует прокси), старую схему восстанавливаем по таблице цели. */
  if(has('--reps')){
    const d=await js(`(function(){ try{ const o={}; const T=dn(td());
      const work=SETS.filter(x=>!x.wu&&T-dn(x.d)<56&&x.r>0);
      const cnt=P=>{ const r={ниже:0,выше:0,в_диапазоне:0,n:0,ниже_по:{}}; work.forEach(x=>{ const it=(P.plan||[]).flatMap(dd=>dd.ex).find(i=>i.n===x.e); if(!it) return; r.n++; if(x.r<it.lo){ r.ниже++; r.ниже_по[x.e]=(r.ниже_по[x.e]||0)+1; } else if(x.r>it.hi) r.выше++; else r.в_диапазоне++; }); r.доля_ниже=r.n?Math.round(r.ниже/r.n*100)+'%':null; return r; };
      const goal=(S.prog.cfg&&S.prog.cfg.goal)||'hyper', sc=SCHEME[goal]||SCHEME.hyper;
      const P0=JSON.parse(JSON.stringify(S.prog));
      (P0.plan||[]).forEach(dd=>dd.ex.forEach(it=>{ if(!it.n||it.custom||exTimed(it.n)||!EX.find(e=>e.n===it.n)) return; const a=it.main?sc.main:sc.acc; const rr=exReps(it.n,a[1],a[2]); it.lo=rr[0]; it.hi=rr[1]; }));
      o.rng664=S.rng664||null; o.before=cnt(P0); o.after=cnt(S.prog);
      /* варианты коридора изоляции — какой ближе к тому, как человек реально работает */
      o.variants={}; const R=RANGES[goal]||RANGES.hyper, isoWas=R.iso.slice();
      [[12,20],[10,15],[10,20],[8,15],[8,12]].forEach(v=>{ R.iso=v; const Pv=JSON.parse(JSON.stringify(P0)); rangeMigrate(Pv); const c=cnt(Pv); o.variants['iso '+v.join('-')]=c.доля_ниже+' ниже, '+Math.round(c.выше/c.n*100)+'% выше'; });
      R.iso=isoWas;
      /* по каждому движению ниже диапазона — какие повторы он реально делает (медиана) */
      o.reps_by_ex={}; work.forEach(x=>{ (o.reps_by_ex[x.e]=o.reps_by_ex[x.e]||[]).push(x.r); }); Object.keys(o.reps_by_ex).forEach(k=>{ const a=o.reps_by_ex[k].sort((p,q)=>p-q); o.reps_by_ex[k]=a.length+' подх., медиана '+a[Math.floor(a.length/2)]+', от '+a[0]+' до '+a[a.length-1]; });
      o.plan=(S.prog.plan||[]).map(dd=>dd.n+': '+dd.ex.filter(i=>!i.hidden).map(i=>i.n+' '+i.sets+'×'+i.lo+'-'+i.hi+' rir'+i.rir+' ['+exClass(i.n,i.main)+']').join('; '));
      return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message; } })()`);
    console.log(' ── ДИАПАЗОНЫ ──'); console.log(d);
  }
  /* v669: чему программа учится у истории — замены, застой, коридор по факту (только чтение) */
  /* v672: честная сводка — что на поддержании в живой программе и что это закроет */
  if(has('--summary')){
    const d=await js(`(function(){ try{ const o={}; const P=S.prog; const v=progVolume(P); o.cfg={days:P.cfg.days,mins:P.cfg.mins,exp:P.cfg.exp,goal:P.cfg.goal,equip:P.cfg.equip,split:P.split};
      o.volume=Object.keys(MUS).map(m=>MUS[m]+' '+Math.round(v[m]*10)/10+' / мин.роста '+mevFor(m,P.cfg)+' / MRV '+LM[m][3]);
      const t0=Date.now(); o.summary=progSummary(P); o.ms=Date.now()-t0;
      o.html=progSummaryHtml(P).replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim();
      o.coach=(coachCtx()||'').split(String.fromCharCode(10)).filter(l=>/ПОДДЕРЖАНИИ/.test(l));
      o.skept=(P.skept||[]).map(x=>x.lvl+': '+x.t);
      return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message+' '+e.stack.slice(0,200); } })()`);
    console.log(' ── ЧЕСТНАЯ СВОДКА ──'); console.log(d);
  }
  /* v671: слабые звенья — что в анкете, что стоит, что поставила бы кнопка (на копии) */
  if(has('--prehab')){
    const d=await js(`(function(){ try{ const o={}; const P=S.prog; o.inj=(P.cfg&&P.cfg.inj)||[]; o.injOK=Object.keys(S.injOK||{});
      o.have=(P.plan||[]).flatMap(dd=>dd.ex.filter(i=>!i.hidden&&i.prehab).map(i=>dd.n+': '+i.n+' '+i.sets+'×'+i.lo+'–'+i.hi+' ('+i.fix+')'));
      const P2=JSON.parse(JSON.stringify(P)); o.would=applyPrehab(P2); o.days=(P2.plan||[]).map(dd=>dd.n+': '+dd.ex.filter(i=>!i.hidden).length+' движ., '+dayMinutes(dd,P2)+' мин при '+dayBudget(P2));
      o.insight=behaviorInsights().filter(x=>x.code==='prehab'); o.cue={bench:prehabCue('Жим лёжа'),squat:prehabCue('Приседания со штангой'),legpress:prehabCue('Жим ногами')};
      o.coach=(coachCtx()||'').split(String.fromCharCode(10)).filter(l=>/ЗВЕН|звено/.test(l)); o.injCard=String(injCard()||'').replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').slice(0,300);
      return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message+' '+e.stack.slice(0,200); } })()`);
    console.log(' ── СЛАБЫЕ ЗВЕНЬЯ ──'); console.log(d);
  }
  /* v670: разгрузка по признакам — что видит детектор на живом аккаунте, ничего не включая */
  if(has('--deload')){
    const d=await js(`(function(){ try{ const o={}, T=dn(td());
      o.signs=deloadSigns();
      o.bases={}; (S.prog.plan||[]).forEach(dd=>dd.ex.forEach(it=>{ if(it.hidden) return; const cls=exClass(it.n,!!it.main); if(cls!=='base'&&cls!=='comp') return; o.bases[it.n]=exWeeks(it.n,4).map(x=>'w'+x.w+':'+Math.round(x.v)+'('+x.sets+')').join(' '); }));
      o.rpe=SESS.filter(x=>!x.act&&x.rpe>0&&T-dn(x.d)<=28).sort((a,b)=>a.d<b.d?1:-1).slice(0,6).map(x=>x.d+' RPE '+x.rpe+(x.rpeAuto?' (авто)':''));
      o.sleep=[]; for(let x=T;x>=T-9;x--){ const dd=ds(x); const s=SLP.find(y=>y.d===dd&&y.h>0), r=RDY.find(y=>y.d===dd&&y.sleep>0); if(s||r) o.sleep.push(dd+' '+(s?s.h+' ч':r.sleep+' ч (анкета)')); }
      o.ready=RDY.filter(x=>x&&T-dn(x.d)<=7).map(x=>x.d+' '+['sq','sore','en','mot','str'].map(k=>k+':'+(x[k]==null?'—':x[k])).join(' ')+' → '+rdScore(x));
      o.meso=S.prog.meso?{week:mesoWeek(S.prog),len:mesoLen(S.prog),cap:MESO_CAP,start:S.prog.meso.start,done:S.prog.meso.done||null,hold:S.prog.meso.hold||null}:null;
      o.deload=S.deload||null; o.dlLog=(S.dlLog||[]).slice(-3);
      o.autoReg=(function(){ const A=autoReg(); return A?{verdict:A.verdict,offer:A.offer,signs:A.signs}:null; })();
      o.insight=behaviorInsights().filter(x=>x.code==='deload');
      o.coach=(coachCtx()||'').split(String.fromCharCode(10)).filter(l=>/УСТАЛОСТИ|усталости/.test(l));
      /* задним числом: что видел бы детектор в день последней календарной разгрузки (окно самой разгрузки не считаем) */
      const last=(S.dlLog||[]).slice(-1)[0]; if(last&&last.from){ const T0=dn(last.from), r={day:last.from,bases:{},down:[]};
        (S.prog.plan||[]).forEach(dd=>dd.ex.forEach(it=>{ if(it.hidden) return; const cls=exClass(it.n,!!it.main); if(cls!=='base'&&cls!=='comp') return;
          const by={}; progSets(it.n).forEach(s=>{ const w=Math.floor((T0-dn(s.d))/7); if(w<0||w>=3) return; const v=(+s.w>0)?e1rm(+s.w,+s.r):+s.r; if(v>0&&v>(by[w]||0)) by[w]=v; });
          if(by[0]&&by[1]&&by[2]){ r.bases[it.n]='w0:'+Math.round(by[0])+' w1:'+Math.round(by[1])+' w2:'+Math.round(by[2]); if(by[0]<by[1]*0.985&&by[1]<by[2]*0.985) r.down.push(it.n); } }));
        r.rpe=SESS.filter(x=>!x.act&&x.rpe>0&&!x.rpeAuto&&dn(x.d)<T0&&T0-dn(x.d)<=21).sort((a,b)=>a.d<b.d?1:-1).slice(0,3).map(x=>x.d+' '+x.rpe);
        r.ready=RDY.filter(x=>x&&(dn(x.d)===T0||dn(x.d)===T0-1)).map(x=>x.d+' en:'+x.en+' sq:'+x.sq+' sore:'+x.sore+' mot:'+x.mot+' str:'+x.str);
        r.sleep=[]; for(let x=T0;x>=T0-6&&r.sleep.length<3;x--){ const dd=ds(x); const s=SLP.find(y=>y.d===dd&&y.h>0), rr=RDY.find(y=>y.d===dd&&y.sleep>0); if(s||rr) r.sleep.push(dd+' '+(s?s.h:rr.sleep)); }
        o.retro=r; }
      return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message+' '+e.stack.slice(0,200); } })()`);
    console.log(' ── РАЗГРУЗКА ПО ПРИЗНАКАМ ──'); console.log(d);
  }
  if(has('--learn')){
    const d=await js(`(function(){ try{ const o={}; o.swapCnt=S.swapCnt||{};
      o.winners={}; Object.keys(S.swapCnt||{}).forEach(n=>{ if((S.swapCnt[n]||0)>=3) o.winners[n]=slotWinner(n); });
      o.stall={}; o.rangeFact={}; (S.prog.plan||[]).forEach(dd=>dd.ex.forEach(it=>{ if(it.hidden) return; const x=exStall(it.n); if(x) o.stall[it.n]=x; const f=exRangeFact(it); if(f) o.rangeFact[it.n]=f; }));
      o.weeks={}; (S.prog.plan||[]).forEach(dd=>dd.ex.forEach(it=>{ if(!it.hidden) o.weeks[it.n]=exWeeks(it.n,5).map(x=>'w'+x.w+':'+Math.round(x.v)).join(' '); }));
      o.insights=behaviorInsights().filter(x=>['swap','stall','range','compact','subgap','add'].includes(x.code)); o.replaced=(S.prog.plan||[]).flatMap(dd=>dd.ex.filter(i=>i.altName).map(i=>dd.n+': '+i.n+' вместо '+i.altName+(i.altDay?' (на день '+i.altDay+')':' (насовсем)')+' · смены слота: '+JSON.stringify((S.slotChg||{})[slotKey(dd.dow,i.altName)]||[])));
      return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message+' '+e.stack.slice(0,200); } })()`);
    console.log(' ── УЧИТСЯ У ИСТОРИИ ──'); console.log(d);
  }
  /* v668: длина дня по факту против расчёта — отдых по записям, дни программы как есть и после пересборки (на копии) */
  if(has('--time')){
    const d=await js(`(function(){ try{ const o={}; const T=dn(td()); o.restFact=restFact(); o.budget=dayBudget(S.prog);
      const sess=SESS.filter(x=>!x.act&&x.min>0&&T-dn(x.d)<=35).sort((a,b)=>a.d<b.d?1:-1).slice(0,10);
      o.sessions=sess.map(ss=>{ const sets=SETS.filter(x=>x.d===ss.d&&!x.wu); const names=[...new Set(sets.map(x=>x.e))];
        const plan=(S.prog.plan||[]).flatMap(dd=>dd.ex);
        const day={n:ss.d,ex:names.map(n=>{ const it=plan.find(i=>i.n===n)||{}; return {n,sets:sets.filter(x=>x.e===n).length,lo:it.lo||8,hi:it.hi||12,main:!!(EM[n]&&EM[n].main),rest:it.rest}; })};
        const pred=dayMinutes(day,S.prog); const _rf=_rfCache; _rfCache={k:SETS.length+':'+td(),v:{comp:null,iso:null,n:0}}; const predPlan=dayMinutes(day,S.prog); _rfCache=_rf;
        return ss.d+': факт '+ss.min+' мин · расчёт по факту отдыха '+pred+' · по плану отдыха '+predPlan+' · '+names.length+' движ., '+sets.length+' подх.'; });
      o.programNow=(S.prog.plan||[]).map(dd=>dd.n+': '+dd.ex.filter(i=>!i.hidden).length+' движ. × '+dd.ex.filter(i=>!i.hidden).map(i=>i.sets).join('/')+' = '+dayMinutes(dd,S.prog)+' мин');
      const P2=JSON.parse(JSON.stringify(S.prog)); const r=compactProgram(P2);
      o.programCompact=r.map(x=>x.n+': '+x.exWas+'→'+x.ex+' движ., '+x.minWas+'→'+x.min+' мин, подходы '+x.sets.join('/'));
      o.compactPlan=(P2.plan||[]).map(dd=>dd.n+': '+dd.ex.filter(i=>!i.hidden).map(i=>i.n+' '+i.sets+'×'+i.lo+'-'+i.hi).join('; '));
      o.insight=behaviorInsights().filter(x=>x.code==='compact');
      return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message+' '+e.stack.slice(0,200); } })()`);
    console.log(' ── ВРЕМЯ ДНЯ ──'); console.log(d);
  }
  /* v665: когда человек РЕАЛЬНО был в зале — по времени записи подходов (ua), а не по дате, под которой они лежат */
  if(has('--when')){
    const d=await js(`(function(){ try{ const T=dn(td()); const o={};
      const msk=ms=>{ const x=new Date(ms+3*3600000); return x.toISOString().slice(0,16).replace('T',' '); };
      const rows=SETS.filter(s=>T-dn(s.d)<=12&&s.ua>0).sort((a,b)=>a.ua-b.ua);
      const by={}; rows.forEach(s=>{ const real=msk(s.ua).slice(0,10); const k=real+' (записано под '+s.d+')'; by[k]=by[k]||{первый:msk(s.ua),последний:null,n:0,упр:{}}; by[k].последний=msk(s.ua); by[k].n++; by[k].упр[(s.wu?'(р) ':'')+s.e]=(by[k].упр[(s.wu?'(р) ':'')+s.e]||0)+1; });
      o.по_реальному_времени=by;
      o.сессии=SESS.filter(s=>T-dn(s.d)<=12).map(s=>s.d+' start '+(s.start||'—')+' end '+(s.end||'—')+' rpe '+(s.rpe||'—')+' · запись '+(s.ua?msk(s.ua):'—')+(s.auto?' auto':'')+(s.idleClosed?' idle':''));
      o.extraEx=(typeof extraEx!=='undefined'?extraEx:[]).filter(x=>T-dn(x.d)<=12).map(x=>x.d+' '+x.n+(x.repeat?' repeat':'')+(x.travel?' travel':''));
      return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message; } })()`);
    console.log(' ── КОГДА БЫЛ В ЗАЛЕ (по времени записи) ──'); console.log(d);
  }
  /* v663: подгруппы груди — почему низ груди не в программе */
  if(has('--chest')){
    const d=await js(`(function(){ try{ const o={}; o.subVol=progSubVolume(S.prog); o.fix=subFixEx('ch_l','gym'); const n=o.fix; o.gear=n?gearOK(n,'gym'):null; o.level=n?levelOK(n,S.prog.cfg.exp):null; o.pain=n?painHas(n):null; o.off=n?gymOffHas(n):null; o.v7chest=volume(7).chest; o.LMchest=LM.chest; o.banned=(S.prog.cfg.inj||[]).flatMap(k=>INJ[k]?INJ[k].ban:[]).filter(x=>/брусь|наклонной вниз|кроссовер/i.test(x)); o.chL=EX.filter(e=>(e.sub||[]).includes('ch_l')).map(e=>e.n+' ('+(EM[e.n]||{}).eq+', '+(EM[e.n]||{}).role+')'); o.exSub=(S.prog.plan||[]).flatMap(dd=>dd.ex).filter(i=>/груд|Жим|Сведен/.test(i.n)).map(i=>i.n+' → '+((EX.find(e=>e.n===i.n)||{}).sub||[]).join(',')); const bd=bestDayFor(S.prog,n,{gap:1}); o.bestDay=bd?bd.n:null; o.insight=behaviorInsights().filter(x=>x.code==='subgap'); o.hidden=(S.insHid||[]).filter(x=>/subgap/.test(x)); return JSON.stringify(o,null,1); }catch(e){ return 'сбой '+e.message; } })()`);
    console.log(' ── НИЗ ГРУДИ ──'); console.log(d);
  }
  if(has('--order')){
    const d=await js(`(function(){ try{ const P=JSON.parse(JSON.stringify(S.prog||{})); const out={}; (P.plan||[]).forEach(dd=>{ const before=dd.ex.filter(i=>!i.hidden).map(i=>i.n+' ['+exTopMus(i.n)+']'); orderDay(dd); out[dd.n]={before,after:dd.ex.filter(i=>!i.hidden).map(i=>i.n+' ['+exTopMus(i.n)+']')}; }); return JSON.stringify(out,null,1); }catch(e){ return 'сбой '+e.message; } })()`);
    console.log(' ── ПОРЯДОК ──'); console.log(d);
  }
  if(has('--coach')){
    const d=await js(`(async function(){ const o={}; try{ if(typeof askhLoad==='function') await askhLoad(); }catch(e){}
      o.askh=(typeof ASKH!=='undefined'?ASKH:[]).slice(-12).map(m=>({r:m.role,t:m.ts?new Date(m.ts).toISOString().slice(0,16):'—',tag:m.tag||'',c:String(typeof m.content==='string'?m.content:JSON.stringify(m.content)).slice(0,600)}));
      try{ goView('train'); rTrain(); }catch(e){} o.hub=(window._coachMsg||[]).map(h=>String(h).replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim().slice(0,220));
      o.ctx=(typeof coachCtx==='function'?coachCtx():'').split('\\n').slice(0,40);
      o.hour=new Date().getHours(); o.trainHour=typeof trainHour==='function'?trainHour():null;
      o.nowByHour={}; for(const hh of [9,13,18,22]){ window.__hourNow=hh; o.nowByHour[hh]=(typeof coachNowCtx==='function'?coachNowCtx():'').split('\\n'); } window.__hourNow=null;
      o.rdy=(RDY||[]).filter(x=>x&&dn(td())-dn(x.d)<10).map(x=>x.d+' '+JSON.stringify(x).slice(0,120)+' → '+rdScore(x)); o.sessStarts=SESS.filter(x=>!x.act&&x.start).slice(-12).map(x=>x.d+' '+x.start); o.setHours=SETS.filter(x=>x.ua>0).slice(-30).map(x=>new Date(x.ua).getHours()).join(',');
      return JSON.stringify(o,null,1); })()`);
    console.log(' ── ТРЕНЕР ──'); console.log(typeof d==='string'?d:JSON.stringify(d));
  }
  if(has('--day')){
    for(const h of [7,10,13,16,19,22]){
      const d=await js(`(function(){ try{ window.__hourNow=${h}; goView('food'); rFood(); const o={h:${h},LOGn:LOG.length,vDate:vDate,td:td(),today:LOG.filter(l=>l.d===td()).length};
        o.wTop=getComputedStyle(document.getElementById('wTop')).display!=='none';
        o.kcal=(document.getElementById('kV')||{}).textContent; o.p=(document.getElementById('pV')||{}).textContent; o.f=(document.getElementById('fV')||{}).textContent; o.c=(document.getElementById('cV')||{}).textContent;
        o.dayUnit=(document.getElementById('dayUnit')||{}).textContent; o.dayNote=(document.getElementById('dayNote')||{}).textContent;
        const sl=slotOfHour(${h}); o.slot=sl+' '+slotName(sl); const t=slotTarget(sl); o.target=t?Math.round(t.k)+' ккал · Б'+Math.round(t.p)+' · осталось дня '+Math.round(t.left.k):'нет';
        mlKind=sl; o.rest=(typeof mlRestLine==='function'?mlRestLine():'').replace(/<[^>]+>/g,'');
        o.pregym=typeof preGymSoon==='function'?preGymSoon():null; o.now=(document.getElementById('nowRow')||{}).textContent.replace(/\\s+/g,' ').trim(); o.nowVis=getComputedStyle(document.getElementById('nowRow')).display!=='none'; o.trainToday=SETS.some(x=>x.d===td());
        o.diaryGroups=[...document.querySelectorAll('#dLog details.dgrp summary')].map(x=>x.textContent.replace(/\s+/g,' ').trim());
        o.water=(document.getElementById('wVal')||{}).textContent+' / '+(document.getElementById('wGoalL')||{}).textContent; o.steps=(document.getElementById('stVal')||{}).textContent;
        o.firstScreen=[...document.querySelectorAll('#v-food>*')].filter(e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0).map(e=>(e.id||e.className.split(' ')[0])+':'+Math.round(e.getBoundingClientRect().height));
        return JSON.stringify(o); }catch(e){ return 'сбой '+e.message; } })()`);
      console.log(' ── ЧАС '+h+' ── '+d);
    }
    await js('(function(){ window.__hourNow=null; rFood(); return 1 })()');
  }
  /* v674: --eval "<js>" — выполнить выражение на живой странице и напечатать (только чтение; запись всё равно отбивает прокси) */
  if(has('--eval')){ const code=process.argv[process.argv.indexOf('--eval')+1]||'1';
    const r=await js('(async function(){ try{ const v=await (async()=>('+code+'))(); return typeof v==="string"?v:JSON.stringify(v); }catch(e){ return "сбой "+e.message; } })()');
    console.log(' ── EVAL ──'); console.log(r); }
  /* v674: снимки вторичных экранов — страница «Данные и облако», ключ, замеры «Тела», шапка листа при прокрутке */
  if(has('--setshots')){
    const go=async(code,name,ms)=>{ const r=await js('(async function(){ try{ '+code+' }catch(e){ return "сбой "+e.message; } return 1 })()'); if(r!==1) console.log('   '+name+': '+JSON.stringify(r)); await sleep(ms||600); await shot('set_'+ver+'_'+name+'.png'); };
    const closeAll="try{ while(NAV.stack.length) navPop('code'); }catch(e){} document.querySelectorAll('.sheet.on').forEach(s=>s.classList.remove('on')); await new Promise(r=>setTimeout(r,250));";
    await js("(function(){ try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){} try{ history.back=function(){}; }catch(e){} return 1 })()");
    await go(closeAll+" openSet('Data'); await new Promise(r=>setTimeout(r,500)); document.querySelector('#sh-s .in').scrollTop=0;",'01_data_top');
    await go("document.querySelector('#sh-s .in').scrollTop=520;",'02_data_scrolled',500);
    await go("document.querySelector('#sh-s .in').scrollTop=99999;",'03_data_bottom',500);
    await go(closeAll+" openSet('Notif'); await new Promise(r=>setTimeout(r,500)); document.querySelector('#sh-s .in').scrollTop=0;",'03b_notif');
    await go(closeAll+" openSet('Prof'); await new Promise(r=>setTimeout(r,500)); document.querySelector('#sh-s .in').scrollTop=0;",'03c_prof');
    await go("document.querySelector('#sh-s .in').scrollTop=900;",'03d_prof_2',400);
    await go(closeAll+" goView('body'); const b=[...document.querySelectorAll('#v-body .seg button, #v-body [data-bt]')].find(x=>/Замеры/.test(x.textContent)); if(b) b.click(); scrollTo(0,0);",'04_body_measures',700);
    await go("scrollTo(0,600);",'05_body_measures_2',400);
    await go(closeAll+" goView('train'); const ex=EX.find(e=>e.n==='Жим лёжа'); showEx(ex); await new Promise(r=>setTimeout(r,400)); document.querySelector('#sh-ex .in').scrollTop=400;",'06_sheet_scrolled',500);
    await js('(function(){ '+closeAll.replace('await new Promise(r=>setTimeout(r,250));','')+' return 1 })()');
  }
  /* v677: снимки «Тела» (вес, шаги и сон, фото) и «Здоровья» (анализы, препараты) — ступень 3 дизайна */
  if(has('--bodyshots')){
    const go=async(code,name,ms)=>{ const r=await js('(async function(){ try{ '+code+' }catch(e){ return "сбой "+e.message; } return 1 })()'); if(r!==1) console.log('   '+name+': '+JSON.stringify(r)); await sleep(ms||600); await shot('body_'+ver+'_'+name+'.png'); };
    const closeAll="try{ while(NAV.stack.length) navPop('code'); }catch(e){} document.querySelectorAll('.sheet.on').forEach(s=>s.classList.remove('on')); await new Promise(r=>setTimeout(r,250));";
    const sub=(re)=>" const b=[...document.querySelectorAll('#v-body .seg button, #v-body [data-bt]')].find(x=>"+re+".test(x.textContent)); if(b) b.click(); await new Promise(r=>setTimeout(r,300)); scrollTo(0,0);";
    await js("(function(){ try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){} try{ history.back=function(){}; }catch(e){} return 1 })()");
    await go(closeAll+" goView('body');"+sub('/^Вес/'),'01_weight_top',700);
    await go("scrollTo(0,700);",'02_weight_scrolled',400);
    await go("document.querySelectorAll('#bd-w details').forEach(d=>d.open=true); scrollTo(0,99999);",'03_weight_bottom',400);
    await go(closeAll+" goView('body');"+sub('/Шаги/'),'04_steps_top',700);
    await go("scrollTo(0,600);",'05_steps_scrolled',400);
    await go("document.querySelectorAll('#bd-s details, #bd-z details').forEach(d=>d.open=true); scrollTo(0,1200);",'06_steps_open',400);
    await go("scrollTo(0,2000);",'07_steps_open_2',400);
    await go(closeAll+" goView('body');"+sub('/Замеры/')+" document.getElementById('bd-p').scrollIntoView(); document.querySelectorAll('#bd-p details').forEach(d=>d.open=true);",'08_photo',700);
    await go(closeAll+" goView('health'); scrollTo(0,0);",'09_health_top',700);
    await go("document.querySelectorAll('#hl-b details').forEach(d=>d.open=true); scrollTo(0,500);",'10_health_open',400);
    await go(closeAll+" goView('health'); const b=[...document.querySelectorAll('#v-health .seg button')].find(x=>/Препараты/.test(x.textContent)); if(b) b.click(); await new Promise(r=>setTimeout(r,300)); scrollTo(0,0);",'11_health_subs',700);
    await go("document.querySelectorAll('#hl-s details').forEach(d=>d.open=true); scrollTo(0,500);",'12_health_subs_open',400);
    await js('(function(){ '+closeAll.replace('await new Promise(r=>setTimeout(r,250));','')+' return 1 })()');
  }
  /* v678: снимки листов с «пилюлями» — кладовая, поиск еды, тренер, закрыть тренировку, анализы, продукт */
  if(has('--sheetshots')){
    const go=async(code,name,ms)=>{ const r=await js('(async function(){ try{ '+code+' }catch(e){ return "сбой "+e.message; } return 1 })()'); if(r!==1) console.log('   '+name+': '+JSON.stringify(r)); await sleep(ms||700); await shot('sheet_'+ver+'_'+name+'.png'); };
    const closeAll="try{ while(NAV.stack.length) navPop('code'); }catch(e){} document.querySelectorAll('.sheet.on').forEach(s=>s.classList.remove('on')); await new Promise(r=>setTimeout(r,250));";
    await js("(function(){ try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){} try{ history.back=function(){}; }catch(e){} return 1 })()");
    await go(closeAll+" goView('food'); openFind(); await new Promise(r=>setTimeout(r,400));",'01_find');
    await go(closeAll+" goView('food'); document.getElementById('bPantry').click(); await new Promise(r=>setTimeout(r,1200)); document.querySelector('#sh-pantry .in').scrollTop=0;",'02_pantry',900);
    await go("document.querySelectorAll('#sh-pantry details').forEach(d=>d.open=true); document.querySelector('#sh-pantry .in').scrollTop=600;",'03_pantry_open',500);
    await go(closeAll+" goView('food'); openF(true,{n:'Сырники',k:220,p:18,f:9,c:14}); await new Promise(r=>setTimeout(r,400));",'04_food_add');
    await go(closeAll+" goView('train'); sheet('sh-sess',true); await new Promise(r=>setTimeout(r,400)); document.querySelectorAll('#sh-sess details').forEach(d=>d.open=true);",'05_sess');
    await go(closeAll+" goView('health'); document.getElementById('bAddLab').click(); await new Promise(r=>setTimeout(r,400)); document.querySelector('#sh-lab .in').scrollTop=0;",'06_lab');
    await go(closeAll+" goView('coach'); try{ coachCards(); }catch(e){} sheet('sh-ask',true); renderAsk(); await new Promise(r=>setTimeout(r,600)); document.querySelector('#sh-ask .in').scrollTop=0;",'07_ask_top');
    await go("document.querySelector('#sh-ask .in').scrollTop=99999;",'08_ask_bottom',500);
    await js('(function(){ '+closeAll.replace('await new Promise(r=>setTimeout(r,250));','')+' return 1 })()');
  }
  /* v679: снимок отказа поиска в Open Food Facts — fetch к OFF подменён на «Load failed», как делает Safari */
  if(has('--offshot')){
    const closeAll="try{ while(NAV.stack.length) navPop('code'); }catch(e){} document.querySelectorAll('.sheet.on').forEach(s=>s.classList.remove('on')); await new Promise(r=>setTimeout(r,250));";
    await js("(function(){ try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){} try{ history.back=function(){}; }catch(e){} return 1 })()");
    const r=await js('(async function(){ try{ '+closeAll+" const _f=window.fetch; window.fetch=(u,o)=>/openfoodfacts/.test(String(u))?Promise.reject(new TypeError('Load failed')):_f(u,o); openOffSearch('творог'); await new Promise(r=>setTimeout(r,2200)); window.fetch=_f; return document.getElementById('offBody').textContent.trim().slice(0,120); }catch(e){ return 'сбой '+e.message; } })()");
    console.log(' ── OFF-ОТКАЗ ── '+JSON.stringify(r)); await shot('off_'+ver+'_fail.png');
    await js('(function(){ '+closeAll.replace('await new Promise(r=>setTimeout(r,250));','')+' return 1 })()');
  }
  if(has('--foodshots')){
    const go=async(code,name,ms)=>{ const r=await js('(async function(){ try{ '+code+' }catch(e){ return "сбой "+e.message; } return 1 })()'); if(r!==1) console.log('   '+name+': '+JSON.stringify(r)); await sleep(ms||700); await shot('food_'+ver+'_'+name+'.png'); };
    const closeAll="try{ while(NAV.stack.length) navPop('code'); }catch(e){} document.querySelectorAll('.sheet.on').forEach(s=>s.classList.remove('on')); await new Promise(r=>setTimeout(r,250));";
    await js("(function(){ try{ const o=document.getElementById('onb'); if(o) o.style.display='none'; }catch(e){} try{ const _hb=history.back; history.back=function(){}; }catch(e){} return 1 })()");
    await go("goView('food'); "+closeAll+" scrollTo(0,0);",'01_top');
    await go("window.__hourNow=13; rFood(); scrollTo(0,0);",'01b_top_13h',400);
    await go("window.__hourNow=null; rFood();",'01c_top_now',300);
    await go("scrollTo(0,700);",'02_scroll1',400);
    await go("scrollTo(0,1400);",'03_scroll2',400);
    await go("scrollTo(0,99999);",'04_bottom',400);
    await go("scrollTo(0,0); const b=document.getElementById('hSb'); if(b) b.click();",'05_daypanel');
    await go(closeAll+" openFind();",'06_find');
    await go("const q=document.getElementById('qSearch2'); q.value='твор'; q.dispatchEvent(new Event('input',{bubbles:true}));",'07_find_search');
    await go("const q=document.getElementById('qSearch2'); q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); const r=document.querySelector('#qList2 .qrow, #qList2 .item, #qList2 button'); if(r) r.click();",'08_find_row');
    await go(closeAll+" mlKind=curSlot(); mlView='pp'; mlSkipNow.clear(); renderMealChips(); setSlotChip(); document.querySelectorAll('[data-mlv]').forEach(x=>x.classList.toggle('on',x.dataset.mlv==='pp')); mlRender(); sheet('sh-meal',true);",'09_meal_pp');
    await go("mlView='solve'; document.getElementById('ml_src').value='mine'; document.querySelectorAll('[data-mlv]').forEach(x=>x.classList.toggle('on',x.dataset.mlv==='solve')); mlRender();",'10_meal_solve');
    await go("const sw=document.querySelector('#mlOut [data-mlsw=\"1\"]'); if(sw) sw.click();",'11_meal_swap');
    await go("mlView='cafe'; document.querySelectorAll('[data-mlv]').forEach(x=>x.classList.toggle('on',x.dataset.mlv==='cafe')); mlRender(); await new Promise(r=>setTimeout(r,3000));",'12_meal_cafe');
    await go("const x=document.querySelector('#mlOut [data-mlno=\"0\"]'); if(x) x.click();",'13_why');
    await go(closeAll+" const b=document.getElementById('bRec'); if(b) b.click();",'14_rec',1200);
    await go(closeAll+" const b=document.getElementById('bShop'); if(b) b.click();",'15_shop');
    await go(closeAll+" const b=document.getElementById('bPantry'); if(b) b.click();",'16_pantry');
    await go(closeAll+" const b=document.querySelector('[data-open=\"sh-tdee\"], #bTdee, #bGoal'); if(b) b.click(); else if(typeof openTdee==='function') openTdee();",'17_tdee');
    await go(closeAll+" const d=document.querySelector('#diaryDet .item, #diary .item, [data-le]'); if(d) d.click();",'18_logedit');
    await go(closeAll+" scrollTo(0,0);",'19_after');
    /* глубже: правка записи, «Сколько», форма продукта, вода, шаги, раскрывашки, вчера */
    await go(closeAll+" const e=document.querySelector('#dLog [data-ledit]'); if(e) e.click();",'20_logedit');
    await go(closeAll+" openFind(); await new Promise(r=>setTimeout(r,400)); const g=document.querySelector('#qList2 .g[data-qe]'); if(g) g.click();",'21_amount');
    await go(closeAll+" openFind(); await new Promise(r=>setTimeout(r,300)); const q=document.getElementById('qSearch2'); q.value='ъъъ'; q.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,400)); const m=document.querySelector('#qList2 .qman'); if(m) m.click();",'22_form');
    await go(closeAll+" const d=[...document.querySelectorAll('#v-food details.det.pro')].find(x=>/Мои продукты/.test(x.textContent)); if(d){ d.open=true; d.scrollIntoView(); }",'23_myfoods');
    await go(closeAll+" scrollTo(0,0); const w=document.getElementById('wEdit'); if(w) w.click();",'24_water');
    await go(closeAll+" scrollTo(0,0); const s=document.getElementById('stEdit'); if(s) s.click();",'25_steps');
    await go(closeAll+" mlKind=curSlot(); mlView='pp'; mlRender(); sheet('sh-meal',true); await new Promise(r=>setTimeout(r,300)); const p=document.querySelector('#mlOut [data-ppx]'); if(p) p.click();",'26_pp_open');
    await go("mlView='cafe'; mlRender(); await new Promise(r=>setTimeout(r,2500)); const x=document.querySelector('#mlOut [data-cafeno=\"0\"]'); if(x) x.click();",'27_why');
    await go(closeAll+" const b=document.getElementById('bTdee'); if(b) b.click();",'28_tdee_raw');
    await go(closeAll+" const b=document.getElementById('bShop'); if(b) b.click(); await new Promise(r=>setTimeout(r,300)); const d=[...document.querySelectorAll('#sh-shop details')][0]; if(d) d.open=true;",'29_shop_must');
    await go(closeAll+" const b=document.getElementById('bRec'); if(b) b.click(); await new Promise(r=>setTimeout(r,900)); const r=document.querySelector('#sh-rec .item .g, #sh-rec .item'); if(r) r.click();",'30_rec_open',900);
    await go(closeAll+" const b=document.getElementById('bPantry'); if(b) b.click(); await new Promise(r=>setTimeout(r,300)); const d=[...document.querySelectorAll('#sh-pantry details')][0]; if(d) d.open=true;",'31_pantry_fast');
    await go(closeAll+" scrollTo(0,0); const b=document.getElementById('hSb'); if(b) b.click(); await new Promise(r=>setTimeout(r,400)); const y=[...document.querySelectorAll('#sh-day [data-d], #sh-day button')].find(x=>/Чт/.test(x.textContent)); if(y) y.click();",'32_yesterday');
    await go(closeAll+" scrollTo(0,600);",'33_yesterday_diary',400);
    /* v658: пустой день — «Как вчера — весь день». Сегодня у владельца не пустой: смотрим на стенде,
       временно спрятав сегодняшние записи из памяти (в базу не пишем), потом возвращаем. */
    await go(closeAll+" vDate=null; window.__L0=LOG; LOG=LOG.filter(l=>l.d!==td()); rFood(); await new Promise(r=>setTimeout(r,300)); const dd=document.getElementById('diaryDet'); if(dd) dd.open=true; dd&&dd.scrollIntoView();",'34_empty_repeat',400);
    { const d=await js(`(function(){ const o={}; const src=typeof lastDayOf==='function'?lastDayOf(td()):null; o.src=src?{d:src.d,i:src.i,n:src.arr.length,k:Math.round(src.arr.reduce((a,l)=>a+(+l.k||0),0)),slots:src.arr.map(l=>l.sl||('час '+(l.ua?new Date(l.ua).getHours():'—'))).join(',')}:null; o.btn=(document.querySelector('#dLog [data-repday] .t')||{}).textContent; o.sub=(document.querySelector('#dLog [data-repday] .s')||{}).textContent; return JSON.stringify(o); })()`); console.log(' ── КАК ВЧЕРА ── '+d); }
    await go("LOG=window.__L0; rFood();",'35_restored',300);
    { const d=await js(`(function(){ const o={}; o.foods=FOODS.filter(f=>/твор/i.test(f.n)).map(f=>[f.n,f.br||'',f.u,f.k,f.used||0,f.id,f.uid?1:0,[...f.n].map(c=>c.charCodeAt(0)).filter(c=>c<32||c>1200||c===160).join(',')]); o.dupKeys=(function(){ const m={}; FOODS.forEach(f=>{ const k=(f.n||'').trim().toLowerCase()+'|'+(f.br||'').trim().toLowerCase(); m[k]=(m[k]||0)+1; }); return Object.entries(m).filter(x=>x[1]>1).slice(0,20); })(); o.tdV=(document.getElementById('tdV')||{}).textContent; o.foodsN=FOODS.length; return JSON.stringify(o,null,1); })()`); console.log(' ── ДИАГНОСТИКА ──'); console.log(d); }
  }
  if(has('--shots')){
    const вкладки=(val('--tab','food')||'food').split(',');
    for(const v of вкладки){
      await js(`(function(){ try{ goView(${JSON.stringify(v)}); }catch(e){} return 1 })()`);
      await sleep(900);
      await shot('live_'+ver+'_'+v+'.png');
    }
  }

  console.log(' Записей в облако заблокировано: '+блокировано+(ЗАПИСЬ?(', пропущено: '+пропущено):''));
  if(отбито.length) console.log('   отбито: '+[...new Set(отбито)].join(' · '));
  console.log(' ✓ Живой прогон ('+ver+'): вход, расшифровка и рендер настоящего аккаунта прошли'
    +(ЗАПИСЬ?'' : ' — НИ ОДНОЙ записи в облако не ушло'));
  ws.close(); убрать(); await sleep(200); process.exit(0);
})().catch(e=>{ console.error(' ✗ ЖИВОЙ ПРОГОН УПАЛ: '+(e&&e.message)); process.exit(1); });
