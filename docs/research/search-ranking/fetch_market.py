import json, sys, time, urllib.request
G="https://backboard.railway.com/graphql/v2"
Q="""query($after: String) { templates(first: 250, after: $after) { pageInfo { hasNextPage endCursor }
 edges { node { id name code description category tags languages readme isVerified isApproved image
 activeProjects recentProjects projects health createdAt updatedAt status supportHealthMetrics
 guides { post video } demoProjectId isV2Template
 creator { name username hasPublicProfile avatar }
 maintainer { id name partnerProfile { type slug } }
 services { edges { node { id } } } } } } }"""
out=[]; after=None
while True:
    body=json.dumps({"query":Q,"variables":{"after":after}}).encode()
    for attempt in range(5):
        try:
            req=urllib.request.Request(G,body,{"content-type":"application/json","user-agent":"dispatcher-research"})
            d=json.load(urllib.request.urlopen(req,timeout=120)); break
        except Exception as e:
            print("retry",e,file=sys.stderr); time.sleep(5)
    if "errors" in d: print(d["errors"],file=sys.stderr)
    t=d["data"]["templates"]
    out+= [e["node"] for e in t["edges"]]
    print(len(out),file=sys.stderr)
    if not t["pageInfo"]["hasNextPage"]: break
    after=t["pageInfo"]["endCursor"]
json.dump(out,open(sys.argv[1],"w"))
