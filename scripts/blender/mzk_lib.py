"""Shared helpers for the Mizukage office rig build.

Coordinate contract
-------------------
The source GLB is +Y up / +Z forward.  Blender's glTF importer converts that to
+Z up / -Y forward, and the exporter converts straight back, so everything in
this file is authored in Blender space (Z = height, -Y = facing direction).

The office contract in ../.. (项目根) expects the model in
*scaled* glTF space: X and Z recentred, then multiplied by SCALE.
"""

import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

SCALE = 1.18
SRC_CENTER_X = 0.00011020898818969727
SRC_CENTER_Z = 0.0010202527046203613

# glTF-space joint heads at SCALE = 1 (the layout the office contract already
# ships, kept identical so seat geometry and clip semantics stay comparable).
JOINTS_GLTF = [
    ("Root", None, (0, 0, 0)),
    ("Hips", "Root", (0, 0.72, 0)),
    ("Spine", "Hips", (0, 0.40, 0)),
    ("Chest", "Spine", (0, 0.31, 0)),
    ("Neck", "Chest", (0, 0.15, 0)),
    ("Head", "Neck", (0, 0.38, 0)),
]

for _side, _s in (("Left", 1), ("Right", -1)):
    JOINTS_GLTF += [
        (f"{_side}UpperLeg", "Hips", (_s * 0.16, -0.10, 0)),
        (f"{_side}LowerLeg", f"{_side}UpperLeg", (0, -0.34, 0)),
        (f"{_side}Foot", f"{_side}LowerLeg", (0, -0.23, 0.02)),
        (f"{_side}UpperArm", "Chest", (_s * 0.22, 0.18, 0)),
        (f"{_side}ForeArm", f"{_side}UpperArm", (_s * 0.18, -0.22, 0)),
        (f"{_side}Hand", f"{_side}ForeArm", (_s * 0.12, -0.20, 0)),
    ]

# Absolute glTF-space rest heads, cumulative along the parent chain.
def gltf_heads():
    absolute, out = {}, []
    for name, parent, delta in JOINTS_GLTF:
        base = absolute[parent] if parent else Vector((0.0, 0.0, 0.0))
        head = base + Vector(delta)
        absolute[name] = head
        out.append((name, parent, head))
    return out


JOINT_NAMES = [name for name, _, _ in JOINTS_GLTF]


def gltf_to_blender(point):
    """glTF (x, y, z) -> Blender (x, -z, y)."""
    return Vector((point[0], -point[2], point[1]))


def contract_point(point):
    """Source glTF point -> scaled, recentred contract space (still glTF axes)."""
    return Vector(
        (
            (point[0] - SRC_CENTER_X) * SCALE,
            point[1] * SCALE,
            (point[2] - SRC_CENTER_Z) * SCALE,
        )
    )


def rest_heads_blender():
    """Scaled rest head positions in Blender space, keyed by bone name."""
    out = {}
    for name, _parent, head in gltf_heads():
        out[name] = gltf_to_blender(contract_point(head))
    return out


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def import_source(path):
    """Import the source GLB and return its single mesh object."""
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"expected one source mesh, found {len(meshes)}")
    return meshes[0]


def apply_contract_transform(obj):
    """Rebuild the mesh data in scaled/recentred contract space (Blender axes)."""
    mesh = obj.data
    count = len(mesh.vertices)
    co = np.empty(count * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(count, 3).astype(np.float64)
    # Blender (x, y, z) == glTF (x, -z, y)
    gx, gy, gz = co[:, 0], co[:, 2], -co[:, 1]
    co[:, 0] = (gx - SRC_CENTER_X) * SCALE
    co[:, 1] = -(gz - SRC_CENTER_Z) * SCALE
    co[:, 2] = gy * SCALE
    mesh.vertices.foreach_set("co", co.reshape(-1).astype(np.float32))
    mesh.update()
    obj.matrix_world = Matrix.Identity(4)
    return obj


# --------------------------------------------------------------------------
# surface classification
# --------------------------------------------------------------------------

HAIR, SKIN, ROBE, ACCENT, DARK, OTHER = range(6)
SURFACE_NAMES = {HAIR: "hair", SKIN: "skin", ROBE: "robe", ACCENT: "accent", DARK: "dark", OTHER: "other"}


def base_colour_image(obj):
    for slot in obj.material_slots:
        material = slot.material
        if not material or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            link = node.inputs["Base Color"].links
            if link and link[0].from_node.type == "TEX_IMAGE":
                return link[0].from_node.image
    raise RuntimeError("no base colour texture found")


def classify_surfaces(obj):
    """Label every vertex from the artist's own albedo, sampled at its own UV.

    The red hair hangs from the head down to knee height and reaches wider than
    the arms, so any purely positional skinning rule welds it to the arm and leg
    chains.  Sampling the untouched PBR texture is what keeps it separate.

    Sampling happens per *loop*: this mesh has ~30k UV seams, so averaging a
    vertex's UVs lands in empty texture space and mislabels whole limbs.
    """
    mesh = obj.data
    count = len(mesh.vertices)
    image = base_colour_image(obj)
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    flat = pixels.reshape(-1, 4)

    loop_uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", loop_uv)
    loop_uv = loop_uv.reshape(-1, 2).astype(np.float64)
    loop_vertex = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loop_vertex)

    # Blender's image buffer runs bottom-up relative to glTF UV space, and the
    # source UVs are already in glTF orientation, so sample them as they are.
    u = np.clip(loop_uv[:, 0] % 1.0, 0.0, 1.0) * (width - 1)
    v = np.clip(loop_uv[:, 1] % 1.0, 0.0, 1.0) * (height - 1)
    x0, y0 = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
    fx, fy = u - x0, v - y0
    x1, y1 = np.minimum(x0 + 1, width - 1), np.minimum(y0 + 1, height - 1)
    colour = (
        flat[y0 * width + x0] * ((1 - fx) * (1 - fy))[:, None]
        + flat[y0 * width + x1] * (fx * (1 - fy))[:, None]
        + flat[y1 * width + x0] * ((1 - fx) * fy)[:, None]
        + flat[y1 * width + x1] * (fx * fy)[:, None]
    )[:, :3]

    r, g, b = colour[:, 0], colour[:, 1], colour[:, 2]
    maximum = colour.max(axis=1)
    minimum = colour.min(axis=1)
    saturation = np.where(maximum > 1e-5, (maximum - minimum) / np.maximum(maximum, 1e-5), 0.0)

    labels = np.full(len(colour), OTHER, dtype=np.int8)
    labels[maximum < 0.24] = DARK
    labels[(b > r + 0.03) & (g > r) & (maximum >= 0.24)] = ACCENT
    labels[(saturation < 0.14) & (maximum >= 0.5)] = ROBE
    labels[(r > g + 0.14) & (r > b + 0.2) & (saturation > 0.5)] = HAIR
    # Skin has to be genuinely warm.  A desaturated mid-grey (0.36, 0.31, 0.32)
    # sits inside the loose rule and is what used to weld the grey inner coat
    # strands to the hand bones.
    labels[(r - b > 0.06) & (r >= g) & (saturation < 0.5) & (maximum >= 0.45)] = SKIN

    votes = np.zeros((count, 6), dtype=np.int32)
    np.add.at(votes, (loop_vertex, labels), 1)
    return votes.argmax(1).astype(np.int8), votes.max(1) / np.maximum(votes.sum(1), 1)


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------

VIEWS = {
    "front": (0.0, 1.0),
    "back": (math.pi, 1.0),
    "side": (math.pi / 2, 1.0),
    "three-quarter": (math.pi * 0.78, 1.0),
}


def setup_workbench(scene, resolution=(900, 1200)):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "TEXTURE"
    shading.show_shadows = True
    shading.show_cavity = True
    scene.display.render_aa = "16"
    world = bpy.data.worlds.new("Preview")
    world.color = (0.16, 0.17, 0.2)
    scene.world = world


def frame_camera(scene, target, radius, angle, height_ratio=0.55, fov=42.0):
    cam_data = bpy.data.cameras.get("PreviewCam") or bpy.data.cameras.new("PreviewCam")
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(fov)
    cam = bpy.data.objects.get("PreviewCam")
    if cam is None:
        cam = bpy.data.objects.new("PreviewCam", cam_data)
        scene.collection.objects.link(cam)
    cam.data = cam_data
    scene.camera = cam
    eye = Vector(
        (
            target.x + math.sin(angle) * radius,
            target.y - math.cos(angle) * radius,
            target.z + radius * height_ratio,
        )
    )
    cam.location = eye
    direction = target - eye
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam


def render_views(scene, out_dir, target, radius, prefix="", views=None):
    import os

    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, (angle, _) in (views or VIEWS).items():
        frame_camera(scene, target, radius, angle)
        path = os.path.join(out_dir, f"{prefix}{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)
    return written


# --------------------------------------------------------------------------
# pose maths -- three.js semantics (identity rest orientation on every bone)
# --------------------------------------------------------------------------


def rot(*xyz):
    return Euler(xyz, "XYZ").to_quaternion()


def turn_world(pose_bone, delta):
    """Rotate a bone by `delta` about its head, expressed in armature space."""
    if isinstance(delta, (tuple, list)):
        delta = rot(*delta)
    world = pose_bone.matrix.to_quaternion()
    parent = pose_bone.parent.matrix.to_quaternion() if pose_bone.parent else Quaternion()
    pose_bone.rotation_quaternion = parent.inverted() @ delta @ world
    refresh()


def refresh():
    bpy.context.view_layer.update()


def clear_pose(armature):
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = Quaternion()
        bone.location = Vector((0.0, 0.0, 0.0))
        bone.scale = Vector((1.0, 1.0, 1.0))
    refresh()


def world_head(pose_bone):
    return pose_bone.matrix.translation.copy()


def two_bone_ik(upper, lower, tip, target, pole):
    """Analytic 2-bone IK, mirroring the reach() solver used by the office bakes."""
    shoulder = world_head(upper)
    length_a = (world_head(lower) - shoulder).length
    length_b = (world_head(tip) - world_head(lower)).length
    direction = Vector(target) - shoulder
    span = min(max(direction.length, 1e-3), length_a + length_b - 2e-3)
    direction.normalize()
    pole = Vector(pole)
    pole -= direction * pole.dot(direction)
    if pole.length < 1e-6:
        pole = Vector((0.0, 0.0, -1.0))
    pole.normalize()
    along = (length_a * length_a - length_b * length_b + span * span) / (2 * span)
    bend = shoulder + direction * along + pole * math.sqrt(max(0.0, length_a * length_a - along * along))
    aim(upper, lower, bend)
    aim(lower, tip, target)


def aim(pose_bone, child, target):
    parent = pose_bone.parent
    for _ in range(3):
        origin = world_head(pose_bone)
        current = (world_head(child) - origin).normalized()
        wanted = (Vector(target) - origin).normalized()
        delta = current.rotation_difference(wanted)
        world = pose_bone.matrix.to_quaternion()
        base = parent.matrix.to_quaternion() if parent else Quaternion()
        pose_bone.rotation_quaternion = base.inverted() @ delta @ world
        refresh()
