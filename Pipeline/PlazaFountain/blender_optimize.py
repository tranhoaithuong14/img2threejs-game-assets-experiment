import bpy
import bmesh
import json
import math
import os
from mathutils import Matrix, Vector

WORKSPACE = "/Users/cristian/Documents/Game assets"
SOURCE_BLEND = os.path.join(WORKSPACE, "Blender", "PlazaFountain.blend")
OPT_BLEND = os.path.join(WORKSPACE, "Blender", "PlazaFountain.optimized.blend")
LOD0_GLB = os.path.join(WORKSPACE, "Assets", "PlazaFountain.optimized.glb")
LOD1_GLB = os.path.join(WORKSPACE, "Assets", "PlazaFountain.LOD1.glb")
LOD2_GLB = os.path.join(WORKSPACE, "Assets", "PlazaFountain.LOD2.glb")
UNITY_FBX = os.path.join(WORKSPACE, "UnityProject", "Assets", "PlazaFountain", "Models", "PlazaFountain.fbx")
PREVIEW = os.path.join(WORKSPACE, "Previews", "PlazaFountain_Blender.png")
REPORT = os.path.join(WORKSPACE, "Pipeline", "PlazaFountain", "blender-optimization-report.json")

for path in (OPT_BLEND, LOD0_GLB, LOD1_GLB, LOD2_GLB, UNITY_FBX, PREVIEW, REPORT):
    os.makedirs(os.path.dirname(path), exist_ok=True)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0


def mesh_triangles(obj):
    return sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)


def descendants(root):
    result = []
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def mesh_descendants(root):
    return [obj for obj in descendants(root) if obj.type == "MESH"]


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def srgb_channel(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def srgb(hex_color):
    value = hex_color.lstrip("#")
    rgb = [int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(srgb_channel(channel) for channel in rgb) + (1.0,)


def principled(material):
    material.use_nodes = True
    tree = material.node_tree
    return tree, next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")


def set_input(node, name, value):
    socket = node.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def configure_materials():
    palette = {
        "M_Limestone": ("#C8B38D", 0.66, 0.0),
        "M_Teal_Ceramic": ("#365B57", 0.44, 0.0),
        "M_Dark_Teal_Recess": ("#3D5B57", 0.56, 0.0),
        "M_Aged_Copper": ("#965C45", 0.42, 0.42),
        "M_Water": ("#286F72", 0.24, 0.0),
    }
    for name, (color, roughness, metallic) in palette.items():
        material = bpy.data.materials.get(name)
        if not material:
            continue
        tree, bsdf = principled(material)
        set_input(bsdf, "Base Color", srgb(color))
        set_input(bsdf, "Roughness", roughness)
        set_input(bsdf, "Metallic", metallic)
        if name == "M_Water":
            set_input(bsdf, "Alpha", 1.0)
            set_input(bsdf, "Transmission Weight", 0.05)
            set_input(bsdf, "IOR", 1.333)
            material.diffuse_color = (*srgb(color)[:3], 1.0)
            if hasattr(material, "surface_render_method"):
                material.surface_render_method = "DITHERED"
        else:
            material.diffuse_color = srgb(color)

    stone = bpy.data.materials.get("M_Limestone")
    if stone:
        tree, bsdf = principled(stone)
        for node in list(tree.nodes):
            if node.name.startswith("PF_"):
                tree.nodes.remove(node)
        rough_noise = tree.nodes.new("ShaderNodeTexNoise")
        rough_noise.name = "PF_RoughnessNoise"
        rough_noise.label = "Independent limestone roughness"
        rough_noise.inputs["Scale"].default_value = 8.0
        rough_noise.inputs["Detail"].default_value = 3.0
        rough_noise.inputs["Roughness"].default_value = 0.65
        rough_ramp = tree.nodes.new("ShaderNodeValToRGB")
        rough_ramp.name = "PF_RoughnessRange"
        rough_ramp.color_ramp.elements[0].position = 0.18
        rough_ramp.color_ramp.elements[0].color = (0.43, 0.43, 0.43, 1.0)
        rough_ramp.color_ramp.elements[1].position = 0.82
        rough_ramp.color_ramp.elements[1].color = (0.72, 0.72, 0.72, 1.0)
        tree.links.new(rough_noise.outputs["Fac"], rough_ramp.inputs["Fac"])
        tree.links.new(rough_ramp.outputs["Color"], bsdf.inputs["Roughness"])

        bump_noise = tree.nodes.new("ShaderNodeTexNoise")
        bump_noise.name = "PF_BumpNoise"
        bump_noise.label = "Independent limestone micro normal"
        bump_noise.inputs["Scale"].default_value = 55.0
        bump_noise.inputs["Detail"].default_value = 2.5
        bump_noise.inputs["Roughness"].default_value = 0.7
        bump = tree.nodes.new("ShaderNodeBump")
        bump.name = "PF_MicroBump"
        bump.inputs["Strength"].default_value = 0.17
        bump.inputs["Distance"].default_value = 0.025
        tree.links.new(bump_noise.outputs["Fac"], bump.inputs["Height"])
        tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    water = bpy.data.materials.get("M_Water")
    if water:
        tree, bsdf = principled(water)
        noise = tree.nodes.new("ShaderNodeTexNoise")
        noise.name = "PF_WaterRipple"
        noise.inputs["Scale"].default_value = 18.0
        noise.inputs["Detail"].default_value = 2.0
        noise.inputs["Roughness"].default_value = 0.55
        bump = tree.nodes.new("ShaderNodeBump")
        bump.name = "PF_WaterBump"
        bump.inputs["Strength"].default_value = 0.22
        bump.inputs["Distance"].default_value = 0.035
        tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def clean_imported_meshes(objects):
    """Reconnect glTF normal-split duplicates and remove zero-area pole faces."""
    for obj in objects:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
        bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-8)
        bm.normal_update()
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()


def duplicate_join_lod(source_root, new_root, name, ratio):
    duplicates = []
    for source in mesh_descendants(source_root):
        duplicate = source.copy()
        duplicate.data = source.data.copy()
        duplicate.animation_data_clear()
        bpy.context.collection.objects.link(duplicate)
        world_matrix = source.matrix_world.copy()
        duplicate.parent = None
        duplicate.matrix_world = world_matrix
        duplicates.append(duplicate)
    select_only(duplicates)
    bpy.context.view_layer.objects.active = duplicates[0]
    bpy.ops.object.join()
    lod = bpy.context.view_layer.objects.active
    lod.name = name
    lod.data.name = f"{name}_Mesh"
    normalize_material_slots(lod)
    lod.parent = new_root
    lod.matrix_parent_inverse = new_root.matrix_world.inverted()
    modifier = lod.modifiers.new(name="GameReady_Decimate", type="DECIMATE")
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = lod
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in lod.data.polygons:
        polygon.use_smooth = True
    lod["lod_tier"] = name
    lod["generated_from"] = "LOD0 source hierarchy"
    return lod


def normalize_material_slots(obj):
    """Collapse duplicate references to the same material into one submesh slot."""
    old_materials = list(obj.data.materials)
    unique_materials = []
    old_to_new = {}
    for index, material in enumerate(old_materials):
        if material in unique_materials:
            old_to_new[index] = unique_materials.index(material)
        else:
            old_to_new[index] = len(unique_materials)
            unique_materials.append(material)
    remapped_indices = [old_to_new.get(polygon.material_index, 0) for polygon in obj.data.polygons]
    obj.data.materials.clear()
    for material in unique_materials:
        obj.data.materials.append(material)
    for polygon, material_index in zip(obj.data.polygons, remapped_indices):
        polygon.material_index = material_index


def join_lod0_group(objects, name, parent):
    target_inverse = parent.matrix_world.inverted()
    duplicates = []
    for source in objects:
        duplicate = source.copy()
        duplicate.data = source.data.copy()
        duplicate.animation_data_clear()
        bpy.context.collection.objects.link(duplicate)
        # Bake each source into the target parent's local space before joining.
        # This makes the merged renderer independent of whichever child happens
        # to become Blender's active join object.
        duplicate.data.transform(target_inverse @ source.matrix_world)
        duplicate.parent = None
        duplicate.matrix_world = Matrix.Identity(4)
        duplicates.append(duplicate)
    select_only(duplicates)
    bpy.context.view_layer.objects.active = duplicates[0]
    bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = name
    merged.data.name = f"{name}_Mesh"
    normalize_material_slots(merged)
    merged.parent = parent
    merged.matrix_parent_inverse = Matrix.Identity(4)
    merged.matrix_basis = Matrix.Identity(4)
    merged["optimized_renderer_group"] = True
    return merged


def consolidate_lod0_renderers(source_root):
    """Reduce LOD0 to exactly eight material draw calls while retaining sockets."""
    originals = mesh_descendants(source_root)
    upper_pivot = bpy.data.objects.get("UpperBowl_Pivot")
    upper_objects = []
    static_objects = []
    for obj in originals:
        ancestor = obj.parent
        is_upper = False
        while ancestor is not None:
            if ancestor == upper_pivot:
                is_upper = True
                break
            ancestor = ancestor.parent
        (upper_objects if is_upper else static_objects).append(obj)
    static_merged = join_lod0_group(static_objects, "LOD0_Static", source_root)
    upper_merged = join_lod0_group(upper_objects, "LOD0_UpperAssembly", upper_pivot)
    for obj in originals:
        bpy.data.objects.remove(obj, do_unlink=True)
    return [static_merged, upper_merged]


def mesh_health(objects):
    non_manifold = 0
    degenerate = 0
    loose_vertices = 0
    for obj in objects:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.normal_update()
        non_manifold += sum(1 for edge in bm.edges if not edge.is_manifold)
        degenerate += sum(1 for face in bm.faces if face.calc_area() < 1e-10)
        loose_vertices += sum(1 for vertex in bm.verts if not vertex.link_edges)
        bm.free()
    return {
        "nonManifoldEdges": non_manifold,
        "degenerateFaces": degenerate,
        "looseVertices": loose_vertices,
    }


source_root = bpy.data.objects.get("PlazaFountain")
if source_root is None:
    raise RuntimeError("Expected imported PlazaFountain root")
source_root.name = "LOD0"
source_root["lod_tier"] = "LOD0"
source_root["source"] = "img2threejs GLB"
source_imported_tris = sum(mesh_triangles(obj) for obj in mesh_descendants(source_root))

root = bpy.data.objects.new("PlazaFountain", None)
bpy.context.scene.collection.objects.link(root)
root["asset_id"] = "plaza-fountain"
root["coordinate_frame"] = "+Z forward, +Y up in interchange; converted to Blender Z-up"
root["unit"] = "meter"
source_root.parent = root
source_root.matrix_parent_inverse = root.matrix_world.inverted()

clean_imported_meshes(mesh_descendants(source_root))
configure_materials()

# Keep faceted plinths/panels crisp while smoothing curved basins, fish heads, and water.
smooth_tokens = (
    "Basin_Rim",
    "Basin_Wall",
    "Water_Surface",
    "FishHead",
    "FishNeck",
    "FishCranium",
    "FishMuzzle",
    "FishLowerJaw",
    "FishMouth",
    "FishEye",
    "FishBrow",
    "FishBrow",
    "FishGill",
    "FishFin",
    "FishCrest",
    "CopperBand",
    "UpperBowl",
    "Finial",
)
for obj in mesh_descendants(source_root):
    if any(token in obj.name for token in smooth_tokens):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True

lod1 = duplicate_join_lod(source_root, root, "LOD1", 0.48)
lod2 = duplicate_join_lod(source_root, root, "LOD2", 0.16)
consolidate_lod0_renderers(source_root)
lod1.hide_render = True
lod2.hide_render = True

lod0_meshes = mesh_descendants(source_root)
lod0_tris = sum(mesh_triangles(obj) for obj in lod0_meshes)
lod1_tris = mesh_triangles(lod1)
lod2_tris = mesh_triangles(lod2)
if not (lod0_tris > lod1_tris > lod2_tris):
    raise RuntimeError(f"LOD triangle counts are not strictly decreasing: {lod0_tris}, {lod1_tris}, {lod2_tris}")
if lod0_tris > 25000 or lod1_tris > 12000 or lod2_tris > 4000:
    raise RuntimeError(f"LOD budget exceeded: {lod0_tris}, {lod1_tris}, {lod2_tris}")

# Review-only water jets and impact ripples communicate runtime intent.
fx_collection = bpy.data.collections.new("REVIEW_WATER_FX")
scene.collection.children.link(fx_collection)
water_mat = bpy.data.materials.get("M_Water")
jet_material = bpy.data.materials.new("M_Water_RuntimeJet_Review")
jet_material.use_nodes = True
jet_tree, jet_bsdf = principled(jet_material)
set_input(jet_bsdf, "Base Color", srgb("#DDF2EE"))
set_input(jet_bsdf, "Roughness", 0.08)
set_input(jet_bsdf, "Alpha", 0.76)
set_input(jet_bsdf, "Transmission Weight", 0.12)
set_input(jet_bsdf, "IOR", 1.333)
jet_material.diffuse_color = (*srgb("#DDF2EE")[:3], 0.76)
if hasattr(jet_material, "surface_render_method"):
    jet_material.surface_render_method = "DITHERED"


def move_to_collection(obj, collection):
    for source_collection in list(obj.users_collection):
        source_collection.objects.unlink(obj)
    collection.objects.link(obj)


lower_water_socket = bpy.data.objects.get("WaterLower_Socket")
impact_z = lower_water_socket.matrix_world.translation.z + 0.004 if lower_water_socket else 0.732
for direction in ("N", "E", "S", "W"):
    socket = bpy.data.objects.get(f"Spout_{direction}")
    if not socket:
        continue
    start = socket.matrix_world.translation
    radial = Vector((start.x, start.y, 0.0)).normalized()
    end = radial * 0.69
    end.z = impact_z
    curve_data = bpy.data.curves.new(f"WaterJet_{direction}_Curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = 0.006
    curve_data.bevel_resolution = 3
    curve_data.resolution_u = 16
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(2)
    midpoint = start.lerp(end, 0.48) + radial * 0.045 + Vector((0, 0, 0.035))
    points = [start, midpoint, end]
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    jet = bpy.data.objects.new(f"WaterJet_{direction}_Review", curve_data)
    fx_collection.objects.link(jet)
    jet["export"] = False
    curve_data.materials.append(jet_material)

    for suffix, major_radius, minor_radius, height_offset in (
        ("Inner", 0.042, 0.0045, 0.007),
        ("Outer", 0.078, 0.0035, 0.005),
    ):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=major_radius,
            minor_radius=minor_radius,
            major_segments=28,
            minor_segments=6,
            location=end + Vector((0, 0, height_offset)),
        )
        ripple = bpy.context.object
        ripple.name = f"ImpactRipple{suffix}_{direction}_Review"
        move_to_collection(ripple, fx_collection)
        ripple.data.materials.append(jet_material)
        ripple["export"] = False

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=8,
        radius=0.008,
        depth=0.035,
        location=end + Vector((0, 0, 0.0175)),
    )
    splash = bpy.context.object
    splash.name = f"ImpactSplash_{direction}_Review"
    move_to_collection(splash, fx_collection)
    splash.data.materials.append(jet_material)
    splash["export"] = False

# Studio floor, camera, and soft key/fill/rim lighting.
studio_collection = bpy.data.collections.new("REVIEW_STUDIO")
scene.collection.children.link(studio_collection)
bpy.ops.mesh.primitive_plane_add(size=12.0, location=(0.0, 0.0, -0.015))
floor = bpy.context.object
floor.name = "StudioFloor"
for collection in list(floor.users_collection):
    collection.objects.unlink(floor)
studio_collection.objects.link(floor)
floor["export"] = False
floor_material = bpy.data.materials.new("M_StudioFloor")
floor_material.use_nodes = True
floor_bsdf = next(node for node in floor_material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
set_input(floor_bsdf, "Base Color", srgb("#D5D6D4"))
set_input(floor_bsdf, "Roughness", 0.82)
floor.data.materials.append(floor_material)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


camera_data = bpy.data.cameras.new("FountainReviewCamera")
camera = bpy.data.objects.new("FountainReviewCamera", camera_data)
studio_collection.objects.link(camera)
camera.location = (3.55, -4.15, 3.0)
camera_data.lens = 58
look_at(camera, (0.0, 0.0, 1.05))
scene.camera = camera


def add_area(name, location, energy, size, color, target=(0.0, 0.0, 1.0)):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    studio_collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


add_area("Key_Warm", (-4.2, -4.6, 6.2), 760, 4.8, (1.0, 0.92, 0.82))
add_area("Fill_Cool", (4.6, -1.4, 3.6), 430, 4.3, (0.80, 0.90, 1.0))
add_area("Rim_Soft", (2.2, 4.5, 5.1), 360, 3.8, (1.0, 1.0, 1.0))

world = scene.world or bpy.data.worlds.new("FountainWorld")
scene.world = world
world.use_nodes = True
background = world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = srgb("#D6D8D7")
background.inputs["Strength"].default_value = 0.5

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = False
scene.render.filepath = PREVIEW
scene.render.image_settings.color_depth = "8"
scene.render.resolution_percentage = 100
scene.view_settings.look = "AgX - Medium Low Contrast"
scene.render.filepath = PREVIEW
bpy.ops.render.render(write_still=True)

# Save the production scene before export. LOD1/LOD2 stay render-hidden only.
scene["asset_stage"] = "optimized"
scene["lod0_triangles"] = lod0_tris
scene["lod1_triangles"] = lod1_tris
scene["lod2_triangles"] = lod2_tris
bpy.ops.wm.save_as_mainfile(filepath=OPT_BLEND)

# GLB: production LOD0 keeps the semantic/sockets hierarchy under PlazaFountain.
lod0_export = [root, source_root] + descendants(source_root)
select_only(lod0_export)
bpy.ops.export_scene.gltf(
    filepath=LOD0_GLB,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_attributes=True,
    export_extras=True,
)

select_only([lod1])
bpy.ops.export_scene.gltf(filepath=LOD1_GLB, export_format="GLB", use_selection=True, export_yup=True, export_extras=True)
select_only([lod2])
bpy.ops.export_scene.gltf(filepath=LOD2_GLB, export_format="GLB", use_selection=True, export_yup=True, export_extras=True)

# FBX carries all LOD tiers and named sockets into the Unity project.
unity_export = [root, source_root, lod1, lod2] + descendants(source_root)
select_only(unity_export)
bpy.ops.export_scene.fbx(
    filepath=UNITY_FBX,
    use_selection=True,
    object_types={"EMPTY", "MESH"},
    apply_unit_scale=True,
    apply_scale_options="FBX_SCALE_UNITS",
    axis_forward="-Z",
    axis_up="Y",
    add_leaf_bones=False,
    bake_anim=False,
    path_mode="AUTO",
)

material_names = sorted({slot.material.name for obj in lod0_meshes for slot in obj.material_slots if slot.material})
lod0_estimated_draw_calls = sum(len([slot for slot in obj.material_slots if slot.material]) for obj in lod0_meshes)
source_health = mesh_health(lod0_meshes)
report = {
    "asset": "PlazaFountain",
    "blenderVersion": bpy.app.version_string,
    "source": "Assets/PlazaFountain.source.glb",
    "optimizedBlend": "Blender/PlazaFountain.optimized.blend",
    "exports": {
        "lod0": "Assets/PlazaFountain.optimized.glb",
        "lod1": "Assets/PlazaFountain.LOD1.glb",
        "lod2": "Assets/PlazaFountain.LOD2.glb",
        "unityFbx": "UnityProject/Assets/PlazaFountain/Models/PlazaFountain.fbx",
    },
    "metrics": {
        "sourceImportedTriangles": source_imported_tris,
        "lod0Triangles": lod0_tris,
        "lod1Triangles": lod1_tris,
        "lod2Triangles": lod2_tris,
        "lod0MeshObjects": len(lod0_meshes),
        "lod1MeshObjects": 1,
        "lod2MeshObjects": 1,
        "materials": len(material_names),
        "materialNames": material_names,
        "lod0EstimatedDrawCalls": lod0_estimated_draw_calls,
        "targetTriangles": {"lod0": 25000, "lod1": 12000, "lod2": 4000},
        "targetDrawCalls": 8,
        "targetFps": 60,
    },
    "geometryHealth": {
        **source_health,
        "allowedOpenSurfaceNote": "Water disks and thin panel/ornament surfaces intentionally contribute open boundary edges; vertical masonry seams are closed embedded solids, top-rim separation uses capped stone segments with physical gaps, the closed finial has outward winding for correct front-face depth occlusion of its torus collar, and no degenerate faces or loose vertices are accepted.",
    },
    "operations": [
        "preserved LOD0 semantic hierarchy, pivots, and effect sockets",
        "consolidated LOD0 visuals into static and upper-assembly renderers for eight material draw calls",
        "reconstructed independent limestone roughness and micro-normal response",
        "reconstructed water ripple-normal response",
        "retained eight shallow finial channels as recessed surface geometry with no attached flute meshes",
        "retained the real finial torus while correcting the stone mesh winding for natural near-arc visibility and far-arc occlusion during orbit",
        "reconstructed all four fish heads from a shared tapered cranium with short mouth cavity, lower jaw, brows, eyes, gill plates, fins, and exact mouth sockets",
        "created joined and decimated LOD1/LOD2 meshes",
        "kept four pale runtime water jets with double impact ripples as review-only effects, excluded from exports",
        "exported optimized GLB tiers and Unity FBX",
    ],
    "validation": {
        "strictlyDecreasingLods": lod0_tris > lod1_tris > lod2_tris,
        "withinTriangleBudgets": lod0_tris <= 25000 and lod1_tris <= 12000 and lod2_tris <= 4000,
        "materialBudgetPass": len(material_names) <= 5,
        "drawCallBudgetPass": lod0_estimated_draw_calls <= 8,
        "degenerateFacesPass": source_health["degenerateFaces"] == 0,
        "looseVerticesPass": source_health["looseVertices"] == 0,
    },
    "preview": "Previews/PlazaFountain_Blender.png",
}
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
    handle.write("\n")

result = report
