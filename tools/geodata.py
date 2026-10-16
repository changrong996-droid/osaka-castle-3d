"""Shared loaders for measured data (offline only; never shipped to the browser as raw mesh).
- GSI DEM5A PNG tiles (z15)  -> point samples (x, y, z T.P.) in the model's local frame
- PLATEAU 2025 CityGML cons / brid (EPSG:6697 lat lon h) -> surfaces in the local frame
Local frame = tools/extract_layout.py: origin LAT0/LON0 (tenshu), x east, y north, metres (equirectangular, same kx/ky)."""
import math, os, re, struct, zlib
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.dirname(ROOT)
DL = os.path.join(PROJ, 'web', 'downloads')
LAT0, LON0 = 34.68737, 135.52585
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110574
def ll2xy(lat, lon): return (lon - LON0) * KX, (lat - LAT0) * KY
DEM_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/15/{x}/{y}.png'
TILES = [(x, y) for x in (28718, 28719, 28720) for y in (13013, 13014, 13015)]

def _png_rgb(path):
    d = open(path, 'rb').read(); assert d[:8] == b'\x89PNG\r\n\x1a\n'; p = 8; idat = b''; W = H = 0; ct = None
    while p < len(d):
        n = struct.unpack('>I', d[p:p + 4])[0]; t = d[p + 4:p + 8]; c = d[p + 8:p + 8 + n]; p += 12 + n
        if t == b'IHDR': W, H, bd, ct = struct.unpack('>IIBB', c[:10]); assert bd == 8
        elif t == b'IDAT': idat += c
        elif t == b'PLTE': pal = np.frombuffer(c, np.uint8).reshape(-1, 3)
    raw = zlib.decompress(idat); bpp = {2: 3, 6: 4, 3: 1}[ct]; stride = W * bpp
    out = np.zeros((H, stride), np.int32); prev = np.zeros(stride, np.int32); q = 0
    for r in range(H):
        f = raw[q]; line = np.frombuffer(raw[q + 1:q + 1 + stride], np.uint8).astype(np.int32); q += 1 + stride; cur = np.zeros(stride, np.int32)
        if f == 0: cur = line
        elif f == 2: cur = (line + prev) & 255
        else:
            for i in range(stride):
                a = cur[i - bpp] if i >= bpp else 0; b = prev[i]; cc = prev[i - bpp] if i >= bpp else 0
                if f == 1: v = a
                elif f == 3: v = (a + b) >> 1
                else:
                    pa, pb, pc = abs(b - cc), abs(a - cc), abs(a + b - 2 * cc); v = a if pa <= pb and pa <= pc else (b if pb <= pc else cc)
                cur[i] = (line[i] + v) & 255
        out[r] = cur; prev = cur
    if ct == 3: return pal[out].astype(np.int32)
    return out.reshape(H, W, bpp)[:, :, :3]

def dem_points(cache=os.path.join(DL, 'dem5a', 'dem_local.npz')):
    """All DEM5A pixel centres of the 3x3 tiles as (x, y, z); z = NaN where GSI has no value (water)."""
    if os.path.exists(cache): d = np.load(cache); return d['x'], d['y'], d['z']
    X, Y, Z = [], [], []
    n = 2 ** 15
    for tx, ty in TILES:
        rgb = _png_rgb(os.path.join(DL, 'dem5a', f'15_{tx}_{ty}.png'))
        v = (rgb[:, :, 0] << 16) + (rgb[:, :, 1] << 8) + rgb[:, :, 2]
        z = np.where(v == 2 ** 23, np.nan, np.where(v > 2 ** 23, v - 2 ** 24, v) * 0.01)
        j, i = np.mgrid[0:256, 0:256]
        px = tx + (i + 0.5) / 256; py = ty + (j + 0.5) / 256
        lon = px / n * 360 - 180; lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * py / n))))
        x, y = ll2xy(lat, lon); X.append(x.ravel()); Y.append(y.ravel()); Z.append(z.ravel())
    X, Y, Z = np.concatenate(X), np.concatenate(Y), np.concatenate(Z)
    np.savez_compressed(cache, x=X, y=Y, z=Z); return X, Y, Z

def gml_surfaces(path, kinds=('WallSurface', 'RoofSurface', 'OuterFloorSurface', 'GroundSurface')):
    """[(kind, gml_id, [ring as Nx3 local xyz]...)] for every bounded surface of a PLATEAU CityGML file."""
    s = open(path, encoding='utf-8').read(); out = []
    for m in re.finditer(r'<(?:uro|bldg|brid|tran):(\w+Surface)\b[^>]*?(?:gml:id="([^"]*)")?[^>]*>(.*?)</(?:uro|bldg|brid|tran):\1>', s, re.S):
        k = m.group(1)
        if k not in kinds: continue
        rings = []
        for pl in re.findall(r'<gml:posList[^>]*>(.*?)</gml:posList>', m.group(3), re.S):
            a = np.array(pl.split(), float).reshape(-1, 3); x, y = ll2xy(a[:, 0], a[:, 1]); rings.append(np.c_[x, y, a[:, 2]])
        out.append((k, m.group(2), rings))
    return out

class DEM:
    """Bilinear sampler of the DEM5A mosaic at local (x, y); NaN if any of the 4 pixels has no value."""
    def __init__(self):
        n = 2 ** 15; self.n = n; xs = sorted({t[0] for t in TILES}); ys = sorted({t[1] for t in TILES})
        self.tx0, self.ty0 = xs[0], ys[0]; A = np.full((256 * len(ys), 256 * len(xs)), np.nan)
        for tx, ty in TILES:
            rgb = _png_rgb(os.path.join(DL, 'dem5a', f'15_{tx}_{ty}.png')); v = (rgb[:, :, 0] << 16) + (rgb[:, :, 1] << 8) + rgb[:, :, 2]
            z = np.where(v == 2 ** 23, np.nan, np.where(v > 2 ** 23, v - 2 ** 24, v) * 0.01)
            A[(ty - self.ty0) * 256:(ty - self.ty0 + 1) * 256, (tx - self.tx0) * 256:(tx - self.tx0 + 1) * 256] = z
        self.A = A
    def __call__(self, x, y):
        x = np.asarray(x, float); y = np.asarray(y, float); lon = x / KX + LON0; lat = y / KY + LAT0; n = self.n
        px = ((lon + 180) / 360 * n - self.tx0) * 256 - 0.5
        py = ((1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / math.pi) / 2 * n - self.ty0) * 256 - 0.5
        i = np.floor(px).astype(int); j = np.floor(py).astype(int); u = px - i; v = py - j
        i = np.clip(i, 0, self.A.shape[1] - 2); j = np.clip(j, 0, self.A.shape[0] - 2); A = self.A
        return (A[j, i] * (1 - u) * (1 - v) + A[j, i + 1] * u * (1 - v) + A[j + 1, i] * (1 - u) * v + A[j + 1, i + 1] * u * v)
