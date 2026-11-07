"""Helpers for turning Gemini images on flat magenta (#FF00FF) into game sprites (Pillow only).

    key(im)         alpha from the magenta component, with despill
    crop_alpha(im)  crop to the visible pixels
    fit(im, w)      shrink to a max width
    tileable(im)    cross-fade the right edge into the left so a layer repeats without a seam
"""
from PIL import Image, ImageChops


def key(im, lo=18, hi=200):
    r, g, b = im.convert('RGB').split()
    s = ImageChops.subtract(ImageChops.darker(r, b), g)  # magenta component, clipped at 0
    alpha = s.point(lambda v: 255 - max(0, min(255, round((v - lo) * 255 / (hi - lo)))))
    return Image.merge('RGBA', (ImageChops.subtract(r, s), g, ImageChops.subtract(b, s), alpha))


def crop_alpha(im, pad=8, threshold=8):
    x0, y0, x1, y1 = im.getchannel('A').point(lambda v: 255 if v > threshold else 0).getbbox()
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def fit(im, max_w):
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    return im


def tileable(im, frac=0.18):
    im = im.convert('RGBA')
    W, H = im.size
    N = int(W * frac)
    out = im.crop((0, 0, W - N, H))
    tail = im.crop((W - N, 0, W, H))
    ramp = Image.linear_gradient('L').rotate(-90, expand=True).resize((N, H))  # 255 at the left
    out.paste(Image.composite(tail, out.crop((0, 0, N, H)), ramp), (0, 0))
    return out
