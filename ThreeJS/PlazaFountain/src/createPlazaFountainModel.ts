import * as THREE from 'three';

export type FountainBuildPass =
  | 'blockout'
  | 'structural-pass'
  | 'form-refinement'
  | 'material-pass'
  | 'surface-pass'
  | 'lighting-pass'
  | 'interaction-pass'
  | 'optimization-pass'
  | 'final';

export type PlazaFountainOptions = {
  buildPass?: FountainBuildPass;
  castShadow?: boolean;
  receiveShadow?: boolean;
};

export type PlazaFountainRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

const passRank: Record<FountainBuildPass, number> = {
  blockout: 0,
  'structural-pass': 1,
  'form-refinement': 2,
  'material-pass': 3,
  'surface-pass': 4,
  'lighting-pass': 5,
  'interaction-pass': 6,
  'optimization-pass': 7,
  final: 7,
};

function hash2(x: number, y: number, seed: number): number {
  let value = Math.imul(x + seed * 17, 374761393) ^ Math.imul(y + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function createRoughnessMap(seed: number, base: number, variation: number): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = hash2(Math.floor(x / 12), Math.floor(y / 12), seed);
      const micro = hash2(x, y, seed + 211);
      const value = THREE.MathUtils.clamp(base + (broad - 0.5) * variation + (micro - 0.5) * variation * 0.35, 0, 1);
      const offset = (y * size + x) * 4;
      const channel = Math.round(value * 255);
      data[offset] = channel;
      data[offset + 1] = channel;
      data[offset + 2] = channel;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createNormalMap(seed: number, strength: number, ripple = false): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size - 0.5;
      const v = y / size - 0.5;
      const r = Math.hypot(u, v);
      const phase = ripple ? Math.sin(r * 70 + seed) * 0.65 + Math.sin((u + v) * 43) * 0.35 : hash2(x, y, seed) * 2 - 1;
      const phase2 = ripple ? Math.cos(r * 67 + seed * 0.31) : hash2(x + 1, y + 3, seed + 97) * 2 - 1;
      const nx = phase * strength;
      const ny = phase2 * strength;
      const nz = Math.sqrt(Math.max(0.001, 1 - Math.min(0.9, nx * nx + ny * ny)));
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round(nz * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(ripple ? 2 : 4, ripple ? 2 : 4);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(rank: number) {
  const surface = rank >= passRank['surface-pass'];
  const material = rank >= passRank['material-pass'];
  const limestone = new THREE.MeshStandardMaterial({
    name: 'M_Limestone',
    color: material ? '#d7c7a6' : '#bcb6a9',
    roughness: material ? 0.68 : 0.88,
    metalness: 0,
    transparent: false,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    roughnessMap: surface ? createRoughnessMap(19, 0.72, 0.16) : null,
    normalMap: surface ? createNormalMap(31, 0.09) : null,
    normalScale: new THREE.Vector2(0.26, 0.26),
  });
  const ceramic = new THREE.MeshPhysicalMaterial({
    name: 'M_Teal_Ceramic',
    color: material ? '#527b75' : '#718884',
    roughness: material ? 0.42 : 0.68,
    metalness: 0,
    clearcoat: material ? 0.35 : 0,
    clearcoatRoughness: 0.18,
    roughnessMap: surface ? createRoughnessMap(41, 0.34, 0.08) : null,
    normalMap: surface ? createNormalMap(47, 0.035) : null,
    normalScale: new THREE.Vector2(0.12, 0.12),
  });
  const water = new THREE.MeshPhysicalMaterial({
    name: 'M_Water',
    color: material ? '#2f8587' : '#739e9c',
    roughness: material ? 0.19 : 0.42,
    metalness: 0,
    transmission: 0,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.DoubleSide,
    normalMap: surface ? createNormalMap(73, 0.22, true) : null,
    normalScale: new THREE.Vector2(0.42, 0.42),
  });
  const jetWater = water.clone();
  jetWater.name = 'M_Water_RuntimeJet';
  jetWater.color.set(material ? '#e7f5f2' : '#c5ddda');
  jetWater.roughness = 0.08;
  jetWater.transmission = material ? 0.1 : 0;
  jetWater.transparent = true;
  jetWater.opacity = material ? 0.78 : 0.68;
  jetWater.depthWrite = false;
  jetWater.emissive.set(material ? '#365c58' : '#294946');
  jetWater.emissiveIntensity = 0.12;
  const copper = new THREE.MeshStandardMaterial({
    name: 'M_Aged_Copper',
    color: material ? '#965c45' : '#82766b',
    roughness: material ? 0.42 : 0.65,
    metalness: material ? 0.62 : 0.05,
    transparent: false,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    roughnessMap: surface ? createRoughnessMap(89, 0.38, 0.12) : null,
    normalMap: surface ? createNormalMap(97, 0.04) : null,
    normalScale: new THREE.Vector2(0.1, 0.1),
  });
  const recess = new THREE.MeshStandardMaterial({
    name: 'M_Dark_Teal_Recess',
    color: material ? '#6c8580' : '#646f6d',
    roughness: material ? 0.58 : 0.78,
    metalness: 0,
    roughnessMap: surface ? createRoughnessMap(109, 0.57, 0.08) : null,
  });
  return { limestone, ceramic, water, jetWater, copper, recess };
}

function panelGeometry(widthBottom: number, widthTop: number, height: number, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-widthBottom, -height / 2);
  shape.lineTo(widthBottom, -height / 2);
  shape.lineTo(widthTop, height / 2);
  shape.lineTo(-widthTop, height / 2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: Math.min(0.012, depth * 0.4),
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function upperBowlGeometry(): THREE.LatheGeometry {
  const profile = [
    new THREE.Vector2(0.15, -0.12), new THREE.Vector2(0.23, -0.115),
    new THREE.Vector2(0.3, -0.085), new THREE.Vector2(0.35, -0.035),
    new THREE.Vector2(0.355, 0.012), new THREE.Vector2(0.33, 0.045),
    new THREE.Vector2(0.29, 0.05), new THREE.Vector2(0.255, 0.025),
    new THREE.Vector2(0.22, -0.022), new THREE.Vector2(0.18, -0.072),
    new THREE.Vector2(0.15, -0.09),
  ];
  return new THREE.LatheGeometry(profile, 56);
}

function finialGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.08, 0), new THREE.Vector2(0.105, 0.025),
    new THREE.Vector2(0.118, 0.068), new THREE.Vector2(0.114, 0.115),
    new THREE.Vector2(0.095, 0.165), new THREE.Vector2(0.06, 0.21),
    new THREE.Vector2(0.022, 0.252), new THREE.Vector2(0, 0.27),
  ];
  const radialSegments = 64;
  const ringCount = profile.length - 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring < ringCount; ring += 1) {
    const point = profile[ring];
    const grooveEnvelope = THREE.MathUtils.smoothstep(point.y, 0.035, 0.085)
      * (1 - THREE.MathUtils.smoothstep(point.y, 0.205, 0.252));
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const theta = segment / radialSegments * Math.PI * 2;
      const grooveCenter = Math.pow(Math.max(0, Math.cos(theta * 8)), 12);
      const radius = point.x - grooveCenter * grooveEnvelope * 0.0055;
      positions.push(Math.sin(theta) * radius, point.y, Math.cos(theta) * radius);
      uvs.push(segment / radialSegments, point.y / 0.27);
    }
  }

  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      const a = ring * radialSegments + segment;
      const b = ring * radialSegments + next;
      const c = (ring + 1) * radialSegments + segment;
      const d = (ring + 1) * radialSegments + next;
      indices.push(a, b, c, b, d, c);
    }
  }

  const bottomCenter = positions.length / 3;
  positions.push(0, profile[0].y, 0);
  uvs.push(0.5, 0.5);
  for (let segment = 0; segment < radialSegments; segment += 1) {
    indices.push(bottomCenter, (segment + 1) % radialSegments, segment);
  }

  const topPole = positions.length / 3;
  positions.push(0, profile[profile.length - 1].y, 0);
  uvs.push(0.5, 1);
  const topRingStart = (ringCount - 1) * radialSegments;
  for (let segment = 0; segment < radialSegments; segment += 1) {
    indices.push(topRingStart + segment, topRingStart + (segment + 1) % radialSegments, topPole);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.detail = 'eight-recessed-radial-channels-integrated-into-stone-surface';
  return geometry;
}

function fishHeadGeometry(): THREE.BufferGeometry {
  const sections = [
    { z: 0.042, y: 0.018, rx: 0.052, ry: 0.052 },
    { z: 0.074, y: 0.021, rx: 0.071, ry: 0.069 },
    { z: 0.112, y: 0.018, rx: 0.083, ry: 0.083 },
    { z: 0.151, y: 0.008, rx: 0.079, ry: 0.074 },
    { z: 0.184, y: -0.007, rx: 0.066, ry: 0.06 },
    { z: 0.211, y: -0.019, rx: 0.049, ry: 0.044 },
  ];
  const radialSegments = 24;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const theta = segment / radialSegments * Math.PI * 2;
      positions.push(
        Math.cos(theta) * section.rx,
        section.y + Math.sin(theta) * section.ry,
        section.z,
      );
      uvs.push(segment / radialSegments, sectionIndex / (sections.length - 1));
    }
  }

  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    const row = sectionIndex * radialSegments;
    const nextRow = (sectionIndex + 1) * radialSegments;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      const a = row + segment;
      const b = row + next;
      const c = nextRow + segment;
      const d = nextRow + next;
      indices.push(a, b, c, b, d, c);
    }
  }

  const back = sections[0];
  const backCenter = positions.length / 3;
  positions.push(0, back.y, back.z);
  uvs.push(0.5, 0);
  for (let segment = 0; segment < radialSegments; segment += 1) {
    indices.push(backCenter, (segment + 1) % radialSegments, segment);
  }

  const front = sections[sections.length - 1];
  const frontCenter = positions.length / 3;
  positions.push(0, front.y, front.z);
  uvs.push(0.5, 1);
  const frontRow = (sections.length - 1) * radialSegments;
  for (let segment = 0; segment < radialSegments; segment += 1) {
    indices.push(frontCenter, frontRow + segment, frontRow + (segment + 1) % radialSegments);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.detail = 'tapered-fish-cranium-with-broad-cheeks-and-short-muzzle-root';
  return geometry;
}

function surfaceRibbonGeometry(
  points: THREE.Vector3[],
  surfaceNormals: THREE.Vector3[],
  angle: number,
  width: number,
  depth = 0.0006,
): THREE.BufferGeometry {
  const side = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)).multiplyScalar(width * 0.5);
  const positions: number[] = [];
  const indices: number[] = [];
  const topOffset = 0.00002;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const normal = surfaceNormals[index].clone().normalize();
    const topCenter = point.clone().addScaledVector(normal, topOffset);
    const bottomCenter = point.clone().addScaledVector(normal, -depth);
    const topLeft = topCenter.clone().sub(side);
    const topRight = topCenter.clone().add(side);
    const bottomLeft = bottomCenter.clone().sub(side);
    const bottomRight = bottomCenter.clone().add(side);
    positions.push(
      topLeft.x, topLeft.y, topLeft.z,
      topRight.x, topRight.y, topRight.z,
      bottomLeft.x, bottomLeft.y, bottomLeft.z,
      bottomRight.x, bottomRight.y, bottomRight.z,
    );
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const base = index * 4;
    const next = base + 4;
    indices.push(
      base, next, base + 1, base + 1, next, next + 1,
      base + 2, base + 3, next + 2, base + 3, next + 3, next + 2,
      base + 2, next + 2, base, base, next + 2, next,
      base + 1, next + 1, base + 3, base + 3, next + 1, next + 3,
    );
  }

  const last = (points.length - 1) * 4;
  indices.push(0, 1, 2, 1, 3, 2, last, last + 2, last + 1, last + 1, last + 2, last + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function torusStoneSegmentGeometry(
  majorRadius: number,
  minorRadius: number,
  radialSegments: number,
  tubularSegments: number,
  arcStart: number,
  arcLength: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let tubeIndex = 0; tubeIndex <= tubularSegments; tubeIndex += 1) {
    const theta = arcStart + arcLength * tubeIndex / tubularSegments;
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
      const phi = radialIndex * Math.PI * 2 / radialSegments;
      const radial = majorRadius + Math.cos(phi) * minorRadius;
      positions.push(Math.sin(theta) * radial, Math.sin(phi) * minorRadius, Math.cos(theta) * radial);
    }
  }

  for (let tubeIndex = 0; tubeIndex < tubularSegments; tubeIndex += 1) {
    const row = tubeIndex * radialSegments;
    const nextRow = (tubeIndex + 1) * radialSegments;
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
      const nextRadial = (radialIndex + 1) % radialSegments;
      const a = row + radialIndex;
      const b = nextRow + radialIndex;
      const c = nextRow + nextRadial;
      const d = row + nextRadial;
      indices.push(a, b, d, b, c, d);
    }
  }

  const startCenter = positions.length / 3;
  positions.push(Math.sin(arcStart) * majorRadius, 0, Math.cos(arcStart) * majorRadius);
  const endAngle = arcStart + arcLength;
  const endCenter = positions.length / 3;
  positions.push(Math.sin(endAngle) * majorRadius, 0, Math.cos(endAngle) * majorRadius);
  const endRow = tubularSegments * radialSegments;
  for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
    const nextRadial = (radialIndex + 1) % radialSegments;
    indices.push(startCenter, radialIndex, nextRadial);
    indices.push(endCenter, endRow + nextRadial, endRow + radialIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPlazaFountainModel(options: PlazaFountainOptions = {}): THREE.Group {
  const buildPass = options.buildPass ?? 'final';
  const rank = passRank[buildPass];
  const materials = createMaterials(rank);
  const runtime: PlazaFountainRuntime = { nodes: {}, meshes: {}, sockets: {}, colliders: {}, destructionGroups: {} };
  const root = new THREE.Group();
  root.name = 'PlazaFountain';
  runtime.nodes[root.name] = root;

  const makeGroup = (name: string, parent: THREE.Object3D, position = new THREE.Vector3()) => {
    const group = new THREE.Group();
    group.name = name;
    group.position.copy(position);
    parent.add(group);
    runtime.nodes[name] = group;
    return group;
  };

  const addMesh = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
    position = new THREE.Vector3(),
    rotation = new THREE.Euler(),
    scale = new THREE.Vector3(1, 1, 1),
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.copy(position);
    mesh.rotation.copy(rotation);
    mesh.scale.copy(scale);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    parent.add(mesh);
    runtime.meshes[name] = mesh;
    return mesh;
  };

  const addSocket = (name: string, parent: THREE.Object3D, position: THREE.Vector3) => {
    const socket = new THREE.Object3D();
    socket.name = name;
    socket.position.copy(position);
    parent.add(socket);
    runtime.sockets[name] = socket;
    return socket;
  };

  const addSegmentedStoneRim = (
    name: string,
    parent: THREE.Object3D,
    majorRadius: number,
    minorRadius: number,
    centerY: number,
    segmentCount: number,
    radialSegments: number,
    tubularSegmentsPerStone: number,
    gapWidth: number,
  ) => {
    const group = makeGroup(name, parent, new THREE.Vector3(0, centerY, 0));
    const sector = Math.PI * 2 / segmentCount;
    const gapAngle = gapWidth / majorRadius;
    for (let index = 0; index < segmentCount; index += 1) {
      const arcStart = index * sector + gapAngle * 0.5;
      const geometry = torusStoneSegmentGeometry(
        majorRadius,
        minorRadius,
        radialSegments,
        tubularSegmentsPerStone,
        arcStart,
        sector - gapAngle,
      );
      addMesh(`${name}_Stone_${String(index + 1).padStart(2, '0')}`, geometry, materials.limestone, group);
    }
    group.userData.segmentCount = segmentCount;
    group.userData.seamRepresentation = 'physical-capped-gap';
    return group;
  };

  const plinth = makeGroup('Plinth_System', root);
  addMesh('Plinth_Lower', new THREE.CylinderGeometry(1.34, 1.34, 0.08, 8), materials.limestone, plinth, new THREE.Vector3(0, 0.04, 0));
  addMesh('Plinth_Lower_Bevel', new THREE.CylinderGeometry(1.29, 1.34, 0.06, 8), materials.limestone, plinth, new THREE.Vector3(0, 0.11, 0));
  addMesh('Plinth_Lower_Ledge', new THREE.CylinderGeometry(1.29, 1.29, 0.04, 8), materials.limestone, plinth, new THREE.Vector3(0, 0.16, 0));
  addMesh('Plinth_Upper', new THREE.CylinderGeometry(1.2, 1.2, 0.12, 8), materials.limestone, plinth, new THREE.Vector3(0, 0.24, 0));
  addMesh('Plinth_Upper_Bevel', new THREE.CylinderGeometry(1.15, 1.2, 0.06, 8), materials.limestone, plinth, new THREE.Vector3(0, 0.33, 0));
  addMesh('Plinth_Upper_Ledge', new THREE.CylinderGeometry(1.15, 1.15, 0.04, 8), materials.limestone, plinth, new THREE.Vector3(0, 0.38, 0));

  const lowerBasin = makeGroup('LowerBasin_System', root);
  addMesh('LowerBasin_Wall', new THREE.CylinderGeometry(1.0, 1.06, 0.26, 16), materials.limestone, lowerBasin, new THREE.Vector3(0, 0.53, 0));
  addMesh('LowerBasin_Wall_Base', new THREE.TorusGeometry(1.0, 0.028, 6, 64), materials.limestone, lowerBasin, new THREE.Vector3(0, 0.41, 0), new THREE.Euler(Math.PI / 2, 0, 0));
  addSegmentedStoneRim('LowerBasin_Rim', lowerBasin, 0.97, 0.09, 0.69, 16, 10, 5, 0.0045);
  addMesh('LowerBasin_InnerBand', new THREE.TorusGeometry(0.86, 0.014, 6, 72), materials.recess, lowerBasin, new THREE.Vector3(0, 0.706, 0), new THREE.Euler(Math.PI / 2, 0, 0));
  addMesh('LowerBasin_TealUnderlay', new THREE.CylinderGeometry(0.86, 0.86, 0.012, 72), materials.recess, lowerBasin, new THREE.Vector3(0, 0.7, 0));
  const lowerWater = addMesh('LowerWater_Surface', new THREE.CylinderGeometry(0.86, 0.86, 0.014, 72), materials.water, lowerBasin, new THREE.Vector3(0, 0.71, 0));
  lowerWater.renderOrder = 2;
  addSocket('WaterLower_Socket', lowerBasin, new THREE.Vector3(0, 0.722, 0));

  const tower = makeGroup('Tower_System', root);
  addMesh('Pedestal_Body', new THREE.CylinderGeometry(0.36, 0.46, 0.72, 8), materials.limestone, tower, new THREE.Vector3(0, 1.1, 0));
  addMesh('Pedestal_Base', new THREE.CylinderGeometry(0.49, 0.52, 0.13, 8), materials.limestone, tower, new THREE.Vector3(0, 0.76, 0));
  addMesh('Pedestal_Base_Trim', new THREE.CylinderGeometry(0.47, 0.49, 0.06, 8), materials.limestone, tower, new THREE.Vector3(0, 0.845, 0));
  addMesh('Pedestal_Cap', new THREE.CylinderGeometry(0.42, 0.45, 0.08, 8), materials.limestone, tower, new THREE.Vector3(0, 1.47, 0));
  addMesh('Pedestal_Cap_Lip', new THREE.CylinderGeometry(0.45, 0.45, 0.06, 8), materials.limestone, tower, new THREE.Vector3(0, 1.54, 0));

  const upperPivot = makeGroup('UpperBowl_Pivot', root, new THREE.Vector3(0, 1.75, 0));
  addMesh('UpperBowl', upperBowlGeometry(), materials.limestone, upperPivot);
  addSegmentedStoneRim('UpperBowl_Rim', upperPivot, 0.335, 0.045, 0.052, 8, 9, 7, 0.003);
  const upperWater = addMesh('UpperWater_Surface', new THREE.CylinderGeometry(0.285, 0.285, 0.014, 56), materials.water, upperPivot, new THREE.Vector3(0, 0.073, 0));
  upperWater.renderOrder = 2;
  addSocket('WaterUpper_Socket', upperPivot, new THREE.Vector3(0, 0.092, 0));

  const finialPivot = makeGroup('Finial_Pivot', upperPivot, new THREE.Vector3(0, 0.1, 0));
  addMesh('Finial_Base', new THREE.CylinderGeometry(0.09, 0.105, 0.065, 24), materials.limestone, finialPivot, new THREE.Vector3(0, 0.033, 0));
  addMesh('Finial_CopperCollar', new THREE.TorusGeometry(0.09, 0.017, 7, 32), materials.copper, finialPivot, new THREE.Vector3(0, 0.072, 0), new THREE.Euler(Math.PI / 2, 0, 0));
  addMesh('Finial', finialGeometry(), materials.limestone, finialPivot, new THREE.Vector3(0, 0.06, 0));

  if (rank >= passRank['structural-pass']) {
    const panelFrameGeo = panelGeometry(0.18, 0.145, 0.55, 0.032, 0.016);
    const panelInsetGeo = panelGeometry(0.145, 0.108, 0.46, 0.026, 0.012);
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2 + Math.PI / 4;
      const panelRoot = makeGroup(
        `PedestalPanel_${index + 1}`,
        tower,
        new THREE.Vector3(Math.sin(angle) * 0.405, 1.12, Math.cos(angle) * 0.405),
      );
      panelRoot.rotation.y = angle;
      addMesh(`PedestalPanelFrame_${index + 1}`, panelFrameGeo, materials.limestone, panelRoot);
      const panel = addMesh(`PedestalPanelInset_${index + 1}`, panelInsetGeo, materials.recess, panelRoot, new THREE.Vector3(0, 0, 0.027));
      panel.userData.radialSystem = 'radial-pedestal-panels';
    }
    addMesh('CopperBand_Upper', new THREE.TorusGeometry(0.255, 0.016, 7, 48), materials.copper, upperPivot, new THREE.Vector3(0, -0.145, 0), new THREE.Euler(Math.PI / 2, 0, 0));

    const neckGeometry = new THREE.CylinderGeometry(0.052, 0.074, 0.11, 16);
    neckGeometry.rotateX(Math.PI / 2);
    const headGeometry = fishHeadGeometry();
    const detailSphereGeometry = new THREE.SphereGeometry(1, 14, 10);
    const eyeGeometry = new THREE.SphereGeometry(1, 12, 9);
    const pupilGeometry = new THREE.SphereGeometry(1, 10, 8);
    const mouthGeometry = new THREE.TorusGeometry(0.029, 0.008, 7, 20);
    const mouthCavityGeometry = new THREE.CircleGeometry(0.027, 20);
    const browGeometry = new THREE.SphereGeometry(1, 10, 6);
    const sideFinGeometry = new THREE.ConeGeometry(1, 1, 3);
    const crestGeometry = new THREE.ConeGeometry(1, 1, 4);

    const directions = ['N', 'E', 'S', 'W'];
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2;
      const fish = makeGroup(`FishSpout_${directions[index]}`, tower, new THREE.Vector3(Math.sin(angle) * 0.445, 1.19, Math.cos(angle) * 0.445));
      fish.rotation.y = angle;
      fish.rotateX(0.17);
      addMesh(`FishNeck_${index + 1}`, neckGeometry, materials.ceramic, fish, new THREE.Vector3(0, 0.012, 0.047));
      addMesh(`FishHead_${index + 1}`, headGeometry, materials.ceramic, fish);
      addMesh(
        `FishMuzzle_${index + 1}`,
        detailSphereGeometry,
        materials.ceramic,
        fish,
        new THREE.Vector3(0, -0.028, 0.209),
        new THREE.Euler(),
        new THREE.Vector3(0.049, 0.04, 0.041),
      );
      addMesh(
        `FishLowerJaw_${index + 1}`,
        detailSphereGeometry,
        materials.ceramic,
        fish,
        new THREE.Vector3(0, -0.068, 0.21),
        new THREE.Euler(),
        new THREE.Vector3(0.045, 0.025, 0.036),
      );
      const socketPosition = new THREE.Vector3(0, -0.043, 0.25);
      const socket = addSocket(`Spout_${directions[index]}`, fish, socketPosition);
      socket.userData.effect = 'water-jet';
      if (rank >= passRank['form-refinement']) {
        addMesh(`FishMouthCavity_${index + 1}`, mouthCavityGeometry, materials.recess, fish, new THREE.Vector3(0, -0.043, 0.24));
        addMesh(`FishMouth_${index + 1}`, mouthGeometry, materials.ceramic, fish, new THREE.Vector3(0, -0.043, 0.245));
        addMesh(
          `FishEyeSocketL_${index + 1}`,
          eyeGeometry,
          materials.ceramic,
          fish,
          new THREE.Vector3(-0.057, 0.028, 0.178),
          new THREE.Euler(),
          new THREE.Vector3(0.017, 0.019, 0.014),
        );
        addMesh(
          `FishEyeSocketR_${index + 1}`,
          eyeGeometry,
          materials.ceramic,
          fish,
          new THREE.Vector3(0.057, 0.028, 0.178),
          new THREE.Euler(),
          new THREE.Vector3(0.017, 0.019, 0.014),
        );
        addMesh(
          `FishEyeL_${index + 1}`,
          pupilGeometry,
          materials.recess,
          fish,
          new THREE.Vector3(-0.057, 0.028, 0.191),
          new THREE.Euler(),
          new THREE.Vector3(0.0055, 0.0065, 0.0035),
        );
        addMesh(
          `FishEyeR_${index + 1}`,
          pupilGeometry,
          materials.recess,
          fish,
          new THREE.Vector3(0.057, 0.028, 0.191),
          new THREE.Euler(),
          new THREE.Vector3(0.0055, 0.0065, 0.0035),
        );
        addMesh(`FishBrowL_${index + 1}`, browGeometry, materials.ceramic, fish, new THREE.Vector3(-0.044, 0.053, 0.18), new THREE.Euler(0.08, 0, 0.22), new THREE.Vector3(0.021, 0.005, 0.009));
        addMesh(`FishBrowR_${index + 1}`, browGeometry, materials.ceramic, fish, new THREE.Vector3(0.044, 0.053, 0.18), new THREE.Euler(0.08, 0, -0.22), new THREE.Vector3(0.021, 0.005, 0.009));
        addMesh(`FishGillPlateL_${index + 1}`, detailSphereGeometry, materials.ceramic, fish, new THREE.Vector3(-0.071, -0.003, 0.11), new THREE.Euler(), new THREE.Vector3(0.014, 0.043, 0.033));
        addMesh(`FishGillPlateR_${index + 1}`, detailSphereGeometry, materials.ceramic, fish, new THREE.Vector3(0.071, -0.003, 0.11), new THREE.Euler(), new THREE.Vector3(0.014, 0.043, 0.033));
        addMesh(`FishSideFinL_${index + 1}`, sideFinGeometry, materials.ceramic, fish, new THREE.Vector3(-0.084, 0.003, 0.092), new THREE.Euler(0, 0, -Math.PI / 2), new THREE.Vector3(0.023, 0.05, 0.03));
        addMesh(`FishSideFinR_${index + 1}`, sideFinGeometry, materials.ceramic, fish, new THREE.Vector3(0.084, 0.003, 0.092), new THREE.Euler(0, 0, Math.PI / 2), new THREE.Vector3(0.023, 0.05, 0.03));
        addMesh(`FishCrest_${index + 1}`, crestGeometry, materials.ceramic, fish, new THREE.Vector3(0, 0.095, 0.098), new THREE.Euler(), new THREE.Vector3(0.022, 0.048, 0.024));
        addMesh(`FishCrestFront_${index + 1}`, crestGeometry, materials.ceramic, fish, new THREE.Vector3(0, 0.087, 0.139), new THREE.Euler(), new THREE.Vector3(0.016, 0.038, 0.019));

        socket.updateWorldMatrix(true, false);
        const start = socket.getWorldPosition(new THREE.Vector3());
        const end = new THREE.Vector3(Math.sin(angle) * 0.69, 0.722, Math.cos(angle) * 0.69);
        const midpoint = start.clone().lerp(end, 0.48).add(new THREE.Vector3(Math.sin(angle) * 0.045, 0.035, Math.cos(angle) * 0.045));
        const jetCurve = new THREE.QuadraticBezierCurve3(start, midpoint, end);
        const jet = addMesh(`WaterJet_${directions[index]}`, new THREE.TubeGeometry(jetCurve, 28, 0.006, 7, false), materials.jetWater, root);
        jet.userData.export = false;
        const rippleInner = addMesh(`ImpactRippleInner_${directions[index]}`, new THREE.TorusGeometry(0.042, 0.0045, 5, 24), materials.jetWater, root, end.clone().add(new THREE.Vector3(0, 0.008, 0)), new THREE.Euler(Math.PI / 2, 0, 0));
        rippleInner.userData.export = false;
        const rippleOuter = addMesh(`ImpactRippleOuter_${directions[index]}`, new THREE.TorusGeometry(0.078, 0.0035, 5, 28), materials.jetWater, root, end.clone().add(new THREE.Vector3(0, 0.006, 0)), new THREE.Euler(Math.PI / 2, 0, 0));
        rippleOuter.userData.export = false;
        const splashStem = addMesh(`ImpactSplash_${directions[index]}`, new THREE.CylinderGeometry(0.006, 0.012, 0.035, 8), materials.jetWater, root, end.clone().add(new THREE.Vector3(0, 0.017, 0)));
        splashStem.userData.export = false;
      }
    }
  }

  if (rank >= passRank['form-refinement']) {
    const matrix = new THREE.Matrix4();
    const seamMaterial = materials.copper;

    const addVerticalJointRing = (name: string, parent: THREE.Object3D, count: number, radius: number, y: number, height: number, angleOffset = 0) => {
      const geometry = new THREE.BoxGeometry(0.0025, height, 0.006);
      const joints = new THREE.InstancedMesh(geometry, seamMaterial, count);
      joints.name = name;
      joints.castShadow = false;
      for (let index = 0; index < count; index += 1) {
        const angle = index * Math.PI * 2 / count + angleOffset;
        matrix.compose(
          new THREE.Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        joints.setMatrixAt(index, matrix);
      }
      joints.instanceMatrix.needsUpdate = true;
      parent.add(joints);
      runtime.meshes[name] = joints;
    };

    const addRadialJointRing = (name: string, parent: THREE.Object3D, count: number, radius: number, y: number, length: number, angleOffset = 0) => {
      const geometry = new THREE.BoxGeometry(0.0025, 0.004, length);
      const joints = new THREE.InstancedMesh(geometry, seamMaterial, count);
      joints.name = name;
      joints.castShadow = false;
      for (let index = 0; index < count; index += 1) {
        const angle = index * Math.PI * 2 / count + angleOffset;
        matrix.compose(
          new THREE.Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        joints.setMatrixAt(index, matrix);
      }
      joints.instanceMatrix.needsUpdate = true;
      parent.add(joints);
      runtime.meshes[name] = joints;
    };

    const addTaperedWallJointRing = (
      name: string,
      parent: THREE.Object3D,
      count: number,
      bottomRadius: number,
      topRadius: number,
      bottomY: number,
      topY: number,
      width: number,
      angleOffset = 0,
    ) => {
      const group = makeGroup(name, parent);
      for (let index = 0; index < count; index += 1) {
        const angle = index * Math.PI * 2 / count + angleOffset;
        const points: THREE.Vector3[] = [];
        const normals: THREE.Vector3[] = [];
        const rise = (bottomRadius - topRadius) / (topY - bottomY);
        for (let segment = 0; segment <= 6; segment += 1) {
          const t = segment / 6;
          const radial = THREE.MathUtils.lerp(bottomRadius, topRadius, t);
          const y = THREE.MathUtils.lerp(bottomY, topY, t);
          points.push(new THREE.Vector3(Math.sin(angle) * radial, y, Math.cos(angle) * radial));
          normals.push(new THREE.Vector3(Math.sin(angle), rise, Math.cos(angle)).normalize());
        }
        const joint = addMesh(`${name}_${index + 1}`, surfaceRibbonGeometry(points, normals, angle, width), seamMaterial, group);
        joint.castShadow = false;
        joint.receiveShadow = false;
      }
    };

    const addProfileJointRing = (
      name: string,
      parent: THREE.Object3D,
      count: number,
      profile: THREE.Vector2[],
      width: number,
      angleOffset = 0,
    ) => {
      const group = makeGroup(name, parent);
      for (let index = 0; index < count; index += 1) {
        const angle = index * Math.PI * 2 / count + angleOffset;
        const points = profile.map((point) => {
          const radial = point.x;
          return new THREE.Vector3(Math.sin(angle) * radial, point.y, Math.cos(angle) * radial);
        });
        const normals = profile.map((point, profileIndex) => {
          const previous = profile[Math.max(0, profileIndex - 1)];
          const next = profile[Math.min(profile.length - 1, profileIndex + 1)];
          const deltaRadius = next.x - previous.x;
          const deltaY = next.y - previous.y;
          const profileNormal = new THREE.Vector2(deltaY, -deltaRadius).normalize();
          return new THREE.Vector3(Math.sin(angle) * profileNormal.x, profileNormal.y, Math.cos(angle) * profileNormal.x);
        });
        const joint = addMesh(`${name}_${index + 1}`, surfaceRibbonGeometry(points, normals, angle, width), seamMaterial, group);
        joint.castShadow = false;
        joint.receiveShadow = false;
      }
    };

    const octagonFaceOffset = Math.PI / 8;
    addVerticalJointRing('Plinth_Lower_Riser_Joints', plinth, 8, 1.2355, 0.04, 0.074, octagonFaceOffset);
    addVerticalJointRing('Plinth_Lower_Ledge_Joints', plinth, 8, 1.189, 0.16, 0.034, octagonFaceOffset);
    addVerticalJointRing('Plinth_Upper_Riser_Joints', plinth, 8, 1.106, 0.24, 0.114, octagonFaceOffset);
    addVerticalJointRing('Plinth_Upper_Ledge_Joints', plinth, 8, 1.0595, 0.38, 0.034, octagonFaceOffset);
    addRadialJointRing('Plinth_Lower_Top_Joints', plinth, 8, 1.245, 0.1785, 0.086);
    addRadialJointRing('Plinth_Upper_Top_Joints', plinth, 8, 1.115, 0.3985, 0.066);

    addTaperedWallJointRing('LowerBasin_Wall_Joints', lowerBasin, 16, 1.056, 1.002, 0.415, 0.652, 0.0026, Math.PI / 16);
    const lowerRimJointContract = makeGroup('LowerBasin_Rim_Joints', lowerBasin);
    lowerRimJointContract.userData.representation = 'physical-gaps-between-capped-stone-segments';
    lowerRimJointContract.userData.segmentCount = 16;
    const upperRimJointContract = makeGroup('UpperBowl_Rim_Joints', upperPivot);
    upperRimJointContract.userData.representation = 'physical-gaps-between-capped-stone-segments';
    upperRimJointContract.userData.segmentCount = 8;
    addProfileJointRing(
      'UpperBowl_Body_Joints',
      upperPivot,
      8,
      [
        new THREE.Vector2(0.15, -0.119),
        new THREE.Vector2(0.23, -0.114),
        new THREE.Vector2(0.3, -0.084),
        new THREE.Vector2(0.349, -0.034),
        new THREE.Vector2(0.354, 0.011),
        new THREE.Vector2(0.33, 0.044),
      ],
      0.0022,
    );

    const pedestalEdgeGeometry = new THREE.CylinderGeometry(0.024, 0.034, 0.58, 4);
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4 + Math.PI / 8;
      addMesh(
        `PedestalEdgeTrim_${index + 1}`,
        pedestalEdgeGeometry,
        materials.limestone,
        tower,
        new THREE.Vector3(Math.sin(angle) * 0.412, 1.12, Math.cos(angle) * 0.412),
        new THREE.Euler(0, angle, 0),
      );
    }

  }

  runtime.colliders = {
    Base_Collider: { type: 'cylinder', radius: 1.34, height: 0.4, center: [0, 0.2, 0] },
    LowerBasin_Collider: { type: 'cylinder', radius: 1.06, height: 0.38, center: [0, 0.51, 0] },
    Pedestal_Collider: { type: 'cylinder', radius: 0.5, height: 0.9, center: [0, 1.16, 0] },
  };
  runtime.destructionGroups = {
    plinth: [plinth],
    lowerBasin: [lowerBasin],
    tower: [tower],
    upperBowl: [upperPivot],
    finial: [finialPivot],
  };
  root.userData.assetInfo = {
    assetId: 'plaza-fountain',
    version: 10,
    buildPass,
    unit: 'meter',
    forward: '+Z',
    up: '+Y',
    dimensions: [2.68, 2.18, 2.68],
    status: 'AI_ASSET_CANDIDATE',
  };
  root.userData.sculptRuntime = runtime;
  return root;
}
