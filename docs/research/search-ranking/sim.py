import pandas as pd,numpy as np,json
pd.set_option('display.width',250);pd.set_option('display.max_rows',100)
df=pd.read_pickle('final2.pkl')
SJ=json.load(open('../search.json'));K={k['query']:k for k in SJ['keywords']};curve={c['position']:c['share'] for c in SJ['curve']}
sh=lambda p: curve.get(int(p),0) if p<=20 else 0
key=lambda tier,band,act:(tier,band,-act)
rows=[]
for q,g in df.groupby('q'):
    dem=K.get(q,{}).get('demand',0); o=g[g.ours]
    if o.empty or dem<50: continue
    b=o.sort_values('pos').iloc[0]
    if b.pos==1: 
        rows.append(dict(q=q,demand=dem,pos=1,name=b['name'][:34],tier=b.tier2,health=b.health,fix='hold',p100=1,pname=1,pboth=1,g100=0,gname=0,gboth=0));continue
    oth=g[g.id!=b.id]
    def newpos(tier,band,act):
        k=key(tier,band,act); return 1+sum(key(r.tier2,r.band,r.active)<k for r in oth.itertuples())
    cur=newpos(b.tier2,b.band,b.active)
    p100=min(b.pos,newpos(b.tier2,0,b.active)) if b.band!=0 else b.pos
    pname=min(b.pos,newpos(0,b.band,b.active)) if b.tier2!=0 else b.pos
    pboth=min(b.pos,newpos(0,0,b.active))
    g=lambda p: round(dem*(sh(p)-sh(b.pos)))
    fix='health→100' if g(p100)>=g(pname) and g(p100)>0 else ('exact name/slug' if g(pname)>0 else ('both' if g(pboth)>0 else 'deploys/age'))
    rows.append(dict(q=q,demand=dem,pos=int(b.pos),name=b['name'][:34],tier=int(b.tier2),health=b.health,fix=fix,p100=p100,pname=pname,pboth=pboth,g100=g(p100),gname=g(pname),gboth=g(pboth)))
r=pd.DataFrame(rows)
# keywords sharing demand (same result set) — keep the largest-demand phrasing per our template+demand
r=r.sort_values('gboth',ascending=False).drop_duplicates(subset=['demand','name'])
r.to_pickle('sim.pkl'); r.to_csv('sim.csv',index=False)
print(r.groupby('fix').agg(n=('q','size'),g100=('g100','sum'),gname=('gname','sum'),gboth=('gboth','sum')))
print(r[r.pos>1].head(40).to_string(index=False))
