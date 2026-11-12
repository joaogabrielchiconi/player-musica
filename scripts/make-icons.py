# Gera os ícones do app (fita K7) em icons/. Uso: python scripts/make-icons.py
from PIL import Image, ImageDraw
S = 1024
def draw(maskable):
    im = Image.new('RGB', (S, S), '#0E1626')
    d = ImageDraw.Draw(im)
    k = 0.72 if maskable else 0.88   # maskable precisa de margem maior (zona segura)
    w, h = S * k, S * k * 0.66
    x0, y0 = (S - w) / 2, (S - h) / 2
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=w * 0.07, fill='#1C2C4D', outline='#2B3C63', width=int(S * .012))
    # etiqueta
    d.rounded_rectangle([x0 + w * .07, y0 + h * .10, x0 + w * .93, y0 + h * .46], radius=w * .03, fill='#F1ECE0')
    d.rectangle([x0 + w * .07, y0 + h * .27, x0 + w * .93, y0 + h * .31], fill='#FF6B2C')
    # janela com carretéis
    d.rounded_rectangle([x0 + w * .14, y0 + h * .52, x0 + w * .86, y0 + h * .86], radius=h * .17, fill='#0E1626')
    cy = y0 + h * .69
    for cx, r in ((x0 + w * .31, h * .135), (x0 + w * .69, h * .135)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill='#FF6B2C')
        q = r * .45
        d.ellipse([cx - q, cy - q, cx + q, cy + q], fill='#0E1626')
    return im
draw(False).resize((180, 180), Image.LANCZOS).save('icons/icon-180.png')
for n in (192, 512):
    draw(False).resize((n, n), Image.LANCZOS).save(f'icons/icon-{n}.png')
draw(True).resize((512, 512), Image.LANCZOS).save('icons/icon-maskable-512.png')
