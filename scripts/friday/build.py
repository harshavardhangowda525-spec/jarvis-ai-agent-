"""
FRIDAY's Blender builder. Runs inside Blender:

    blender -b --factory-startup --python scripts/friday/build.py -- job.json

job.json = { "plan": {...validated model plan, mm...}, "outDir": "...",
             "views": ["front", ...], "render": {"engine", "width", "height", "samples", "gpu"},
             "exports": ["glb", "gltf", "stl"], "saveBlend": true }

It builds real geometry from the plan (no code from the model ever runs here),
organises it in collections, adds materials, studio lighting and the ten
cameras, saves the .blend, exports, renders the requested views and writes
result.json. Progress lines on stdout: FRIDAY:{"stage":..., "done":n, "total":m, "text":...}
"""
import json
import math
import os
import sys
import time
import traceback

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

MM = 0.001  # plan units (mm) -> Blender metres


def progress(stage, text, done=None, total=None, **extra):
    print("FRIDAY:" + json.dumps({"stage": stage, "text": text, "done": done, "total": total, **extra}), flush=True)


def fail(msg):
    print("FRIDAY:" + json.dumps({"stage": "error", "text": msg}), flush=True)
    sys.exit(3)


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    fail("No job file given.")
with open(argv[0], "r", encoding="utf-8") as f:
    JOB = json.load(f)
PLAN = JOB["plan"]
OUT = JOB["outDir"]
os.makedirs(OUT, exist_ok=True)
RENDER = JOB.get("render", {})
warnings = []

# ---------------------------------------------------------------- scene setup
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "MILLIMETERS"
scene.unit_settings.scale_length = 1.0

root = scene.collection
collections = {}


def coll(name):
    if name not in collections:
        c = bpy.data.collections.new(name)
        root.children.link(c)
        collections[name] = c
    return collections[name]


origin = bpy.data.objects.new("FRIDAY_Origin", None)  # mirror centre for symmetric parts
coll("Helpers").objects.link(origin)

# ---------------------------------------------------------------- materials
def set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def hex_rgba(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (lin[0], lin[1], lin[2], a)


materials = {}
for m in PLAN["materials"]:
    mat = bpy.data.materials.new(m["name"])
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, ["Base Color"], hex_rgba(m["color"]))
    set_input(bsdf, ["Metallic"], float(m.get("metallic", 0)))
    set_input(bsdf, ["Roughness"], float(m.get("roughness", 0.5)))
    set_input(bsdf, ["IOR"], float(m.get("ior", 1.45)))
    set_input(bsdf, ["Transmission Weight", "Transmission"], float(m.get("transmission", 0)))
    alpha = float(m.get("alpha", 1))
    set_input(bsdf, ["Alpha"], alpha)
    if m.get("emission"):
        set_input(bsdf, ["Emission Color", "Emission"], hex_rgba(m["emission"]))
        set_input(bsdf, ["Emission Strength"], float(m.get("emissionStrength", 0)))
    if alpha < 1 or float(m.get("transmission", 0)) > 0:
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(mat, attr, val)
                break
            except Exception:
                pass
    mat.diffuse_color = hex_rgba(m["color"], alpha)  # viewport / exported base colour
    mat["friday_id"] = m["id"]
    materials[m["id"]] = mat

# ---------------------------------------------------------------- geometry
def bm_to_object(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return bpy.data.objects.new(name, me)


def rounded_outline(w, h, r, seg=10):
    r = max(0.0, min(r, w / 2 - 1e-6, h / 2 - 1e-6))
    if r <= 0:
        return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def extrude_outline(points, depth, name):
    # points in metres (XY); extrude along Z, centred
    pts = list(points)
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts.reverse()
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    face = bm.faces.new(verts)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=(0, 0, depth))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_to_object(bm, name)


def make_shape(c):
    s = c["shape"]
    t = s["type"]
    name = c["name"]
    if t == "box":
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        sx, sy, sz = [v * MM for v in s["size"]]
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        return bm_to_object(bm, name)
    if t == "rounded_rect":
        pts = rounded_outline(s["width"] * MM, s["height"] * MM, s.get("radius", 0) * MM)
        return extrude_outline(pts, s["depth"] * MM, name)
    if t in ("cylinder", "cone"):
        bm = bmesh.new()
        r1 = (s["radius"] if t == "cylinder" else s["radius1"]) * MM
        r2 = (s["radius"] if t == "cylinder" else s["radius2"]) * MM
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=int(s.get("vertices", 48)), radius1=r1, radius2=r2, depth=s["depth"] * MM)
        return bm_to_object(bm, name)
    if t == "sphere":
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=s["radius"] * MM)
        return bm_to_object(bm, name)
    if t == "capsule":
        bm = bmesh.new()
        r = s["radius"] * MM
        half = s["length"] * MM / 2
        bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=r)
        for v in bm.verts:
            v.co.z += half if v.co.z > 1e-9 else (-half if v.co.z < -1e-9 else 0)
        return bm_to_object(bm, name)
    if t == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=s["major"] * MM, minor_radius=s["minor"] * MM, major_segments=64, minor_segments=24)
        o = bpy.context.object
        for cl in list(o.users_collection):
            cl.objects.unlink(o)
        o.name = name
        return o
    if t == "profile":
        return extrude_outline([(x * MM, y * MM) for x, y in s["points"]], s["depth"] * MM, name)
    if t == "tube":
        cu = bpy.data.curves.new(name + "_path", "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = s["radius"] * MM
        cu.bevel_resolution = 6
        cu.use_fill_caps = True
        sp = cu.splines.new("POLY")
        sp.points.add(len(s["points"]) - 1)
        for i, p in enumerate(s["points"]):
            sp.points[i].co = (p[0] * MM, p[1] * MM, p[2] * MM, 1)
        tmp = bpy.data.objects.new(name + "_curve", cu)
        root.objects.link(tmp)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
        bpy.data.objects.remove(tmp)
        return bpy.data.objects.new(name, me)
    fail(f"Unknown shape type {t}")


objects = {}
comps = PLAN["components"]
visible = [c for c in comps if not c.get("cutter")]
progress("geometry", f"Building geometry: 0 of {len(comps)} components", 0, len(comps))
for i, c in enumerate(comps):
    try:
        o = make_shape(c)
    except SystemExit:
        raise
    except Exception as e:  # one bad part is reported, not hidden
        fail(f"Couldn't build component '{c['name']}': {e}")
    o.location = Vector(c.get("position", [0, 0, 0])) * MM
    o.rotation_euler = Euler([math.radians(a) for a in c.get("rotation", [0, 0, 0])], "XYZ")
    o.scale = c.get("scale", [1, 1, 1])
    group = "Cutters" if c.get("cutter") else c.get("group", "Model")
    coll(group).objects.link(o)
    o["friday_id"] = c["id"]
    o["friday_group"] = c.get("group", "Model")
    o["friday_internal"] = bool(c.get("internal"))
    o["friday_conceptual"] = bool(c.get("conceptual"))
    if c.get("explode"):
        o["friday_explode"] = [v * MM for v in c["explode"]]
    o.data.materials.append(materials[c["material"]])
    for p in o.data.polygons:
        p.use_smooth = True
    if c.get("cutter"):
        o.hide_render = True
        o.display_type = "WIRE"
    objects[c["id"]] = o
    progress("geometry", f"Building geometry: {i + 1} of {len(comps)} components", i + 1, len(comps))

# modifiers, in a sensible order: booleans -> solidify -> mirror -> bevel -> subdivision
progress("modifiers", "Applying bevels, shells, cuts and symmetry")
for c in comps:
    o = objects[c["id"]]
    for cid in c.get("subtract", []):
        m = o.modifiers.new(f"Cut {objects[cid].name}", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.object = objects[cid]
        try:
            m.solver = "EXACT"
        except Exception:
            pass
    if c.get("solidify"):
        m = o.modifiers.new("Shell", "SOLIDIFY")
        m.thickness = c["solidify"] * MM
        m.offset = 0
    if c.get("mirrorX"):
        m = o.modifiers.new("Mirror X", "MIRROR")
        m.use_axis = (True, False, False)
        m.mirror_object = origin
    if c.get("bevel") and c["bevel"].get("width", 0) > 0:
        m = o.modifiers.new("Bevel", "BEVEL")
        m.width = c["bevel"]["width"] * MM
        m.segments = int(c["bevel"].get("segments", 3))
        m.limit_method = "ANGLE"
        m.harden_normals = False
    if c.get("subdivision", 0) > 0:
        m = o.modifiers.new("Smooth", "SUBSURF")
        m.levels = m.render_levels = int(c["subdivision"])
    if any(md.type in ("BEVEL", "SUBSURF") for md in o.modifiers):
        try:
            o.data.shade_smooth_by_angle(angle=math.radians(35))
        except Exception:
            pass
for c in comps:
    if c.get("cutter"):
        objects[c["id"]].hide_set(True)

# ---------------------------------------------------------------- validate
dg = bpy.context.evaluated_depsgraph_get()
summary = []
mins, maxs = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))


def world_bbox(o):
    ev = o.evaluated_get(dg)
    pts = [ev.matrix_world @ Vector(v) for v in ev.bound_box]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


for c in visible:
    o = objects[c["id"]]
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    polys = len(me.polygons)
    ev.to_mesh_clear()
    if polys == 0:
        fail(f"Component '{c['name']}' ended up with no geometry (check its shape and cuts).")
    lo, hi = world_bbox(o)
    mins = Vector((min(mins.x, lo.x), min(mins.y, lo.y), min(mins.z, lo.z)))
    maxs = Vector((max(maxs.x, hi.x), max(maxs.y, hi.y), max(maxs.z, hi.z)))
    summary.append({"id": c["id"], "name": c["name"], "group": c.get("group", "Model"), "material": c["material"], "polygons": polys,
                     "internal": bool(c.get("internal")), "conceptual": bool(c.get("conceptual")),
                     "bbox_mm": [[round(v / MM, 2) for v in lo], [round(v / MM, 2) for v in hi]]})
center = (mins + maxs) / 2
size = maxs - mins
radius = max(size.length / 2, 1e-4)
progress("validate", f"Scene checked: {len(visible)} parts, {sum(s['polygons'] for s in summary)} polygons, {round(size.x / MM)}×{round(size.y / MM)}×{round(size.z / MM)} mm")

# ---------------------------------------------------------------- lighting & world
env = PLAN.get("environment", "studio_dark")
world = bpy.data.worlds.new("Studio")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = {"studio_dark": (0.012, 0.016, 0.026, 1), "studio_light": (0.55, 0.58, 0.62, 1), "white": (0.9, 0.9, 0.9, 1)}[env]
bg.inputs["Strength"].default_value = 1.0
lights = coll("Studio Lighting")


def area(name, loc, energy, size_m, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = size_m
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = (center - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    lights.objects.link(ob)


k = radius * 4
scale_e = (radius / 0.1) ** 2 * float(RENDER.get("lightScale", 0.3))  # light energy grows with the scene's size
area("Key Light", center + Vector((-1.2, -1.4, 1.3)) * k, 60 * scale_e, radius * 2.5)
area("Fill Light", center + Vector((1.5, -0.8, 0.4)) * k, 22 * scale_e, radius * 3, (0.85, 0.92, 1.0))
area("Rim Light", center + Vector((0.4, 1.6, 1.0)) * k, 45 * scale_e, radius * 2, (0.8, 0.9, 1.0))
area("Top Light", center + Vector((0, 0, 2.0)) * k, 18 * scale_e, radius * 4)

# ---------------------------------------------------------------- cameras
cams = coll("Cameras")
W, H = int(RENDER.get("width", 1600)), int(RENDER.get("height", 1200))
aspect = W / H


def add_camera(name, kind, loc, rot=None, target=None, ortho_scale=None, lens=50):
    cd = bpy.data.cameras.new(name)
    ob = bpy.data.objects.new(name, cd)
    cams.objects.link(ob)
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    else:
        ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cd.clip_start = radius * 0.01
    cd.clip_end = radius * 400
    if kind == "ortho":
        cd.type = "ORTHO"
        cd.ortho_scale = ortho_scale
    else:
        cd.lens = lens
    return ob


def ortho_fit(w, h):
    return max(w * 1.18, h * 1.18 * aspect)


dist = radius * 6
fov = 2 * math.atan(18 / 50)
persp_d = radius / math.sin(fov / 2) * 1.08


def persp_loc(dirv, tgt=center, d=persp_d):
    return Vector(tgt) + Vector(dirv).normalized() * d


VIEW_DEFS = {
    "front": lambda: add_camera("CAM_front", "ortho", center + Vector((0, -dist, 0)), rot=Euler((math.pi / 2, 0, 0)), ortho_scale=ortho_fit(size.x, size.z)),
    "rear": lambda: add_camera("CAM_rear", "ortho", center + Vector((0, dist, 0)), rot=Euler((math.pi / 2, 0, math.pi)), ortho_scale=ortho_fit(size.x, size.z)),
    "left": lambda: add_camera("CAM_left", "ortho", center + Vector((-dist, 0, 0)), rot=Euler((math.pi / 2, 0, -math.pi / 2)), ortho_scale=ortho_fit(size.y, size.z)),
    "right": lambda: add_camera("CAM_right", "ortho", center + Vector((dist, 0, 0)), rot=Euler((math.pi / 2, 0, math.pi / 2)), ortho_scale=ortho_fit(size.y, size.z)),
    "top": lambda: add_camera("CAM_top", "ortho", center + Vector((0, 0, dist)), rot=Euler((0, 0, 0)), ortho_scale=ortho_fit(size.x, size.y)),
    "bottom": lambda: add_camera("CAM_bottom", "ortho", center + Vector((0, 0, -dist)), rot=Euler((math.pi, 0, 0)), ortho_scale=ortho_fit(size.x, size.y)),
    "front_34": lambda: add_camera("CAM_front_34", "persp", persp_loc((-0.75, -1.0, 0.45)), target=center),
    "rear_34": lambda: add_camera("CAM_rear_34", "persp", persp_loc((0.8, 1.0, 0.5)), target=center),
}

# the close-up: the chosen part, else the most detailed visible exterior part
detail_id = PLAN.get("detail")
if not detail_id or detail_id not in objects:
    ext = [s for s in summary if not s["internal"]] or summary
    detail_id = sorted(ext, key=lambda s: -s["polygons"])[0]["id"]
def own_bbox(o):
    # the part itself (before mirroring/bevels) — a mirrored part's evaluated box spans both sides
    pts = [o.matrix_world @ v.co for v in o.data.vertices] or [o.matrix_world.translation]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


dlo, dhi = own_bbox(objects[detail_id])
dcenter, dradius = (dlo + dhi) / 2, max((dhi - dlo).length / 2 * 1.8, radius * 0.24)  # the part with some context
VIEW_DEFS["detail"] = lambda: add_camera("CAM_detail", "persp", dcenter + Vector((-0.7, -1.0, 0.45)).normalized() * (dradius / math.sin(fov / 2) * 1.3), target=dcenter)

has_explode = any("friday_explode" in objects[c["id"]] for c in visible) or any(c.get("internal") for c in visible)
explode_ok = len(visible) >= 3 and has_explode
VIEW_DEFS["exploded"] = lambda: add_camera("CAM_exploded", "persp", persp_loc((-0.75, -1.0, 0.55), d=persp_d * 1.45), target=center)
camera_objs = {v: VIEW_DEFS[v]() for v in ["front", "rear", "left", "right", "top", "bottom", "front_34", "rear_34", "detail", "exploded"]}
if not explode_ok:
    # no meaningful parts to pull apart → a hero angle from slightly below instead
    ob = camera_objs["exploded"]
    ob.name = "CAM_hero_low"
    ob.location = persp_loc((-0.35, -1.0, -0.18), d=persp_d * 0.95)
    ob.rotation_euler = (center - ob.location).to_track_quat("-Z", "Y").to_euler()
    warnings.append("No internal parts or explode offsets — the tenth view is a low hero angle instead of an exploded view.")

# ---------------------------------------------------------------- render settings
engine = str(RENDER.get("engine", "cycles")).lower()
device_used = "CPU"
if engine == "eevee":
    for eid in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = eid
            break
        except Exception:
            continue
    else:
        warnings.append("EEVEE isn't available in this Blender — rendering with Cycles.")
        engine = "cycles"
if engine != "eevee":
    scene.render.engine = "CYCLES"
    scene.cycles.samples = int(RENDER.get("samples", 64))
    scene.cycles.use_adaptive_sampling = True
    try:
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    scene.cycles.device = "CPU"
    if RENDER.get("gpu", True):
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for dtype in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
                try:
                    prefs.compute_device_type = dtype
                except Exception:
                    continue
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type == dtype]
                if gpus:
                    for d in prefs.devices:
                        d.use = d.type == dtype
                    scene.cycles.device = "GPU"
                    device_used = f"GPU ({dtype}: {gpus[0].name})"
                    break
        except Exception as e:
            warnings.append(f"GPU rendering unavailable ({e}); using the CPU.")
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA" if False else "RGB"
scene.render.film_transparent = False
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass
scene["friday_render"] = json.dumps({"engine": scene.render.engine, "width": W, "height": H, "samples": int(RENDER.get("samples", 64))})
scene.camera = camera_objs["front_34"]

# ---------------------------------------------------------------- save & export (before any exploded offsets)
files = {}
if JOB.get("saveBlend", True):
    progress("save", "Saving the Blender project")
    p = os.path.join(OUT, "model.blend")
    bpy.ops.wm.save_as_mainfile(filepath=p, compress=True)
    files["blend"] = p

for fmt in JOB.get("exports", ["glb"]):
    progress("export", f"Exporting {fmt.upper()}")
    try:
        if fmt in ("glb", "gltf"):
            p = os.path.join(OUT, "model.glb" if fmt == "glb" else "model.gltf")
            bpy.ops.export_scene.gltf(filepath=p, export_format="GLB" if fmt == "glb" else "GLTF_SEPARATE", export_apply=True,
                                      export_extras=True, use_visible=True, export_cameras=False, export_lights=False, export_yup=True)
        elif fmt == "stl":
            p = os.path.join(OUT, "model.stl")
            for o in bpy.context.view_layer.objects:
                o.select_set(o.type == "MESH" and not o.hide_get() and not o.hide_render)
            bpy.ops.wm.stl_export(filepath=p, export_selected_objects=True, apply_modifiers=True, global_scale=1000.0)
        else:
            warnings.append(f"Unknown export format {fmt}")
            continue
        files[fmt] = p
    except Exception as e:
        fail(f"Export to {fmt.upper()} failed: {e}")

# ---------------------------------------------------------------- render
views = JOB.get("views", [])
renders = []
rdir = os.path.join(OUT, "renders")
os.makedirs(rdir, exist_ok=True)


def apply_explode(on):
    if not explode_ok:
        return
    any_given = any("friday_explode" in objects[c["id"]] for c in visible)
    for c in visible:
        o = objects[c["id"]]
        if on:
            o["_home"] = list(o.location)
            if "friday_explode" in o:
                off = Vector(o["friday_explode"])
            elif not any_given:
                lo, hi = world_bbox(o)
                d = (lo + hi) / 2 - center
                off = (d.normalized() if d.length > 1e-6 else Vector((0, 0, 1))) * radius * (0.55 if c.get("internal") else 0.35)
            else:
                off = Vector((0, 0, 0))
            o.location = Vector(o.location) + off
        elif "_home" in o:
            o.location = Vector(o["_home"])
            del o["_home"]


for i, v in enumerate(views):
    if v not in camera_objs:
        warnings.append(f"Unknown view {v}")
        continue
    progress("render", f"Rendering view {i + 1} of {len(views)}: {v}", i, len(views), view=v)
    scene.camera = camera_objs[v]
    if v == "exploded":
        apply_explode(True)
        if explode_ok:
            # fit the camera to the parts where they are now
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            elo, ehi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
            for c in visible:
                lo, hi = world_bbox(objects[c["id"]])
                elo = Vector((min(elo.x, lo.x), min(elo.y, lo.y), min(elo.z, lo.z)))
                ehi = Vector((max(ehi.x, hi.x), max(ehi.y, hi.y), max(ehi.z, hi.z)))
            ec, er = (elo + ehi) / 2, max((ehi - elo).length / 2, 1e-4)
            cam = camera_objs[v]
            cam.location = ec + Vector((-0.75, -1.0, 0.55)).normalized() * (er / math.sin(fov / 2) * 1.02)
            cam.rotation_euler = (ec - cam.location).to_track_quat("-Z", "Y").to_euler()
    t0 = time.time()
    path = os.path.join(rdir, f"{v}.png")
    scene.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True)
    except Exception as e:
        fail(f"Rendering the {v} view failed: {e}")
    finally:
        if v == "exploded":
            apply_explode(False)
    cam = camera_objs[v]
    renders.append({"view": v, "file": path, "seconds": round(time.time() - t0, 2), "width": W, "height": H,
                    "camera": {"name": cam.name, "type": cam.data.type, "location": [round(x, 5) for x in cam.location],
                               "rotation": [round(x, 5) for x in cam.rotation_euler],
                               **({"ortho_scale": round(cam.data.ortho_scale, 5)} if cam.data.type == "ORTHO" else {"lens": cam.data.lens})}})
    progress("render", f"Rendered view {i + 1} of {len(views)}: {v}", i + 1, len(views), view=v)

result = {
    "ok": True, "blender": bpy.app.version_string, "engine": scene.render.engine, "device": device_used,
    "components": summary, "size_mm": [round(size.x / MM, 2), round(size.y / MM, 2), round(size.z / MM, 2)],
    "center_mm": [round(v / MM, 2) for v in center], "exploded": explode_ok, "detail": detail_id,
    "files": files, "renders": renders, "warnings": warnings,
}
with open(os.path.join(OUT, "result.json"), "w", encoding="utf-8") as f:
    json.dump(result, f, indent=1)
progress("done", "Blender finished")
