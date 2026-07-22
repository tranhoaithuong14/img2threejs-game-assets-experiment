import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDeliveryCargoBikeModel } from './createDeliveryCargoBikeModel';
import './style.css';

const host = document.querySelector<HTMLDivElement>('#app');
if (!host) throw new Error('Missing #app');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9eeec');

const params = new URLSearchParams(location.search);
const reviewView = params.get('view') ?? 'three-quarter';
const reviewPass = params.get('pass') ?? 'procedural-refinement';
const passLabel = document.querySelector<HTMLElement>('#pass-label');
if (passLabel) passLabel.textContent = `img2threejs · ${reviewPass.replaceAll('-', ' ')}`;

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.01, 100);
const cameraPositions: Record<string, THREE.Vector3> = {
  'three-quarter': new THREE.Vector3(3.4, 2.45, 4.2),
  side: new THREE.Vector3(5.6, 1.45, 0.12),
  front: new THREE.Vector3(0.02, 1.4, 5.2),
  rear: new THREE.Vector3(0.02, 1.4, -5.2),
  top: new THREE.Vector3(0.01, 5.8, 0.01),
  grazing: new THREE.Vector3(2.45, 0.86, 3.0),
};
camera.position.copy(cameraPositions[reviewView] ?? cameraPositions['three-quarter']);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
host.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.66, 0);
controls.enableDamping = true;
controls.minDistance = 2.4;
controls.maxDistance = 8;

scene.add(new THREE.HemisphereLight('#ecf8f4', '#665b4f', 1.45));
const key = new THREE.DirectionalLight('#fff1d5', 3.2);
key.position.set(-3.5, 5.5, 4.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
scene.add(key);
const rim = new THREE.DirectionalLight('#8fd9d2', 1.6);
rim.position.set(3, 2.8, -3.5);
scene.add(rim);

const model = createDeliveryCargoBikeModel({
  castShadow: true,
  receiveShadow: true,
});
scene.add(model);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(3.25, 96),
  new THREE.MeshStandardMaterial({ color: '#cbd4d0', roughness: 0.92, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.015;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(6, 24, '#9eaba7', '#c2cbc8');
grid.position.y = -0.005;
grid.material.opacity = 0.23;
grid.material.transparent = true;
scene.add(grid);

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
