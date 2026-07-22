import * as THREE from 'three';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      const paletteValue = clamp01(
        0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
      );
      const color = mixPalette(colors, paletteValue);
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : new THREE.Color(typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F'),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clamp01(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    if (bumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = bumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    if (displacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = displacementScale;
      material.displacementBias = -displacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Stylized Tiered Plaza Fountain
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createStylizedTieredPlazaFountainModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Stylized Tiered Plaza Fountain";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["limestone"] = createSculptMaterial(
    "limestone",
    {"id": "limestone", "name": "Warm Carved Limestone", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#D8C7A0", "color": "#D8C7A0", "albedo": {"dominant": "#AB9B83", "secondary": ["#50645E", "#CBB9A0", "#887E69"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_albedo.png", "url": "limestone_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#AB9B83", "#50645E", "#CBB9A0", "#887E69", "#EFDDC5"], "pattern": "reference-derived pixel palette", "amplitude": 0.234, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "triplanar-like object coordinates", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Stable object-scale detail; no stretching across differently scaled tiers."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.475, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.688, "variation": 0.125, "map": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_roughness.png", "url": "limestone_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.233, "map": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_normal.png", "url": "limestone_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_height.png", "url": "limestone_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.03, "map": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_height.png", "url": "limestone_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_ao.png", "url": "limestone_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "limestone-mottle", "region": "broad exposed stone faces and cavity contacts", "dirtAmount": 0.06, "cavityBias": 0.7, "colorShift": "#B8AA8B", "roughness": 0.79, "evidenceRef": "front-view"}, {"id": "stone-bevel-polish", "region": "outer bevel crests", "roughness": 0.58, "evidenceRef": "three-quarter-view"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Clean stylized PBR response suitable for mobile isometric viewing.", "referencePbr": {"version": "1.0", "sourceImage": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/detail-zones/zone-r0c0.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.909, "estimatedFidelity": 0.909, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_albedo.png", "url": "limestone_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_roughness.png", "url": "limestone_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_height.png", "url": "limestone_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_normal.png", "url": "limestone_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/cristian/Documents/Game assets/Pipeline/PlazaFountain/pbr/limestone/limestone_ao.png", "url": "limestone_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 341, "sourceHeight": 512, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 341, "height": 493}, "mask": {"backgroundColor": "#D3D3D3", "backgroundNoise": 1.732, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.4787}, "mapStats": {"valueRange": 0.5563, "heightP90Gradient": 0.06573, "roughnessBase": 0.688, "roughnessVariation": 0.125, "normalStrength": 0.233, "blurRadius": 21}, "palette": ["#AB9B83", "#50645E", "#CBB9A0", "#887E69", "#EFDDC5"]}, "warnings": []}},
    options
  );
  materialMap["teal-ceramic"] = createSculptMaterial(
    "teal-ceramic",
    {"id": "teal-ceramic", "name": "Glazed Teal Ceramic", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#477E78", "color": "#477E78", "albedo": {"dominant": "#477E78", "secondary": ["#356864", "#65958D"], "samplingNotes": "Sampled from the generated six-view concept and reviewed under neutral light."}, "colorVariation": {"palette": ["#477E78", "#356864", "#65958D"], "pattern": "subtle glaze clouding", "amplitude": 0.045, "heightCorrelation": 0.15}, "textureResolution": 1024, "textureProjection": {"mode": "triplanar-like object coordinates", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Stable object-scale detail; no stretching across differently scaled tiers."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.08, "role": "broad tone variation"}, {"id": "meso", "frequency": 11, "amplitude": 0.035, "role": "pores, subtle veins, and ripple relief"}, {"id": "micro", "frequency": 58, "amplitude": 0.012, "role": "grazing-light highlight breakup"}], "roughness": {"base": 0.34, "variation": 0.06, "map": "independent deterministic procedural field", "localResponse": "cavities are rougher; exposed bevel crests are slightly smoother"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "independent deterministic height field", "strength": 0.08, "scale": 28, "space": "tangent"}, "bump": {"pattern": "independent fine-grain height", "amplitude": 0.002, "scale": 24}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.35, "notes": "Concentrate at stacked ring contacts, grooves, panel recesses, and mouth sockets."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "ceramic-cavity-darken", "region": "fish mouths and eye sockets", "roughness": 0.42, "colorShift": "#294F4D", "evidenceRef": "three-quarter-view"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Clean stylized PBR response suitable for mobile isometric viewing.", "clearcoat": {"base": 0.35, "roughness": 0.18}},
    options
  );
  materialMap["water"] = createSculptMaterial(
    "water",
    {"id": "water", "name": "Muted Teal Water", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#4D9F9D", "color": "#4D9F9D", "albedo": {"dominant": "#4D9F9D", "secondary": ["#78BAB5", "#2F8585"], "samplingNotes": "Sampled from the generated six-view concept and reviewed under neutral light."}, "colorVariation": {"palette": ["#4D9F9D", "#78BAB5", "#2F8585"], "pattern": "independent concentric and radial ripple normal field", "amplitude": 0.04, "heightCorrelation": 0.15}, "textureResolution": 1024, "textureProjection": {"mode": "triplanar-like object coordinates", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Stable object-scale detail; no stretching across differently scaled tiers."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.08, "role": "broad tone variation"}, {"id": "meso", "frequency": 11, "amplitude": 0.035, "role": "pores, subtle veins, and ripple relief"}, {"id": "micro", "frequency": 58, "amplitude": 0.012, "role": "grazing-light highlight breakup"}], "roughness": {"base": 0.1, "variation": 0.035, "map": "independent deterministic procedural field", "localResponse": "cavities are rougher; exposed bevel crests are slightly smoother"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "independent deterministic height field", "strength": 0.24, "scale": 14, "space": "tangent"}, "bump": {"pattern": "multi-octave ripple height", "amplitude": 0.016, "scale": 24}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.35, "notes": "Concentrate at stacked ring contacts, grooves, panel recesses, and mouth sockets."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "water-ripple-gloss", "region": "lower and upper water surfaces around spout impacts", "roughness": 0.06, "normalStrength": 0.32, "evidenceRef": "top-view"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Runtime water surface; streams are effect renderers and not fused to the exported structural mesh.", "transparent": true, "opacity": 0.82, "transmission": 0.18, "ior": 1.333, "depthWrite": false},
    options
  );
  materialMap["copper"] = createSculptMaterial(
    "copper",
    {"id": "copper", "name": "Aged Copper Accent", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#9C624B", "color": "#9C624B", "albedo": {"dominant": "#9C624B", "secondary": ["#784735", "#B27A5F"], "samplingNotes": "Sampled from the generated six-view concept and reviewed under neutral light."}, "colorVariation": {"palette": ["#9C624B", "#784735", "#B27A5F"], "pattern": "directional ring brushing", "amplitude": 0.07, "heightCorrelation": 0.15}, "textureResolution": 1024, "textureProjection": {"mode": "triplanar-like object coordinates", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Stable object-scale detail; no stretching across differently scaled tiers."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.08, "role": "broad tone variation"}, {"id": "meso", "frequency": 11, "amplitude": 0.035, "role": "pores, subtle veins, and ripple relief"}, {"id": "micro", "frequency": 58, "amplitude": 0.012, "role": "grazing-light highlight breakup"}], "roughness": {"base": 0.38, "variation": 0.1, "map": "independent deterministic procedural field", "localResponse": "cavities are rougher; exposed bevel crests are slightly smoother"}, "metalness": {"base": 0.72, "variation": 0.08}, "normal": {"pattern": "independent deterministic height field", "strength": 0.09, "scale": 46, "space": "tangent"}, "bump": {"pattern": "independent fine-grain height", "amplitude": 0.003, "scale": 24}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.35, "notes": "Concentrate at stacked ring contacts, grooves, panel recesses, and mouth sockets."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "copper-cavity-patina", "region": "underside of narrow copper rings", "dirtAmount": 0.12, "cavityBias": 0.85, "patinaColor": "#477F78", "roughness": 0.52, "evidenceRef": "three-quarter-view"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Clean stylized PBR response suitable for mobile isometric viewing."},
    options
  );
  materialMap["dark-recess"] = createSculptMaterial(
    "dark-recess",
    {"id": "dark-recess", "name": "Dark Teal Recess", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#294B4A", "color": "#294B4A", "albedo": {"dominant": "#294B4A", "secondary": ["#1F3A3A", "#355A58"], "samplingNotes": "Sampled from the generated six-view concept and reviewed under neutral light."}, "colorVariation": {"palette": ["#294B4A", "#1F3A3A", "#355A58"], "pattern": "very subtle matte ceramic variation", "amplitude": 0.035, "heightCorrelation": 0.15}, "textureResolution": 1024, "textureProjection": {"mode": "triplanar-like object coordinates", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Stable object-scale detail; no stretching across differently scaled tiers."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.08, "role": "broad tone variation"}, {"id": "meso", "frequency": 11, "amplitude": 0.035, "role": "pores, subtle veins, and ripple relief"}, {"id": "micro", "frequency": 58, "amplitude": 0.012, "role": "grazing-light highlight breakup"}], "roughness": {"base": 0.57, "variation": 0.06, "map": "independent deterministic procedural field", "localResponse": "cavities are rougher; exposed bevel crests are slightly smoother"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "independent deterministic height field", "strength": 0.12, "scale": 28, "space": "tangent"}, "bump": {"pattern": "independent fine-grain height", "amplitude": 0.002, "scale": 24}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.35, "notes": "Concentrate at stacked ring contacts, grooves, panel recesses, and mouth sockets."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "panel-edge-ao", "region": "perimeter of four trapezoid panels", "roughness": 0.64, "colorShift": "#1F3939", "evidenceRef": "front-view"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Clean stylized PBR response suitable for mobile isometric viewing."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Plaza Fountain Root__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
    node_root_0.scale.set(1.0, 1.0, 1.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Plaza Fountain Root", "level": "macro", "role": "root", "importance": 1, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": null, "attachment": null, "dimensions": {"width": 2.6, "height": 2.2, "depth": 2.6, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterLower_Socket", "localPosition": [0, 0.55, 0]}, {"id": "WaterUpper_Socket", "localPosition": [0, 1.78, 0]}, {"id": "Spout_N", "localPosition": [0, 1.18, 0.56]}, {"id": "Spout_E", "localPosition": [0.56, 1.18, 0]}, {"id": "Spout_S", "localPosition": [0, 1.18, -0.56]}, {"id": "Spout_W", "localPosition": [-0.56, 1.18, 0]}], "collider": {"type": "compound", "offset": [0, 0, 0], "scale": [2.6, 2.2, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "blockout"};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterLower_Socket", "localPosition": [0, 0.55, 0]}, {"id": "WaterUpper_Socket", "localPosition": [0, 1.78, 0]}, {"id": "Spout_N", "localPosition": [0, 1.18, 0.56]}, {"id": "Spout_E", "localPosition": [0.56, 1.18, 0]}, {"id": "Spout_S", "localPosition": [0, 1.18, -0.56]}, {"id": "Spout_W", "localPosition": [-0.56, 1.18, 0]}], "collider": {"type": "compound", "offset": [0, 0, 0], "scale": [2.6, 2.2, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Plaza Fountain Root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Plaza Fountain Root", "level": "macro", "role": "root", "importance": 1, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": null, "attachment": null, "dimensions": {"width": 2.6, "height": 2.2, "depth": 2.6, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterLower_Socket", "localPosition": [0, 0.55, 0]}, {"id": "WaterUpper_Socket", "localPosition": [0, 1.78, 0]}, {"id": "Spout_N", "localPosition": [0, 1.18, 0.56]}, {"id": "Spout_E", "localPosition": [0.56, 1.18, 0]}, {"id": "Spout_S", "localPosition": [0, 1.18, -0.56]}, {"id": "Spout_W", "localPosition": [-0.56, 1.18, 0]}], "collider": {"type": "compound", "offset": [0, 0, 0], "scale": [2.6, 2.2, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "blockout"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "compound", "offset": [0, 0, 0], "scale": [2.6, 2.2, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);
  const socket_root_WaterLower_Socket_0 = new THREE.Object3D();
  socket_root_WaterLower_Socket_0.name = "WaterLower_Socket";
  socket_root_WaterLower_Socket_0.position.set(0.0, 0.55, 0.0);
  socket_root_WaterLower_Socket_0.rotation.set(0, 0, 0);
  socket_root_WaterLower_Socket_0.userData.socket = {"id": "WaterLower_Socket", "localPosition": [0, 0.55, 0]};
  node_root_0.add(socket_root_WaterLower_Socket_0);
  sockets["root:WaterLower_Socket"] = socket_root_WaterLower_Socket_0;
  const socket_root_WaterUpper_Socket_1 = new THREE.Object3D();
  socket_root_WaterUpper_Socket_1.name = "WaterUpper_Socket";
  socket_root_WaterUpper_Socket_1.position.set(0.0, 1.78, 0.0);
  socket_root_WaterUpper_Socket_1.rotation.set(0, 0, 0);
  socket_root_WaterUpper_Socket_1.userData.socket = {"id": "WaterUpper_Socket", "localPosition": [0, 1.78, 0]};
  node_root_0.add(socket_root_WaterUpper_Socket_1);
  sockets["root:WaterUpper_Socket"] = socket_root_WaterUpper_Socket_1;
  const socket_root_Spout_N_2 = new THREE.Object3D();
  socket_root_Spout_N_2.name = "Spout_N";
  socket_root_Spout_N_2.position.set(0.0, 1.18, 0.56);
  socket_root_Spout_N_2.rotation.set(0, 0, 0);
  socket_root_Spout_N_2.userData.socket = {"id": "Spout_N", "localPosition": [0, 1.18, 0.56]};
  node_root_0.add(socket_root_Spout_N_2);
  sockets["root:Spout_N"] = socket_root_Spout_N_2;
  const socket_root_Spout_E_3 = new THREE.Object3D();
  socket_root_Spout_E_3.name = "Spout_E";
  socket_root_Spout_E_3.position.set(0.56, 1.18, 0.0);
  socket_root_Spout_E_3.rotation.set(0, 0, 0);
  socket_root_Spout_E_3.userData.socket = {"id": "Spout_E", "localPosition": [0.56, 1.18, 0]};
  node_root_0.add(socket_root_Spout_E_3);
  sockets["root:Spout_E"] = socket_root_Spout_E_3;
  const socket_root_Spout_S_4 = new THREE.Object3D();
  socket_root_Spout_S_4.name = "Spout_S";
  socket_root_Spout_S_4.position.set(0.0, 1.18, -0.56);
  socket_root_Spout_S_4.rotation.set(0, 0, 0);
  socket_root_Spout_S_4.userData.socket = {"id": "Spout_S", "localPosition": [0, 1.18, -0.56]};
  node_root_0.add(socket_root_Spout_S_4);
  sockets["root:Spout_S"] = socket_root_Spout_S_4;
  const socket_root_Spout_W_5 = new THREE.Object3D();
  socket_root_Spout_W_5.name = "Spout_W";
  socket_root_Spout_W_5.position.set(-0.56, 1.18, 0.0);
  socket_root_Spout_W_5.rotation.set(0, 0, 0);
  socket_root_Spout_W_5.userData.socket = {"id": "Spout_W", "localPosition": [-0.56, 1.18, 0]};
  node_root_0.add(socket_root_Spout_W_5);
  sockets["root:Spout_W"] = socket_root_Spout_W_5;

  const attachment_plinth_system_1 = {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.175, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_plinth_system_1 = makeAttachmentEndpoint(attachment_plinth_system_1);
  const node_plinth_system_1 = new THREE.Group();
  node_plinth_system_1.name = "Octagonal Plinth System__pivot";
  if (endpoint_plinth_system_1) {
    node_plinth_system_1.position.copy(endpoint_plinth_system_1.start);
    node_plinth_system_1.rotation.set(0, 0, 0);
    node_plinth_system_1.scale.set(1, 1, 1);
  } else {
    node_plinth_system_1.position.set(0.0, 0.175, 0.0);
    node_plinth_system_1.rotation.set(0.0, 0.0, 0.0);
    node_plinth_system_1.scale.set(1.0, 1.0, 1.0);
  }
  node_plinth_system_1.userData.sculptComponent = {"id": "plinth-system", "name": "Octagonal Plinth System", "level": "macro", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.175, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.6, "height": 0.35, "depth": 2.6, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.175, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.6, 0.35, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "octagonal-radial-seams", "kind": "seam", "count": 8, "geometryEffect": "thin recessed radial joints on both steps", "evidenceRefs": ["top-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["octagonal-radial-seams"], "fidelityTier": "structural"};
  node_plinth_system_1.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.6, 0.35, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["root"] ?? root).add(node_plinth_system_1);
  nodes["plinth-system"] = node_plinth_system_1;
  const mesh_plinth_system_1Geometry = endpoint_plinth_system_1
    ? new THREE.CylinderGeometry(endpoint_plinth_system_1.endRadius, endpoint_plinth_system_1.baseRadius, endpoint_plinth_system_1.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_plinth_system_1 = new THREE.Mesh(
    mesh_plinth_system_1Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plinth_system_1.name = "Octagonal Plinth System";
  if (endpoint_plinth_system_1) {
    mesh_plinth_system_1.position.copy(endpoint_plinth_system_1.midpoint);
    mesh_plinth_system_1.quaternion.copy(endpoint_plinth_system_1.quaternion);
  }
  mesh_plinth_system_1.castShadow = options.castShadow ?? true;
  mesh_plinth_system_1.receiveShadow = options.receiveShadow ?? true;
  mesh_plinth_system_1.userData.sculptComponent = {"id": "plinth-system", "name": "Octagonal Plinth System", "level": "macro", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.175, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.6, "height": 0.35, "depth": 2.6, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.175, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.6, 0.35, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "octagonal-radial-seams", "kind": "seam", "count": 8, "geometryEffect": "thin recessed radial joints on both steps", "evidenceRefs": ["top-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["octagonal-radial-seams"], "fidelityTier": "structural"};
  node_plinth_system_1.add(mesh_plinth_system_1);
  meshes["plinth-system"] = mesh_plinth_system_1;
  colliders["plinth-system"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.6, 0.35, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["plinth-system"] ??= [];
  destructionGroups["plinth-system"].push(node_plinth_system_1);

  const attachment_plinth_step_lower_2 = {"parentId": "plinth-system", "parentSocket": "plinth-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.08, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_plinth_step_lower_2 = makeAttachmentEndpoint(attachment_plinth_step_lower_2);
  const node_plinth_step_lower_2 = new THREE.Group();
  node_plinth_step_lower_2.name = "Lower Octagonal Step__pivot";
  if (endpoint_plinth_step_lower_2) {
    node_plinth_step_lower_2.position.copy(endpoint_plinth_step_lower_2.start);
    node_plinth_step_lower_2.rotation.set(0, 0, 0);
    node_plinth_step_lower_2.scale.set(1, 1, 1);
  } else {
    node_plinth_step_lower_2.position.set(0.0, 0.08, 0.0);
    node_plinth_step_lower_2.rotation.set(0.0, 0.0, 0.0);
    node_plinth_step_lower_2.scale.set(1.0, 1.0, 1.0);
  }
  node_plinth_step_lower_2.userData.sculptComponent = {"id": "plinth-step-lower", "name": "Lower Octagonal Step", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "plinth-system", "attachment": {"parentId": "plinth-system", "parentSocket": "plinth-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.08, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.6, "height": 0.16, "depth": 2.6, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.08, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.6, 0.16, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-step-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "step-edge-bevel", "kind": "bevel", "bevelRadius": 0.025, "segments": 2, "evidenceRefs": ["front-view", "three-quarter-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["step-edge-bevel"], "fidelityTier": "structural"};
  node_plinth_step_lower_2.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.6, 0.16, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-step-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["plinth-system"] ?? root).add(node_plinth_step_lower_2);
  nodes["plinth-step-lower"] = node_plinth_step_lower_2;
  const mesh_plinth_step_lower_2Geometry = endpoint_plinth_step_lower_2
    ? new THREE.CylinderGeometry(endpoint_plinth_step_lower_2.endRadius, endpoint_plinth_step_lower_2.baseRadius, endpoint_plinth_step_lower_2.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_plinth_step_lower_2 = new THREE.Mesh(
    mesh_plinth_step_lower_2Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plinth_step_lower_2.name = "Lower Octagonal Step";
  if (endpoint_plinth_step_lower_2) {
    mesh_plinth_step_lower_2.position.copy(endpoint_plinth_step_lower_2.midpoint);
    mesh_plinth_step_lower_2.quaternion.copy(endpoint_plinth_step_lower_2.quaternion);
  }
  mesh_plinth_step_lower_2.castShadow = options.castShadow ?? true;
  mesh_plinth_step_lower_2.receiveShadow = options.receiveShadow ?? true;
  mesh_plinth_step_lower_2.userData.sculptComponent = {"id": "plinth-step-lower", "name": "Lower Octagonal Step", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "plinth-system", "attachment": {"parentId": "plinth-system", "parentSocket": "plinth-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.08, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.6, "height": 0.16, "depth": 2.6, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.08, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.6, 0.16, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-step-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "step-edge-bevel", "kind": "bevel", "bevelRadius": 0.025, "segments": 2, "evidenceRefs": ["front-view", "three-quarter-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["step-edge-bevel"], "fidelityTier": "structural"};
  node_plinth_step_lower_2.add(mesh_plinth_step_lower_2);
  meshes["plinth-step-lower"] = mesh_plinth_step_lower_2;
  colliders["plinth-step-lower"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.6, 0.16, 2.6], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["plinth-step-lower"] ??= [];
  destructionGroups["plinth-step-lower"].push(node_plinth_step_lower_2);

  const attachment_plinth_step_upper_3 = {"parentId": "plinth-system", "parentSocket": "plinth-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.255, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_plinth_step_upper_3 = makeAttachmentEndpoint(attachment_plinth_step_upper_3);
  const node_plinth_step_upper_3 = new THREE.Group();
  node_plinth_step_upper_3.name = "Upper Octagonal Step__pivot";
  if (endpoint_plinth_step_upper_3) {
    node_plinth_step_upper_3.position.copy(endpoint_plinth_step_upper_3.start);
    node_plinth_step_upper_3.rotation.set(0, 0, 0);
    node_plinth_step_upper_3.scale.set(1, 1, 1);
  } else {
    node_plinth_step_upper_3.position.set(0.0, 0.255, 0.0);
    node_plinth_step_upper_3.rotation.set(0.0, 0.0, 0.0);
    node_plinth_step_upper_3.scale.set(1.0, 1.0, 1.0);
  }
  node_plinth_step_upper_3.userData.sculptComponent = {"id": "plinth-step-upper", "name": "Upper Octagonal Step", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "plinth-system", "attachment": {"parentId": "plinth-system", "parentSocket": "plinth-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.255, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.32, "height": 0.19, "depth": 2.32, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.255, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.32, 0.19, 2.32], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-step-upper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upper-step-inset", "kind": "seam", "geometryEffect": "recessed horizontal construction line", "evidenceRefs": ["left-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["upper-step-inset"], "fidelityTier": "structural"};
  node_plinth_step_upper_3.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.32, 0.19, 2.32], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-step-upper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["plinth-system"] ?? root).add(node_plinth_step_upper_3);
  nodes["plinth-step-upper"] = node_plinth_step_upper_3;
  const mesh_plinth_step_upper_3Geometry = endpoint_plinth_step_upper_3
    ? new THREE.CylinderGeometry(endpoint_plinth_step_upper_3.endRadius, endpoint_plinth_step_upper_3.baseRadius, endpoint_plinth_step_upper_3.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_plinth_step_upper_3 = new THREE.Mesh(
    mesh_plinth_step_upper_3Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plinth_step_upper_3.name = "Upper Octagonal Step";
  if (endpoint_plinth_step_upper_3) {
    mesh_plinth_step_upper_3.position.copy(endpoint_plinth_step_upper_3.midpoint);
    mesh_plinth_step_upper_3.quaternion.copy(endpoint_plinth_step_upper_3.quaternion);
  }
  mesh_plinth_step_upper_3.castShadow = options.castShadow ?? true;
  mesh_plinth_step_upper_3.receiveShadow = options.receiveShadow ?? true;
  mesh_plinth_step_upper_3.userData.sculptComponent = {"id": "plinth-step-upper", "name": "Upper Octagonal Step", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "plinth-system", "attachment": {"parentId": "plinth-system", "parentSocket": "plinth-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.255, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.32, "height": 0.19, "depth": 2.32, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.255, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.32, 0.19, 2.32], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth-step-upper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upper-step-inset", "kind": "seam", "geometryEffect": "recessed horizontal construction line", "evidenceRefs": ["left-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["upper-step-inset"], "fidelityTier": "structural"};
  node_plinth_step_upper_3.add(mesh_plinth_step_upper_3);
  meshes["plinth-step-upper"] = mesh_plinth_step_upper_3;
  colliders["plinth-step-upper"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.32, 0.19, 2.32], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["plinth-step-upper"] ??= [];
  destructionGroups["plinth-step-upper"].push(node_plinth_step_upper_3);

  const attachment_lower_basin_system_4 = {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.57, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_lower_basin_system_4 = makeAttachmentEndpoint(attachment_lower_basin_system_4);
  const node_lower_basin_system_4 = new THREE.Group();
  node_lower_basin_system_4.name = "Lower Basin System__pivot";
  if (endpoint_lower_basin_system_4) {
    node_lower_basin_system_4.position.copy(endpoint_lower_basin_system_4.start);
    node_lower_basin_system_4.rotation.set(0, 0, 0);
    node_lower_basin_system_4.scale.set(1, 1, 1);
  } else {
    node_lower_basin_system_4.position.set(0.0, 0.57, 0.0);
    node_lower_basin_system_4.rotation.set(0.0, 0.0, 0.0);
    node_lower_basin_system_4.scale.set(1.0, 1.0, 1.0);
  }
  node_lower_basin_system_4.userData.sculptComponent = {"id": "lower-basin-system", "name": "Lower Basin System", "level": "macro", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.57, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.12, "height": 0.5, "depth": 2.12, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.57, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.12, 0.5, 2.12], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_lower_basin_system_4.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.12, 0.5, 2.12], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["root"] ?? root).add(node_lower_basin_system_4);
  nodes["lower-basin-system"] = node_lower_basin_system_4;
  const mesh_lower_basin_system_4Geometry = endpoint_lower_basin_system_4
    ? new THREE.CylinderGeometry(endpoint_lower_basin_system_4.endRadius, endpoint_lower_basin_system_4.baseRadius, endpoint_lower_basin_system_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_lower_basin_system_4 = new THREE.Mesh(
    mesh_lower_basin_system_4Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_basin_system_4.name = "Lower Basin System";
  if (endpoint_lower_basin_system_4) {
    mesh_lower_basin_system_4.position.copy(endpoint_lower_basin_system_4.midpoint);
    mesh_lower_basin_system_4.quaternion.copy(endpoint_lower_basin_system_4.quaternion);
  }
  mesh_lower_basin_system_4.castShadow = options.castShadow ?? true;
  mesh_lower_basin_system_4.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_basin_system_4.userData.sculptComponent = {"id": "lower-basin-system", "name": "Lower Basin System", "level": "macro", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.57, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.12, "height": 0.5, "depth": 2.12, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.57, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.12, 0.5, 2.12], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_lower_basin_system_4.add(mesh_lower_basin_system_4);
  meshes["lower-basin-system"] = mesh_lower_basin_system_4;
  colliders["lower-basin-system"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.12, 0.5, 2.12], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["lower-basin-system"] ??= [];
  destructionGroups["lower-basin-system"].push(node_lower_basin_system_4);

  const attachment_lower_basin_wall_5 = {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_lower_basin_wall_5 = makeAttachmentEndpoint(attachment_lower_basin_wall_5);
  const node_lower_basin_wall_5 = new THREE.Group();
  node_lower_basin_wall_5.name = "Lower Basin Wall__pivot";
  if (endpoint_lower_basin_wall_5) {
    node_lower_basin_wall_5.position.copy(endpoint_lower_basin_wall_5.start);
    node_lower_basin_wall_5.rotation.set(0, 0, 0);
    node_lower_basin_wall_5.scale.set(1, 1, 1);
  } else {
    node_lower_basin_wall_5.position.set(0.0, 0.48, 0.0);
    node_lower_basin_wall_5.rotation.set(0.0, 0.0, 0.0);
    node_lower_basin_wall_5.scale.set(1.0, 1.0, 1.0);
  }
  node_lower_basin_wall_5.userData.sculptComponent = {"id": "lower-basin-wall", "name": "Lower Basin Wall", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "lower-basin-system", "attachment": {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1.98, "height": 0.36, "depth": 1.98, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.48, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.98, 0.36, 1.98], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wall-panel-seams", "kind": "seam", "count": 8, "geometryEffect": "shallow vertical panel lines", "evidenceRefs": ["front-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["wall-panel-seams"], "fidelityTier": "structural"};
  node_lower_basin_wall_5.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.98, 0.36, 1.98], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["lower-basin-system"] ?? root).add(node_lower_basin_wall_5);
  nodes["lower-basin-wall"] = node_lower_basin_wall_5;
  const mesh_lower_basin_wall_5Geometry = endpoint_lower_basin_wall_5
    ? new THREE.CylinderGeometry(endpoint_lower_basin_wall_5.endRadius, endpoint_lower_basin_wall_5.baseRadius, endpoint_lower_basin_wall_5.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_lower_basin_wall_5 = new THREE.Mesh(
    mesh_lower_basin_wall_5Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_basin_wall_5.name = "Lower Basin Wall";
  if (endpoint_lower_basin_wall_5) {
    mesh_lower_basin_wall_5.position.copy(endpoint_lower_basin_wall_5.midpoint);
    mesh_lower_basin_wall_5.quaternion.copy(endpoint_lower_basin_wall_5.quaternion);
  }
  mesh_lower_basin_wall_5.castShadow = options.castShadow ?? true;
  mesh_lower_basin_wall_5.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_basin_wall_5.userData.sculptComponent = {"id": "lower-basin-wall", "name": "Lower Basin Wall", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "lower-basin-system", "attachment": {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1.98, "height": 0.36, "depth": 1.98, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.48, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.98, 0.36, 1.98], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wall-panel-seams", "kind": "seam", "count": 8, "geometryEffect": "shallow vertical panel lines", "evidenceRefs": ["front-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["wall-panel-seams"], "fidelityTier": "structural"};
  node_lower_basin_wall_5.add(mesh_lower_basin_wall_5);
  meshes["lower-basin-wall"] = mesh_lower_basin_wall_5;
  colliders["lower-basin-wall"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.98, 0.36, 1.98], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["lower-basin-wall"] ??= [];
  destructionGroups["lower-basin-wall"].push(node_lower_basin_wall_5);

  const attachment_lower_basin_rim_6 = {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.74, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_lower_basin_rim_6 = makeAttachmentEndpoint(attachment_lower_basin_rim_6);
  const node_lower_basin_rim_6 = new THREE.Group();
  node_lower_basin_rim_6.name = "Thick Lower Basin Rim__pivot";
  if (endpoint_lower_basin_rim_6) {
    node_lower_basin_rim_6.position.copy(endpoint_lower_basin_rim_6.start);
    node_lower_basin_rim_6.rotation.set(0, 0, 0);
    node_lower_basin_rim_6.scale.set(1, 1, 1);
  } else {
    node_lower_basin_rim_6.position.set(0.0, 0.74, 0.0);
    node_lower_basin_rim_6.rotation.set(0.0, 0.0, 0.0);
    node_lower_basin_rim_6.scale.set(1.0, 1.0, 1.0);
  }
  node_lower_basin_rim_6.userData.sculptComponent = {"id": "lower-basin-rim", "name": "Thick Lower Basin Rim", "level": "meso", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "lower-basin-system", "attachment": {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.74, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.18, "height": 0.24, "depth": 2.18, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.74, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.18, 0.24, 2.18], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-rim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lower-lip-bevel", "kind": "bevel", "bevelRadius": 0.08, "segments": 4, "evidenceRefs": ["three-quarter-view"]}, {"id": "lower-inner-groove", "kind": "groove", "width": 0.025, "depth": 0.015, "evidenceRefs": ["front-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["lower-lip-bevel", "lower-inner-groove"], "fidelityTier": "structural"};
  node_lower_basin_rim_6.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.18, 0.24, 2.18], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-rim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["lower-basin-system"] ?? root).add(node_lower_basin_rim_6);
  nodes["lower-basin-rim"] = node_lower_basin_rim_6;
  const mesh_lower_basin_rim_6Geometry = endpoint_lower_basin_rim_6
    ? new THREE.CylinderGeometry(endpoint_lower_basin_rim_6.endRadius, endpoint_lower_basin_rim_6.baseRadius, endpoint_lower_basin_rim_6.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_lower_basin_rim_6 = new THREE.Mesh(
    mesh_lower_basin_rim_6Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_basin_rim_6.name = "Thick Lower Basin Rim";
  if (endpoint_lower_basin_rim_6) {
    mesh_lower_basin_rim_6.position.copy(endpoint_lower_basin_rim_6.midpoint);
    mesh_lower_basin_rim_6.quaternion.copy(endpoint_lower_basin_rim_6.quaternion);
  }
  mesh_lower_basin_rim_6.castShadow = options.castShadow ?? true;
  mesh_lower_basin_rim_6.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_basin_rim_6.userData.sculptComponent = {"id": "lower-basin-rim", "name": "Thick Lower Basin Rim", "level": "meso", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "lower-basin-system", "attachment": {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.74, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 2.18, "height": 0.24, "depth": 2.18, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.74, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.18, 0.24, 2.18], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-basin-rim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lower-lip-bevel", "kind": "bevel", "bevelRadius": 0.08, "segments": 4, "evidenceRefs": ["three-quarter-view"]}, {"id": "lower-inner-groove", "kind": "groove", "width": 0.025, "depth": 0.015, "evidenceRefs": ["front-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["lower-lip-bevel", "lower-inner-groove"], "fidelityTier": "structural"};
  node_lower_basin_rim_6.add(mesh_lower_basin_rim_6);
  meshes["lower-basin-rim"] = mesh_lower_basin_rim_6;
  colliders["lower-basin-rim"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [2.18, 0.24, 2.18], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["lower-basin-rim"] ??= [];
  destructionGroups["lower-basin-rim"].push(node_lower_basin_rim_6);

  const attachment_lower_water_7 = {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.69, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_lower_water_7 = makeAttachmentEndpoint(attachment_lower_water_7);
  const node_lower_water_7 = new THREE.Group();
  node_lower_water_7.name = "Lower Water Surface__pivot";
  if (endpoint_lower_water_7) {
    node_lower_water_7.position.copy(endpoint_lower_water_7.start);
    node_lower_water_7.rotation.set(0, 0, 0);
    node_lower_water_7.scale.set(1, 1, 1);
  } else {
    node_lower_water_7.position.set(0.0, 0.69, 0.0);
    node_lower_water_7.rotation.set(0.0, 0.0, 0.0);
    node_lower_water_7.scale.set(1.0, 1.0, 1.0);
  }
  node_lower_water_7.userData.sculptComponent = {"id": "lower-water", "name": "Lower Water Surface", "level": "meso", "role": "effect-surface", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "lower-basin-system", "attachment": {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.69, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1.82, "height": 0.025, "depth": 1.82, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.69, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "effect-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterLower_Socket", "localPosition": [0, 0.015, 0]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1.82, 0.025, 1.82], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-water", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "water"}}, "material": "water", "materialLayers": ["water"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.08, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_lower_water_7.userData.actionProfile = {"animationRole": "effect-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterLower_Socket", "localPosition": [0, 0.015, 0]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1.82, 0.025, 1.82], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-water", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "water"}};
  (nodes["lower-basin-system"] ?? root).add(node_lower_water_7);
  nodes["lower-water"] = node_lower_water_7;
  const mesh_lower_water_7Geometry = endpoint_lower_water_7
    ? new THREE.CylinderGeometry(endpoint_lower_water_7.endRadius, endpoint_lower_water_7.baseRadius, endpoint_lower_water_7.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_lower_water_7 = new THREE.Mesh(
    mesh_lower_water_7Geometry,
    materialMap["water"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_water_7.name = "Lower Water Surface";
  if (endpoint_lower_water_7) {
    mesh_lower_water_7.position.copy(endpoint_lower_water_7.midpoint);
    mesh_lower_water_7.quaternion.copy(endpoint_lower_water_7.quaternion);
  }
  mesh_lower_water_7.castShadow = options.castShadow ?? true;
  mesh_lower_water_7.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_water_7.userData.sculptComponent = {"id": "lower-water", "name": "Lower Water Surface", "level": "meso", "role": "effect-surface", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "lower-basin-system", "attachment": {"parentId": "lower-basin-system", "parentSocket": "lower-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.69, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1.82, "height": 0.025, "depth": 1.82, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.69, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "effect-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterLower_Socket", "localPosition": [0, 0.015, 0]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1.82, 0.025, 1.82], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-water", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "water"}}, "material": "water", "materialLayers": ["water"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.08, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_lower_water_7.add(mesh_lower_water_7);
  meshes["lower-water"] = mesh_lower_water_7;
  colliders["lower-water"] = {"type": "none", "offset": [0, 0, 0], "scale": [1.82, 0.025, 1.82], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["lower-water"] ??= [];
  destructionGroups["lower-water"].push(node_lower_water_7);
  const socket_lower_water_WaterLower_Socket_0 = new THREE.Object3D();
  socket_lower_water_WaterLower_Socket_0.name = "WaterLower_Socket";
  socket_lower_water_WaterLower_Socket_0.position.set(0.0, 0.015, 0.0);
  socket_lower_water_WaterLower_Socket_0.rotation.set(0, 0, 0);
  socket_lower_water_WaterLower_Socket_0.userData.socket = {"id": "WaterLower_Socket", "localPosition": [0, 0.015, 0]};
  node_lower_water_7.add(socket_lower_water_WaterLower_Socket_0);
  sockets["lower-water:WaterLower_Socket"] = socket_lower_water_WaterLower_Socket_0;

  const attachment_tower_system_8 = {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.15, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_tower_system_8 = makeAttachmentEndpoint(attachment_tower_system_8);
  const node_tower_system_8 = new THREE.Group();
  node_tower_system_8.name = "Faceted Pedestal Tower__pivot";
  if (endpoint_tower_system_8) {
    node_tower_system_8.position.copy(endpoint_tower_system_8.start);
    node_tower_system_8.rotation.set(0, 0, 0);
    node_tower_system_8.scale.set(1, 1, 1);
  } else {
    node_tower_system_8.position.set(0.0, 1.15, 0.0);
    node_tower_system_8.rotation.set(0.0, 0.0, 0.0);
    node_tower_system_8.scale.set(1.0, 1.0, 1.0);
  }
  node_tower_system_8.userData.sculptComponent = {"id": "tower-system", "name": "Faceted Pedestal Tower", "level": "macro", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.15, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.92, "height": 0.94, "depth": 0.92, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.15, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "spout-ring", "localPosition": [0, 0.03, 0]}, {"id": "upper-bowl-seat", "localPosition": [0, 0.47, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.92, 0.94, 0.92], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tower-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_tower_system_8.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "spout-ring", "localPosition": [0, 0.03, 0]}, {"id": "upper-bowl-seat", "localPosition": [0, 0.47, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.92, 0.94, 0.92], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tower-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["root"] ?? root).add(node_tower_system_8);
  nodes["tower-system"] = node_tower_system_8;
  const mesh_tower_system_8Geometry = endpoint_tower_system_8
    ? new THREE.CylinderGeometry(endpoint_tower_system_8.endRadius, endpoint_tower_system_8.baseRadius, endpoint_tower_system_8.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_tower_system_8 = new THREE.Mesh(
    mesh_tower_system_8Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tower_system_8.name = "Faceted Pedestal Tower";
  if (endpoint_tower_system_8) {
    mesh_tower_system_8.position.copy(endpoint_tower_system_8.midpoint);
    mesh_tower_system_8.quaternion.copy(endpoint_tower_system_8.quaternion);
  }
  mesh_tower_system_8.castShadow = options.castShadow ?? true;
  mesh_tower_system_8.receiveShadow = options.receiveShadow ?? true;
  mesh_tower_system_8.userData.sculptComponent = {"id": "tower-system", "name": "Faceted Pedestal Tower", "level": "macro", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.15, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.92, "height": 0.94, "depth": 0.92, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.15, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "spout-ring", "localPosition": [0, 0.03, 0]}, {"id": "upper-bowl-seat", "localPosition": [0, 0.47, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.92, 0.94, 0.92], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tower-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_tower_system_8.add(mesh_tower_system_8);
  meshes["tower-system"] = mesh_tower_system_8;
  colliders["tower-system"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.92, 0.94, 0.92], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["tower-system"] ??= [];
  destructionGroups["tower-system"].push(node_tower_system_8);
  const socket_tower_system_spout_ring_0 = new THREE.Object3D();
  socket_tower_system_spout_ring_0.name = "spout-ring";
  socket_tower_system_spout_ring_0.position.set(0.0, 0.03, 0.0);
  socket_tower_system_spout_ring_0.rotation.set(0, 0, 0);
  socket_tower_system_spout_ring_0.userData.socket = {"id": "spout-ring", "localPosition": [0, 0.03, 0]};
  node_tower_system_8.add(socket_tower_system_spout_ring_0);
  sockets["tower-system:spout-ring"] = socket_tower_system_spout_ring_0;
  const socket_tower_system_upper_bowl_seat_1 = new THREE.Object3D();
  socket_tower_system_upper_bowl_seat_1.name = "upper-bowl-seat";
  socket_tower_system_upper_bowl_seat_1.position.set(0.0, 0.47, 0.0);
  socket_tower_system_upper_bowl_seat_1.rotation.set(0, 0, 0);
  socket_tower_system_upper_bowl_seat_1.userData.socket = {"id": "upper-bowl-seat", "localPosition": [0, 0.47, 0]};
  node_tower_system_8.add(socket_tower_system_upper_bowl_seat_1);
  sockets["tower-system:upper-bowl-seat"] = socket_tower_system_upper_bowl_seat_1;

  const attachment_pedestal_body_9 = {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.13, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_pedestal_body_9 = makeAttachmentEndpoint(attachment_pedestal_body_9);
  const node_pedestal_body_9 = new THREE.Group();
  node_pedestal_body_9.name = "Tapered Octagonal Pedestal__pivot";
  if (endpoint_pedestal_body_9) {
    node_pedestal_body_9.position.copy(endpoint_pedestal_body_9.start);
    node_pedestal_body_9.rotation.set(0, 0, 0);
    node_pedestal_body_9.scale.set(1, 1, 1);
  } else {
    node_pedestal_body_9.position.set(0.0, 1.13, 0.0);
    node_pedestal_body_9.rotation.set(0.0, 0.0, 0.0);
    node_pedestal_body_9.scale.set(1.0, 1.0, 1.0);
  }
  node_pedestal_body_9.userData.sculptComponent = {"id": "pedestal-body", "name": "Tapered Octagonal Pedestal", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "tower-system", "attachment": {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.13, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.88, "height": 0.82, "depth": 0.88, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.13, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.88, 0.82, 0.88], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pedestal-chamfers", "kind": "bevel", "bevelRadius": 0.025, "segments": 2, "evidenceRefs": ["left-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["pedestal-chamfers"], "fidelityTier": "structural"};
  node_pedestal_body_9.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.88, 0.82, 0.88], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["tower-system"] ?? root).add(node_pedestal_body_9);
  nodes["pedestal-body"] = node_pedestal_body_9;
  const mesh_pedestal_body_9Geometry = endpoint_pedestal_body_9
    ? new THREE.CylinderGeometry(endpoint_pedestal_body_9.endRadius, endpoint_pedestal_body_9.baseRadius, endpoint_pedestal_body_9.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_pedestal_body_9 = new THREE.Mesh(
    mesh_pedestal_body_9Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pedestal_body_9.name = "Tapered Octagonal Pedestal";
  if (endpoint_pedestal_body_9) {
    mesh_pedestal_body_9.position.copy(endpoint_pedestal_body_9.midpoint);
    mesh_pedestal_body_9.quaternion.copy(endpoint_pedestal_body_9.quaternion);
  }
  mesh_pedestal_body_9.castShadow = options.castShadow ?? true;
  mesh_pedestal_body_9.receiveShadow = options.receiveShadow ?? true;
  mesh_pedestal_body_9.userData.sculptComponent = {"id": "pedestal-body", "name": "Tapered Octagonal Pedestal", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "tower-system", "attachment": {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.13, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.88, "height": 0.82, "depth": 0.88, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.13, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.88, 0.82, 0.88], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pedestal-chamfers", "kind": "bevel", "bevelRadius": 0.025, "segments": 2, "evidenceRefs": ["left-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["pedestal-chamfers"], "fidelityTier": "structural"};
  node_pedestal_body_9.add(mesh_pedestal_body_9);
  meshes["pedestal-body"] = mesh_pedestal_body_9;
  colliders["pedestal-body"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.88, 0.82, 0.88], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["pedestal-body"] ??= [];
  destructionGroups["pedestal-body"].push(node_pedestal_body_9);

  const attachment_pedestal_panel_system_10 = {"parentId": "pedestal-body", "parentSocket": "pedestal-body-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.16, 0.43], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_pedestal_panel_system_10 = makeAttachmentEndpoint(attachment_pedestal_panel_system_10);
  const node_pedestal_panel_system_10 = new THREE.Group();
  node_pedestal_panel_system_10.name = "Four Recessed Teal Panels__pivot";
  if (endpoint_pedestal_panel_system_10) {
    node_pedestal_panel_system_10.position.copy(endpoint_pedestal_panel_system_10.start);
    node_pedestal_panel_system_10.rotation.set(0, 0, 0);
    node_pedestal_panel_system_10.scale.set(1, 1, 1);
  } else {
    node_pedestal_panel_system_10.position.set(0.0, 1.16, 0.43);
    node_pedestal_panel_system_10.rotation.set(0.0, 0.0, 0.0);
    node_pedestal_panel_system_10.scale.set(1.0, 1.0, 1.0);
  }
  node_pedestal_panel_system_10.userData.sculptComponent = {"id": "pedestal-panel-system", "name": "Four Recessed Teal Panels", "level": "meso", "role": "static-detail", "importance": 0.8, "confidence": 0.94, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "pedestal-body", "attachment": {"parentId": "pedestal-body", "parentSocket": "pedestal-body-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.16, 0.43], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.42, "height": 0.52, "depth": 0.025, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.16, 0.43], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.42, 0.52, 0.025], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-panel-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-recess"}}, "material": "dark-recess", "materialLayers": ["dark-recess"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pedestal-panel-recess", "kind": "groove", "depth": 0.018, "borderWidth": 0.045, "evidenceRefs": ["three-quarter-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["pedestal-panel-recess"], "fidelityTier": "structural"};
  node_pedestal_panel_system_10.userData.actionProfile = {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.42, 0.52, 0.025], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-panel-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-recess"}};
  (nodes["pedestal-body"] ?? root).add(node_pedestal_panel_system_10);
  nodes["pedestal-panel-system"] = node_pedestal_panel_system_10;
  const mesh_pedestal_panel_system_10Geometry = endpoint_pedestal_panel_system_10
    ? new THREE.CylinderGeometry(endpoint_pedestal_panel_system_10.endRadius, endpoint_pedestal_panel_system_10.baseRadius, endpoint_pedestal_panel_system_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_pedestal_panel_system_10 = new THREE.Mesh(
    mesh_pedestal_panel_system_10Geometry,
    materialMap["dark-recess"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pedestal_panel_system_10.name = "Four Recessed Teal Panels";
  if (endpoint_pedestal_panel_system_10) {
    mesh_pedestal_panel_system_10.position.copy(endpoint_pedestal_panel_system_10.midpoint);
    mesh_pedestal_panel_system_10.quaternion.copy(endpoint_pedestal_panel_system_10.quaternion);
  }
  mesh_pedestal_panel_system_10.castShadow = options.castShadow ?? true;
  mesh_pedestal_panel_system_10.receiveShadow = options.receiveShadow ?? true;
  mesh_pedestal_panel_system_10.userData.sculptComponent = {"id": "pedestal-panel-system", "name": "Four Recessed Teal Panels", "level": "meso", "role": "static-detail", "importance": 0.8, "confidence": 0.94, "primitive": "box", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "pedestal-body", "attachment": {"parentId": "pedestal-body", "parentSocket": "pedestal-body-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.16, 0.43], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.42, "height": 0.52, "depth": 0.025, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.16, 0.43], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.42, 0.52, 0.025], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-panel-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "dark-recess"}}, "material": "dark-recess", "materialLayers": ["dark-recess"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pedestal-panel-recess", "kind": "groove", "depth": 0.018, "borderWidth": 0.045, "evidenceRefs": ["three-quarter-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["pedestal-panel-recess"], "fidelityTier": "structural"};
  node_pedestal_panel_system_10.add(mesh_pedestal_panel_system_10);
  meshes["pedestal-panel-system"] = mesh_pedestal_panel_system_10;
  colliders["pedestal-panel-system"] = {"type": "none", "offset": [0, 0, 0], "scale": [0.42, 0.52, 0.025], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["pedestal-panel-system"] ??= [];
  destructionGroups["pedestal-panel-system"].push(node_pedestal_panel_system_10);

  const attachment_fish_spout_prototype_11 = {"parentId": "tower-system", "parentSocket": "spout-ring", "localStart": [0, 0.03, 0.42], "localEnd": [0, 0.03, 0.64], "baseRadius": 0.11, "endRadius": 0.07, "embedDepth": 0.045, "overlap": 0.04, "contactType": "embedded", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_fish_spout_prototype_11 = makeAttachmentEndpoint(attachment_fish_spout_prototype_11);
  const node_fish_spout_prototype_11 = new THREE.Group();
  node_fish_spout_prototype_11.name = "Stylized Fish Spout Prototype__pivot";
  if (endpoint_fish_spout_prototype_11) {
    node_fish_spout_prototype_11.position.copy(endpoint_fish_spout_prototype_11.start);
    node_fish_spout_prototype_11.rotation.set(0, 0, 0);
    node_fish_spout_prototype_11.scale.set(1, 1, 1);
  } else {
    node_fish_spout_prototype_11.position.set(0.0, 1.2, 0.57);
    node_fish_spout_prototype_11.rotation.set(0.0, 0.0, 0.0);
    node_fish_spout_prototype_11.scale.set(1.0, 1.0, 1.0);
  }
  node_fish_spout_prototype_11.userData.sculptComponent = {"id": "fish-spout-prototype", "name": "Stylized Fish Spout Prototype", "level": "meso", "role": "effect-emitter", "importance": 0.95, "confidence": 0.94, "primitive": "sphere", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "tower-system", "attachment": {"parentId": "tower-system", "parentSocket": "spout-ring", "localStart": [0, 0.03, 0.42], "localEnd": [0, 0.03, 0.64], "baseRadius": 0.11, "endRadius": 0.07, "embedDepth": 0.045, "overlap": 0.04, "contactType": "embedded", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.24, "height": 0.2, "depth": 0.3, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.2, 0.57], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "effect-emitter", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterJet_Socket", "localPosition": [0, -0.03, 0.18]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.24, 0.2, 0.3], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fish-spout-prototype", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "teal-ceramic"}}, "material": "teal-ceramic", "materialLayers": ["teal-ceramic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fish-mouth-outlet", "kind": "hole", "diameter": 0.045, "depth": 0.03, "evidenceRefs": ["front-view"]}, {"id": "fish-eye-beads", "kind": "fastener", "count": 2, "radius": 0.018, "evidenceRefs": ["three-quarter-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["fish-mouth-outlet", "fish-eye-beads"], "fidelityTier": "structural"};
  node_fish_spout_prototype_11.userData.actionProfile = {"animationRole": "effect-emitter", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterJet_Socket", "localPosition": [0, -0.03, 0.18]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.24, 0.2, 0.3], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fish-spout-prototype", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "teal-ceramic"}};
  (nodes["tower-system"] ?? root).add(node_fish_spout_prototype_11);
  nodes["fish-spout-prototype"] = node_fish_spout_prototype_11;
  const mesh_fish_spout_prototype_11Geometry = endpoint_fish_spout_prototype_11
    ? new THREE.CylinderGeometry(endpoint_fish_spout_prototype_11.endRadius, endpoint_fish_spout_prototype_11.baseRadius, endpoint_fish_spout_prototype_11.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  const mesh_fish_spout_prototype_11 = new THREE.Mesh(
    mesh_fish_spout_prototype_11Geometry,
    materialMap["teal-ceramic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fish_spout_prototype_11.name = "Stylized Fish Spout Prototype";
  if (endpoint_fish_spout_prototype_11) {
    mesh_fish_spout_prototype_11.position.copy(endpoint_fish_spout_prototype_11.midpoint);
    mesh_fish_spout_prototype_11.quaternion.copy(endpoint_fish_spout_prototype_11.quaternion);
  }
  mesh_fish_spout_prototype_11.castShadow = options.castShadow ?? true;
  mesh_fish_spout_prototype_11.receiveShadow = options.receiveShadow ?? true;
  mesh_fish_spout_prototype_11.userData.sculptComponent = {"id": "fish-spout-prototype", "name": "Stylized Fish Spout Prototype", "level": "meso", "role": "effect-emitter", "importance": 0.95, "confidence": 0.94, "primitive": "sphere", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "tower-system", "attachment": {"parentId": "tower-system", "parentSocket": "spout-ring", "localStart": [0, 0.03, 0.42], "localEnd": [0, 0.03, 0.64], "baseRadius": 0.11, "endRadius": 0.07, "embedDepth": 0.045, "overlap": 0.04, "contactType": "embedded", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.24, "height": 0.2, "depth": 0.3, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.2, 0.57], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "effect-emitter", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterJet_Socket", "localPosition": [0, -0.03, 0.18]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.24, 0.2, 0.3], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fish-spout-prototype", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "teal-ceramic"}}, "material": "teal-ceramic", "materialLayers": ["teal-ceramic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fish-mouth-outlet", "kind": "hole", "diameter": 0.045, "depth": 0.03, "evidenceRefs": ["front-view"]}, {"id": "fish-eye-beads", "kind": "fastener", "count": 2, "radius": 0.018, "evidenceRefs": ["three-quarter-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["fish-mouth-outlet", "fish-eye-beads"], "fidelityTier": "structural"};
  node_fish_spout_prototype_11.add(mesh_fish_spout_prototype_11);
  meshes["fish-spout-prototype"] = mesh_fish_spout_prototype_11;
  colliders["fish-spout-prototype"] = {"type": "none", "offset": [0, 0, 0], "scale": [0.24, 0.2, 0.3], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["fish-spout-prototype"] ??= [];
  destructionGroups["fish-spout-prototype"].push(node_fish_spout_prototype_11);
  const socket_fish_spout_prototype_WaterJet_Socket_0 = new THREE.Object3D();
  socket_fish_spout_prototype_WaterJet_Socket_0.name = "WaterJet_Socket";
  socket_fish_spout_prototype_WaterJet_Socket_0.position.set(0.0, -0.03, 0.18);
  socket_fish_spout_prototype_WaterJet_Socket_0.rotation.set(0, 0, 0);
  socket_fish_spout_prototype_WaterJet_Socket_0.userData.socket = {"id": "WaterJet_Socket", "localPosition": [0, -0.03, 0.18]};
  node_fish_spout_prototype_11.add(socket_fish_spout_prototype_WaterJet_Socket_0);
  sockets["fish-spout-prototype:WaterJet_Socket"] = socket_fish_spout_prototype_WaterJet_Socket_0;

  const attachment_pedestal_cap_12 = {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.62, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_pedestal_cap_12 = makeAttachmentEndpoint(attachment_pedestal_cap_12);
  const node_pedestal_cap_12 = new THREE.Group();
  node_pedestal_cap_12.name = "Octagonal Pedestal Cap__pivot";
  if (endpoint_pedestal_cap_12) {
    node_pedestal_cap_12.position.copy(endpoint_pedestal_cap_12.start);
    node_pedestal_cap_12.rotation.set(0, 0, 0);
    node_pedestal_cap_12.scale.set(1, 1, 1);
  } else {
    node_pedestal_cap_12.position.set(0.0, 1.62, 0.0);
    node_pedestal_cap_12.rotation.set(0.0, 0.0, 0.0);
    node_pedestal_cap_12.scale.set(1.0, 1.0, 1.0);
  }
  node_pedestal_cap_12.userData.sculptComponent = {"id": "pedestal-cap", "name": "Octagonal Pedestal Cap", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "tower-system", "attachment": {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.62, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1, "height": 0.16, "depth": 1, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.62, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 0.16, 1], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-edge-groove", "kind": "groove", "width": 0.02, "depth": 0.01, "evidenceRefs": ["right-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["cap-edge-groove"], "fidelityTier": "structural"};
  node_pedestal_cap_12.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 0.16, 1], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["tower-system"] ?? root).add(node_pedestal_cap_12);
  nodes["pedestal-cap"] = node_pedestal_cap_12;
  const mesh_pedestal_cap_12Geometry = endpoint_pedestal_cap_12
    ? new THREE.CylinderGeometry(endpoint_pedestal_cap_12.endRadius, endpoint_pedestal_cap_12.baseRadius, endpoint_pedestal_cap_12.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_pedestal_cap_12 = new THREE.Mesh(
    mesh_pedestal_cap_12Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pedestal_cap_12.name = "Octagonal Pedestal Cap";
  if (endpoint_pedestal_cap_12) {
    mesh_pedestal_cap_12.position.copy(endpoint_pedestal_cap_12.midpoint);
    mesh_pedestal_cap_12.quaternion.copy(endpoint_pedestal_cap_12.quaternion);
  }
  mesh_pedestal_cap_12.castShadow = options.castShadow ?? true;
  mesh_pedestal_cap_12.receiveShadow = options.receiveShadow ?? true;
  mesh_pedestal_cap_12.userData.sculptComponent = {"id": "pedestal-cap", "name": "Octagonal Pedestal Cap", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "tower-system", "attachment": {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.62, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1, "height": 0.16, "depth": 1, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.62, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 0.16, 1], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pedestal-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-edge-groove", "kind": "groove", "width": 0.02, "depth": 0.01, "evidenceRefs": ["right-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["cap-edge-groove"], "fidelityTier": "structural"};
  node_pedestal_cap_12.add(mesh_pedestal_cap_12);
  meshes["pedestal-cap"] = mesh_pedestal_cap_12;
  colliders["pedestal-cap"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 0.16, 1], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["pedestal-cap"] ??= [];
  destructionGroups["pedestal-cap"].push(node_pedestal_cap_12);

  const attachment_copper_band_lower_13 = {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.82, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_copper_band_lower_13 = makeAttachmentEndpoint(attachment_copper_band_lower_13);
  const node_copper_band_lower_13 = new THREE.Group();
  node_copper_band_lower_13.name = "Lower Copper Accent Band__pivot";
  if (endpoint_copper_band_lower_13) {
    node_copper_band_lower_13.position.copy(endpoint_copper_band_lower_13.start);
    node_copper_band_lower_13.rotation.set(0, 0, 0);
    node_copper_band_lower_13.scale.set(1, 1, 1);
  } else {
    node_copper_band_lower_13.position.set(0.0, 0.82, 0.0);
    node_copper_band_lower_13.rotation.set(0.0, 0.0, 0.0);
    node_copper_band_lower_13.scale.set(1.0, 1.0, 1.0);
  }
  node_copper_band_lower_13.userData.sculptComponent = {"id": "copper-band-lower", "name": "Lower Copper Accent Band", "level": "micro", "role": "static-detail", "importance": 0.8, "confidence": 0.94, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "tower-system", "attachment": {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.82, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.74, "height": 0.08, "depth": 0.74, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.82, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.74, 0.08, 0.74], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "copper-band-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "copper"}}, "material": "copper", "materialLayers": ["copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_copper_band_lower_13.userData.actionProfile = {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.74, 0.08, 0.74], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "copper-band-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "copper"}};
  (nodes["tower-system"] ?? root).add(node_copper_band_lower_13);
  nodes["copper-band-lower"] = node_copper_band_lower_13;
  const mesh_copper_band_lower_13Geometry = endpoint_copper_band_lower_13
    ? new THREE.CylinderGeometry(endpoint_copper_band_lower_13.endRadius, endpoint_copper_band_lower_13.baseRadius, endpoint_copper_band_lower_13.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_copper_band_lower_13 = new THREE.Mesh(
    mesh_copper_band_lower_13Geometry,
    materialMap["copper"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_copper_band_lower_13.name = "Lower Copper Accent Band";
  if (endpoint_copper_band_lower_13) {
    mesh_copper_band_lower_13.position.copy(endpoint_copper_band_lower_13.midpoint);
    mesh_copper_band_lower_13.quaternion.copy(endpoint_copper_band_lower_13.quaternion);
  }
  mesh_copper_band_lower_13.castShadow = options.castShadow ?? true;
  mesh_copper_band_lower_13.receiveShadow = options.receiveShadow ?? true;
  mesh_copper_band_lower_13.userData.sculptComponent = {"id": "copper-band-lower", "name": "Lower Copper Accent Band", "level": "micro", "role": "static-detail", "importance": 0.8, "confidence": 0.94, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "tower-system", "attachment": {"parentId": "tower-system", "parentSocket": "tower-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 0.82, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.74, "height": 0.08, "depth": 0.74, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 0.82, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.74, 0.08, 0.74], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "copper-band-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "copper"}}, "material": "copper", "materialLayers": ["copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_copper_band_lower_13.add(mesh_copper_band_lower_13);
  meshes["copper-band-lower"] = mesh_copper_band_lower_13;
  colliders["copper-band-lower"] = {"type": "none", "offset": [0, 0, 0], "scale": [0.74, 0.08, 0.74], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["copper-band-lower"] ??= [];
  destructionGroups["copper-band-lower"].push(node_copper_band_lower_13);

  const attachment_upper_basin_system_14 = {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.83, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_upper_basin_system_14 = makeAttachmentEndpoint(attachment_upper_basin_system_14);
  const node_upper_basin_system_14 = new THREE.Group();
  node_upper_basin_system_14.name = "Upper Bowl System__pivot";
  if (endpoint_upper_basin_system_14) {
    node_upper_basin_system_14.position.copy(endpoint_upper_basin_system_14.start);
    node_upper_basin_system_14.rotation.set(0, 0, 0);
    node_upper_basin_system_14.scale.set(1, 1, 1);
  } else {
    node_upper_basin_system_14.position.set(0.0, 1.83, 0.0);
    node_upper_basin_system_14.rotation.set(0.0, 0.0, 0.0);
    node_upper_basin_system_14.scale.set(1.0, 1.0, 1.0);
  }
  node_upper_basin_system_14.userData.sculptComponent = {"id": "upper-basin-system", "name": "Upper Bowl System", "level": "macro", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "lathe", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.83, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1.02, "height": 0.42, "depth": 1.02, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.83, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "finial-seat", "localPosition": [0, 0.2, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.02, 0.42, 1.02], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-basin-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_upper_basin_system_14.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "finial-seat", "localPosition": [0, 0.2, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.02, 0.42, 1.02], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-basin-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["root"] ?? root).add(node_upper_basin_system_14);
  nodes["upper-basin-system"] = node_upper_basin_system_14;
  const mesh_upper_basin_system_14Geometry = endpoint_upper_basin_system_14
    ? new THREE.CylinderGeometry(endpoint_upper_basin_system_14.endRadius, endpoint_upper_basin_system_14.baseRadius, endpoint_upper_basin_system_14.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 8, 8, 8);
  const mesh_upper_basin_system_14 = new THREE.Mesh(
    mesh_upper_basin_system_14Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_basin_system_14.name = "Upper Bowl System";
  if (endpoint_upper_basin_system_14) {
    mesh_upper_basin_system_14.position.copy(endpoint_upper_basin_system_14.midpoint);
    mesh_upper_basin_system_14.quaternion.copy(endpoint_upper_basin_system_14.quaternion);
  }
  mesh_upper_basin_system_14.castShadow = options.castShadow ?? true;
  mesh_upper_basin_system_14.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_basin_system_14.userData.sculptComponent = {"id": "upper-basin-system", "name": "Upper Bowl System", "level": "macro", "role": "static-shell", "importance": 1, "confidence": 0.94, "primitive": "lathe", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.83, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1.02, "height": 0.42, "depth": 1.02, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.83, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "finial-seat", "localPosition": [0, 0.2, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.02, 0.42, 1.02], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-basin-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_upper_basin_system_14.add(mesh_upper_basin_system_14);
  meshes["upper-basin-system"] = mesh_upper_basin_system_14;
  colliders["upper-basin-system"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.02, 0.42, 1.02], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["upper-basin-system"] ??= [];
  destructionGroups["upper-basin-system"].push(node_upper_basin_system_14);
  const socket_upper_basin_system_finial_seat_0 = new THREE.Object3D();
  socket_upper_basin_system_finial_seat_0.name = "finial-seat";
  socket_upper_basin_system_finial_seat_0.position.set(0.0, 0.2, 0.0);
  socket_upper_basin_system_finial_seat_0.rotation.set(0, 0, 0);
  socket_upper_basin_system_finial_seat_0.userData.socket = {"id": "finial-seat", "localPosition": [0, 0.2, 0]};
  node_upper_basin_system_14.add(socket_upper_basin_system_finial_seat_0);
  sockets["upper-basin-system:finial-seat"] = socket_upper_basin_system_finial_seat_0;
  // TODO: replace 'upper-basin-system' box fallback with lathe procedural geometry.

  const attachment_upper_bowl_15 = {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.81, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_upper_bowl_15 = makeAttachmentEndpoint(attachment_upper_bowl_15);
  const node_upper_bowl_15 = new THREE.Group();
  node_upper_bowl_15.name = "Upper Stone Bowl__pivot";
  if (endpoint_upper_bowl_15) {
    node_upper_bowl_15.position.copy(endpoint_upper_bowl_15.start);
    node_upper_bowl_15.rotation.set(0, 0, 0);
    node_upper_bowl_15.scale.set(1, 1, 1);
  } else {
    node_upper_bowl_15.position.set(0.0, 1.81, 0.0);
    node_upper_bowl_15.rotation.set(0.0, 0.0, 0.0);
    node_upper_bowl_15.scale.set(1.0, 1.0, 1.0);
  }
  node_upper_bowl_15.userData.sculptComponent = {"id": "upper-bowl", "name": "Upper Stone Bowl", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "lathe", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "upper-basin-system", "attachment": {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.81, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1.02, "height": 0.34, "depth": 1.02, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.81, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.02, 0.34, 1.02], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-bowl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upper-rim-ridge", "kind": "ridge", "height": 0.05, "width": 0.08, "evidenceRefs": ["left-view"]}, {"id": "upper-bowl-flutes", "kind": "groove", "count": 12, "depth": 0.012, "evidenceRefs": ["front-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["upper-rim-ridge", "upper-bowl-flutes"], "fidelityTier": "structural"};
  node_upper_bowl_15.userData.actionProfile = {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.02, 0.34, 1.02], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-bowl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["upper-basin-system"] ?? root).add(node_upper_bowl_15);
  nodes["upper-bowl"] = node_upper_bowl_15;
  const mesh_upper_bowl_15Geometry = endpoint_upper_bowl_15
    ? new THREE.CylinderGeometry(endpoint_upper_bowl_15.endRadius, endpoint_upper_bowl_15.baseRadius, endpoint_upper_bowl_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 8, 8, 8);
  const mesh_upper_bowl_15 = new THREE.Mesh(
    mesh_upper_bowl_15Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_bowl_15.name = "Upper Stone Bowl";
  if (endpoint_upper_bowl_15) {
    mesh_upper_bowl_15.position.copy(endpoint_upper_bowl_15.midpoint);
    mesh_upper_bowl_15.quaternion.copy(endpoint_upper_bowl_15.quaternion);
  }
  mesh_upper_bowl_15.castShadow = options.castShadow ?? true;
  mesh_upper_bowl_15.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_bowl_15.userData.sculptComponent = {"id": "upper-bowl", "name": "Upper Stone Bowl", "level": "meso", "role": "static-shell", "importance": 0.8, "confidence": 0.94, "primitive": "lathe", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "upper-basin-system", "attachment": {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.81, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 1.02, "height": 0.34, "depth": 1.02, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.81, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.02, 0.34, 1.02], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-bowl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upper-rim-ridge", "kind": "ridge", "height": 0.05, "width": 0.08, "evidenceRefs": ["left-view"]}, {"id": "upper-bowl-flutes", "kind": "groove", "count": 12, "depth": 0.012, "evidenceRefs": ["front-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["upper-rim-ridge", "upper-bowl-flutes"], "fidelityTier": "structural"};
  node_upper_bowl_15.add(mesh_upper_bowl_15);
  meshes["upper-bowl"] = mesh_upper_bowl_15;
  colliders["upper-bowl"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1.02, 0.34, 1.02], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["upper-bowl"] ??= [];
  destructionGroups["upper-bowl"].push(node_upper_bowl_15);
  // TODO: replace 'upper-bowl' box fallback with lathe procedural geometry.

  const attachment_upper_water_16 = {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.9, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_upper_water_16 = makeAttachmentEndpoint(attachment_upper_water_16);
  const node_upper_water_16 = new THREE.Group();
  node_upper_water_16.name = "Upper Water Surface__pivot";
  if (endpoint_upper_water_16) {
    node_upper_water_16.position.copy(endpoint_upper_water_16.start);
    node_upper_water_16.rotation.set(0, 0, 0);
    node_upper_water_16.scale.set(1, 1, 1);
  } else {
    node_upper_water_16.position.set(0.0, 1.9, 0.0);
    node_upper_water_16.rotation.set(0.0, 0.0, 0.0);
    node_upper_water_16.scale.set(1.0, 1.0, 1.0);
  }
  node_upper_water_16.userData.sculptComponent = {"id": "upper-water", "name": "Upper Water Surface", "level": "meso", "role": "effect-surface", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "upper-basin-system", "attachment": {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.9, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.76, "height": 0.02, "depth": 0.76, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.9, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "effect-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterUpper_Socket", "localPosition": [0, 0.015, 0]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.76, 0.02, 0.76], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-water", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "water"}}, "material": "water", "materialLayers": ["water"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.08, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_upper_water_16.userData.actionProfile = {"animationRole": "effect-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterUpper_Socket", "localPosition": [0, 0.015, 0]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.76, 0.02, 0.76], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-water", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "water"}};
  (nodes["upper-basin-system"] ?? root).add(node_upper_water_16);
  nodes["upper-water"] = node_upper_water_16;
  const mesh_upper_water_16Geometry = endpoint_upper_water_16
    ? new THREE.CylinderGeometry(endpoint_upper_water_16.endRadius, endpoint_upper_water_16.baseRadius, endpoint_upper_water_16.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_upper_water_16 = new THREE.Mesh(
    mesh_upper_water_16Geometry,
    materialMap["water"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_water_16.name = "Upper Water Surface";
  if (endpoint_upper_water_16) {
    mesh_upper_water_16.position.copy(endpoint_upper_water_16.midpoint);
    mesh_upper_water_16.quaternion.copy(endpoint_upper_water_16.quaternion);
  }
  mesh_upper_water_16.castShadow = options.castShadow ?? true;
  mesh_upper_water_16.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_water_16.userData.sculptComponent = {"id": "upper-water", "name": "Upper Water Surface", "level": "meso", "role": "effect-surface", "importance": 0.8, "confidence": 0.94, "primitive": "cylinder", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "upper-basin-system", "attachment": {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.9, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.76, "height": 0.02, "depth": 0.76, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.9, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "effect-surface", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "WaterUpper_Socket", "localPosition": [0, 0.015, 0]}], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.76, 0.02, 0.76], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-water", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "water"}}, "material": "water", "materialLayers": ["water"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.08, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_upper_water_16.add(mesh_upper_water_16);
  meshes["upper-water"] = mesh_upper_water_16;
  colliders["upper-water"] = {"type": "none", "offset": [0, 0, 0], "scale": [0.76, 0.02, 0.76], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["upper-water"] ??= [];
  destructionGroups["upper-water"].push(node_upper_water_16);
  const socket_upper_water_WaterUpper_Socket_0 = new THREE.Object3D();
  socket_upper_water_WaterUpper_Socket_0.name = "WaterUpper_Socket";
  socket_upper_water_WaterUpper_Socket_0.position.set(0.0, 0.015, 0.0);
  socket_upper_water_WaterUpper_Socket_0.rotation.set(0, 0, 0);
  socket_upper_water_WaterUpper_Socket_0.userData.socket = {"id": "WaterUpper_Socket", "localPosition": [0, 0.015, 0]};
  node_upper_water_16.add(socket_upper_water_WaterUpper_Socket_0);
  sockets["upper-water:WaterUpper_Socket"] = socket_upper_water_WaterUpper_Socket_0;

  const attachment_copper_band_upper_17 = {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.63, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]};
  const endpoint_copper_band_upper_17 = makeAttachmentEndpoint(attachment_copper_band_upper_17);
  const node_copper_band_upper_17 = new THREE.Group();
  node_copper_band_upper_17.name = "Upper Copper Accent Band__pivot";
  if (endpoint_copper_band_upper_17) {
    node_copper_band_upper_17.position.copy(endpoint_copper_band_upper_17.start);
    node_copper_band_upper_17.rotation.set(0, 0, 0);
    node_copper_band_upper_17.scale.set(1, 1, 1);
  } else {
    node_copper_band_upper_17.position.set(0.0, 1.63, 0.0);
    node_copper_band_upper_17.rotation.set(0.0, 0.0, 0.0);
    node_copper_band_upper_17.scale.set(1.0, 1.0, 1.0);
  }
  node_copper_band_upper_17.userData.sculptComponent = {"id": "copper-band-upper", "name": "Upper Copper Accent Band", "level": "micro", "role": "static-detail", "importance": 0.8, "confidence": 0.94, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "upper-basin-system", "attachment": {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.63, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.58, "height": 0.08, "depth": 0.58, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.63, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.58, 0.08, 0.58], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "copper-band-upper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "copper"}}, "material": "copper", "materialLayers": ["copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_copper_band_upper_17.userData.actionProfile = {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.58, 0.08, 0.58], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "copper-band-upper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "copper"}};
  (nodes["upper-basin-system"] ?? root).add(node_copper_band_upper_17);
  nodes["copper-band-upper"] = node_copper_band_upper_17;
  const mesh_copper_band_upper_17Geometry = endpoint_copper_band_upper_17
    ? new THREE.CylinderGeometry(endpoint_copper_band_upper_17.endRadius, endpoint_copper_band_upper_17.baseRadius, endpoint_copper_band_upper_17.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_copper_band_upper_17 = new THREE.Mesh(
    mesh_copper_band_upper_17Geometry,
    materialMap["copper"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_copper_band_upper_17.name = "Upper Copper Accent Band";
  if (endpoint_copper_band_upper_17) {
    mesh_copper_band_upper_17.position.copy(endpoint_copper_band_upper_17.midpoint);
    mesh_copper_band_upper_17.quaternion.copy(endpoint_copper_band_upper_17.quaternion);
  }
  mesh_copper_band_upper_17.castShadow = options.castShadow ?? true;
  mesh_copper_band_upper_17.receiveShadow = options.receiveShadow ?? true;
  mesh_copper_band_upper_17.userData.sculptComponent = {"id": "copper-band-upper", "name": "Upper Copper Accent Band", "level": "micro", "role": "static-detail", "importance": 0.8, "confidence": 0.94, "primitive": "torus", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "upper-basin-system", "attachment": {"parentId": "upper-basin-system", "parentSocket": "upper-basin-system-surface", "localStart": [0, 0, 0], "localEnd": [0, 1.63, 0], "baseRadius": 0.08, "endRadius": 0.08, "embedDepth": 0.015, "overlap": 0.015, "contactType": "overlap", "gapTolerance": 0.01, "evidenceRefs": ["three-quarter-view"]}, "dimensions": {"width": 0.58, "height": 0.08, "depth": 0.58, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 1.63, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-detail", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [0.58, 0.08, 0.58], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "copper-band-upper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "copper"}}, "material": "copper", "materialLayers": ["copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.08, "bumpAmplitude": 0.003, "normalPattern": "independent fine surface field", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": [], "fidelityTier": "structural"};
  node_copper_band_upper_17.add(mesh_copper_band_upper_17);
  meshes["copper-band-upper"] = mesh_copper_band_upper_17;
  colliders["copper-band-upper"] = {"type": "none", "offset": [0, 0, 0], "scale": [0.58, 0.08, 0.58], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["copper-band-upper"] ??= [];
  destructionGroups["copper-band-upper"].push(node_copper_band_upper_17);

  const attachment_finial_18 = {"parentId": "upper-basin-system", "parentSocket": "finial-seat", "localStart": [0, 0.2, 0], "localEnd": [0, 0.59, 0], "baseRadius": 0.13, "endRadius": 0.04, "embedDepth": 0.025, "overlap": 0.02, "contactType": "socket", "gapTolerance": 0.01, "evidenceRefs": ["front-view"]};
  const endpoint_finial_18 = makeAttachmentEndpoint(attachment_finial_18);
  const node_finial_18 = new THREE.Group();
  node_finial_18.name = "Acorn Finial__pivot";
  if (endpoint_finial_18) {
    node_finial_18.position.copy(endpoint_finial_18.start);
    node_finial_18.rotation.set(0, 0, 0);
    node_finial_18.scale.set(1, 1, 1);
  } else {
    node_finial_18.position.set(0.0, 2.09, 0.0);
    node_finial_18.rotation.set(0.0, 0.0, 0.0);
    node_finial_18.scale.set(1.0, 1.0, 1.0);
  }
  node_finial_18.userData.sculptComponent = {"id": "finial", "name": "Acorn Finial", "level": "meso", "role": "detachable-ornament", "importance": 0.88, "confidence": 0.94, "primitive": "lathe", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "upper-basin-system", "attachment": {"parentId": "upper-basin-system", "parentSocket": "finial-seat", "localStart": [0, 0.2, 0], "localEnd": [0, 0.59, 0], "baseRadius": 0.13, "endRadius": 0.04, "embedDepth": 0.025, "overlap": 0.02, "contactType": "socket", "gapTolerance": 0.01, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.34, "height": 0.42, "depth": 0.34, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 2.09, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detachable-ornament", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [0.34, 0.42, 0.34], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finial", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "finial-flutes", "kind": "ridge", "count": 8, "height": 0.012, "evidenceRefs": ["three-quarter-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["finial-flutes"], "fidelityTier": "structural"};
  node_finial_18.userData.actionProfile = {"animationRole": "detachable-ornament", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [0.34, 0.42, 0.34], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finial", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}};
  (nodes["upper-basin-system"] ?? root).add(node_finial_18);
  nodes["finial"] = node_finial_18;
  const mesh_finial_18Geometry = endpoint_finial_18
    ? new THREE.CylinderGeometry(endpoint_finial_18.endRadius, endpoint_finial_18.baseRadius, endpoint_finial_18.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 8, 8, 8);
  const mesh_finial_18 = new THREE.Mesh(
    mesh_finial_18Geometry,
    materialMap["limestone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_finial_18.name = "Acorn Finial";
  if (endpoint_finial_18) {
    mesh_finial_18.position.copy(endpoint_finial_18.midpoint);
    mesh_finial_18.quaternion.copy(endpoint_finial_18.quaternion);
  }
  mesh_finial_18.castShadow = options.castShadow ?? true;
  mesh_finial_18.receiveShadow = options.receiveShadow ?? true;
  mesh_finial_18.userData.sculptComponent = {"id": "finial", "name": "Acorn Finial", "level": "meso", "role": "detachable-ornament", "importance": 0.88, "confidence": 0.94, "primitive": "lathe", "geometryDescriptor": {"topologyIntent": "stylized low-poly real-time hard-surface geometry with silhouette-safe bevels", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 2}, "deformationStack": [], "uvStrategy": "generated cylindrical/planar coordinates with stable object-scale texel density", "normalStrategy": "weighted vertex normals plus independent tangent-space micro normal"}, "parent": "upper-basin-system", "attachment": {"parentId": "upper-basin-system", "parentSocket": "finial-seat", "localStart": [0, 0.2, 0], "localEnd": [0, 0.59, 0], "baseRadius": 0.13, "endRadius": 0.04, "embedDepth": 0.025, "overlap": 0.02, "contactType": "socket", "gapTolerance": 0.01, "evidenceRefs": ["front-view"]}, "dimensions": {"width": 0.34, "height": 0.42, "depth": 0.34, "units": "meters", "confidence": 0.94}, "transform": {"position": [0, 2.09, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detachable-ornament", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [0.34, 0.42, 0.34], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "finial", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "limestone"}}, "material": "limestone", "materialLayers": ["limestone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "finial-flutes", "kind": "ridge", "count": 8, "height": 0.012, "evidenceRefs": ["three-quarter-view"]}], "surfaceDetail": {"macroRoughness": 0.14, "microRoughness": 0.18, "bumpAmplitude": 0.012, "normalPattern": "independent multi-frequency limestone pores", "displacementPattern": "none", "occlusionPattern": "cavity-biased at stacked contacts and grooves", "edgeWearPattern": "subtle lower-roughness bevel crests", "notes": "Surface response remains subtle enough for the clean mobile-game style."}, "evidenceRefs": ["front-view", "three-quarter-view"], "details": ["finial-flutes"], "fidelityTier": "structural"};
  node_finial_18.add(mesh_finial_18);
  meshes["finial"] = mesh_finial_18;
  colliders["finial"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [0.34, 0.42, 0.34], "isTrigger": false, "notes": "Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider."};
  destructionGroups["finial"] ??= [];
  destructionGroups["finial"].push(node_finial_18);
  // TODO: replace 'finial' box fallback with lathe procedural geometry.

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced mobile-game fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createStylizedTieredPlazaFountainLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Stylized Tiered Plaza Fountain look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Key light: large warm area/directional light from camera-left and above, approximately 4800 K, intensity 3.0, soft shadow radius.", "Fill light: cool neutral hemisphere or large area fill from camera-right, intensity 0.75.", "Rim/environment: soft teal-neutral rear-right rim and low-contrast studio environment reflection.", "Output: ACES Filmic tone mapping, exposure +0.2, light gray background, soft contact shadow and ambient occlusion beneath the octagonal base."];
  lights.userData.lookDevTargets = {"qualityPriority": "balanced mobile-game fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}
