import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createPlazaFountainModel, type FountainBuildPass } from './createPlazaFountainModel';
import './style.css';

const host = document.querySelector<HTMLDivElement>('#app');
if (!host) throw new Error('Missing #app');

const params = new URLSearchParams(location.search);
const reviewView = params.get('view') ?? 'three-quarter';
const reviewPass = (params.get('pass') ?? 'final') as FountainBuildPass;
const passLabel = document.querySelector<HTMLElement>('#pass-label');
if (passLabel) passLabel.textContent = `img2threejs · ${reviewPass.replaceAll('-', ' ')}`;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9ece9');

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.01, 100);
const cameraPositions: Record<string, THREE.Vector3> = {
  'three-quarter': new THREE.Vector3(3.7, 2.7, 4.2),
  gameplay: new THREE.Vector3(4.1, 4.0, 4.1),
  front: new THREE.Vector3(0.01, 1.15, 4.8),
  rear: new THREE.Vector3(0.01, 1.15, -4.8),
  side: new THREE.Vector3(4.8, 1.15, 0.01),
  top: new THREE.Vector3(0.01, 5.4, 0.01),
  grazing: new THREE.Vector3(3.3, 1.45, 3.5),
};
camera.position.copy(cameraPositions[reviewView] ?? cameraPositions['three-quarter']);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
host.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
controls.minDistance = 2.6;
controls.maxDistance = 9;

scene.add(new THREE.HemisphereLight('#eef7f3', '#645c52', 1.35));
const key = new THREE.DirectionalLight('#fff0d8', 3.1);
key.position.set(-3.5, 5.5, 4.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
scene.add(key);
const rim = new THREE.DirectionalLight('#9bcfc9', 1.45);
rim.position.set(3.5, 2.7, -3.5);
scene.add(rim);

const model = createPlazaFountainModel({ buildPass: reviewPass, castShadow: true, receiveShadow: true });
scene.add(model);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(3.5, 96),
  new THREE.MeshStandardMaterial({ color: '#cbd2ce', roughness: 0.94, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.012;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(7, 28, '#9ba8a4', '#c1c9c6');
grid.position.y = -0.004;
grid.material.opacity = 0.2;
grid.material.transparent = true;
scene.add(grid);

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

function animate(time: number) {
  const runtime = model.userData.sculptRuntime as { meshes: Record<string, THREE.Mesh> };
  for (const name of ['LowerWater_Surface', 'UpperWater_Surface']) {
    const water = runtime.meshes[name];
    const normalMap = (water?.material as THREE.MeshStandardMaterial | undefined)?.normalMap;
    if (normalMap) normalMap.offset.set(time * 0.000015, time * 0.000008);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate(0);
