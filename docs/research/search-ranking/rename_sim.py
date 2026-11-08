import pandas as pd,numpy as np,json,re
pd.set_option('display.width',250);pd.set_option('display.max_colwidth',60)
df=pd.read_pickle('final2.pkl')
SJ=json.load(open('../search.json'));K={k['query']:k for k in SJ['keywords']};curve={c['position']:c['share'] for c in SJ['curve']}
sh=lambda p: curve.get(int(p),0) if p<=20 else 0
T=lambda s: re.findall(r'[a-z0-9]+',(s or '').lower())
def tier_of(name,code,q,desc_all):
    N=T(name);Q=T(q);C=T(code.replace('-',' '))
    if N==Q or C==Q: return 0
    if N[:len(Q)]==Q: return 1
    if all(x in N for x in Q): return 2
    if all(any(t.startswith(x) for t in N) for x in Q): return 3
    if desc_all: return 4
    return 5
def short(n): return re.split(r'\s+[|—–]\s+|\s+-\s+|\s*\(|\s*\[',n)[0].strip()
ours=df[df.ours]
res=[]
for tid,g in ours.groupby('id'):
    name=g.iloc[0]['name']; code=g.iloc[0]['code']; cand=short(name)
    if cand==name: continue
    tot=0;det=[]
    for r in g.itertuples():
        dem=K.get(r.q,{}).get('demand',0)
        if dem==0: continue
        allq=all(any(t.startswith(x) for t in T(name)+T(code.replace('-',' '))+T(__import__('json').dumps(''))) for x in T(r.q))
        nt=tier_of(cand,code,r.q,r.all_any)
        oth=df[(df.q==r.q)&(df.id!=tid)]
        k=(nt,r.band,-r.active); np_=1+sum((o.tier2,o.band,-o.active)<k for o in oth.itertuples())
        kc=(r.tier2,r.band,-r.active); cp=1+sum((o.tier2,o.band,-o.active)<kc for o in oth.itertuples())
        d=round(dem*(sh(np_)-sh(cp))); tot+=d
        if d: det.append(f'{r.q}: {cp}->{np_} ({d:+d})')
    res.append(dict(name=name[:50],cand=cand,net=tot,detail='; '.join(det[:6])))
r=pd.DataFrame(res).sort_values('net',ascending=False)
print(r.head(15).to_string(index=False)); print(r.tail(8).to_string(index=False))
r.to_pickle('rename.pkl')
