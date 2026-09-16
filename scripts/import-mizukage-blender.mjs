// Install the Blender-authored Mizukage rig into readyroom.
//
// Pipeline:  assets/imports/mizukage-new/base_basic_pbr.glb
//         -> scripts/blender/mizukage_office_rig.py      (18-joint rig + skinning)
//         -> scripts/blender/mizukage_office_animate.py  (6 baked clips)
//         -> this file: reorder animations, re-serialise the four office clips,
//            calibrate the seat/keyboard metadata, publish and checksum.
//
//   node scripts/import-mizukage-blender.mjs [--blender <path>] [--skip-bake]
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {officeClipJSON} from './office-typing.mjs';
import {DESK_ERGONOMICS as D} from '../src/desk-ergonomics.js';

const root = new URL('../', import.meta.url);
const arg = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};
const BLENDER = arg('--blender') ?? process.env.BLENDER ?? 'blender';
const SOURCE = new URL('assets/imports/mizukage-new/base_basic_pbr.glb', root);
const WORK = new URL('.blender-mizukage/', root);
const OUT_GLB = new URL('public/assets/characters/custom/mizukage_chibi_custom.glb', root);
const OUT_MOTION = new URL('public/assets/characters/custom/mizukage-office.json', root);
const OUT_MANIFEST = new URL('public/assets/characters/custom/mizukage-custom-manifest.json', root);

const CLIP_ORDER = ['Idle', 'Walk', 'Sitting', 'SitDown', 'StandUp', 'Typing'];
const OFFICE_CLIPS = {Sitting: 'office_sitting', Typing: 'office_typing', SitDown: 'office_sit_down', StandUp: 'office_stand_up'};

const hash = data => createHash('sha256').update(data).digest('hex');

function runBlender(script, args) {
  const target = fileURLToPath(new URL(`scripts/blender/${script}`, root));
  execFileSync(BLENDER, ['--background', '--factory-startup', '--python', target, '--', ...args], {stdio: 'inherit'});
}

function unpack(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  return {
    doc: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')),
    bin: bytes.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + bytes.readUInt32LE(20 + jsonLength)),
    jsonLength,
  };
}

function repack(doc, bin) {
  const jsonPad = Buffer.alloc((Buffer.byteLength(JSON.stringify(doc)) + 3) & ~3, 0x20);
  Buffer.from(JSON.stringify(doc)).copy(jsonPad);
  const binPad = Buffer.alloc((bin.length + 3) & ~3);
  bin.copy(binPad);
  const output = Buffer.alloc(28 + jsonPad.length + binPad.length);
  output.write('glTF', 0, 'ascii');
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonPad.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonPad.copy(output, 20);
  const header = 20 + jsonPad.length;
  output.writeUInt32LE(binPad.length, header);
  output.writeUInt32LE(0x004e4942, header + 4);
  binPad.copy(output, header + 8);
  return output;
}

// ------------------------------------------------------------------ pipeline
await mkdir(WORK, {recursive: true});
const workDir = fileURLToPath(WORK);
const rigBlend = `${workDir}mizukage-rig.blend`;
if (!process.argv.includes('--skip-bake')) {
  runBlender('mizukage_office_rig.py', [fileURLToPath(SOURCE), workDir]);
  runBlender('mizukage_office_animate.py', [rigBlend, workDir]);
}
const bakedPath = `${workDir}mizukage-office-animations.glb`;
if (!existsSync(bakedPath)) throw new Error(`Blender did not produce ${bakedPath}`);

// ------------------------------------------- reorder + publish the model GLB
const bakedBytes = await readFile(bakedPath);
const {doc, bin} = unpack(bakedBytes);
const byName = new Map(doc.animations.map((animation, index) => [animation.name, index]));
for (const name of CLIP_ORDER) if (!byName.has(name)) throw new Error(`missing baked clip ${name}`);
// GLTFLoader keeps file order, and the demo asserts the exact clip order.
doc.animations = CLIP_ORDER.map(name => doc.animations[byName.get(name)]);
const modelBytes = repack(doc, bin);
await writeFile(OUT_GLB, modelBytes);

// ------------------------------------------------------ office clip payload
const loader = new GLTFLoader().register(() => ({name: 'import-textures', loadTexture: () => Promise.resolve(new THREE.Texture())}));
const gltf = await loader.parseAsync(modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength), '');
const clips = gltf.animations.filter(clip => OFFICE_CLIPS[clip.name]).map(clip => officeClipJSON(clip, 'mizukage', OFFICE_CLIPS[clip.name]));

// Walk speed the scene director should travel at, measured from the planted
// foot's backward drift so the character never skates across the floor.
function measureWalkSpeed() {
  const walk = gltf.animations.find(clip => clip.name === 'Walk');
  const rig = clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(walk).play();
  const steps = 120, track = {Left: [], Right: []};
  for (let index = 0; index <= steps; index++) {
    mixer.setTime(walk.duration * index / steps);
    rig.updateMatrixWorld(true);
    for (const side of ['Left', 'Right']) track[side].push(rig.getObjectByName(`${side}Foot`).getWorldPosition(new THREE.Vector3()));
  }
  const speeds = [];
  for (const side of ['Left', 'Right']) {
    const points = track[side];
    const lowest = Math.min(...points.map(p => p.y));
    for (let index = 1; index < points.length; index++) {
      const onGround = points[index].y < lowest + 0.05 && points[index - 1].y < lowest + 0.05;
      if (!onGround) continue;
      const velocity = -(points[index].z - points[index - 1].z) * steps / walk.duration;
      if (velocity > 0.05) speeds.push(velocity);
    }
  }
  speeds.sort((a, b) => a - b);
  mixer.uncacheRoot(rig);
  return speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0;
}

const scale = 1.18;
const walkSpeed = measureWalkSpeed() * scale;
const motion = {
  clips,
  meta: {
    scale,
    seatOffsetY: 0.055,
    standingOffsetY: 0.055,
    seatOffsetZ: -0.22,
    typingPull: 0.3,
    labelHeight: 2.86,
    actorY: 0.02,
    footrestTop: 0.23,
    seatedHipY: 0.6679,
    footrestOffsetZ: 0,
    walkSpeed: Number(walkSpeed.toFixed(3)),
    adapter: 'Blender-authored 18-joint rig; PBR albedo drives hair/limb separation',
    contact: 'Soles solved onto the footrest, fingertips solved onto the key tops.',
  },
};
const serialized = JSON.stringify(motion);
await writeFile(OUT_MOTION, serialized + '\n');

// ------------------------------------------------------------------ manifest
const sourceBytes = await readFile(SOURCE);
const manifest = {
  version: 5,
  bytes: modelBytes.length,
  sha256: hash(modelBytes),
  sourceSha256: hash(sourceBytes),
  sourceArchive: 'f25f793a-eb2e-498d-9e67-1f2ae3f6e2ff.zip',
  sourceFile: 'base_basic_pbr.glb',
  pipeline: 'scripts/blender/mizukage_office_rig.py + mizukage_office_animate.py',
  vertices: gltf.scene.getObjectByProperty('isSkinnedMesh', true)?.geometry.attributes.position.count ?? null,
  meshCount: 1,
  skinnedMeshCount: 1,
  info: {
    boneCount: 18,
    forward: '+Z',
    height: 2.241466760635376,
    sourceScale: scale,
    extraction: 'Full single-character mesh; original topology, UVs and PBR textures retained',
    motionLimit: motion.meta.contact,
  },
  animations: CLIP_ORDER.map(name => ({name, duration: gltf.animations.find(clip => clip.name === name).duration})),
  modelRevision: hash(modelBytes).slice(0, 12),
  motionRevision: hash(Buffer.concat([modelBytes, Buffer.from(serialized)])).slice(0, 12),
};
await writeFile(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(JSON.stringify({
  glb: fileURLToPath(OUT_GLB),
  bytes: manifest.bytes,
  clips: clips.map(clip => clip.name),
  meta: motion.meta,
  modelRevision: manifest.modelRevision,
  motionRevision: manifest.motionRevision,
}, null, 2));
