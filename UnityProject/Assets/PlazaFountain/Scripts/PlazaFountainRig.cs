using System;
using System.Collections.Generic;
using UnityEngine;

namespace GameAssets.PlazaFountain
{
    /// <summary>
    /// Stable gameplay hooks for fountain water effects and optional upper-tier variants.
    /// Runtime systems can bind particles/audio to sockets without depending on mesh names.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PlazaFountainRig : MonoBehaviour
    {
        [Header("Water effect sockets")]
        [SerializeField] private Transform lowerWaterSocket;
        [SerializeField] private Transform upperWaterSocket;
        [SerializeField] private Transform[] spoutSockets = Array.Empty<Transform>();

        [Header("Variant pivots")]
        [SerializeField] private Transform upperBowlPivot;
        [SerializeField] private Transform finialPivot;

        public Transform LowerWaterSocket => lowerWaterSocket;
        public Transform UpperWaterSocket => upperWaterSocket;
        public IReadOnlyList<Transform> SpoutSockets => spoutSockets;
        public Transform UpperBowlPivot => upperBowlPivot;
        public Transform FinialPivot => finialPivot;

        public bool IsConfigured =>
            lowerWaterSocket != null &&
            upperWaterSocket != null &&
            spoutSockets != null &&
            spoutSockets.Length == 4 &&
            Array.TrueForAll(spoutSockets, socket => socket != null) &&
            upperBowlPivot != null &&
            finialPivot != null;

        public void Configure(
            Transform lowerWater,
            Transform upperWater,
            Transform[] spouts,
            Transform upperBowl,
            Transform finial)
        {
            lowerWaterSocket = lowerWater;
            upperWaterSocket = upperWater;
            spoutSockets = spouts ?? Array.Empty<Transform>();
            upperBowlPivot = upperBowl;
            finialPivot = finial;
        }

        public void SetWaterEffectsActive(bool active)
        {
            SetEffectChildrenActive(lowerWaterSocket, active);
            SetEffectChildrenActive(upperWaterSocket, active);
            foreach (var socket in spoutSockets)
                SetEffectChildrenActive(socket, active);
        }

        public void SetUpperAssemblyYaw(float degrees)
        {
            if (upperBowlPivot != null)
                upperBowlPivot.localRotation = Quaternion.Euler(0f, degrees, 0f);
        }

        private static void SetEffectChildrenActive(Transform socket, bool active)
        {
            if (socket == null)
                return;
            for (var index = 0; index < socket.childCount; index++)
                socket.GetChild(index).gameObject.SetActive(active);
        }
    }
}
