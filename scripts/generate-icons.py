from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "icons"
SCALE = 8


def cubic(p0, p1, p2, p3, count=48):
    points = []
    for index in range(count + 1):
        t = index / count
        mt = 1 - t
        points.append((
            mt ** 3 * p0[0] + 3 * mt ** 2 * t * p1[0] + 3 * mt * t ** 2 * p2[0] + t ** 3 * p3[0],
            mt ** 3 * p0[1] + 3 * mt ** 2 * t * p1[1] + 3 * mt * t ** 2 * p2[1] + t ** 3 * p3[1],
        ))
    return points


def scaled(points):
    return [(round(x * SCALE), round(y * SCALE)) for x, y in points]


def make_icon():
    size = 128 * SCALE
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()
    top = (11, 95, 89)
    bottom = (20, 184, 166)
    for y in range(size):
        ratio = y / max(size - 1, 1)
        color = tuple(round(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(3)) + (255,)
        for x in range(size):
            pixels[x, y] = color

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((4 * SCALE, 4 * SCALE, 124 * SCALE, 124 * SCALE), radius=29 * SCALE, fill=255)
    image.putalpha(mask)
    draw = ImageDraw.Draw(image)
    white = (255, 255, 255, 255)
    mint = (153, 246, 228, 255)
    width = 9 * SCALE

    draw.line(scaled([(43, 27), (43, 101)]), fill=white, width=width)
    top_curve = cubic((43, 37), (77, 35), (92, 40), (92, 57)) + cubic((92, 57), (92, 72), (75, 76), (43, 76))[1:]
    lower_curve = cubic((43, 65), (80, 63), (99, 70), (99, 85)) + cubic((99, 85), (99, 100), (80, 103), (43, 103))[1:]
    draw.line(scaled(top_curve), fill=white, width=width, joint="curve")
    draw.line(scaled(lower_curve), fill=white, width=width, joint="curve")
    for x, y in ((92, 57), (99, 85)):
        draw.ellipse(((x - 10) * SCALE, (y - 10) * SCALE, (x + 10) * SCALE, (y + 10) * SCALE), fill=white)
        draw.ellipse(((x - 6) * SCALE, (y - 6) * SCALE, (x + 6) * SCALE, (y + 6) * SCALE), fill=mint)
    return image


OUT.mkdir(parents=True, exist_ok=True)
master = make_icon()
for icon_size in (16, 32, 48, 128):
    resized = master.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    resized.save(OUT / f"icon-{icon_size}.png", optimize=True)
