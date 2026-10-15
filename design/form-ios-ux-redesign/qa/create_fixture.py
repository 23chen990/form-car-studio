from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
out=Path(__file__).parent
for name,tone in [('fixture_local_car.png',(205,110,65)),('fixture_second_car.png',(73,134,184))]:
 im=Image.new('RGB',(920,540),(42,60,66));d=ImageDraw.Draw(im)
 for y in range(540):
  d.line((0,y,919,y),fill=(max(3,42-y//30),max(8,60-y//30),max(9,66-y//30)),width=1)
 d.ellipse((80,385,840,475),fill=(16,23,24))
 d.polygon([(110,330),(170,268),(285,238),(361,162),(579,159),(691,253),(789,287),(822,356),(793,381),(150,381)],fill=tone,outline=(220,228,221),width=6)
 d.polygon([(305,245),(377,177),(564,179),(646,254)],fill=(55,97,112),outline=(198,209,216),width=5)
 d.line((477,181,477,250),fill=(210,211,214),width=5)
 for x in [277,686]:
  d.ellipse((x-62,337,x+62,461),fill=(17,25,27),outline=(180,190,194),width=6)
  d.ellipse((x-35,364,x+35,434),fill=(110,121,130),outline=(211,219,218),width=4)
  d.ellipse((x-11,388,x+11,410),fill=(35,42,44))
 try:f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',24)
 except:f=ImageFont.load_default()
 d.text((35,26),'QA FIXTURE / ORIGINAL CAR ILLUSTRATION',font=f,fill=(246,247,239))
 d.text((34,493),'LOCALLY SELECTED IMAGE - NOT AI GENERATED',font=f,fill=(219,234,195))
 im.save(out/name)
 print(out/name)