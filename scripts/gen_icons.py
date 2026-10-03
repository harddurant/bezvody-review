#!/usr/bin/env python3
# Генерация PNG-иконок из фирменного знака (пульс-линия) без зависимостей.
# Зачем PNG, когда есть icon.svg: iOS не понимает SVG в apple-touch-icon —
# без PNG на экране «Домой» появляется скриншот страницы вместо иконки.
# Запуск: python3 scripts/gen_icons.py  → пишет icons/*.png
import zlib, struct, os, math

# Знак в координатах viewBox 512×512 — тот же путь, что в icon.svg
PTS = [(92,322),(172,322),(212,216),(262,372),(302,254),(334,296),(420,296)]
STROKE = 42.0
DOT = ((420,296), 25.0)
BG = (14,17,24)          # #0e1118
C1 = (158,220,28)        # #9edc1c — низ-лево градиента
C2 = (214,255,98)        # #d6ff62 — верх-право

def seg_dist(px,py,ax,ay,bx,by):
    vx,vy = bx-ax, by-ay
    L2 = vx*vx+vy*vy
    t = 0 if L2==0 else max(0,min(1,((px-ax)*vx+(py-ay)*vy)/L2))
    dx,dy = px-(ax+t*vx), py-(ay+t*vy)
    return math.hypot(dx,dy)

def render(size):
    img = bytearray()
    k = size/512.0
    pts = [(x*k,y*k) for x,y in PTS]
    hw = STROKE*k/2.0
    (dx0,dy0),dr = DOT
    dx0,dy0,dr = dx0*k,dy0*k,DOT[1]*k
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # расстояние до ломаной и до точки
            d = min(seg_dist(x+0.5,y+0.5,ax,ay,bx,by)
                    for (ax,ay),(bx,by) in zip(pts,pts[1:]))
            d = min(d, math.hypot(x+0.5-dx0, y+0.5-dy0) - (dr-hw))
            a = max(0.0, min(1.0, hw + 0.7 - d))          # мягкий край
            if a <= 0:
                row += bytes(BG)
            else:
                t = ((x/size)+(1-y/size))/2               # диагональный градиент
                cr = C1[0]+(C2[0]-C1[0])*t
                cg = C1[1]+(C2[1]-C1[1])*t
                cb = C1[2]+(C2[2]-C1[2])*t
                row += bytes((round(BG[0]+(cr-BG[0])*a),
                              round(BG[1]+(cg-BG[1])*a),
                              round(BG[2]+(cb-BG[2])*a)))
        img += b'\x00'+row                                # PNG filter 0
    return bytes(img)

def png(size, raw):
    def chunk(tag, data):
        c = tag+data
        return struct.pack('>I',len(data))+c+struct.pack('>I',zlib.crc32(c))
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)   # 8-bit RGB
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',ihdr)
            + chunk(b'IDAT', zlib.compress(raw,9)) + chunk(b'IEND',b''))

os.makedirs('icons', exist_ok=True)
for size, name in [(180,'apple-touch-icon.png'),(192,'icon-192.png'),(512,'icon-512.png')]:
    open(os.path.join('icons',name),'wb').write(png(size, render(size)))
    print(f'  ✓ icons/{name} ({size}×{size})')
