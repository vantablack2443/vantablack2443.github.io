"""Builds the buddy sprite sheets from the Gemini strips in art/buddy/v2 (Pillow only, deterministic).

    python3 scripts/buddy_sheet.py [preview.png]

Reads  art/buddy/v2/{stance,walk,fight-walk,jump,hang,climb}.webp  (flat magenta, facing right)
Writes public/buddy/sheet.png + sheet.json       (standing height 80 px: the 1x sheet)
       public/buddy/sheet-sm.png + sheet-sm.json (64 px, the same art for narrow viewports, drawn from the originals, not resampled)
An optional argument also saves a 4x nearest-neighbour preview of the 1x sheet.

How it works
  1. art_key.key() cuts the magenta; the alpha is thresholded to 0/255.
  2. Every strip is split into frames by connected components of the alpha, left to right.
     Tiny islands (a stray pixel, a glasses glint) join the nearest frame. Where Gemini let neighbouring
     frames touch (walk, fight-walk), the merged blob is cut along a seam: a path through the alpha that
     prefers transparent pixels (dynamic programming), so no frame is cut along a straight line through an arm.
  3. One scale for the whole cast: the head (the widest run of dark hair pixels in the top 35% of a frame,
     median per strip) is the same size in every animation, and the head size is chosen so that the
     walking figure is exactly HEIGHT px tall. Two exceptions: the climb strip (a back view has a narrower head)
     is capped at 1.2x the walk scale, and the stance (bent knees) averages head-scale and height-scale.
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
OUT = ROOT / 'public' / 'buddy'

STRIPS = [('stance', 1), ('walk', 6), ('fight-walk', 6), ('jump', 6), ('hang', 6), ('climb', 6)]
HEIGHTS = {'': 80, '-sm': 64}  # sheet suffix -> standing height in px
COLOURS = 48
ALPHA_CUT = 160  # the keyed alpha above this is the figure
ISLAND = 600  # full-resolution pixels: smaller blobs are not frames
DARK = 48  # luma below this is hair or outline
HEAD_ROWS = 0.35  # the head is measured in the top 35% of a frame
CLIMB_CAP = 1.2  # the climb strip is drawn at most this much bigger than the walk strip
CELL_UP = 16  # room above the anchor for the "!" bubble
BUBBLE = 16

# animation -> (strip, frame indices, ms per frame, loop, anchor kind)
# animation -> (sources, ms per frame, loop, anchor kind); the jump strip is crouch, launch, apex, tucked, landing, crouch
ANIMS = {
    'idle': ([('stance', [0]), ('fight-walk', 'quiet')], [900, 240, 240, 240], True, 'ground'),
    'walk': ([('walk', [0, 1, 2, 3, 4, 5])], [130] * 6, True, 'ground'),
    'guard': ([('fight-walk', 'clean')], 130, True, 'ground'),
    'jump': ([('jump', [0, 1, 2])], [120, 130, 200], False, 'ground'),
    'fall': ([('jump', [3])], [200], False, 'ground'),
    'land': ([('jump', [4, 5])], [90, 120], False, 'ground'),
    'hang': ([('hang', [0, 1, 2, 3, 4, 5])], [110] * 6, True, 'hand'),
    'climb': ([('climb', [0, 1, 2, 3, 4, 5])], [150] * 6, True, 'ground'),
}
STRIDE = {'walk': 46, 'guard': 40, 'climb': 34}  # px of travel per full cycle of the legs (the sim advances the cycle by distance)


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


def seam(mask, xn, y0, y1, half=45):
    """A top-to-bottom path near column xn that crosses as few opaque pixels as possible (and stays smooth)."""
    px = mask.load()
    w = mask.width
    xs = range(max(1, xn - half), min(w - 2, xn + half) + 1)
    pull = 0.04

    def cost(x, y):
        return (10.0 if px[x, y] else 0.0) + pull * abs(x - xn)

    row = {x: cost(x, y0) for x in xs}
    back = []
    for y in range(y0 + 1, y1 + 1):
        new, bk = {}, {}
        for x in xs:
            best, bx = 1e18, x
            for dx in (-2, -1, 0, 1, 2):
                c = row.get(x + dx)
                if c is not None and c + 0.6 * abs(dx) < best:
                    best, bx = c + 0.6 * abs(dx), x + dx
            new[x] = best + cost(x, y)
            bk[x] = bx
        row = new
        back.append(bk)
    x = min(row, key=row.get)
    path = [x]
    for bk in reversed(back):
        x = bk[x]
        path.append(x)
    path.reverse()
    return path  # path[y - y0] is the seam column in row y: pixels right of it belong to the next frame


STRAY_GAP = 3  # px: a piece further than this from the body is not part of the frame


def drop_strays(m):
    """Keep the body (the largest piece) and what sits right next to it. A seam cut through touching
    frames can leave the neighbour's fist behind as a detached piece; this removes it."""
    ids, comps = label(m)
    if len(comps) < 2:
        return m
    body = max(range(len(comps)), key=lambda i: comps[i][0])
    _, bx0, by0, bx1, by1 = comps[body]
    keep = {body + 1}
    for i, (_, x0, y0, x1, y1) in enumerate(comps):
        if max(bx0 - x1, x0 - bx1, by0 - y1, y0 - by1) <= STRAY_GAP:
            keep.add(i + 1)
    out = bytes(255 if c in keep else 0 for c in ids)
    return Image.frombytes('L', m.size, out)


def split(name, expect):
    """The frames of a strip, left to right: a list of (full-resolution RGBA crop, mask crop)."""
    keyed = art_key.key(Image.open(ART / f'{name}.webp'))
    mask = keyed.getchannel('A').point(lambda v: 255 if v > ALPHA_CUT else 0)
    w, h = mask.size
    ids, comps = label(mask)
    big = [i + 1 for i, c in enumerate(comps) if c[0] >= ISLAND]
    owner = {i + 1: i + 1 for i in range(len(comps))}  # component -> the frame it belongs to
    for i, c in enumerate(comps):  # islands join the nearest frame
        if c[0] >= ISLAND:
            continue

        def gap(j):
            b = comps[j - 1]
            return math.hypot(max(b[1] - c[3], c[1] - b[3], 0), max(b[2] - c[4], c[2] - b[4], 0))

        owner[i + 1] = min(big, key=gap)
    frame_of = [0] * (w * h)  # frame number + 1 per pixel, 0 for none
    slots = {c: k for k, c in enumerate(sorted(big, key=lambda j: comps[j - 1][1]))}
    nf = len(big)
    cuts = {}  # frame slot -> (x0, y0, [seam paths]) when a merged blob must be cut
    if nf < expect:
        # the widest blob holds several touching frames: cut it with seams at equal spacing
        widest = max(big, key=lambda j: comps[j - 1][3] - comps[j - 1][1])
        k = expect - nf + 1
        a, x0, y0, x1, y1 = comps[widest - 1]
        paths = [seam(mask, round(x0 + (x1 - x0 + 1) * i / k), y0, y1) for i in range(1, k)]
        cuts[widest] = (y0, paths)
    assert nf + (len(next(iter(cuts.values()))[1]) if cuts else 0) == expect, f'{name}: found {nf} blobs, need {expect}'
    # numbering: blobs left to right, the cut blob expands into its pieces
    order = []
    for c in sorted(big, key=lambda j: comps[j - 1][1]):
        order.extend([(c, p) for p in range(len(cuts[c][1]) + 1)] if c in cuts else [(c, 0)])
    piece_no = {key: n + 1 for n, key in enumerate(order)}
    for y in range(h):
        for x in range(w):
            c = ids[y * w + x]
            if not c:
                continue
            c = owner[c]
            if c in cuts:
                y0, paths = cuts[c]
                p = sum(1 for s in paths if x > s[min(len(s) - 1, y - y0)])
                frame_of[y * w + x] = piece_no[(c, p)]
            else:
                frame_of[y * w + x] = piece_no[(c, 0)]
    flat = bytes(frame_of)
    frames = []
    for n in range(1, len(order) + 1):
        m = drop_strays(Image.frombytes('L', (w, h), flat).point(lambda v, n=n: 255 if v == n else 0))
        box = m.getbbox()
        rgba = keyed.crop(box)
        rgba.putalpha(m.crop(box))
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
    walk_h = statistics.median(f.height for f in sources['walk'])
    print('head widths', head, 'walk height', walk_h)
    return sources, head, walk_h


def frame_set(sources, head, walk_h, height, palette):
    """Render every needed source frame at the given standing height. Returns {(strip, index): record}."""
    head_target = head['walk'] * height / walk_h  # px
    scale = {name: head_target / head[name] for name in head}
    # a back view shows a narrower head than a side view, so the climb would come out too big: cap it
    scale['climb'] = min(scale['climb'], scale['walk'] * CLIMB_CAP)
    # the stance is a different drawing with bent knees: split the difference between "same head" and "same height"
    scale['stance'] = (scale['stance'] + scale['walk'] * walk_h / sources['stance'][0].height) / 2
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


STRAY_SKIN = 11  # skin pixels on the left of a guard frame above this: the neighbour's fist overlaps it


_clean = None  # decided once on the biggest sheet, then reused, so both sheets show the same frames


def clean_guard(frames):
    """The fight-walk frames without the neighbouring frame's fist drawn over the back shoulder. In the
    strip Gemini overlapped each raised fist onto the next figure, so those frames can't be cut cleanly."""
    global _clean
    if _clean is not None:
        return _clean
    keep = []
    for i in range(6):
        img = frames[('fight-walk', i)]['img']
        w, h = img.size
        px = img.load()
        skin = sum(1 for y in range(int(h * 0.25), int(h * 0.6)) for x in range(int(w * 0.3)) if is_skin(px[x, y]))
        if skin <= STRAY_SKIN:
            keep.append(i)
    assert len(keep) >= 2, f'only {len(keep)} clean guard frames'
    _clean = keep
    return keep


def pick_idle(frames):
    """The two clean fight-walk frames with the legs closest together (the quietest guard poses)."""
    spread = []
    for i in clean_guard(frames):
        img = frames[('fight-walk', i)]['img']
        w, h = img.size
        px = img.load()
        xs = [x for y in range(int(h * 0.85), h) for x in range(w) if px[x, y][3]]
        spread.append((max(xs) - min(xs), i))
    return [i for _, i in sorted(spread)[:2]]


def pack(frames, palette, height, suffix):
    """Lay the animations out in rows; write the sheet and its manifest."""
    anims = {}
    placed = []  # (animation, list of records)
    idle_pick = pick_idle(frames)
    for name, (parts, ms, loop, kind) in ANIMS.items():
        recs = []
        for strip, idx in parts:
            if idx == 'quiet':
                idx = [idle_pick[0], idle_pick[1], idle_pick[0]]
            elif idx == 'clean':
                idx = clean_guard(frames)
            recs += [frames[(strip, i)] for i in idx]
        placed.append((name, recs, ms if isinstance(ms, list) else [ms] * len(recs), loop, kind))
    # the cell: wide and tall enough for every frame around its anchor
    half = max(max(r['anchor'][0], r['img'].width - r['anchor'][0]) for _, rs, *_ in placed for r in rs)
    up = max(r['anchor'][1] for _, rs, *_ in placed for r in rs)
    down = max(r['img'].height - r['anchor'][1] for _, rs, *_ in placed for r in rs)
    cell = (2 * math.ceil(half) + 2, math.ceil(up) + CELL_UP + math.ceil(down) + 1)
    origin = (math.ceil(half) + 1, math.ceil(up) + CELL_UP)

    sheet_w = max(sum(r['img'].width + 1 for r in rs) for _, rs, *_ in placed)
    y = 0
    rows = []
    for name, rs, ms, loop, kind in placed:
        rows.append((y, max(r['img'].height for r in rs)))
        y += rows[-1][1] + 1
    sheet = Image.new('RGBA', (sheet_w, y))
    for (name, rs, ms, loop, kind), (ry, rh) in zip(placed, rows):
        x = 0
        fl = []
        for r in rs:
            sheet.paste(apply_palette(r['img'], palette), (x, ry))
            f = {'x': x, 'y': ry, 'w': r['img'].width, 'h': r['img'].height, 'ax': round(r['anchor'][0], 1), 'ay': round(r['anchor'][1], 1)}
            if r['grip']:
                f['gx'], f['gy'] = round(r['grip'][0], 1), round(r['grip'][1], 1)
            fl.append(f)
            x += r['img'].width + 1
        a = {'loop': loop, 'ms': ms, 'anchor': kind, 'frames': fl}
        if name in STRIDE:
            a['stride'] = round(STRIDE[name] * height / 80)
        anims[name] = a

    # metrics the sim needs, measured from the frames
    walk = [frames[('walk', i)]['img'] for i in range(6)]
    climb = [frames[('climb', i)] for i in range(6)]
    hang = [frames[('hang', i)] for i in range(6)]
    metrics = {
        'height': height,
        'body': [round(statistics.median(i.width for i in walk) / 2), round(statistics.median(i.height for i in walk))],  # half width, height
        'climbHalf': max(max(r['anchor'][0], r['img'].width - r['anchor'][0]) for r in climb),
        'grip': round(statistics.median(r['anchor'][1] - r['grip'][1] for r in climb)),  # height of the higher hand above the feet
        'hang': round(statistics.median(r['img'].height - r['anchor'][1] for r in hang)),  # feet below the joined hands
    }
    manifest = {'size': list(sheet.size), 'cell': list(cell), 'origin': list(origin), 'palette': len(palette), 'metrics': metrics, 'animations': anims}
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / f'sheet{suffix}.png', optimize=False)
    (OUT / f'sheet{suffix}.json').write_text(json.dumps(manifest, indent=1) + '\n')
    return sheet, manifest


def main():
    sources, head, walk_h = build_all()
    frames = {h: {k: tight(v) for k, v in frame_set(sources, head, walk_h, h, None).items()} for h in HEIGHTS.values()}
    palette = build_palette(list(frames.values()))
    print('palette', len(palette), 'colours')
    for suffix, h in HEIGHTS.items():
        sheet, m = pack(frames[h], palette, h, suffix)
        print(f'sheet{suffix}.png', sheet.size, 'cell', m['cell'], 'metrics', m['metrics'])
        print({k: len(a['frames']) for k, a in m['animations'].items()})
        if suffix == '' and len(sys.argv) > 1:
            bg = Image.new('RGBA', sheet.size, (214, 226, 230, 255))
            bg.alpha_composite(sheet)
            bg.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST).save(sys.argv[1])


if __name__ == '__main__':
    main()
