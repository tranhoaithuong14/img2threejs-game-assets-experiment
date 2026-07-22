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
const X_AXIS = new THREE.Vector3(1, 0, 0);

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

  const treadGeometry = new RoundedBoxGeometry(0.102, 0.021, 0.063, 1, 0.007);
  const tread = new THREE.InstancedMesh(treadGeometry, materials.tire, 24);
  tread.name = `${name}_Tread_Instanced`;
  const transform = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    rotation.setFromAxisAngle(X_AXIS, -angle);
    transform.compose(
      new THREE.Vector3(0, Math.cos(angle) * 0.357, Math.sin(angle) * 0.357),
      rotation,
      scale,
    );
    tread.setMatrixAt(index, transform);
  }
  tread.instanceMatrix.needsUpdate = true;
  pivot.add(tread);

  for (const angle of [0.68, 3.82]) {
    const reflector = roundedBox(`${name}_Reflector`, [0.012, 0.055, 0.026], 0.006, materials.orange);
    reflector.position.set(0.058, Math.cos(angle) * 0.265, Math.sin(angle) * 0.265);
    reflector.rotation.x = -angle;
    pivot.add(reflector);
  }

  return pivot;
}

function arcTube(
  name: string,
  center: THREE.Vector3,
  radius: number,
  start: number,
  end: number,
  tubeRadius: number,
  material: THREE.Material,
) {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= 18; index += 1) {
    const t = index / 18;
    const angle = THREE.MathUtils.lerp(start, end, t);
    points.push(new THREE.Vector3(
      center.x,
      center.y + Math.cos(angle) * radius,
      center.z + Math.sin(angle) * radius,
    ));
  }
  return tubeAlong(name, points, tubeRadius, material, 32, 7);
}

function addParcelBadge(
  parent: THREE.Object3D,
  name: string,
  position: THREE.Vector3,
  face: 'side' | 'rear',
  cream: THREE.Material,
  teal: THREE.Material,
) {
  const badge = new THREE.Group();
  badge.name = name;
  badge.position.copy(position);

  const slab = face === 'side'
    ? roundedBox(`${name}_Cream`, [0.008, 0.14, 0.14], 0.006, cream)
    : roundedBox(`${name}_Cream`, [0.14, 0.14, 0.008], 0.006, cream);
  badge.add(slab);

  const vertical = face === 'side'
    ? roundedBox(`${name}_Vertical_Seam`, [0.011, 0.15, 0.014], 0.003, teal)
    : roundedBox(`${name}_Vertical_Seam`, [0.014, 0.15, 0.011], 0.003, teal);
  badge.add(vertical);

  const horizontal = face === 'side'
    ? roundedBox(`${name}_Horizontal_Seam`, [0.011, 0.014, 0.15], 0.003, teal)
    : roundedBox(`${name}_Horizontal_Seam`, [0.15, 0.014, 0.011], 0.003, teal);
  horizontal.rotation[face === 'side' ? 'x' : 'z'] = 0.42;
  badge.add(horizontal);
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
  const tire = physical('#141817', 0.82, 0, 0);
  tire.name = 'M_Tire_Rubber';
  if (typeof document !== 'undefined') {
    tire.normalMap = createGrainTexture(96, 3821, 'normal');
    tire.normalScale.set(0.22, 0.22);
    tire.roughnessMap = createGrainTexture(96, 4339, 'roughness');
  }
  const cream = physical('#F1D7A7', 0.31, 0.02, 0.25);
  cream.name = 'M_Warm_Cream';
  const orange = physical('#F27A32', 0.28, 0, 0.22);
  orange.name = 'M_Safety_Orange';
  const metal = physical('#8C9694', 0.24, 0.82, 0.1);
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
  ], 0.074, teal, 64, 10);
  chassis.add(frame);

  chassis.add(tubeAlong('Frame_Seat_Mast', [
    new THREE.Vector3(0, 0.34, -0.22),
    new THREE.Vector3(0, 0.62, -0.29),
    new THREE.Vector3(0, 0.9, -0.31),
  ], 0.061, teal, 28, 10));
  chassis.add(cylinderBetween(
    'Frame_Steering_Head',
    new THREE.Vector3(0, 0.72, 0.74),
    new THREE.Vector3(0, 0.96, 0.82),
    0.075,
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
      0.027,
      dark,
      9,
    ));
    steering.add(cylinderBetween(
      `Front_Fork_Lower_${side}`,
      new THREE.Vector3(side * 0.105, -0.25, 0.08),
      new THREE.Vector3(side * 0.095, -0.465, 0.13),
      0.03,
      metal,
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
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.125, 10), cream);
    grip.name = side < 0 ? 'Left_Grip' : 'Right_Grip';
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.36, 0.36, -0.045);
    steering.add(grip);
    const brake = tubeAlong(`Brake_Lever_${side}`, [
      new THREE.Vector3(side * 0.25, 0.34, 0.0),
      new THREE.Vector3(side * 0.3, 0.29, 0.03),
      new THREE.Vector3(side * 0.25, 0.27, 0.05),
    ], 0.009, dark, 14, 6);
    steering.add(brake);
  }

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
  steering.add(headlight);

  steering.add(arcTube(
    'Front_Mudguard',
    new THREE.Vector3(0, -0.465, 0.13),
    0.382,
    -1.17,
    1.17,
    0.019,
    teal,
  ));
  chassis.add(arcTube(
    'Rear_Mudguard',
    new THREE.Vector3(0, 0.355, -0.92),
    0.382,
    -1.22,
    1.22,
    0.019,
    teal,
  ));

  const saddleStem = cylinderBetween(
    'Saddle_Stem',
    new THREE.Vector3(0, 0.74, -0.31),
    new THREE.Vector3(0, 1.01, -0.28),
    0.026,
    dark,
    10,
  );
  chassis.add(saddleStem);
  const saddle = roundedBox('Saddle', [0.31, 0.085, 0.27], 0.04, cream);
  saddle.position.set(0, 1.04, -0.28);
  saddle.scale.set(1, 1, 1);
  chassis.add(saddle);

  const battery = roundedBox('Battery_Detachable', [0.22, 0.45, 0.24], 0.032, dark);
  battery.position.set(0, 0.61, -0.25);
  battery.rotation.x = -0.05;
  chassis.add(battery);
  const batteryCap = roundedBox('Battery_Cap', [0.19, 0.05, 0.2], 0.018, tealDark);
  batteryCap.position.set(0, 0.845, -0.25);
  chassis.add(batteryCap);

  const drivetrain = new THREE.Group();
  drivetrain.name = 'Crank_Pivot';
  drivetrain.position.set(0, 0.36, -0.18);
  root.add(drivetrain);
  const chainGuard = roundedBox('Chain_Guard', [0.16, 0.23, 0.68], 0.055, dark);
  chainGuard.position.set(0.07, 0, -0.24);
  drivetrain.add(chainGuard);
  const inset = roundedBox('Chain_Guard_Inset', [0.008, 0.055, 0.35], 0.02, tealDark);
  inset.position.set(0.155, -0.015, -0.24);
  drivetrain.add(inset);
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 18), dark);
  crank.name = 'Crank_Hub';
  crank.rotation.z = Math.PI / 2;
  drivetrain.add(crank);
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
  }

  const cargo = new THREE.Group();
  cargo.name = 'Cargo_Pivot';
  root.add(cargo);
  const cargoBody = roundedBox('Cargo_Box', [0.58, 0.44, 0.62], 0.043, teal);
  cargoBody.position.set(0, 1.04, -0.74);
  cargo.add(cargoBody);
  const cargoLid = roundedBox('Cargo_Lid_Hinge', [0.62, 0.09, 0.66], 0.043, teal);
  cargoLid.position.set(0, 1.305, -0.74);
  cargo.add(cargoLid);
  const lidBand = roundedBox('Cargo_Lid_Seam', [0.592, 0.018, 0.632], 0.008, tealDark);
  lidBand.position.set(0, 1.255, -0.74);
  cargo.add(lidBand);
  const latch = roundedBox('Cargo_Latch', [0.16, 0.055, 0.025], 0.012, cream);
  latch.position.set(0, 1.255, -0.415);
  cargo.add(latch);

  for (const x of [-0.286, 0.286]) {
    for (const y of [0.86, 1.22]) {
      for (const z of [-1.045, -0.435]) {
        const guard = roundedBox('Cargo_Corner_Guard', [0.026, 0.058, 0.058], 0.009, orange);
        guard.position.set(x, y, z);
        cargo.add(guard);
      }
    }
  }

  addParcelBadge(cargo, 'Parcel_Badge_Side', new THREE.Vector3(0.294, 1.06, -0.74), 'side', cream, tealDark);
  addParcelBadge(cargo, 'Parcel_Badge_Rear', new THREE.Vector3(0, 1.06, -1.054), 'rear', cream, tealDark);

  const rearLight = roundedBox('Rear_Light', [0.16, 0.1, 0.05], 0.018, tail);
  rearLight.position.set(0, 0.79, -1.07);
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
    forward: '+Z',
    up: '+Y',
    unit: 'meter',
  };

  return root;
}
