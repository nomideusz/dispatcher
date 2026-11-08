import pandas as pd,numpy as np,json,re
df=pd.read_pickle('final.pkl')
SJ=json.load(open('../search.json'));K={k['query']:k for k in SJ['keywords']};curve={c['position']:c['share'] for c in SJ['curve']}
df['tier2']=np.where(df.code_exact==1,0,df.tier)
band=lambda h: 0 if h==100 else (1 if (h==h and h>=70) else (2 if h!=h else 3))
df['band']=[band(h) for h in df.health]
def conc(sub,key):
    a=t=0
    for q,g in sub.groupby('q'):
        v=[key(r) for r in g.sort_values('pos').itertuples()]
        for i in range(len(v)):
            for j in range(i+1,len(v)):
                if v[i]==v[j]: continue
                t+=1;a+=v[i]<v[j]
    return round(a/t,3),t
print('rule (tier, band, -active) all:',conc(df,lambda r:(r.tier2,r.band,-r.active)))
print('rule within top tiers 0-1:',conc(df[df.tier2<=1],lambda r:(r.tier2,r.band,-r.active)))
print('rule within top tier 0:',conc(df[df.tier2==0],lambda r:(r.band,-r.active)))
# top-1 prediction accuracy: predicted #1 = min key
hit=n=0;hit4=0
for q,g in df.groupby('q'):
    if len(g)<4: continue
    k=g.assign(key=[(r.tier2,r.band,-r.active) for r in g.itertuples()]).sort_values('key')
    n+=1; hit+= k.iloc[0].pos==1; hit4+= len(set(k.head(4).id)&set(g[g.pos<=4].id))/4
print('predicted #1 correct',round(hit/n,3),'top-4 overlap',round(hit4/n,3),'queries',n)
top=df[df.pos<=4].copy(); top['w']=[K.get(q,{}).get('demand',0)*curve.get(p,0) for q,p in zip(top.q,top.pos)]
print(top.groupby('tier2').w.sum().pipe(lambda s:(s/s.sum()).round(3)))
print(top.groupby('band').w.sum().pipe(lambda s:(s/s.sum()).round(3)))
print('#1 by band',df[df.pos==1].band.value_counts(normalize=True).sort_index().round(3).to_dict())
print('#1 by tier2',df[df.pos==1].tier2.value_counts(normalize=True).sort_index().round(3).to_dict())
# how many keywords have >=4 tier0 entries with health 100 (crowded)
g=df[df.tier2==0].groupby('q').agg(n0=('id','size'),n100=('band',lambda s:(s==0).sum()))
print('keywords with a tier-0 entry',len(g),'with >=4 at 100',(g.n100>=4).sum(),'median tier0 size',g.n0.median())
df.to_pickle('final2.pkl')
