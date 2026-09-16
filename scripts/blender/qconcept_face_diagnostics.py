import bpy
from mathutils import Quaternion
head=bpy.data.objects.get('LIVE_Q_Head')
if not head: raise RuntimeError('LIVE_Q_Head not found')
# clear previous diagnostics
for o in list(bpy.data.objects):
 if o.name.startswith('DIAG_'): bpy.data.objects.remove(o,do_unlink=True)
col=bpy.data.collections.get('FACE_DIAGNOSTICS') or bpy.data.collections.new('FACE_DIAGNOSTICS')
if col.name not in [c.name for c in bpy.context.scene.collection.children]: bpy.context.scene.collection.children.link(col)
# hide original body and head, keeping the source scene intact in the saved file
for o in bpy.data.objects:
 if o.name.startswith('LIVE_Q_'): o.hide_viewport=True

def simple_mat(name,c):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes=True; b=next(x for x in m.node_tree.nodes if x.type=='BSDF_PRINCIPLED'); b.inputs['Base Color'].default_value=(*c,1); b.inputs['Roughness'].default_value=.78; return m
gray=simple_mat('DIAG_Gray_Face',(.42,.42,.42)); normal=bpy.data.materials.get('LIVE_Skin')
checker=bpy.data.materials.get('DIAG_Checker') or bpy.data.materials.new('DIAG_Checker'); checker.use_nodes=True; nt=checker.node_tree; nt.nodes.clear(); out=nt.nodes.new('ShaderNodeOutputMaterial'); bs=nt.nodes.new('ShaderNodeBsdfPrincipled'); tex=nt.nodes.new('ShaderNodeTexChecker'); tex.inputs['Color1'].default_value=(.08,.08,.08,1); tex.inputs['Color2'].default_value=(.78,.78,.78,1); tex.inputs['Scale'].default_value=8; nt.links.new(tex.outputs['Color'],bs.inputs['Base Color']); nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
def dup(name,dx,material):
 o=head.copy(); o.data=head.data.copy(); o.name='DIAG_'+name; o.location.x=dx
 for c in list(o.users_collection): c.objects.unlink(o)
 col.objects.link(o); o.data.materials.clear(); o.data.materials.append(material); o.hide_viewport=False; o.hide_render=False; return o
dup('GRAY',-2.6,gray); dup('CHECKER',0.0,checker); dup('ALBEDO',2.6,normal)
# place three heads in a fixed front orthographic view
for a in bpy.context.screen.areas:
 if a.type=='VIEW_3D':
  sp=a.spaces.active; sp.shading.type='MATERIAL'; sp.overlay.show_floor=False; sp.overlay.show_axis_x=False; sp.overlay.show_axis_y=False; sp.region_3d.view_rotation=Quaternion((.70710678,.70710678,0,0)); sp.region_3d.view_location=(-1.55,0,1.95); sp.region_3d.view_distance=5.8; sp.region_3d.view_perspective='ORTHO'
bpy.ops.wm.save_as_mainfile(filepath='<project-root>/assets/blender/hiruzen_face_diagnostics.blend')
