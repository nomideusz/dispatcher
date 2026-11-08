import duckdb,pandas as pd,numpy as np,statsmodels.formula.api as smf
c=duckdb.connect('db/d.duckdb',read_only=True)
p=c.sql("""
with r as (select sampled_at, sampled_at::date d, query, template_id, position from search_ranks),
s as (select template_id, sampled_at, health, active_projects, projects from template_snapshots)
select r.*, (select health from s where s.template_id=r.template_id and s.sampled_at<=r.sampled_at order by s.sampled_at desc limit 1) health,
 (select active_projects from s where s.template_id=r.template_id and s.sampled_at<=r.sampled_at order by s.sampled_at desc limit 1) active
from r where r.template_id in (select distinct template_id from template_snapshots)
""").df()
print(len(p), p.template_id.nunique(), p['query'].nunique())
p['hnull']=p.health.isna().astype(int); p['h']=p.health.fillna(0)
p['key']=p['query']+'|'+p.template_id
# keep keys with variation in health
v=p.groupby('key').agg(hs=('h','std'),ns=('hnull','std'),n=('h','size'))
keep=v[(v.n>=5)&((v.hs>0)|(v.ns>0))].index
q=p[p.key.isin(keep)].copy(); q['la']=np.log1p(q.active.fillna(0))
print('keys with health change',len(keep),'rows',len(q))
m=smf.ols('position ~ h + hnull + la + C(key) + C(d)',data=q).fit(cov_type='cluster',cov_kwds={'groups':q.template_id})
print(m.params[['h','hnull','la']], m.bse[['h','hnull','la']])
# per 10 points
print('position change per +10 health:',round(10*m.params['h'],2),'±',round(10*m.bse['h'],2))
# event study: big health moves
p.to_pickle('panel.pkl')
