using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GameAssets.DeliveryCargoBike;
using UnityEditor;
using UnityEngine;

public static class DeliveryCargoBikePrefabBuilder
{
    private const string ModelPath = "Assets/DeliveryCargoBike/Models/DeliveryCargoBike.fbx";
    private const string PrefabPath = "Assets/DeliveryCargoBike/Prefabs/DeliveryCargoBike.prefab";
    private const string ReportPath = "Assets/DeliveryCargoBike/PrefabValidationReport.json";

    [Serializable]
    private sealed class ValidationReport
    {
        public string status;
        public string unityVersion;
        public string modelPath;
        public string prefabPath;
        public int transforms;
        public int renderers;
        public int meshes;
        public int materials;
        public int triangles;
        public int colliders;
        public bool rigConfigured;
        public string[] requiredNodes;
    }

    [MenuItem("Tools/Game Assets/Build Delivery Cargo Bike Prefab")]
    public static void BuildBatch()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(PrefabPath) ?? "Assets");
            AssetDatabase.ImportAsset(ModelPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
            if (model == null)
                throw new InvalidOperationException($"Could not import model at {ModelPath}");

            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
            instance.name = "DeliveryCargoBike";
            instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            instance.transform.localScale = Vector3.one;

            try
            {
                var steering = Require(instance.transform, "Steering_Pivot");
                var frontWheel = Require(instance.transform, "FrontWheel_Pivot");
                var rearWheel = Require(instance.transform, "RearWheel_Pivot");
                var cargoPivot = Require(instance.transform, "Cargo_Pivot");
                var lidHinge = Require(instance.transform, "Cargo_Lid_Hinge");
                var battery = Require(instance.transform, "Battery_Detachable");
                var kickstand = Require(instance.transform, "Kickstand_Hinge");

                var body = GetOrAdd<BoxCollider>(instance);
                body.center = new Vector3(0f, 0.67f, 0f);
                body.size = new Vector3(0.86f, 1.36f, 2.58f);

                var cargoCollider = GetOrAdd<BoxCollider>(cargoPivot.gameObject);
                cargoCollider.center = new Vector3(0f, 0.28f, 0f);
                cargoCollider.size = new Vector3(0.66f, 0.58f, 0.72f);

                var frontCollider = ConfigureWheelCollider(frontWheel.gameObject);
                var rearCollider = ConfigureWheelCollider(rearWheel.gameObject);

                var rigidbody = GetOrAdd<Rigidbody>(instance);
                rigidbody.mass = 32f;
                rigidbody.isKinematic = true;
                rigidbody.useGravity = false;

                var rig = GetOrAdd<DeliveryCargoBikeRig>(instance);
                rig.Configure(steering, frontWheel, rearWheel, lidHinge, battery, kickstand, frontCollider, rearCollider);

                var saved = PrefabUtility.SaveAsPrefabAsset(instance, PrefabPath, out var success);
                if (!success || saved == null)
                    throw new InvalidOperationException($"Failed to save prefab at {PrefabPath}");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            ValidateBatch();
        }
        catch (Exception ex)
        {
            Debug.LogException(ex);
            throw;
        }
    }

    public static void ValidateBatch()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null)
            throw new InvalidOperationException($"Prefab is missing at {PrefabPath}");

        var requiredNames = new[]
        {
            "Steering_Pivot",
            "FrontWheel_Pivot",
            "RearWheel_Pivot",
            "Cargo_Pivot",
            "Cargo_Lid_Hinge",
            "Battery_Detachable",
            "Kickstand_Hinge"
        };
        var missing = requiredNames.Where(name => FindRecursive(prefab.transform, name) == null).ToArray();
        if (missing.Length > 0)
            throw new InvalidOperationException("Missing prefab nodes: " + string.Join(", ", missing));

        var meshFilters = prefab.GetComponentsInChildren<MeshFilter>(true);
        var renderers = prefab.GetComponentsInChildren<Renderer>(true);
        var materials = new HashSet<Material>(renderers.SelectMany(renderer => renderer.sharedMaterials).Where(material => material != null));
        var triangles = meshFilters.Where(filter => filter.sharedMesh != null).Sum(filter => filter.sharedMesh.triangles.Length / 3);
        var colliders = prefab.GetComponentsInChildren<Collider>(true);
        var rig = prefab.GetComponent<DeliveryCargoBikeRig>();

        if (meshFilters.Length == 0 || renderers.Length == 0 || triangles <= 0)
            throw new InvalidOperationException("Prefab has no renderable mesh data.");
        if (rig == null || !rig.IsConfigured)
            throw new InvalidOperationException("DeliveryCargoBikeRig is missing or not configured.");
        if (colliders.Length < 4)
            throw new InvalidOperationException($"Expected at least four colliders, found {colliders.Length}.");

        var report = new ValidationReport
        {
            status = "pass",
            unityVersion = Application.unityVersion,
            modelPath = ModelPath,
            prefabPath = PrefabPath,
            transforms = prefab.GetComponentsInChildren<Transform>(true).Length,
            renderers = renderers.Length,
            meshes = meshFilters.Length,
            materials = materials.Count,
            triangles = triangles,
            colliders = colliders.Length,
            rigConfigured = rig.IsConfigured,
            requiredNodes = requiredNames
        };

        File.WriteAllText(ReportPath, JsonUtility.ToJson(report, true));
        AssetDatabase.ImportAsset(ReportPath, ImportAssetOptions.ForceUpdate);
        Debug.Log($"DELIVERY_BIKE_PREFAB_OK transforms={report.transforms} renderers={report.renderers} meshes={report.meshes} materials={report.materials} triangles={report.triangles} colliders={report.colliders}");
    }

    private static WheelCollider ConfigureWheelCollider(GameObject target)
    {
        var collider = GetOrAdd<WheelCollider>(target);
        collider.radius = 0.36f;
        collider.mass = 2.5f;
        collider.suspensionDistance = 0.12f;
        collider.wheelDampingRate = 0.3f;
        return collider;
    }

    private static Transform Require(Transform root, string name)
    {
        var found = FindRecursive(root, name);
        if (found == null)
            throw new InvalidOperationException($"Required transform {name} was not found in the imported FBX.");
        return found;
    }

    private static Transform FindRecursive(Transform root, string name)
    {
        if (root.name == name)
            return root;
        foreach (Transform child in root)
        {
            var found = FindRecursive(child, name);
            if (found != null)
                return found;
        }
        return null;
    }

    private static T GetOrAdd<T>(GameObject target) where T : Component
    {
        var existing = target.GetComponent<T>();
        return existing != null ? existing : target.AddComponent<T>();
    }
}

