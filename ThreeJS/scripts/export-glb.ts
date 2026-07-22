import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeliveryCargoBikeModel } from '../src/createDeliveryCargoBikeModel';

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: ((event: { target: NodeFileReader }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.({ target: this });
      })
      .catch((error) => this.onerror?.(error));
  }

  readAsDataURL(blob: Blob) {
    blob.arrayBuffer()
      .then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onloadend?.({ target: this });
      })
      .catch((error) => this.onerror?.(error));
  }
}

Object.assign(globalThis, { FileReader: NodeFileReader });

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..', '..');
const outputPath = resolve(projectRoot, 'Assets', 'DeliveryCargoBike.source.glb');
const reportPath = resolve(projectRoot, 'Pipeline', 'CargoBike', 'glb-export-report.json');

const model = createDeliveryCargoBikeModel({ castShadow: false, receiveShadow: false });
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
  const geometry = object.geometry;
  const position = geometry.getAttribute('position');
  if (position) vertices += position.count;
  triangles += geometry.index ? geometry.index.count / 3 : (position?.count ?? 0) / 3;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) materialNames.add(material.name || material.type);
});

const exporter = new GLTFExporter();
const exported = await exporter.parseAsync(model, {
  binary: true,
  onlyVisible: true,
  truncateDrawRange: true,
  maxTextureSize: 1024,
  includeCustomExtensions: true,
});
if (!(exported instanceof ArrayBuffer)) throw new Error('Expected binary GLB export');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, new Uint8Array(exported));
await writeFile(reportPath, `${JSON.stringify({
  source: 'ThreeJS/src/createDeliveryCargoBikeModel.ts',
  output: outputPath,
  bytes: exported.byteLength,
  meshes,
  vertices,
  triangles: Math.round(triangles),
  materials: [...materialNames].sort(),
  forward: '+Z',
  up: '+Y',
  unit: 'meter',
}, null, 2)}\n`);

console.log(`Exported ${outputPath}`);
console.log(`Meshes: ${meshes}, vertices: ${vertices}, triangles: ${Math.round(triangles)}, materials: ${materialNames.size}`);
