import test from 'node:test';
import assert from 'node:assert/strict';
import {artifactKey,assertAcyclic,criticalPath,dependencyIds,producerIndex,topoLayers} from '../src/work-graph.js';
import {collaborationGraph} from '../src/work-graph-view.js';

const work=(id,key,extra={})=>({id,key,protocol:2,task:`任务 ${key}`,status:'waiting_input',scope:{readPaths:[],writePaths:[]},acceptance:['通过'],dependsOn:[],requires:[],produces:[],reviewOf:[],resources:[],priority:0,...extra});
const mission=(workItems,artifactVersions=[])=>({workItems,artifactVersions});

const chain=()=>mission([
  work('w1','contract',{produces:[{name:'api',version:'v1'}]}),
  work('w2','client',{requires:[{name:'api',version:'v1'}]}),
  work('w3','tests',{requires:[{name:'api',version:'v1'}]}),
  work('w4','release',{dependsOn:['w2','w3']}),
  work('w5','docs')
]);

test('artifact inputs become dependency edges next to explicit dependsOn',()=>{
  const m=chain(),producers=producerIndex(m);
  assert.equal(producers.get('api:v1'),'w1');
  assert.deepEqual(dependencyIds(m,m.workItems[1],producers),['w1']);
  assert.deepEqual(dependencyIds(m,m.workItems[3],producers),['w2','w3']);
  assert.equal(artifactKey({name:'api',version:'v1'}),'api:v1');
});

test('the graph is layered topologically and the critical path is the longest chain',()=>{
  const {layers,cycles}=topoLayers(chain());
  assert.deepEqual(cycles,[]);
  assert.deepEqual(layers[0].sort(),['w1','w5']);
  assert.deepEqual(layers[1].sort(),['w2','w3']);
  assert.deepEqual(layers[2],['w4']);
  const {depth,critical,chain:path}=criticalPath(chain());
  assert.equal(depth.get('w1'),2,'w1 → w2/w3 → w4');
  assert.equal(depth.get('w5'),0);
  assert.ok(critical.has('w1')&&critical.has('w4'));
  assert.equal(path[0],'w1');
  assert.equal(new Set([...critical]).size,3);
});

test('replaced producers stop owning their versions and cycles are detected with their chain',()=>{
  const replacement=work('w9','contract-v2',{replaces:'w1',produces:[{name:'api',version:'v2'}]});
  const m=mission([work('w1','contract',{produces:[{name:'api',version:'v1'}]}),replacement]);
  assert.equal(producerIndex(m).has('api:v1'),false,'被替代的工作单不再生产旧版本');
  assert.equal(producerIndex(m).get('api:v2'),'w9');
  const cyclic=mission([work('a','a',{dependsOn:['b']}),work('b','b',{dependsOn:['a']})]);
  assert.throws(()=>assertAcyclic(cyclic.workItems,{all:cyclic.workItems,resolve:w=>w.dependsOn}),/循环依赖（包括阶段成果）：a → b → a|循环依赖（包括阶段成果）：b → a → b/);
  const {cycles}=topoLayers(cyclic);
  assert.deepEqual(cycles.sort(),['a','b']);
  assert.doesNotThrow(()=>assertAcyclic(chain().workItems,{all:chain().workItems,resolve:w=>dependencyIds(chain(),w)}));
});

test('the work-plan DAG view renders batches, edges, badges and escapes model text',()=>{
  const m=chain();
  m.workItems[0].status='completed';
  m.workItems[1].status='running';
  m.workItems[1].agentId='agent-1';
  m.workItems[0].children=['w2'];
  m.workItems[2].reviewOf=['w1'];
  m.workItems[3].callback=true;
  m.workItems[4].priority=9;
  m.workItems[1].task='<img src=x onerror=alert(1)>';
  const svg=collaborationGraph(m,id=>id==='agent-1'?'夏禾':'未知');
  assert.match(svg,/class="dag"/);
  assert.match(svg,/第 1 批 · 2 项可并行/);
  assert.match(svg,/关键路径/);
  assert.match(svg,/独立复核/);
  assert.match(svg,/回调/);
  assert.match(svg,/P9/);
  assert.match(svg,/夏禾/);
  assert.ok(!svg.includes('<img'),'任务文本必须被转义');
  assert.match(svg,/&lt;img/);
  assert.equal((svg.match(/<g class="dag-node /g)||[]).length,5);
  assert.match(svg,/class="dag-edge/);
});

test('replaced and legacy work items stay out of the drawn graph without breaking the layout',()=>{
  const m=chain();
  // A repaired work item: the old one is superseded, and a legacy (protocol 1)
  // item from an office_delegate assignment still lives in the same list.
  m.workItems.push(work('w6','release-old',{replacedBy:'w4'}));
  m.workItems.push({id:'w7',key:'legacy-delegate',task:'旧式分工',status:'completed',scope:{readPaths:[],writePaths:[]},acceptance:['x'],dependsOn:[],reviewOf:[]});
  const svg=collaborationGraph(m);
  assert.equal((svg.match(/<g class="dag-node /g)||[]).length,5,'被替代与旧式工作单不画进图');
  assert.ok(!svg.includes('release-old'));
  assert.equal((svg.match(/<text class="dag-batch"/g)||[]).length,3,'空批次不会留下占位列');
  assert.match(svg,/关键路径 3 层/);
});

test('the view reports hand-edited cyclic data instead of drawing a wrong order',()=>{
  const cyclic=mission([work('a','a',{dependsOn:['b']}),work('b','b',{dependsOn:['a']})]);
  const svg=collaborationGraph(cyclic);
  assert.match(svg,/检测到 2 项无法排入批次/);
  assert.match(svg,/未排入批次（存在环）/);
  assert.equal((svg.match(/<g class="dag-node /g)||[]).length,2,'环上的节点仍要画出来');
  assert.equal(collaborationGraph(mission([])),'');
});
