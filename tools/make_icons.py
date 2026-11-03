"""Генерация иконок приложения «Риальто» (запускать: python3 tools/make_icons.py)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, math

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'android', 'res')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
GOLD = (245, 210, 122)
GOLD2 = (217, 169, 58)

def emblem(size, bg=True, scale=1.0):
    S = size * 4  # суперсэмплинг
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg:
        # фон: градиент «вода канала»
        grad = Image.new('RGBA', (S, S))
        gd = ImageDraw.Draw(grad)
        for y in range(S):
            t = y / S
            c = (int(18 + (11 - 18) * t), int(72 + (44 - 72) * t), int(90 + (58 - 90) * t), 255)
            gd.line([(0, y), (S, y)], fill=c)
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        img.paste(grad, (0, 0), mask)
        d = ImageDraw.Draw(img)
        # волны
        for k in range(6):
            y0 = S * (0.72 + k * 0.045)
            pts = [(x, y0 + math.sin(x / S * 12 + k) * S * 0.008) for x in range(0, S, 8)]
            d.line(pts, fill=(255, 255, 255, 16), width=max(2, S // 220))
    cx, cy = S / 2, S / 2
    u = S * 0.36 * scale
    # мост-арка
    w = max(4, int(u * 0.13))
    box = [cx - u * 1.05, cy + u * 0.05, cx + u * 1.05, cy + u * 1.75]
    d.arc(box, start=200, end=340, fill=GOLD2 + (255,), width=w)
    box2 = [cx - u * 0.85, cy + u * 0.32, cx + u * 0.85, cy + u * 1.85]
    d.arc(box2, start=205, end=335, fill=GOLD + (255,), width=max(3, int(w * 0.7)))
    # буква
    f = ImageFont.truetype(FONT, int(u * 1.55))
    txt = 'Р'
    bb = d.textbbox((0, 0), txt, font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    tx, ty = cx - tw / 2 - bb[0], cy - th / 2 - bb[1] - u * 0.32
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((tx + S * 0.01, ty + S * 0.015), txt, font=f, fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.012))
    img = Image.alpha_composite(img, shadow)
    d = ImageDraw.Draw(img)
    d.text((tx, ty), txt, font=f, fill=GOLD + (255,))
    # монетка
    r = u * 0.22
    ccx, ccy = cx + u * 0.78, cy - u * 0.62
    d.ellipse([ccx - r, ccy - r, ccx + r, ccy + r], fill=GOLD2 + (255,), outline=GOLD + (255,), width=max(2, int(r * 0.18)))
    return img.resize((size, size), Image.LANCZOS)

sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for k, s in sizes.items():
    p = os.path.join(ROOT, f'mipmap-{k}')
    os.makedirs(p, exist_ok=True)
    emblem(s).save(os.path.join(p, 'ic_launcher.png'))
os.makedirs(os.path.join(ROOT, 'drawable'), exist_ok=True)
emblem(432, bg=False, scale=0.62).save(os.path.join(ROOT, 'drawable', 'ic_launcher_fg.png'))
emblem(512).save(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'icon.png')) if os.path.isdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')) else None
print('ok')
