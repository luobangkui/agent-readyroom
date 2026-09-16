"""Author the Mizukage office clips on the rebuilt rig and export them to GLB.

Six actions are produced, matching the names readyroom expects:
Idle, Walk, Sitting, SitDown, StandUp, Typing.

Contacts are solved rather than guessed.  The feet are placed by an iterative
hip-height solve that drives the lowest sole vertex onto a target height (the
floor while walking, the 0.23 m footrest while seated), and the hands are placed
by a two-bone IK solve onto the keyboard, then corrected against the real
fingertip vertices so the pads land just above the key tops.
"""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mzk_lib as L

RIG_BLEND = sys.argv[sys.argv.index("--") + 1]
OUT = sys.argv[sys.argv.index("--") + 2]
os.makedirs(OUT, exist_ok=True)

FPS = 30

# Contact targets in the model's own space (metres), derived from the office
# geometry: world y = 0.075 + local * 1.18, because the actor root sits at
# y=0.02, the model root adds 0.055 and the runtime scale is 1.18.
FOOTREST_LOCAL = (0.23 - 0.075) / 1.18          # 0.1314
KEYTOP_LOCAL = (1.031 - 0.075) / 1.18           # 0.8102
KEYBOARD_Z_LOCAL = (0.66 - 0.08) / 1.18         # 0.4915
KEYBOARD_HALF_WIDTH = 0.325 / 1.18              # 0.2754
KEY_CLEARANCE = 0.023 / 1.18

bpy.ops.wm.open_mainfile(filepath=RIG_BLEND)
scene = bpy.context.scene
scene.render.fps = FPS
arm = bpy.data.objects["Mizukage_Office_Rig"]
mesh_obj = next(obj for obj in bpy.data.objects if obj.type == "MESH")
bpy.context.view_layer.objects.active = arm

BONES = [bone.name for bone in arm.data.bones]
pose = arm.pose.bones
for bone in pose:
    bone.rotation_mode = "QUATERNION"


def refresh():
    bpy.context.view_layer.update()


def reset():
    for bone in pose:
        bone.rotation_quaternion = Quaternion()
        bone.location = Vector((0.0, 0.0, 0.0))
    refresh()


def rot(x=0.0, y=0.0, z=0.0):
    return Euler((x, y, z), "XYZ").to_quaternion()


def spin(name, delta):
    """Rotate a bone by `delta` (Euler radians or a Quaternion) about its head."""
    bone = pose[name]
    if not isinstance(delta, Quaternion):
        delta = rot(*delta)
    world = bone.matrix.to_quaternion()
    base = bone.parent.matrix.to_quaternion() if bone.parent else Quaternion()
    bone.rotation_quaternion = base.inverted() @ delta @ world
    refresh()


def head(name):
    return pose[name].matrix.translation.copy()


def aim(name, child, target):
    bone = pose[name]
    for _ in range(4):
        origin = head(name)
        current = (head(child) - origin)
        wanted = (Vector(target) - origin)
        if current.length < 1e-9 or wanted.length < 1e-9:
            return
        delta = current.normalized().rotation_difference(wanted.normalized())
        spin(name, delta)


def reach(upper, lower, tip, target, pole):
    """Analytic two-bone IK mirroring the office bake's reach() solver."""
    shoulder = head(upper)
    length_a = (head(lower) - shoulder).length
    length_b = (head(tip) - head(lower)).length
    direction = Vector(target) - shoulder
    span = max(min(direction.length, length_a + length_b - 2e-3), 1e-3)
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


# ---------------------------------------------------------------- mesh probes
# One pass over the mesh resolves every vertex's dominant bone, then the contact
# probes are the lowest few vertices that are effectively rigid to a foot or a
# hand.  Tracking real geometry (rather than bone origins) is what keeps the
# soles on the footrest and the fingertips on the key tops.
INFLUENCES = {}
DOMINANT = {}
group_names = {group.index: group.name for group in mesh_obj.vertex_groups}
for vertex in mesh_obj.data.vertices:
    entries = [(group_names[e.group], e.weight) for e in vertex.groups if e.weight > 1e-4]
    if not entries:
        continue
    INFLUENCES[vertex.index] = entries
    best = max(entries, key=lambda pair: pair[1])
    if best[1] > 0.5:
        DOMINANT[vertex.index] = best

coords = np.empty(len(mesh_obj.data.vertices) * 3, dtype=np.float32)
mesh_obj.data.vertices.foreach_get("co", coords)
coords = coords.reshape(-1, 3)

# Probing uses full linear-blend skinning, not a rigid per-bone transform.  The
# two disagree wherever a vertex carries partial weight from another bone, and
# the browser only ever sees the blended result -- solving against the rigid
# approximation left the fingertips a centimetre inside the keyboard.
REST_INVERSE = {name: pose[name].bone.matrix_local.inverted() for name in BONES}


def skinned(entry):
    point, influences = entry
    total = Vector((0.0, 0.0, 0.0))
    for name, weight in influences:
        total += (pose[name].matrix @ REST_INVERSE[name] @ point) * weight
    return total


SOLE = []
FINGERTIPS = []
for side in ("Left", "Right"):
    # The hand needs a deep probe set: the lowest-in-rest vertices are not the
    # lowest once the wrist rotates to reach the keyboard.
    for bone_name, bucket, limit, ceiling in (
        (f"{side}Foot", SOLE, 60, 0.09),
        (f"{side}Hand", FINGERTIPS, 260, 1.05),
    ):
        picks = [
            index
            for index, (group, weight) in DOMINANT.items()
            if group == bone_name and weight > 0.5 and coords[index][2] < ceiling
        ]
        picks.sort(key=lambda index: coords[index][2])
        for index in picks[:limit]:
            entry = (Vector(coords[index]), INFLUENCES[index])
            bucket.append((side, *entry) if bone_name.endswith("Hand") else entry)
print(f"sole probes: {len(SOLE)}  fingertip probes: {len(FINGERTIPS)}")
if not FINGERTIPS:
    raise RuntimeError("no hand-dominant vertices found for the keyboard probe")


def lowest_sole():
    return min(skinned(entry)[2] for entry in SOLE)


def lowest_fingertip(side):
    return min((skinned(entry)[2] for probe_side, *entry in FINGERTIPS if probe_side == side), default=None)


# ---------------------------------------------------------------- seated pose
HIP_REST = Vector(pose["Hips"].bone.head_local)
THIGH = -1.44
SHIN = 1.40


def apply_spine(blend, lean=0.0, sway=0.0):
    spin("Hips", (0.0, 0.0, 0.0))
    spin("Spine", (0.02 * blend + lean * 0.45, 0.0, sway * 0.4))
    spin("Chest", (-0.06 * blend + lean * 0.45, 0.0, sway * 0.6))
    spin("Neck", (0.03 * blend, 0.0, 0.0))
    spin("Head", (0.02 * blend, 0.0, 0.0))


def apply_legs(blend):
    for side, s in (("Left", 1.0), ("Right", -1.0)):
        spin(f"{side}UpperLeg", (THIGH * blend, 0.0, -s * 0.05 * blend))
        spin(f"{side}LowerLeg", (SHIN * blend, 0.0, 0.0))
        spin(f"{side}Foot", (-0.04 * blend, 0.0, 0.0))


def apply_hands(wrist_z, wrist_y, spread, lift=(0.0, 0.0), tilt=(0.0, 0.0), roll=0.0):
    """Place both wrists with two-bone IK at the given per-side heights."""
    for index, (side, s) in enumerate((("Left", 1.0), ("Right", -1.0))):
        target = Vector((s * spread, wrist_y + lift[index] * 0.4, wrist_z[index] + lift[index]))
        pole = Vector((s * 0.75, 0.55, -0.5))
        reach(f"{side}UpperArm", f"{side}ForeArm", f"{side}Hand", target, pole)
        spin(f"{side}Hand", (tilt[index] + roll, 0.0, -s * 0.10))


def solve_hands(targets, wrist_y, spread, lift=(0.0, 0.0), tilt=(0.0, 0.0)):
    """Find each wrist height so its lowest fingertip lands on its target.

    Fingertip height rises about 1.9x faster than wrist height here, because the
    IK also rotates the hand as the target climbs, so a single proportional
    correction overshoots.  A secant solve converges in two or three passes.
    """
    z = [0.87, 0.87]
    history = [None, None]
    for _ in range(6):
        apply_hands(z, wrist_y, spread, lift, tilt)
        errors = [
            lowest_fingertip(side) - targets[index]
            for index, side in enumerate(("Left", "Right"))
        ]
        if max(abs(error) for error in errors) < 5e-5:
            break
        for index in (0, 1):
            slope = 2.0
            if history[index] is not None:
                last_z, last_error = history[index]
                if abs(z[index] - last_z) > 1e-9:
                    slope = (errors[index] - last_error) / (z[index] - last_z)
                    slope = max(0.4, min(4.0, slope))
            history[index] = (z[index], errors[index])
            z[index] -= errors[index] / slope
    return z


def solve_seat(blend, lean=0.0, sway=0.0):
    """Drop the hips until the soles rest on the footrest."""
    offset = 0.24 * blend
    for _ in range(6):
        reset()
        pose["Hips"].location = Vector((0.0, 0.035 * blend, -offset))
        apply_spine(blend, lean, sway)
        apply_legs(blend)
        refresh()
        gap = lowest_sole() - FOOTREST_LOCAL
        if abs(gap) < 5e-5:
            break
        offset += gap


def capture():
    return {bone.name: (bone.rotation_quaternion.copy(), bone.location.copy()) for bone in pose}


def blend_poses(start, end, t):
    for bone in pose:
        qa, pa = start[bone.name]
        qb, pb = end[bone.name]
        bone.rotation_quaternion = qa.slerp(qb, t)
        bone.location = pa.lerp(pb, t)
    refresh()


_REFERENCE = {}


def reference(name, build):
    """Cache the standing and seated base poses the transitions blend between.

    SitDown must finish exactly on Sitting's first frame and StandUp must start
    there, otherwise the demo's cross-fade from a transition into the seated
    loop visibly snaps.
    """
    if name not in _REFERENCE:
        build()
        _REFERENCE[name] = capture()
    return _REFERENCE[name]


# ---------------------------------------------------------------- clips
def ease(t):
    return t * t * (3 - 2 * t)


SEAT_HANDS_Y = -0.415


def pose_idle(time, duration):
    reset()
    # planted feet: solve the hip height once, then only breathe above it
    offset = 0.0
    for _ in range(5):
        pose["Hips"].location = Vector((0.0, 0.0, -offset))
        refresh()
        gap = lowest_sole()
        if abs(gap) < 5e-5:
            break
        offset += gap
    phase = time / duration * math.pi * 2
    breath = math.sin(phase)
    spin("Spine", (0.014 * breath, 0.0, 0.010 * math.sin(phase * 2)))
    spin("Chest", (0.020 * breath, 0.0, 0.012 * math.sin(phase * 2 + 0.6)))
    spin("Neck", (-0.012 * breath, 0.020 * math.sin(phase), 0.0))
    spin("Head", (-0.016 * breath, 0.075 * math.sin(phase + 0.9), 0.016 * math.sin(phase * 2)))
    for index, (side, s) in enumerate((("Left", 1.0), ("Right", -1.0))):
        lag = index * 0.6
        spin(f"{side}UpperArm", (0.050 * math.sin(phase + lag), 0.0, -s * (0.060 + 0.022 * breath)))
        spin(f"{side}ForeArm", (-0.080 + 0.035 * math.sin(phase * 2 + lag), 0.0, 0.0))
        spin(f"{side}Hand", (0.045 * math.sin(phase * 2 + lag), 0.0, 0.0))
        spin(f"{side}UpperLeg", (0.020 * breath, 0.0, -s * 0.010))
        spin(f"{side}LowerLeg", (0.030 * max(0.0, breath), 0.0, 0.0))


def pose_walk(time, duration):
    reset()
    phase = time / duration * math.pi * 2
    hip_drop = 0.0
    for side, s, shift in (("Left", 1.0, 0.0), ("Right", -1.0, math.pi)):
        q = phase + shift
        thigh = 0.42 * math.sin(q)
        # the knee only ever folds backwards (positive X), and folds hardest
        # while the leg is travelling forward
        knee = 0.62 * max(0.0, math.sin(q - 0.7)) ** 1.4
        ankle = -0.16 * math.sin(q + 0.9)
        spin(f"{side}UpperLeg", (thigh, 0.0, -s * 0.02))
        spin(f"{side}LowerLeg", (knee, 0.0, 0.0))
        spin(f"{side}Foot", (ankle, 0.0, 0.0))
        spin(f"{side}UpperArm", (-0.34 * math.sin(q), 0.0, -s * (0.09 + 0.03 * math.sin(q))))
        spin(f"{side}ForeArm", (-0.22 + 0.14 * math.sin(q + 1.1), 0.0, 0.0))
        spin(f"{side}Hand", (0.05 * math.sin(q), 0.0, 0.0))
    spin("Hips", (0.03, 0.02 * math.sin(phase), 0.07 * math.sin(phase)))
    spin("Spine", (0.045, -0.025 * math.sin(phase), -0.05 * math.sin(phase)))
    spin("Chest", (0.03, -0.05 * math.sin(phase), -0.06 * math.sin(phase)))
    spin("Neck", (-0.05, 0.0, 0.0))
    spin("Head", (-0.045, 0.03 * math.sin(phase), 0.02 * math.sin(phase)))
    # feet must reach the floor: shift the hips by whatever the lowest sole needs
    for _ in range(6):
        pose["Hips"].location = Vector((0.0, 0.0, -hip_drop))
        refresh()
        gap = lowest_sole()
        if abs(gap) < 4e-5:
            break
        hip_drop += gap
    # vertical bob rides on top of the contact solve, never through it
    pose["Hips"].location = Vector((0.0, 0.0, -hip_drop + 0.018 * abs(math.sin(phase))))
    refresh()


SEAT_HANDS_SPREAD = 0.150
REST_CLEARANCE = KEYTOP_LOCAL + KEY_CLEARANCE


def pose_sitting(time, duration):
    phase = time / duration * math.pi * 2
    solve_seat(1.0, lean=0.03 * math.sin(phase), sway=0.014 * math.sin(phase))
    spin("Neck", (0.03 + 0.014 * math.sin(phase), 0.05 * math.sin(phase), 0.0))
    spin("Head", (0.02 + 0.024 * math.sin(phase), 0.07 * math.sin(phase + 0.4), 0.016 * math.sin(phase * 2)))
    hover = [0.020 + 0.012 * math.sin(phase), 0.020 + 0.012 * math.sin(phase + 0.8)]
    solve_hands(
        [REST_CLEARANCE + hover[0], REST_CLEARANCE + hover[1]],
        SEAT_HANDS_Y,
        SEAT_HANDS_SPREAD,
        tilt=(0.05, 0.05),
    )


def pose_typing(time, duration):
    phase = time / duration * math.pi * 2
    solve_seat(1.0, lean=0.02 * math.sin(phase), sway=0.012 * math.sin(phase))
    spin("Neck", (0.05, 0.0, 0.0))
    spin("Head", (0.045 + 0.014 * math.sin(phase), 0.035 * math.sin(phase), 0.008 * math.sin(phase * 2)))
    # Four taps per second per hand, the two hands half a beat apart, so a full
    # 6 s clip is exactly 24 taps and the loop seam is exact.
    lifts = [
        0.016 * max(0.0, math.sin(phase * 24 + (0.0 if side == "Left" else math.pi))) ** 1.5
        for side in ("Left", "Right")
    ]
    solve_hands(
        [REST_CLEARANCE + lifts[0], REST_CLEARANCE + lifts[1]],
        SEAT_HANDS_Y,
        SEAT_HANDS_SPREAD,
        tilt=(lifts[0] * 2.4, lifts[1] * 2.4),
    )


def pose_sit_down(time, duration):
    """Blend the standing rest into Sitting's first frame.

    Solving the transition as a pose blend (rather than re-driving the limbs
    through the whole descent) guarantees the clip ends exactly on the frame the
    seated loop starts at, so the demo's transition never snaps.
    """
    t = ease(min(1.0, max(0.0, time / duration)))
    blend_poses(
        reference("standing", lambda: pose_idle(0.0, 4.0)),
        reference("seated", lambda: pose_sitting(0.0, 6.0)),
        t,
    )


def pose_stand_up(time, duration):
    t = ease(min(1.0, max(0.0, time / duration)))
    blend_poses(
        reference("seated", lambda: pose_sitting(0.0, 6.0)),
        reference("standing", lambda: pose_idle(0.0, 4.0)),
        t,
    )


CLIPS = [
    ("Idle", 4.0, pose_idle, True),
    ("Walk", 1.4, pose_walk, True),
    ("Sitting", 6.0, pose_sitting, True),
    ("SitDown", 1.0, pose_sit_down, False),
    ("StandUp", 1.0, pose_stand_up, False),
    ("Typing", 6.0, pose_typing, True),
]

if "--probe" in sys.argv:
    print(f"key top local target = {KEYTOP_LOCAL + KEY_CLEARANCE:.4f}")
    for wrist_z in (0.78, 0.84, 0.90, 0.96, 1.02):
        solve_seat(1.0)
        apply_hands([wrist_z, wrist_z], SEAT_HANDS_Y, SEAT_HANDS_SPREAD)
        print(
            "PROBE wz=%.3f  wristL=%.4f fingerL=%s fingerR=%s  reachable=%s"
            % (
                wrist_z,
                head("LeftHand")[2],
                f"{lowest_fingertip('Left'):.4f}" if lowest_fingertip("Left") is not None else "none",
                f"{lowest_fingertip('Right'):.4f}" if lowest_fingertip("Right") is not None else "none",
                abs(head("LeftHand")[2] - wrist_z) < 1e-3,
            )
        )
    sys.exit(0)

# ---------------------------------------------------------------- keyframing
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)

arm.animation_data_create()
summary = {}
for name, duration, fn, looping in CLIPS:
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data.action = action
    frames = int(round(duration * FPS))
    for frame in range(frames + 1):
        t = duration * frame / frames
        fn(t, duration)
        for bone in pose:
            bone.keyframe_insert("rotation_quaternion", frame=frame)
            bone.keyframe_insert("location", frame=frame)
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
    summary[name] = {"duration": duration, "frames": frames, "looping": looping}
    print(f"baked {name}: {frames + 1} keys")

# seam check: a looping clip must start and end on the same pose
seams = {}
for name, duration, fn, looping in CLIPS:
    if not looping:
        continue
    fn(0.0, duration)
    start = {bone.name: (bone.rotation_quaternion.copy(), bone.location.copy()) for bone in pose}
    fn(duration, duration)
    worst = 0.0
    for bone in pose:
        q0, p0 = start[bone.name]
        worst = max(worst, (bone.rotation_quaternion.rotation_difference(q0)).angle, (bone.location - p0).length)
    seams[name] = worst
print("loop seams: " + json.dumps({k: round(v, 6) for k, v in seams.items()}))

# ---------------------------------------------------------------- export
arm.animation_data.action = bpy.data.actions["Idle"]
reset()
refresh()

# The preview vertex-colour layers are build scaffolding; shipping them would
# tint the character with the debug palette through COLOR_0/COLOR_1.
for layer in list(mesh_obj.data.color_attributes):
    mesh_obj.data.color_attributes.remove(layer)
mesh_obj.data.update()

for obj in bpy.context.scene.objects:
    obj.select_set(True)

export_path = os.path.join(OUT, "mizukage-office-animations.glb")
bpy.ops.export_scene.gltf(
    filepath=export_path,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_bake_animation=False,
    export_optimize_animation_size=False,
    export_force_sampling=False,
    export_anim_single_armature=True,
    export_apply=False,
    export_skins=True,
    export_yup=True,
    export_image_format="AUTO",
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    use_selection=False,
)

# contact report straight off the posed rig
report = {"clips": summary, "seams": seams, "contact": {}}
solve_seat(1.0)
report["contact"]["seatedSoleLocal"] = round(lowest_sole(), 5)
report["contact"]["seatedSoleTarget"] = round(FOOTREST_LOCAL, 5)
report["contact"]["seatedHipLocal"] = round(head("Hips")[2], 5)
reset()
offset = 0.0
for _ in range(5):
    pose["Hips"].location = Vector((0.0, 0.0, -offset))
    refresh()
    gap = lowest_sole()
    if abs(gap) < 5e-5:
        break
    offset += gap
report["contact"]["standingSoleLocal"] = round(lowest_sole(), 5)
pose_typing(0.0, 6.0)
report["contact"]["typingFingertipLocal"] = [round(lowest_fingertip(s), 5) for s in ("Left", "Right")]
report["contact"]["keyTopLocal"] = round(KEYTOP_LOCAL, 5)
report["contact"]["keyboardZLocal"] = round(KEYBOARD_Z_LOCAL, 5)
report["contact"]["keyboardHalfWidth"] = round(KEYBOARD_HALF_WIDTH, 5)
for side in ("Left", "Right"):
    hand = pose[f"{side}Hand"].matrix.translation
    report["contact"][f"{side}HandOrigin"] = [round(v, 4) for v in hand]

with open(os.path.join(OUT, "animation-report.json"), "w") as handle:
    json.dump(report, handle, indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "mizukage-animated.blend"))
print("MZK_ANIM " + json.dumps(report["contact"]))
