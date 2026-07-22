import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type CargoBikeOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
};

export type CargoBikeRuntime = {
  nodes: Record<string, THREE.Object3D>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function createGrainTexture(size: number, seed: number, mode: 'normal' | 'roughness') {
  const data = new Uint8Array(size * size * 4);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) >>> 0;
    return ((state ^ (state >>> 14)) >>> 0) / 4294967295;
  };
  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4;
    const a = random() - 0.5;
    const b = random() - 0.5;
    if (mode === 'normal') {
      data[offset] = Math.round(128 + a * 34);
      data[offset + 1] = Math.round(128 + b * 34);
      data[offset + 2] = 250;
    } else {
      const value = Math.round(210 + (a + b) * 28);
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
    data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = mode === 'normal' ? 'T_Procedural_Grain_Normal' : 'T_Procedural_Grain_Roughness';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(mode === 'normal' ? 8 : 5, mode === 'normal' ? 8 : 5);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createTireTreadNormalTexture(width = 256, height = 64) {
  const heights = new Float32Array(width * height);
  const wrapDistance = (value: number) => Math.abs(((value + 0.5) % 1) - 0.5);
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    const crown = 1 - Math.min(1, Math.abs(v - 0.5) / 0.42);
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const leftGroove = wrapDistance(u * 22 + (v - 0.5) * 1.4) < 0.075;
      const rightGroove = wrapDistance(u * 22 - (v - 0.5) * 1.4) < 0.075;
      const inTread = Math.abs(v - 0.5) < 0.37;
      heights[y * width + x] = crown * 0.08 - (inTread && (leftGroove || rightGroove) ? 0.68 : 0);
    }
  }

  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = heights[y * width + ((x - 1 + width) % width)];
      const right = heights[y * width + ((x + 1) % width)];
      const down = heights[Math.max(0, y - 1) * width + x];
      const up = heights[Math.min(height - 1, y + 1) * width + x];
      const normal = new THREE.Vector3((left - right) * 2.2, (down - up) * 2.2, 1).normalize();
      const offset = (y * width + x) * 4;
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = 'T_Tire_Chevron_Normal';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createTireTreadColorTexture(width = 256, height = 64) {
  const data = new Uint8Array(width * height * 4);
  const wrapDistance = (value: number) => Math.abs(((value + 0.5) % 1) - 0.5);
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const inTread = Math.abs(v - 0.5) < 0.37;
      const leftGroove = wrapDistance(u * 22 + (v - 0.5) * 1.4) < 0.075;
      const rightGroove = wrapDistance(u * 22 - (v - 0.5) * 1.4) < 0.075;
      const value = inTread && (leftGroove || rightGroove) ? 92 : 224;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = 'T_Tire_Chevron_Albedo';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function physical(color: string, roughness: number, metalness = 0, clearcoat = 0) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness,
    clearcoat,
    clearcoatRoughness: Math.min(0.5, roughness),
  });
}

function roundedBox(
  name: string,
  size: [number, number, number],
  radius: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius), material);
  mesh.name = name;
  return mesh;
}

function cylinderBetween(
  name: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments = 10,
) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments, 1, false),
    material,
  );
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
  return mesh;
}

function tubeAlong(
  name: string,
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  tubularSegments = 48,
  radialSegments = 10,
) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false),
    material,
  );
  mesh.name = name;
  return mesh;
}

function arcBand(
  name: string,
  center: THREE.Vector3,
  radius: number,
  start: number,
  end: number,
  width: number,
  thickness: number,
  material: THREE.Material,
  segments = 36,
) {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const angle = THREE.MathUtils.lerp(start, end, index / segments);
    const radialY = Math.cos(angle);
    const radialZ = Math.sin(angle);
    for (const [x, radialOffset] of [
      [-width * 0.5, -thickness * 0.5],
      [width * 0.5, -thickness * 0.5],
      [width * 0.5, thickness * 0.5],
      [-width * 0.5, thickness * 0.5],
    ] as const) {
      vertices.push(
        center.x + x,
        center.y + radialY * (radius + radialOffset),
        center.z + radialZ * (radius + radialOffset),
      );
    }
  }

  for (let index = 0; index < segments; index += 1) {
    const current = index * 4;
    const next = (index + 1) * 4;
    for (let side = 0; side < 4; side += 1) {
      const sideNext = (side + 1) % 4;
      indices.push(current + side, next + side, next + sideNext);
      indices.push(current + side, next + sideNext, current + sideNext);
    }
  }
  indices.push(0, 1, 2, 0, 2, 3);
  const endBase = segments * 4;
  indices.push(endBase, endBase + 2, endBase + 1, endBase, endBase + 3, endBase + 2);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function extrudedProfileAlongX(
  name: string,
  profile: Array<[number, number]>,
  width: number,
  material: THREE.Material,
  bevel = 0.01,
) {
  const shape = new THREE.Shape();
  profile.forEach(([z, y], index) => {
    if (index === 0) shape.moveTo(-z, y);
    else shape.lineTo(-z, y);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -width * 0.5);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.rotation.y = Math.PI / 2;
  return mesh;
}

function createSaddle(name: string, cream: THREE.Material, dark: THREE.Material) {
  const group = new THREE.Group();
  group.name = name;

  const shape = new THREE.Shape();
  shape.moveTo(0, 0.165);
  shape.bezierCurveTo(0.035, 0.15, 0.07, 0.105, 0.078, 0.055);
  shape.bezierCurveTo(0.12, 0.025, 0.14, -0.03, 0.135, -0.085);
  shape.bezierCurveTo(0.115, -0.118, 0.065, -0.125, 0, -0.125);
  shape.bezierCurveTo(-0.065, -0.125, -0.115, -0.118, -0.135, -0.085);
  shape.bezierCurveTo(-0.14, -0.03, -0.12, 0.025, -0.078, 0.055);
  shape.bezierCurveTo(-0.07, 0.105, -0.035, 0.15, 0, 0.165);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.068,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.014,
    bevelThickness: 0.012,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -0.034);
  const cushion = new THREE.Mesh(geometry, cream);
  cushion.name = `${name}_Cushion`;
  cushion.rotation.x = Math.PI / 2;
  cushion.position.y = 0.038;
  group.add(cushion);

  const base = roundedBox(`${name}_Underside`, [0.215, 0.034, 0.17], 0.015, dark);
  base.position.set(0, -0.012, -0.018);
  group.add(base);
  return group;
}

function createWheel(
  name: string,
  materials: {
    tire: THREE.Material;
    cream: THREE.Material;
    dark: THREE.Material;
    orange: THREE.Material;
    metal: THREE.Material;
  },
) {
  const pivot = new THREE.Group();
  pivot.name = `${name}_Pivot`;

  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.307, 0.048, 10, 36), materials.tire);
  tire.name = `${name}_Tire`;
  tire.rotation.y = Math.PI / 2;
  pivot.add(tire);

  const creamRim = new THREE.Mesh(new THREE.TorusGeometry(0.272, 0.017, 8, 32), materials.cream);
  creamRim.name = `${name}_Cream_Rim`;
  creamRim.rotation.y = Math.PI / 2;
  pivot.add(creamRim);

  const innerRim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.009, 6, 32), materials.dark);
  innerRim.name = `${name}_Inner_Rim`;
  innerRim.rotation.y = Math.PI / 2;
  pivot.add(innerRim);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.13, 12), materials.dark);
  hub.name = `${name}_Hub`;
  hub.rotation.z = Math.PI / 2;
  pivot.add(hub);

  for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
    const side = sideIndex === 0 ? -0.045 : 0.045;
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2 + sideIndex * 0.11;
      pivot.add(cylinderBetween(
        `${name}_Spoke_${sideIndex}_${index}`,
        new THREE.Vector3(side, 0, 0),
        new THREE.Vector3(side * 0.6, Math.cos(angle) * 0.245, Math.sin(angle) * 0.245),
        0.0045,
        materials.metal,
        6,
      ));
    }
  }

  for (const angle of [0.68, 3.82]) {
    const reflector = roundedBox(`${name}_Reflector`, [0.012, 0.055, 0.026], 0.006, materials.orange);
    reflector.position.set(0.058, Math.cos(angle) * 0.265, Math.sin(angle) * 0.265);
    reflector.rotation.x = angle;
    pivot.add(reflector);
  }

  return pivot;
}

function addParcelBadge(
  parent: THREE.Object3D,
  name: string,
  position: THREE.Vector3,
  face: 'side' | 'rear',
  cream: THREE.Material,
) {
  const badge = new THREE.Group();
  badge.name = name;
  badge.position.copy(position);
  badge.scale.set(1.12, 1.12, 1);

  const faces = [
    [[0, 0.078], [0.068, 0.039], [0, 0.002], [-0.068, 0.039]],
    [[-0.068, 0.032], [-0.006, -0.003], [-0.006, -0.078], [-0.068, -0.041]],
    [[0.068, 0.032], [0.006, -0.003], [0.006, -0.078], [0.068, -0.041]],
  ];
  faces.forEach((points, index) => {
    const shape = new THREE.Shape();
    points.forEach(([x, y], pointIndex) => {
      if (pointIndex === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), cream);
    mesh.name = `${name}_Cube_Face_${index}`;
    mesh.position.z = 0.002;
    badge.add(mesh);
  });
  badge.rotation.y = face === 'side' ? Math.PI / 2 : Math.PI;
  parent.add(badge);
}

export function createDeliveryCargoBikeModel(options: CargoBikeOptions = {}) {
  const root = new THREE.Group();
  root.name = 'DeliveryCargoBike';

  const teal = physical('#1FA899', 0.34, 0.08, 0.18);
  teal.name = 'M_Teal_Satin';
  if (typeof document !== 'undefined') {
    teal.normalMap = createGrainTexture(96, 7919, 'normal');
    teal.normalScale.set(0.16, 0.16);
    teal.roughnessMap = createGrainTexture(96, 1459, 'roughness');
  }
  const tealDark = physical('#147D75', 0.42, 0.05, 0.08);
  tealDark.name = 'M_Teal_Dark';
  const dark = physical('#1D2426', 0.48, 0.18, 0.05);
  dark.name = 'M_Charcoal';
  const tire = physical('#252A28', 0.82, 0, 0);
  tire.name = 'M_Tire_Rubber';
  if (typeof document !== 'undefined') {
    tire.map = createTireTreadColorTexture();
    tire.normalMap = createTireTreadNormalTexture();
    tire.normalScale.set(0.42, 0.42);
    tire.roughnessMap = createGrainTexture(96, 4339, 'roughness');
  }
  const cream = physical('#F1D7A7', 0.31, 0.02, 0.25);
  cream.name = 'M_Warm_Cream';
  const orange = physical('#F27A32', 0.28, 0, 0.22);
  orange.name = 'M_Safety_Orange';
  const metal = physical('#AAB4B2', 0.24, 0.76, 0.1);
  metal.name = 'M_Brushed_Metal';
  const lens = new THREE.MeshPhysicalMaterial({
    name: 'M_Headlight_Lens',
    color: '#E8FBFF',
    emissive: '#BFEFF0',
    emissiveIntensity: 0.35,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  const tail = new THREE.MeshPhysicalMaterial({
    name: 'M_Tail_Lens', color: '#D83E2E', emissive: '#A4140C', emissiveIntensity: 0.45,
    roughness: 0.16, clearcoat: 0.75, clearcoatRoughness: 0.08,
  });

  const chassis = new THREE.Group();
  chassis.name = 'Chassis_Static';
  root.add(chassis);

  const frame = tubeAlong('Frame_Step_Through', [
    new THREE.Vector3(0, 0.78, -0.34),
    new THREE.Vector3(0, 0.44, -0.22),
    new THREE.Vector3(0, 0.29, 0.22),
    new THREE.Vector3(0, 0.34, 0.54),
    new THREE.Vector3(0, 0.78, 0.78),
  ], 0.063, teal, 64, 12);
  chassis.add(frame);

  chassis.add(tubeAlong('Frame_Seat_Mast', [
    new THREE.Vector3(0, 0.34, -0.22),
    new THREE.Vector3(0, 0.62, -0.29),
    new THREE.Vector3(0, 0.9, -0.31),
  ], 0.052, teal, 28, 12));
  chassis.add(cylinderBetween(
    'Frame_Steering_Head',
    new THREE.Vector3(0, 0.72, 0.74),
    new THREE.Vector3(0, 0.96, 0.82),
    0.066,
    tealDark,
    12,
  ));

  for (const side of [-1, 1]) {
    chassis.add(cylinderBetween(
      `Rear_Chainstay_${side}`,
      new THREE.Vector3(side * 0.075, 0.36, -0.18),
      new THREE.Vector3(side * 0.07, 0.35, -0.92),
      0.025,
      dark,
      8,
    ));
    chassis.add(cylinderBetween(
      `Rear_Seatstay_${side}`,
      new THREE.Vector3(side * 0.07, 0.72, -0.36),
      new THREE.Vector3(side * 0.07, 0.35, -0.92),
      0.024,
      dark,
      8,
    ));
  }

  const rearWheel = createWheel('RearWheel', { tire, cream, dark, orange, metal });
  rearWheel.position.set(0, 0.355, -0.92);
  root.add(rearWheel);

  const steering = new THREE.Group();
  steering.name = 'Steering_Pivot';
  steering.position.set(0, 0.82, 0.79);
  root.add(steering);

  const frontWheel = createWheel('FrontWheel', { tire, cream, dark, orange, metal });
  frontWheel.position.set(0, -0.465, 0.13);
  steering.add(frontWheel);

  for (const side of [-1, 1]) {
    steering.add(cylinderBetween(
      `Front_Fork_Upper_${side}`,
      new THREE.Vector3(side * 0.055, 0.02, 0),
      new THREE.Vector3(side * 0.105, -0.25, 0.08),
      0.026,
      metal,
      9,
    ));
    steering.add(cylinderBetween(
      `Front_Fork_Lower_${side}`,
      new THREE.Vector3(side * 0.105, -0.25, 0.08),
      new THREE.Vector3(side * 0.095, -0.465, 0.13),
      0.032,
      dark,
      9,
    ));
  }

  steering.add(cylinderBetween(
    'Handlebar_Stem',
    new THREE.Vector3(0, 0.03, 0),
    new THREE.Vector3(0, 0.34, 0.015),
    0.028,
    dark,
    10,
  ));
  steering.add(tubeAlong('Handlebar', [
    new THREE.Vector3(-0.34, 0.36, -0.04),
    new THREE.Vector3(-0.18, 0.37, 0.015),
    new THREE.Vector3(0, 0.35, 0.04),
    new THREE.Vector3(0.18, 0.37, 0.015),
    new THREE.Vector3(0.34, 0.36, -0.04),
  ], 0.022, dark, 36, 8));
  const stemClamp = roundedBox('Handlebar_Stem_Clamp', [0.13, 0.06, 0.085], 0.015, dark);
  stemClamp.position.set(0, 0.35, 0.025);
  steering.add(stemClamp);
  const display = roundedBox('Handlebar_Display', [0.12, 0.045, 0.09], 0.012, dark);
  display.position.set(0, 0.395, -0.005);
  display.rotation.x = -0.16;
  steering.add(display);
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.125, 10), cream);
    grip.name = side < 0 ? 'Left_Grip' : 'Right_Grip';
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.36, 0.36, -0.045);
    steering.add(grip);
    const gripCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.048, 10), dark);
    gripCollar.name = side < 0 ? 'Left_Grip_Collar' : 'Right_Grip_Collar';
    gripCollar.rotation.z = Math.PI / 2;
    gripCollar.position.set(side * 0.295, 0.36, -0.035);
    steering.add(gripCollar);
    const control = roundedBox(`Handlebar_Control_${side}`, [0.055, 0.055, 0.06], 0.012, dark);
    control.position.set(side * 0.245, 0.355, -0.005);
    steering.add(control);
    const brake = tubeAlong(`Brake_Lever_${side}`, [
      new THREE.Vector3(side * 0.25, 0.34, 0.0),
      new THREE.Vector3(side * 0.3, 0.29, 0.03),
      new THREE.Vector3(side * 0.25, 0.27, 0.05),
    ], 0.009, dark, 14, 6);
    steering.add(brake);
    steering.add(tubeAlong(`Brake_Cable_${side}`, [
      new THREE.Vector3(side * 0.25, 0.32, 0.015),
      new THREE.Vector3(side * 0.18, 0.18, 0.11),
      new THREE.Vector3(side * 0.08, -0.02, 0.075),
      new THREE.Vector3(side * 0.07, -0.24, 0.10),
    ], 0.0045, dark, 20, 5));
  }
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), orange);
  bell.name = 'Handlebar_Bell';
  bell.scale.y = 0.65;
  bell.position.set(0.205, 0.4, 0.01);
  steering.add(bell);

  const headlight = new THREE.Group();
  headlight.name = 'Headlight_Socket';
  headlight.position.set(0, 0.08, 0.2);
  steering.add(cylinderBetween(
    'Headlight_Bracket',
    new THREE.Vector3(0, 0.08, 0.04),
    new THREE.Vector3(0, 0.08, 0.14),
    0.018,
    dark,
    8,
  ));
  const headlightBody = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.13, 20), teal);
  headlightBody.rotation.x = Math.PI / 2;
  headlight.add(headlightBody);
  const headlightRing = new THREE.Mesh(new THREE.TorusGeometry(0.079, 0.014, 8, 24), cream);
  headlightRing.position.z = 0.071;
  headlight.add(headlightRing);
  const headlightLens = new THREE.Mesh(new THREE.CylinderGeometry(0.071, 0.071, 0.012, 24), lens);
  headlightLens.rotation.x = Math.PI / 2;
  headlightLens.position.z = 0.077;
  headlight.add(headlightLens);
  const headlightInnerRing = new THREE.Mesh(new THREE.TorusGeometry(0.061, 0.006, 7, 24), metal);
  headlightInnerRing.name = 'Headlight_Inner_Ring';
  headlightInnerRing.position.z = 0.085;
  headlight.add(headlightInnerRing);
  steering.add(headlight);

  for (const side of [-1, 1]) {
    const marker = roundedBox(`Headlight_Side_Marker_${side}`, [0.025, 0.036, 0.02], 0.006, orange);
    marker.position.set(side * 0.117, 0.08, 0.225);
    steering.add(marker);
  }

  const forkCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.22, 10), dark);
  forkCrown.name = 'Front_Fork_Crown';
  forkCrown.rotation.z = Math.PI / 2;
  forkCrown.position.set(0, -0.215, 0.07);
  steering.add(forkCrown);

  steering.add(arcBand(
    'Front_Mudguard',
    new THREE.Vector3(0, -0.465, 0.13),
    0.381,
    -1.17,
    1.17,
    0.102,
    0.018,
    teal,
  ));
  chassis.add(arcBand(
    'Rear_Mudguard',
    new THREE.Vector3(0, 0.355, -0.92),
    0.381,
    -1.22,
    1.22,
    0.102,
    0.018,
    teal,
  ));

  for (const side of [-1, 1]) {
    steering.add(cylinderBetween(
      `Front_Mudguard_Stay_${side}`,
      new THREE.Vector3(side * 0.062, -0.465, 0.13),
      new THREE.Vector3(side * 0.062, -0.31, -0.20),
      0.005,
      metal,
      6,
    ));
    chassis.add(cylinderBetween(
      `Rear_Mudguard_Stay_${side}`,
      new THREE.Vector3(side * 0.062, 0.355, -0.92),
      new THREE.Vector3(side * 0.062, 0.49, -1.26),
      0.005,
      metal,
      6,
    ));
  }

  const saddleStem = cylinderBetween(
    'Saddle_Stem',
    new THREE.Vector3(0, 0.74, -0.31),
    new THREE.Vector3(0, 1.01, -0.28),
    0.026,
    dark,
    10,
  );
  chassis.add(saddleStem);
  const saddle = createSaddle('Saddle', cream, dark);
  saddle.position.set(0, 1.045, -0.28);
  chassis.add(saddle);

  const battery = extrudedProfileAlongX('Battery_Detachable', [
    [-0.11, -0.19],
    [0.105, -0.19],
    [0.105, 0.115],
    [0.04, 0.19],
    [-0.075, 0.17],
    [-0.115, 0.065],
  ], 0.18, dark, 0.012);
  battery.position.set(0, 0.62, -0.25);
  chassis.add(battery);
  const batteryCap = roundedBox('Battery_Cap', [0.176, 0.044, 0.155], 0.015, tealDark);
  batteryCap.position.set(0, 0.81, -0.205);
  chassis.add(batteryCap);
  for (let index = 0; index < 3; index += 1) {
    const indicator = roundedBox(`Battery_Indicator_${index}`, [0.009, 0.012, 0.028], 0.003, index < 2 ? teal : dark);
    indicator.position.set(0.098, 0.765 - index * 0.025, -0.17);
    chassis.add(indicator);
  }

  const drivetrain = new THREE.Group();
  drivetrain.name = 'Crank_Pivot';
  drivetrain.position.set(0, 0.36, -0.18);
  root.add(drivetrain);
  const chainGuard = roundedBox('Chain_Guard', [0.13, 0.17, 0.66], 0.07, dark);
  chainGuard.position.set(0.065, -0.005, -0.25);
  drivetrain.add(chainGuard);
  const inset = roundedBox('Chain_Guard_Inset', [0.009, 0.047, 0.33], 0.018, tealDark);
  inset.position.set(0.135, -0.008, -0.26);
  drivetrain.add(inset);
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 18), dark);
  crank.name = 'Crank_Hub';
  crank.rotation.z = Math.PI / 2;
  drivetrain.add(crank);
  const crankRing = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.009, 7, 24), tealDark);
  crankRing.name = 'Crank_Accent_Ring';
  crankRing.rotation.y = Math.PI / 2;
  crankRing.position.x = 0.098;
  drivetrain.add(crankRing);
  const chainLower = cylinderBetween(
    'Drive_Chain_Lower',
    new THREE.Vector3(0.105, -0.09, -0.33),
    new THREE.Vector3(0.105, -0.075, -0.7),
    0.005,
    metal,
    6,
  );
  drivetrain.add(chainLower);
  const rearSprocket = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 24), dark);
  rearSprocket.name = 'Rear_Sprocket';
  rearSprocket.rotation.y = Math.PI / 2;
  rearSprocket.position.set(0.105, -0.005, -0.74);
  drivetrain.add(rearSprocket);
  for (const side of [-1, 1]) {
    const arm = cylinderBetween(
      `Pedal_Arm_${side}`,
      new THREE.Vector3(side * 0.08, 0, 0),
      new THREE.Vector3(side * 0.24, side * 0.08, 0),
      0.014,
      dark,
      7,
    );
    drivetrain.add(arm);
    const pedal = roundedBox(`Pedal_${side}`, [0.1, 0.035, 0.07], 0.01, dark);
    pedal.position.set(side * 0.27, side * 0.09, 0);
    const pedalAccent = roundedBox(`Pedal_Reflector_${side}`, [0.104, 0.018, 0.018], 0.004, orange);
    pedalAccent.position.set(side * 0.27, side * 0.09, 0.036);
    drivetrain.add(pedal, pedalAccent);
  }

  const rack = new THREE.Group();
  rack.name = 'Cargo_Rack';
  root.add(rack);
  for (const side of [-1, 1]) {
    rack.add(cylinderBetween(
      `Rack_Diagonal_${side}`,
      new THREE.Vector3(side * 0.16, 0.38, -0.86),
      new THREE.Vector3(side * 0.23, 0.82, -0.72),
      0.022,
      dark,
      8,
    ));
    rack.add(cylinderBetween(
      `Rack_Top_${side}`,
      new THREE.Vector3(side * 0.23, 0.82, -1.02),
      new THREE.Vector3(side * 0.23, 0.82, -0.48),
      0.022,
      dark,
      8,
    ));
    rack.add(cylinderBetween(
      `Rack_Rear_Brace_${side}`,
      new THREE.Vector3(side * 0.16, 0.38, -0.98),
      new THREE.Vector3(side * 0.23, 0.82, -1.0),
      0.018,
      dark,
      8,
    ));
  }
  for (const z of [-0.98, -0.82, -0.66, -0.5]) {
    rack.add(cylinderBetween(
      `Rack_Crossbar_${z}`,
      new THREE.Vector3(-0.23, 0.82, z),
      new THREE.Vector3(0.23, 0.82, z),
      0.016,
      dark,
      8,
    ));
  }

  const cargo = new THREE.Group();
  cargo.name = 'Cargo_Pivot';
  root.add(cargo);
  const cargoBase = roundedBox('Cargo_Base', [0.585, 0.052, 0.635], 0.018, dark);
  cargoBase.position.set(0, 0.79, -0.74);
  cargo.add(cargoBase);
  const cargoBody = roundedBox('Cargo_Box', [0.56, 0.39, 0.60], 0.032, teal);
  cargoBody.position.set(0, 1.005, -0.74);
  cargo.add(cargoBody);
  const cargoLid = roundedBox('Cargo_Lid_Hinge', [0.59, 0.072, 0.63], 0.028, teal);
  cargoLid.position.set(0, 1.235, -0.74);
  cargo.add(cargoLid);
  const lidBand = roundedBox('Cargo_Lid_Seam', [0.566, 0.016, 0.606], 0.006, tealDark);
  lidBand.position.set(0, 1.198, -0.74);
  cargo.add(lidBand);
  const latch = roundedBox('Cargo_Latch', [0.16, 0.055, 0.025], 0.012, cream);
  latch.position.set(0, 1.202, -1.052);
  cargo.add(latch);

  for (const x of [-0.276, 0.276]) {
    for (const y of [0.84, 1.17]) {
      for (const z of [-1.035, -0.445]) {
        const guard = roundedBox('Cargo_Corner_Guard', [0.025, 0.052, 0.052], 0.007, orange);
        guard.position.set(x, y, z);
        cargo.add(guard);
      }
    }
  }

  addParcelBadge(cargo, 'Parcel_Badge_Side', new THREE.Vector3(0.282, 1.015, -0.74), 'side', cream);
  addParcelBadge(cargo, 'Parcel_Badge_Rear', new THREE.Vector3(0, 1.015, -1.042), 'rear', cream);

  const rearLightHousing = roundedBox('Rear_Light_Housing', [0.16, 0.11, 0.048], 0.018, dark);
  rearLightHousing.position.set(0, 0.73, -1.075);
  root.add(rearLightHousing);
  const rearLight = roundedBox('Rear_Light', [0.125, 0.075, 0.054], 0.015, tail);
  rearLight.position.set(0, 0.73, -1.103);
  root.add(rearLight);

  const kickstand = cylinderBetween(
    'Kickstand_Hinge',
    new THREE.Vector3(-0.09, 0.36, -0.58),
    new THREE.Vector3(-0.2, 0.035, -0.7),
    0.014,
    dark,
    8,
  );
  root.add(kickstand);
  const kickstandFoot = roundedBox('Kickstand_Foot', [0.08, 0.018, 0.04], 0.006, dark);
  kickstandFoot.position.set(-0.2, 0.02, -0.7);
  root.add(kickstandFoot);

  const socketDefinitions: Record<string, [THREE.Object3D, THREE.Vector3]> = {
    RiderSeat: [root, new THREE.Vector3(0, 1.09, -0.28)],
    CargoMount: [root, new THREE.Vector3(0, 0.82, -0.74)],
    HeadlightEmitter: [steering, new THREE.Vector3(0, 0.08, 0.29)],
    RearLightEmitter: [root, new THREE.Vector3(0, 0.79, -1.11)],
  };
  const sockets: Record<string, THREE.Object3D> = {};
  for (const [id, [parent, position]] of Object.entries(socketDefinitions)) {
    const socket = new THREE.Object3D();
    socket.name = `Socket_${id}`;
    socket.position.copy(position);
    parent.add(socket);
    sockets[id] = socket;
  }

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = options.castShadow ?? true;
      object.receiveShadow = options.receiveShadow ?? true;
    }
  });

  const runtime: CargoBikeRuntime = {
    nodes: {
      root,
      chassis,
      steering,
      frontWheel,
      rearWheel,
      drivetrain,
      cargo,
      cargoLid,
      battery,
      kickstand,
    },
    sockets,
    colliders: {
      chassis: { type: 'box', center: [0, 0.58, 0], size: [0.24, 0.52, 1.48] },
      frontWheel: { type: 'cylinder', center: [0, 0.355, 0.92], radius: 0.357, width: 0.102 },
      rearWheel: { type: 'cylinder', center: [0, 0.355, -0.92], radius: 0.357, width: 0.102 },
      cargo: { type: 'box', center: [0, 1.07, -0.74], size: [0.62, 0.53, 0.66] },
    },
  };
  root.userData.sculptRuntime = runtime;
  root.userData.assetInfo = {
    id: 'delivery-cargo-bike',
    source: 'img2threejs procedural reconstruction',
    revision: 2,
    forward: '+Z',
    up: '+Y',
    unit: 'meter',
  };

  return root;
}
