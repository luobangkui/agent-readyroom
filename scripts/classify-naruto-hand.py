"""Classify the bare hands at the fused hand/pouch seam from the source albedo.
Run before import-naruto-model.mjs when replacing its input GLB (requires Pillow).
The texture is read for segmentation; no image or source vertex is modified.
"""
import hashlib, io, json, struct
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'assets/imports/naruto-mingren-20260914/base_basic_pbr.glb'
data = source.read_bytes()
end = 20 + int.from_bytes(data[12:16], 'little')
doc, binary = json.loads(data[20:end]), data[end + 8:]
primitive = doc['meshes'][0]['primitives'][0]
image = doc['images'][doc['textures'][doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
view = doc['bufferViews'][image['bufferView']]
start = view.get('byteOffset', 0)
pixels = Image.open(io.BytesIO(binary[start:start + view['byteLength']])).convert('RGB')
width, height = pixels.size

def accessor(index, components):
    item = doc['accessors'][index]
    view = doc['bufferViews'][item['bufferView']]
    start = view.get('byteOffset', 0) + item.get('byteOffset', 0)
    stride = view.get('byteStride', components * 4)
    return [struct.unpack_from('<' + 'f' * components, binary, start + i * stride) for i in range(item['count'])]

positions = accessor(primitive['attributes']['POSITION'], 3)
uvs = accessor(primitive['attributes']['TEXCOORD_0'], 2)
hands = []
for i, ((x, y, z), (u, v)) in enumerate(zip(positions, uvs)):
    if not (.50 < y < .73 and abs(x) > .225):
        continue
    r, g, b = pixels.getpixel((max(0, min(width - 1, int(u * width))), max(0, min(height - 1, int(v * height)))))
    if r > 80 and g > 40 and b > 25 and r > g * 1.08 and b > g * .56:
        hands.append(i)
output = {'sourceSha256': hashlib.sha256(data).hexdigest(), 'handVertices': hands}
(source.parent / 'hand-region.json').write_text(json.dumps(output, separators=(',', ':')) + '\n')
print(f'{len(hands)} bare-hand vertices classified')
