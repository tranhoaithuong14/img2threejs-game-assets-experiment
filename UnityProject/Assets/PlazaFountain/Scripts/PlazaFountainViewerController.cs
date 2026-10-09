using UnityEngine;
using UnityEngine.SceneManagement;

namespace GameAssets.PlazaFountain
{
    /// <summary>
    /// Interactive controller for orbiting camera, toggling water effects,
    /// and rotating the upper assembly of the plaza fountain.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PlazaFountainViewerController : MonoBehaviour
    {
        [Header("Fountain rig")]
        [SerializeField] private PlazaFountainRig fountainRig;

        [Header("Orbit camera settings")]
        [SerializeField] private Camera targetCamera;
        [SerializeField] private Vector3 lookTarget = new Vector3(0f, 1.1f, 0f);
        [SerializeField] private float defaultDistance = 6.5f;
        [SerializeField] private float minDistance = 2.2f;
        [SerializeField] private float maxDistance = 14f;
        [SerializeField] private float orbitSensitivity = 3.5f;
        [SerializeField] private float zoomSensitivity = 1.8f;
        [SerializeField] private float defaultPitch = 24f;
        [SerializeField] private float defaultYaw = -35f;

        [Header("Fountain animation")]
        [SerializeField] private float manualYawSpeed = 60f;
        [SerializeField] private float autoYawSpeed = 20f;

        private float currentDistance;
        private float currentPitch;
        private float currentYaw;
        private float upperAssemblyYaw;
        private bool isWaterActive = true;
        private bool isAutoRotating = false;

        private void Awake()
        {
            if (fountainRig == null)
            {
#if UNITY_2023_1_OR_NEWER
                fountainRig = Object.FindAnyObjectByType<PlazaFountainRig>();
#else
                fountainRig = Object.FindObjectOfType<PlazaFountainRig>();
#endif
            }

            if (targetCamera == null)
            {
                targetCamera = Camera.main;
            }

            currentDistance = defaultDistance;
            currentPitch = defaultPitch;
            currentYaw = defaultYaw;
        }

        private void Start()
        {
            if (fountainRig != null)
            {
                fountainRig.SetWaterEffectsActive(isWaterActive);
            }
        }

        private void Update()
        {
            HandleOrbitInput();
            HandleFountainControls();
            HandleSceneSwitch();
        }

        private void LateUpdate()
        {
            ApplyCameraTransform();
        }

        private void HandleOrbitInput()
        {
            // Drag mouse with Left (0) or Right (1) click
            if (Input.GetMouseButton(0) || Input.GetMouseButton(1))
            {
                float mouseX = Input.GetAxis("Mouse X");
                float mouseY = Input.GetAxis("Mouse Y");

                currentYaw += mouseX * orbitSensitivity;
                currentPitch -= mouseY * orbitSensitivity;
                currentPitch = Mathf.Clamp(currentPitch, 5f, 85f);
            }

            // Zoom with mouse scroll wheel
            float scroll = Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Abs(scroll) > 0.001f)
            {
                currentDistance -= scroll * zoomSensitivity * 4f;
                currentDistance = Mathf.Clamp(currentDistance, minDistance, maxDistance);
            }

            // Reset camera with R
            if (Input.GetKeyDown(KeyCode.R))
            {
                currentDistance = defaultDistance;
                currentPitch = defaultPitch;
                currentYaw = defaultYaw;
                upperAssemblyYaw = 0f;
                if (fountainRig != null)
                {
                    fountainRig.SetUpperAssemblyYaw(0f);
                }
            }
        }

        private void HandleFountainControls()
        {
            // Toggle water with Space
            if (Input.GetKeyDown(KeyCode.Space))
            {
                isWaterActive = !isWaterActive;
                if (fountainRig != null)
                {
                    fountainRig.SetWaterEffectsActive(isWaterActive);
                }
            }

            // Toggle auto-rotation with T
            if (Input.GetKeyDown(KeyCode.T))
            {
                isAutoRotating = !isAutoRotating;
            }

            // Manual rotation with Q and E
            float manualRotate = 0f;
            if (Input.GetKey(KeyCode.Q)) manualRotate -= 1f;
            if (Input.GetKey(KeyCode.E)) manualRotate += 1f;

            if (Mathf.Abs(manualRotate) > 0.01f)
            {
                upperAssemblyYaw += manualRotate * manualYawSpeed * Time.deltaTime;
                if (fountainRig != null)
                {
                    fountainRig.SetUpperAssemblyYaw(upperAssemblyYaw);
                }
            }
            else if (isAutoRotating)
            {
                upperAssemblyYaw += autoYawSpeed * Time.deltaTime;
                if (fountainRig != null)
                {
                    fountainRig.SetUpperAssemblyYaw(upperAssemblyYaw);
                }
            }
        }

        private void HandleSceneSwitch()
        {
            if (Input.GetKeyDown(KeyCode.Alpha1))
            {
                LoadSceneIfAvailable("PlazaFountainReview");
            }
            else if (Input.GetKeyDown(KeyCode.Alpha2))
            {
                LoadSceneIfAvailable("DeliveryCargoBikeReview");
            }
        }

        private static void LoadSceneIfAvailable(string sceneName)
        {
            if (Application.CanStreamedLevelBeLoaded(sceneName))
            {
                SceneManager.LoadScene(sceneName);
            }
            else
            {
                Debug.LogWarning($"[PlazaFountainViewerController] Scene '{sceneName}' is not loaded or not in Build Settings.");
            }
        }

        private void ApplyCameraTransform()
        {
            if (targetCamera == null) return;

            Quaternion rotation = Quaternion.Euler(currentPitch, currentYaw, 0f);
            Vector3 position = lookTarget - (rotation * Vector3.forward * currentDistance);

            targetCamera.transform.position = position;
            targetCamera.transform.LookAt(lookTarget);
        }

        private void OnGUI()
        {
            const float boxWidth = 370f;
            const float boxHeight = 175f;
            const float margin = 16f;

            GUI.color = new Color(0.1f, 0.15f, 0.2f, 0.92f);
            GUI.Box(new Rect(margin, margin, boxWidth, boxHeight), GUIContent.none);
            GUI.color = Color.white;

            GUILayout.BeginArea(new Rect(margin + 12f, margin + 10f, boxWidth - 24f, boxHeight - 20f));

            var titleStyle = new GUIStyle(GUI.skin.label)
            {
                fontStyle = FontStyle.Bold,
                fontSize = 14
            };
            titleStyle.normal.textColor = new Color(0.4f, 0.9f, 0.8f);

            GUILayout.Label("Plaza Fountain Interactive Review", titleStyle);
            GUILayout.Space(4);

            GUILayout.Label("• [Kéo Chuột Trái/Phải]: Xoay góc nhìn 360°");
            GUILayout.Label("• [Cuộn Chuột]: Phóng to / Thu nhỏ");
            GUILayout.Label($"• [Space]: Hiệu ứng nước ({(isWaterActive ? "BẬT" : "TẮT")})");
            GUILayout.Label($"• [Q / E]: Xoay đài phun | [T]: Tự xoay ({(isAutoRotating ? "BẬT" : "TẮT")})");
            GUILayout.Label("• [R]: Reset góc camera");
            GUILayout.Label("• [1]: Xem Đài phun nước | [2]: Xem Xe đạp");

            GUILayout.EndArea();
        }
    }
}
