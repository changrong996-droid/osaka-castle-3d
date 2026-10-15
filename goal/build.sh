#!/bin/bash
# One full build on the Mac + download of the 5 feedback views and preview into castle/dl/. ~60-90 s.
REPO=/workspace/projects/3dffd53e-9285-4461-aa69-4f5634f0e079/castle
pip install -q shapely matplotlib pysocks paramiko >/dev/null 2>&1; cd $REPO && python3 tools/make_terrain.py data/castle_layout.json data/terrain.json >/dev/null
$REPO/goal/mac.sh 'B=/Applications/Blender.app/Contents/MacOS/Blender; rm -f out_build.log; (nohup $B -b --python blender/build_castle.py > out_build.log 2>&1 &); for i in $(seq 1 22); do sleep 5; grep -qE "CASTLE_OK|Traceback" out_build.log && break; done; grep -E "CASTLE_OK|Error|Traceback" out_build.log | tail -5; cp out_build.log out/' out/views/aerial.png out/views/top.png out/views/otemon.png out/views/tenshu.png out/views/eastwall.png out/out_build.log
EOF=1
