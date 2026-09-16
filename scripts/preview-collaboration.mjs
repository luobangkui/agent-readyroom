// Read-only UI fixture backed by the real scheduler. No model runtime is started.
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {MissionService} from '../server/missions.js';
import {TEAM} from '../src/team.js';
import {workFor,qualityIssues} from '../server/collaboration.js';

const root=fileURLToPath(new URL('..',import.meta.url)),directory=mkdtempSync(path.join(tmpdir(),'office-parallel-preview-')),cwd=path.join(directory,'project');mkdirSync(cwd);
class FixtureBridge extends EventEmitter {
  seq=0;
  async request(method,params){if(method==='thread/start')return {thread:{id:`fixture-thread-${++this.seq}`},model:params.model};if(method==='turn/start')return {turn:{id:`fixture-turn-${++this.seq}`}};return {};}
}
const service=new MissionService(new FixtureBridge(),{directory,defaultCwd:cwd}),tick=()=>new Promise(r=>setImmediate(r));
service.connection={connected:true,authenticated:true,models:TEAM.map(a=>({id:a.model,provider:a.provider,efforts:['high']})),message:'模拟夹具：不运行真实模型'};
const m=await service.create({prompt:'只读 UI 验证夹具：模拟三人独立工作和最终复核，不代表真实模型交付。'});await tick();
const boss=m.agents[0];
for(const [role,scope,task,acceptance] of [
  ['tech',{readPaths:['reference'],writePaths:[]},'核对接口契约与技术风险',['给出接口约束和风险']],
  ['builder',{readPaths:['src'],writePaths:['src']},'按接口实现业务模块并执行边界测试',['主路径与边界测试通过']],
  ['ops',{readPaths:['references'],writePaths:['docs']},'准备使用文档和用户验收清单',['文档步骤可复现']],
])await service.dynamic(m,boss,'office_delegate',{role,task,dependsOn:[],scope,acceptance});
await tick();const parallel=structuredClone(m);parallel.id='mission_aaaaaaaa';parallel.title='协作验证 · 三人并行（模拟）';
const activeWorkers=parallel.agents.filter(a=>a.role!=='boss'&&a.status==='running').length;if(activeWorkers!==3)throw Error('parallel fixture failed');
const complete=a=>service.notification({method:'turn/completed',params:{threadId:a.threadId,turn:{id:a.turnId,status:'completed',items:[{id:`fixture-result-${a.id}-${a.turnId}`,type:'agentMessage',phase:'final_answer',text:'模拟夹具结果，仅供 UI 验证'}]}}});
const report=a=>service.dynamic(m,a,'office_report',{summary:'模拟检查记录：由测试夹具提供，不代表真实业务产出',artifacts:[],checks:workFor(m,a).acceptance.map((name,criterion)=>({name,criterion,result:'passed',evidence:'夹具断言：工作单状态与范围、验收映射一致。'})),risks:[],verdict:'ready'});
for(const a of m.agents.filter(a=>a.role!=='boss')){await report(a);complete(a);}await tick();
const tech=m.agents.find(a=>a.role==='tech'),targets=m.agents.filter(a=>['builder','ops'].includes(a.role)).map(a=>a.workId);
await service.dynamic(m,boss,'office_continue',{agentId:tech.id,task:'独立复核实现和使用文档',scope:{readPaths:['src','docs'],writePaths:[]},acceptance:['实现符合验收要求','文档可复现'],reviewOf:targets});await tick();await report(tech);complete(tech);complete(boss);
if(m.status!=='completed'||qualityIssues(m).length)throw Error('quality fixture failed');m.title='协作验证 · 独立复核通过（模拟）';service.missions=[parallel,m];
const port=Number(process.env.OFFICE_QA_PORT||4318),clients=new Set(),dist=path.join(root,'dist');
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(req.method!=='GET'){res.writeHead(405);res.end('Read-only test fixture');return;}
  if(url.pathname==='/api/bootstrap'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token:'read-only-fixture',...service.snapshot()}));return;}
  if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(`event: snapshot\ndata: ${JSON.stringify(service.snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
  try{const file=path.resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(readFileSync(file));}
  catch{res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}`,simulated:true,activeWorkers,quality:m.quality.status,modelTurns:0,directory})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);for(const res of clients)res.end();server.close();});
