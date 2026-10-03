// Собирает чистый output-каталог dist/ только из публичных файлов приложения.
// Запускается ТОЛЬКО после успешного smoke-теста (см. buildCommand).
const fs=require("fs");const path=require("path");
const ROOT=path.resolve(__dirname,"..");const OUT=path.join(ROOT,"dist");
fs.rmSync(OUT,{recursive:true,force:true});fs.mkdirSync(OUT,{recursive:true});
["index.html","sw.js","manifest.json","icon.svg","verifyadmitad.txt"].forEach(f=>{
  fs.copyFileSync(path.join(ROOT,f),path.join(OUT,f));
});
// Шрифты (Manrope) — обязательны для типографики, PWA кэширует их офлайн
fs.mkdirSync(path.join(OUT,"fonts"),{recursive:true});
const fontDir=path.join(ROOT,"fonts");
const fonts=fs.existsSync(fontDir)?fs.readdirSync(fontDir).filter(f=>f.endsWith(".woff2")):[];
if(!fonts.length){ console.error("  ✗ fonts/*.woff2 не найдены — типографика сломается"); process.exit(1); }
fonts.forEach(f=>fs.copyFileSync(path.join(fontDir,f),path.join(OUT,"fonts",f)));
// Промо-студия и ролик: нужны с телефона по обычной ссылке, а не как исходник на GitHub.
// Шрифты берут по ../fonts/ — из /promo/ это ровно тот каталог, что скопирован выше.
// Иконки PNG: iOS не понимает SVG в apple-touch-icon — без них экран «Домой» показывает скриншот
const icoDir=path.join(ROOT,"icons");
if(fs.existsSync(icoDir)){
  fs.mkdirSync(path.join(OUT,"icons"),{recursive:true});
  fs.readdirSync(icoDir).filter(f=>f.endsWith(".png")).forEach(f=>fs.copyFileSync(path.join(icoDir,f),path.join(OUT,"icons",f)));
}
// Скрипт VPN владельца — на сайт: VNC-консоль хостера калечит длинные
// вставки, сервер скачивает файл с нашего же домена (секретов в нём нет)
["vpn.sh","vpn443.sh","vpnws.sh","vpnadd.sh"].forEach(f=>{
  const p=path.join(ROOT,"server",f);
  if(fs.existsSync(p)) fs.copyFileSync(p,path.join(OUT,f));
});
const promoDir=path.join(ROOT,"promo");
let promo=[];
if(fs.existsSync(promoDir)){
  promo=fs.readdirSync(promoDir).filter(f=>f.endsWith(".html"));
  if(promo.length){
    fs.mkdirSync(path.join(OUT,"promo"),{recursive:true});
    promo.forEach(f=>fs.copyFileSync(path.join(promoDir,f),path.join(OUT,"promo",f)));
  }
}
console.log("  ✓ dist собран: index.html, sw.js, manifest.json, icon.svg, fonts("+fonts.length+"), promo("+promo.length+")");
