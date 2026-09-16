import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createEnvironment} from '../src/themes/environment.js';
import {getTheme,supportsAvatarSelection} from '../src/themes/index.js';
import {primitives} from '../src/office.js';
import {WORKSTATIONS,LEISURE} from '../src/room-layout.js';
import {findRoute} from '../src/scene-director.js';

const scene=new T.Scene(),environment=createEnvironment('courtyard',scene,primitives);
test('courtyard creates bounded real geometry and retains the Naruto avatar contract',()=>{
  const theme=getTheme('konoha-courtyard');assert.equal(theme.environment,'courtyard');assert.equal(supportsAvatarSelection(theme),true);
  assert.equal(theme.chairScale,getTheme('konoha').chairScale);assert.equal(theme.footrestHeight,getTheme('konoha').footrestHeight);
  assert.ok(environment.root.userData.semanticZones.includes('courtyard-garden'));assert.ok(environment.root.userData.semanticZones.includes('courtyard-ramen-tea'));
  let meshes=0,triangles=0;
  environment.root.traverse(o=>{if(!o.isMesh)return;meshes++;const p=o.geometry.attributes.position;triangles+=(o.geometry.index?.count||p.count)/3;for(const v of p.array)assert.ok(Number.isFinite(v),'invalid merged geometry');o.geometry.computeBoundingBox();assert.ok(o.geometry.boundingBox.getSize(new T.Vector3()).length()<30);});
  assert.ok(meshes<160,`unbatched environment: ${meshes} draws`);assert.ok(triangles<350000,`environment too dense: ${triangles}`);
});

test('all four seats keep physical routes to every leisure destination through the new furniture',()=>{
  scene.updateMatrixWorld(true);const ray=new T.Raycaster();
  for(const station of WORKSTATIONS)for(const [name,goal] of Object.entries(LEISURE)){
    const route=findRoute(station.home,goal);assert.ok(route.length,`${station.id} cannot reach ${name}`);let from=station.home;
    for(const to of route){
      const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.15));
      for(let i=0;i<=steps;i++){
        const x=T.MathUtils.lerp(from.x,to.x,i/steps),z=T.MathUtils.lerp(from.z,to.z,i/steps);
        ray.set(new T.Vector3(x,1.8,z),new T.Vector3(0,-1,0));
        const hit=ray.intersectObject(environment.root,true).find(h=>h.point.y>.20&&h.point.y<1.6);
        assert.equal(hit,undefined,`${station.id} → ${name}: ${hit?.object.name} blocks (${x}, ${z})`);
      }
      from=to;
    }
  }
});

test('day/night changes lights without rebuilding objects or adding distant mountains',()=>{
  const all=[];environment.root.traverse(o=>all.push(o));const lamps=all.filter(o=>o.isPointLight);
  environment.update(0,false);const daytime=lamps.map(l=>l.intensity);
  environment.update(0,true);assert.ok(lamps.every((l,i)=>l.intensity>daytime[i]));assert.equal(environment.root.getObjectByName('courtyard-distant-village'),undefined);
  for(let i=0;i<20;i++)environment.update(i,i%2===0);
  const after=[];environment.root.traverse(o=>after.push(o));assert.deepEqual(after,all);
  environment.update(20,false);assert.deepEqual(lamps.map(l=>l.intensity),daytime);
});
