import pandas as pd,numpy as np
df=pd.read_pickle('final.pkl')
band=lambda h: 0 if h==100 else (1 if (h!=h or h>=70) else 2)
df['band']=[band(h) for h in df.health]
def conc(sub,key,label):
    a=t=0
    for q,g in sub.groupby('q'):
        v=[key(r) for r in g.sort_values('pos').itertuples()]
        for i in range(len(v)):
            for j in range(i+1,len(v)):
                if v[i]==v[j]: continue
                t+=1;a+=v[i]<v[j]
    print(f'{label:55} {a/max(t,1):.3f} ({t})')
for tr in range(6):
    s=df[df.tier==tr]
    conc(s,lambda r:(r.band,),f'tier {tr}: band')
    conc(s[s.band==1],lambda r:(r.hnull,),f'tier {tr}: in 70-99/null band, scored before null')
    conc(s[s.band==1],lambda r:(-(r.health if r.health==r.health else 0),),f'tier {tr}: in band1 health desc (null=0)')
    conc(s[s.band==0],lambda r:(-r.active,),f'tier {tr}: in band 100 active desc')
    conc(s[s.band==0],lambda r:(-r.age,),f'tier {tr}: in band 100 older first')
conc(df,lambda r:(r.tier,r.band),'all: tier, band')
conc(df,lambda r:(r.band,r.tier),'all: band, tier')
