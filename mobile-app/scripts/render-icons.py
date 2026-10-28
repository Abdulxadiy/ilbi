"""Render the approved ILBI vector mark; requires CairoSVG in a developer environment."""
from pathlib import Path
import re
import cairosvg
root = Path(__file__).resolve().parents[1]
source = root.parent / 'branding/mobile-concepts/v4/ilbi-mark.svg'
original = source.read_text()
inner = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', original)

def render(name, size, mark_size, background=None, monochrome=False, light=False):
    mark = inner
    if monochrome:
        mark = re.sub(r'fill="[^"]+"', 'fill="#000000"', mark)
        mark = re.sub(r'stop-color="[^"]+"', 'stop-color="#000000"', mark)
    elif light:
        mark = mark.replace('#141820', '#F0EFEB')
    offset = (size - mark_size) / 2
    canvas = f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
    if background: canvas += f'<rect width="{size}" height="{size}" fill="{background}"/>'
    canvas += f'<g transform="translate({offset},{offset}) scale({mark_size / 280})">{mark}</g></svg>'
    cairosvg.svg2png(bytestring=canvas.encode(), write_to=str(root / 'assets' / name), output_width=size, output_height=size)

render('icon.png', 1024, 700, '#F0EFEB')
render('android-icon-foreground.png', 1024, 604)
render('android-icon-monochrome.png', 1024, 604, monochrome=True)
render('android-icon-background.png', 1024, 0, '#F0EFEB')
render('splash-icon.png', 1024, 700)
render('favicon.png', 64, 56, '#F0EFEB')
print('Rendered ILBI icon, adaptive layers, monochrome, splash mark and favicon from approved vector.')
