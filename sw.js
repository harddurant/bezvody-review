const C='trk-v679';
/* УСТАНОВКА НЕ ДОЛЖНА ПАДАТЬ ЦЕЛИКОМ ИЗ-ЗА ОДНОГО ФАЙЛА.
   Здесь стоял cache.addAll() по шести адресам, а он атомарен: не скачался
   один — не кэшируется НИЧЕГО, установка отклоняется, воркер не активируется.
   Прогон в браузере (24.08): отдали 503 на один шрифт — и получили ноль
   регистраций, пустой кэш и «офлайн невозможен». То есть человек, у которого
   при первом заходе моргнула сеть на одном запросе из шести, остаётся БЕЗ
   офлайна вообще и без подсказки установить приложение — и не узнает об этом,
   пока не откроет приложение в метро и не увидит белый экран. Чинится это
   только следующим деплоем.
   Теперь: оболочка обязательна (без неё офлайна нет по определению), всё
   остальное — по возможности. Шрифт не доехал — подхватится обычным
   фетч-обработчиком при первом же онлайн-открытии, а офлайн уже работает.
   Оболочку берём ОДНИМ запросом на два ключа кэша: «./» и «./index.html» —
   это один и тот же документ, и просить его дважды значит удваивать шанс
   осечки. Одна повторная попытка — на случай короткого сбоя сети. */
const SHELL='./index.html';
const EXTRA=['./manifest.json','./icon.svg',
  './fonts/manrope-latin.woff2','./fonts/manrope-cyrillic.woff2'];
async function cacheShell(c){
  let last=null;
  for(let a=0;a<2;a++){
    try{
      const r=await fetch(SHELL,{cache:'reload'});
      if(!r.ok) throw new Error('shell '+r.status);
      await c.put(SHELL,r.clone());
      await c.put('./',r);
      return true;
    }catch(err){ last=err; }
  }
  throw last||new Error('shell');
}
self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(C);
    await cacheShell(c);                                   // без этого офлайна нет — падаем честно
    await Promise.all(EXTRA.map(u=>c.add(u).catch(()=>{})));  // это — по возможности
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))
    .then(()=>self.clients.claim()));
});
/* ── Напоминания ──
   Текст приходит с сервера уже собранным. Ничего личного в нём нет:
   сервер знает только час напоминания и дни недели тренировок. */
self.addEventListener('push',e=>{
  let d={};
  try{ d=e.data?e.data.json():{} }catch(_){ d={body:(e.data&&e.data.text())||''} }
  const title=d.title||'Без воды';
  e.waitUntil(self.registration.showNotification(title,{
    body:d.body||'',
    icon:'./icon.svg',
    badge:'./icon.svg',
    tag:d.tag||'bezvody',
    renotify:false,
    data:{url:d.url||'./'}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'./';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){ if('focus' in c) return c.focus(); }   // вкладка уже открыта — не плодим новые
    return clients.openWindow(url);
  }));
});

self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  // всё внешнее (Open Food Facts, Anthropic, ZXing) — только по сети
  if(u.origin!==location.origin) return;
  // /sb/* (прокси Supabase), /api/* и /media/* (видео с R2 через наш домен) —
  // не кэшируем: данные живые, а ролики раздули бы кэш на сотни мегабайт
  if(u.pathname.startsWith('/sb/')||u.pathname.startsWith('/api/')||u.pathname.startsWith('/media/')) return;
  // ОБОЛОЧКА (навигация / index.html): сеть впереди, кэш — резерв для офлайна.
  // Так новые деплои показываются сразу, а не из старого кэша.
  // /promo/* — отдельные страницы (студия, ролик), не оболочка приложения:
  // иначе офлайн-резерв подсунул бы туда index.html вместо нужной страницы.
  const promo = u.pathname.startsWith('/promo/');
  const shell = !promo && (e.request.mode==='navigate' || u.pathname==='/' || u.pathname.endsWith('/index.html'));
  if(shell){
    // ТСПУ-блокировки не рвут соединение, а вешают его — без таймаута человек
    // смотрит на белый экран вместо готового кэша. 5 сек — и отдаём кэш;
    // сеть докачивается в фоне и обновляет кэш к следующему открытию.
    const net=fetch(e.request).then(res=>{
      if(res.ok){const cl=res.clone();caches.open(C).then(c=>c.put(e.request,cl))}
      return res;
    });
    net.catch(()=>{});   // проиграл гонку — молчим, не сорим unhandled rejection
    const tmo=new Promise((_,rej)=>setTimeout(()=>rej(new Error('shell-timeout')),5000));
    e.respondWith(
      Promise.race([net,tmo]).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
    );
    return;
  }
  // ПРОЧАЯ СТАТИКА (иконки, манифест): кэш впереди
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
      if(res.ok&&e.request.method==='GET'){const cl=res.clone();caches.open(C).then(c=>c.put(e.request,cl))}
      return res;
    }).catch(()=>caches.match('./index.html')))
  );
});
