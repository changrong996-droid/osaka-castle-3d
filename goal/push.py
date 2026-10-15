import sys, base64, runpy, io, contextlib, json
def call(args):
    sys.argv=['apicall','github']+args; buf=io.StringIO()
    try:
        with contextlib.redirect_stdout(buf): runpy.run_path('/usr/local/bin/apicall', run_name='__main__')
    except SystemExit: pass
    return buf.getvalue()
for f in sys.argv[1:]:
    sha=None
    try: sha=json.loads(call(['contents_get','owner=changrong996-droid','repo=osaka-castle-3d',f'path={f}'])).get('sha')
    except Exception: pass
    a=['contents_put','owner=changrong996-droid','repo=osaka-castle-3d',f'path={f}',f'message=goal mode: {f}','content='+base64.b64encode(open(f,'rb').read()).decode()]+([f'sha={sha}'] if sha else [])
    o=call(a); print(('OK ' if '"commit"' in o else 'FAIL ')+f, '' if '"commit"' in o else o[:200])
