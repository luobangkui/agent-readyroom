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

test('a long chain draws as rows instead of a sprawling strip, and long wait text never spills',()=>{
  // 7 batches with at most two items each: the shape that looked broken before.
  const works=Array.from({length:7},(_,i)=>work(`w${i}`,`batch-${i}`,{dependsOn:i?[`w${i-1}`]:[]}));
  works[0].status='ready';
  works[0].waitReason={kind:'scope',message:'等待 鸣人 的工作单 deploy-a 释放重叠路径 · 重叠路径：.scratch/delivery-e2e-20260916；同一个目录无法判断内部是否真的冲突——需要并行就声明到文件级，需要排队就用 resources 表达容量'};
  works[3].status='running';works[3].agentId='agent-1';
  const svg=collaborationGraph(mission(works),id=>id==='agent-1'?'夏禾':'');
  const [,width,height]=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
  assert.ok(height>width,`批次按行排列，画布应纵向生长：${width}x${height}`);
  assert.match(svg,/<tspan class="dag-chip wait">等范围<\/tspan>/,'等待原因在节点里只占一个短标签');
  const inline=[...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match=>match[1]).join('');
  assert.ok(!inline.includes('释放重叠路径'),'长等待原因不画进节点');
  assert.ok(svg.includes('释放重叠路径'),'完整原因保留在悬停标题里');
  assert.equal((svg.match(/NaN/g)||[]).length,0);
  for(const [,x,y] of svg.matchAll(/transform="translate\(([\d.]+),([\d.]+)\)"/g))assert.ok(Number(x)>=0&&Number(x)<width&&Number(y)>=0&&Number(y)<height,`节点越出画布：${x},${y}`);
  for(const [,text] of svg.matchAll(/<text class="dag-key"[^>]*>([^<]*)<\/text>/g))assert.ok(text.length<=13,`节点标题每行不超过 13 字：${text}`);
  assert.equal((svg.match(/<g class="dag-node /g)||[]).length,7);
});

test('the view reports hand-edited cyclic data instead of drawing a wrong order',()=>{
  const cyclic=mission([work('a','a',{dependsOn:['b']}),work('b','b',{dependsOn:['a']})]);
  const svg=collaborationGraph(cyclic);
  assert.match(svg,/检测到 2 项无法排入批次/);
  assert.match(svg,/未排入批次（存在环）/);
  assert.equal((svg.match(/<g class="dag-node /g)||[]).length,2,'环上的节点仍要画出来');
  assert.equal(collaborationGraph(mission([])),'');
});

test('long keys wrap onto a second line instead of hiding their tail',()=>{
  const long=work('w1','delivery-e2e-regression-suite');
  const svg=collaborationGraph(mission([long]));
  const lines=[...svg.matchAll(/<text class="dag-key"[^>]*>([^<]*)<\/text>/g)].map(match=>match[1]);
  assert.equal(lines.length,2,'长 key 折成两行');
  assert.equal(lines[0],'delivery-e2e','在分隔符处断开，而不是硬截断');
  assert.match(lines[1],/^regression/);
  assert.ok(svg.includes('delivery-e2e-regression-suite'),'完整 key 保留在悬停标题');
  const single=[...collaborationGraph(mission([work('w2','auth-review')])).matchAll(/<text class="dag-key"[^>]*>([^<]*)<\/text>/g)].map(match=>match[1]);
  assert.deepEqual(single,['auth-review'],'短 key 不折行');
});

test('clicking a node opens a detail card with everything the box cannot fit',()=>{
  const detail=work('w9','deploy-a',{status:'ready',agentId:'agent-1',task:'把 e2e 交付跑到通过，并给出可复现证据',waitReason:{kind:'scope',message:'等待 鸣人 的工作单 auth-change 释放重叠路径 · 重叠路径：.scratch/delivery-e2e-20260916'},acceptance:['端到端可复现'],scope:{readPaths:['docs'],writePaths:['.scratch/delivery-e2e-20260916']}});
  const closed=collaborationGraph(mission([detail]),id=>id==='agent-1'?'鸣人':'');
  assert.ok(!closed.includes('data-dag-detail'),'未选中时不显示详情卡');
  const open=collaborationGraph(mission([detail]),id=>id==='agent-1'?'鸣人':'',{selectedId:'w9'});
  assert.match(open,/data-dag-detail/);
  for(const text of ['把 e2e 交付跑到通过，并给出可复现证据','等待 鸣人 的工作单 auth-change 释放重叠路径','.scratch/delivery-e2e-20260916','端到端可复现','鸣人'])assert.ok(open.includes(text),`详情卡应显示：${text}`);
  assert.match(open,/dag-node ready selected/,'选中的节点有选中态');
  assert.match(open,/data-dag-close/,'详情卡可关闭');
});

test('the graph offers a maximize toggle that survives re-render',()=>{
  const m=chain();
  const normal=collaborationGraph(m);
  assert.match(normal,/data-dag-expand/);
  assert.match(normal,/⛶ 最大化任务图/);
  assert.ok(!normal.includes('collaboration-dag maximized'));
  const big=collaborationGraph(m,id=>id,{maximized:true});
  assert.match(big,/collaboration-dag maximized/);
  assert.match(big,/↙ 还原任务图/);
  assert.match(big,/aria-pressed="true"/);
});

test('every node is keyboard reachable and carries its full aria label',()=>{
  const m=mission([work('w1','api-contract',{status:'running',task:'先发布接口契约'})]);
  const svg=collaborationGraph(m);
  assert.match(svg,/data-dag-node="w1"/);
  assert.match(svg,/tabindex="0"/);
  assert.match(svg,/role="button"/);
  assert.match(svg,/aria-label="api-contract[^"]*先发布接口契约|aria-label="api-contract[^"]*"/);
});
