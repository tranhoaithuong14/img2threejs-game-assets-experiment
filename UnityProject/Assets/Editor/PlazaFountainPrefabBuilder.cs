using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GameAssets.PlazaFountain;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class PlazaFountainPrefabBuilder
{
    private const string ModelPath = "Assets/PlazaFountain/Models/PlazaFountain.fbx";
    private const string PrefabPath = "Assets/PlazaFountain/Prefabs/PlazaFountain.prefab";
    private const string ScenePath = "Assets/PlazaFountain/Scenes/PlazaFountainReview.unity";
    private const string ReportPath = "Assets/PlazaFountain/PrefabValidationReport.json";

    [Serializable]
    private sealed class LodMetric
    {
        public string name;
        public int renderers;
        public int triangles;
        public int estimatedDrawCalls;
    }

    [Serializable]
    private sealed class ValidationReport
    {
        public string status;
        public string eligibility;
        public string unityVersion;
        public string modelPath;
        public string prefabPath;
        public string reviewScenePath;
        public int transforms;
        public int renderers;
        public int meshes;
        public int materials;
        public int colliders;
        public int missingScripts;
        public bool rigConfigured;
        public bool lodGroupConfigured;
        public bool strictlyDecreasingLods;
        public bool triangleBudgetsPass;
        public bool materialBudgetPass;
        public bool drawCallBudgetPass;
        public LodMetric[] lods;
        public string[] requiredNodes;
        public string[] limitations;
    }

    [MenuItem("Tools/Game Assets/Build Plaza Fountain Prefab")]
    public static void BuildBatch()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(PrefabPath) ?? "Assets");
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath) ?? "Assets");
            AssetDatabase.ImportAsset(ModelPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
            if (model == null)
                throw new InvalidOperationException($"Could not import model at {ModelPath}");

            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
            instance.name = "PlazaFountain";
            instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            instance.transform.localScale = Vector3.one;

            try
            {
                var lod0 = Require(instance.transform, "LOD0");
                var lod1 = Require(instance.transform, "LOD1");
                var lod2 = Require(instance.transform, "LOD2");
                var lowerWater = Require(instance.transform, "WaterLower_Socket");
                var upperWater = Require(instance.transform, "WaterUpper_Socket");
                var upperBowl = Require(instance.transform, "UpperBowl_Pivot");
                var finial = Require(instance.transform, "Finial_Pivot");
                var spouts = new[]
                {
                    Require(instance.transform, "Spout_N"),
                    Require(instance.transform, "Spout_E"),
                    Require(instance.transform, "Spout_S"),
                    Require(instance.transform, "Spout_W")
                };

                var lodGroup = GetOrAdd<LODGroup>(instance);
                lodGroup.SetLODs(new[]
                {
                    new LOD(0.45f, lod0.GetComponentsInChildren<Renderer>(true)),
                    new LOD(0.18f, lod1.GetComponentsInChildren<Renderer>(true)),
                    new LOD(0.035f, lod2.GetComponentsInChildren<Renderer>(true))
                });
                lodGroup.fadeMode = LODFadeMode.CrossFade;
                lodGroup.animateCrossFading = true;
                lodGroup.RecalculateBounds();

                var baseCollider = GetOrAdd<BoxCollider>(instance);
                baseCollider.center = new Vector3(0f, 0.2f, 0f);
                baseCollider.size = new Vector3(2.68f, 0.4f, 2.68f);

                var basinCollider = GetOrAdd<BoxCollider>(Require(instance.transform, "LowerBasin_System").gameObject);
                basinCollider.center = new Vector3(0f, 0.58f, 0f);
                basinCollider.size = new Vector3(2.12f, 0.4f, 2.12f);

                var towerCollider = GetOrAdd<CapsuleCollider>(Require(instance.transform, "Tower_System").gameObject);
                towerCollider.direction = 1;
                towerCollider.center = new Vector3(0f, 1.19f, 0f);
                towerCollider.radius = 0.48f;
                towerCollider.height = 1.16f;

                var rig = GetOrAdd<PlazaFountainRig>(instance);
                rig.Configure(lowerWater, upperWater, spouts, upperBowl, finial);

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
            CreateReviewScene();
            ValidateBatch();
        }
        catch (Exception exception)
        {
            Debug.LogException(exception);
            throw;
        }
    }

    private static void CreateReviewScene()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        var fountain = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        fountain.name = "PlazaFountain_Review";

        var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "ReviewGround";
        ground.transform.position = new Vector3(0f, -0.02f, 0f);
        ground.transform.localScale = new Vector3(0.65f, 1f, 0.65f);

        var lightObject = new GameObject("ReviewKeyLight");
        var light = lightObject.AddComponent<Light>();
        light.type = LightType.Directional;
        light.color = new Color(1f, 0.82f, 0.68f);
        light.intensity = 1.35f;
        lightObject.transform.rotation = Quaternion.Euler(48f, -32f, 0f);

        var fillObject = new GameObject("ReviewFillLight");
        var fill = fillObject.AddComponent<Light>();
        fill.type = LightType.Directional;
        fill.color = new Color(0.55f, 0.76f, 1f);
        fill.intensity = 0.45f;
        fillObject.transform.rotation = Quaternion.Euler(28f, 148f, 0f);

        var cameraObject = new GameObject("ReviewCamera");
        var camera = cameraObject.AddComponent<Camera>();
        cameraObject.tag = "MainCamera";
        cameraObject.transform.position = new Vector3(4.4f, 3.5f, -5.2f);
        cameraObject.transform.LookAt(new Vector3(0f, 1.0f, 0f));
        camera.fieldOfView = 34f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.68f, 0.72f, 0.70f);

        EditorSceneManager.SaveScene(scene, ScenePath);
        AssetDatabase.ImportAsset(ScenePath, ImportAssetOptions.ForceUpdate);
    }

    public static void ValidateBatch()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null)
            throw new InvalidOperationException($"Prefab is missing at {PrefabPath}");

        var requiredNames = new[]
        {
            "LOD0", "LOD1", "LOD2",
            "LowerBasin_System", "Tower_System",
            "WaterLower_Socket", "WaterUpper_Socket",
            "Spout_N", "Spout_E", "Spout_S", "Spout_W",
            "UpperBowl_Pivot", "Finial_Pivot"
        };
        var missing = requiredNames.Where(name => FindRecursive(prefab.transform, name) == null).ToArray();
        if (missing.Length > 0)
            throw new InvalidOperationException("Missing prefab nodes: " + string.Join(", ", missing));

        var lod0 = Require(prefab.transform, "LOD0");
        var lod1 = Require(prefab.transform, "LOD1");
        var lod2 = Require(prefab.transform, "LOD2");
        var lodMetrics = new[] { Metric("LOD0", lod0), Metric("LOD1", lod1), Metric("LOD2", lod2) };
        var strictlyDecreasing = lodMetrics[0].triangles > lodMetrics[1].triangles && lodMetrics[1].triangles > lodMetrics[2].triangles;
        var triangleBudgetsPass = lodMetrics[0].triangles <= 25000 && lodMetrics[1].triangles <= 12000 && lodMetrics[2].triangles <= 4000;
        var drawCallBudgetPass = lodMetrics[0].estimatedDrawCalls <= 8;

        var meshFilters = prefab.GetComponentsInChildren<MeshFilter>(true);
        var renderers = prefab.GetComponentsInChildren<Renderer>(true);
        var materials = new HashSet<Material>(renderers.SelectMany(renderer => renderer.sharedMaterials).Where(material => material != null));
        var colliders = prefab.GetComponentsInChildren<Collider>(true);
        var rig = prefab.GetComponent<PlazaFountainRig>();
        var lodGroup = prefab.GetComponent<LODGroup>();
        var missingScripts = CountMissingScripts(prefab.transform);

        if (!strictlyDecreasing)
            throw new InvalidOperationException("LOD triangles are not strictly decreasing.");
        if (!triangleBudgetsPass)
            throw new InvalidOperationException("One or more LOD triangle budgets were exceeded.");
        if (!drawCallBudgetPass)
            throw new InvalidOperationException($"LOD0 draw-call estimate exceeds 8: {lodMetrics[0].estimatedDrawCalls}");
        if (materials.Count > 5)
            throw new InvalidOperationException($"Material budget exceeds five: {materials.Count}");
        if (colliders.Length != 3)
            throw new InvalidOperationException($"Expected exactly three colliders, found {colliders.Length}.");
        if (rig == null || !rig.IsConfigured)
            throw new InvalidOperationException("PlazaFountainRig is missing or not configured.");
        if (lodGroup == null || lodGroup.lodCount != 3)
            throw new InvalidOperationException("LODGroup is missing or does not contain three tiers.");
        if (missingScripts != 0)
            throw new InvalidOperationException($"Prefab contains {missingScripts} missing script reference(s).");
        if (!File.Exists(ScenePath))
            throw new InvalidOperationException($"Review scene is missing at {ScenePath}");

        var report = new ValidationReport
        {
            status = "pass",
            eligibility = "candidate-development-only",
            unityVersion = Application.unityVersion,
            modelPath = ModelPath,
            prefabPath = PrefabPath,
            reviewScenePath = ScenePath,
            transforms = prefab.GetComponentsInChildren<Transform>(true).Length,
            renderers = renderers.Length,
            meshes = meshFilters.Length,
            materials = materials.Count,
            colliders = colliders.Length,
            missingScripts = missingScripts,
            rigConfigured = rig.IsConfigured,
            lodGroupConfigured = lodGroup.lodCount == 3,
            strictlyDecreasingLods = strictlyDecreasing,
            triangleBudgetsPass = triangleBudgetsPass,
            materialBudgetPass = materials.Count <= 5,
            drawCallBudgetPass = drawCallBudgetPass,
            lods = lodMetrics,
            requiredNodes = requiredNames,
            limitations = new[]
            {
                "Water jets are runtime effects and are not structural FBX geometry.",
                "Android/device performance validation remains pending."
            }
        };

        File.WriteAllText(ReportPath, JsonUtility.ToJson(report, true));
        AssetDatabase.ImportAsset(ReportPath, ImportAssetOptions.ForceUpdate);
        Debug.Log($"PLAZA_FOUNTAIN_PREFAB_OK lod0={lodMetrics[0].triangles} lod1={lodMetrics[1].triangles} lod2={lodMetrics[2].triangles} materials={materials.Count} drawCalls={lodMetrics[0].estimatedDrawCalls} colliders={colliders.Length}");
    }

    private static LodMetric Metric(string name, Transform root)
    {
        var filters = root.GetComponentsInChildren<MeshFilter>(true).Where(filter => filter.sharedMesh != null).ToArray();
        var renderers = root.GetComponentsInChildren<Renderer>(true);
        return new LodMetric
        {
            name = name,
            renderers = renderers.Length,
            triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3),
            estimatedDrawCalls = renderers.Sum(renderer => renderer.sharedMaterials.Count(material => material != null))
        };
    }

    private static int CountMissingScripts(Transform root)
    {
        var count = GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(root.gameObject);
        foreach (Transform child in root)
            count += CountMissingScripts(child);
        return count;
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
