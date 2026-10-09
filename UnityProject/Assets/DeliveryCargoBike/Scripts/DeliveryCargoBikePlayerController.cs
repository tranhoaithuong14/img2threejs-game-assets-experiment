using UnityEngine;
using UnityEngine.SceneManagement;

namespace GameAssets.DeliveryCargoBike
{
    /// <summary>
    /// Interactive controller for driving, steering, opening the cargo lid, and controlling camera
    /// for the delivery cargo bike during review/playtesting.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DeliveryCargoBikePlayerController : MonoBehaviour
    {
        [Header("Rig reference")]
        [SerializeField] private DeliveryCargoBikeRig bikeRig;

        [Header("Driving parameters")]
        [SerializeField] private float forwardSpeed = 5.5f;
        [SerializeField] private float reverseSpeed = 2.5f;
        [SerializeField] private float steerSpeed = 90f;
        [SerializeField] private float maxSteerAngle = 32f;
        [SerializeField] private float wheelRadius = 0.36f;
        [SerializeField] private float lidToggleSpeed = 3f;

        [Header("Follow camera")]
        [SerializeField] private Camera followCamera;
        [SerializeField] private Vector3 cameraOffset = new Vector3(0f, 2.0f, -4.5f);
        [SerializeField] private float cameraSmoothSpeed = 8f;

        private float currentSteerAngle;
        private float currentLidOpen;
        private bool isLidOpen;
        private Vector3 initialPosition;
        private Quaternion initialRotation;

        private Transform TargetTransform => bikeRig != null ? bikeRig.transform : transform;

        private void Awake()
        {
            if (bikeRig == null)
            {
                bikeRig = GetComponent<DeliveryCargoBikeRig>();
                if (bikeRig == null)
                {
#if UNITY_2023_1_OR_NEWER
                    bikeRig = Object.FindAnyObjectByType<DeliveryCargoBikeRig>();
#else
                    bikeRig = Object.FindObjectOfType<DeliveryCargoBikeRig>();
#endif
                }
            }

            initialPosition = TargetTransform.position;
            initialRotation = TargetTransform.rotation;

            if (followCamera == null)
            {
                followCamera = Camera.main;
            }
        }

        private void Update()
        {
            HandleDriving();
            HandleCargoLid();
            HandleReset();
            HandleSceneSwitch();
        }

        private void LateUpdate()
        {
            UpdateFollowCamera();
        }

        private void HandleDriving()
        {
            float v = Input.GetAxisRaw("Vertical");
            float h = Input.GetAxisRaw("Horizontal");

            float targetSteer = h * maxSteerAngle;
            currentSteerAngle = Mathf.MoveTowards(currentSteerAngle, targetSteer, steerSpeed * Time.deltaTime);

            if (bikeRig != null)
            {
                bikeRig.SetSteering(currentSteerAngle);
            }

            if (Mathf.Abs(v) > 0.01f)
            {
                float speed = v > 0f ? forwardSpeed : reverseSpeed;
                float moveDistance = v * speed * Time.deltaTime;

                TargetTransform.Translate(Vector3.forward * moveDistance, Space.Self);

                float turnDirection = v > 0f ? 1f : -1f;
                float turnAngle = (currentSteerAngle / maxSteerAngle) * 55f * turnDirection * Time.deltaTime;
                TargetTransform.Rotate(Vector3.up, turnAngle, Space.World);

                float spinDegrees = (moveDistance / (2f * Mathf.PI * wheelRadius)) * 360f;
                if (bikeRig != null)
                {
                    bikeRig.SpinWheels(spinDegrees);
                }
            }
        }

        private void HandleCargoLid()
        {
            if (Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.E))
            {
                isLidOpen = !isLidOpen;
            }

            float targetLid = isLidOpen ? 1f : 0f;
            currentLidOpen = Mathf.MoveTowards(currentLidOpen, targetLid, Time.deltaTime * lidToggleSpeed);

            if (bikeRig != null)
            {
                bikeRig.SetCargoLidOpen(currentLidOpen);
            }
        }

        private void HandleReset()
        {
            if (Input.GetKeyDown(KeyCode.R))
            {
                TargetTransform.position = initialPosition;
                TargetTransform.rotation = initialRotation;
                currentSteerAngle = 0f;
                currentLidOpen = 0f;
                isLidOpen = false;
                if (bikeRig != null)
                {
                    bikeRig.SetSteering(0f);
                    bikeRig.SetCargoLidOpen(0f);
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
                Debug.LogWarning($"[DeliveryCargoBikePlayerController] Scene '{sceneName}' is not loaded or not in Build Settings.");
            }
        }

        private void UpdateFollowCamera()
        {
            if (followCamera == null) return;

            Vector3 targetCamPos = TargetTransform.position + TargetTransform.TransformDirection(cameraOffset);
            followCamera.transform.position = Vector3.Lerp(followCamera.transform.position, targetCamPos, Time.deltaTime * cameraSmoothSpeed);

            Vector3 lookTarget = TargetTransform.position + Vector3.up * 0.9f;
            if ((lookTarget - followCamera.transform.position).sqrMagnitude > 0.001f)
            {
                followCamera.transform.rotation = Quaternion.Slerp(
                    followCamera.transform.rotation,
                    Quaternion.LookRotation(lookTarget - followCamera.transform.position, Vector3.up),
                    Time.deltaTime * cameraSmoothSpeed
                );
            }
        }

        private void OnGUI()
        {
            const float boxWidth = 370f;
            const float boxHeight = 160f;
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

            GUILayout.Label("Delivery Cargo Bike Review", titleStyle);
            GUILayout.Space(4);

            GUILayout.Label("• [W / S] hoặc [↑ / ↓]: Lái xe (Tiến / Lùi)");
            GUILayout.Label("• [A / D] hoặc [← / →]: Bẻ lái cổ xe");
            GUILayout.Label($"• [Space] / [E]: Nắp thùng hàng ({(isLidOpen ? "ĐANG MỞ" : "ĐANG ĐÓNG")})");
            GUILayout.Label("• [R]: Đặt lại vị trí ban đầu");
            GUILayout.Label("• [1]: Xem Đài phun nước | [2]: Xem Xe đạp");

            GUILayout.EndArea();
        }
    }
}
