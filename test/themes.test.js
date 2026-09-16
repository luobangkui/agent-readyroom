import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {THEMES,getTheme,characterStyle} from '../src/themes/index.js';
import {createCharacter} from '../src/themes/character.js';
import {primitives} from '../src/office.js';
import {WORKSTATIONS,LEISURE} from '../src/room-layout.js';

const count=root=>{let n=0;root.traverse(()=>n++);return n;};
function dispose(root){root.traverse(o=>{o.geometry?.dispose();if(o.isLine)o.material.dispose();});}

test('theme packs expose complete palettes and all existing team roles',()=>{assert.equal(new Set(THEMES.map(t=>t.id)).size,THEMES.length);for(const theme of THEMES){for(const key of ['background','night','accent','control','ink','border'])assert.match(theme.ui[key],/^#[a-f0-9]{6}$/i);for(const role of ['boss','builder','solo','reviewer','researcher']){const look=characterStyle(theme,role);assert.ok(look.outfit);assert.ok(look.hair);assert.ok(look.shirt);}}assert.equal(getTheme('unknown').id,'cozy');assert.equal(getTheme('konoha').environment,'dojo');});

test('changing the character theme preserves its rig, world position and animation state',()=>{const actor=createCharacter(new THREE.Group(),'employee',0,2.8,primitives,getTheme('cozy'));const rig=[actor.root,actor.body,actor.head,...actor.arms,...actor.legs];actor.root.position.set(2.8,.02,-1.1);actor.root.rotation.y=.35;actor.targetRotation=.6;actor.mode='walking';actor.arms[1].rotation.x=-.7;actor.setTheme(getTheme('konoha'));assert.deepEqual([actor.root,actor.body,actor.head,...actor.arms,...actor.legs],rig);assert.deepEqual(actor.root.position.toArray(),[2.8,.02,-1.1]);assert.equal(actor.root.rotation.y,.35);assert.equal(actor.targetRotation,.6);assert.equal(actor.arms[1].rotation.x,-.7);assert.equal(actor.mode,'walking');assert.equal(actor.themeId(),'konoha');dispose(actor.root);});

test('warm/ninja/warm round trips reuse appearances instead of accumulating new meshes',()=>{const actor=createCharacter(new THREE.Group(),'boss',-5,-3.1,primitives,getTheme('cozy'));actor.setTheme(getTheme('konoha'));actor.setTheme(getTheme('cozy'));const warmed=count(actor.root);for(let i=0;i<10;i++){actor.setTheme(getTheme('konoha'));actor.setTheme(getTheme('cozy'));}assert.equal(count(actor.root),warmed);assert.equal(actor.themeId(),'cozy');dispose(actor.root);});

test('new members inherit the selected theme and role styling without moving seats',()=>{const home=WORKSTATIONS[2].home,actor=createCharacter(new THREE.Group(),'member-0',home.x,home.z,primitives,getTheme('konoha'));const before=actor.root.position.toArray();actor.setRole('reviewer');assert.equal(actor.themeId(),'konoha');assert.deepEqual(actor.root.position.toArray(),before);let tagged=0;actor.root.traverse(o=>{if(o.isMesh){assert.equal(o.userData.person,'member-0');tagged++;}});assert.ok(tagged>30);assert.equal(WORKSTATIONS.length,4);assert.ok(LEISURE.coffee);dispose(actor.root);});
