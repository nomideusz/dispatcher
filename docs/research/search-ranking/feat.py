import json,re,math
import pandas as pd, numpy as np
M={t['id']:t for t in json.load(open('market.json'))}
S=json.load(open('serp.json'))
T=lambda s: re.findall(r'[a-z0-9]+',(s or '').lower())
def mt(q,toks):
    w=sum(any(x==t for t in toks) for x in q); p=sum(any(t.startswith(x) for t in toks) for x in q); return w,p
rows=[]
now=pd.Timestamp('2026-11-08',tz='UTC')
for q,res in S.items():
    Q=T(q)
    for i,n in enumerate(res,1):
        t=M.get(n['id']);
        if not t: continue
        N=T(t['name']); C=T((t['code'] or '').replace('-',' ')); D=T(t['description'])
        nw,np_=mt(Q,N); cw,cp=mt(Q,C); dw,dp=mt(Q,D)
        cr=t.get('creator') or {}; mn=t.get('maintainer') or {}
        rows.append(dict(q=q,pos=i,n=len(res),id=t['id'],name=t['name'],code=t['code'],nq=len(Q),
          name_exact=int(N==Q), name_starts=int(N[:len(Q)]==Q), name_phrase=int(' '.join(Q) in ' '.join(N)),
          name_w=nw,name_p=np_,code_exact=int(C==Q),code_w=cw,code_p=cp,desc_w=dw,desc_p=dp,
          name_len=len(N),name_chars=len(t['name']),extra=len(N)-nw,
          health=t['health'],h_null=int(t['health'] is None),
          projects=t['projects'] or 0,recent=t['recentProjects'] or 0,active=t['activeProjects'] or 0,
          verified=int(bool(t['isVerified'])),approved=int(bool(t['isApproved'])),partner=int(bool(mn and mn.get('partnerProfile'))),
          public=int(bool(cr.get('hasPublicProfile'))),has_user=int(bool(cr.get('username'))),
          readme_len=len(t['readme'] or ''),desc_len=len(t['description'] or ''),has_image=int(bool(t['image'])),
          tags=len(t['tags'] or []) if isinstance(t['tags'],list) else 0,
          age=(now-pd.Timestamp(t['createdAt'])).days, upd=(now-pd.Timestamp(t['updatedAt'])).days,
          payout=t.get('totalPayout') or 0, creator=cr.get('name'), cat=t['category']))
df=pd.DataFrame(rows); df.to_pickle('pairs.pkl'); print(df.shape, df.q.nunique())
# term frequencies (prefix matches) per field
def tf(Q,toks): return sum(1 for t in toks for x in Q if t.startswith(x))
def tfw(Q,toks): return sum(1 for t in toks for x in Q if t==x)
ext=[]
for r in df.itertuples():
    t=M[r.id]; Q=T(r.q); N=T(t['name']); C=T((t['code'] or '').replace('-',' ')); D=T(t['description'])
    ext.append(dict(n_tf=tf(Q,N),c_tf=tf(Q,C),d_tf=tf(Q,D),n_tfw=tfw(Q,N),c_tfw=tfw(Q,C),d_tfw=tfw(Q,D),n_len=len(N),c_len=len(C),d_len=len(D),
       all_any=int(all(any(tt.startswith(x) for tt in N+C+D) for x in Q))))
df=pd.concat([df,pd.DataFrame(ext,index=df.index)],axis=1); df.to_pickle('pairs.pkl'); print('ext ok')
