// Read-only browser fixtures use the real scheduler with a no-model executor.
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {MissionService} from '../server/missions.js';
import {TEAM} from '../src/team.js';
import {workFor} from '../server/collaboration.js';
const root=fileURLToPath(new URL('..',import.meta.url)),directory=mkdtempSync(path.join(tmpdir(),'office-harness-preview-')),cwd=path.join(directory,'project');mkdirSync(cwd);
class FixtureBridge extends EventEmitter{seq=0;async request(method,params){if(method==='thread/start')return {thread:{id:`fixture-${++this.seq}`},model:params.model};if(method==='turn/start')return {turn:{id:`fixture-turn-${++this.seq}`}};return {};}}
const service=new MissionService(new FixtureBridge(),{directory,defaultCwd:cwd}),tick=()=>new Promise(r=>setImmediate(r));
service.connection={connected:true,authenticated:true,models:TEAM.map(a=>({id:a.model,provider:a.provider,efforts:['high']})),message:'模拟夹具：真实调度器，不运行模型'};
writeFileSync(path.join(cwd,'contract.json'),JSON.stringify({endpoint:'/search',input:{q:'string'},output:{items:[]},errors:[{status:400,message:'missing q'}]},null,2));
const m=await service.create({prompt:'模拟测试：搜索接口发布后，前端和验收准备直接开工，不等后端全部完成。没有执行真实模型。'});await tick();const boss=m.agents[0];
const task=(key,role,extra={})=>({key,task:key,eligibleRoles:[role],scope:{readPaths:[],writePaths:[]},acceptance:['按固定输入完成可复现检查'],...extra});
await service.dynamic(m,boss,'office_submit_graph',{requestId:'fixture-search',tasks:[
  task('api','tech',{task:'先发布搜索接口契约，再继续后端关键实现',scope:{readPaths:['contract.json'],writePaths:['server']},produces:[{name:'search-api',version:'v1'}],priority:10}),
  task('contract-check','ops',{task:'检查输入、输出、错误和示例，独立验证接口快照',requires:[{name:'search-api',version:'v1',status:'published'}],priority:9}),
  task('frontend','builder',{task:'使用固定搜索接口和模拟数据实现前端，不等后端结束',requires:[{name:'search-api',version:'v1'}],scope:{readPaths:[],writePaths:['web']},resources:[{name:'build:web',capacity:1}]}),
  task('test-prep','ops',{task:'按接口准备验收场景和隔离测试数据',requires:[{name:'search-api',version:'v1'}],scope:{readPaths:[],writePaths:['test-data']}}),
  task('integration','builder',{task:'集成已验证的前端、接口实现和测试场景',dependsOn:['api','frontend','test-prep'],scope:{readPaths:['web','server','test-data'],writePaths:['integration']},resources:[{name:'port:4320'}]}),
]});await tick();
const complete=a=>service.notification({method:'turn/completed',params:{threadId:a.threadId,turn:{id:a.turnId,status:'completed',items:[]}}});complete(boss);await tick();
const waiting=structuredClone(m);waiting.id='mission_bbbbbbbb';waiting.title='输入等待不占人物（模拟）';assert.equal(waiting.workItems.filter(w=>w.agentId).length,1);
const checks=[{name:'契约字段检查',result:'passed',evidence:'夹具确认 input/output/errors/example 字段；仅验证调度和 UI，不代表真实业务验收'}];
const tech=m.agents.find(a=>a.role==='tech'),published=await service.dynamic(m,tech,'office_publish',{name:'search-api',version:'v1',files:['contract.json'],summary:'固定搜索契约：输入 q，输出 items，400 错误示例',checks});await tick();
const ops=m.agents.find(a=>a.role==='ops');assert.equal(ops.status,'running');await service.dynamic(m,ops,'office_validate',{name:'search-api',version:'v1',digest:published.digest,checks});
await service.dynamic(m,ops,'office_report',{summary:'契约检查通过（模拟证据）',artifacts:[],checks:[{...checks[0],criterion:0}],risks:[],verdict:'ready'});complete(ops);await tick();
assert.equal(m.agents.filter(a=>a.role!=='boss'&&a.status==='running').length,3);assert.equal(m.workItems.find(w=>w.key==='integration').agentId,null);m.title='契约验证后即刻并行（模拟）';
service.missions=[m,waiting];clearInterval(service.harnessTimer);
const port=Number(process.env.OFFICE_QA_PORT||4318),dist=path.join(root,'dist'),clients=new Set();
const server=http.createServer((req,res)=>{const url=new URL(req.url,`http://127.0.0.1:${port}`);if(req.method!=='GET'){res.writeHead(405);res.end('Read-only fixture');return;}
  if(url.pathname==='/api/bootstrap'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token:'read-only-fixture',...service.snapshot()}));return;}
  if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(`event: snapshot\ndata: ${JSON.stringify(service.snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
  try{const file=path.resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(dist+path.sep))throw Error('outside');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}`,directory,modelTurns:0,simulated:true,parallel:3,waitingDoesNotClaim:true})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);for(const res of clients)res.end();server.close();});
