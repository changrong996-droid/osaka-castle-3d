import json, sys, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.patches import Polygon
fm.fontManager.addfont('/home/sandbox/.fonts/NotoSansSC.otf')
plt.rcParams['font.family'] = 'Noto Sans SC'
L = json.load(open(sys.argv[1])); out = sys.argv[2]
fig, ax = plt.subplots(figsize=(14, 14), dpi=130)
ax.set_facecolor('#f4efe2')
if L['castle_outline']:
    ax.add_patch(Polygon(L['castle_outline']['pts'], closed=True, fc='#dfe8cf', ec='#9aa97c', lw=1))
for m in L['moats'] + L['rivers']:
    ax.add_patch(Polygon(m['pts'], closed=True, fc='#8fb6c9', ec='#4f7f96', lw=0.8))
for b in L['buildings']:
    ax.add_patch(Polygon(b['pts'], closed=True, fc='#d9d4c7', ec='#b8b2a3', lw=0.4))
for w in L['retaining_walls']:
    xs, ys = zip(*w['pts']); ax.plot(xs, ys, color='#5b5246', lw=1.6, solid_capstyle='round')
for w in L['walls']:
    xs, ys = zip(*w['pts']); ax.plot(xs, ys, color='#8a7a62', lw=0.8, ls='--')
for h in L['heritage']:
    big = h['id'] == 34619038
    ax.add_patch(Polygon(h['pts'], closed=True, fc='#c0392b' if big else '#e0a33a', ec='#3a1f10', lw=1.0, zorder=5))
    cx = sum(p[0] for p in h['pts']) / len(h['pts']); cy = sum(p[1] for p in h['pts']) / len(h['pts'])
    if h['name'] and abs(cx) < 560 and abs(cy) < 560:
        ax.annotate(('天守閣' if big else h['name']), (cx, cy), xytext=(6, 6), textcoords='offset points', fontsize=10 if big else 8.5, color='#3a1f10', zorder=6, weight='bold' if big else 'normal')
for p in L['points']:
    if p['name'].endswith('櫓跡') or p['name'].endswith('門跡') or p['name'] in ('京橋口', '玉造口'):
        x, y = p['xy']
        if abs(x) < 560 and abs(y) < 560:
            ax.plot(x, y, marker='^', ms=4, color='#7a5c2e'); ax.annotate(p['name'], (x, y), xytext=(3, -9), textcoords='offset points', fontsize=6.5, color='#7a5c2e')
for name, xy in [('本丸', (60, -30)), ('二の丸', (-170, -150)), ('西の丸', (-200, 30)), ('山里丸', (60, 120)), ('内堀', (165, 30)), ('外堀', (-420, 160)), ('外堀', (150, -440))]:
    ax.text(*xy, name, fontsize=15, color='#2c4a2e', alpha=.75, ha='center', weight='bold')
ax.set_xlim(-560, 560); ax.set_ylim(-560, 560); ax.set_aspect('equal')
ax.set_xticks(range(-500, 501, 100)); ax.set_yticks(range(-500, 501, 100)); ax.grid(color='#cfc6b0', lw=.4)
ax.set_xlabel('东 (m)'); ax.set_ylabel('北 (m)')
ax.set_title('大阪城 总平面图（现状：德川期城郭 · OSM 实测轮廓）\n红=天守　橙=现存/复原建筑　粗线=石垣　蓝=护城河　▲=橹/门遗址', fontsize=13)
ax.plot([380, 480], [-520, -520], color='k', lw=3); ax.text(430, -505, '100 m', ha='center', fontsize=9)
ax.annotate('N', xy=(520, -420), xytext=(520, -490), ha='center', fontsize=14, arrowprops=dict(arrowstyle='-|>', lw=2))
fig.text(0.99, 0.005, '数据 © OpenStreetMap contributors (ODbL)', ha='right', fontsize=8, color='#666')
plt.tight_layout(); plt.savefig(out); print('ok')
