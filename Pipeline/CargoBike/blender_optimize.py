import bpy
import bmesh
import json
import math
import os
from mathutils import Matrix, Vector

WORKSPACE = "/Users/cristian/Documents/Game assets"
SOURCE_GLB = os.path.join(WORKSPACE, "Assets", "DeliveryCargoBike.source.glb")
SOURCE_BLEND = os.path.join(WORKSPACE, "Blender", "DeliveryCargoBike.blend")
OPT_BLEND = os.path.join(WORKSPACE, "Blender", "DeliveryCargoBike.optimized.blend")
OPT_GLB = os.path.join(WORKSPACE, "Assets", "DeliveryCargoBike.optimized.glb")
UNITY_FBX = os.path.join(WORKSPACE, "UnityProject", "Assets", "DeliveryCargoBike", "Models", "DeliveryCargoBike.fbx")
PREVIEW = os.path.join(WORKSPACE, "Previews", "DeliveryCargoBike_Blender.png")
REPORT = os.path.join(WORKSPACE, "Pipeline", "CargoBike", "blender-optimization-report.json")

for path in (SOURCE_BLEND, OPT_BLEND, OPT_GLB, UNITY_FBX, PREVIEW, REPORT):
    os.makedirs(os.path.dirname(path), exist_ok=True)


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


def mesh_triangles(obj):
    return sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)


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
    rgb = [int(value[index:index + 2], 16) / 255.0 for index in (0, 2, 4)]
    return tuple(srgb_channel(channel) for channel in rgb) + (1.0,)


def principled(material):
    material.use_nodes = True
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    return tree, shader


def set_input(node, name, value):
    socket = node.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def configure_materials():
    palette = {
        "M_Teal_Satin": ("#1FA899", 0.34, 0.08),
        "M_Teal_Dark": ("#147D75", 0.44, 0.05),
        "M_Charcoal": ("#1D2426", 0.48, 0.18),
        "M_Tire_Rubber": ("#252A28", 0.82, 0.0),
        "M_Warm_Cream": ("#F1D7A7", 0.31, 0.02),
        "M_Safety_Orange": ("#F27A32", 0.28, 0.0),
        "M_Brushed_Metal": ("#AAB4B2", 0.24, 0.76),
        "M_Headlight_Lens": ("#E8FBFF", 0.08, 0.0),
        "M_Tail_Lens": ("#D83E2E", 0.16, 0.0),
    }
    for name, (color, roughness, metallic) in palette.items():
        material = bpy.data.materials.get(name)
        if material is None:
            continue
        tree, shader = principled(material)
        set_input(shader, "Base Color", srgb(color))
        set_input(shader, "Roughness", roughness)
        set_input(shader, "Metallic", metallic)
        material.diffuse_color = srgb(color)

        for node in list(tree.nodes):
            if node.name.startswith("CB_"):
                tree.nodes.remove(node)

        if name in {"M_Teal_Satin", "M_Tire_Rubber"}:
            noise = tree.nodes.new("ShaderNodeTexNoise")
            noise.name = "CB_MicroSurface"
            noise.inputs["Scale"].default_value = 52.0 if name == "M_Teal_Satin" else 34.0
            noise.inputs["Detail"].default_value = 2.2
            noise.inputs["Roughness"].default_value = 0.66
            bump = tree.nodes.new("ShaderNodeBump")
            bump.name = "CB_MicroBump"
            bump.inputs["Strength"].default_value = 0.075 if name == "M_Teal_Satin" else 0.16
            bump.inputs["Distance"].default_value = 0.018
            tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
            tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])

        if name == "M_Headlight_Lens":
            set_input(shader, "Coat Weight", 1.0)
            set_input(shader, "Coat Roughness", 0.04)
            set_input(shader, "Emission Color", srgb("#BFEFF0"))
            set_input(shader, "Emission Strength", 0.55)
        elif name == "M_Tail_Lens":
            set_input(shader, "Coat Weight", 0.75)
            set_input(shader, "Emission Color", srgb("#A4140C"))
            set_input(shader, "Emission Strength", 0.42)


def clean_meshes(objects):
    for obj in objects:
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-6)
        bmesh.ops.dissolve_degenerate(mesh, edges=list(mesh.edges), dist=1e-8)
        mesh.normal_update()
        mesh.to_mesh(obj.data)
        mesh.free()
        obj.data.update()


def normalize_material_slots(obj):
    old_materials = list(obj.data.materials)
    unique_materials = []
    old_to_new = {}
    for index, material in enumerate(old_materials):
        if material in unique_materials:
            old_to_new[index] = unique_materials.index(material)
        else:
            old_to_new[index] = len(unique_materials)
            unique_materials.append(material)
    remapped = [old_to_new.get(poly.material_index, 0) for poly in obj.data.polygons]
    obj.data.materials.clear()
    for material in unique_materials:
        obj.data.materials.append(material)
    for poly, material_index in zip(obj.data.polygons, remapped):
        poly.material_index = material_index


def join_group(objects, name, parent):
    if not objects:
        return None
    target_inverse = parent.matrix_world.inverted()
    duplicates = []
    for source in objects:
        duplicate = source.copy()
        duplicate.data = source.data.copy()
        duplicate.animation_data_clear()
        bpy.context.collection.objects.link(duplicate)
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
    for source in objects:
        bpy.data.objects.remove(source, do_unlink=True)
    return merged


def is_descendant_of(obj, ancestor):
    current = obj.parent
    while current is not None:
        if current == ancestor:
            return True
        current = current.parent
    return False


def consolidate_renderers(root):
    owner_names = [
        "FrontWheel_Pivot",
        "RearWheel_Pivot",
        "Steering_Pivot",
        "Crank_Pivot",
        "Cargo_Pivot",
        "Chassis_Static",
    ]
    owners = [bpy.data.objects.get(name) for name in owner_names]
    owners = [owner for owner in owners if owner is not None]
    preserved_mesh_names = {"Cargo_Lid_Hinge", "Battery_Detachable", "Kickstand_Hinge"}
    groups = {owner.name: [] for owner in owners}
    groups[root.name] = []

    originals = list(mesh_descendants(root))
    for obj in originals:
        if obj.name in preserved_mesh_names:
            continue
        candidates = [owner for owner in owners if is_descendant_of(obj, owner)]
        if candidates:
            owner = max(candidates, key=lambda candidate: len(list(candidate.children_recursive)))
            # Choose the closest matching interaction owner, not the largest subtree.
            current = obj.parent
            while current is not None and current not in candidates:
                current = current.parent
            owner = current if current is not None else candidates[0]
        else:
            owner = root
        groups[owner.name].append(obj)

    merged = []
    for owner_name, objects in groups.items():
        owner = root if owner_name == root.name else bpy.data.objects.get(owner_name)
        result = join_group(objects, f"Render_{owner_name}", owner)
        if result is not None:
            merged.append(result)
    return merged


def mesh_health(objects):
    result = {"nonManifoldEdges": 0, "degenerateFaces": 0, "looseVertices": 0}
    for obj in objects:
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        mesh.normal_update()
        result["nonManifoldEdges"] += sum(1 for edge in mesh.edges if not edge.is_manifold)
        result["degenerateFaces"] += sum(1 for face in mesh.faces if face.calc_area() < 1e-10)
        result["looseVertices"] += sum(1 for vertex in mesh.verts if not vertex.link_edges)
        mesh.free()
    return result


def add_area(name, location, energy, size, color):
    light_data = bpy.data.lights.new(name, type="AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light_data.color = color
    light = bpy.data.objects.new(name, light_data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    direction = Vector((0.0, 0.0, 0.72)) - light.location
    light.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return light


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE_GLB)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

root = bpy.data.objects.get("DeliveryCargoBike")
if root is None:
    roots = [obj for obj in scene.objects if obj.parent is None]
    if len(roots) != 1:
        raise RuntimeError(f"Expected DeliveryCargoBike root, found {[obj.name for obj in roots]}")
    root = roots[0]
    root.name = "DeliveryCargoBike"

before_meshes = mesh_descendants(root)
before = {
    "objects": len(descendants(root)) + 1,
    "meshObjects": len(before_meshes),
    "triangles": sum(mesh_triangles(obj) for obj in before_meshes),
}

clean_meshes(before_meshes)
configure_materials()

smooth_tokens = (
    "Wheel", "Tire", "Rim", "Hub", "Frame", "Fork", "Handlebar", "Headlight",
    "Mudguard", "Saddle", "Crank", "Pedal", "Rack", "Cargo", "Battery", "Kickstand",
)
for obj in before_meshes:
    if any(token in obj.name for token in smooth_tokens):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True

bpy.ops.wm.save_as_mainfile(filepath=SOURCE_BLEND)
consolidate_renderers(root)

after_meshes = mesh_descendants(root)
after_triangles = sum(mesh_triangles(obj) for obj in after_meshes)
if after_triangles > 35000:
    raise RuntimeError(f"Triangle budget exceeded: {after_triangles} > 35000")

root["asset_id"] = "delivery-cargo-bike"
root["source"] = "img2threejs procedural reconstruction revision 2"
root["unit"] = "meter"
root["coordinate_frame"] = "+Z forward, +Y up in interchange; converted to Blender Z-up"

bpy.ops.wm.save_as_mainfile(filepath=OPT_BLEND)
export_objects = [root] + descendants(root)
select_only(export_objects)
bpy.ops.export_scene.gltf(
    filepath=OPT_GLB,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
)
select_only(export_objects)
bpy.ops.export_scene.fbx(
    filepath=UNITY_FBX,
    use_selection=True,
    axis_forward="-Z",
    axis_up="Y",
    apply_unit_scale=True,
    bake_anim=False,
    add_leaf_bones=False,
)

world = bpy.data.worlds.new("BikeReviewWorld")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.055, 0.052, 1.0)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32
scene.world = world

bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.012))
ground = bpy.context.object
ground.name = "REVIEW_Ground"
ground_material = bpy.data.materials.new("REVIEW_Ground_Material")
ground_material.diffuse_color = (0.58, 0.68, 0.65, 1.0)
ground.data.materials.append(ground_material)

camera_data = bpy.data.cameras.new("REVIEW_Camera")
camera = bpy.data.objects.new("REVIEW_Camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (2.75, -3.4, 2.08)
target = Vector((0.0, 0.0, 0.68))
camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.lens = 55
scene.camera = camera

key = add_area("REVIEW_Key", (-3.7, -4.6, 5.7), 1050, 4.0, (1.0, 0.88, 0.72))
fill = add_area("REVIEW_Fill", (4.2, -1.2, 3.1), 680, 3.6, (0.62, 0.92, 0.9))
rim = add_area("REVIEW_Rim", (2.2, 4.0, 3.8), 850, 3.0, (0.55, 0.86, 1.0))

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = PREVIEW
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.resolution_percentage = 100
bpy.ops.render.render(write_still=True)

for obj in (ground, camera, key, fill, rim):
    bpy.data.objects.remove(obj, do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=OPT_BLEND)

used_materials = sorted({material.name for obj in after_meshes for material in obj.data.materials if material})
preserved_nodes = [
    "Steering_Pivot", "FrontWheel_Pivot", "RearWheel_Pivot", "Crank_Pivot",
    "Cargo_Pivot", "Cargo_Lid_Hinge", "Battery_Detachable", "Kickstand_Hinge",
]
missing_nodes = [name for name in preserved_nodes if bpy.data.objects.get(name) is None]
if missing_nodes:
    raise RuntimeError(f"Missing interaction nodes after optimization: {missing_nodes}")

report = {
    "asset": "DeliveryCargoBike",
    "revision": 2,
    "sourceGlb": "Assets/DeliveryCargoBike.source.glb",
    "sourceBlend": "Blender/DeliveryCargoBike.blend",
    "optimizedBlend": "Blender/DeliveryCargoBike.optimized.blend",
    "optimizedGlb": "Assets/DeliveryCargoBike.optimized.glb",
    "unityBridgeFbx": "UnityProject/Assets/DeliveryCargoBike/Models/DeliveryCargoBike.fbx",
    "before": before,
    "after": {
        "objects": len(descendants(root)) + 1,
        "meshObjects": len(after_meshes),
        "triangles": after_triangles,
        "materials": len(used_materials),
        "glbBytes": os.path.getsize(OPT_GLB),
        "fbxBytes": os.path.getsize(UNITY_FBX),
    },
    "targetTriangleBudget": 35000,
    "budgetResult": "pass",
    "meshHealth": mesh_health(after_meshes),
    "preservedInteractionNodes": preserved_nodes,
    "materials": used_materials,
    "notes": [
        "Consolidated static renderers by functional pivot while preserving every Unity interaction node.",
        "Reoriented the tire detail into a smooth normal-based tread treatment; the wheel silhouette no longer uses floating lug blocks.",
        "Added Blender micro-surface treatment to painted metal and rubber without changing the nine-material authored palette.",
        "Kept the source under the 35k triangle budget after the reference-matching geometry pass.",
    ],
}
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
    handle.write("\n")

print(f"DELIVERY_BIKE_BLENDER_OK tris={after_triangles} meshes={len(after_meshes)} materials={len(used_materials)}")
