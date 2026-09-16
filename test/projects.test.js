import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,symlinkSync,readFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProjectStore} from '../server/projects.js';
import {MissionService} from '../server/missions.js';
import {TEAM} from '../src/team.js';
import {instructions} from '../server/prompts.js';
import {projectSidebar,entryMenuItems} from '../src/project-sidebar.js';

class Bridge extends EventEmitter {
  constructor(){super();this.calls=[];this.seq=0;}
  async request(method,params){this.calls.push({method,params});if(method==='thread/start')return {thread:{id:`t-${++this.seq}`},model:params.model};if(method==='turn/start')return {turn:{id:`r-${++this.seq}`}};return {};}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'office-projects-test-'))),directory=path.join(root,'store'),cwd=path.join(root,'work'),other=path.join(root,'other');
  for(const dir of [directory,cwd,other])mkdirSync(dir);
  const bridge=new Bridge(),service=new MissionService(bridge,{directory,defaultCwd:cwd});
  service.connection={connected:true,authenticated:true,models:TEAM.map(p=>({id:p.model,efforts:['high']}))};
  t.after(()=>{clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);rmSync(root,{recursive:true,force:true});});
  return {root,directory,cwd,other,bridge,service};
}
function completed(service,m,text){const a=m.agents.find(x=>x.id===m.coordinatorId)||m.agents[0];service.notification({method:'turn/completed',params:{threadId:a.threadId,turn:{id:a.turnId,status:'completed',items:[{id:'reply',type:'agentMessage',phase:'final_answer',text}]}}});}

test('projects deduplicate canonical directories, survive reload, and never invoke models',async t=>{
  const {service,bridge,cwd,root,directory}=fixture(t);service.connection.connected=false;
  const p=await service.createProject({cwd,name:'我的项目'});symlinkSync(cwd,path.join(root,'alias'));
  const same=await service.createProject({cwd:path.join(root,'alias'),name:'另一个名称'});
  assert.equal(same.id,p.id);assert.equal(same.name,'我的项目');assert.equal(service.snapshot().projects.length,1);assert.equal(bridge.calls.length,0);
  assert.deepEqual(new ProjectStore(directory).projects,[p]);
  await assert.rejects(service.createProject({cwd:'relative'}),/绝对路径/);
  await assert.rejects(service.createProject({cwd:path.join(root,'missing')}),/目录不存在/);
  writeFileSync(path.join(root,'file'),'text');await assert.rejects(service.createProject({cwd:path.join(root,'file')}),/目录不存在/);
  await assert.rejects(service.createProject({cwd,name:' '}),/名称/);
});

test('goals inherit their project directory and reject mismatched or missing projects',async t=>{
  const {service,cwd,other,bridge}=fixture(t),p=await service.createProject({cwd});
  const goal=await service.create({projectId:p.id,kind:'goal',prompt:'检查项目',effort:'high'});await tick();
  assert.equal(goal.projectId,p.id);assert.equal(goal.cwd,cwd);assert.equal(goal.agents.length,4);
  assert.equal(bridge.calls.find(c=>c.method==='thread/start').params.cwd,cwd);
  await assert.rejects(service.create({projectId:p.id,cwd:other,prompt:'wrong'}),/所属项目一致/);
  await assert.rejects(service.create({projectId:'missing',kind:'chat'}),/项目不存在/);
  await assert.rejects(service.create({projectId:p.id,kind:'unknown'}),/会话类型/);
});

test('empty project chats remain idle across restart and start a single resumable conversation on first message',async t=>{
  const {service,bridge,cwd,directory}=fixture(t),p=await service.createProject({cwd});
  service.connection.connected=false;
  const chat=await service.create({projectId:p.id,kind:'chat'});
  assert.equal(chat.status,'idle');assert.equal(chat.agents.length,4);assert.equal(chat.messages.length,0);assert.equal(bridge.calls.length,0);
  service.save();const restarted=new MissionService(new Bridge(),{directory,defaultCwd:cwd});
  t.after(()=>{clearTimeout(restarted.saveTimer);clearTimeout(restarted.broadcastTimer);});
  assert.equal(restarted.get(chat.id).status,'idle');assert.equal(restarted.get(chat.id).agents.length,4);
  service.connection.connected=true;
  await service.sendMessage(chat.id,{text:'这个项目怎么启动？'});await tick();
  assert.equal(chat.title,'这个项目怎么启动');assert.equal(chat.messages[0].text,'这个项目怎么启动？');
  const first=bridge.calls.find(c=>c.method==='thread/start');assert.equal(first.params.cwd,cwd);assert.match(first.params.developerInstructions,/一对一项目对话/);
  assert.ok(!first.params.dynamicTools.some(tool=>tool.name==='office_delegate'));
  completed(service,chat,'运行 npm run dev');await tick();
  await service.sendMessage(chat.id,{text:'继续说明测试命令'});await tick();
  assert.equal(bridge.calls.filter(c=>c.method==='thread/start').length,1);
  assert.equal(bridge.calls.filter(c=>c.method==='turn/start').length,2);
  assert.equal(chat.projectId,p.id);assert.equal(chat.agents.length,4);
  assert.match(instructions(chat,chat.agents[0]),/这个项目怎么启动/);
});

test('historical goals migrate by directory without losing conversations or creating duplicate projects',async t=>{
  const {service,cwd,other,directory}=fixture(t);
  const a=await service.create({prompt:'旧目标一',cwd}),b=await service.create({prompt:'旧目标二',cwd}),c=await service.create({prompt:'另一个目录',cwd:other});
  const before=service.missions.map(m=>({id:m.id,cwd:m.cwd,messages:structuredClone(m.messages),agents:m.agents.map(a=>a.id)}));
  for(const m of service.missions){delete m.kind;delete m.projectId;}
  service.save();const restored=new MissionService(new Bridge(),{directory,defaultCwd:cwd});
  t.after(()=>{clearTimeout(restored.saveTimer);clearTimeout(restored.broadcastTimer);});
  assert.equal(restored.snapshot().projects.length,2);assert.equal(restored.get(a.id).projectId,restored.get(b.id).projectId);assert.notEqual(restored.get(a.id).projectId,restored.get(c.id).projectId);
  assert.deepEqual(restored.missions.map(m=>({id:m.id,cwd:m.cwd,messages:m.messages,agents:m.agents.map(a=>a.id)})),before);
  assert.ok(JSON.parse(readFileSync(path.join(directory,'missions.json'),'utf8')).every(m=>m.projectId&&m.kind==='goal'));
});

test('sidebar separates projects and goal/chat entries, escapes names, and retains empty projects',()=>{
  const html=projectSidebar([{id:'p1',name:'<script>',cwd:'/work/a'},{id:'p2',name:'空项目',cwd:'/work/b'}],[{id:'m1',projectId:'p1',kind:'chat',title:'讨论',status:'completed'},{id:'m2',projectId:'p1',kind:'goal',title:'实现',status:'running'}],{selectedProjectId:'p1',selectedId:'m1',collapsed:new Set(['p2']),statusNames:{running:'执行中'}});
  assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/对话 · 待续聊/);assert.match(html,/目标 · 执行中/);assert.match(html,/还没有目标或对话/);assert.match(html,/id="children-p2" hidden/);assert.equal((html.match(/data-mission=/g)||[]).length,2);
});

test('goal and chat creation persist their own four-role cast across restart and continuation',async t=>{
  const {service,cwd,directory,bridge}=fixture(t),p=await service.createProject({cwd});
  assert.equal(service.snapshot().capabilities.creationAvatars,true);
  const cast={boss:'hiruzen-custom',tech:'tsunade-custom',builder:'naruto-custom',ops:'sakura-custom'};
  const goal=await service.create({projectId:p.id,prompt:'验证角色外观',roleAvatars:cast});await tick();
  assert.deepEqual(goal.roleAvatars,cast);assert.deepEqual(goal.agents.map(a=>a.avatarId),Object.values(cast));
  assert.deepEqual(goal.agents.map(a=>[a.role,a.model]),TEAM.map(a=>[a.role,a.model]));
  const before=bridge.calls.length,chat=await service.create({projectId:p.id,kind:'chat',roleAvatars:{...cast,boss:'merchant'}});
  assert.equal(bridge.calls.length,before);assert.equal(chat.agents.length,4);assert.equal(chat.agents.find(a=>a.role==='tech').avatarId,'tsunade-custom');assert.equal(chat.roleAvatars.boss,'merchant');assert.equal(goal.roleAvatars.boss,'hiruzen-custom');
  service.save();const nextBridge=new Bridge(),restored=new MissionService(nextBridge,{directory,defaultCwd:cwd});restored.connection=service.connection;
  t.after(()=>{clearTimeout(restored.saveTimer);clearTimeout(restored.broadcastTimer);});
  assert.deepEqual(restored.snapshot().missions.find(m=>m.id===goal.id).roleAvatars,cast);assert.deepEqual(restored.get(chat.id).roleAvatars,chat.roleAvatars);
  await restored.sendMessage(chat.id,{text:'开始对话'});await tick();assert.equal(nextBridge.calls.filter(c=>c.method==='thread/start').length,1);
  assert.equal(restored.get(chat.id).agents.length,4);assert.equal(restored.get(chat.id).agents.find(a=>a.role==='tech').avatarId,'tsunade-custom');assert.deepEqual(restored.get(goal.id).roleAvatars,cast);
});

test('invalid casts are rejected before creating projects, missions, or model sessions',async t=>{
  const {service,bridge,cwd}=fixture(t);
  for(const kind of ['goal','chat'])for(const roleAvatars of [{boss:'not-a-model'},{other:'student'},[],null])await assert.rejects(service.create({kind,prompt:'不会执行',cwd,roleAvatars}),error=>error.status===400);
  assert.equal(service.missions.length,0);assert.equal(service.projects.projects.length,0);assert.equal(bridge.calls.length,0);
});

test('archive and restore retain goal/chat history across reload without invoking models',async t=>{
  const {service,bridge,cwd,directory}=fixture(t);
  const chat=await service.create({kind:'chat'}),goal=await service.create({prompt:'历史目标'});await tick();
  for(const m of [chat,goal]){
    m.status='completed';for(const a of m.agents){a.status='completed';a.turnId=null;}
    const history=structuredClone(m.messages),agents=structuredClone(m.agents),calls=bridge.calls.length;
    service.setArchived(m.id,true);const timestamp=m.archivedAt;
    assert.ok(timestamp);assert.equal(service.setArchived(m.id,true).archivedAt,timestamp);
    assert.deepEqual(m.messages,history);assert.deepEqual(m.agents,agents);assert.equal(bridge.calls.length,calls);
    await assert.rejects(service.sendMessage(m.id,{text:'不能启动'}),error=>error.status===409);
  }
  const restored=new MissionService(new Bridge(),{directory,defaultCwd:cwd});
  t.after(()=>{clearTimeout(restored.saveTimer);clearTimeout(restored.broadcastTimer);clearInterval(restored.harnessTimer);});
  assert.ok(restored.get(chat.id).archivedAt);assert.deepEqual(restored.get(goal.id).messages,goal.messages);
  restored.setArchived(chat.id,false);assert.equal(restored.get(chat.id).archivedAt,null);
  assert.equal(JSON.parse(readFileSync(restored.file)).find(m=>m.id===chat.id).archivedAt,null);
  restored.connection=service.connection;await restored.sendMessage(chat.id,{text:'恢复后继续'});await tick();
  assert.ok(restored.bridge.calls.some(c=>c.method==='turn/start'));
});

test('archive rejects active turns, queued members, pending requests, and rolls back failed saves',async t=>{
  const {service}=fixture(t),chat=await service.create({kind:'chat'}),a=chat.agents[0];
  for(const status of ['running','queued','starting','waiting','stopping']){chat.status=status;assert.throws(()=>service.setArchived(chat.id,true),error=>error.status===409);}
  chat.status='completed';a.status='queued';assert.throws(()=>service.setArchived(chat.id,true),/先停止/);
  a.status='completed';a.turnId='active';assert.throws(()=>service.setArchived(chat.id,true),/先停止/);a.turnId=null;
  chat.requests=[{status:'pending'}];assert.throws(()=>service.setArchived(chat.id,true),/先停止/);chat.requests=[];
  service.save=()=>false;assert.throws(()=>service.setArchived(chat.id,true),error=>error.status===500);assert.equal(chat.archivedAt,undefined);
});

test('archiving releases capacity while restoring enforces the active entry limit',async t=>{
  const {service}=fixture(t);
  for(let i=0;i<100;i++)await service.create({kind:'chat'});
  await assert.rejects(service.create({kind:'chat'}),error=>error.status===409);
  const archived=service.missions[0];service.setArchived(archived.id,true);
  const fresh=await service.create({kind:'chat'});assert.equal(service.missions.length,101);
  assert.throws(()=>service.setArchived(archived.id,false),error=>error.status===409);
  service.setArchived(fresh.id,true);service.setArchived(archived.id,false);assert.equal(archived.archivedAt,null);
});

test('sidebar filters archives and exposes per-row menus for rename and archive/restore',()=>{
  const projects=[{id:'p',name:'项目',cwd:'/work'}],missions=[{id:'a',projectId:'p',kind:'goal',status:'completed',title:'<旧目标>',archivedAt:'2026-09-14'},{id:'b',projectId:'p',kind:'chat',status:'idle',title:'新对话'},{id:'c',projectId:'p',status:'running',title:'执行中'}],options={collapsed:new Set(),statusNames:{}};
  const current=projectSidebar(projects,missions,options),archived=projectSidebar(projects,missions,{...options,view:'archived'});
  assert.ok(!current.includes('data-mission="a"'));assert.match(current,/data-entry-menu="p"/);assert.match(current,/data-entry-menu="b"/);assert.match(current,/data-entry-menu="c"/);
  assert.ok(!current.includes('data-archive='));assert.match(archived,/data-mission="a"/);assert.match(archived,/data-entry-menu="a"/);assert.ok(!archived.includes('data-mission="b"'));assert.match(archived,/已归档/);
  // 菜单内容由 entryMenuItems 提供：运行中的会话不能归档，但一直可以重命名。
  assert.deepEqual(entryMenuItems({id:'c',status:'running'}).map(i=>i.action),['rename-mission','archive']);
  assert.equal(entryMenuItems({id:'c',status:'running'})[1].disabled,true);
  assert.equal(entryMenuItems({id:'b',status:'idle'})[1].disabled,false);
  assert.deepEqual(entryMenuItems({id:'a',status:'completed',archivedAt:'x'},{archived:true}).map(i=>i.action),['rename-mission','restore']);
  assert.deepEqual(entryMenuItems({id:'project_1',entries:[1,2]}).map(i=>i.action),['rename-project','hide-project']);
  assert.deepEqual(entryMenuItems({id:'project_1',hiddenAt:'x',entries:[1]},{hidden:true}).map(i=>i.action),['restore-project']);
});

test('hidden projects leave the list with their entries but stay recoverable',async t=>{
  const {service,directory,cwd}=fixture(t),p=await service.createProject({cwd,name:'待命室'}),chat=await service.create({projectId:p.id,kind:'chat'}),other=await service.createProject({cwd:path.join(cwd,'..','other'),name:'别的'});
  await service.setProjectHidden(p.id,true);
  const hidden=projectSidebar(service.snapshot().projects,service.snapshot().missions,{view:'current',collapsed:new Set(),statusNames:{}});
  assert.ok(!hidden.includes('待命室'));assert.ok(hidden.includes('别的'));
  const listing=projectSidebar(service.snapshot().projects,service.snapshot().missions,{view:'hidden',collapsed:new Set(),statusNames:{}});
  assert.match(listing,/待命室/);assert.match(listing,new RegExp(`data-entry-menu="${p.id}"`));assert.ok(!listing.includes('别的'));
  // 隐藏不删数据：目录、对话与消息都还在磁盘上，放回后照旧。
  assert.equal(service.get(chat.id).messages.length,0);assert.equal(realpathSync(cwd),cwd);
  await service.setProjectHidden(p.id,false);
  assert.equal(service.projects.get(p.id).hiddenAt,null);assert.equal(new ProjectStore(directory).get(p.id).hiddenAt,null);
  const back=projectSidebar(service.snapshot().projects,service.snapshot().missions,{view:'current',collapsed:new Set(),statusNames:{}});
  assert.match(back,/待命室/);assert.match(back,/data-mission=/);assert.notEqual(other.id,p.id);
});

test('renaming a project or a mission changes only the label and survives reload',async t=>{
  const {service,directory,cwd}=fixture(t),p=await service.createProject({cwd,name:'旧名字'}),goal=await service.create({projectId:p.id,prompt:'检查项目'});
  await service.renameProject(p.id,'新名字');
  assert.equal(service.projects.get(p.id).name,'新名字');
  await service.renameProject(p.id,'  ');assert.equal(service.projects.get(p.id).name,path.basename(cwd));
  await service.renameProject(p.id,'保留名');
  await assert.rejects(service.renameProject(p.id,'x'.repeat(101)),error=>error.status===400);
  const renamed=service.rename(goal.id,'我的第一次目标');
  assert.equal(renamed.title,'我的第一次目标');assert.equal(renamed.prompt,'检查项目');assert.equal(renamed.customTitle,true);
  assert.throws(()=>service.rename(goal.id,'   '),error=>error.status===400);
  service.save();
  const restarted=new MissionService(new Bridge(),{directory,defaultCwd:cwd});
  t.after(()=>{clearTimeout(restarted.saveTimer);clearTimeout(restarted.broadcastTimer);});
  assert.equal(restarted.get(goal.id).title,'我的第一次目标');assert.equal(restarted.projects.get(p.id).name,'保留名');
});

test('a manual mission name is not overwritten by the first chat message',async t=>{
  const {service,cwd}=fixture(t),p=await service.createProject({cwd}),chat=await service.create({projectId:p.id,kind:'chat'});
  service.rename(chat.id,'季度复盘');
  service.connection.connected=true;
  await service.sendMessage(chat.id,{text:'帮我看看这个项目的启动流程'});await tick();
  assert.equal(chat.title,'季度复盘');assert.equal(chat.prompt,'帮我看看这个项目的启动流程');
  const auto=await service.create({projectId:p.id,kind:'chat'});
  await service.sendMessage(auto.id,{text:'自动命名的对话'});await tick();
  assert.equal(auto.title,'自动命名的对话');
});
