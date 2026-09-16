"""Build the Mizukage office rig: 18 joints, texture-aware, distance-gated skinning.

Joint pivots come from measurements taken off the mesh itself
(scripts/rig_measure.py).  The rig this replaces put the chest at z=1.69 and the
head pivot at z=2.31 -- both above the real shoulder line at z=1.44 -- so head
turns used to swing the shoulders and the hair was welded to the arm chain.

Bone names and hierarchy are unchanged, so readyroom's contract (18 bones,
Idle/Walk/Sitting/SitDown/StandUp/Typing) still holds.

Every bone points along +Y with roll 0, which makes each bone's rest orientation
the identity matrix.  That matches what three.js assumes: a bone's local
quaternion is then exactly the value the office clips key.
"""

import json
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mzk_lib as L

SRC = sys.argv[sys.argv.index("--") + 1]
OUT = sys.argv[sys.argv.index("--") + 2]
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- joint table
# Blender space: +Z up, -Y facing.  Metres, in the contract's scaled space.
HEAD_Y = -0.12
HIP_Z = 0.90
KNEE_Z = 0.50
ANKLE_Z = 0.185
TOE_Y = HEAD_Y - 0.22
LEG_X = 0.17
SHOULDER = (0.27, HEAD_Y + 0.01, 1.44)
ELBOW = (0.395, HEAD_Y + 0.01, 1.14)
WRIST = (0.47, HEAD_Y + 0.01, 0.86)
HAND_TIP = (0.475, HEAD_Y - 0.01, 0.52)

JOINTS = {
    "Root": (0.0, 0.0, 0.0),
    "Hips": (0.0, HEAD_Y, HIP_Z),
    "Spine": (0.0, HEAD_Y, 1.10),
    "Chest": (0.0, HEAD_Y, 1.32),
    "Neck": (0.0, HEAD_Y, 1.50),
    "Head": (0.0, HEAD_Y, 1.62),
}
PARENT = {"Root": None, "Hips": "Root", "Spine": "Hips", "Chest": "Spine", "Neck": "Chest", "Head": "Neck"}
for side, s in (("Left", 1.0), ("Right", -1.0)):
    JOINTS[f"{side}UpperLeg"] = (s * LEG_X, HEAD_Y, HIP_Z)
    JOINTS[f"{side}LowerLeg"] = (s * LEG_X, HEAD_Y - 0.02, KNEE_Z)
    JOINTS[f"{side}Foot"] = (s * LEG_X, HEAD_Y - 0.04, ANKLE_Z)
    JOINTS[f"{side}UpperArm"] = (s * SHOULDER[0], SHOULDER[1], SHOULDER[2])
    JOINTS[f"{side}ForeArm"] = (s * ELBOW[0], ELBOW[1], ELBOW[2])
    JOINTS[f"{side}Hand"] = (s * WRIST[0], WRIST[1], WRIST[2])
    PARENT[f"{side}UpperLeg"] = "Hips"
    PARENT[f"{side}LowerLeg"] = f"{side}UpperLeg"
    PARENT[f"{side}Foot"] = f"{side}LowerLeg"
    PARENT[f"{side}UpperArm"] = "Chest"
    PARENT[f"{side}ForeArm"] = f"{side}UpperArm"
    PARENT[f"{side}Hand"] = f"{side}ForeArm"

ORDER = ["Root", "Hips", "Spine", "Chest", "Neck", "Head"]
for side in ("Left", "Right"):
    ORDER += [f"{side}UpperLeg", f"{side}LowerLeg", f"{side}Foot",
              f"{side}UpperArm", f"{side}ForeArm", f"{side}Hand"]
BODY_NAMES = [n for n in ORDER if n != "Root"]

BONE_LENGTH = 0.10
TIPS = {name: (JOINTS[name][0], JOINTS[name][1] + BONE_LENGTH, JOINTS[name][2]) for name in ORDER}


def smoothstep(value, low, high):
    t = np.clip((value - low) / (high - low), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def polyline_distance(points, chain):
    """Shortest distance from every point to a polyline (numpy, vectorised)."""
    best = np.full(len(points), np.inf)
    for start, end in zip(chain[:-1], chain[1:]):
        a = np.asarray(start)
        b = np.asarray(end)
        ab = b - a
        denominator = float(ab @ ab)
        if denominator < 1e-12:
            offset = points - a
        else:
            t = np.clip(((points - a) @ ab) / denominator, 0.0, 1.0)
            offset = points - (a + t[:, None] * ab)
        best = np.minimum(best, np.linalg.norm(offset, axis=1))
    return best


# ---------------------------------------------------------------- scene setup
scene = L.reset_scene()
mesh_obj = L.import_source(SRC)
L.apply_contract_transform(mesh_obj)
mesh = mesh_obj.data
count = len(mesh.vertices)
co = np.empty(count * 3, dtype=np.float32)
mesh.vertices.foreach_get("co", co)
co = co.reshape(-1, 3).astype(np.float64)
labels, confidence = L.classify_surfaces(mesh_obj)
HAIR, SKIN, ROBE, ACCENT, DARK, OTHER = range(6)
is_hair = labels == HAIR
is_cloth = np.isin(labels, [ROBE, ACCENT, OTHER, DARK])
print(
    "surfaces: "
    + " ".join(f"{L.SURFACE_NAMES[k]}={int((labels == k).sum())}" for k in range(6))
    + f"  meanConfidence={confidence.mean():.3f}"
)

arm_data = bpy.data.armatures.new("MizukageOfficeRig")
arm_obj = bpy.data.objects.new("Mizukage_Office_Rig", arm_data)
scene.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode="EDIT")
for name in ORDER:
    bone = arm_data.edit_bones.new(name)
    bone.head = JOINTS[name]
    bone.tail = TIPS[name]
    bone.roll = 0.0
    if PARENT[name]:
        bone.parent = arm_data.edit_bones[PARENT[name]]
        bone.use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")
if not all(bone.matrix_local.to_quaternion().rotation_difference(Quaternion()).angle < 1e-6 for bone in arm_data.bones):
    raise RuntimeError("bone rest orientations must be identity for the office contract")
print("rest orientation identity: OK")

# ---------------------------------------------------------------- weights
weights = {name: np.zeros(count) for name in BODY_NAMES}
x, y, z = co[:, 0], co[:, 1], co[:, 2]
ax = np.abs(x)

# --- 1. torso column by height: hips -> spine -> chest -> neck -> head
t_chest = smoothstep(z, 1.16, 1.42)
t_neck = smoothstep(z, 1.44, 1.56)
t_head = smoothstep(z, 1.56, 1.70)
t_spine = smoothstep(z, 0.94, 1.18) * (1 - t_chest)
t_hips = np.clip(1.0 - t_spine - t_chest, 0.0, 1.0)
weights["Hips"] = t_hips
weights["Spine"] = t_spine
weights["Chest"] = t_chest * (1 - t_neck)
weights["Neck"] = t_neck * (1 - t_head)
weights["Head"] = t_head

# --- 2. hair: follows the head, blending down the spine so the knee-length mass
#        never swings rigidly on a head turn and never touches the limbs.
hair_head = smoothstep(z, 1.26, 1.56)
hair_chest = smoothstep(z, 1.02, 1.30) * (1 - hair_head)
hair_spine = smoothstep(z, 0.84, 1.08) * (1 - hair_head - hair_chest)
hair_hips = np.clip(1.0 - hair_head - hair_chest - hair_spine, 0.0, 1.0)
for name, value in (("Head", hair_head), ("Chest", hair_chest), ("Spine", hair_spine), ("Hips", hair_hips)):
    weights[name] = np.where(is_hair, value, weights[name])

body = ~is_hair

# --- 3. arms: gated by distance to the actual shoulder->elbow->wrist->tip chain
arm_chains = {
    side: [(s * SHOULDER[0], SHOULDER[1], SHOULDER[2]),
           (s * ELBOW[0], ELBOW[1], ELBOW[2]),
           (s * WRIST[0], WRIST[1], WRIST[2]),
           (s * HAND_TIP[0], HAND_TIP[1], HAND_TIP[2])]
    for side, s in (("Left", 1.0), ("Right", -1.0))
}
arm_influence = {}
for side, s in (("Left", 1.0), ("Right", -1.0)):
    distance = polyline_distance(co, arm_chains[side])
    outboard = smoothstep(s * x, 0.22, 0.38)
    # The hand is a wide blob, so a tolerance tuned for the forearm leaves the
    # fingers sharing weight with the chest and the pads drift off the keys.
    near = 1.0 - smoothstep(distance, 0.09, 0.30)
    # Floor the arm zone at the fingertips.  Below that the coat hem sits at
    # the same lateral offset as the hand and would be dragged along.
    share = np.where(body & (z > 0.50) & (z < 1.70), outboard * near, 0.0)
    # The hand itself is bound rigidly.  Any residual chest/pelvis weight is
    # harmless while standing but pulls the fingers down once the hips drop, so
    # the pads sink into the keyboard.  Nothing else occupies this box: hair is
    # excluded by `body` and the sleeve by `is_cloth`.
    hand_box = body & ~is_cloth & (s * x > 0.33) & (z > 0.47) & (z < 0.96)
    share = np.where(hand_box, 1.0, share)
    arm_influence[side] = share

for side, s in (("Left", 1.0), ("Right", -1.0)):
    share = arm_influence[side]
    # smoothstep(z, ...) is 1 *above* the boundary, so it already reads as
    # "closer to the shoulder"; the wrist term is the inverted one.
    above_elbow = smoothstep(z, 1.02, 1.26)
    # As with the boots, cloth stops at the forearm: a sleeve that follows the
    # Hand bone would be dragged around by every keystroke.
    below_wrist = np.where(is_cloth, 0.0, 1.0 - smoothstep(z, 0.80, 0.90))
    segment = {
        f"{side}UpperArm": above_elbow,
        f"{side}ForeArm": (1.0 - above_elbow) * (1.0 - below_wrist),
        f"{side}Hand": (1.0 - above_elbow) * below_wrist,
    }
    for name, value in segment.items():
        weights[name] = weights[name] + share * value
    for name in ("Hips", "Spine", "Chest", "Neck", "Head"):
        weights[name] = weights[name] * (1 - share)

# --- 4. legs: gated by distance to the hip->knee->ankle->toe chain
# The chain has to run out to the toe *and* back to the heel at sole height.
# Stopping at the ankle leaves the heel ~0.20 from the nearest segment, which
# costs it a third of its foot weight and drops the sole off the footrest.
leg_chains = {
    side: [(s * LEG_X, HEAD_Y, HIP_Z),
           (s * LEG_X, HEAD_Y - 0.02, KNEE_Z),
           (s * LEG_X, HEAD_Y - 0.04, ANKLE_Z),
           (s * LEG_X, TOE_Y, 0.025),
           (s * LEG_X, HEAD_Y + 0.031, 0.025)]
    for side, s in (("Left", 1.0), ("Right", -1.0))
}
for side, s in (("Left", 1.0), ("Right", -1.0)):
    distance = polyline_distance(co, leg_chains[side])
    # The split between the two legs has to be soft at the crotch and hard at
    # the feet: a ramp wide enough for the pelvis leaves the inner half of each
    # boot holding pelvis weight, and the sole then sinks when the hips drop.
    hip_softness = smoothstep(z, 0.45, 0.92)
    lateral = smoothstep(s * x, 0.002 + 0.013 * hip_softness, 0.016 + 0.114 * hip_softness)
    below_hip = 1.0 - smoothstep(z, 0.84, 1.00)
    near = 1.0 - smoothstep(distance, 0.10, 0.36)
    # Cloth keeps some pelvis weight so the coat hem does not tear away -- but
    # only around the hips.  Below the knee the pale boots classify as robe too,
    # and holding pelvis weight there sinks the soles off the footrest.
    cloth = np.where(is_cloth, 0.72 + 0.28 * (1.0 - smoothstep(z, 0.30, 0.78)), 1.0)
    # Never let the leg chain reach a vertex the arm already owns: with the
    # hips dropped, even a few percent of thigh weight drags the hand pads
    # into the keyboard.
    share = np.where(
        body & (z < 1.05),
        lateral * below_hip * near * cloth * (1.0 - arm_influence[side]),
        0.0,
    )
    above_knee = smoothstep(z, 0.40, 0.62)
    # Only the boot belongs to the foot.  Letting the coat hem reach the Foot
    # bone drags the hem along with every step and, worse, makes the footrest
    # contact solve measure cloth instead of the sole.
    # Cloth only stops at the shin.  The boots are pale and classify as robe,
    # so a blanket exclusion would strip the sole of its foot weight.
    below_ankle = (1.0 - smoothstep(z, 0.10, 0.30)) * np.where(
        is_cloth, 1.0 - smoothstep(z, 0.16, 0.34), 1.0
    )
    segment = {
        f"{side}UpperLeg": above_knee,
        f"{side}LowerLeg": (1.0 - above_knee) * (1.0 - below_ankle),
        f"{side}Foot": (1.0 - above_knee) * below_ankle,
    }
    for name, value in segment.items():
        weights[name] = weights[name] + share * value
    for name in ("Hips", "Spine", "Chest", "Neck", "Head"):
        weights[name] = weights[name] * (1 - share)

# --- normalise, clamp to the four influences glTF allows
stack = np.stack([weights[name] for name in BODY_NAMES], axis=1)
stack = np.clip(stack, 0.0, None)
stack /= np.maximum(stack.sum(axis=1), 1e-9)[:, None]
order = np.argsort(-stack, axis=1)
rows = np.arange(count)[:, None]
keep = np.zeros_like(stack)
keep[rows, order[:, :4]] = stack[rows, order[:, :4]]
keep /= np.maximum(keep.sum(axis=1), 1e-9)[:, None]

groups = {name: mesh_obj.vertex_groups.new(name=name) for name in ORDER}
for index, name in enumerate(BODY_NAMES):
    column = keep[:, index]
    for bone_index in np.nonzero(column > 1e-4)[0]:
        groups[name].add([int(bone_index)], float(column[bone_index]), "REPLACE")

mesh_obj.parent = arm_obj
modifier = mesh_obj.modifiers.new(name="Armature", type="ARMATURE")
modifier.object = arm_obj

report = {
    "vertices": count,
    "hairVertices": int(is_hair.sum()),
    "bones": ORDER,
    "maxInfluences": int((keep > 1e-4).sum(axis=1).max()),
    "meanInfluences": round(float((keep > 1e-4).sum(axis=1).mean()), 3),
    "joints": JOINTS,
    "bounds": [co.min(axis=0).tolist(), co.max(axis=0).tolist()],
}

# numeric sanity: where does each extremity actually land?
def dominant_of(mask, note):
    if not mask.sum():
        return
    sub = keep[mask]
    top = sub.mean(axis=0)
    best = BODY_NAMES[int(top.argmax())]
    report.setdefault("checks", {})[note] = {
        "n": int(mask.sum()),
        "meanDominant": best,
        "distribution": {BODY_NAMES[i]: round(float(top[i]), 3) for i in np.argsort(-top)[:3]},
    }


for side in ("Left", "Right"):
    foot_mask = keep[:, BODY_NAMES.index(f"{side}Foot")].argmax() if False else None
for probe in ("LeftFoot", "RightFoot", "LeftLowerLeg"):
    column = keep[:, BODY_NAMES.index(probe)]
    picked = co[column > 0.5]
    report.setdefault("extremes", {})[probe] = {
        "n": int(len(picked)),
        "z": [round(float(picked[:, 2].min()), 3), round(float(picked[:, 2].max()), 3)] if len(picked) else None,
    }

dominant_of((z < 0.12), "sole")
dominant_of((z > 1.75), "topOfHead")
dominant_of((z > 0.55) & (z < 0.85) & (ax > 0.33) & (ax < 0.60), "hands")
dominant_of((z > 1.55) & (z < 1.95) & (y > 0.10), "hairBehindHead")
dominant_of((z > 0.30) & (z < 0.80) & (y > 0.15), "hairLowBack")
dominant_of((z > 1.20) & (z < 1.45) & (ax < 0.30), "bust")

np.save(os.path.join(OUT, "weights.npy"), keep.astype(np.float32))

PALETTE = np.array(
    [
        [0.55, 0.55, 0.58], [0.95, 0.15, 0.15], [0.95, 0.55, 0.10], [0.95, 0.90, 0.15],
        [0.35, 0.85, 0.20], [0.10, 0.80, 0.70], [0.15, 0.50, 0.95], [0.45, 0.20, 0.95],
        [0.85, 0.20, 0.85], [0.95, 0.45, 0.65], [0.55, 0.35, 0.20], [0.90, 0.90, 0.90],
        [0.55, 0.90, 0.35], [0.10, 0.55, 0.35], [0.30, 0.35, 0.75], [0.65, 0.45, 0.85],
        [0.90, 0.65, 0.30], [0.40, 0.40, 0.40],
    ],
    dtype=np.float32,
)
rgba = np.ones((count, 4), dtype=np.float32)
rgba[:, :3] = PALETTE[keep.argmax(axis=1) % len(PALETTE)]
layer = mesh.color_attributes.new(name="Dominant", type="FLOAT_COLOR", domain="POINT")
layer.data.foreach_set("color", rgba.reshape(-1))
mesh.update()

L.setup_workbench(scene)
scene.display.shading.color_type = "VERTEX"
scene.display.shading.show_shadows = False
centre = Vector(((co[:, 0].min() + co[:, 0].max()) / 2, 0.0, (co[:, 2].min() + co[:, 2].max()) / 2))
L.render_views(scene, OUT, centre, 2.8, prefix="skin-")

report["palette"] = {name: [round(float(c), 3) for c in PALETTE[i % len(PALETTE)]] for i, name in enumerate(BODY_NAMES)}
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "mizukage-rig.blend"))
with open(os.path.join(OUT, "rig-report.json"), "w") as handle:
    json.dump(report, handle, indent=1)
print("MZK_RIG " + json.dumps({k: v for k, v in report.items() if k not in ("joints", "palette")}))
