# NAVIGATION.md — матрица состояний навигации PWA на iPhone

Аудит 14.09.2026 по заданию владельца. Источники: наш код (`index.html`,
строки указаны на v571) и справочник Apple HIG (`.claude/skills/apple-hig`,
файлы `modality`, `sheets`, `gestures`, `designing-for-ios`, `layout`,
`launching`, `multitasking`, `tab-bars`, `scroll-views`, `motion`).
Каждая строка таблицы — факт из кода плюс правило из HIG. Где проверить
можно только на телефоне, так и написано.

## 0. Что у нас устроено на самом деле (факты, не мнения)

| Факт | Где в коде |
|---|---|
| Иерархической навигации (push/pop) **нет вовсе**. «Вглубь» = вкладка → лист (`.sheet`) → лист над листом | `goView` 26281; `sheet()` 4130 |
| История браузера **не используется**: ноль `pushState`, ноль `popstate`. Единственный `replaceState` стирает `?go=` из deep-link | 25133, 26727, 26744 |
| Режим `display: standalone`, `viewport-fit=cover`, статус-бар `black-translucent` — `env(safe-area-inset-*)` живые | `manifest.json`; meta строки 5–7 |
| Листы **стекаются**: z-index = 400 + число открытых | 4130 (`s.style.zIndex=400+…`) |
| Лист закрывается: кнопкой × (справа в шапке), тапом по фону, программно. **Свайпа вниз нет** — но грабер (36×4) нарисован | 16580, 16581; CSS 935 |
| Закрытие: `.on` снимается сразу, `.closing` 180 мс с `pointer-events:none`; замок прокрутки считается по `.on` | 4130–4150; `shlockSync` 4127 |
| Замок документа под листом: `html.shlock{overflow:hidden;overscroll-behavior:none}`, внутри листа `overscroll-behavior:contain`, `max-height:92dvh` | 911, 932 |
| Клавиатура: `.sheet.kb` → лист во всю высоту `--vvh` из `visualViewport`; пересчёт на `resize`/`orientationchange` | 950–954, `vvSync` |
| Переключение вкладки: чужая — где был, активная — наверх (v593, `VS`/`curV`) | `goView` 26454 |
| Таймер отдыха считает по **абсолютному** времени `restEndAt`, хранит в `localStorage`, на `visibilitychange` пересчитывается (`resumeRest`); wake lock перезапрашивается | 22443–22475, 22561–22578 |
| Страница под замком держится **тихим зацикленным WAV** через `<audio>` (`restKeepOn`); сигнал конца — тем же элементом | 22398–22443 |
| Ориентация зафиксирована `portrait` в манифесте; `orientationchange` только пересчитывает высоту | `manifest.json`; 17598 |
| `prefers-reduced-motion` гасит все анимации | 678 |

## 1. Карта состояний

Обозначения: **HIG** — правило и файл справочника · **Баг** — расхождение с
HIG или с ожиданием человека · **Fix** — что делать · **P1/P2/P3** — приоритет.

### Сценарий 1 — «Вход вглубь» (вкладка → лист → лист над листом)

| Действие | Состояние PWA (что происходит в коде) | Правило HIG | Баг | Fix |
|---|---|---|---|---|
| Тап по строке входа («Итоги недели», карточка упражнения) | `sheet(id,true)`: `.on`, z=401, `html.shlock`, nav накрыт подложкой | `sheets`: лист для узкой задачи в контексте · `tab-bars`: модальное может накрывать таб-бар | нет | — |
| **Свайп от левого края** | Обработчика нет. В standalone WebKit не рисует навигационного chrome, а истории у нас нет — жест не делает ничего *(подтвердить на телефоне: 10 сек)* | `designing-for-ios`: «support swipe-to-go-back» · `gestures`: если жест не работает — покажи почему, иначе «приложение зависло» | Рефлекс iOS молча не срабатывает. Но свайп-назад — жест для push-экранов; у листов по HIG жест другой — **вниз** | Не делать свайп-назад. Сделать свайп-вниз (см. 2b). Рассинхрона истории и CSS быть не может: истории нет, состояние в одном месте |
| Тап × в шапке листа | `data-close` → `navClose(id,'button')`; × на **ведущем** (левом) краю всех 33 шапок, «Сохранить/Готово» — справа в теле (v595, флекс `order`) | `sheets` iOS: Cancel/Close на ведущем краю, Done — справа ✓ | нет | — |
| **Лист над листом** (карточка упражнения → ввод подхода → выбор упражнения; порция над «Добавить») | Оба `.on` одновременно, z растёт. Тап по фону верхнего закрывает только верхний — человек падает в средний | `sheets`: **«Never stack sheets»**; `modality`: «only one modal at a time», «avoid modal-within-a-modal» | P1. Три листа в стопке на «Зале»: 14963 → 21867/22623 → `exPickOpen` | Стек с одним видимым: открытие нового **прячет** предыдущий (`visibility:hidden`), закрытие верхнего **возвращает** его. HIG это прямо разрешает: «close the first before showing the second, restore it after» |
| Потеря фокуса и возврат (свернули, пришли обратно) при открытом листе | Лист остаётся. Сменился день — `dayRollSheet` (v594): обновляемый лист перерисован на месте, привязанный к дню — закрыт с тостом, с набранным — не тронут | `launching`: «restore previous state»; `multitasking`: «resume on return» ✓ | нет | — |
| 180 мс закрытия | `.on` снят → `shlockSync` **отпустил** прокрутку, а лист ещё виден (`.closing`) | `motion`: обратная связь совпадает с картинкой | P2. Второй быстрый тап попадает в страницу под ещё видимым листом | Замок считать по `.sheet.on, .sheet.closing` |
| Тап по вкладке | `scrollTo(0,0)` всегда | `tab-bars`: «preserving navigation state within each section»; iOS: тап по **активной** вкладке — скролл наверх | P2. Позиция в разделе теряется при каждом переключении | Помнить `scrollY` на вкладку; восстанавливать; тап по активной — наверх |

### Сценарий 2 — «Прерывание контекста» (лист внутри тренировки)

| Действие | Состояние PWA | Правило HIG | Баг | Fix |
|---|---|---|---|---|
| Открыть карточку/ввод подхода из тренировки | Лист над `#v-train`, замок документа, внутренний скролл с `overscroll-behavior:contain` | `sheets`: узкая задача рядом с контекстом ✓ | нет | — |
| **Свайп шторки вниз** | Грабер нарисован (36×4), но `touchmove` не слушается — жест **не делает ничего** | `sheets` iOS: «Support swipe to dismiss»; «Include a grabber — visible affordance for dragging» | P1. Грабер **лжёт**: обещает жест, которого нет. `gestures`: «people assume the app froze» | Реализовать свайп-вниз (алгоритм в §2.3) **или** убрать грабер. Правильно — первое |
| Случайный тап по подложке | Мгновенное закрытие без вопросов, даже если в поле набран текст («Добавить», «Порция») | `modality`: «**Warn before data loss** — confirm with an action sheet» | P1. Потный палец в зале → потеря набранного | Флаг `dirty` на лист (событие `input`); при закрытии фоном/свайпом с `dirty` — `confirm`. × с `dirty` — тоже спросить |
| «Кнопка назад устройства» | На iPhone её **нет**. (На Android: аппаратная «назад» закрывает всё PWA целиком — записи в истории нет) | `gestures`: стандартный fallback обязан быть | P2 только для Android | Одна запись `history` на открытый лист, `popstate` → закрыть верхний. На iOS безвредно |
| Поворот экрана | Манифест `portrait` + `lockPortrait()` через Screen Orientation API при старте (v595); `vvSync` пересчитает высоту | `layout` iOS: «support both unless your experience genuinely requires one» — требует: одна рука с гантелей | **Осознанное решение**, записано в коде и SPEC.md | — |
| Клавиатура в листе | `.kb` → лист во всю `--vvh`, поле держится в верхней трети (`keepVisible`) | `entering-data`/`keyboards`: поле не прячется | нет (починено 21.08, 31.08) | — |
| Системный `confirm()` поверх листа | Нативный алерт поверх всего; один за раз | `modality`: alerts may appear on top; never two at once ✓ | нет | — |

### Сценарий 3 — «Системные прерывания при запущенном таймере отдыха»

| Событие | Состояние PWA | Правило HIG | Баг | Fix |
|---|---|---|---|---|
| Блокировка экрана | JS-таймеры заморожены; страницу держит живой тихий WAV; конец отдыха считается от `restEndAt` (абсолютное время), сигнал тем же `<audio>`. На разблокировке `visibilitychange` → `resumeRest`: пересчёт, `wakeOn()` заново; истёк — тост «Отдых закончился, пока экран был выключен» | `multitasking`: pause/resume seamlessly · `playing-audio`: под тихим переключателем играет только явно запущенное человеком медиа — наш WAV запущен из тапа ✓ | нет — сделано правильно (v557) | — |
| Сворачивание (Home / переключатель) | То же, что блокировка | то же | нет | — |
| **Входящий звонок** | iOS прерывает аудиосессию → тихий WAV встаёт на паузу. Баннер звонка **не** даёт `visibilitychange` → `restKeepOn` не перезапускается. Если после звонка экран погас — страница уснёт, сигнал конца пропадёт. Возврат спасает `resumeRest` (тост «закончился»), но **сигнала в момент конца не будет** | `multitasking`: «short interruptions: resume automatically when the interruption ends» | P1. Единственная реальная дыра сценария 3 *(подтвердить на телефоне: звонок во время отдыха)* | Слушать `pause` на keep-alive `<audio>` и `focus` окна: если отдых идёт и пауза не наша — `restKeepOn()` снова. Помнить: после прерывания iOS может потребовать тап для `play()` — тогда показать плашку «нажми, чтобы вернуть сигнал» |
| Возврат после смены дня | `dayRoll` → `renderAll` + `dayRollSheet` (открытый лист); полоса отдыха живёт отдельно и переживает перерисовку | `launching`: restore state ✓ | нет | — |
| Safe Area при возврате / Dynamic Island | `viewport-fit=cover` ✓, шапка `sticky` с `inset-top`, nav с `inset-bottom`, лист с `inset-bottom`, `.kb` по `--vvh` | `layout`: «respect safe areas… account for bars that reposition dynamically» ✓ | нет | — |
| Пуш `?go=week` во время тренировки | Открывает лист «Коуча» над «Залом», `replaceState` стирает параметр, записи в истории нет | `live-activities`: deep link «opens the app at the right location» ✓ | нет | — |

## 2. Навигационный алгоритм — как зафиксировать стек

Цель: **одно место истины** о том, что открыто; DOM-классы и история браузера
выводятся из него, а не наоборот. Тогда «неопределённого состояния» не
бывает по построению: любой путь закрытия (×, фон, свайп, `popstate`,
программный) идёт через одну функцию.

### 2.1 Стек листов (JS)

```js
const NAV={stack:[],gen:0,skipPop:0};

function navPush(id){
  if(NAV.stack.includes(id)) return;
  const prev=NAV.stack[NAV.stack.length-1];
  if(prev) $(prev).classList.add('under');          // HIG: один лист — прячем, не закрываем
  NAV.stack.push(id);
  sheet(id,true);                                     // существующий показ
  try{ history.pushState({bv:++NAV.gen,d:NAV.stack.length},''); }catch(e){}
}

function navPop(reason){                              // reason: 'button'|'backdrop'|'swipe'|'history'|'code'
  const id=NAV.stack[NAV.stack.length-1]; if(!id) return false;
  if(isDirty(id)&&reason!=='code'&&!confirm('Закрыть без сохранения?')) return false;  // HIG: warn before data loss
  NAV.stack.pop();
  sheet(id,false);
  const prev=NAV.stack[NAV.stack.length-1];
  if(prev) $(prev).classList.remove('under');       // возвращаем спрятанный
  if(reason!=='history'&&history.state&&history.state.d>NAV.stack.length){
    NAV.skipPop=1; try{ history.back(); }catch(e){} // выравниваем историю, не реагируя на свой же popstate
  }
  return true;
}

addEventListener('popstate',()=>{
  if(NAV.skipPop){ NAV.skipPop=0; return; }
  if(NAV.stack.length) navPop('history');           // Android «назад» / браузерный режим
});
```

Правила подключения:
- `data-close` → `navPop('button')`; тап по фону → `navPop('backdrop')`;
  все места, где сейчас `sheet(x,true)` для **пользовательских** листов →
  `navPush(x)`. Служебные оверлеи (пароль, онбординг) — вне стека.
- `isDirty(id)`: `input`/`change` внутри листа ставит `data-dirty="1"`,
  открытие снимает.
- На iOS `pushState` в standalone безвреден: жеста истории нет, стек
  просто зеркалится. На Android аппаратная «назад» перестаёт закрывать всё
  приложение.

### 2.2 CSS: один видимый лист и честный замок

```css
.sheet.under>.in{visibility:hidden}                 /* спрятан, не закрыт: состояние и поля целы */
.sheet.under::after{display:none}                   /* подложку рисует только верхний */
html.shlock,html.shlock body{overflow:hidden;overscroll-behavior:none}
```

```js
/* замок держится и на 180 мс ухода: картинка и состояние не расходятся */
function shlockSync(){
  document.documentElement.classList.toggle('shlock',!!document.querySelector('.sheet.on,.sheet.closing'));
}
```

Оговорка iOS: `overflow:hidden` на `html` иногда не держит резиновую
прокрутку страницы под листом. Если полевой тест покажет «дёргается фон»
— запасной приём: `body{position:fixed;top:-<scrollY>px;width:100%}` на
время замка с возвратом `scrollY` при снятии.

### 2.3 Свайп вниз — жест, который обещает грабер

```js
function sheetSwipe(inEl){
  let y0=null, dy=0;
  inEl.addEventListener('touchstart',e=>{ y0=inEl.scrollTop>0?null:e.touches[0].clientY; dy=0; },{passive:true});
  inEl.addEventListener('touchmove',e=>{
    if(y0==null) return;
    dy=e.touches[0].clientY-y0;
    if(dy>0){ e.preventDefault(); inEl.style.transform='translateY('+dy+'px)'; }   // тянем только вниз и только с верха
  },{passive:false});
  inEl.addEventListener('touchend',()=>{
    if(y0==null) return;
    inEl.style.transition='transform .18s'; inEl.style.transform='';
    setTimeout(()=>{ inEl.style.transition=''; },200);
    if(dy>110) navPop('swipe');                     // порог ~ четверть экрана 390×844 после отступов
    y0=null; dy=0;
  },{passive:true});
}
document.querySelectorAll('.sheet>.in').forEach(sheetSwipe);
```

Почему это не ломает нативные жесты: `preventDefault` только когда лист
уже на верху (`scrollTop===0`) и палец идёт вниз — внутренняя прокрутка не
задета, `overscroll-behavior:contain` остаётся. Направление совпадает с
появлением (снизу вверх → вниз), как требует `motion`.

### 2.4 Вкладки помнят прокрутку

```js
const VS={}; let curV=null;
function goView(v,scroll){
  if(curV) VS[curV]=scrollY;
  const same=(curV===v); curV=v;
  /* …существующее тело goView без scrollTo… */
  if(scroll!==false) scrollTo(0, same?0:(VS[v]||0));    // активная вкладка — наверх, чужая — где был
}
```
*Сделано в v593*, с одной поправкой: под замком листа (`html.shlock`, body
`position:fixed`, `scrollY=0`) позиция берётся из `_shY` и туда же кладётся —
снятие замка доводит её до документа.

### 2.5 Таймер под прерыванием

```js
const ka=restAud();                                    // keep-alive <audio>
ka.addEventListener('pause',()=>{ if(restEndAt&&!restPause&&!_ourPause) restKeepOn(); });
addEventListener('focus',()=>{ if(restEndAt&&!restPause) restKeepOn(); });
```
`_ourPause` ставится в `restKeepOff` перед `pause()`, чтобы своя пауза не
считалась прерыванием. Если `play()` отвергнут (iOS требует жест после
прерывания) — плашка «Нажми, чтобы вернуть сигнал» в полосе отдыха.
*Сделано в v592:* `restKeepInterrupted` (слушатель `pause`, один заход через
300 мс, не крутится при отвергнутом `play()`), `restBlocked` (класс `.mute`
на полосе, подпись «нажми — вернуть сигнал», тап по полосе = жест),
`resumeRest` и `focus` заново включают тишину и `wakeOn`.

### 2.6 Инварианты для гейта (иначе всё это протухнет)

- `smoke`: в разметке нет ни одного места, где пользовательский лист открывается мимо `navPush`; у каждого `.sheet .in` есть обработчик свайпа.
- `browser.js`: в любой момент **не больше одного** `.sheet.on:not(.under)` видимого; после `navPop` через 200 мс `html.shlock` снят, до — стоит; свайп на 120 px по `.in` при `scrollTop=0` закрывает лист, а при `scrollTop=50` — прокручивает и не закрывает; тап по фону с `data-dirty="1"` **не** закрывает без подтверждения.
- Мутации: убрать `under` → две подложки; убрать `skipPop` → двойное закрытие по одному `popstate`; убрать проверку `scrollTop` → свайп крадёт прокрутку.

## 3. Приоритеты одним списком

**Статус 14.09, v595: аудит закрыт целиком.** P1 — пункты 1, 2, 3 и замок на
`.closing` в v591 (§2.1–2.3), пункт 4 (звонок, §2.5) в v592; P2 — память
прокрутки вкладок (§2.4) в v593, открытый лист при смене дня в v594; P3 — ×
на ведущем краю и портрет как записанное решение в v595.


1. **P1** Стек листов с одним видимым (§2.1–2.2) — прямое нарушение HIG, три листа на «Зале».
2. **P1** Свайп вниз (§2.3) — грабер обещает жест, которого нет.
3. **P1** Подтверждение при закрытии с набранным текстом — потеря данных одним промахом.
4. **P1** Перезапуск keep-alive после звонка (§2.5) — единственная дыра таймера. *Проверить на телефоне.*
5. **P2** Замок на время `.closing`; память прокрутки вкладок; перерисовка листа при смене дня.
6. **P3** Положение × (справа вместо ведущего края); portrait-lock записать как осознанное решение.

Что **не** является багом, хотя выглядит подозрительно: отсутствие истории
браузера. На iPhone в standalone нет ни кнопки «назад», ни жеста истории, а
единственный источник состояния — DOM. Рассинхрон «истории и CSS», которого
опасался владелец, невозможен по построению; он появится ровно в момент,
когда мы заведём `pushState` без единого места истины. Поэтому §2.1 вводит
историю **только как зеркало стека**, а не как второй хозяин.
