using UnityEngine;

namespace GameAssets.DeliveryCargoBike
{
    /// <summary>
    /// Lightweight runtime control surface for the generated delivery bike prefab.
    /// Physics/gameplay code can drive these named pivots without depending on mesh children.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DeliveryCargoBikeRig : MonoBehaviour
    {
        [Header("Articulation")]
        [SerializeField] private Transform steeringPivot;
        [SerializeField] private Transform frontWheelPivot;
        [SerializeField] private Transform rearWheelPivot;
        [SerializeField] private Transform cargoLidHinge;
        [SerializeField] private Transform batteryDetachable;
        [SerializeField] private Transform kickstandHinge;

        [Header("Physics hooks")]
        [SerializeField] private WheelCollider frontWheelCollider;
        [SerializeField] private WheelCollider rearWheelCollider;

        public Transform BatteryDetachable => batteryDetachable;
        public Transform KickstandHinge => kickstandHinge;

        public bool IsConfigured =>
            steeringPivot != null &&
            frontWheelPivot != null &&
            rearWheelPivot != null &&
            cargoLidHinge != null &&
            batteryDetachable != null &&
            kickstandHinge != null &&
            frontWheelCollider != null &&
            rearWheelCollider != null;

        public void Configure(
            Transform steering,
            Transform frontWheel,
            Transform rearWheel,
            Transform lidHinge,
            Transform battery,
            Transform kickstand,
            WheelCollider frontCollider,
            WheelCollider rearCollider)
        {
            steeringPivot = steering;
            frontWheelPivot = frontWheel;
            rearWheelPivot = rearWheel;
            cargoLidHinge = lidHinge;
            batteryDetachable = battery;
            kickstandHinge = kickstand;
            frontWheelCollider = frontCollider;
            rearWheelCollider = rearCollider;
        }

        public void SetSteering(float degrees)
        {
            if (steeringPivot != null)
                steeringPivot.localRotation = Quaternion.Euler(0f, Mathf.Clamp(degrees, -35f, 35f), 0f);
        }

        public void SpinWheels(float degrees)
        {
            if (frontWheelPivot != null)
                frontWheelPivot.Rotate(Vector3.right, degrees, Space.Self);
            if (rearWheelPivot != null)
                rearWheelPivot.Rotate(Vector3.right, degrees, Space.Self);
        }

        public void SetCargoLidOpen(float normalized)
        {
            if (cargoLidHinge != null)
                cargoLidHinge.localRotation = Quaternion.Euler(-Mathf.Clamp01(normalized) * 92f, 0f, 0f);
        }
    }
}

