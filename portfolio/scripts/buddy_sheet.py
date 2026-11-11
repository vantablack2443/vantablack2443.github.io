"""Builds the buddy sprite sheets from the Gemini strips in art/buddy/v2 (Pillow only, deterministic).

    python3 scripts/buddy_sheet.py [preview.png]

Reads  art/buddy/v2/{walk4,run,jump,hang,climb,stance}.webp  (flat magenta, facing right)
Writes src/light/buddy-art/sheet.png + sheet.json       (standing height 80 px: the 1x sheet)
       src/light/buddy-art/sheet-sm.png + sheet-sm.json (64 px, the same art for narrow viewports, drawn from the originals, not resampled)
An optional argument also saves a 4x nearest-neighbour preview of the 1x sheet with the anchors marked.
The manifest is version 3 (see BUDDY3.md, section 3).

How it works
  1. art_key.key() cuts the magenta; the alpha is thresholded to 0/255.
  2. Every strip is split into frames by connected components of the alpha, left to right. Tiny islands (a
     stray pixel, a glasses glint) join the nearest frame. Nothing is ever cut along a seam: if a strip does
     not yield exactly the expected number of separate figures the script stops with an error. A crop guard
     then checks that no frame has a straight vertical run of opaque pixels along its left or right edge
     (the signature of a cut-off limb).
  3. One scale for the whole cast: the head (the widest run of dark hair pixels in the top 35% of a frame,
     median per strip) is the same size in every animation, and the head size is chosen so that the walking
     figure (walk4) is exactly HEIGHT px tall. The only exception: the climb strip (a back view has a narrower
     head) is capped at 1.2x the walk scale.
  4. Frames are box-downscaled (area average, premultiplied), the alpha is snapped to 0/255, and all colours are
     quantised to one shared palette (at most 48 colours) built from every strip together.
  5. Anchors: ground (bottom centre between the feet: the head's centre column, the lowest pixel row), hand (top
     centre of the joined hands, hang frames) and grip (the higher hand, climb frames).
No transform other than a pure downscale is ever applied to a frame: no shear, no stretch, no rotation.
"""
import json
import math
import statistics
import sys
from collections import deque
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art' / 'buddy' / 'v2'
OUT = ROOT / 'src' / 'light' / 'buddy-art'

STRIPS = [('walk4', 4), ('run', 4), ('jump', 6), ('hang', 6), ('climb', 6), ('stance', 1)]
HEIGHTS = {'': 80, '-sm': 64}  # sheet suffix -> standing height in px
COLOURS = 48
ALPHA_CUT = 160  # the keyed alpha above this is the figure
ISLAND = 600  # full-resolution pixels: smaller blobs are not frames
DARK = 48  # luma below this is hair or outline
HEAD_ROWS = 0.35  # the head is measured in the top 35% of a frame
CLIMB_CAP = 1.2  # the climb strip is drawn at most this much bigger than the walk strip
CELL_UP = 16  # room above the anchor for the "!" bubble
CROP_FRAC = 0.2  # a straight vertical run of opaque pixels longer than this share of the frame height, in its first or last column, is a cut limb (the plan said 12 px; real elbows and boots reach 59 px at full resolution, a cut limb is far longer)
HW_FRAC = 0.175  # the collision half width is this much of the sprite height (14 px at 80)
BODY_FRAC = 0.9  # the collision body is this much of the sprite height

# animation -> (sources: [(strip, frame indices)], ms per frame, loop, anchor kind)
# The jump strip is: crouch, launch, apex (arms up), tucked, legs down, deep crouch.
ANIMS = {
    'idle': ([('jump', [4])], [1000], True, 'ground'),
    'ready': ([('stance', [0])], [1000], True, 'ground'),
    'walk': ([('walk4', [0, 1, 2, 3])], [130] * 4, True, 'ground'),
    'run': ([('run', [0, 1, 2, 3])], [90] * 4, True, 'ground'),
    'jump': ([('jump', [0, 1, 2])], [120, 130, 200], False, 'ground'),
    'fall': ([('jump', [3, 4])], [200, 200], False, 'ground'),
    'land': ([('jump', [5])], [140], False, 'ground'),
    'hang': ([('hang', [0, 1, 2, 3, 4, 5])], [110] * 6, True, 'hand'),
    'climb': ([('climb', [0, 1, 2, 3, 4, 5])], [150] * 6, True, 'ground'),
}
WALK_STRIDE = 38  # px of travel per walk cycle at 80 px (measured: the planted foot moves back ~9 px a frame)
CLIMB_STRIDE = 34  # px of travel per climb cycle at 80 px (walk and run strides are measured from the frames)


# ------------------------------------------------------------------ splitting


def label(mask):
    """8-connected components of a binary 'L' mask: (id grid as a flat bytearray-like list, [area, x0, y0, x1, y1])."""
    w, h = mask.size
    px = mask.load()
    ids = [0] * (w * h)
    comps = []
    for y in range(h):
        for x in range(w):
            if px[x, y] and not ids[y * w + x]:
                n = len(comps) + 1
                q = deque([(x, y)])
                ids[y * w + x] = n
                area, x0, y0, x1, y1 = 0, x, y, x, y
                while q:
                    cx, cy = q.popleft()
                    area += 1
                    x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not ids[ny * w + nx]:
                                ids[ny * w + nx] = n
                                q.append((nx, ny))
                comps.append([area, x0, y0, x1, y1])
    return ids, comps


def vertical_run(m, x):
    """Longest straight run of opaque pixels in column x of a binary mask."""
    px = m.load()
    best = cur = 0
    for y in range(m.height):
        if px[x, y]:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return best


def split(name, expect):
    """The frames of a strip, left to right: full-resolution RGBA crops. Fails if the figures are not separate."""
    keyed = art_key.key(Image.open(ART / f'{name}.webp'))
    mask = keyed.getchannel('A').point(lambda v: 255 if v > ALPHA_CUT else 0)
    w, h = mask.size
    ids, comps = label(mask)
    big = [i + 1 for i, c in enumerate(comps) if c[0] >= ISLAND]
    if len(big) != expect:
        raise SystemExit(f'{name}: figures touch; regenerate with a clear magenta gap between them (found {len(big)} separate figures, expected {expect})')
    big.sort(key=lambda j: comps[j - 1][1])  # left to right
    slot = {c: k for k, c in enumerate(big)}
    owner = {}
    for i, c in enumerate(comps):  # islands join the nearest frame
        if c[0] >= ISLAND:
            owner[i + 1] = i + 1
            continue

        def gap(j):
            b = comps[j - 1]
            return math.hypot(max(b[1] - c[3], c[1] - b[3], 0), max(b[2] - c[4], c[2] - b[4], 0))

        owner[i + 1] = min(big, key=gap)
    frame_of = bytes(slot[owner[c]] + 1 if c else 0 for c in ids)
    frames = []
    for n in range(1, expect + 1):
        m = Image.frombytes('L', (w, h), frame_of).point(lambda v, n=n: 255 if v == n else 0)
        box = m.getbbox()
        mc = m.crop(box)
        for col in (0, mc.width - 1):
            run = vertical_run(mc, col)
            if run > CROP_FRAC * mc.height:
                raise SystemExit(f'{name}: frame {n - 1} has a straight vertical run of {run} opaque pixels in column {col}: a limb is cut off')
        rgba = keyed.crop(box)
        rgba.putalpha(mc)
        frames.append(rgba)
    return frames


# ----------------------------------------------------------------- measuring


def luma(p):
    return (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000


def head_width(fr, gap=3):
    """The widest run of dark hair pixels (gaps of up to `gap` px allowed) in the top 35% of the frame.

    A run, not the extent: raised arms and fists have black outlines too, but they are separated from the hair by
    sleeve and skin, so they do not count.
    """
    px = fr.load()
    w, h = fr.size
    best = 0
    for y in range(int(h * HEAD_ROWS)):
        cur = miss = 0
        for x in range(w):
            p = px[x, y]
            if p[3] and luma(p) < DARK:
                cur += 1 + miss
                miss = 0
            else:
                miss += 1
                if miss > gap:
                    best = max(best, cur)
                    cur = miss = 0
        best = max(best, cur)
    return best


def head_centre(fr):
    px = fr.load()
    w, h = fr.size
    lo, hi = w, -1
    for y in range(int(h * 0.3)):
        for x in range(w):
            p = px[x, y]
            if p[3] and luma(p) < DARK:
                lo, hi = min(lo, x), max(hi, x)
    return (lo + hi + 1) / 2


def is_skin(p):
    return p[3] and p[0] > 170 and 110 < p[1] < 210 and 60 < p[2] < 170 and p[0] > p[1] > p[2]


def grip_point(fr, hx):
    """The higher hand of a back-view climb frame: the highest skin blob that is clear of the head."""
    px = fr.load()
    w, h = fr.size
    skin = Image.new('L', (w, h))
    sp = skin.load()
    for y in range(h):
        for x in range(w):
            if is_skin(px[x, y]):
                sp[x, y] = 255
    ids, comps = label(skin)
    head_w = head_width(fr)
    best = None
    for i, (area, x0, y0, x1, y1) in enumerate(comps):
        if area < 250:
            continue
        cx = (x0 + x1 + 1) / 2
        if abs(cx - hx) < head_w * 0.35:
            continue  # the face, the ear or the neck
        if best is None or (y0 + y1) / 2 < best[1]:
            best = (cx, (y0 + y1) / 2)
    return best[0], best[1]


# ------------------------------------------------------------------- building


def render(fr, ax, ay, s):
    """Box-downscale fr by s so that the source point (ax, ay) lands on an integer pixel; returns (RGBA, (anchor x, y))."""
    w, h = fr.size
    left, right = math.ceil(ax * s) + 2, math.ceil((w - ax) * s) + 2
    up, down = math.ceil(ay * s) + 2, math.ceil((h - ay) * s) + 2
    pad = math.ceil(4 / s) + 4
    big = Image.new('RGBA', (w + 2 * pad, h + 2 * pad))
    big.paste(fr, (pad, pad))
    box = (pad + ax - left / s, pad + ay - up / s, pad + ax + right / s, pad + ay + down / s)
    small = big.resize((left + right, up + down), Image.BOX, box=box)
    a = small.getchannel('A').point(lambda v: 255 if v >= 128 else 0)
    small.putalpha(a)
    return small, (left, up)


def build_all():
    sources = {}
    for name, n in STRIPS:
        sources[name] = split(name, n)
        print(f'{name}: {len(sources[name])} frames', [f.size for f in sources[name]])

    # the head: median of the per-frame hair widths of each strip
    head = {name: statistics.median(head_width(f) for f in frs) for name, frs in sources.items()}
    walk_h = statistics.median(f.height for f in sources['walk4'])
    print('head widths', head, 'walk height', walk_h)
    return sources, head, walk_h


def frame_set(sources, head, walk_h, height, palette):
    """Render every needed source frame at the given standing height. Returns {(strip, index): record}."""
    head_target = head['walk4'] * height / walk_h  # px
    scale = {name: head_target / head[name] for name in head}
    # a back view shows a narrower head than a side view, so the climb would come out too big: cap it
    scale['climb'] = min(scale['climb'], scale['walk4'] * CLIMB_CAP)
    print('scale per strip', {k: round(v, 4) for k, v in scale.items()})
    out = {}
    for name, frs in sources.items():
        for i, fr in enumerate(frs):
            hx = head_centre(fr)
            w, h = fr.size
            rec = {'strip': name, 'i': i}
            if name == 'hang':
                px = fr.load()
                top = [x for y in range(max(2, int(h * 0.06))) for x in range(w) if px[x, y][3]]
                ax, ay = (min(top) + max(top) + 1) / 2, h * 0.045
                img, (Ax, Ay) = render(fr, ax, ay, scale[name])
            else:
                ax, ay = hx, h
                img, (Ax, Ay) = render(fr, ax, ay, scale[name])
            grip = None
            if name == 'climb':
                gx, gy = grip_point(fr, hx)
                grip = ((gx - ax) * scale[name] + Ax, (gy - ay) * scale[name] + Ay)
            rec.update(img=img, anchor=(Ax, Ay), grip=grip, kind='hand' if name == 'hang' else 'ground')
            out[(name, i)] = rec
    return out


def tight(rec):
    """Crop to the visible pixels. The ground anchor's row becomes the lowest visible row, so the feet touch the ground."""
    img = rec['img']
    x0, y0, x1, y1 = img.getchannel('A').getbbox()
    ax, ay = rec['anchor']
    if rec['kind'] == 'ground':
        ay = y1  # the line under the feet
    crop = img.crop((x0, y0, x1, y1))
    rec = dict(rec, img=crop, anchor=(ax - x0, ay - y0))
    if rec['grip']:
        rec['grip'] = (rec['grip'][0] - x0, rec['grip'][1] - y0)
    return rec


def build_palette(frames_by_height):
    """One palette for everything: median cut over every distinct opaque colour of every frame (all heights)."""
    colours = set()
    for frames in frames_by_height:
        for rec in frames.values():
            px = rec['img'].load()
            w, h = rec['img'].size
            for y in range(h):
                for x in range(w):
                    p = px[x, y]
                    if p[3]:
                        colours.add(p[:3])
    cols = sorted(colours)
    strip = Image.new('RGB', (len(cols), 1))
    strip.putdata(cols)
    q = strip.quantize(colors=COLOURS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette()[: COLOURS * 3]
    used = sorted(set(q.tobytes()))
    return [tuple(pal[i * 3 : i * 3 + 3]) for i in used]


def apply_palette(img, palette):
    pal_img = Image.new('P', (1, 1))
    flat = [c for rgb in palette for c in rgb]
    pal_img.putpalette(flat + list(palette[-1]) * ((768 - len(flat)) // 3))  # the unused slots repeat the last colour: no 49th colour appears
    rgb = img.convert('RGB').quantize(palette=pal_img, dither=Image.Dither.NONE).convert('RGB')
    rgb.putalpha(img.getchannel('A'))
    out = Image.new('RGBA', img.size)
    out.paste(rgb, mask=img.getchannel('A'))  # transparent pixels stay (0,0,0,0)
    return out


def foot_spread(rec):
    """Width of the feet: the x extent of the opaque pixels in the bottom 15% of a frame."""
    img = rec['img']
    w, h = img.size
    px = img.load()
    xs = [x for y in range(int(h * 0.85), h) for x in range(w) if px[x, y][3]]
    return max(xs) - min(xs) + 1


def pack(frames, palette, height, suffix):
    """Lay the animations out in rows; write the sheet and its manifest. Returns (sheet, manifest, anchors for the preview)."""
    placed = []  # (animation, records, ms, loop, kind)
    for name, (parts, ms, loop, kind) in ANIMS.items():
        recs = [frames[(strip, i)] for strip, idx in parts for i in idx]
        assert len(ms) == len(recs), name
        placed.append((name, recs, ms, loop, kind))
    # the cell: square, the origin in the centre. Big enough for every frame around its anchor, and for the held
    # sprite swinging about its hands (hang + 20 each way).
    half = max(
        max(max(r['anchor'][0], r['img'].width - r['anchor'][0]) for _, rs, *_ in placed for r in rs),
        max(r['anchor'][1] + CELL_UP for _, rs, *_ in placed for r in rs),
        max(r['img'].height - r['anchor'][1] for _, rs, *_ in placed for r in rs),
        round(statistics.median(r['img'].height - r['anchor'][1] for r in frames_of(frames, 'hang'))) + 20,
    )
    s = 2 * math.ceil(half) + 2

    sheet_w = max(sum(r['img'].width + 1 for r in rs) for _, rs, *_ in placed)
    rows = []
    y = 0
    for name, rs, ms, loop, kind in placed:
        rows.append((y, max(r['img'].height for r in rs)))
        y += rows[-1][1] + 1
    sheet = Image.new('RGBA', (sheet_w, y))
    anims = {}
    marks = []  # (x, y, kind) in sheet pixels
    for (name, rs, ms, loop, kind), (ry, rh) in zip(placed, rows):
        x = 0
        fl = []
        for r in rs:
            sheet.paste(apply_palette(r['img'], palette), (x, ry))
            f = {'x': x, 'y': ry, 'w': r['img'].width, 'h': r['img'].height, 'ax': round(r['anchor'][0], 1), 'ay': round(r['anchor'][1], 1)}
            marks.append((x + f['ax'], ry + f['ay'], 'anchor'))
            if r['grip']:
                f['gx'], f['gy'] = round(r['grip'][0], 1), round(r['grip'][1], 1)
                marks.append((x + f['gx'], ry + f['gy'], 'grip'))
            fl.append(f)
            x += r['img'].width + 1
        a = {'loop': loop, 'ms': ms, 'anchor': kind, 'frames': fl}
        anims[name] = a

    # strides: px travelled per full cycle, twice the widest foot spread of the cycle (the sim advances the cycle by distance)
    anims['run']['stride'] = round(2 * max(foot_spread(frames[('run', i)]) for i in range(4)))
    # the walk: twice the foot spread is far too long (the shoes' full extent); the planted foot travels back about 9 px
    # per frame at 80 px (measured in the browser), so a cycle covers 4 x 9 and the feet do not skate
    anims['walk']['stride'] = round(WALK_STRIDE * height / 80)
    anims['climb']['stride'] = round(CLIMB_STRIDE * height / 80)

    # metrics the sim needs, measured from the frames
    idle = frames[('jump', 4)]['img']
    climb = frames_of(frames, 'climb')
    hang = frames_of(frames, 'hang')
    metrics = {
        'height': height,
        # collision half width: the torso and legs, not the arms (the whole idle frame is 22 px at 80 and breaks the planner);
        # 0.175 of the height keeps a 24 px gap between panels too narrow to fall through. Collision height as a share of the sprite.
        'body': [min(round(HW_FRAC * height), round(idle.width / 2)), round(BODY_FRAC * height)],
        'crouch': frames[('jump', 5)]['img'].height,
        'climbHalf': max(max(r['anchor'][0], r['img'].width - r['anchor'][0]) for r in climb),
        'grip': round(statistics.median(r['anchor'][1] - r['grip'][1] for r in climb)),  # height of the higher hand above the feet
        'hang': round(statistics.median(r['img'].height - r['anchor'][1] for r in hang)),  # feet below the joined hands
    }
    manifest = {'version': 3, 'size': list(sheet.size), 'cell': [s, s], 'origin': [s // 2, s // 2], 'palette': len(palette), 'metrics': metrics, 'animations': anims}
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / f'sheet{suffix}.png', optimize=False)
    (OUT / f'sheet{suffix}.json').write_text(json.dumps(manifest, indent=1) + '\n')
    return sheet, manifest, marks


def frames_of(frames, strip):
    return [r for (n, _), r in sorted(frames.items()) if n == strip]


def main():
    sources, head, walk_h = build_all()
    frames = {h: {k: tight(v) for k, v in frame_set(sources, head, walk_h, h, None).items()} for h in HEIGHTS.values()}
    palette = build_palette(list(frames.values()))
    assert len(palette) <= COLOURS, f'{len(palette)} colours'
    print('palette', len(palette), 'colours')
    for suffix, h in HEIGHTS.items():
        sheet, m, marks = pack(frames[h], palette, h, suffix)
        a = sheet.getchannel('A')
        assert set(a.getdata()) <= {0, 255}, 'alpha must be 0 or 255'
        print(f'sheet{suffix}.png', sheet.size, 'cell', m['cell'], 'metrics', m['metrics'])
        print({k: len(a['frames']) for k, a in m['animations'].items()}, {k: a.get('stride') for k, a in m['animations'].items() if 'stride' in a})
        if suffix == '' and len(sys.argv) > 1:
            k = 4
            bg = Image.new('RGBA', sheet.size, (214, 226, 230, 255))
            bg.alpha_composite(sheet)
            big = bg.resize((sheet.width * k, sheet.height * k), Image.NEAREST)
            px = big.load()
            for mx, my, kind in marks:
                col = (255, 0, 0, 255) if kind == 'anchor' else (0, 160, 0, 255)
                cx, cy = int(mx * k), int(my * k)
                for d in range(-6, 7):
                    for (xx, yy) in ((cx + d, cy), (cx, cy + d)):
                        if 0 <= xx < big.width and 0 <= yy < big.height:
                            px[xx, yy] = col
            big.save(sys.argv[1])


if __name__ == '__main__':
    main()
