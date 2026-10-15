"""Embed a GLB into a single offline HTML viewer (three.js from CDN)."""
import base64, sys, re
tpl = open(sys.argv[1]).read(); glb = sys.argv[2]; out = sys.argv[3]
open(out, 'w').write(tpl.replace('__B64__', base64.b64encode(open(glb, 'rb').read()).decode()))
print('ok', out)
