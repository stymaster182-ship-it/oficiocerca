# Fondo propio: plano arquitectónico técnico (planta + cotas + rejilla), discreto, para el hero.
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
OUT = Path(__file__).resolve().parent.parent / 'assets/img'
import math, random
random.seed(7)
W,H=3200,1800
img=Image.new('RGB',(W,H),(16,30,50))
ov=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(ov)
C=(200,220,245)
def ln(a,b,w=2,al=70): d.line([a,b],fill=C+(al,),width=w)
# rejilla fina
for x in range(0,W,80): ln((x,0),(x,H),1,18)
for y in range(0,H,80): ln((0,y),(W,y),1,18)
# planta de vivienda (muros dobles)
ox,oy=1500,260
rooms=[(0,0,900,620),(900,0,1500,380),(900,380,1500,620),(0,620,560,1120),(560,620,1500,1120)]
for x0,y0,x1,y1 in rooms:
    d.rectangle([ox+x0,oy+y0,ox+x1,oy+y1],outline=C+(120,),width=6)
d.rectangle([ox-14,oy-14,ox+1514,oy+1134],outline=C+(140,),width=10)
# puertas (arcos)
for (px,py,r,s) in [(ox+900,oy+120,110,90),(ox+560,oy+760,100,0),(ox+1100,oy+620,110,180),(ox+300,oy+620,100,270)]:
    d.arc([px-r,py-r,px+r,py+r],s,s+90,fill=C+(110,),width=3)
# ventanas
for x in range(ox+120,ox+1400,260): d.rectangle([x,oy-20,x+140,oy-6],outline=C+(130,),width=3)
# escalera
for i in range(12): ln((ox+620+i*28,oy+660),(ox+620+i*28,oy+840),2,90)
# cotas
def cota(a,b,off,txtlen=60):
    (x0,y0),(x1,y1)=a,b
    if y0==y1:
        ln((x0,y0-off),(x1,y1-off),2,100); ln((x0,y0-off-20),(x0,y0-off+20),2,100); ln((x1,y0-off-20),(x1,y0-off+20),2,100)
        mx=(x0+x1)//2; d.rectangle([mx-txtlen,y0-off-34,mx+txtlen,y0-off-14],fill=C+(60,))
    else:
        ln((x0-off,y0),(x1-off,y1),2,100); ln((x0-off-20,y0),(x0-off+20,y0),2,100); ln((x0-off-20,y1),(x0-off+20,y1),2,100)
cota((ox,oy-14),(ox+900,oy-14),70); cota((ox+900,oy-14),(ox+1500,oy-14),70); cota((ox-14,oy),(ox-14,oy+1120),90)
# alzado/sección a la izquierda
bx,by=180,1500
ln((bx,by),(bx+1150,by),4,110)
for i,(w,h) in enumerate([(300,520),(260,700),(330,610)]):
    x=bx+40+sum([300,260,330][:i])+i*40
    d.rectangle([x,by-h,x+w,by],outline=C+(95,),width=4)
    for fy in range(by-h+60,by-60,120):
        for fx in range(x+40,x+w-60,90): d.rectangle([fx,fy,fx+50,fy+70],outline=C+(70,),width=2)
# círculos de referencia / ejes
for i,x in enumerate(range(ox,ox+1600,375)):
    ln((x,oy+1180),(x,oy+1260),2,90); d.ellipse([x-28,oy+1260,x+28,oy+1316],outline=C+(110,),width=3)
img=Image.alpha_composite(img.convert('RGBA'),ov).convert('RGB').filter(ImageFilter.GaussianBlur(1.2))
# viñeta
vg=Image.new('L',(W,H),0); vd=ImageDraw.Draw(vg)
for i in range(60):
    vd.ellipse([-W*0.2+i*25,-H*0.3+i*14,W*1.2-i*25,H*1.3-i*14],fill=int(i*4))
img=Image.composite(img,Image.new('RGB',(W,H),(12,22,38)),vg.filter(ImageFilter.GaussianBlur(80)))
for w in (1600,800):
    im=img.resize((w,int(H*w/W)),Image.LANCZOS)
    im.save(OUT / f'hero-obra-{w}.webp', 'WEBP', quality=70, method=6)
print('ok')
