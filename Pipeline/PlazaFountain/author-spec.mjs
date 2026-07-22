import fs from 'node:fs/promises';

const assessmentPath = new URL('./pre-spec-assessment.json', import.meta.url);
const inventoryPath = new URL('./detail-inventory.json', import.meta.url);
const specPath = new URL('./object-sculpt-spec.json', import.meta.url);

const assessment = JSON.parse(await fs.readFile(assessmentPath, 'utf8'));
const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
const spec = JSON.parse(await fs.readFile(specPath, 'utf8'));
const componentTemplate = structuredClone(spec.componentTree[0]);
const materialTemplate = structuredClone(spec.materials[0]);

const evidence = {
  front: 'front-view',
  rear: 'rear-view',
  left: 'left-view',
  right: 'right-view',
  top: 'top-view',
  hero: 'three-quarter-view',
};

const details = [
  { id: 'd01-step-bevel', kind: 'bevel', description: 'Rounded chamfer catching a warm highlight on both octagonal steps.', region: { x: 0.03, y: 0.22, width: 0.45, height: 0.11, units: 'normalized' }, scale: '0.025 m radius', affects: 'plinth silhouette and highlight', mapsTo: { type: 'component.localFeatures', ref: 'step-edge-bevel' }, evidenceRef: evidence.front, confidence: 0.97 },
  { id: 'd02-radial-seams', kind: 'seam', description: 'Eight radial stone joints segment each octagonal plinth ring.', region: { x: 0.02, y: 0.22, width: 0.46, height: 0.11, units: 'normalized' }, scale: '8 seams per ring', affects: 'plinth construction read', mapsTo: { type: 'component.localFeatures', ref: 'octagonal-radial-seams' }, evidenceRef: evidence.top, confidence: 0.95 },
  { id: 'd03-basin-lip', kind: 'bevel', description: 'Thick rounded lower-basin lip with a broad cream highlight.', region: { x: 0.05, y: 0.14, width: 0.42, height: 0.1, units: 'normalized' }, scale: '0.14 m section radius', affects: 'lower basin silhouette', mapsTo: { type: 'component.localFeatures', ref: 'lower-lip-bevel' }, evidenceRef: evidence.hero, confidence: 0.98 },
  { id: 'd04-inner-channel', kind: 'groove', description: 'Dark inner channel beneath the cream basin lip.', region: { x: 0.06, y: 0.15, width: 0.4, height: 0.05, units: 'normalized' }, scale: '0.025 m recessed band', affects: 'basin depth and contact AO', mapsTo: { type: 'component.localFeatures', ref: 'lower-inner-groove' }, evidenceRef: evidence.front, confidence: 0.92 },
  { id: 'd05-panel-recess', kind: 'groove', description: 'Four dark-teal recessed trapezoid panels in the pedestal faces.', region: { x: 0.17, y: 0.08, width: 0.16, height: 0.13, units: 'normalized' }, scale: 'four radial panels', affects: 'pedestal identity', mapsTo: { type: 'component.localFeatures', ref: 'pedestal-panel-recess' }, evidenceRef: evidence.hero, confidence: 0.98 },
  { id: 'd06-fish-mouth', kind: 'hole', description: 'Round fish-mouth outlet at the end of each stylized spout.', region: { x: 0.1, y: 0.09, width: 0.3, height: 0.08, units: 'normalized' }, scale: '0.045 m outlet', affects: 'spout silhouette and water emitter', mapsTo: { type: 'component.localFeatures', ref: 'fish-mouth-outlet' }, evidenceRef: evidence.front, confidence: 0.91 },
  { id: 'd07-fish-eyes', kind: 'fastener', description: 'Paired raised eye beads on each fish-head spout.', region: { x: 0.11, y: 0.08, width: 0.28, height: 0.07, units: 'normalized' }, scale: 'two 0.018 m beads per spout', affects: 'spout recognizability', mapsTo: { type: 'component.localFeatures', ref: 'fish-eye-beads' }, evidenceRef: evidence.hero, confidence: 0.82 },
  { id: 'd08-upper-rim', kind: 'ridge', description: 'Raised rounded crest on the upper bowl rim.', region: { x: 0.17, y: 0.015, width: 0.17, height: 0.08, units: 'normalized' }, scale: '0.08 m rounded ring', affects: 'upper bowl silhouette', mapsTo: { type: 'component.localFeatures', ref: 'upper-rim-ridge' }, evidenceRef: evidence.left, confidence: 0.95 },
  { id: 'd09-finial-flutes', kind: 'ridge', description: 'Eight shallow vertical flutes on the acorn finial.', region: { x: 0.23, y: 0.0, width: 0.08, height: 0.05, units: 'normalized' }, scale: 'eight radial flutes', affects: 'finial highlight breakup', mapsTo: { type: 'component.localFeatures', ref: 'finial-flutes' }, evidenceRef: evidence.hero, confidence: 0.89 },
  { id: 'd10-water-ripples', kind: 'gloss', description: 'Low-roughness concentric and radial ripple highlights on both water surfaces.', region: { x: 0.06, y: 0.13, width: 0.4, height: 0.09, units: 'normalized' }, scale: '0.02-0.12 m wavelengths', affects: 'water material response', mapsTo: { type: 'material.localOverrides', ref: 'water-ripple-gloss' }, evidenceRef: evidence.top, confidence: 0.9 },
  { id: 'd11-limestone-mottle', kind: 'stain', description: 'Very subtle warm and cool limestone mottling with cavity-biased darkening.', region: { x: 0.02, y: 0.02, width: 0.46, height: 0.29, units: 'normalized' }, scale: '0.06-0.35 m low-contrast patches', affects: 'limestone albedo and roughness', mapsTo: { type: 'material.localOverrides', ref: 'limestone-mottle' }, evidenceRef: evidence.front, confidence: 0.84 },
  { id: 'd12-copper-patina', kind: 'stain', description: 'Muted brown-red copper rings with restrained teal patina in lower cavities.', region: { x: 0.18, y: 0.03, width: 0.15, height: 0.12, units: 'normalized' }, scale: '0.03-0.08 m bands', affects: 'copper color and roughness', mapsTo: { type: 'material.localOverrides', ref: 'copper-cavity-patina' }, evidenceRef: evidence.hero, confidence: 0.86 }
];

const qualityContract = {
  qualityBar: 'complex stylized mobile-game prop',
  definitionOfDone: [
    'All six views read as one 2.6 m octagonal two-tier fountain with the same four-spout and four-panel rotational system.',
    'The optimized LOD0 retains the plinth, lower pool, faceted pedestal, four fish spouts, upper bowl, water disks, copper bands, and finial at or below 25k triangles and five materials.',
    'Unity receives stable water and spout sockets, compound colliders, a decreasing three-level LODGroup, and an isolated review scene.'
  ],
  minimumSpecDepth: { macroComponents: 4, mesoComponents: 10, microFeatureGroups: 10, materialLayers: 5, repetitionSystems: 3, reviewViewpoints: 6 },
  featureGroups: [
    { id: 'fountain-silhouette', name: 'Octagonal tiered fountain silhouette', required: true, qualityCriteria: ['A wide two-step octagonal base supports a round lower basin, narrower faceted tower, smaller upper bowl, and compact finial.'], evidenceRefs: [evidence.front, evidence.hero], failureModes: ['cylindrical generic fountain', 'wrong base width', 'missing upper tier'] },
    { id: 'basin-tower-structure', name: 'Lower basin, pedestal, and upper bowl hierarchy', required: true, qualityCriteria: ['Every tier visibly overlaps or embeds into its supporting tier with no floating gaps.'], evidenceRefs: [evidence.left, evidence.hero], failureModes: ['floating bowl', 'pedestal misses basin floor', 'upper bowl too large'] },
    { id: 'spout-panel-system', name: 'Four fish spouts and four recessed panels', required: true, qualityCriteria: ['Four evenly spaced teal fish heads project from alternating pedestal faces and align with four dark-teal inset panels and emitter sockets.'], evidenceRefs: [evidence.top, evidence.hero], failureModes: ['wrong count', 'uneven radial spacing', 'spouts float away from tower'] },
    { id: 'stone-water-materials', name: 'Warm limestone, teal ceramic, water, and copper response', required: true, qualityCriteria: ['Stone is matte and subtly mottled, water is glossy and translucent, teal panels are glazed, and copper rings remain small metallic accents.'], evidenceRefs: [evidence.front, evidence.hero], failureModes: ['flat plastic stone', 'opaque water', 'excessive copper'] }
  ],
  visualDeltaChecks: ['diameter-to-height and tier-spacing delta', 'octagonal footprint and radial seam delta', 'four-spout and four-panel count/spacing delta', 'lower-versus-upper basin diameter delta', 'limestone/teal/water/copper palette and roughness delta'],
  antiShallowSpecRules: [
    'Do not merge the four spout sockets or water surfaces into the pedestal mesh.',
    'Do not represent the octagonal seams, panel recesses, fish mouths, finial flutes, or water ripples as prose only.',
    'Do not continue when any basin, ring, or spout has a visible attachment gap.',
    'Do not exceed the 25k triangle, five material, or eight draw-call target after Blender optimization.'
  ]
};

assessment.preSpecAssessment.objectClass = {
  primaryType: 'stylized tiered plaza fountain',
  primaryDomain: 'object',
  formLanguage: ['hard-surface', 'architectural', 'rotational', 'rounded low-poly'],
  structureKind: ['compound object', 'layered shell', 'radial repeated modules'],
  motionPotential: ['static prop', 'effect emitter', 'detachable upper bowl and finial'],
  materialFamilies: ['limestone', 'glazed ceramic', 'water-like transparent surface', 'aged copper'],
  notes: 'Six generated views expose the full footprint and top layout. Exact four-way symmetry removes hidden-side ambiguity.'
};
assessment.preSpecAssessment.complexity = {
  tier: 'complex',
  scores: { silhouetteComplexity: 2, componentCount: 3, hierarchyDepth: 2, repetitionDensity: 2, materialLayerCount: 3, localDetailDensity: 2, occlusionRisk: 1, actionReadinessNeed: 2 },
  estimatedCounts: { macroComponents: 5, mesoComponents: 14, microFeatureGroups: 12, materialLayers: 5, repetitionSystems: 3 },
  reasoning: [
    'The prop combines stacked architectural masses with distinct basin, pedestal, bowl, finial, and water layers.',
    'Four fish spouts, four recessed panels, eight base seams, and eight finial flutes form repeated radial systems.',
    'Unity review needs compound colliders, water surfaces, and stable emitter sockets while remaining mobile-safe.'
  ]
};
assessment.preSpecAssessment.specDepthDecision = {
  requiredDepth: 'complex',
  minimumComponentLevels: ['macro', 'meso', 'micro'],
  needsRepetitionSystems: true,
  needsMaterialLocalOverrides: true,
  needsMultipleReviewViews: true,
  needsActionReadyHierarchy: true,
  rationale: 'Rotational symmetry is simple to parameterize, but the layered tiers, repeated ornaments, transparent water, and runtime sockets require a deep explicit spec.'
};
assessment.preSpecAssessment.unknownsToResolveBeforeImplementation = [];
assessment.preSpecAssessment.detailInventory = { scanMethod: 'grid-3x3', targetMinDetails: 10, details };
assessment.preSpecAssessment.anatomy = { applies: false };
assessment.qualityContract = qualityContract;

inventory.detailInventory = { scanMethod: 'grid-3x3', targetMinDetails: 10, details };
inventory.sourceImage = 'Assets/Concepts/PlazaFountain_6View.png';
inventory.zonesDir = 'Pipeline/PlazaFountain/detail-zones';

function makeComponent({
  id, name, level, role, primitive, parent, material, dimensions, position,
  importance = 0.8, localFeatures = [], sockets = [], collider = 'box',
  attachment = null, pivotMode = 'center', fidelityTier = 'structural'
}) {
  const value = structuredClone(componentTemplate);
  value.id = id;
  value.name = name;
  value.level = level;
  value.role = role;
  value.importance = importance;
  value.confidence = 0.94;
  value.primitive = primitive;
  value.geometryDescriptor = {
    topologyIntent: 'stylized low-poly real-time hard-surface geometry with silhouette-safe bevels',
    edgeTreatment: { type: 'chamfer', bevelRadius: level === 'micro' ? 0.008 : 0.025, segments: 2 },
    deformationStack: [],
    uvStrategy: 'generated cylindrical/planar coordinates with stable object-scale texel density',
    normalStrategy: 'weighted vertex normals plus independent tangent-space micro normal'
  };
  value.parent = parent;
  value.attachment = parent ? {
    parentId: parent,
    parentSocket: attachment?.parentSocket ?? `${parent}-surface`,
    localStart: attachment?.localStart ?? [0, 0, 0],
    localEnd: attachment?.localEnd ?? position,
    baseRadius: attachment?.baseRadius ?? 0.08,
    endRadius: attachment?.endRadius ?? 0.08,
    embedDepth: attachment?.embedDepth ?? 0.015,
    overlap: attachment?.overlap ?? 0.015,
    contactType: attachment?.contactType ?? 'overlap',
    gapTolerance: 0.01,
    evidenceRefs: attachment?.evidenceRefs ?? [evidence.hero]
  } : null;
  value.dimensions = { width: dimensions[0], height: dimensions[1], depth: dimensions[2], units: 'meters', confidence: 0.94 };
  value.transform = { position, rotation: [0, 0, 0], scale: [1, 1, 1] };
  value.actionProfile.animationRole = role;
  value.actionProfile.pivot = { mode: pivotMode, localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.95 };
  value.actionProfile.sockets = sockets.map(([socketId, localPosition]) => ({ id: socketId, localPosition }));
  value.actionProfile.collider = { type: collider, offset: [0, 0, 0], scale: dimensions, isTrigger: false, notes: 'Primitive proxy; water surfaces use trigger=false visual-only metadata and receive no Unity collider.' };
  value.actionProfile.destruction = { breakable: false, fractureGroup: id, seamRefs: [], detachableFragments: [], breakImpulse: 0, debrisMaterial: material };
  value.material = material;
  value.materialLayers = [material];
  value.localFeatures = localFeatures;
  value.surfaceDetail = {
    macroRoughness: material === 'water' ? 0.08 : 0.14,
    microRoughness: material === 'limestone' ? 0.18 : 0.08,
    bumpAmplitude: material === 'limestone' ? 0.012 : 0.003,
    normalPattern: material === 'limestone' ? 'independent multi-frequency limestone pores' : 'independent fine surface field',
    displacementPattern: 'none',
    occlusionPattern: 'cavity-biased at stacked contacts and grooves',
    edgeWearPattern: 'subtle lower-roughness bevel crests',
    notes: 'Surface response remains subtle enough for the clean mobile-game style.'
  };
  value.evidenceRefs = [evidence.front, evidence.hero];
  value.details = localFeatures.map(feature => feature.id);
  value.fidelityTier = fidelityTier;
  return value;
}

const components = [
  makeComponent({ id: 'root', name: 'Plaza Fountain Root', level: 'macro', role: 'root', primitive: 'cylinder', parent: null, material: 'limestone', dimensions: [2.6, 2.2, 2.6], position: [0, 0, 0], importance: 1, sockets: [['WaterLower_Socket', [0, 0.55, 0]], ['WaterUpper_Socket', [0, 1.78, 0]], ['Spout_N', [0, 1.18, 0.56]], ['Spout_E', [0.56, 1.18, 0]], ['Spout_S', [0, 1.18, -0.56]], ['Spout_W', [-0.56, 1.18, 0]]], collider: 'compound', pivotMode: 'base', fidelityTier: 'blockout' }),
  makeComponent({ id: 'plinth-system', name: 'Octagonal Plinth System', level: 'macro', role: 'static-shell', primitive: 'cylinder', parent: 'root', material: 'limestone', dimensions: [2.6, 0.35, 2.6], position: [0, 0.175, 0], importance: 1, localFeatures: [{ id: 'octagonal-radial-seams', kind: 'seam', count: 8, geometryEffect: 'thin recessed radial joints on both steps', evidenceRefs: [evidence.top] }], collider: 'cylinder' }),
  makeComponent({ id: 'plinth-step-lower', name: 'Lower Octagonal Step', level: 'meso', role: 'static-shell', primitive: 'cylinder', parent: 'plinth-system', material: 'limestone', dimensions: [2.6, 0.16, 2.6], position: [0, 0.08, 0], localFeatures: [{ id: 'step-edge-bevel', kind: 'bevel', bevelRadius: 0.025, segments: 2, evidenceRefs: [evidence.front, evidence.hero] }], collider: 'cylinder' }),
  makeComponent({ id: 'plinth-step-upper', name: 'Upper Octagonal Step', level: 'meso', role: 'static-shell', primitive: 'cylinder', parent: 'plinth-system', material: 'limestone', dimensions: [2.32, 0.19, 2.32], position: [0, 0.255, 0], localFeatures: [{ id: 'upper-step-inset', kind: 'seam', geometryEffect: 'recessed horizontal construction line', evidenceRefs: [evidence.left] }], collider: 'cylinder' }),
  makeComponent({ id: 'lower-basin-system', name: 'Lower Basin System', level: 'macro', role: 'static-shell', primitive: 'cylinder', parent: 'root', material: 'limestone', dimensions: [2.12, 0.5, 2.12], position: [0, 0.57, 0], importance: 1, collider: 'cylinder' }),
  makeComponent({ id: 'lower-basin-wall', name: 'Lower Basin Wall', level: 'meso', role: 'static-shell', primitive: 'cylinder', parent: 'lower-basin-system', material: 'limestone', dimensions: [1.98, 0.36, 1.98], position: [0, 0.48, 0], localFeatures: [{ id: 'wall-panel-seams', kind: 'seam', count: 8, geometryEffect: 'shallow vertical panel lines', evidenceRefs: [evidence.front] }], collider: 'cylinder' }),
  makeComponent({ id: 'lower-basin-rim', name: 'Thick Lower Basin Rim', level: 'meso', role: 'static-shell', primitive: 'torus', parent: 'lower-basin-system', material: 'limestone', dimensions: [2.18, 0.24, 2.18], position: [0, 0.74, 0], importance: 1, localFeatures: [{ id: 'lower-lip-bevel', kind: 'bevel', bevelRadius: 0.08, segments: 4, evidenceRefs: [evidence.hero] }, { id: 'lower-inner-groove', kind: 'groove', width: 0.025, depth: 0.015, evidenceRefs: [evidence.front] }], collider: 'cylinder' }),
  makeComponent({ id: 'lower-water', name: 'Lower Water Surface', level: 'meso', role: 'effect-surface', primitive: 'cylinder', parent: 'lower-basin-system', material: 'water', dimensions: [1.82, 0.025, 1.82], position: [0, 0.69, 0], sockets: [['WaterLower_Socket', [0, 0.015, 0]]], collider: 'none' }),
  makeComponent({ id: 'tower-system', name: 'Faceted Pedestal Tower', level: 'macro', role: 'static-shell', primitive: 'cylinder', parent: 'root', material: 'limestone', dimensions: [0.92, 0.94, 0.92], position: [0, 1.15, 0], importance: 1, sockets: [['spout-ring', [0, 0.03, 0]], ['upper-bowl-seat', [0, 0.47, 0]]], collider: 'cylinder' }),
  makeComponent({ id: 'pedestal-body', name: 'Tapered Octagonal Pedestal', level: 'meso', role: 'static-shell', primitive: 'cylinder', parent: 'tower-system', material: 'limestone', dimensions: [0.88, 0.82, 0.88], position: [0, 1.13, 0], localFeatures: [{ id: 'pedestal-chamfers', kind: 'bevel', bevelRadius: 0.025, segments: 2, evidenceRefs: [evidence.left] }], collider: 'cylinder' }),
  makeComponent({ id: 'pedestal-panel-system', name: 'Four Recessed Teal Panels', level: 'meso', role: 'static-detail', primitive: 'box', parent: 'pedestal-body', material: 'dark-recess', dimensions: [0.42, 0.52, 0.025], position: [0, 1.16, 0.43], localFeatures: [{ id: 'pedestal-panel-recess', kind: 'groove', depth: 0.018, borderWidth: 0.045, evidenceRefs: [evidence.hero] }], collider: 'none' }),
  makeComponent({ id: 'fish-spout-prototype', name: 'Stylized Fish Spout Prototype', level: 'meso', role: 'effect-emitter', primitive: 'sphere', parent: 'tower-system', material: 'teal-ceramic', dimensions: [0.24, 0.2, 0.3], position: [0, 1.2, 0.57], importance: 0.95, localFeatures: [{ id: 'fish-mouth-outlet', kind: 'hole', diameter: 0.045, depth: 0.03, evidenceRefs: [evidence.front] }, { id: 'fish-eye-beads', kind: 'fastener', count: 2, radius: 0.018, evidenceRefs: [evidence.hero] }], sockets: [['WaterJet_Socket', [0, -0.03, 0.18]]], collider: 'none', attachment: { parentSocket: 'spout-ring', localStart: [0, 0.03, 0.42], localEnd: [0, 0.03, 0.64], baseRadius: 0.11, endRadius: 0.07, embedDepth: 0.045, overlap: 0.04, contactType: 'embedded', evidenceRefs: [evidence.hero] } }),
  makeComponent({ id: 'pedestal-cap', name: 'Octagonal Pedestal Cap', level: 'meso', role: 'static-shell', primitive: 'cylinder', parent: 'tower-system', material: 'limestone', dimensions: [1.0, 0.16, 1.0], position: [0, 1.62, 0], localFeatures: [{ id: 'cap-edge-groove', kind: 'groove', width: 0.02, depth: 0.01, evidenceRefs: [evidence.right] }], collider: 'cylinder' }),
  makeComponent({ id: 'copper-band-lower', name: 'Lower Copper Accent Band', level: 'micro', role: 'static-detail', primitive: 'torus', parent: 'tower-system', material: 'copper', dimensions: [0.74, 0.08, 0.74], position: [0, 0.82, 0], collider: 'none' }),
  makeComponent({ id: 'upper-basin-system', name: 'Upper Bowl System', level: 'macro', role: 'static-shell', primitive: 'lathe', parent: 'root', material: 'limestone', dimensions: [1.02, 0.42, 1.02], position: [0, 1.83, 0], importance: 1, sockets: [['finial-seat', [0, 0.2, 0]]], collider: 'cylinder' }),
  makeComponent({ id: 'upper-bowl', name: 'Upper Stone Bowl', level: 'meso', role: 'static-shell', primitive: 'lathe', parent: 'upper-basin-system', material: 'limestone', dimensions: [1.02, 0.34, 1.02], position: [0, 1.81, 0], localFeatures: [{ id: 'upper-rim-ridge', kind: 'ridge', height: 0.05, width: 0.08, evidenceRefs: [evidence.left] }, { id: 'upper-bowl-flutes', kind: 'groove', count: 12, depth: 0.012, evidenceRefs: [evidence.front] }], collider: 'cylinder', pivotMode: 'center' }),
  makeComponent({ id: 'upper-water', name: 'Upper Water Surface', level: 'meso', role: 'effect-surface', primitive: 'cylinder', parent: 'upper-basin-system', material: 'water', dimensions: [0.76, 0.02, 0.76], position: [0, 1.9, 0], sockets: [['WaterUpper_Socket', [0, 0.015, 0]]], collider: 'none' }),
  makeComponent({ id: 'copper-band-upper', name: 'Upper Copper Accent Band', level: 'micro', role: 'static-detail', primitive: 'torus', parent: 'upper-basin-system', material: 'copper', dimensions: [0.58, 0.08, 0.58], position: [0, 1.63, 0], collider: 'none' }),
  makeComponent({ id: 'finial', name: 'Acorn Finial', level: 'meso', role: 'detachable-ornament', primitive: 'lathe', parent: 'upper-basin-system', material: 'limestone', dimensions: [0.34, 0.42, 0.34], position: [0, 2.09, 0], importance: 0.88, localFeatures: [{ id: 'finial-flutes', kind: 'ridge', count: 8, height: 0.012, evidenceRefs: [evidence.hero] }], collider: 'capsule', pivotMode: 'base', attachment: { parentSocket: 'finial-seat', localStart: [0, 0.2, 0], localEnd: [0, 0.59, 0], baseRadius: 0.13, endRadius: 0.04, embedDepth: 0.025, overlap: 0.02, contactType: 'socket', evidenceRefs: [evidence.front] } })
];

function makeMaterial({ id, name, color, roughness, metalness = 0, normalStrength = 0.2, localOverrides = [], extras = {} }) {
  const value = structuredClone(materialTemplate);
  value.id = id;
  value.name = name;
  value.baseColor = color;
  value.color = color;
  value.albedo = { dominant: color, secondary: extras.secondary ?? [color], samplingNotes: 'Sampled from the generated six-view concept and reviewed under neutral light.' };
  value.colorVariation = { palette: [color, ...(extras.secondary ?? [])], pattern: extras.pattern ?? 'low-frequency mottled field', amplitude: extras.amplitude ?? 0.08, heightCorrelation: extras.heightCorrelation ?? 0.15 };
  value.textureResolution = 1024;
  value.textureProjection = { mode: extras.projection ?? 'triplanar-like object coordinates', repeat: [2, 2], anisotropy: 8, texelDensityIntent: 'Stable object-scale detail; no stretching across differently scaled tiers.' };
  value.surfaceFrequencyBands = extras.bands ?? [
    { id: 'macro', frequency: 1.5, amplitude: 0.08, role: 'broad tone variation' },
    { id: 'meso', frequency: 11, amplitude: 0.035, role: 'pores, subtle veins, and ripple relief' },
    { id: 'micro', frequency: 58, amplitude: 0.012, role: 'grazing-light highlight breakup' }
  ];
  value.roughness = { base: roughness, variation: extras.roughnessVariation ?? 0.1, map: 'independent deterministic procedural field', localResponse: extras.localResponse ?? 'cavities are rougher; exposed bevel crests are slightly smoother' };
  value.metalness = { base: metalness, variation: metalness > 0 ? 0.08 : 0 };
  value.normal = { pattern: 'independent deterministic height field', strength: normalStrength, scale: extras.normalScale ?? 28, space: 'tangent' };
  value.bump = { pattern: extras.bumpPattern ?? 'independent fine-grain height', amplitude: extras.bumpAmplitude ?? 0.01, scale: extras.bumpScale ?? 24 };
  value.ambientOcclusion = { cavityStrength: extras.ao ?? 0.24, contactShadowBias: 0.35, notes: 'Concentrate at stacked ring contacts, grooves, panel recesses, and mouth sockets.' };
  value.localOverrides = localOverrides;
  Object.assign(value, extras.fields ?? {});
  value.notes = extras.notes ?? 'Clean stylized PBR response suitable for mobile isometric viewing.';
  return value;
}

const materials = [
  makeMaterial({ id: 'limestone', name: 'Warm Carved Limestone', color: '#D8C7A0', roughness: 0.72, normalStrength: 0.2, localOverrides: [{ id: 'limestone-mottle', region: 'broad exposed stone faces and cavity contacts', dirtAmount: 0.06, cavityBias: 0.7, colorShift: '#B8AA8B', roughness: 0.79, evidenceRef: evidence.front }, { id: 'stone-bevel-polish', region: 'outer bevel crests', roughness: 0.58, evidenceRef: evidence.hero }], extras: { secondary: ['#C7B58E', '#E4D7B9'], pattern: 'macro cloudy limestone mottling independent of roughness', amplitude: 0.07, bumpAmplitude: 0.009, normalScale: 38 } }),
  makeMaterial({ id: 'teal-ceramic', name: 'Glazed Teal Ceramic', color: '#477E78', roughness: 0.34, normalStrength: 0.08, localOverrides: [{ id: 'ceramic-cavity-darken', region: 'fish mouths and eye sockets', roughness: 0.42, colorShift: '#294F4D', evidenceRef: evidence.hero }], extras: { secondary: ['#356864', '#65958D'], pattern: 'subtle glaze clouding', amplitude: 0.045, roughnessVariation: 0.06, bumpAmplitude: 0.002, fields: { clearcoat: { base: 0.35, roughness: 0.18 } } } }),
  makeMaterial({ id: 'water', name: 'Muted Teal Water', color: '#4D9F9D', roughness: 0.1, normalStrength: 0.24, localOverrides: [{ id: 'water-ripple-gloss', region: 'lower and upper water surfaces around spout impacts', roughness: 0.06, normalStrength: 0.32, evidenceRef: evidence.top }], extras: { secondary: ['#78BAB5', '#2F8585'], pattern: 'independent concentric and radial ripple normal field', amplitude: 0.04, roughnessVariation: 0.035, bumpPattern: 'multi-octave ripple height', bumpAmplitude: 0.016, normalScale: 14, fields: { transparent: true, opacity: 0.82, transmission: 0.18, ior: 1.333, depthWrite: false }, notes: 'Runtime water surface; streams are effect renderers and not fused to the exported structural mesh.' } }),
  makeMaterial({ id: 'copper', name: 'Aged Copper Accent', color: '#9C624B', roughness: 0.38, metalness: 0.72, normalStrength: 0.09, localOverrides: [{ id: 'copper-cavity-patina', region: 'underside of narrow copper rings', dirtAmount: 0.12, cavityBias: 0.85, patinaColor: '#477F78', roughness: 0.52, evidenceRef: evidence.hero }], extras: { secondary: ['#784735', '#B27A5F'], pattern: 'directional ring brushing', amplitude: 0.07, roughnessVariation: 0.1, bumpAmplitude: 0.003, normalScale: 46 } }),
  makeMaterial({ id: 'dark-recess', name: 'Dark Teal Recess', color: '#294B4A', roughness: 0.57, normalStrength: 0.12, localOverrides: [{ id: 'panel-edge-ao', region: 'perimeter of four trapezoid panels', roughness: 0.64, colorShift: '#1F3939', evidenceRef: evidence.front }], extras: { secondary: ['#1F3A3A', '#355A58'], pattern: 'very subtle matte ceramic variation', amplitude: 0.035, roughnessVariation: 0.06, bumpAmplitude: 0.002 } })
];

spec.targetName = 'Stylized Tiered Plaza Fountain';
spec.targetId = 'plaza-fountain';
spec.sourceImage = '../../Assets/Concepts/PlazaFountain_6View.png';
spec.suitability = 'pass';
spec.scores = { object_isolation: 3, silhouette_readability: 3, depth_inference: 3, primitive_decomposition: 3, material_procedurality: 3, occlusion_risk: 1, interaction_fit: 3 };
spec.preSpecAssessment = assessment.preSpecAssessment;
spec.qualityContract = qualityContract;
spec.qualityTargets = { targetFidelity: 0.84, mustMatch: ['octagonal tiered silhouette and proportions', 'four-spout/four-panel radial system', 'warm limestone, teal water/ceramic, and copper material separation', 'recognizable basin lips, panel recesses, fish mouths, and finial'], niceToHave: ['subtle limestone pores', 'animated runtime water jets'], fpsTarget: 60, reviewViewpoints: ['front', 'rear', 'left', 'right', 'top', 'three-quarter'] };
spec.featureReviewTargets = [
  { id: 'fountain-silhouette', name: 'Wide octagonal base and two-tier fountain silhouette', tier: 'critical', passIds: ['blockout', 'form-refinement'], minimumScore: 0.8, mustPass: true, componentRefs: ['plinth-system', 'lower-basin-system', 'tower-system', 'upper-basin-system'], evidenceRefs: [evidence.front, evidence.hero] },
  { id: 'basin-tower-structure', name: 'Attached basin, tower, upper bowl, and finial hierarchy', tier: 'critical', passIds: ['structural-pass', 'form-refinement'], minimumScore: 0.8, mustPass: true, componentRefs: ['lower-basin-system', 'tower-system', 'upper-basin-system', 'finial'], evidenceRefs: [evidence.left, evidence.hero] },
  { id: 'spout-panel-system', name: 'Four fish spouts and four recessed teal panels', tier: 'critical', passIds: ['structural-pass', 'interaction-pass'], minimumScore: 0.8, mustPass: true, componentRefs: ['pedestal-panel-system', 'fish-spout-prototype'], evidenceRefs: [evidence.top, evidence.hero] },
  { id: 'stone-water-materials', name: 'Limestone, ceramic, water, and copper surface response', tier: 'critical', passIds: ['material-pass', 'surface-pass', 'lighting-pass'], minimumScore: 0.76, mustPass: true, componentRefs: ['plinth-system', 'lower-water', 'fish-spout-prototype', 'upper-water'], evidenceRefs: [evidence.front, evidence.hero] },
  { id: 'gameplay-readability', name: 'Tier and spout readability at isometric gameplay distance', tier: 'important', passIds: ['lighting-pass', 'optimization-pass'], minimumScore: 0.68, mustPass: false, componentRefs: ['root'], evidenceRefs: [evidence.hero] }
];
spec.lookDevTargets.qualityPriority = 'balanced mobile-game fidelity';
spec.lookDevTargets.materialPass.referencePbrExtraction.requiredWhenSourceImagePresent = true;
spec.assumptions = [
  'The generated turnaround is a concept specification rather than calibrated photogrammetry.',
  'Four-way rotational symmetry from the top view controls hidden-side reconstruction.',
  'Water jets and impact ripples are runtime effects; the structural export retains water disks and emitter sockets.'
];
spec.coordinateFrame = { front: '+Z', up: '+Y', right: '+X', origin: 'ground center at the center of the octagonal plinth', units: 'meters', scaleReference: '2.6 m overall diameter and 2.2 m overall height' };
spec.silhouette = { boundingShape: 'wide stepped octagon supporting a circular basin, narrowed faceted tower, compact upper bowl, and acorn finial', aspectRatios: ['diameter:height = 1.18:1', 'lower basin diameter:upper bowl diameter = 2.1:1', 'pedestal width:base diameter = 0.35:1'], symmetry: 'exact four-way rotational ornament symmetry over an eight-sided base', dominantCurves: ['rounded lower basin lip', 'concave upper bowl profile', 'tapered finial'], negativeSpaces: ['annular lower water ring around pedestal', 'small annular upper water ring around finial base'], landmarks: ['two octagonal steps', 'thick lower cream rim', 'four teal spouts', 'four recessed teal panels', 'copper ring below upper bowl', 'acorn finial'] };
spec.viewEvidence = [
  { id: evidence.front, view: 'front', imageRegion: { x: 0, y: 0, width: 0.5, height: 0.3333, units: 'normalized' }, observations: ['height and diameter proportions', 'front panel and lateral spout projection', 'tier contact and stone seam rhythm'], confidence: 0.96 },
  { id: evidence.rear, view: 'rear', imageRegion: { x: 0.5, y: 0, width: 0.5, height: 0.3333, units: 'normalized' }, observations: ['rotational symmetry and rear material continuity'], confidence: 0.94 },
  { id: evidence.left, view: 'left', imageRegion: { x: 0, y: 0.3333, width: 0.5, height: 0.3333, units: 'normalized' }, observations: ['upper bowl profile', 'pedestal taper', 'basin wall thickness'], confidence: 0.96 },
  { id: evidence.right, view: 'right', imageRegion: { x: 0.5, y: 0.3333, width: 0.5, height: 0.3333, units: 'normalized' }, observations: ['mirrored profile and spout attachment'], confidence: 0.95 },
  { id: evidence.top, view: 'top', imageRegion: { x: 0, y: 0.6667, width: 0.5, height: 0.3333, units: 'normalized' }, observations: ['eight-sided footprint', 'four-spout radial spacing', 'annular water surfaces'], confidence: 0.98 },
  { id: evidence.hero, view: 'three-quarter', imageRegion: { x: 0.5, y: 0.6667, width: 0.5, height: 0.3333, units: 'normalized' }, observations: ['material separation', 'bevel response', 'attachment depth', 'gameplay-scale silhouette'], confidence: 0.98 }
];
spec.componentTree = components;
spec.materials = materials;
spec.repetitionSystems = [
  { id: 'radial-fish-spouts', kind: 'radial-instancing', componentRefs: ['fish-spout-prototype'], count: 4, distribution: 'uniform at 90 degree intervals around the pedestal', geometry: 'shared fish-head prototype with embedded neck and separate mouth socket', material: 'teal-ceramic', evidenceRefs: [evidence.top, evidence.hero] },
  { id: 'radial-pedestal-panels', kind: 'radial-instancing', componentRefs: ['pedestal-panel-system'], count: 4, distribution: 'uniform at 90 degree intervals on alternating pedestal faces', geometry: 'shared inset trapezoid plate and cream frame border', material: 'dark-recess', evidenceRefs: [evidence.front, evidence.top] },
  { id: 'octagonal-stone-seams', kind: 'radial-repetition', componentRefs: ['plinth-step-lower', 'plinth-step-upper', 'lower-basin-wall'], count: 8, distribution: 'one seam aligned to each octagonal segment boundary', geometry: 'thin recessed joint strips', material: 'limestone', evidenceRefs: [evidence.top, evidence.front] },
  { id: 'finial-flute-system', kind: 'radial-repetition', componentRefs: ['finial'], count: 8, distribution: 'uniform shallow vertical flutes', geometry: 'raised tapered ridges', material: 'limestone', evidenceRefs: [evidence.hero] }
];
for (const pass of spec.buildPasses) pass.componentRefs = components.map(component => component.id);
spec.performanceBudget = { qualityPriority: 'balanced mobile-game prop', targetTriangles: 25000, maxDrawCalls: 8, textureSize: 1024, fpsTarget: 60, optimizationPolicy: 'Preserve tier silhouette, basin lips, four spouts, panel recesses, water disks, and finial; instance radial details and create strictly decreasing LODs.' };
spec.lodPlan = [
  { tier: 'LOD0-near', distance: 0, targetTriangles: 25000, strategy: 'full silhouette, four fish heads, panel recesses, water surfaces, seams, and finial flutes' },
  { tier: 'LOD1-mid', distance: 14, targetTriangles: 12000, strategy: 'reduce radial segments, simplify fish eyes and mouth cavities, keep four spout silhouettes' },
  { tier: 'LOD2-far', distance: 30, targetTriangles: 4000, strategy: 'merge static stone tiers, replace fish heads with tapered spout wedges, remove fine seams and flutes' }
];
spec.lightingFromPhoto = [
  'Key light: large warm area/directional light from camera-left and above, approximately 4800 K, intensity 3.0, soft shadow radius.',
  'Fill light: cool neutral hemisphere or large area fill from camera-right, intensity 0.75.',
  'Rim/environment: soft teal-neutral rear-right rim and low-contrast studio environment reflection.',
  'Output: ACES Filmic tone mapping, exposure +0.2, light gray background, soft contact shadow and ambient occlusion beneath the octagonal base.'
];
spec.proceduralStrategy = [
  'Build the stepped octagonal plinth, round basin masses, faceted tower, upper bowl, and finial as parameterized cylinders, tori, lathe profiles, and beveled extrusions.',
  'Instance four fish-spout modules and four inset-panel modules around the pedestal with exact 90 degree spacing.',
  'Generate limestone and water roughness/normal fields independently from albedo using deterministic seeds.',
  'Expose water surfaces and six effect sockets separately from structural meshes.',
  'Export named hierarchy to GLB with +Z forward, +Y up, meter scale, then create LOD1/LOD2 and material consolidation in Blender.'
];
spec.animationAnchors = ['root supports whole-prop transform', 'UpperBowl_Pivot and Finial_Pivot support damage or interaction variants', 'WaterLower_Socket and WaterUpper_Socket support ripple/particle systems', 'Spout_N/E/S/W and child WaterJet_Socket nodes support four runtime water jets'];
spec.destructionAnchors = ['stacked ring seams define detachable tier boundaries', 'finial socket defines a small detachable fragment', 'water surfaces remain non-destructible runtime effects'];
spec.risks = ['Transparent water appearance varies by renderer; validate in Unity review scene.', 'Generated concept shows thin water streams that are intentionally represented as runtime effects, not structural GLB geometry.'];

await fs.writeFile(assessmentPath, `${JSON.stringify(assessment, null, 2)}\n`);
await fs.writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
await fs.writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
