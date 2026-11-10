import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# 6x9 pixel grid for each character:
# 3: Highlight, 2: Bright tone, 1: Mid tone, ' ': Empty

I_letter = [
    '333333',
    '333333',
    '  32  ',
    '  22  ',
    '  22  ',
    '  12  ',
    '  11  ',
    '111111',
    '111111'
]

O_letter = [
    ' 3333 ',
    '333333',
    '32  32',
    '22  22',
    '22  22',
    '12  12',
    '11  11',
    '111111',
    ' 1111 '
]

E_letter = [
    '333333',
    '333333',
    '32    ',
    '22222 ',
    '22222 ',
    '12    ',
    '11    ',
    '111111',
    '111111'
]

X_letter = [
    '33  33',
    '33  33',
    ' 3232 ',
    '  22  ',
    '  22  ',
    ' 1212 ',
    '11  11',
    '11  11',
    '11  11'
]

T_letter = [
    '333333',
    '333333',
    '  32  ',
    '  22  ',
    '  22  ',
    '  12  ',
    '  11  ',
    '  11  ',
    '  11  '
]

N_letter = [
    '33  33',
    '333 33',
    '323 32',
    '222222',
    '222222',
    '12 212',
    '11 111',
    '11  11',
    '11  11'
]

D_letter = [
    '33333 ',
    '333333',
    '32  32',
    '22  22',
    '22  22',
    '12  12',
    '11  11',
    '111111',
    '11111 '
]

# Color palettes of the triad:
# Revit: Gold / Amber
# Navisworks: Azure Blue
# IFC: Electric Violet
amber_shades = {
    0: (122, 74, 18),    # shadow
    1: (201, 122, 43),   # mid
    2: (242, 163, 58),   # bright
    3: (255, 216, 74)    # highlight
}

blue_shades = {
    0: (11, 27, 61),     # shadow
    1: (29, 78, 216),    # mid
    2: (59, 130, 246),   # bright
    3: (147, 197, 253)   # highlight
}

violet_shades = {
    0: (46, 16, 101),    # shadow
    1: (126, 34, 206),   # mid
    2: (168, 85, 247),   # bright
    3: (216, 180, 254)   # highlight
}

cyan_shades = {
    0: (6, 38, 56),      # shadow
    1: (8, 145, 178),    # mid
    2: (6, 182, 212),    # bright
    3: (165, 243, 252)   # highlight
}

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rgb_to_hex(rgb):
    return f"#{int(rgb[0]):02x}{int(rgb[1]):02x}{int(rgb[2]):02x}"

def interpolate_rgb(c1, c2, t):
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(3))

def build_avatar(mode="spectrum", size=512):
    """
    Renders a 512x512 avatar for IOExtend.
    mode can be:
      - 'spectrum': smooth horizontal transition (Amber -> Azure Blue -> Electric Violet)
      - 'triad': I in Blue, O in Violet, shadow extrusion in Amber
      - 'cyan_violet': futuristic cyan & violet cyber gradient
    """
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded rectangle background #12161C
    rx = 80
    bg_color = (18, 22, 28, 255)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=rx, fill=bg_color)

    # Optional subtle outer border ring
    border_color = (34, 42, 54, 255)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=rx, outline=border_color, width=2)

    # Letters to render: I and O
    letters = [I_letter, O_letter]
    block_size = 24
    spacing = 2 * block_size  # 48 px
    letter_w = 6 * block_size # 144 px
    letter_h = 9 * block_size # 216 px
    total_w = 2 * letter_w + spacing # 336 px

    # Shadow offset (6 steps diagonal)
    shadow_steps = 6
    shadow_step_px = 3

    # Center glyph in canvas
    start_x = (size - total_w - shadow_steps * shadow_step_px) // 2
    start_y = (size - letter_h - shadow_steps * shadow_step_px) // 2

    base_xs = [start_x, start_x + letter_w + spacing]

    # Precalculate column positions for palette mapping
    # Total column count = 6 + 2 + 6 = 14 columns
    # We assign palette shades based on mode

    # 1. First pass: render shadow extrusion (from back to front)
    for step in range(shadow_steps, 0, -1):
        sox = step * shadow_step_px
        soy = step * shadow_step_px
        for l_idx, letter in enumerate(letters):
            ox = base_xs[l_idx] + sox
            oy = start_y + soy
            for r in range(9):
                for c in range(6):
                    ch = letter[r][c]
                    if ch in ('1', '2', '3'):
                        # determine shadow color
                        col_global = (l_idx * 8 + c) / 13.0
                        if mode == 'spectrum':
                            if col_global < 0.5:
                                t = col_global / 0.5
                                sc = interpolate_rgb(amber_shades[0], blue_shades[0], t)
                            else:
                                t = (col_global - 0.5) / 0.5
                                sc = interpolate_rgb(blue_shades[0], violet_shades[0], t)
                        elif mode == 'triad':
                            # shadow in Amber for both or triad base
                            sc = amber_shades[0]
                        else: # cyan_violet
                            sc = interpolate_rgb(cyan_shades[0], violet_shades[0], col_global)

                        x1 = ox + c * block_size
                        y1 = oy + r * block_size
                        x2 = x1 + block_size - 1
                        y2 = y1 + block_size - 1
                        draw.rectangle([x1, y1, x2, y2], fill=(*sc, 255))

    # 2. Second pass: render front face blocks
    for l_idx, letter in enumerate(letters):
        ox = base_xs[l_idx]
        oy = start_y
        for r in range(9):
            for c in range(6):
                ch = letter[r][c]
                if ch in ('1', '2', '3'):
                    tone_idx = int(ch)
                    col_global = (l_idx * 8 + c) / 13.0

                    if mode == 'spectrum':
                        if col_global < 0.5:
                            t = col_global / 0.5
                            c1 = amber_shades[tone_idx]
                            c2 = blue_shades[tone_idx]
                            color = interpolate_rgb(c1, c2, t)
                        else:
                            t = (col_global - 0.5) / 0.5
                            c1 = blue_shades[tone_idx]
                            c2 = violet_shades[tone_idx]
                            color = interpolate_rgb(c1, c2, t)
                    elif mode == 'triad':
                        if l_idx == 0:
                            color = blue_shades[tone_idx] # I in Azure Blue
                        else:
                            color = violet_shades[tone_idx] # O in Electric Violet
                    else: # cyan_violet
                        c1 = cyan_shades[tone_idx]
                        c2 = violet_shades[tone_idx]
                        color = interpolate_rgb(c1, c2, col_global)

                    x1 = ox + c * block_size
                    y1 = oy + r * block_size
                    x2 = x1 + block_size - 1
                    y2 = y1 + block_size - 1
                    draw.rectangle([x1, y1, x2, y2], fill=(*color, 255))

    return img


def build_banner(width=1280, height=360):
    """
    Renders a stunning 1280x360 organization hero banner.
    Displays 'IOEXTEND' in voxel art with color spectrum,
    accompanied by ecosystem tags: Revit (RvtIO) | Navisworks (NwcIO) | IFC (IfcIO).
    """
    img = Image.new('RGB', (width, height), (18, 22, 28))
    draw = ImageDraw.Draw(img)

    # Word: I O E X T E N D
    word = [I_letter, O_letter, E_letter, X_letter, T_letter, E_letter, N_letter, D_letter]
    num_letters = len(word)
    block_size = 18
    shadow_steps = 6
    shadow_step_px = 3

    # spacing between letters
    # letter width = 6 * 18 = 108 px
    # gap between I-O and EXTEND can be slightly wider
    gaps = [
        36, # after I
        64, # gap between IO and EXTEND
        28, # E-X
        28, # X-T
        28, # T-E
        28, # E-N
        28, # N-D
    ]

    total_text_w = num_letters * (6 * block_size) + sum(gaps)
    start_x = (width - total_text_w - shadow_steps * shadow_step_px) // 2
    start_y = 68

    xs = []
    curr_x = start_x
    for i in range(num_letters):
        xs.append(curr_x)
        curr_x += 6 * block_size
        if i < len(gaps):
            curr_x += gaps[i]

    total_cols = (xs[-1] + 6 * block_size - start_x)

    # 1. Shadow extrusion
    for step in range(shadow_steps, 0, -1):
        sox = step * shadow_step_px
        soy = step * shadow_step_px
        for l_idx, letter in enumerate(word):
            ox = xs[l_idx] + sox
            oy = start_y + soy
            for r in range(9):
                for c in range(6):
                    ch = letter[r][c]
                    if ch in ('1', '2', '3'):
                        norm_pos = (xs[l_idx] + c * block_size - start_x) / float(total_text_w)
                        if norm_pos < 0.4:
                            t = norm_pos / 0.4
                            sc = interpolate_rgb(amber_shades[0], blue_shades[0], t)
                        else:
                            t = (norm_pos - 0.4) / 0.6
                            sc = interpolate_rgb(blue_shades[0], violet_shades[0], t)

                        x1 = ox + c * block_size
                        y1 = oy + r * block_size
                        x2 = x1 + block_size - 1
                        y2 = y1 + block_size - 1
                        draw.rectangle([x1, y1, x2, y2], fill=sc)

    # 2. Front face
    for l_idx, letter in enumerate(word):
        ox = xs[l_idx]
        oy = start_y
        for r in range(9):
            for c in range(6):
                ch = letter[r][c]
                if ch in ('1', '2', '3'):
                    tone_idx = int(ch)
                    norm_pos = (xs[l_idx] + c * block_size - start_x) / float(total_text_w)
                    if norm_pos < 0.4:
                        t = norm_pos / 0.4
                        c1 = amber_shades[tone_idx]
                        c2 = blue_shades[tone_idx]
                        col = interpolate_rgb(c1, c2, t)
                    else:
                        t = (norm_pos - 0.4) / 0.6
                        c1 = blue_shades[tone_idx]
                        c2 = violet_shades[tone_idx]
                        col = interpolate_rgb(c1, c2, t)

                    x1 = ox + c * block_size
                    y1 = oy + r * block_size
                    x2 = x1 + block_size - 1
                    y2 = y1 + block_size - 1
                    draw.rectangle([x1, y1, x2, y2], fill=col)

    # Draw bottom accent color line
    bar_y = 265
    bar_w = 900
    bar_x = (width - bar_w) // 2
    for x in range(bar_w):
        norm = x / float(bar_w)
        if norm < 0.33:
            t = norm / 0.33
            c = interpolate_rgb(amber_shades[2], amber_shades[1], t)
        elif norm < 0.66:
            t = (norm - 0.33) / 0.33
            c = interpolate_rgb(blue_shades[2], cyan_shades[2], t)
        else:
            t = (norm - 0.66) / 0.34
            c = interpolate_rgb(violet_shades[2], violet_shades[1], t)
        draw.line([(bar_x + x, bar_y), (bar_x + x, bar_y + 3)], fill=c)

    return img

def main():
    out_dir = r'C:\Users\maxah\source\repos\IOExtend-github\profile'
    os.makedirs(out_dir, exist_ok=True)

    # 1. Avatar options
    # Spectrum (Amber -> Blue -> Violet)
    av_spectrum = build_avatar(mode="spectrum", size=512)
    av_spectrum.save(os.path.join(out_dir, 'avatar.png'))
    av_spectrum.save(os.path.join(out_dir, 'avatar-spectrum.png'))
    print("Saved avatar.png (spectrum)")

    # Triad Split (Blue 'I', Violet 'O', Amber shadow)
    av_triad = build_avatar(mode="triad", size=512)
    av_triad.save(os.path.join(out_dir, 'avatar-triad.png'))
    print("Saved avatar-triad.png")

    # Cyber Cyan / Violet
    av_cyber = build_avatar(mode="cyan_violet", size=512)
    av_cyber.save(os.path.join(out_dir, 'avatar-cyber.png'))
    print("Saved avatar-cyber.png")

    # 2. Hero Banner (1280x360)
    banner = build_banner(1280, 360)
    banner.save(os.path.join(out_dir, 'banner.png'))
    print("Saved banner.png")

if __name__ == '__main__':
    main()
