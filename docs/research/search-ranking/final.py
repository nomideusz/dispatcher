import json,re,collections,pickle
import pandas as pd,numpy as np
import statsmodels.api as sm
pd.set_option('display.width',200); pd.set_option('display.max_columns',30)
df=pd.read_pickle('pairs.pkl')
M={t['id']:t for t in json.load(open('market.json'))}
SJ=json.load(open('../search.json'))
demand={k['query']:k['demand'] for k in SJ['keywords']}
curve={c['position']:c['share'] for c in SJ['curve']}
# creator reputation
cr=collections.defaultdict(lambda:[0,0,0])
for t in M.values():
    n=(t.get('creator') or {}).get('name') or '?'; cr[n][0]+=1; cr[n][1]+=t['activeProjects'] or 0; cr[n][2]+=int(bool(t['isVerified']))
df['cr_templates']=[cr[c or '?'][0] for c in df.creator]; df['cr_active']=[cr[c or '?'][1] for c in df.creator]
T=lambda s: re.findall(r'[a-z0-9]+',(s or '').lower())
def tier(r):
    if r.name_exact: return 0
    if r.name_starts: return 1
    if r.name_w==r.nq: return 2
    if r.name_p==r.nq: return 3
    if r.all_any: return 4
    return 5
df['tier']=[tier(r) for r in df.itertuples()]
TN={0:'name is the query',1:'name starts with it',2:'name contains the words',3:'name has word prefixes',4:'matched via code/description',5:'partial match (fallback)'}
df['hb']=np.select([df.health>=90,df.health>=70,df.health.isna()],['90-100','70-89','none'],'<70')
df['ours']=[ (t:=M[i]) and False for i in df.id]
# our ids from DB
import duckdb
c=duckdb.connect('db/d.duckdb',read_only=True)
ours=set(x[0] for x in c.sql("select distinct template_id from template_snapshots").fetchall())
df['ours']=df.id.isin(ours)
out={}
# 1 tier monotonicity
inv=tot=0
for q,g in df.groupby('q'):
    t=g.sort_values('pos').tier.to_numpy()
    for i in range(len(t)):
        d=t[i+1:]-t[i]; tot+=np.count_nonzero(d); inv+=np.count_nonzero(d<0)
out['tier_inversion']=inv/tot
print('tier inversions',round(inv/tot,3),'of',tot)
print(df.groupby('tier').agg(rows=('pos','size'),median_pos=('pos','median'),top4=('pos',lambda s:(s<=4).mean())))
# share of top-4 slots by tier, weighted by demand
top=df[df.pos<=4].copy(); top['w']=[demand.get(q,0)*curve.get(p,0) for q,p in zip(top.q,top.pos)]
print('top4 slots by tier (count, deploy-weighted share)'); print(top.groupby('tier').agg(n=('pos','size'),w=('w','sum')).assign(ws=lambda x:x.w/x.w.sum()))
print('#1 by tier'); print(df[df.pos==1].tier.value_counts(normalize=True).sort_index())
print('top4 by health band'); print(top.groupby('hb').agg(n=('pos','size'),w=('w','sum')).assign(ws=lambda x:x.w/x.w.sum()))
# 2 within-tier pairwise effects
F=['h100','h90','h70','hnull','lact','lage','extra','name_chars','code_exact','d_tfw','c_tf','verified','partner','lreadme','ldesc','lcr_t','lcr_a','has_image']
df['h']=df.health.fillna(0)/10
df['h100']=(df.health==100).astype(int); df['h90']=((df.health>=90)&(df.health<100)).astype(int); df['h70']=((df.health>=70)&(df.health<90)).astype(int)
df['hnull']=df.health.isna().astype(int)
df['lact']=np.log2(1+df.active); df['lage']=np.log2(1+df.age.clip(0)); df['lreadme']=np.log2(1+df.readme_len); df['ldesc']=np.log2(1+df.desc_len)
df['lcr_t']=np.log2(1+df.cr_templates); df['lcr_a']=np.log2(1+df.cr_active)
X=[];y=[]
for (q,t),g in df.groupby(['q','tier']):
    v=g.sort_values('pos')[F].to_numpy(float)
    for i in range(len(v)):
        for j in range(i+1,len(v)):
            X.append(v[i]-v[j]);y.append(1);X.append(v[j]-v[i]);y.append(0)
X=np.array(X);y=np.array(y)
m=sm.Logit(y,X).fit(disp=0)
res=pd.DataFrame({'coef':m.params,'se':m.bse,'odds':np.exp(m.params)},index=F)
print('within-tier pairwise logit (baseline health <70), pairs',len(y)//2); print(res.round(3))
acc=((m.predict(X)>0.5)==y).mean(); print('acc',round(acc,3))
df.to_pickle('final.pkl'); res.to_pickle('within.pkl')
