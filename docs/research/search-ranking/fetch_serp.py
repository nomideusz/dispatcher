import json,urllib.request,time,sys
G='https://backboard.railway.com/graphql/v2'
kw=[k['query'] for k in json.load(open(sys.argv[1]))['keywords']]
def q(s,after=None):
    body={'query':'query($q:String!,$a:String){templateSearch(query:$q,after:$a){edges{node{id code name}} pageInfo{hasNextPage endCursor}}}','variables':{'q':s,'a':after}}
    r=urllib.request.Request(G,json.dumps(body).encode(),{'content-type':'application/json','user-agent':'dispatcher-research'})
    return json.load(urllib.request.urlopen(r,timeout=30))['data']['templateSearch']
out={}
for i,k in enumerate(kw):
    res=[];after=None
    for p in range(3):
        for a in range(3):
            try: r=q(k,after);break
            except Exception as e: time.sleep(3)
        else: break
        res+= [e['node'] for e in r['edges']]
        if not r['pageInfo']['hasNextPage']: break
        after=r['pageInfo']['endCursor'];time.sleep(0.15)
    out[k]=res
    if i%50==0: print(i,k,len(res),flush=True); json.dump(out,open('rank/serp.json','w'))
json.dump(out,open('rank/serp.json','w'));print('done')
