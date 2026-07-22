import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlazaFountainModel } from '../src/createPlazaFountainModel';

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: ((event: { target: NodeFileReader }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.({ target: this }); }).catch((error) => this.onerror?.(error));
  }
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onloadend?.({ target: this }); }).catch((error) => this.onerror?.(error));
  }
}
Object.assign(globalThis, { FileReader: NodeFileReader });

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, '..', '..', '..');
const outputPath = resolve(workspaceRoot, 'Assets', 'PlazaFountain.source.glb');
const reportPath = resolve(workspaceRoot, 'Pipeline', 'PlazaFountain', 'glb-export-report.json');
const model = createPlazaFountainModel({ buildPass: 'final', castShadow: false, receiveShadow: false });

// GLTFExporter composites metallic/roughness textures through a DOM canvas.
// The interactive reconstruction intentionally uses deterministic DataTextures,
// but this exporter runs in Node. Preserve the authored PBR scalar/color values
// and strip only the procedural maps; Blender rebuilds the surface detail during
// the optimization stage.
const exportMaterialCache = new Map<string, THREE.Material>();
const makeExportMaterial = (material: THREE.Material): THREE.Material => {
  const cached = exportMaterialCache.get(material.uuid);
  if (cached) return cached;
  const clone = material.clone() as THREE.MeshStandardMaterial;
  if ('map' in clone) clone.map = null;
  if ('normalMap' in clone) clone.normalMap = null;
  if ('roughnessMap' in clone) clone.roughnessMap = null;
  if ('metalnessMap' in clone) clone.metalnessMap = null;
  if ('aoMap' in clone) clone.aoMap = null;
  if ('alphaMap' in clone) clone.alphaMap = null;
  if ('emissiveMap' in clone) clone.emissiveMap = null;
  clone.needsUpdate = true;
  exportMaterialCache.set(material.uuid, clone);
  return clone;
};
model.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  object.material = Array.isArray(object.material)
    ? object.material.map(makeExportMaterial)
    : makeExportMaterial(object.material);
});

const disposable: THREE.Object3D[] = [];
model.traverse((object) => { if (object.userData.export === false) disposable.push(object); });
for (const object of disposable) object.removeFromParent();
model.updateMatrixWorld(true);

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
};
model.userData = {
  assetInfo: model.userData.assetInfo,
  sculptRuntimeManifest: {
    nodes: Object.keys(runtime.nodes),
    sockets: Object.keys(runtime.sockets),
    colliders: runtime.colliders,
  },
};

let meshes = 0;
let triangles = 0;
let vertices = 0;
const materialNames = new Set<string>();
model.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  meshes += 1;
  const position = object.geometry.getAttribute('position');
  if (position) vertices += position.count;
  triangles += object.geometry.index ? object.geometry.index.count / 3 : (position?.count ?? 0) / 3;
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) materialNames.add(material.name || material.type);
});

const exporter = new GLTFExporter();
const exported = await exporter.parseAsync(model, { binary: true, onlyVisible: true, truncateDrawRange: true, maxTextureSize: 1024, includeCustomExtensions: true });
if (!(exported instanceof ArrayBuffer)) throw new Error('Expected binary GLB export');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, new Uint8Array(exported));
await writeFile(reportPath, `${JSON.stringify({
  source: 'ThreeJS/PlazaFountain/src/createPlazaFountainModel.ts',
  output: 'Assets/PlazaFountain.source.glb',
  bytes: exported.byteLength,
  meshes,
  vertices,
  triangles: Math.round(triangles),
  materials: [...materialNames].sort(),
  forward: '+Z',
  up: '+Y',
  unit: 'meter',
  excludedRuntimeEffects: disposable.map((object) => object.name),
}, null, 2)}\n`);
console.log(`Exported ${outputPath}`);
console.log(`Meshes: ${meshes}, vertices: ${vertices}, triangles: ${Math.round(triangles)}, materials: ${materialNames.size}`);
