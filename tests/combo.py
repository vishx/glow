import sys
from PIL import Image
out=sys.argv[1]; fs=sys.argv[2:]
ims=[Image.open(f) for f in fs]; sc=2
h=max(i.height//sc for i in ims); w=sum(i.width//sc for i in ims)+10*len(ims)
c=Image.new('RGB',(w,h),'white'); x=0
for i in ims: c.paste(i.resize((i.width//sc,i.height//sc)),(x,0)); x+=i.width//sc+10
c.save(out)
