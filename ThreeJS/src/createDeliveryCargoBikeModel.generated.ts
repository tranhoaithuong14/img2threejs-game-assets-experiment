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

// Generated from ObjectSculptSpec target: Delivery Cargo Bike
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createDeliveryCargoBikeModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Delivery Cargo Bike";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["teal-paint"] = createSculptMaterial(
    "teal-paint",
    {"id": "teal-paint", "name": "Satin Teal Powder Coat", "type": "physical", "shaderModel": "MeshPhysicalMaterial / Unity Lit PBR", "baseColor": "#1FA899", "albedo": {"dominant": "#1FA899", "secondary": ["#178E84", "#43C2B3"], "samplingNotes": "Frame and cargo shell sampled from neutral six-view sheet."}, "colorVariation": {"palette": ["#178E84", "#1FA899", "#43C2B3"], "pattern": "very subtle object-space mottling", "amplitude": 0.04, "heightCorrelation": 0.1}, "textureResolution": 1024, "textureProjection": {"mode": "object-space triplanar", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "stable 512 px per meter"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.05, "role": "panel value separation"}, {"id": "meso", "frequency": 14, "amplitude": 0.025, "role": "powder-coat orange peel"}, {"id": "micro", "frequency": 64, "amplitude": 0.01, "role": "highlight breakup"}], "roughness": {"base": 0.34, "variation": 0.06, "map": "independent procedural roughness"}, "metalness": {"base": 0.08, "variation": 0}, "normal": {"pattern": "powder-coat micro normal", "strength": 0.08, "scale": 64}, "ambientOcclusion": {"cavityStrength": 0.18, "contactShadowBias": 0.25}, "wear": {"edgeWear": 0.035, "scratches": [], "chips": []}, "dirt": {"amount": 0.015, "cavityBias": 0.4, "color": "#123D39"}, "localOverrides": [{"id": "lid-edge-highlight", "region": "cargo lid bevel", "roughness": 0.26, "evidenceRef": "three-quarter-view"}], "shaderNotes": ["Use low clearcoat around 0.18; keep paint stylized and clean."]},
    options
  );
  materialMap["black-polymer"] = createSculptMaterial(
    "black-polymer",
    {"id": "black-polymer", "name": "Charcoal Polymer and Painted Steel", "type": "standard", "shaderModel": "MeshStandardMaterial / Unity Lit PBR", "baseColor": "#1D2426", "albedo": {"dominant": "#1D2426", "secondary": ["#101516", "#30383A"]}, "colorVariation": {"palette": ["#101516", "#1D2426", "#30383A"], "pattern": "subtle part variation", "amplitude": 0.04}, "textureResolution": 512, "textureProjection": {"mode": "object-space", "repeat": [2, 2], "anisotropy": 4, "texelDensityIntent": "stable across frame parts"}, "roughness": {"base": 0.48, "variation": 0.08, "map": "independent procedural roughness"}, "metalness": {"base": 0.12, "variation": 0.12}, "normal": {"pattern": "fine polymer grain", "strength": 0.06, "scale": 48}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32}, "wear": {"edgeWear": 0.025, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.55, "color": "#090B0C"}, "localOverrides": []},
    options
  );
  materialMap["rubber"] = createSculptMaterial(
    "rubber",
    {"id": "rubber", "name": "Matte Tire Rubber", "type": "standard", "shaderModel": "MeshStandardMaterial / Unity Lit PBR", "baseColor": "#171A19", "albedo": {"dominant": "#171A19", "secondary": ["#0C0F0E", "#2A2E2C"]}, "colorVariation": {"palette": ["#0C0F0E", "#171A19", "#2A2E2C"], "pattern": "tread directional", "amplitude": 0.05}, "textureResolution": 1024, "textureProjection": {"mode": "toroidal", "repeat": [4, 1], "anisotropy": 8, "texelDensityIntent": "one tread cycle per 15 degrees"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.04, "role": "sidewall variation"}, {"id": "meso", "frequency": 24, "amplitude": 0.12, "role": "tread blocks"}, {"id": "micro", "frequency": 72, "amplitude": 0.025, "role": "rubber grain"}], "roughness": {"base": 0.78, "variation": 0.08, "map": "independent tread roughness"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "directional tread normal", "strength": 0.32, "scale": 24}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.4}, "wear": {"edgeWear": 0.04, "scratches": [], "chips": []}, "dirt": {"amount": 0.035, "cavityBias": 0.65, "color": "#272622"}, "localOverrides": []},
    options
  );
  materialMap["cream"] = createSculptMaterial(
    "cream",
    {"id": "cream", "name": "Warm Cream Rims Seat and Grips", "type": "physical", "shaderModel": "MeshPhysicalMaterial / Unity Lit PBR", "baseColor": "#F1D7A7", "albedo": {"dominant": "#F1D7A7", "secondary": ["#D9BB86", "#FFF0CA"]}, "colorVariation": {"palette": ["#D9BB86", "#F1D7A7", "#FFF0CA"], "pattern": "clean manufactured parts", "amplitude": 0.025}, "textureResolution": 512, "textureProjection": {"mode": "object-space", "repeat": [1, 1], "anisotropy": 4, "texelDensityIntent": "clean solid color"}, "roughness": {"base": 0.31, "variation": 0.05, "map": "independent procedural roughness"}, "metalness": {"base": 0.02, "variation": 0}, "normal": {"pattern": "fine vinyl grain", "strength": 0.04, "scale": 58}, "ambientOcclusion": {"cavityStrength": 0.14, "contactShadowBias": 0.25}, "wear": {"edgeWear": 0.015, "scratches": [], "chips": []}, "dirt": {"amount": 0.01, "cavityBias": 0.3, "color": "#8B744E"}, "localOverrides": [{"id": "rim-gloss-band", "region": "both wheel rims", "roughness": 0.2, "clearcoat": 0.25, "evidenceRef": "left-view"}]},
    options
  );
  materialMap["orange"] = createSculptMaterial(
    "orange",
    {"id": "orange", "name": "Safety Orange Accents", "type": "physical", "shaderModel": "MeshPhysicalMaterial / Unity Lit PBR", "baseColor": "#F27A32", "albedo": {"dominant": "#F27A32", "secondary": ["#D95624", "#FF9B43"]}, "colorVariation": {"palette": ["#D95624", "#F27A32", "#FF9B43"], "pattern": "solid accent", "amplitude": 0.02}, "textureResolution": 256, "textureProjection": {"mode": "object-space", "repeat": [1, 1], "anisotropy": 4, "texelDensityIntent": "solid micro parts"}, "roughness": {"base": 0.28, "variation": 0.04, "map": "independent procedural roughness"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "smooth molded accent", "strength": 0.02, "scale": 32}, "ambientOcclusion": {"cavityStrength": 0.12, "contactShadowBias": 0.2}, "wear": {"edgeWear": 0.01, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#6D2A19"}, "localOverrides": [{"id": "cargo-corner-guards", "region": "eight cargo corners", "roughness": 0.24, "evidenceRef": "rear-view"}, {"id": "reflector-emissive", "region": "wheel and fork reflectors", "roughness": 0.18, "emissive": "#FF8A32", "emissiveIntensity": 0.35, "evidenceRef": "right-view"}]},
    options
  );
  materialMap["lens"] = createSculptMaterial(
    "lens",
    {"id": "lens", "name": "Headlight and Tail Lens", "type": "physical", "shaderModel": "MeshPhysicalMaterial / Unity Lit transparent", "baseColor": "#E8FBFF", "albedo": {"dominant": "#E8FBFF", "secondary": ["#BBDDE0", "#FFFFFF"]}, "colorVariation": {"palette": ["#BBDDE0", "#E8FBFF", "#FFFFFF"], "pattern": "concentric lens rings", "amplitude": 0.03}, "textureResolution": 512, "textureProjection": {"mode": "planar", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "front lens only"}, "roughness": {"base": 0.08, "variation": 0.02, "map": "independent smooth lens roughness"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "concentric lens micro rings", "strength": 0.06, "scale": 40}, "ambientOcclusion": {"cavityStrength": 0.08, "contactShadowBias": 0.1}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#8EA8AA"}, "localOverrides": [{"id": "headlight-gloss", "region": "front lens", "roughness": 0.04, "clearcoat": 0.8, "evidenceRef": "front-view"}]},
    options
  );
  materialMap["metal"] = createSculptMaterial(
    "metal",
    {"id": "metal", "name": "Brushed Hub and Fork Metal", "type": "standard", "shaderModel": "MeshStandardMaterial / Unity Lit PBR", "baseColor": "#8C9694", "albedo": {"dominant": "#8C9694", "secondary": ["#66706F", "#B5C0BD"]}, "colorVariation": {"palette": ["#66706F", "#8C9694", "#B5C0BD"], "pattern": "axial brush", "amplitude": 0.05}, "textureResolution": 512, "textureProjection": {"mode": "cylindrical", "repeat": [3, 1], "anisotropy": 8, "texelDensityIntent": "aligned to fork and hubs"}, "roughness": {"base": 0.24, "variation": 0.07, "map": "independent brushed roughness"}, "metalness": {"base": 0.82, "variation": 0.08}, "normal": {"pattern": "axial brushed lines", "strength": 0.05, "scale": 64}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "wear": {"edgeWear": 0.02, "scratches": [], "chips": []}, "dirt": {"amount": 0.01, "cavityBias": 0.25, "color": "#303635"}, "localOverrides": []},
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
  node_root_0.name = "Delivery Cargo Bike Root__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
    node_root_0.scale.set(1.0, 1.0, 1.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Delivery Cargo Bike Root", "level": "macro", "role": "root", "importance": 1.0, "confidence": 0.99, "primitive": "box", "parent": null, "dimensions": {"width": 0.01, "height": 0.01, "depth": 0.01, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "hidden hierarchy root", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "none", "normalStrategy": "none"}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "ground-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 1.0}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "visibility": true, "materialState": true}, "sockets": [{"id": "rider-seat", "localPosition": [0, 1.08, -0.2]}, {"id": "cargo-mount", "localPosition": [0, 0.82, -0.78]}], "collider": {"type": "compound", "offset": [0, 0.62, 0], "scale": [0.68, 1.24, 2.05], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["left-view", "three-quarter-view"], "fidelityTier": "blockout"};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "ground-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 1.0}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "visibility": true, "materialState": true}, "sockets": [{"id": "rider-seat", "localPosition": [0, 1.08, -0.2]}, {"id": "cargo-mount", "localPosition": [0, 0.82, -0.78]}], "collider": {"type": "compound", "offset": [0, 0.62, 0], "scale": [0.68, 1.24, 2.05], "isTrigger": false}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["black-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Delivery Cargo Bike Root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Delivery Cargo Bike Root", "level": "macro", "role": "root", "importance": 1.0, "confidence": 0.99, "primitive": "box", "parent": null, "dimensions": {"width": 0.01, "height": 0.01, "depth": 0.01, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "hidden hierarchy root", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "none", "normalStrategy": "none"}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "ground-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 1.0}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "visibility": true, "materialState": true}, "sockets": [{"id": "rider-seat", "localPosition": [0, 1.08, -0.2]}, {"id": "cargo-mount", "localPosition": [0, 0.82, -0.78]}], "collider": {"type": "compound", "offset": [0, 0.62, 0], "scale": [0.68, 1.24, 2.05], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["left-view", "three-quarter-view"], "fidelityTier": "blockout"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "compound", "offset": [0, 0.62, 0], "scale": [0.68, 1.24, 2.05], "isTrigger": false};
  const socket_root_rider_seat_0 = new THREE.Object3D();
  socket_root_rider_seat_0.name = "rider-seat";
  socket_root_rider_seat_0.position.set(0.0, 1.08, -0.2);
  socket_root_rider_seat_0.rotation.set(0, 0, 0);
  socket_root_rider_seat_0.userData.socket = {"id": "rider-seat", "localPosition": [0, 1.08, -0.2]};
  node_root_0.add(socket_root_rider_seat_0);
  sockets["root:rider-seat"] = socket_root_rider_seat_0;
  const socket_root_cargo_mount_1 = new THREE.Object3D();
  socket_root_cargo_mount_1.name = "cargo-mount";
  socket_root_cargo_mount_1.position.set(0.0, 0.82, -0.78);
  socket_root_cargo_mount_1.rotation.set(0, 0, 0);
  socket_root_cargo_mount_1.userData.socket = {"id": "cargo-mount", "localPosition": [0, 0.82, -0.78]};
  node_root_0.add(socket_root_cargo_mount_1);
  sockets["root:cargo-mount"] = socket_root_cargo_mount_1;

  const attachment_chassis_1 = null;
  const endpoint_chassis_1 = makeAttachmentEndpoint(attachment_chassis_1);
  const node_chassis_1 = new THREE.Group();
  node_chassis_1.name = "Chassis Mass__pivot";
  if (endpoint_chassis_1) {
    node_chassis_1.position.copy(endpoint_chassis_1.start);
    node_chassis_1.rotation.set(0, 0, 0);
    node_chassis_1.scale.set(1, 1, 1);
  } else {
    node_chassis_1.position.set(0.0, 0.57, 0.0);
    node_chassis_1.rotation.set(0.0, 0.0, 0.0);
    node_chassis_1.scale.set(1.0, 1.0, 1.0);
  }
  node_chassis_1.userData.sculptComponent = {"id": "chassis", "name": "Chassis Mass", "level": "macro", "role": "chassis", "importance": 1.0, "confidence": 0.98, "primitive": "box", "parent": "root", "dimensions": {"width": 0.2, "height": 0.42, "depth": 1.58, "units": "m", "confidence": 0.9}, "transform": {"position": [0, 0.57, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "rounded step-through bicycle chassis blockout", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.04, "segments": 3}, "deformationStack": ["U-shaped center clearance"], "uvStrategy": "object-space", "normalStrategy": "weighted vertex normals"}, "actionProfile": {"animationRole": "static-chassis", "pivot": {"mode": "ground-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "steering-head", "localPosition": [0, 0.75, 0.78]}, {"id": "saddle-post", "localPosition": [0, 0.7, -0.32]}, {"id": "battery-mount", "localPosition": [0, 0.55, -0.28]}, {"id": "crank-axis", "localPosition": [0, 0.38, -0.18]}, {"id": "rack-root", "localPosition": [0, 0.74, -0.78]}], "collider": {"type": "box", "offset": [0, 0.53, 0], "scale": [0.22, 0.46, 1.45], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint"], "deformations": ["step-through sweep"], "joints": ["steering-head"], "seams": [], "localFeatures": [], "evidenceRefs": ["left-view", "right-view"], "fidelityTier": "blockout"};
  node_chassis_1.userData.actionProfile = {"animationRole": "static-chassis", "pivot": {"mode": "ground-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "steering-head", "localPosition": [0, 0.75, 0.78]}, {"id": "saddle-post", "localPosition": [0, 0.7, -0.32]}, {"id": "battery-mount", "localPosition": [0, 0.55, -0.28]}, {"id": "crank-axis", "localPosition": [0, 0.38, -0.18]}, {"id": "rack-root", "localPosition": [0, 0.74, -0.78]}], "collider": {"type": "box", "offset": [0, 0.53, 0], "scale": [0.22, 0.46, 1.45], "isTrigger": false}};
  (nodes["root"] ?? root).add(node_chassis_1);
  nodes["chassis"] = node_chassis_1;
  const mesh_chassis_1Geometry = endpoint_chassis_1
    ? new THREE.CylinderGeometry(endpoint_chassis_1.endRadius, endpoint_chassis_1.baseRadius, endpoint_chassis_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_chassis_1 = new THREE.Mesh(
    mesh_chassis_1Geometry,
    materialMap["teal-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chassis_1.name = "Chassis Mass";
  if (endpoint_chassis_1) {
    mesh_chassis_1.position.copy(endpoint_chassis_1.midpoint);
    mesh_chassis_1.quaternion.copy(endpoint_chassis_1.quaternion);
  }
  mesh_chassis_1.castShadow = options.castShadow ?? true;
  mesh_chassis_1.receiveShadow = options.receiveShadow ?? true;
  mesh_chassis_1.userData.sculptComponent = {"id": "chassis", "name": "Chassis Mass", "level": "macro", "role": "chassis", "importance": 1.0, "confidence": 0.98, "primitive": "box", "parent": "root", "dimensions": {"width": 0.2, "height": 0.42, "depth": 1.58, "units": "m", "confidence": 0.9}, "transform": {"position": [0, 0.57, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "rounded step-through bicycle chassis blockout", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.04, "segments": 3}, "deformationStack": ["U-shaped center clearance"], "uvStrategy": "object-space", "normalStrategy": "weighted vertex normals"}, "actionProfile": {"animationRole": "static-chassis", "pivot": {"mode": "ground-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "steering-head", "localPosition": [0, 0.75, 0.78]}, {"id": "saddle-post", "localPosition": [0, 0.7, -0.32]}, {"id": "battery-mount", "localPosition": [0, 0.55, -0.28]}, {"id": "crank-axis", "localPosition": [0, 0.38, -0.18]}, {"id": "rack-root", "localPosition": [0, 0.74, -0.78]}], "collider": {"type": "box", "offset": [0, 0.53, 0], "scale": [0.22, 0.46, 1.45], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint"], "deformations": ["step-through sweep"], "joints": ["steering-head"], "seams": [], "localFeatures": [], "evidenceRefs": ["left-view", "right-view"], "fidelityTier": "blockout"};
  node_chassis_1.add(mesh_chassis_1);
  meshes["chassis"] = mesh_chassis_1;
  colliders["chassis"] = {"type": "box", "offset": [0, 0.53, 0], "scale": [0.22, 0.46, 1.45], "isTrigger": false};
  const socket_chassis_steering_head_0 = new THREE.Object3D();
  socket_chassis_steering_head_0.name = "steering-head";
  socket_chassis_steering_head_0.position.set(0.0, 0.75, 0.78);
  socket_chassis_steering_head_0.rotation.set(0, 0, 0);
  socket_chassis_steering_head_0.userData.socket = {"id": "steering-head", "localPosition": [0, 0.75, 0.78]};
  node_chassis_1.add(socket_chassis_steering_head_0);
  sockets["chassis:steering-head"] = socket_chassis_steering_head_0;
  const socket_chassis_saddle_post_1 = new THREE.Object3D();
  socket_chassis_saddle_post_1.name = "saddle-post";
  socket_chassis_saddle_post_1.position.set(0.0, 0.7, -0.32);
  socket_chassis_saddle_post_1.rotation.set(0, 0, 0);
  socket_chassis_saddle_post_1.userData.socket = {"id": "saddle-post", "localPosition": [0, 0.7, -0.32]};
  node_chassis_1.add(socket_chassis_saddle_post_1);
  sockets["chassis:saddle-post"] = socket_chassis_saddle_post_1;
  const socket_chassis_battery_mount_2 = new THREE.Object3D();
  socket_chassis_battery_mount_2.name = "battery-mount";
  socket_chassis_battery_mount_2.position.set(0.0, 0.55, -0.28);
  socket_chassis_battery_mount_2.rotation.set(0, 0, 0);
  socket_chassis_battery_mount_2.userData.socket = {"id": "battery-mount", "localPosition": [0, 0.55, -0.28]};
  node_chassis_1.add(socket_chassis_battery_mount_2);
  sockets["chassis:battery-mount"] = socket_chassis_battery_mount_2;
  const socket_chassis_crank_axis_3 = new THREE.Object3D();
  socket_chassis_crank_axis_3.name = "crank-axis";
  socket_chassis_crank_axis_3.position.set(0.0, 0.38, -0.18);
  socket_chassis_crank_axis_3.rotation.set(0, 0, 0);
  socket_chassis_crank_axis_3.userData.socket = {"id": "crank-axis", "localPosition": [0, 0.38, -0.18]};
  node_chassis_1.add(socket_chassis_crank_axis_3);
  sockets["chassis:crank-axis"] = socket_chassis_crank_axis_3;
  const socket_chassis_rack_root_4 = new THREE.Object3D();
  socket_chassis_rack_root_4.name = "rack-root";
  socket_chassis_rack_root_4.position.set(0.0, 0.74, -0.78);
  socket_chassis_rack_root_4.rotation.set(0, 0, 0);
  socket_chassis_rack_root_4.userData.socket = {"id": "rack-root", "localPosition": [0, 0.74, -0.78]};
  node_chassis_1.add(socket_chassis_rack_root_4);
  sockets["chassis:rack-root"] = socket_chassis_rack_root_4;

  const attachment_wheel_system_2 = null;
  const endpoint_wheel_system_2 = makeAttachmentEndpoint(attachment_wheel_system_2);
  const node_wheel_system_2 = new THREE.Group();
  node_wheel_system_2.name = "Twin Wheel Envelope__pivot";
  if (endpoint_wheel_system_2) {
    node_wheel_system_2.position.copy(endpoint_wheel_system_2.start);
    node_wheel_system_2.rotation.set(0, 0, 0);
    node_wheel_system_2.scale.set(1, 1, 1);
  } else {
    node_wheel_system_2.position.set(0.0, 0.35, 0.0);
    node_wheel_system_2.rotation.set(0.0, 0.0, 0.0);
    node_wheel_system_2.scale.set(1.0, 1.0, 1.0);
  }
  node_wheel_system_2.userData.sculptComponent = {"id": "wheel-system", "name": "Twin Wheel Envelope", "level": "macro", "role": "wheel-assembly", "importance": 1.0, "confidence": 0.99, "primitive": "box", "parent": "root", "dimensions": {"width": 0.1, "height": 0.7, "depth": 2.0, "units": "m", "confidence": 0.95}, "transform": {"position": [0, 0.35, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "two equal radial low-poly wheel assemblies", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.01, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical", "normalStrategy": "smooth radial normals"}, "actionProfile": {"animationRole": "wheel-parent", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-hub", "localPosition": [0, 0, 0.92]}, {"id": "rear-hub", "localPosition": [0, 0, -0.92]}], "collider": {"type": "compound-cylinders", "offset": [0, 0, 0], "scale": [0.68, 0.68, 2.0], "isTrigger": false}}, "material": "rubber", "materialLayers": ["rubber", "cream", "black-polymer"], "deformations": [], "joints": ["front-hub", "rear-hub"], "seams": [], "localFeatures": [], "evidenceRefs": ["left-view", "front-view"], "fidelityTier": "blockout"};
  node_wheel_system_2.userData.actionProfile = {"animationRole": "wheel-parent", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-hub", "localPosition": [0, 0, 0.92]}, {"id": "rear-hub", "localPosition": [0, 0, -0.92]}], "collider": {"type": "compound-cylinders", "offset": [0, 0, 0], "scale": [0.68, 0.68, 2.0], "isTrigger": false}};
  (nodes["root"] ?? root).add(node_wheel_system_2);
  nodes["wheel-system"] = node_wheel_system_2;
  const mesh_wheel_system_2Geometry = endpoint_wheel_system_2
    ? new THREE.CylinderGeometry(endpoint_wheel_system_2.endRadius, endpoint_wheel_system_2.baseRadius, endpoint_wheel_system_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_wheel_system_2 = new THREE.Mesh(
    mesh_wheel_system_2Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_system_2.name = "Twin Wheel Envelope";
  if (endpoint_wheel_system_2) {
    mesh_wheel_system_2.position.copy(endpoint_wheel_system_2.midpoint);
    mesh_wheel_system_2.quaternion.copy(endpoint_wheel_system_2.quaternion);
  }
  mesh_wheel_system_2.castShadow = options.castShadow ?? true;
  mesh_wheel_system_2.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_system_2.userData.sculptComponent = {"id": "wheel-system", "name": "Twin Wheel Envelope", "level": "macro", "role": "wheel-assembly", "importance": 1.0, "confidence": 0.99, "primitive": "box", "parent": "root", "dimensions": {"width": 0.1, "height": 0.7, "depth": 2.0, "units": "m", "confidence": 0.95}, "transform": {"position": [0, 0.35, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "two equal radial low-poly wheel assemblies", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.01, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical", "normalStrategy": "smooth radial normals"}, "actionProfile": {"animationRole": "wheel-parent", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-hub", "localPosition": [0, 0, 0.92]}, {"id": "rear-hub", "localPosition": [0, 0, -0.92]}], "collider": {"type": "compound-cylinders", "offset": [0, 0, 0], "scale": [0.68, 0.68, 2.0], "isTrigger": false}}, "material": "rubber", "materialLayers": ["rubber", "cream", "black-polymer"], "deformations": [], "joints": ["front-hub", "rear-hub"], "seams": [], "localFeatures": [], "evidenceRefs": ["left-view", "front-view"], "fidelityTier": "blockout"};
  node_wheel_system_2.add(mesh_wheel_system_2);
  meshes["wheel-system"] = mesh_wheel_system_2;
  colliders["wheel-system"] = {"type": "compound-cylinders", "offset": [0, 0, 0], "scale": [0.68, 0.68, 2.0], "isTrigger": false};
  const socket_wheel_system_front_hub_0 = new THREE.Object3D();
  socket_wheel_system_front_hub_0.name = "front-hub";
  socket_wheel_system_front_hub_0.position.set(0.0, 0.0, 0.92);
  socket_wheel_system_front_hub_0.rotation.set(0, 0, 0);
  socket_wheel_system_front_hub_0.userData.socket = {"id": "front-hub", "localPosition": [0, 0, 0.92]};
  node_wheel_system_2.add(socket_wheel_system_front_hub_0);
  sockets["wheel-system:front-hub"] = socket_wheel_system_front_hub_0;
  const socket_wheel_system_rear_hub_1 = new THREE.Object3D();
  socket_wheel_system_rear_hub_1.name = "rear-hub";
  socket_wheel_system_rear_hub_1.position.set(0.0, 0.0, -0.92);
  socket_wheel_system_rear_hub_1.rotation.set(0, 0, 0);
  socket_wheel_system_rear_hub_1.userData.socket = {"id": "rear-hub", "localPosition": [0, 0, -0.92]};
  node_wheel_system_2.add(socket_wheel_system_rear_hub_1);
  sockets["wheel-system:rear-hub"] = socket_wheel_system_rear_hub_1;

  const attachment_cargo_system_3 = null;
  const endpoint_cargo_system_3 = makeAttachmentEndpoint(attachment_cargo_system_3);
  const node_cargo_system_3 = new THREE.Group();
  node_cargo_system_3.name = "Rear Cargo Envelope__pivot";
  if (endpoint_cargo_system_3) {
    node_cargo_system_3.position.copy(endpoint_cargo_system_3.start);
    node_cargo_system_3.rotation.set(0, 0, 0);
    node_cargo_system_3.scale.set(1, 1, 1);
  } else {
    node_cargo_system_3.position.set(0.0, 1.04, -0.72);
    node_cargo_system_3.rotation.set(0.0, 0.0, 0.0);
    node_cargo_system_3.scale.set(1.0, 1.0, 1.0);
  }
  node_cargo_system_3.userData.sculptComponent = {"id": "cargo-system", "name": "Rear Cargo Envelope", "level": "macro", "role": "cargo-shell", "importance": 0.95, "confidence": 0.98, "primitive": "box", "parent": "root", "dimensions": {"width": 0.58, "height": 0.52, "depth": 0.62, "units": "m", "confidence": 0.96}, "transform": {"position": [0, 1.04, -0.72], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "beveled detachable cargo shell blockout", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "box projection", "normalStrategy": "weighted vertex normals"}, "actionProfile": {"animationRole": "detachable-cargo", "pivot": {"mode": "base", "localPosition": [0, -0.26, 0], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-lid-hinge", "localPosition": [0, 0.26, -0.28]}, {"id": "rear-light-socket", "localPosition": [0, -0.23, -0.32]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.52, 0.62], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint", "cream", "orange"], "deformations": [], "joints": ["cargo-lid-hinge"], "seams": ["cargo-lid-seam"], "localFeatures": [], "evidenceRefs": ["rear-view", "three-quarter-view"], "fidelityTier": "blockout"};
  node_cargo_system_3.userData.actionProfile = {"animationRole": "detachable-cargo", "pivot": {"mode": "base", "localPosition": [0, -0.26, 0], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-lid-hinge", "localPosition": [0, 0.26, -0.28]}, {"id": "rear-light-socket", "localPosition": [0, -0.23, -0.32]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.52, 0.62], "isTrigger": false}};
  (nodes["root"] ?? root).add(node_cargo_system_3);
  nodes["cargo-system"] = node_cargo_system_3;
  const mesh_cargo_system_3Geometry = endpoint_cargo_system_3
    ? new THREE.CylinderGeometry(endpoint_cargo_system_3.endRadius, endpoint_cargo_system_3.baseRadius, endpoint_cargo_system_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_cargo_system_3 = new THREE.Mesh(
    mesh_cargo_system_3Geometry,
    materialMap["teal-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cargo_system_3.name = "Rear Cargo Envelope";
  if (endpoint_cargo_system_3) {
    mesh_cargo_system_3.position.copy(endpoint_cargo_system_3.midpoint);
    mesh_cargo_system_3.quaternion.copy(endpoint_cargo_system_3.quaternion);
  }
  mesh_cargo_system_3.castShadow = options.castShadow ?? true;
  mesh_cargo_system_3.receiveShadow = options.receiveShadow ?? true;
  mesh_cargo_system_3.userData.sculptComponent = {"id": "cargo-system", "name": "Rear Cargo Envelope", "level": "macro", "role": "cargo-shell", "importance": 0.95, "confidence": 0.98, "primitive": "box", "parent": "root", "dimensions": {"width": 0.58, "height": 0.52, "depth": 0.62, "units": "m", "confidence": 0.96}, "transform": {"position": [0, 1.04, -0.72], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "beveled detachable cargo shell blockout", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "box projection", "normalStrategy": "weighted vertex normals"}, "actionProfile": {"animationRole": "detachable-cargo", "pivot": {"mode": "base", "localPosition": [0, -0.26, 0], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-lid-hinge", "localPosition": [0, 0.26, -0.28]}, {"id": "rear-light-socket", "localPosition": [0, -0.23, -0.32]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.52, 0.62], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint", "cream", "orange"], "deformations": [], "joints": ["cargo-lid-hinge"], "seams": ["cargo-lid-seam"], "localFeatures": [], "evidenceRefs": ["rear-view", "three-quarter-view"], "fidelityTier": "blockout"};
  node_cargo_system_3.add(mesh_cargo_system_3);
  meshes["cargo-system"] = mesh_cargo_system_3;
  colliders["cargo-system"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.52, 0.62], "isTrigger": false};
  const socket_cargo_system_cargo_lid_hinge_0 = new THREE.Object3D();
  socket_cargo_system_cargo_lid_hinge_0.name = "cargo-lid-hinge";
  socket_cargo_system_cargo_lid_hinge_0.position.set(0.0, 0.26, -0.28);
  socket_cargo_system_cargo_lid_hinge_0.rotation.set(0, 0, 0);
  socket_cargo_system_cargo_lid_hinge_0.userData.socket = {"id": "cargo-lid-hinge", "localPosition": [0, 0.26, -0.28]};
  node_cargo_system_3.add(socket_cargo_system_cargo_lid_hinge_0);
  sockets["cargo-system:cargo-lid-hinge"] = socket_cargo_system_cargo_lid_hinge_0;
  const socket_cargo_system_rear_light_socket_1 = new THREE.Object3D();
  socket_cargo_system_rear_light_socket_1.name = "rear-light-socket";
  socket_cargo_system_rear_light_socket_1.position.set(0.0, -0.23, -0.32);
  socket_cargo_system_rear_light_socket_1.rotation.set(0, 0, 0);
  socket_cargo_system_rear_light_socket_1.userData.socket = {"id": "rear-light-socket", "localPosition": [0, -0.23, -0.32]};
  node_cargo_system_3.add(socket_cargo_system_rear_light_socket_1);
  sockets["cargo-system:rear-light-socket"] = socket_cargo_system_rear_light_socket_1;

  const attachment_frame_sweep_4 = {"parentId": "chassis", "parentSocket": "steering-head", "localStart": [0, 0.72, 0.78], "localEnd": [0, 0.42, -0.42], "baseRadius": 0.075, "endRadius": 0.09, "overlap": 0.05, "contactType": "embedded", "gapTolerance": 0.005, "evidenceRefs": ["left-view"]};
  const endpoint_frame_sweep_4 = makeAttachmentEndpoint(attachment_frame_sweep_4);
  const node_frame_sweep_4 = new THREE.Group();
  node_frame_sweep_4.name = "Teal Step Through Frame Sweep__pivot";
  if (endpoint_frame_sweep_4) {
    node_frame_sweep_4.position.copy(endpoint_frame_sweep_4.start);
    node_frame_sweep_4.rotation.set(0, 0, 0);
    node_frame_sweep_4.scale.set(1, 1, 1);
  } else {
    node_frame_sweep_4.position.set(0.0, 0.0, 0.0);
    node_frame_sweep_4.rotation.set(0.0, 0.0, 0.0);
    node_frame_sweep_4.scale.set(1.0, 1.0, 1.0);
  }
  node_frame_sweep_4.userData.sculptComponent = {"id": "frame-sweep", "name": "Teal Step Through Frame Sweep", "level": "meso", "role": "tube", "importance": 1.0, "confidence": 0.98, "primitive": "curve-sweep", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "steering-head", "localStart": [0, 0.72, 0.78], "localEnd": [0, 0.42, -0.42], "baseRadius": 0.075, "endRadius": 0.09, "overlap": 0.05, "contactType": "embedded", "gapTolerance": 0.005, "evidenceRefs": ["left-view"]}, "dimensions": {"width": 0.16, "height": 0.55, "depth": 1.28, "units": "m", "confidence": 0.94}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "beveled tube along cubic curve with low U midpoint", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.035, "segments": 4}, "deformationStack": ["cubic Bezier downward sweep", "taper 0.9"], "uvStrategy": "curve length cylindrical", "normalStrategy": "smooth curve normals"}, "actionProfile": {"animationRole": "static-frame", "pivot": {"mode": "root", "localPosition": [0, 0.72, 0.78], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule-chain", "offset": [0, 0.5, 0.1], "scale": [0.18, 0.55, 1.25], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint"], "deformations": ["U sweep"], "joints": [], "seams": [], "localFeatures": [{"id": "frame-sweep-bevel", "type": "bevel", "bevelRadius": 0.025, "segments": 3, "evidenceRef": "three-quarter-view"}], "surfaceDetail": {"macroRoughness": 0.34, "microRoughness": 0.06, "bumpAmplitude": 0.003, "normalPattern": "fine powder-coat orange-peel normal at 64 cycles per meter", "displacementPattern": "none; silhouette relief is modeled with bevel geometry", "occlusionPattern": "localized AO at frame-to-mast and steering-head contacts", "edgeWearPattern": "subtle lower-roughness highlight on exposed bevel crests", "notes": "Keep the teal frame clean and stylized; no photoreal grime."}, "evidenceRefs": ["left-view", "right-view", "top-view"], "fidelityTier": "structural-pass"};
  node_frame_sweep_4.userData.actionProfile = {"animationRole": "static-frame", "pivot": {"mode": "root", "localPosition": [0, 0.72, 0.78], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule-chain", "offset": [0, 0.5, 0.1], "scale": [0.18, 0.55, 1.25], "isTrigger": false}};
  (nodes["chassis"] ?? root).add(node_frame_sweep_4);
  nodes["frame-sweep"] = node_frame_sweep_4;
  const mesh_frame_sweep_4Geometry = endpoint_frame_sweep_4
    ? new THREE.CylinderGeometry(endpoint_frame_sweep_4.endRadius, endpoint_frame_sweep_4.baseRadius, endpoint_frame_sweep_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 8, 8, 8);
  const mesh_frame_sweep_4 = new THREE.Mesh(
    mesh_frame_sweep_4Geometry,
    materialMap["teal-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_sweep_4.name = "Teal Step Through Frame Sweep";
  if (endpoint_frame_sweep_4) {
    mesh_frame_sweep_4.position.copy(endpoint_frame_sweep_4.midpoint);
    mesh_frame_sweep_4.quaternion.copy(endpoint_frame_sweep_4.quaternion);
  }
  mesh_frame_sweep_4.castShadow = options.castShadow ?? true;
  mesh_frame_sweep_4.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_sweep_4.userData.sculptComponent = {"id": "frame-sweep", "name": "Teal Step Through Frame Sweep", "level": "meso", "role": "tube", "importance": 1.0, "confidence": 0.98, "primitive": "curve-sweep", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "steering-head", "localStart": [0, 0.72, 0.78], "localEnd": [0, 0.42, -0.42], "baseRadius": 0.075, "endRadius": 0.09, "overlap": 0.05, "contactType": "embedded", "gapTolerance": 0.005, "evidenceRefs": ["left-view"]}, "dimensions": {"width": 0.16, "height": 0.55, "depth": 1.28, "units": "m", "confidence": 0.94}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "beveled tube along cubic curve with low U midpoint", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.035, "segments": 4}, "deformationStack": ["cubic Bezier downward sweep", "taper 0.9"], "uvStrategy": "curve length cylindrical", "normalStrategy": "smooth curve normals"}, "actionProfile": {"animationRole": "static-frame", "pivot": {"mode": "root", "localPosition": [0, 0.72, 0.78], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule-chain", "offset": [0, 0.5, 0.1], "scale": [0.18, 0.55, 1.25], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint"], "deformations": ["U sweep"], "joints": [], "seams": [], "localFeatures": [{"id": "frame-sweep-bevel", "type": "bevel", "bevelRadius": 0.025, "segments": 3, "evidenceRef": "three-quarter-view"}], "surfaceDetail": {"macroRoughness": 0.34, "microRoughness": 0.06, "bumpAmplitude": 0.003, "normalPattern": "fine powder-coat orange-peel normal at 64 cycles per meter", "displacementPattern": "none; silhouette relief is modeled with bevel geometry", "occlusionPattern": "localized AO at frame-to-mast and steering-head contacts", "edgeWearPattern": "subtle lower-roughness highlight on exposed bevel crests", "notes": "Keep the teal frame clean and stylized; no photoreal grime."}, "evidenceRefs": ["left-view", "right-view", "top-view"], "fidelityTier": "structural-pass"};
  node_frame_sweep_4.add(mesh_frame_sweep_4);
  meshes["frame-sweep"] = mesh_frame_sweep_4;
  colliders["frame-sweep"] = {"type": "capsule-chain", "offset": [0, 0.5, 0.1], "scale": [0.18, 0.55, 1.25], "isTrigger": false};
  // TODO: replace 'frame-sweep' box fallback with curve-sweep procedural geometry.

  const attachment_front_wheel_5 = null;
  const endpoint_front_wheel_5 = makeAttachmentEndpoint(attachment_front_wheel_5);
  const node_front_wheel_5 = new THREE.Group();
  node_front_wheel_5.name = "Front Wheel__pivot";
  if (endpoint_front_wheel_5) {
    node_front_wheel_5.position.copy(endpoint_front_wheel_5.start);
    node_front_wheel_5.rotation.set(0, 0, 0);
    node_front_wheel_5.scale.set(1, 1, 1);
  } else {
    node_front_wheel_5.position.set(0.0, 0.0, 0.92);
    node_front_wheel_5.rotation.set(0.0, 1.5708, 0.0);
    node_front_wheel_5.scale.set(1.0, 1.0, 1.0);
  }
  node_front_wheel_5.userData.sculptComponent = {"id": "front-wheel", "name": "Front Wheel", "level": "meso", "role": "wheel", "importance": 1.0, "confidence": 0.99, "primitive": "torus", "parent": "wheel-system", "dimensions": {"radius": 0.35, "width": 0.085, "height": 0.7, "depth": 0.7, "units": "m", "confidence": 0.98}, "transform": {"position": [0, 0, 0.92], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "radial tire rim hub spoke assembly", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "toroidal", "normalStrategy": "smooth radial normals"}, "actionProfile": {"animationRole": "wheel-rotation", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-axle", "localPosition": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.085, 0.7], "isTrigger": false}}, "material": "rubber", "materialLayers": ["rubber", "cream", "black-polymer", "orange"], "deformations": [], "joints": ["front-axle"], "seams": [], "localFeatures": [{"id": "tire-tread-ridge", "type": "ridge", "repeat": 24}, {"id": "radial-spoke-system", "type": "fastener", "repeat": 16}, {"id": "front-rim-cream", "type": "ring"}], "surfaceDetail": {"macroRoughness": 0.78, "microRoughness": 0.08, "bumpAmplitude": 0.018, "normalPattern": "24 directional tread ridges plus fine rubber grain", "displacementPattern": "instanced tread blocks affect silhouette", "occlusionPattern": "AO in tread valleys and at hub-spoke contacts", "edgeWearPattern": "slight polish on tread crowns", "notes": "Tread remains exaggerated for mobile isometric readability."}, "evidenceRefs": ["front-view", "left-view"], "fidelityTier": "structural-pass"};
  node_front_wheel_5.userData.actionProfile = {"animationRole": "wheel-rotation", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-axle", "localPosition": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.085, 0.7], "isTrigger": false}};
  (nodes["wheel-system"] ?? root).add(node_front_wheel_5);
  nodes["front-wheel"] = node_front_wheel_5;
  const mesh_front_wheel_5Geometry = endpoint_front_wheel_5
    ? new THREE.CylinderGeometry(endpoint_front_wheel_5.endRadius, endpoint_front_wheel_5.baseRadius, endpoint_front_wheel_5.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_front_wheel_5 = new THREE.Mesh(
    mesh_front_wheel_5Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_wheel_5.name = "Front Wheel";
  if (endpoint_front_wheel_5) {
    mesh_front_wheel_5.position.copy(endpoint_front_wheel_5.midpoint);
    mesh_front_wheel_5.quaternion.copy(endpoint_front_wheel_5.quaternion);
  }
  mesh_front_wheel_5.castShadow = options.castShadow ?? true;
  mesh_front_wheel_5.receiveShadow = options.receiveShadow ?? true;
  mesh_front_wheel_5.userData.sculptComponent = {"id": "front-wheel", "name": "Front Wheel", "level": "meso", "role": "wheel", "importance": 1.0, "confidence": 0.99, "primitive": "torus", "parent": "wheel-system", "dimensions": {"radius": 0.35, "width": 0.085, "height": 0.7, "depth": 0.7, "units": "m", "confidence": 0.98}, "transform": {"position": [0, 0, 0.92], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "radial tire rim hub spoke assembly", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "toroidal", "normalStrategy": "smooth radial normals"}, "actionProfile": {"animationRole": "wheel-rotation", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-axle", "localPosition": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.085, 0.7], "isTrigger": false}}, "material": "rubber", "materialLayers": ["rubber", "cream", "black-polymer", "orange"], "deformations": [], "joints": ["front-axle"], "seams": [], "localFeatures": [{"id": "tire-tread-ridge", "type": "ridge", "repeat": 24}, {"id": "radial-spoke-system", "type": "fastener", "repeat": 16}, {"id": "front-rim-cream", "type": "ring"}], "surfaceDetail": {"macroRoughness": 0.78, "microRoughness": 0.08, "bumpAmplitude": 0.018, "normalPattern": "24 directional tread ridges plus fine rubber grain", "displacementPattern": "instanced tread blocks affect silhouette", "occlusionPattern": "AO in tread valleys and at hub-spoke contacts", "edgeWearPattern": "slight polish on tread crowns", "notes": "Tread remains exaggerated for mobile isometric readability."}, "evidenceRefs": ["front-view", "left-view"], "fidelityTier": "structural-pass"};
  node_front_wheel_5.add(mesh_front_wheel_5);
  meshes["front-wheel"] = mesh_front_wheel_5;
  colliders["front-wheel"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.085, 0.7], "isTrigger": false};
  const socket_front_wheel_front_axle_0 = new THREE.Object3D();
  socket_front_wheel_front_axle_0.name = "front-axle";
  socket_front_wheel_front_axle_0.position.set(0.0, 0.0, 0.0);
  socket_front_wheel_front_axle_0.rotation.set(0, 0, 0);
  socket_front_wheel_front_axle_0.userData.socket = {"id": "front-axle", "localPosition": [0, 0, 0]};
  node_front_wheel_5.add(socket_front_wheel_front_axle_0);
  sockets["front-wheel:front-axle"] = socket_front_wheel_front_axle_0;

  const attachment_rear_wheel_6 = null;
  const endpoint_rear_wheel_6 = makeAttachmentEndpoint(attachment_rear_wheel_6);
  const node_rear_wheel_6 = new THREE.Group();
  node_rear_wheel_6.name = "Rear Wheel__pivot";
  if (endpoint_rear_wheel_6) {
    node_rear_wheel_6.position.copy(endpoint_rear_wheel_6.start);
    node_rear_wheel_6.rotation.set(0, 0, 0);
    node_rear_wheel_6.scale.set(1, 1, 1);
  } else {
    node_rear_wheel_6.position.set(0.0, 0.0, -0.92);
    node_rear_wheel_6.rotation.set(0.0, 1.5708, 0.0);
    node_rear_wheel_6.scale.set(1.0, 1.0, 1.0);
  }
  node_rear_wheel_6.userData.sculptComponent = {"id": "rear-wheel", "name": "Rear Wheel", "level": "meso", "role": "wheel", "importance": 1.0, "confidence": 0.99, "primitive": "torus", "parent": "wheel-system", "dimensions": {"radius": 0.35, "width": 0.085, "height": 0.7, "depth": 0.7, "units": "m", "confidence": 0.98}, "transform": {"position": [0, 0, -0.92], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "radial tire rim hub spoke assembly", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "toroidal", "normalStrategy": "smooth radial normals"}, "actionProfile": {"animationRole": "wheel-rotation", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-axle", "localPosition": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.085, 0.7], "isTrigger": false}}, "material": "rubber", "materialLayers": ["rubber", "cream", "black-polymer", "orange"], "deformations": [], "joints": ["rear-axle"], "seams": [], "localFeatures": [{"id": "rear-tread-ridge", "type": "ridge", "repeat": 24}, {"id": "rear-radial-spokes", "type": "fastener", "repeat": 16}, {"id": "rear-rim-cream", "type": "ring"}], "surfaceDetail": {"macroRoughness": 0.78, "microRoughness": 0.08, "bumpAmplitude": 0.018, "normalPattern": "24 directional tread ridges plus fine rubber grain", "displacementPattern": "instanced tread blocks affect silhouette", "occlusionPattern": "AO in tread valleys and at hub-spoke contacts", "edgeWearPattern": "slight polish on tread crowns", "notes": "Match front tire response and scale exactly."}, "evidenceRefs": ["rear-view", "right-view"], "fidelityTier": "structural-pass"};
  node_rear_wheel_6.userData.actionProfile = {"animationRole": "wheel-rotation", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-axle", "localPosition": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.085, 0.7], "isTrigger": false}};
  (nodes["wheel-system"] ?? root).add(node_rear_wheel_6);
  nodes["rear-wheel"] = node_rear_wheel_6;
  const mesh_rear_wheel_6Geometry = endpoint_rear_wheel_6
    ? new THREE.CylinderGeometry(endpoint_rear_wheel_6.endRadius, endpoint_rear_wheel_6.baseRadius, endpoint_rear_wheel_6.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_rear_wheel_6 = new THREE.Mesh(
    mesh_rear_wheel_6Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_wheel_6.name = "Rear Wheel";
  if (endpoint_rear_wheel_6) {
    mesh_rear_wheel_6.position.copy(endpoint_rear_wheel_6.midpoint);
    mesh_rear_wheel_6.quaternion.copy(endpoint_rear_wheel_6.quaternion);
  }
  mesh_rear_wheel_6.castShadow = options.castShadow ?? true;
  mesh_rear_wheel_6.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_wheel_6.userData.sculptComponent = {"id": "rear-wheel", "name": "Rear Wheel", "level": "meso", "role": "wheel", "importance": 1.0, "confidence": 0.99, "primitive": "torus", "parent": "wheel-system", "dimensions": {"radius": 0.35, "width": 0.085, "height": 0.7, "depth": 0.7, "units": "m", "confidence": 0.98}, "transform": {"position": [0, 0, -0.92], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "radial tire rim hub spoke assembly", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "toroidal", "normalStrategy": "smooth radial normals"}, "actionProfile": {"animationRole": "wheel-rotation", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 1.0}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-axle", "localPosition": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.085, 0.7], "isTrigger": false}}, "material": "rubber", "materialLayers": ["rubber", "cream", "black-polymer", "orange"], "deformations": [], "joints": ["rear-axle"], "seams": [], "localFeatures": [{"id": "rear-tread-ridge", "type": "ridge", "repeat": 24}, {"id": "rear-radial-spokes", "type": "fastener", "repeat": 16}, {"id": "rear-rim-cream", "type": "ring"}], "surfaceDetail": {"macroRoughness": 0.78, "microRoughness": 0.08, "bumpAmplitude": 0.018, "normalPattern": "24 directional tread ridges plus fine rubber grain", "displacementPattern": "instanced tread blocks affect silhouette", "occlusionPattern": "AO in tread valleys and at hub-spoke contacts", "edgeWearPattern": "slight polish on tread crowns", "notes": "Match front tire response and scale exactly."}, "evidenceRefs": ["rear-view", "right-view"], "fidelityTier": "structural-pass"};
  node_rear_wheel_6.add(mesh_rear_wheel_6);
  meshes["rear-wheel"] = mesh_rear_wheel_6;
  colliders["rear-wheel"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.085, 0.7], "isTrigger": false};
  const socket_rear_wheel_rear_axle_0 = new THREE.Object3D();
  socket_rear_wheel_rear_axle_0.name = "rear-axle";
  socket_rear_wheel_rear_axle_0.position.set(0.0, 0.0, 0.0);
  socket_rear_wheel_rear_axle_0.rotation.set(0, 0, 0);
  socket_rear_wheel_rear_axle_0.userData.socket = {"id": "rear-axle", "localPosition": [0, 0, 0]};
  node_rear_wheel_6.add(socket_rear_wheel_rear_axle_0);
  sockets["rear-wheel:rear-axle"] = socket_rear_wheel_rear_axle_0;

  const attachment_front_fork_7 = {"parentId": "chassis", "parentSocket": "steering-head", "localStart": [0, 0.75, 0.78], "localEnd": [0, 0.35, 0.92], "baseRadius": 0.04, "endRadius": 0.035, "overlap": 0.04, "contactType": "hinge", "gapTolerance": 0.004, "evidenceRefs": ["front-view", "left-view"]};
  const endpoint_front_fork_7 = makeAttachmentEndpoint(attachment_front_fork_7);
  const node_front_fork_7 = new THREE.Group();
  node_front_fork_7.name = "Front Fork__pivot";
  if (endpoint_front_fork_7) {
    node_front_fork_7.position.copy(endpoint_front_fork_7.start);
    node_front_fork_7.rotation.set(0, 0, 0);
    node_front_fork_7.scale.set(1, 1, 1);
  } else {
    node_front_fork_7.position.set(0.0, 0.0, 0.0);
    node_front_fork_7.rotation.set(0.0, 0.0, 0.0);
    node_front_fork_7.scale.set(1.0, 1.0, 1.0);
  }
  node_front_fork_7.userData.sculptComponent = {"id": "front-fork", "name": "Front Fork", "level": "meso", "role": "fork", "importance": 0.92, "confidence": 0.96, "primitive": "cylinder", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "steering-head", "localStart": [0, 0.75, 0.78], "localEnd": [0, 0.35, 0.92], "baseRadius": 0.04, "endRadius": 0.035, "overlap": 0.04, "contactType": "hinge", "gapTolerance": 0.004, "evidenceRefs": ["front-view", "left-view"]}, "dimensions": {"width": 0.28, "height": 0.58, "depth": 0.08, "units": "m", "confidence": 0.93}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "paired tapered fork tubes under steering pivot", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.008, "segments": 2}, "deformationStack": ["slight rake"], "uvStrategy": "cylindrical", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "steering-pivot", "pivot": {"mode": "hinge", "localPosition": [0, 0.75, 0.78], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handlebar-root", "localPosition": [0, 0.36, 0]}, {"id": "headlight-root", "localPosition": [0, 0.18, 0.08]}, {"id": "front-mudguard-root", "localPosition": [0, -0.35, 0.12]}], "collider": {"type": "box", "offset": [0, -0.18, 0.06], "scale": [0.3, 0.58, 0.1], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer", "metal"], "deformations": ["rake"], "joints": ["steering-head"], "seams": [], "localFeatures": [], "evidenceRefs": ["front-view", "left-view"], "fidelityTier": "structural-pass"};
  node_front_fork_7.userData.actionProfile = {"animationRole": "steering-pivot", "pivot": {"mode": "hinge", "localPosition": [0, 0.75, 0.78], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handlebar-root", "localPosition": [0, 0.36, 0]}, {"id": "headlight-root", "localPosition": [0, 0.18, 0.08]}, {"id": "front-mudguard-root", "localPosition": [0, -0.35, 0.12]}], "collider": {"type": "box", "offset": [0, -0.18, 0.06], "scale": [0.3, 0.58, 0.1], "isTrigger": false}};
  (nodes["chassis"] ?? root).add(node_front_fork_7);
  nodes["front-fork"] = node_front_fork_7;
  const mesh_front_fork_7Geometry = endpoint_front_fork_7
    ? new THREE.CylinderGeometry(endpoint_front_fork_7.endRadius, endpoint_front_fork_7.baseRadius, endpoint_front_fork_7.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_front_fork_7 = new THREE.Mesh(
    mesh_front_fork_7Geometry,
    materialMap["black-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_fork_7.name = "Front Fork";
  if (endpoint_front_fork_7) {
    mesh_front_fork_7.position.copy(endpoint_front_fork_7.midpoint);
    mesh_front_fork_7.quaternion.copy(endpoint_front_fork_7.quaternion);
  }
  mesh_front_fork_7.castShadow = options.castShadow ?? true;
  mesh_front_fork_7.receiveShadow = options.receiveShadow ?? true;
  mesh_front_fork_7.userData.sculptComponent = {"id": "front-fork", "name": "Front Fork", "level": "meso", "role": "fork", "importance": 0.92, "confidence": 0.96, "primitive": "cylinder", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "steering-head", "localStart": [0, 0.75, 0.78], "localEnd": [0, 0.35, 0.92], "baseRadius": 0.04, "endRadius": 0.035, "overlap": 0.04, "contactType": "hinge", "gapTolerance": 0.004, "evidenceRefs": ["front-view", "left-view"]}, "dimensions": {"width": 0.28, "height": 0.58, "depth": 0.08, "units": "m", "confidence": 0.93}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "paired tapered fork tubes under steering pivot", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.008, "segments": 2}, "deformationStack": ["slight rake"], "uvStrategy": "cylindrical", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "steering-pivot", "pivot": {"mode": "hinge", "localPosition": [0, 0.75, 0.78], "axis": [0, 1, 0], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handlebar-root", "localPosition": [0, 0.36, 0]}, {"id": "headlight-root", "localPosition": [0, 0.18, 0.08]}, {"id": "front-mudguard-root", "localPosition": [0, -0.35, 0.12]}], "collider": {"type": "box", "offset": [0, -0.18, 0.06], "scale": [0.3, 0.58, 0.1], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer", "metal"], "deformations": ["rake"], "joints": ["steering-head"], "seams": [], "localFeatures": [], "evidenceRefs": ["front-view", "left-view"], "fidelityTier": "structural-pass"};
  node_front_fork_7.add(mesh_front_fork_7);
  meshes["front-fork"] = mesh_front_fork_7;
  colliders["front-fork"] = {"type": "box", "offset": [0, -0.18, 0.06], "scale": [0.3, 0.58, 0.1], "isTrigger": false};
  const socket_front_fork_handlebar_root_0 = new THREE.Object3D();
  socket_front_fork_handlebar_root_0.name = "handlebar-root";
  socket_front_fork_handlebar_root_0.position.set(0.0, 0.36, 0.0);
  socket_front_fork_handlebar_root_0.rotation.set(0, 0, 0);
  socket_front_fork_handlebar_root_0.userData.socket = {"id": "handlebar-root", "localPosition": [0, 0.36, 0]};
  node_front_fork_7.add(socket_front_fork_handlebar_root_0);
  sockets["front-fork:handlebar-root"] = socket_front_fork_handlebar_root_0;
  const socket_front_fork_headlight_root_1 = new THREE.Object3D();
  socket_front_fork_headlight_root_1.name = "headlight-root";
  socket_front_fork_headlight_root_1.position.set(0.0, 0.18, 0.08);
  socket_front_fork_headlight_root_1.rotation.set(0, 0, 0);
  socket_front_fork_headlight_root_1.userData.socket = {"id": "headlight-root", "localPosition": [0, 0.18, 0.08]};
  node_front_fork_7.add(socket_front_fork_headlight_root_1);
  sockets["front-fork:headlight-root"] = socket_front_fork_headlight_root_1;
  const socket_front_fork_front_mudguard_root_2 = new THREE.Object3D();
  socket_front_fork_front_mudguard_root_2.name = "front-mudguard-root";
  socket_front_fork_front_mudguard_root_2.position.set(0.0, -0.35, 0.12);
  socket_front_fork_front_mudguard_root_2.rotation.set(0, 0, 0);
  socket_front_fork_front_mudguard_root_2.userData.socket = {"id": "front-mudguard-root", "localPosition": [0, -0.35, 0.12]};
  node_front_fork_7.add(socket_front_fork_front_mudguard_root_2);
  sockets["front-fork:front-mudguard-root"] = socket_front_fork_front_mudguard_root_2;

  const attachment_handlebar_8 = {"parentId": "front-fork", "parentSocket": "handlebar-root", "localStart": [0, 0.36, 0], "localEnd": [0, 0.52, 0], "baseRadius": 0.025, "endRadius": 0.025, "overlap": 0.025, "contactType": "socket", "gapTolerance": 0.003, "evidenceRefs": ["front-view", "top-view"]};
  const endpoint_handlebar_8 = makeAttachmentEndpoint(attachment_handlebar_8);
  const node_handlebar_8 = new THREE.Group();
  node_handlebar_8.name = "Wide Handlebar__pivot";
  if (endpoint_handlebar_8) {
    node_handlebar_8.position.copy(endpoint_handlebar_8.start);
    node_handlebar_8.rotation.set(0, 0, 0);
    node_handlebar_8.scale.set(1, 1, 1);
  } else {
    node_handlebar_8.position.set(0.0, 0.0, 0.0);
    node_handlebar_8.rotation.set(0.0, 0.0, 0.0);
    node_handlebar_8.scale.set(1.0, 1.0, 1.0);
  }
  node_handlebar_8.userData.sculptComponent = {"id": "handlebar", "name": "Wide Handlebar", "level": "meso", "role": "handle", "importance": 0.86, "confidence": 0.96, "primitive": "curve-sweep", "parent": "front-fork", "attachment": {"parentId": "front-fork", "parentSocket": "handlebar-root", "localStart": [0, 0.36, 0], "localEnd": [0, 0.52, 0], "baseRadius": 0.025, "endRadius": 0.025, "overlap": 0.025, "contactType": "socket", "gapTolerance": 0.003, "evidenceRefs": ["front-view", "top-view"]}, "dimensions": {"width": 0.68, "height": 0.12, "depth": 0.12, "units": "m", "confidence": 0.95}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "swept bar with shallow rearward grip bends", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.004, "segments": 2}, "deformationStack": ["symmetric grip sweep"], "uvStrategy": "curve length", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "steering-child", "pivot": {"mode": "socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.97}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "left-grip", "localPosition": [-0.34, 0.1, 0]}, {"id": "right-grip", "localPosition": [0.34, 0.1, 0]}], "collider": {"type": "capsule", "offset": [0, 0.08, 0], "scale": [0.68, 0.06, 0.08], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer", "cream"], "deformations": ["grip sweep"], "joints": [], "seams": [], "localFeatures": [{"id": "cream-grips", "type": "material bands"}], "evidenceRefs": ["front-view", "top-view"], "fidelityTier": "structural-pass"};
  node_handlebar_8.userData.actionProfile = {"animationRole": "steering-child", "pivot": {"mode": "socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.97}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "left-grip", "localPosition": [-0.34, 0.1, 0]}, {"id": "right-grip", "localPosition": [0.34, 0.1, 0]}], "collider": {"type": "capsule", "offset": [0, 0.08, 0], "scale": [0.68, 0.06, 0.08], "isTrigger": false}};
  (nodes["front-fork"] ?? root).add(node_handlebar_8);
  nodes["handlebar"] = node_handlebar_8;
  const mesh_handlebar_8Geometry = endpoint_handlebar_8
    ? new THREE.CylinderGeometry(endpoint_handlebar_8.endRadius, endpoint_handlebar_8.baseRadius, endpoint_handlebar_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 8, 8, 8);
  const mesh_handlebar_8 = new THREE.Mesh(
    mesh_handlebar_8Geometry,
    materialMap["black-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handlebar_8.name = "Wide Handlebar";
  if (endpoint_handlebar_8) {
    mesh_handlebar_8.position.copy(endpoint_handlebar_8.midpoint);
    mesh_handlebar_8.quaternion.copy(endpoint_handlebar_8.quaternion);
  }
  mesh_handlebar_8.castShadow = options.castShadow ?? true;
  mesh_handlebar_8.receiveShadow = options.receiveShadow ?? true;
  mesh_handlebar_8.userData.sculptComponent = {"id": "handlebar", "name": "Wide Handlebar", "level": "meso", "role": "handle", "importance": 0.86, "confidence": 0.96, "primitive": "curve-sweep", "parent": "front-fork", "attachment": {"parentId": "front-fork", "parentSocket": "handlebar-root", "localStart": [0, 0.36, 0], "localEnd": [0, 0.52, 0], "baseRadius": 0.025, "endRadius": 0.025, "overlap": 0.025, "contactType": "socket", "gapTolerance": 0.003, "evidenceRefs": ["front-view", "top-view"]}, "dimensions": {"width": 0.68, "height": 0.12, "depth": 0.12, "units": "m", "confidence": 0.95}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "swept bar with shallow rearward grip bends", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.004, "segments": 2}, "deformationStack": ["symmetric grip sweep"], "uvStrategy": "curve length", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "steering-child", "pivot": {"mode": "socket", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.97}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "left-grip", "localPosition": [-0.34, 0.1, 0]}, {"id": "right-grip", "localPosition": [0.34, 0.1, 0]}], "collider": {"type": "capsule", "offset": [0, 0.08, 0], "scale": [0.68, 0.06, 0.08], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer", "cream"], "deformations": ["grip sweep"], "joints": [], "seams": [], "localFeatures": [{"id": "cream-grips", "type": "material bands"}], "evidenceRefs": ["front-view", "top-view"], "fidelityTier": "structural-pass"};
  node_handlebar_8.add(mesh_handlebar_8);
  meshes["handlebar"] = mesh_handlebar_8;
  colliders["handlebar"] = {"type": "capsule", "offset": [0, 0.08, 0], "scale": [0.68, 0.06, 0.08], "isTrigger": false};
  const socket_handlebar_left_grip_0 = new THREE.Object3D();
  socket_handlebar_left_grip_0.name = "left-grip";
  socket_handlebar_left_grip_0.position.set(-0.34, 0.1, 0.0);
  socket_handlebar_left_grip_0.rotation.set(0, 0, 0);
  socket_handlebar_left_grip_0.userData.socket = {"id": "left-grip", "localPosition": [-0.34, 0.1, 0]};
  node_handlebar_8.add(socket_handlebar_left_grip_0);
  sockets["handlebar:left-grip"] = socket_handlebar_left_grip_0;
  const socket_handlebar_right_grip_1 = new THREE.Object3D();
  socket_handlebar_right_grip_1.name = "right-grip";
  socket_handlebar_right_grip_1.position.set(0.34, 0.1, 0.0);
  socket_handlebar_right_grip_1.rotation.set(0, 0, 0);
  socket_handlebar_right_grip_1.userData.socket = {"id": "right-grip", "localPosition": [0.34, 0.1, 0]};
  node_handlebar_8.add(socket_handlebar_right_grip_1);
  sockets["handlebar:right-grip"] = socket_handlebar_right_grip_1;
  // TODO: replace 'handlebar' box fallback with curve-sweep procedural geometry.

  const attachment_saddle_9 = null;
  const endpoint_saddle_9 = makeAttachmentEndpoint(attachment_saddle_9);
  const node_saddle_9 = new THREE.Group();
  node_saddle_9.name = "Cream Saddle__pivot";
  if (endpoint_saddle_9) {
    node_saddle_9.position.copy(endpoint_saddle_9.start);
    node_saddle_9.rotation.set(0, 0, 0);
    node_saddle_9.scale.set(1, 1, 1);
  } else {
    node_saddle_9.position.set(0.0, 1.04, -0.26);
    node_saddle_9.rotation.set(0.0, 0.0, 0.0);
    node_saddle_9.scale.set(1.0, 1.0, 1.0);
  }
  node_saddle_9.userData.sculptComponent = {"id": "saddle", "name": "Cream Saddle", "level": "meso", "role": "seat", "importance": 0.75, "confidence": 0.96, "primitive": "box", "parent": "chassis", "dimensions": {"width": 0.32, "height": 0.09, "depth": 0.28, "units": "m", "confidence": 0.93}, "transform": {"position": [0, 1.04, -0.26], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "rounded low-poly seat wedge", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 3}, "deformationStack": ["front taper"], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "static-seat", "pivot": {"mode": "base", "localPosition": [0, -0.045, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rider-contact", "localPosition": [0, 0.05, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.32, 0.09, 0.28], "isTrigger": false}}, "material": "cream", "materialLayers": ["cream"], "deformations": ["front taper"], "joints": [], "seams": ["seat-edge-seam"], "localFeatures": [{"id": "seat-edge-bevel", "type": "bevel"}], "evidenceRefs": ["left-view", "top-view"], "fidelityTier": "structural-pass"};
  node_saddle_9.userData.actionProfile = {"animationRole": "static-seat", "pivot": {"mode": "base", "localPosition": [0, -0.045, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rider-contact", "localPosition": [0, 0.05, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.32, 0.09, 0.28], "isTrigger": false}};
  (nodes["chassis"] ?? root).add(node_saddle_9);
  nodes["saddle"] = node_saddle_9;
  const mesh_saddle_9Geometry = endpoint_saddle_9
    ? new THREE.CylinderGeometry(endpoint_saddle_9.endRadius, endpoint_saddle_9.baseRadius, endpoint_saddle_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_saddle_9 = new THREE.Mesh(
    mesh_saddle_9Geometry,
    materialMap["cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_saddle_9.name = "Cream Saddle";
  if (endpoint_saddle_9) {
    mesh_saddle_9.position.copy(endpoint_saddle_9.midpoint);
    mesh_saddle_9.quaternion.copy(endpoint_saddle_9.quaternion);
  }
  mesh_saddle_9.castShadow = options.castShadow ?? true;
  mesh_saddle_9.receiveShadow = options.receiveShadow ?? true;
  mesh_saddle_9.userData.sculptComponent = {"id": "saddle", "name": "Cream Saddle", "level": "meso", "role": "seat", "importance": 0.75, "confidence": 0.96, "primitive": "box", "parent": "chassis", "dimensions": {"width": 0.32, "height": 0.09, "depth": 0.28, "units": "m", "confidence": 0.93}, "transform": {"position": [0, 1.04, -0.26], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "rounded low-poly seat wedge", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 3}, "deformationStack": ["front taper"], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "static-seat", "pivot": {"mode": "base", "localPosition": [0, -0.045, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rider-contact", "localPosition": [0, 0.05, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.32, 0.09, 0.28], "isTrigger": false}}, "material": "cream", "materialLayers": ["cream"], "deformations": ["front taper"], "joints": [], "seams": ["seat-edge-seam"], "localFeatures": [{"id": "seat-edge-bevel", "type": "bevel"}], "evidenceRefs": ["left-view", "top-view"], "fidelityTier": "structural-pass"};
  node_saddle_9.add(mesh_saddle_9);
  meshes["saddle"] = mesh_saddle_9;
  colliders["saddle"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.32, 0.09, 0.28], "isTrigger": false};
  const socket_saddle_rider_contact_0 = new THREE.Object3D();
  socket_saddle_rider_contact_0.name = "rider-contact";
  socket_saddle_rider_contact_0.position.set(0.0, 0.05, 0.0);
  socket_saddle_rider_contact_0.rotation.set(0, 0, 0);
  socket_saddle_rider_contact_0.userData.socket = {"id": "rider-contact", "localPosition": [0, 0.05, 0]};
  node_saddle_9.add(socket_saddle_rider_contact_0);
  sockets["saddle:rider-contact"] = socket_saddle_rider_contact_0;

  const attachment_battery_10 = null;
  const endpoint_battery_10 = makeAttachmentEndpoint(attachment_battery_10);
  const node_battery_10 = new THREE.Group();
  node_battery_10.name = "Battery Housing__pivot";
  if (endpoint_battery_10) {
    node_battery_10.position.copy(endpoint_battery_10.start);
    node_battery_10.rotation.set(0, 0, 0);
    node_battery_10.scale.set(1, 1, 1);
  } else {
    node_battery_10.position.set(0.0, 0.6, -0.27);
    node_battery_10.rotation.set(0.0, 0.0, 0.0);
    node_battery_10.scale.set(1.0, 1.0, 1.0);
  }
  node_battery_10.userData.sculptComponent = {"id": "battery", "name": "Battery Housing", "level": "meso", "role": "battery", "importance": 0.8, "confidence": 0.95, "primitive": "box", "parent": "chassis", "dimensions": {"width": 0.22, "height": 0.47, "depth": 0.24, "units": "m", "confidence": 0.94}, "transform": {"position": [0, 0.6, -0.27], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "tapered black polymer battery shell", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.035, "segments": 3}, "deformationStack": ["top taper"], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "detachable-battery", "pivot": {"mode": "base", "localPosition": [0, -0.235, 0], "axis": [0, 1, 0], "confidence": 0.94}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "battery-charge", "localPosition": [0.11, 0.05, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.47, 0.24], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer"], "deformations": ["top taper"], "joints": [], "seams": ["battery-panel-seam"], "localFeatures": [{"id": "battery-corner-bevel", "type": "bevel", "bevelRadius": 0.035}], "evidenceRefs": ["left-view", "right-view"], "fidelityTier": "structural-pass"};
  node_battery_10.userData.actionProfile = {"animationRole": "detachable-battery", "pivot": {"mode": "base", "localPosition": [0, -0.235, 0], "axis": [0, 1, 0], "confidence": 0.94}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "battery-charge", "localPosition": [0.11, 0.05, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.47, 0.24], "isTrigger": false}};
  (nodes["chassis"] ?? root).add(node_battery_10);
  nodes["battery"] = node_battery_10;
  const mesh_battery_10Geometry = endpoint_battery_10
    ? new THREE.CylinderGeometry(endpoint_battery_10.endRadius, endpoint_battery_10.baseRadius, endpoint_battery_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_battery_10 = new THREE.Mesh(
    mesh_battery_10Geometry,
    materialMap["black-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_battery_10.name = "Battery Housing";
  if (endpoint_battery_10) {
    mesh_battery_10.position.copy(endpoint_battery_10.midpoint);
    mesh_battery_10.quaternion.copy(endpoint_battery_10.quaternion);
  }
  mesh_battery_10.castShadow = options.castShadow ?? true;
  mesh_battery_10.receiveShadow = options.receiveShadow ?? true;
  mesh_battery_10.userData.sculptComponent = {"id": "battery", "name": "Battery Housing", "level": "meso", "role": "battery", "importance": 0.8, "confidence": 0.95, "primitive": "box", "parent": "chassis", "dimensions": {"width": 0.22, "height": 0.47, "depth": 0.24, "units": "m", "confidence": 0.94}, "transform": {"position": [0, 0.6, -0.27], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "tapered black polymer battery shell", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.035, "segments": 3}, "deformationStack": ["top taper"], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "detachable-battery", "pivot": {"mode": "base", "localPosition": [0, -0.235, 0], "axis": [0, 1, 0], "confidence": 0.94}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "battery-charge", "localPosition": [0.11, 0.05, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.47, 0.24], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer"], "deformations": ["top taper"], "joints": [], "seams": ["battery-panel-seam"], "localFeatures": [{"id": "battery-corner-bevel", "type": "bevel", "bevelRadius": 0.035}], "evidenceRefs": ["left-view", "right-view"], "fidelityTier": "structural-pass"};
  node_battery_10.add(mesh_battery_10);
  meshes["battery"] = mesh_battery_10;
  colliders["battery"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.22, 0.47, 0.24], "isTrigger": false};
  const socket_battery_battery_charge_0 = new THREE.Object3D();
  socket_battery_battery_charge_0.name = "battery-charge";
  socket_battery_battery_charge_0.position.set(0.11, 0.05, 0.0);
  socket_battery_battery_charge_0.rotation.set(0, 0, 0);
  socket_battery_battery_charge_0.userData.socket = {"id": "battery-charge", "localPosition": [0.11, 0.05, 0]};
  node_battery_10.add(socket_battery_battery_charge_0);
  sockets["battery:battery-charge"] = socket_battery_battery_charge_0;

  const attachment_cargo_box_11 = null;
  const endpoint_cargo_box_11 = makeAttachmentEndpoint(attachment_cargo_box_11);
  const node_cargo_box_11 = new THREE.Group();
  node_cargo_box_11.name = "Cargo Box Body__pivot";
  if (endpoint_cargo_box_11) {
    node_cargo_box_11.position.copy(endpoint_cargo_box_11.start);
    node_cargo_box_11.rotation.set(0, 0, 0);
    node_cargo_box_11.scale.set(1, 1, 1);
  } else {
    node_cargo_box_11.position.set(0.0, -0.04, 0.0);
    node_cargo_box_11.rotation.set(0.0, 0.0, 0.0);
    node_cargo_box_11.scale.set(1.0, 1.0, 1.0);
  }
  node_cargo_box_11.userData.sculptComponent = {"id": "cargo-box", "name": "Cargo Box Body", "level": "meso", "role": "cargo-box", "importance": 0.95, "confidence": 0.99, "primitive": "box", "parent": "cargo-system", "dimensions": {"width": 0.58, "height": 0.44, "depth": 0.62, "units": "m", "confidence": 0.98}, "transform": {"position": [0, -0.04, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "beveled box shell with shallow parcel emblem relief", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "cargo-body", "pivot": {"mode": "base", "localPosition": [0, -0.22, 0], "axis": [0, 1, 0], "confidence": 0.99}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "parcel-emblem-side", "localPosition": [-0.295, 0, 0]}, {"id": "parcel-emblem-rear", "localPosition": [0, 0, -0.315]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.44, 0.62], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint", "cream", "orange"], "deformations": [], "joints": [], "seams": ["cargo-lid-seam"], "localFeatures": [{"id": "parcel-emblem-relief", "type": "decal relief", "thickness": 0.006}, {"id": "cargo-corner-accent-plates", "type": "decal plates"}], "surfaceDetail": {"macroRoughness": 0.34, "microRoughness": 0.05, "bumpAmplitude": 0.002, "normalPattern": "subtle powder-coat micro normal", "displacementPattern": "parcel badge and corner plates use real shallow relief", "occlusionPattern": "AO under lid seam, latch and corner guards", "edgeWearPattern": "clean bevel highlight with minimal contact wear at lower corners", "notes": "Large cargo faces stay visually calm so the parcel badge remains legible."}, "evidenceRefs": ["rear-view", "right-view", "three-quarter-view"], "fidelityTier": "structural-pass"};
  node_cargo_box_11.userData.actionProfile = {"animationRole": "cargo-body", "pivot": {"mode": "base", "localPosition": [0, -0.22, 0], "axis": [0, 1, 0], "confidence": 0.99}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "parcel-emblem-side", "localPosition": [-0.295, 0, 0]}, {"id": "parcel-emblem-rear", "localPosition": [0, 0, -0.315]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.44, 0.62], "isTrigger": false}};
  (nodes["cargo-system"] ?? root).add(node_cargo_box_11);
  nodes["cargo-box"] = node_cargo_box_11;
  const mesh_cargo_box_11Geometry = endpoint_cargo_box_11
    ? new THREE.CylinderGeometry(endpoint_cargo_box_11.endRadius, endpoint_cargo_box_11.baseRadius, endpoint_cargo_box_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_cargo_box_11 = new THREE.Mesh(
    mesh_cargo_box_11Geometry,
    materialMap["teal-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cargo_box_11.name = "Cargo Box Body";
  if (endpoint_cargo_box_11) {
    mesh_cargo_box_11.position.copy(endpoint_cargo_box_11.midpoint);
    mesh_cargo_box_11.quaternion.copy(endpoint_cargo_box_11.quaternion);
  }
  mesh_cargo_box_11.castShadow = options.castShadow ?? true;
  mesh_cargo_box_11.receiveShadow = options.receiveShadow ?? true;
  mesh_cargo_box_11.userData.sculptComponent = {"id": "cargo-box", "name": "Cargo Box Body", "level": "meso", "role": "cargo-box", "importance": 0.95, "confidence": 0.99, "primitive": "box", "parent": "cargo-system", "dimensions": {"width": 0.58, "height": 0.44, "depth": 0.62, "units": "m", "confidence": 0.98}, "transform": {"position": [0, -0.04, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "beveled box shell with shallow parcel emblem relief", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "cargo-body", "pivot": {"mode": "base", "localPosition": [0, -0.22, 0], "axis": [0, 1, 0], "confidence": 0.99}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "parcel-emblem-side", "localPosition": [-0.295, 0, 0]}, {"id": "parcel-emblem-rear", "localPosition": [0, 0, -0.315]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.44, 0.62], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint", "cream", "orange"], "deformations": [], "joints": [], "seams": ["cargo-lid-seam"], "localFeatures": [{"id": "parcel-emblem-relief", "type": "decal relief", "thickness": 0.006}, {"id": "cargo-corner-accent-plates", "type": "decal plates"}], "surfaceDetail": {"macroRoughness": 0.34, "microRoughness": 0.05, "bumpAmplitude": 0.002, "normalPattern": "subtle powder-coat micro normal", "displacementPattern": "parcel badge and corner plates use real shallow relief", "occlusionPattern": "AO under lid seam, latch and corner guards", "edgeWearPattern": "clean bevel highlight with minimal contact wear at lower corners", "notes": "Large cargo faces stay visually calm so the parcel badge remains legible."}, "evidenceRefs": ["rear-view", "right-view", "three-quarter-view"], "fidelityTier": "structural-pass"};
  node_cargo_box_11.add(mesh_cargo_box_11);
  meshes["cargo-box"] = mesh_cargo_box_11;
  colliders["cargo-box"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.58, 0.44, 0.62], "isTrigger": false};
  const socket_cargo_box_parcel_emblem_side_0 = new THREE.Object3D();
  socket_cargo_box_parcel_emblem_side_0.name = "parcel-emblem-side";
  socket_cargo_box_parcel_emblem_side_0.position.set(-0.295, 0.0, 0.0);
  socket_cargo_box_parcel_emblem_side_0.rotation.set(0, 0, 0);
  socket_cargo_box_parcel_emblem_side_0.userData.socket = {"id": "parcel-emblem-side", "localPosition": [-0.295, 0, 0]};
  node_cargo_box_11.add(socket_cargo_box_parcel_emblem_side_0);
  sockets["cargo-box:parcel-emblem-side"] = socket_cargo_box_parcel_emblem_side_0;
  const socket_cargo_box_parcel_emblem_rear_1 = new THREE.Object3D();
  socket_cargo_box_parcel_emblem_rear_1.name = "parcel-emblem-rear";
  socket_cargo_box_parcel_emblem_rear_1.position.set(0.0, 0.0, -0.315);
  socket_cargo_box_parcel_emblem_rear_1.rotation.set(0, 0, 0);
  socket_cargo_box_parcel_emblem_rear_1.userData.socket = {"id": "parcel-emblem-rear", "localPosition": [0, 0, -0.315]};
  node_cargo_box_11.add(socket_cargo_box_parcel_emblem_rear_1);
  sockets["cargo-box:parcel-emblem-rear"] = socket_cargo_box_parcel_emblem_rear_1;

  const attachment_cargo_lid_12 = null;
  const endpoint_cargo_lid_12 = makeAttachmentEndpoint(attachment_cargo_lid_12);
  const node_cargo_lid_12 = new THREE.Group();
  node_cargo_lid_12.name = "Cargo Lid__pivot";
  if (endpoint_cargo_lid_12) {
    node_cargo_lid_12.position.copy(endpoint_cargo_lid_12.start);
    node_cargo_lid_12.rotation.set(0, 0, 0);
    node_cargo_lid_12.scale.set(1, 1, 1);
  } else {
    node_cargo_lid_12.position.set(0.0, 0.26, 0.0);
    node_cargo_lid_12.rotation.set(0.0, 0.0, 0.0);
    node_cargo_lid_12.scale.set(1.0, 1.0, 1.0);
  }
  node_cargo_lid_12.userData.sculptComponent = {"id": "cargo-lid", "name": "Cargo Lid", "level": "meso", "role": "lid", "importance": 0.82, "confidence": 0.98, "primitive": "box", "parent": "cargo-system", "dimensions": {"width": 0.62, "height": 0.09, "depth": 0.66, "units": "m", "confidence": 0.98}, "transform": {"position": [0, 0.26, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "overlapping beveled lid shell", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "hinged-lid", "pivot": {"mode": "hinge", "localPosition": [0, 0, -0.33], "axis": [1, 0, 0], "confidence": 0.95}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-latch", "localPosition": [0, 0, 0.33]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.62, 0.09, 0.66], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint", "cream"], "deformations": [], "joints": ["cargo-lid-hinge"], "seams": ["cargo-lid-seam"], "localFeatures": [{"id": "cargo-lid-seam", "type": "recessed seam", "width": 0.012, "depth": 0.006}, {"id": "cargo-latch-cream", "type": "raised latch"}], "evidenceRefs": ["rear-view", "top-view"], "fidelityTier": "structural-pass"};
  node_cargo_lid_12.userData.actionProfile = {"animationRole": "hinged-lid", "pivot": {"mode": "hinge", "localPosition": [0, 0, -0.33], "axis": [1, 0, 0], "confidence": 0.95}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-latch", "localPosition": [0, 0, 0.33]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.62, 0.09, 0.66], "isTrigger": false}};
  (nodes["cargo-system"] ?? root).add(node_cargo_lid_12);
  nodes["cargo-lid"] = node_cargo_lid_12;
  const mesh_cargo_lid_12Geometry = endpoint_cargo_lid_12
    ? new THREE.CylinderGeometry(endpoint_cargo_lid_12.endRadius, endpoint_cargo_lid_12.baseRadius, endpoint_cargo_lid_12.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_cargo_lid_12 = new THREE.Mesh(
    mesh_cargo_lid_12Geometry,
    materialMap["teal-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cargo_lid_12.name = "Cargo Lid";
  if (endpoint_cargo_lid_12) {
    mesh_cargo_lid_12.position.copy(endpoint_cargo_lid_12.midpoint);
    mesh_cargo_lid_12.quaternion.copy(endpoint_cargo_lid_12.quaternion);
  }
  mesh_cargo_lid_12.castShadow = options.castShadow ?? true;
  mesh_cargo_lid_12.receiveShadow = options.receiveShadow ?? true;
  mesh_cargo_lid_12.userData.sculptComponent = {"id": "cargo-lid", "name": "Cargo Lid", "level": "meso", "role": "lid", "importance": 0.82, "confidence": 0.98, "primitive": "box", "parent": "cargo-system", "dimensions": {"width": 0.62, "height": 0.09, "depth": 0.66, "units": "m", "confidence": 0.98}, "transform": {"position": [0, 0.26, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "overlapping beveled lid shell", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 3}, "deformationStack": [], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "hinged-lid", "pivot": {"mode": "hinge", "localPosition": [0, 0, -0.33], "axis": [1, 0, 0], "confidence": 0.95}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-latch", "localPosition": [0, 0, 0.33]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.62, 0.09, 0.66], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint", "cream"], "deformations": [], "joints": ["cargo-lid-hinge"], "seams": ["cargo-lid-seam"], "localFeatures": [{"id": "cargo-lid-seam", "type": "recessed seam", "width": 0.012, "depth": 0.006}, {"id": "cargo-latch-cream", "type": "raised latch"}], "evidenceRefs": ["rear-view", "top-view"], "fidelityTier": "structural-pass"};
  node_cargo_lid_12.add(mesh_cargo_lid_12);
  meshes["cargo-lid"] = mesh_cargo_lid_12;
  colliders["cargo-lid"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.62, 0.09, 0.66], "isTrigger": false};
  const socket_cargo_lid_cargo_latch_0 = new THREE.Object3D();
  socket_cargo_lid_cargo_latch_0.name = "cargo-latch";
  socket_cargo_lid_cargo_latch_0.position.set(0.0, 0.0, 0.33);
  socket_cargo_lid_cargo_latch_0.rotation.set(0, 0, 0);
  socket_cargo_lid_cargo_latch_0.userData.socket = {"id": "cargo-latch", "localPosition": [0, 0, 0.33]};
  node_cargo_lid_12.add(socket_cargo_lid_cargo_latch_0);
  sockets["cargo-lid:cargo-latch"] = socket_cargo_lid_cargo_latch_0;

  const attachment_drivetrain_13 = {"parentId": "chassis", "parentSocket": "crank-axis", "localStart": [0, 0.38, -0.18], "localEnd": [0, 0.38, -0.62], "baseRadius": 0.12, "endRadius": 0.08, "overlap": 0.035, "contactType": "socket", "gapTolerance": 0.004, "evidenceRefs": ["right-view"]};
  const endpoint_drivetrain_13 = makeAttachmentEndpoint(attachment_drivetrain_13);
  const node_drivetrain_13 = new THREE.Group();
  node_drivetrain_13.name = "Crank and Chain Guard__pivot";
  if (endpoint_drivetrain_13) {
    node_drivetrain_13.position.copy(endpoint_drivetrain_13.start);
    node_drivetrain_13.rotation.set(0, 0, 0);
    node_drivetrain_13.scale.set(1, 1, 1);
  } else {
    node_drivetrain_13.position.set(0.0, 0.0, 0.0);
    node_drivetrain_13.rotation.set(0.0, 0.0, 0.0);
    node_drivetrain_13.scale.set(1.0, 1.0, 1.0);
  }
  node_drivetrain_13.userData.sculptComponent = {"id": "drivetrain", "name": "Crank and Chain Guard", "level": "meso", "role": "connector", "importance": 0.78, "confidence": 0.92, "primitive": "cylinder", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "crank-axis", "localStart": [0, 0.38, -0.18], "localEnd": [0, 0.38, -0.62], "baseRadius": 0.12, "endRadius": 0.08, "overlap": 0.035, "contactType": "socket", "gapTolerance": 0.004, "evidenceRefs": ["right-view"]}, "dimensions": {"width": 0.28, "height": 0.25, "depth": 0.68, "units": "m", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "rounded chain guard with crank hub and pedal arms", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.025, "segments": 3}, "deformationStack": [], "uvStrategy": "box and cylindrical", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "pedal-rotation", "pivot": {"mode": "axle-center", "localPosition": [0, 0.38, -0.18], "axis": [1, 0, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "left-pedal", "localPosition": [-0.22, 0, 0]}, {"id": "right-pedal", "localPosition": [0.22, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, -0.22], "scale": [0.28, 0.25, 0.68], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer", "orange"], "deformations": [], "joints": ["crank-axis"], "seams": [], "localFeatures": [{"id": "chain-guard-inset", "type": "recessed groove", "width": 0.03, "depth": 0.01}], "evidenceRefs": ["left-view", "right-view"], "fidelityTier": "form-refinement"};
  node_drivetrain_13.userData.actionProfile = {"animationRole": "pedal-rotation", "pivot": {"mode": "axle-center", "localPosition": [0, 0.38, -0.18], "axis": [1, 0, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "left-pedal", "localPosition": [-0.22, 0, 0]}, {"id": "right-pedal", "localPosition": [0.22, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, -0.22], "scale": [0.28, 0.25, 0.68], "isTrigger": false}};
  (nodes["chassis"] ?? root).add(node_drivetrain_13);
  nodes["drivetrain"] = node_drivetrain_13;
  const mesh_drivetrain_13Geometry = endpoint_drivetrain_13
    ? new THREE.CylinderGeometry(endpoint_drivetrain_13.endRadius, endpoint_drivetrain_13.baseRadius, endpoint_drivetrain_13.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_drivetrain_13 = new THREE.Mesh(
    mesh_drivetrain_13Geometry,
    materialMap["black-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drivetrain_13.name = "Crank and Chain Guard";
  if (endpoint_drivetrain_13) {
    mesh_drivetrain_13.position.copy(endpoint_drivetrain_13.midpoint);
    mesh_drivetrain_13.quaternion.copy(endpoint_drivetrain_13.quaternion);
  }
  mesh_drivetrain_13.castShadow = options.castShadow ?? true;
  mesh_drivetrain_13.receiveShadow = options.receiveShadow ?? true;
  mesh_drivetrain_13.userData.sculptComponent = {"id": "drivetrain", "name": "Crank and Chain Guard", "level": "meso", "role": "connector", "importance": 0.78, "confidence": 0.92, "primitive": "cylinder", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "crank-axis", "localStart": [0, 0.38, -0.18], "localEnd": [0, 0.38, -0.62], "baseRadius": 0.12, "endRadius": 0.08, "overlap": 0.035, "contactType": "socket", "gapTolerance": 0.004, "evidenceRefs": ["right-view"]}, "dimensions": {"width": 0.28, "height": 0.25, "depth": 0.68, "units": "m", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "rounded chain guard with crank hub and pedal arms", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.025, "segments": 3}, "deformationStack": [], "uvStrategy": "box and cylindrical", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "pedal-rotation", "pivot": {"mode": "axle-center", "localPosition": [0, 0.38, -0.18], "axis": [1, 0, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "left-pedal", "localPosition": [-0.22, 0, 0]}, {"id": "right-pedal", "localPosition": [0.22, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, -0.22], "scale": [0.28, 0.25, 0.68], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer", "orange"], "deformations": [], "joints": ["crank-axis"], "seams": [], "localFeatures": [{"id": "chain-guard-inset", "type": "recessed groove", "width": 0.03, "depth": 0.01}], "evidenceRefs": ["left-view", "right-view"], "fidelityTier": "form-refinement"};
  node_drivetrain_13.add(mesh_drivetrain_13);
  meshes["drivetrain"] = mesh_drivetrain_13;
  colliders["drivetrain"] = {"type": "box", "offset": [0, 0, -0.22], "scale": [0.28, 0.25, 0.68], "isTrigger": false};
  const socket_drivetrain_left_pedal_0 = new THREE.Object3D();
  socket_drivetrain_left_pedal_0.name = "left-pedal";
  socket_drivetrain_left_pedal_0.position.set(-0.22, 0.0, 0.0);
  socket_drivetrain_left_pedal_0.rotation.set(0, 0, 0);
  socket_drivetrain_left_pedal_0.userData.socket = {"id": "left-pedal", "localPosition": [-0.22, 0, 0]};
  node_drivetrain_13.add(socket_drivetrain_left_pedal_0);
  sockets["drivetrain:left-pedal"] = socket_drivetrain_left_pedal_0;
  const socket_drivetrain_right_pedal_1 = new THREE.Object3D();
  socket_drivetrain_right_pedal_1.name = "right-pedal";
  socket_drivetrain_right_pedal_1.position.set(0.22, 0.0, 0.0);
  socket_drivetrain_right_pedal_1.rotation.set(0, 0, 0);
  socket_drivetrain_right_pedal_1.userData.socket = {"id": "right-pedal", "localPosition": [0.22, 0, 0]};
  node_drivetrain_13.add(socket_drivetrain_right_pedal_1);
  sockets["drivetrain:right-pedal"] = socket_drivetrain_right_pedal_1;

  const attachment_front_light_14 = {"parentId": "front-fork", "parentSocket": "headlight-root", "localStart": [0, 0.18, 0.08], "localEnd": [0, 0.18, 0.18], "baseRadius": 0.095, "endRadius": 0.08, "overlap": 0.02, "contactType": "socket", "gapTolerance": 0.002, "evidenceRefs": ["front-view", "three-quarter-view"]};
  const endpoint_front_light_14 = makeAttachmentEndpoint(attachment_front_light_14);
  const node_front_light_14 = new THREE.Group();
  node_front_light_14.name = "Round Front Light__pivot";
  if (endpoint_front_light_14) {
    node_front_light_14.position.copy(endpoint_front_light_14.start);
    node_front_light_14.rotation.set(0, 0, 0);
    node_front_light_14.scale.set(1, 1, 1);
  } else {
    node_front_light_14.position.set(0.0, 0.0, 0.0);
    node_front_light_14.rotation.set(1.5708, 0.0, 0.0);
    node_front_light_14.scale.set(1.0, 1.0, 1.0);
  }
  node_front_light_14.userData.sculptComponent = {"id": "front-light", "name": "Round Front Light", "level": "meso", "role": "connector", "importance": 0.72, "confidence": 0.98, "primitive": "cylinder", "parent": "front-fork", "attachment": {"parentId": "front-fork", "parentSocket": "headlight-root", "localStart": [0, 0.18, 0.08], "localEnd": [0, 0.18, 0.18], "baseRadius": 0.095, "endRadius": 0.08, "overlap": 0.02, "contactType": "socket", "gapTolerance": 0.002, "evidenceRefs": ["front-view", "three-quarter-view"]}, "dimensions": {"radius": 0.095, "length": 0.13, "units": "m", "confidence": 0.97}, "transform": {"position": [0, 0, 0], "rotation": [1.5708, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "concentric housing ring and inset lens", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 3}, "deformationStack": [], "uvStrategy": "cylindrical", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "light-socket", "pivot": {"mode": "socket", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "headlight-emitter", "localPosition": [0, 0, 0.07]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.19, 0.13, 0.19], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint", "cream", "lens"], "deformations": [], "joints": [], "seams": ["lens-ring"], "localFeatures": [{"id": "headlight-concentric-ring", "type": "ridge"}], "evidenceRefs": ["front-view", "three-quarter-view"], "fidelityTier": "form-refinement"};
  node_front_light_14.userData.actionProfile = {"animationRole": "light-socket", "pivot": {"mode": "socket", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "headlight-emitter", "localPosition": [0, 0, 0.07]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.19, 0.13, 0.19], "isTrigger": false}};
  (nodes["front-fork"] ?? root).add(node_front_light_14);
  nodes["front-light"] = node_front_light_14;
  const mesh_front_light_14Geometry = endpoint_front_light_14
    ? new THREE.CylinderGeometry(endpoint_front_light_14.endRadius, endpoint_front_light_14.baseRadius, endpoint_front_light_14.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_front_light_14 = new THREE.Mesh(
    mesh_front_light_14Geometry,
    materialMap["teal-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_light_14.name = "Round Front Light";
  if (endpoint_front_light_14) {
    mesh_front_light_14.position.copy(endpoint_front_light_14.midpoint);
    mesh_front_light_14.quaternion.copy(endpoint_front_light_14.quaternion);
  }
  mesh_front_light_14.castShadow = options.castShadow ?? true;
  mesh_front_light_14.receiveShadow = options.receiveShadow ?? true;
  mesh_front_light_14.userData.sculptComponent = {"id": "front-light", "name": "Round Front Light", "level": "meso", "role": "connector", "importance": 0.72, "confidence": 0.98, "primitive": "cylinder", "parent": "front-fork", "attachment": {"parentId": "front-fork", "parentSocket": "headlight-root", "localStart": [0, 0.18, 0.08], "localEnd": [0, 0.18, 0.18], "baseRadius": 0.095, "endRadius": 0.08, "overlap": 0.02, "contactType": "socket", "gapTolerance": 0.002, "evidenceRefs": ["front-view", "three-quarter-view"]}, "dimensions": {"radius": 0.095, "length": 0.13, "units": "m", "confidence": 0.97}, "transform": {"position": [0, 0, 0], "rotation": [1.5708, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "concentric housing ring and inset lens", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.008, "segments": 3}, "deformationStack": [], "uvStrategy": "cylindrical", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "light-socket", "pivot": {"mode": "socket", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "headlight-emitter", "localPosition": [0, 0, 0.07]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.19, 0.13, 0.19], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint", "cream", "lens"], "deformations": [], "joints": [], "seams": ["lens-ring"], "localFeatures": [{"id": "headlight-concentric-ring", "type": "ridge"}], "evidenceRefs": ["front-view", "three-quarter-view"], "fidelityTier": "form-refinement"};
  node_front_light_14.add(mesh_front_light_14);
  meshes["front-light"] = mesh_front_light_14;
  colliders["front-light"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.19, 0.13, 0.19], "isTrigger": false};
  const socket_front_light_headlight_emitter_0 = new THREE.Object3D();
  socket_front_light_headlight_emitter_0.name = "headlight-emitter";
  socket_front_light_headlight_emitter_0.position.set(0.0, 0.0, 0.07);
  socket_front_light_headlight_emitter_0.rotation.set(0, 0, 0);
  socket_front_light_headlight_emitter_0.userData.socket = {"id": "headlight-emitter", "localPosition": [0, 0, 0.07]};
  node_front_light_14.add(socket_front_light_headlight_emitter_0);
  sockets["front-light:headlight-emitter"] = socket_front_light_headlight_emitter_0;

  const attachment_front_mudguard_15 = null;
  const endpoint_front_mudguard_15 = makeAttachmentEndpoint(attachment_front_mudguard_15);
  const node_front_mudguard_15 = new THREE.Group();
  node_front_mudguard_15.name = "Front Mudguard__pivot";
  if (endpoint_front_mudguard_15) {
    node_front_mudguard_15.position.copy(endpoint_front_mudguard_15.start);
    node_front_mudguard_15.rotation.set(0, 0, 0);
    node_front_mudguard_15.scale.set(1, 1, 1);
  } else {
    node_front_mudguard_15.position.set(0.0, 0.02, 0.14);
    node_front_mudguard_15.rotation.set(0.0, 1.5708, 0.0);
    node_front_mudguard_15.scale.set(1.0, 1.0, 1.0);
  }
  node_front_mudguard_15.userData.sculptComponent = {"id": "front-mudguard", "name": "Front Mudguard", "level": "meso", "role": "guard", "importance": 0.62, "confidence": 0.95, "primitive": "torus", "parent": "front-fork", "dimensions": {"radius": 0.38, "width": 0.1, "height": 0.42, "depth": 0.42, "units": "m", "confidence": 0.92}, "transform": {"position": [0, 0.02, 0.14], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "upper partial wheel arch", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.006, "segments": 2}, "deformationStack": ["trim to 120 degree arc"], "uvStrategy": "toroidal", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "steering-child", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint"], "deformations": ["arc trim"], "joints": [], "seams": [], "localFeatures": [{"id": "mudguard-arch-ridge", "type": "ridge", "height": 0.006}], "evidenceRefs": ["left-view", "three-quarter-view"], "fidelityTier": "form-refinement"};
  node_front_mudguard_15.userData.actionProfile = {"animationRole": "steering-child", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}};
  (nodes["front-fork"] ?? root).add(node_front_mudguard_15);
  nodes["front-mudguard"] = node_front_mudguard_15;
  const mesh_front_mudguard_15Geometry = endpoint_front_mudguard_15
    ? new THREE.CylinderGeometry(endpoint_front_mudguard_15.endRadius, endpoint_front_mudguard_15.baseRadius, endpoint_front_mudguard_15.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_front_mudguard_15 = new THREE.Mesh(
    mesh_front_mudguard_15Geometry,
    materialMap["teal-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_mudguard_15.name = "Front Mudguard";
  if (endpoint_front_mudguard_15) {
    mesh_front_mudguard_15.position.copy(endpoint_front_mudguard_15.midpoint);
    mesh_front_mudguard_15.quaternion.copy(endpoint_front_mudguard_15.quaternion);
  }
  mesh_front_mudguard_15.castShadow = options.castShadow ?? true;
  mesh_front_mudguard_15.receiveShadow = options.receiveShadow ?? true;
  mesh_front_mudguard_15.userData.sculptComponent = {"id": "front-mudguard", "name": "Front Mudguard", "level": "meso", "role": "guard", "importance": 0.62, "confidence": 0.95, "primitive": "torus", "parent": "front-fork", "dimensions": {"radius": 0.38, "width": 0.1, "height": 0.42, "depth": 0.42, "units": "m", "confidence": 0.92}, "transform": {"position": [0, 0.02, 0.14], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "upper partial wheel arch", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.006, "segments": 2}, "deformationStack": ["trim to 120 degree arc"], "uvStrategy": "toroidal", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "steering-child", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint"], "deformations": ["arc trim"], "joints": [], "seams": [], "localFeatures": [{"id": "mudguard-arch-ridge", "type": "ridge", "height": 0.006}], "evidenceRefs": ["left-view", "three-quarter-view"], "fidelityTier": "form-refinement"};
  node_front_mudguard_15.add(mesh_front_mudguard_15);
  meshes["front-mudguard"] = mesh_front_mudguard_15;
  colliders["front-mudguard"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};

  const attachment_rear_mudguard_16 = null;
  const endpoint_rear_mudguard_16 = makeAttachmentEndpoint(attachment_rear_mudguard_16);
  const node_rear_mudguard_16 = new THREE.Group();
  node_rear_mudguard_16.name = "Rear Mudguard__pivot";
  if (endpoint_rear_mudguard_16) {
    node_rear_mudguard_16.position.copy(endpoint_rear_mudguard_16.start);
    node_rear_mudguard_16.rotation.set(0, 0, 0);
    node_rear_mudguard_16.scale.set(1, 1, 1);
  } else {
    node_rear_mudguard_16.position.set(0.0, 0.35, -0.92);
    node_rear_mudguard_16.rotation.set(0.0, 1.5708, 0.0);
    node_rear_mudguard_16.scale.set(1.0, 1.0, 1.0);
  }
  node_rear_mudguard_16.userData.sculptComponent = {"id": "rear-mudguard", "name": "Rear Mudguard", "level": "meso", "role": "guard", "importance": 0.58, "confidence": 0.94, "primitive": "torus", "parent": "chassis", "dimensions": {"radius": 0.38, "width": 0.1, "height": 0.42, "depth": 0.42, "units": "m", "confidence": 0.92}, "transform": {"position": [0, 0.35, -0.92], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "upper partial wheel arch under rack", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.006, "segments": 2}, "deformationStack": ["trim to 135 degree arc"], "uvStrategy": "toroidal", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "static-guard", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint"], "deformations": ["arc trim"], "joints": [], "seams": [], "localFeatures": [{"id": "rear-mudguard-arch", "type": "ridge"}], "evidenceRefs": ["right-view"], "fidelityTier": "form-refinement"};
  node_rear_mudguard_16.userData.actionProfile = {"animationRole": "static-guard", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}};
  (nodes["chassis"] ?? root).add(node_rear_mudguard_16);
  nodes["rear-mudguard"] = node_rear_mudguard_16;
  const mesh_rear_mudguard_16Geometry = endpoint_rear_mudguard_16
    ? new THREE.CylinderGeometry(endpoint_rear_mudguard_16.endRadius, endpoint_rear_mudguard_16.baseRadius, endpoint_rear_mudguard_16.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  const mesh_rear_mudguard_16 = new THREE.Mesh(
    mesh_rear_mudguard_16Geometry,
    materialMap["teal-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_mudguard_16.name = "Rear Mudguard";
  if (endpoint_rear_mudguard_16) {
    mesh_rear_mudguard_16.position.copy(endpoint_rear_mudguard_16.midpoint);
    mesh_rear_mudguard_16.quaternion.copy(endpoint_rear_mudguard_16.quaternion);
  }
  mesh_rear_mudguard_16.castShadow = options.castShadow ?? true;
  mesh_rear_mudguard_16.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_mudguard_16.userData.sculptComponent = {"id": "rear-mudguard", "name": "Rear Mudguard", "level": "meso", "role": "guard", "importance": 0.58, "confidence": 0.94, "primitive": "torus", "parent": "chassis", "dimensions": {"radius": 0.38, "width": 0.1, "height": 0.42, "depth": 0.42, "units": "m", "confidence": 0.92}, "transform": {"position": [0, 0.35, -0.92], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "upper partial wheel arch under rack", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.006, "segments": 2}, "deformationStack": ["trim to 135 degree arc"], "uvStrategy": "toroidal", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "static-guard", "pivot": {"mode": "hub-center", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.94}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}}, "material": "teal-paint", "materialLayers": ["teal-paint"], "deformations": ["arc trim"], "joints": [], "seams": [], "localFeatures": [{"id": "rear-mudguard-arch", "type": "ridge"}], "evidenceRefs": ["right-view"], "fidelityTier": "form-refinement"};
  node_rear_mudguard_16.add(mesh_rear_mudguard_16);
  meshes["rear-mudguard"] = mesh_rear_mudguard_16;
  colliders["rear-mudguard"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};

  const attachment_rack_support_17 = {"parentId": "chassis", "parentSocket": "rack-root", "localStart": [0, 0.74, -0.78], "localEnd": [0, 0.88, -0.72], "baseRadius": 0.025, "endRadius": 0.025, "overlap": 0.03, "contactType": "embedded", "gapTolerance": 0.003, "evidenceRefs": ["left-view", "right-view"]};
  const endpoint_rack_support_17 = makeAttachmentEndpoint(attachment_rack_support_17);
  const node_rack_support_17 = new THREE.Group();
  node_rack_support_17.name = "Cargo Rack Supports__pivot";
  if (endpoint_rack_support_17) {
    node_rack_support_17.position.copy(endpoint_rack_support_17.start);
    node_rack_support_17.rotation.set(0, 0, 0);
    node_rack_support_17.scale.set(1, 1, 1);
  } else {
    node_rack_support_17.position.set(0.0, 0.0, 0.0);
    node_rack_support_17.rotation.set(0.0, 0.0, 0.0);
    node_rack_support_17.scale.set(1.0, 1.0, 1.0);
  }
  node_rack_support_17.userData.sculptComponent = {"id": "rack-support", "name": "Cargo Rack Supports", "level": "meso", "role": "support", "importance": 0.7, "confidence": 0.92, "primitive": "cylinder", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "rack-root", "localStart": [0, 0.74, -0.78], "localEnd": [0, 0.88, -0.72], "baseRadius": 0.025, "endRadius": 0.025, "overlap": 0.03, "contactType": "embedded", "gapTolerance": 0.003, "evidenceRefs": ["left-view", "right-view"]}, "dimensions": {"width": 0.48, "height": 0.28, "depth": 0.5, "units": "m", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "paired black tubular rack braces", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.004, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "cargo-support", "pivot": {"mode": "root", "localPosition": [0, 0.74, -0.78], "axis": [1, 0, 0], "confidence": 0.92}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-base", "localPosition": [0, 0.16, 0.04]}], "collider": {"type": "box", "offset": [0, 0.12, 0], "scale": [0.48, 0.28, 0.5], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["left-view", "right-view"], "fidelityTier": "structural-pass"};
  node_rack_support_17.userData.actionProfile = {"animationRole": "cargo-support", "pivot": {"mode": "root", "localPosition": [0, 0.74, -0.78], "axis": [1, 0, 0], "confidence": 0.92}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-base", "localPosition": [0, 0.16, 0.04]}], "collider": {"type": "box", "offset": [0, 0.12, 0], "scale": [0.48, 0.28, 0.5], "isTrigger": false}};
  (nodes["chassis"] ?? root).add(node_rack_support_17);
  nodes["rack-support"] = node_rack_support_17;
  const mesh_rack_support_17Geometry = endpoint_rack_support_17
    ? new THREE.CylinderGeometry(endpoint_rack_support_17.endRadius, endpoint_rack_support_17.baseRadius, endpoint_rack_support_17.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_rack_support_17 = new THREE.Mesh(
    mesh_rack_support_17Geometry,
    materialMap["black-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rack_support_17.name = "Cargo Rack Supports";
  if (endpoint_rack_support_17) {
    mesh_rack_support_17.position.copy(endpoint_rack_support_17.midpoint);
    mesh_rack_support_17.quaternion.copy(endpoint_rack_support_17.quaternion);
  }
  mesh_rack_support_17.castShadow = options.castShadow ?? true;
  mesh_rack_support_17.receiveShadow = options.receiveShadow ?? true;
  mesh_rack_support_17.userData.sculptComponent = {"id": "rack-support", "name": "Cargo Rack Supports", "level": "meso", "role": "support", "importance": 0.7, "confidence": 0.92, "primitive": "cylinder", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "rack-root", "localStart": [0, 0.74, -0.78], "localEnd": [0, 0.88, -0.72], "baseRadius": 0.025, "endRadius": 0.025, "overlap": 0.03, "contactType": "embedded", "gapTolerance": 0.003, "evidenceRefs": ["left-view", "right-view"]}, "dimensions": {"width": 0.48, "height": 0.28, "depth": 0.5, "units": "m", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "paired black tubular rack braces", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.004, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "cargo-support", "pivot": {"mode": "root", "localPosition": [0, 0.74, -0.78], "axis": [1, 0, 0], "confidence": 0.92}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-base", "localPosition": [0, 0.16, 0.04]}], "collider": {"type": "box", "offset": [0, 0.12, 0], "scale": [0.48, 0.28, 0.5], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "evidenceRefs": ["left-view", "right-view"], "fidelityTier": "structural-pass"};
  node_rack_support_17.add(mesh_rack_support_17);
  meshes["rack-support"] = mesh_rack_support_17;
  colliders["rack-support"] = {"type": "box", "offset": [0, 0.12, 0], "scale": [0.48, 0.28, 0.5], "isTrigger": false};
  const socket_rack_support_cargo_base_0 = new THREE.Object3D();
  socket_rack_support_cargo_base_0.name = "cargo-base";
  socket_rack_support_cargo_base_0.position.set(0.0, 0.16, 0.04);
  socket_rack_support_cargo_base_0.rotation.set(0, 0, 0);
  socket_rack_support_cargo_base_0.userData.socket = {"id": "cargo-base", "localPosition": [0, 0.16, 0.04]};
  node_rack_support_17.add(socket_rack_support_cargo_base_0);
  sockets["rack-support:cargo-base"] = socket_rack_support_cargo_base_0;

  const attachment_rear_light_18 = null;
  const endpoint_rear_light_18 = makeAttachmentEndpoint(attachment_rear_light_18);
  const node_rear_light_18 = new THREE.Group();
  node_rear_light_18.name = "Rear Red Light__pivot";
  if (endpoint_rear_light_18) {
    node_rear_light_18.position.copy(endpoint_rear_light_18.start);
    node_rear_light_18.rotation.set(0, 0, 0);
    node_rear_light_18.scale.set(1, 1, 1);
  } else {
    node_rear_light_18.position.set(0.0, -0.25, -0.335);
    node_rear_light_18.rotation.set(0.0, 0.0, 0.0);
    node_rear_light_18.scale.set(1.0, 1.0, 1.0);
  }
  node_rear_light_18.userData.sculptComponent = {"id": "rear-light", "name": "Rear Red Light", "level": "meso", "role": "light", "importance": 0.58, "confidence": 0.98, "primitive": "box", "parent": "cargo-system", "dimensions": {"width": 0.16, "height": 0.1, "depth": 0.05, "units": "m", "confidence": 0.97}, "transform": {"position": [0, -0.25, -0.335], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "beveled red lens block", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "light-socket", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-light-emitter", "localPosition": [0, 0, -0.03]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.1, 0.05], "isTrigger": false}}, "material": "orange", "materialLayers": ["orange", "lens"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-light-gloss", "type": "gloss"}], "evidenceRefs": ["rear-view"], "fidelityTier": "form-refinement"};
  node_rear_light_18.userData.actionProfile = {"animationRole": "light-socket", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-light-emitter", "localPosition": [0, 0, -0.03]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.1, 0.05], "isTrigger": false}};
  (nodes["cargo-system"] ?? root).add(node_rear_light_18);
  nodes["rear-light"] = node_rear_light_18;
  const mesh_rear_light_18Geometry = endpoint_rear_light_18
    ? new THREE.CylinderGeometry(endpoint_rear_light_18.endRadius, endpoint_rear_light_18.baseRadius, endpoint_rear_light_18.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_rear_light_18 = new THREE.Mesh(
    mesh_rear_light_18Geometry,
    materialMap["orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_light_18.name = "Rear Red Light";
  if (endpoint_rear_light_18) {
    mesh_rear_light_18.position.copy(endpoint_rear_light_18.midpoint);
    mesh_rear_light_18.quaternion.copy(endpoint_rear_light_18.quaternion);
  }
  mesh_rear_light_18.castShadow = options.castShadow ?? true;
  mesh_rear_light_18.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_light_18.userData.sculptComponent = {"id": "rear-light", "name": "Rear Red Light", "level": "meso", "role": "light", "importance": 0.58, "confidence": 0.98, "primitive": "box", "parent": "cargo-system", "dimensions": {"width": 0.16, "height": 0.1, "depth": 0.05, "units": "m", "confidence": 0.97}, "transform": {"position": [0, -0.25, -0.335], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "beveled red lens block", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.015, "segments": 3}, "deformationStack": [], "uvStrategy": "box projection", "normalStrategy": "weighted"}, "actionProfile": {"animationRole": "light-socket", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.98}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-light-emitter", "localPosition": [0, 0, -0.03]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.1, 0.05], "isTrigger": false}}, "material": "orange", "materialLayers": ["orange", "lens"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-light-gloss", "type": "gloss"}], "evidenceRefs": ["rear-view"], "fidelityTier": "form-refinement"};
  node_rear_light_18.add(mesh_rear_light_18);
  meshes["rear-light"] = mesh_rear_light_18;
  colliders["rear-light"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.16, 0.1, 0.05], "isTrigger": false};
  const socket_rear_light_rear_light_emitter_0 = new THREE.Object3D();
  socket_rear_light_rear_light_emitter_0.name = "rear-light-emitter";
  socket_rear_light_rear_light_emitter_0.position.set(0.0, 0.0, -0.03);
  socket_rear_light_rear_light_emitter_0.rotation.set(0, 0, 0);
  socket_rear_light_rear_light_emitter_0.userData.socket = {"id": "rear-light-emitter", "localPosition": [0, 0, -0.03]};
  node_rear_light_18.add(socket_rear_light_rear_light_emitter_0);
  sockets["rear-light:rear-light-emitter"] = socket_rear_light_rear_light_emitter_0;

  const attachment_kickstand_19 = {"parentId": "chassis", "parentSocket": "rack-root", "localStart": [-0.1, 0.38, -0.58], "localEnd": [-0.2, 0.03, -0.68], "baseRadius": 0.018, "endRadius": 0.014, "overlap": 0.02, "contactType": "hinge", "gapTolerance": 0.003, "evidenceRefs": ["rear-view", "left-view"]};
  const endpoint_kickstand_19 = makeAttachmentEndpoint(attachment_kickstand_19);
  const node_kickstand_19 = new THREE.Group();
  node_kickstand_19.name = "Left Kickstand__pivot";
  if (endpoint_kickstand_19) {
    node_kickstand_19.position.copy(endpoint_kickstand_19.start);
    node_kickstand_19.rotation.set(0, 0, 0);
    node_kickstand_19.scale.set(1, 1, 1);
  } else {
    node_kickstand_19.position.set(0.0, 0.0, 0.0);
    node_kickstand_19.rotation.set(0.0, 0.0, 0.0);
    node_kickstand_19.scale.set(1.0, 1.0, 1.0);
  }
  node_kickstand_19.userData.sculptComponent = {"id": "kickstand", "name": "Left Kickstand", "level": "meso", "role": "leg", "importance": 0.42, "confidence": 0.9, "primitive": "cylinder", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "rack-root", "localStart": [-0.1, 0.38, -0.58], "localEnd": [-0.2, 0.03, -0.68], "baseRadius": 0.018, "endRadius": 0.014, "overlap": 0.02, "contactType": "hinge", "gapTolerance": 0.003, "evidenceRefs": ["rear-view", "left-view"]}, "dimensions": {"radius": 0.018, "length": 0.38, "units": "m", "confidence": 0.88}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "tapered deployed support leg", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.003, "segments": 2}, "deformationStack": ["rearward lean"], "uvStrategy": "cylindrical", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "kickstand-hinge", "pivot": {"mode": "hinge", "localPosition": [-0.1, 0.38, -0.58], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [-0.15, 0.2, -0.63], "scale": [0.04, 0.38, 0.04], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer"], "deformations": ["rear lean"], "joints": ["kickstand-hinge"], "seams": [], "localFeatures": [], "evidenceRefs": ["rear-view", "left-view"], "fidelityTier": "interaction-pass"};
  node_kickstand_19.userData.actionProfile = {"animationRole": "kickstand-hinge", "pivot": {"mode": "hinge", "localPosition": [-0.1, 0.38, -0.58], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [-0.15, 0.2, -0.63], "scale": [0.04, 0.38, 0.04], "isTrigger": false}};
  (nodes["chassis"] ?? root).add(node_kickstand_19);
  nodes["kickstand"] = node_kickstand_19;
  const mesh_kickstand_19Geometry = endpoint_kickstand_19
    ? new THREE.CylinderGeometry(endpoint_kickstand_19.endRadius, endpoint_kickstand_19.baseRadius, endpoint_kickstand_19.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_kickstand_19 = new THREE.Mesh(
    mesh_kickstand_19Geometry,
    materialMap["black-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_kickstand_19.name = "Left Kickstand";
  if (endpoint_kickstand_19) {
    mesh_kickstand_19.position.copy(endpoint_kickstand_19.midpoint);
    mesh_kickstand_19.quaternion.copy(endpoint_kickstand_19.quaternion);
  }
  mesh_kickstand_19.castShadow = options.castShadow ?? true;
  mesh_kickstand_19.receiveShadow = options.receiveShadow ?? true;
  mesh_kickstand_19.userData.sculptComponent = {"id": "kickstand", "name": "Left Kickstand", "level": "meso", "role": "leg", "importance": 0.42, "confidence": 0.9, "primitive": "cylinder", "parent": "chassis", "attachment": {"parentId": "chassis", "parentSocket": "rack-root", "localStart": [-0.1, 0.38, -0.58], "localEnd": [-0.2, 0.03, -0.68], "baseRadius": 0.018, "endRadius": 0.014, "overlap": 0.02, "contactType": "hinge", "gapTolerance": 0.003, "evidenceRefs": ["rear-view", "left-view"]}, "dimensions": {"radius": 0.018, "length": 0.38, "units": "m", "confidence": 0.88}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "geometryDescriptor": {"topologyIntent": "tapered deployed support leg", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.003, "segments": 2}, "deformationStack": ["rearward lean"], "uvStrategy": "cylindrical", "normalStrategy": "smooth"}, "actionProfile": {"animationRole": "kickstand-hinge", "pivot": {"mode": "hinge", "localPosition": [-0.1, 0.38, -0.58], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [-0.15, 0.2, -0.63], "scale": [0.04, 0.38, 0.04], "isTrigger": false}}, "material": "black-polymer", "materialLayers": ["black-polymer"], "deformations": ["rear lean"], "joints": ["kickstand-hinge"], "seams": [], "localFeatures": [], "evidenceRefs": ["rear-view", "left-view"], "fidelityTier": "interaction-pass"};
  node_kickstand_19.add(mesh_kickstand_19);
  meshes["kickstand"] = mesh_kickstand_19;
  colliders["kickstand"] = {"type": "capsule", "offset": [-0.15, 0.2, -0.63], "scale": [0.04, 0.38, 0.04], "isTrigger": false};

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createDeliveryCargoBikeLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Delivery Cargo Bike look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Key light: large warm area light from front-left and above, 4800 K, soft shadows, intensity 3.0.", "Fill and environment: cool neutral hemisphere fill from camera-right, strength 0.65, gray studio world at 0.35.", "Rim and output: soft rear-right area rim at 5200 K; ACES/Filmic tone mapping, exposure +0.3, light gray background, contact shadow and ground AO under tires."];
  lights.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}
