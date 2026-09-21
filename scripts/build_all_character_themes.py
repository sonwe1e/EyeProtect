import os
from PIL import Image, ImageDraw
import numpy as np

# Load base frames extracted from original 奋斗猫
def get_base_frame(anim, idx):
    path = os.path.join('data', 'custom-pet', f'{anim}.gif')
    im = Image.open(path)
    im.seek(idx)
    return im.convert('RGBA')

# --- SHIBA INU (柴犬) ---
def process_shiba_frame(cat_frame, anim, idx):
    arr = np.array(cat_frame)
    h, w, _ = arr.shape
    
    # 1. Smooth forehead & cheek stripes into golden tan
    # In idle, head is x in [120, 310], y in [100, 290]
    # In sleep, head is x in [110, 330], y in [130, 270]
    # In fidget, head is x in [150, 360], y in [100, 260]
    # In click, head is x in [90, 320], y in [40, 280]
    
    for y in range(h):
        for x in range(w):
            r, g, b, a = arr[y, x]
            if a < 120:
                continue
            if r < 35 and g < 35 and b < 35:
                continue # outline
            # Stripe color
            if 125 <= r <= 228 and 35 <= g <= 135 and 10 <= b <= 85:
                arr[y, x] = [242, 146, 56, 255]
            elif 229 <= r <= 255 and 115 <= g <= 195 and 25 <= b <= 100:
                arr[y, x] = [246, 154, 65, 255]
            # Inner ear pink -> soft cream fluff (only in upper head area)
            elif y < h * 0.45 and r > 215 and 115 < g < 190 and 135 < b < 215:
                arr[y, x] = [252, 246, 238, 255]
                
    res = Image.fromarray(arr)
    draw = ImageDraw.Draw(res)
    
    if anim == 'idle':
        # Eyebrows
        draw.ellipse([166, 193, 180, 204], fill=(254, 250, 244, 255))
        draw.ellipse([240, 193, 254, 204], fill=(254, 250, 244, 255))
        # Mug: replace paw with bone
        draw.rectangle([336, 326, 380, 365], fill=(255, 255, 255, 255))
        draw.rectangle([344, 342, 370, 350], fill=(235, 120, 35, 255))
        draw.ellipse([338, 337, 348, 347], fill=(235, 120, 35, 255))
        draw.ellipse([338, 345, 348, 355], fill=(235, 120, 35, 255))
        draw.ellipse([366, 337, 376, 347], fill=(235, 120, 35, 255))
        draw.ellipse([366, 345, 376, 355], fill=(235, 120, 35, 255))
        # Laptop: replace cat with bone
        draw.ellipse([175, 318, 205, 342], fill=(102, 97, 116, 255))
        draw.rectangle([183, 328, 197, 332], fill=(210, 205, 220, 255))
        draw.ellipse([180, 325, 186, 331], fill=(210, 205, 220, 255))
        draw.ellipse([180, 329, 186, 335], fill=(210, 205, 220, 255))
        draw.ellipse([194, 325, 200, 331], fill=(210, 205, 220, 255))
        draw.ellipse([194, 329, 200, 335], fill=(210, 205, 220, 255))
        # Tail curled
        draw.ellipse([325, 260, 355, 290], fill=(14, 11, 21, 255))
        draw.ellipse([328, 263, 352, 287], fill=(240, 145, 58, 255))
        draw.ellipse([334, 268, 346, 280], fill=(14, 11, 21, 255))
        draw.ellipse([342, 262, 354, 276], fill=(252, 248, 242, 255))
        
    elif anim == 'sleep':
        # Head slumped, eyebrows
        draw.ellipse([154, 187, 166, 197], fill=(254, 250, 244, 255))
        draw.ellipse([244, 187, 256, 197], fill=(254, 250, 244, 255))
        # Mug bone
        draw.rectangle([338, 326, 384, 365], fill=(255, 255, 255, 255))
        draw.rectangle([348, 342, 374, 350], fill=(235, 120, 35, 255))
        draw.ellipse([342, 337, 352, 347], fill=(235, 120, 35, 255))
        draw.ellipse([342, 345, 352, 355], fill=(235, 120, 35, 255))
        draw.ellipse([370, 337, 380, 347], fill=(235, 120, 35, 255))
        draw.ellipse([370, 345, 380, 355], fill=(235, 120, 35, 255))
        # Laptop
        draw.ellipse([180, 316, 212, 340], fill=(102, 97, 116, 255))
        draw.rectangle([188, 326, 204, 330], fill=(210, 205, 220, 255))
        
    elif anim == 'fidget':
        # Bed scene eyebrows
        draw.ellipse([214, 145, 226, 155], fill=(254, 250, 244, 255))
        draw.ellipse([289, 145, 301, 155], fill=(254, 250, 244, 255))
        
    elif anim == 'click':
        # Sitting eyebrows
        draw.ellipse([146, 131, 162, 143], fill=(254, 250, 244, 255))
        draw.ellipse([239, 131, 255, 143], fill=(254, 250, 244, 255))
        # Tail curled with white tip
        draw.ellipse([345, 225, 375, 255], fill=(14, 11, 21, 255))
        draw.ellipse([348, 228, 372, 252], fill=(245, 150, 60, 255))
        draw.ellipse([355, 232, 367, 244], fill=(14, 11, 21, 255))
        draw.ellipse([360, 226, 372, 238], fill=(252, 248, 242, 255))
        
    return res

# --- WHITE RABBIT (白兔) ---
def process_rabbit_frame(cat_frame, anim, idx):
    arr = np.array(cat_frame)
    h, w, _ = arr.shape
    
    # 1. Turn fur into pure white / soft lavender cream
    for y in range(h):
        for x in range(w):
            r, g, b, a = arr[y, x]
            if a < 120:
                continue
            if r < 35 and g < 35 and b < 35:
                continue # outline
            # Blush
            if r > 215 and 125 < g < 190 and 150 < b < 215 and y > h * 0.35:
                arr[y, x] = [255, 145, 170, 255]
                continue
            # Inner ear pink (keep and brighten)
            if y < h * 0.45 and r > 215 and 115 < g < 190 and 135 < b < 215:
                arr[y, x] = [255, 170, 190, 255]
                continue
            # Any orange / stripe fur
            if (r > 120 and g > 35 and b < 110) or (r > 200 and g > 110 and b < 150):
                # Don't change mug or desk
                if anim in ['idle', 'sleep'] and ((y > 365) or (x > 320 and y > 310) or (x < 115 and y > 275)):
                    continue
                # Lower shadow
                if y > h * 0.65 and (x < w * 0.35 or x > w * 0.65):
                    arr[y, x] = [228, 222, 238, 255]
                else:
                    arr[y, x] = [252, 250, 255, 255]
            elif r > 235 and g > 190 and b > 120:
                if anim in ['idle', 'sleep'] and ((y > 365) or (x > 320 and y > 310) or (x < 115 and y > 275)):
                    continue
                arr[y, x] = [255, 255, 255, 255]
                
    res = Image.fromarray(arr)
    draw = ImageDraw.Draw(res)
    ink = (14, 11, 21, 255)
    fur_white = (252, 250, 255, 255)
    pink_inner = (255, 170, 190, 255)
    
    if anim == 'idle':
        # Mug: replace paw with carrot
        draw.rectangle([336, 326, 380, 365], fill=(255, 255, 255, 255))
        # Green carrot leaves
        draw.polygon([(356, 332), (353, 339), (360, 339)], fill=(65, 180, 75, 255))
        draw.polygon([(360, 330), (358, 339), (363, 339)], fill=(85, 205, 95, 255))
        draw.polygon([(364, 333), (361, 339), (367, 339)], fill=(65, 180, 75, 255))
        # Orange carrot
        draw.polygon([(352, 339), (368, 339), (360, 362)], fill=(250, 115, 25, 255))
        draw.line([(355, 344), (363, 344)], fill=(255, 160, 60, 255), width=2)
        draw.line([(356, 350), (362, 350)], fill=(255, 160, 60, 255), width=2)
        # Laptop carrot logo
        draw.ellipse([175, 318, 205, 342], fill=(102, 97, 116, 255))
        draw.polygon([(186, 326), (194, 326), (190, 338)], fill=(240, 235, 245, 255))
        # Bunny tall ears extending upwards
        draw.ellipse([136, 50, 172, 140], fill=ink)
        draw.ellipse([140, 54, 168, 136], fill=fur_white)
        draw.ellipse([146, 62, 162, 126], fill=pink_inner)
        draw.ellipse([248, 50, 284, 140], fill=ink)
        draw.ellipse([252, 54, 280, 136], fill=fur_white)
        draw.ellipse([258, 62, 274, 126], fill=pink_inner)
        
    elif anim == 'sleep':
        # Mug carrot
        draw.rectangle([338, 326, 384, 365], fill=(255, 255, 255, 255))
        draw.polygon([(358, 332), (355, 339), (362, 339)], fill=(65, 180, 75, 255))
        draw.polygon([(362, 330), (360, 339), (365, 339)], fill=(85, 205, 95, 255))
        draw.polygon([(366, 333), (363, 339), (369, 339)], fill=(65, 180, 75, 255))
        draw.polygon([(354, 339), (370, 339), (362, 362)], fill=(250, 115, 25, 255))
        # Laptop
        draw.ellipse([180, 316, 212, 340], fill=(102, 97, 116, 255))
        draw.polygon([(192, 323), (200, 323), (196, 335)], fill=(240, 235, 245, 255))
        
    elif anim == 'click':
        # Rabbit tail
        draw.ellipse([335, 240, 375, 280], fill=ink)
        draw.ellipse([338, 243, 372, 277], fill=fur_white)
        # Rabbit ears
        draw.ellipse([108, 12, 150, 100], fill=ink)
        draw.ellipse([112, 16, 146, 96], fill=fur_white)
        draw.ellipse([118, 24, 140, 88], fill=pink_inner)
        draw.ellipse([250, 12, 292, 100], fill=ink)
        draw.ellipse([254, 16, 288, 96], fill=fur_white)
        draw.ellipse([260, 24, 282, 88], fill=pink_inner)
        
    return res

# --- HAMSTER (仓鼠) ---
def process_hamster_frame(cat_frame, anim, idx):
    arr = np.array(cat_frame)
    h, w, _ = arr.shape
    
    # 1. Turn fur into warm honey-buff with white belly/cheeks
    for y in range(h):
        for x in range(w):
            r, g, b, a = arr[y, x]
            if a < 120:
                continue
            if r < 35 and g < 35 and b < 35:
                continue # outline
            # Big chubby blush
            if r > 215 and 125 < g < 190 and 150 < b < 215 and y > h * 0.35:
                arr[y, x] = [255, 135, 160, 255]
                continue
            # Ear center
            if y < h * 0.45 and r > 215 and 115 < g < 190 and 135 < b < 215:
                arr[y, x] = [255, 175, 195, 255]
                continue
            # Stripes -> smooth buff
            if 125 <= r <= 228 and 35 <= g <= 135 and 10 <= b <= 85:
                if anim in ['idle', 'sleep'] and ((y > 365) or (x > 320 and y > 310) or (x < 115 and y > 275)):
                    continue
                arr[y, x] = [245, 175, 95, 255]
            elif 229 <= r <= 255 and 115 <= g <= 195 and 25 <= b <= 100:
                if anim in ['idle', 'sleep'] and ((y > 365) or (x > 320 and y > 310) or (x < 115 and y > 275)):
                    continue
                arr[y, x] = [250, 185, 105, 255]
            elif r > 235 and g > 190 and b > 120:
                if anim in ['idle', 'sleep'] and ((y > 365) or (x > 320 and y > 310) or (x < 115 and y > 275)):
                    continue
                arr[y, x] = [255, 250, 242, 255]
                
    res = Image.fromarray(arr)
    draw = ImageDraw.Draw(res)
    ink = (14, 11, 21, 255)
    fur_buff = (250, 185, 105, 255)
    pink_inner = (255, 175, 195, 255)
    
    if anim == 'idle':
        # Mug: sunflower seed
        draw.rectangle([336, 326, 380, 365], fill=(255, 255, 255, 255))
        # Sunflower seed (black/white striped seed)
        draw.ellipse([348, 335, 368, 359], fill=(25, 20, 25, 255))
        draw.ellipse([351, 337, 365, 357], fill=(240, 235, 225, 255))
        draw.line([(358, 336), (358, 358)], fill=(25, 20, 25, 255), width=2)
        # Laptop: sunflower seed logo
        draw.ellipse([175, 318, 205, 342], fill=(102, 97, 116, 255))
        draw.ellipse([186, 324, 194, 338], fill=(240, 235, 225, 255))
        draw.line([(190, 324), (190, 338)], fill=(102, 97, 116, 255), width=2)
        # Round ears on head
        draw.ellipse([125, 100, 165, 140], fill=ink)
        draw.ellipse([128, 103, 162, 137], fill=fur_buff)
        draw.ellipse([135, 110, 155, 130], fill=pink_inner)
        draw.ellipse([255, 100, 295, 140], fill=ink)
        draw.ellipse([258, 103, 292, 137], fill=fur_buff)
        draw.ellipse([265, 110, 285, 130], fill=pink_inner)
        
    elif anim == 'sleep':
        # Mug sunflower seed
        draw.rectangle([338, 326, 384, 365], fill=(255, 255, 255, 255))
        draw.ellipse([350, 335, 370, 359], fill=(25, 20, 25, 255))
        draw.ellipse([353, 337, 367, 357], fill=(240, 235, 225, 255))
        draw.line([(360, 336), (360, 358)], fill=(25, 20, 25, 255), width=2)
        # Laptop
        draw.ellipse([180, 316, 212, 340], fill=(102, 97, 116, 255))
        draw.ellipse([192, 322, 200, 336], fill=(240, 235, 225, 255))
        
    elif anim == 'click':
        # Tiny round hamster tail
        draw.ellipse([335, 245, 365, 275], fill=ink)
        draw.ellipse([338, 248, 362, 272], fill=fur_buff)
        # Hamster round ears
        draw.ellipse([98, 48, 142, 92], fill=ink)
        draw.ellipse([102, 52, 138, 88], fill=fur_buff)
        draw.ellipse([110, 60, 130, 80], fill=pink_inner)
        draw.ellipse([258, 48, 302, 92], fill=ink)
        draw.ellipse([262, 52, 298, 88], fill=fur_buff)
        draw.ellipse([270, 60, 290, 80], fill=pink_inner)
        # Chubby cheeks blush
        draw.ellipse([105, 170, 155, 210], fill=(255, 135, 160, 255))
        draw.ellipse([245, 170, 295, 210], fill=(255, 135, 160, 255))
        
    return res

def save_animated_gif(frames, out_path, duration):
    p_frames = []
    for f in frames:
        alpha = f.split()[3]
        p_img = f.convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=255)
        mask = Image.eval(alpha, lambda a: 255 if a < 128 else 0)
        p_img.paste(255, mask)
        p_img.info['transparency'] = 255
        p_frames.append(p_img)
        
    p_frames[0].save(
        out_path,
        save_all=True,
        append_images=p_frames[1:],
        duration=duration,
        loop=0,
        disposal=2,
        transparency=255
    )

def build_all_themes():
    themes = {
        'dog': process_shiba_frame,
        'rabbit': process_rabbit_frame,
        'hamster': process_hamster_frame
    }
    
    actions = {
        'idle': 120,
        'sleep': 140,
        'fidget': 140,
        'click': 140
    }
    
    for theme_id, processor in themes.items():
        out_dir = os.path.join('data', 'custom-pet', theme_id)
        os.makedirs(out_dir, exist_ok=True)
        print(f'Building theme: {theme_id} in {out_dir}...')
        
        for anim, duration in actions.items():
            frames = []
            for i in range(8):
                cat_im = get_base_frame(anim, i)
                processed = processor(cat_im, anim, i)
                frames.append(processed)
                
            out_path = os.path.join(out_dir, f'{anim}.gif')
            save_animated_gif(frames, out_path, duration)
            print(f'  Generated {anim}.gif ({len(frames)} frames)')
            
    print('All custom pet themes generated successfully!')

if __name__ == '__main__':
    build_all_themes()
