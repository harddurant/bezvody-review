/* МАТРИЦА СБОРОК — ХРАПОВИК ВЫХОДА ГЕНЕРАТОРА (27.09, правило владельца:
   «всё, что можно сделать на этапе первой постройки, должно быть правилом»).
   Генератор программ правили больше десяти версий, и каждый раз выход
   мерили руками — или не мерили. Здесь та же матрица, что в PROGRAM_AUDIT.md
   §2 (2–6 дней × зал/гантели/свой вес × 3 цели × новичок/опыт × 50/80 мин,
   180 сборок), считается за секунды и стоит в деплой-гейте.
   Абсолютные запреты (0 всегда): день дольше бюджета +10 %, движений больше
   потолка, группа ниже минимума роста без сводки «на поддержании»,
   обещание сводки, которое не сбывается в настоящей сборке.
   Храповик (не хуже tests/matrix.baseline.json): программ с группой ниже
   минимума роста, выше MRV, дней без базы, групп реже двух раз в неделю.
   Стало лучше — обнови baseline В ТОМ ЖЕ коммите: `node tests/matrix.js --baseline`.
   Стало хуже — красный гейт: это и есть «нашли до пуша, а не в поле». */
const fs=require("fs"),path=require("path");
const ROOT=path.join(__dirname,"..");
const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
let js=html.slice(html.lastIndexOf("<script>")+8,html.lastIndexOf("</script>"));
js=js.replace(/\(async\(\)=>\{[\s\S]*\}\)\(\);\s*$/,"").replace("const td=","let td=");
const {webcrypto}=require("crypto");
const pre=fs.readFileSync(path.join(ROOT,"tests/field.js"),"utf8").split("\n").slice(14,29).join("\n");
eval(pre);
const scenario=`
;const R=[];
S.pain={}; S.gymOff={}; S.less=[]; S.skip=[]; S.hasBand=0; S.injOK={}; S.homePull=true; S.effort='growth'; S.accent='';
SETS=[]; SESS=[]; W=[{d:td(),kg:90}];
for(const days of [2,3,4,5,6]) for(const equip of ['gym','db','bw']) for(const goal of ['hyper','strength','recomp']) for(const exp of ['nov','mid']) for(const mins of [50,80]){
  const P=genProgram({days,equip,goal,exp,inj:[],mins,dows:(function(){const a=[];for(let i=1;i<=days;i++)a.push(i);return a;})()});
  const v=progVolume(P), freq={}; Object.keys(MUS).forEach(m=>freq[m]=0);
  P.plan.forEach(d=>{ const seen=new Set(); d.ex.filter(i=>!i.hidden).forEach(it=>{ const e=EX.find(x=>x.n===it.n); if(!e) return; Object.entries(e.m||{}).forEach(([m,w])=>{ if(w>=0.5) seen.add(m); }); }); seen.forEach(m=>freq[m]++); });
  const low=Object.keys(MUS).filter(m=>mevFor(m,P.cfg)>0&&v[m]<mevFor(m,P.cfg)-0.01);
  const above=Object.keys(MUS).filter(m=>v[m]>LM[m][3]+0.01);
  const lowFreq=Object.keys(MUS).filter(m=>v[m]>=mevFor(m,P.cfg)&&freq[m]<2&&days>=3&&m!=='abs'&&m!=='calves');
  const cap=dayCapEx(P);
  const overBud=P.plan.filter(d=>dayMinutes(d,P)>mins*1.1).length;
  const overCap=P.plan.filter(d=>d.ex.filter(i=>!i.hidden).length>cap).length;
  const noMain=P.plan.filter(d=>!d.ex.some(i=>!i.hidden&&i.main)).length;
  const s=progSummary(P); const silent=low.filter(m=>!(s&&s.low.includes(m))).length;
  let broken=0; (s&&s.alts||[]).forEach(a=>{ const c2={...P.cfg,...a.patch}; delete c2.dows; const v2=progVolume(genProgram(c2)); a.fixed.forEach(m=>{ if(!(v2[m]>=mevFor(m,c2)-0.01)) broken++; }); });
  R.push({k:days+'d '+equip+' '+goal+' '+exp+' '+mins+'m',low:low.length,above:above.length,lowFreq:lowFreq.length,overBud,overCap,noMain,silent,broken,equip});
}
globalThis.__out=R;
`;
const t0=Date.now();
try{ new Function(js+scenario)(); }catch(e){ console.error(" ✗ МАТРИЦА: сбой сборки — "+e.message); process.exit(1); }
const R=globalThis.__out;
const sum=(f)=>R.reduce((a,r)=>a+f(r),0);
const cur={
  programs:R.length,
  belowMEV:R.filter(r=>r.low).length,
  overMRV:R.filter(r=>r.above).length,
  noMainDaysIron:sum(r=>r.equip==='bw'?0:r.noMain),
  noMainDaysBW:sum(r=>r.equip==='bw'?r.noMain:0),
  lowFreq:R.filter(r=>r.lowFreq).length,
};
const hard={overBudgetDays:sum(r=>r.overBud),overCapDays:sum(r=>r.overCap),silent:sum(r=>r.silent),brokenClaims:sum(r=>r.broken)};
const bp=path.join(__dirname,"matrix.baseline.json");
if(process.argv.includes("--baseline")){ fs.writeFileSync(bp,JSON.stringify(cur,null,1)+"\n"); console.log(" ✓ baseline записан: "+JSON.stringify(cur)); process.exit(0); }
const bad=[];
Object.keys(hard).forEach(k=>{ if(hard[k]>0) bad.push(k+"="+hard[k]+" (должно быть 0)"); });
let base=null; try{ base=JSON.parse(fs.readFileSync(bp,"utf8")); }catch(e){ bad.push("нет tests/matrix.baseline.json — запиши: node tests/matrix.js --baseline"); }
const better=[];
if(base){ ["belowMEV","overMRV","noMainDaysIron","noMainDaysBW","lowFreq"].forEach(k=>{
  if(cur[k]>base[k]) bad.push(k+": "+cur[k]+" при храповике "+base[k]);
  else if(cur[k]<base[k]) better.push(k+": "+base[k]+" → "+cur[k]);
}); if(cur.programs!==base.programs) bad.push("матрица другого размера: "+cur.programs+" против "+base.programs); }
console.log(" матрица: "+cur.programs+" сборок за "+(Date.now()-t0)+" мс · ниже минимума роста "+cur.belowMEV+" · выше MRV "+cur.overMRV+" · дней без базы (железо/свой вес) "+cur.noMainDaysIron+"/"+cur.noMainDaysBW+" · реже 2 раз "+cur.lowFreq+" · дольше бюджета "+hard.overBudgetDays+" · за потолком "+hard.overCapDays+" · молчащих сводок "+hard.silent+" · несбывшихся обещаний "+hard.brokenClaims);
if(better.length) console.log(" ↑ стало лучше — обнови храповик в этом же коммите (node tests/matrix.js --baseline): "+better.join(", "));
if(bad.length){ bad.forEach(x=>console.error(" ✗ МАТРИЦА: "+x)); console.error(" ✗ МАТРИЦА: выход генератора хуже записанного — деплой остановлен"); process.exit(1); }
console.log(" ✓ Матрица сборок в норме");
