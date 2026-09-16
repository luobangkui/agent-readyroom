import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {CodexBridge} from './codex.js';
import {ZcodeBridge} from './zcode.js';
import {DshBridge} from './dsh.js';
import {OfficeRuntimes} from './runtimes.js';
import {MissionService} from './missions.js';
import {pickDirectory} from './directory-picker.js';
import {readDocument} from './documents.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port=Number(process.env.OFFICE_PORT||4317),host='127.0.0.1';
const token=randomBytes(32).toString('hex');
const dataDir=process.env.OFFICE_DATA_DIR||path.join(root,'.office-data');
const bridge=new OfficeRuntimes({codex:new CodexBridge({cwd:root}),zcode:new ZcodeBridge({cwd:root}),dsh:new DshBridge({cwd:root})});
const service=new MissionService(bridge,{directory:dataDir,defaultCwd:path.join(root,'workspace'),memberToolURL:`http://${host}:${port}/api/member-tool`});
const clients=new Set();const pendingCreates=new Map();
let vite;
if(process.argv.includes('--dev')){const {createServer}=await import('vite');vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>100000)throw Object.assign(new Error('请求过大'),{status:413});}try{return JSON.parse(data||'{}');}catch{throw Object.assign(new Error('无效的 JSON 请求'),{status:400});}}
function isLocalRequest(req){if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return false;return !req.headers.origin||[`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin);}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(!isLocalRequest(req)){json(res,403,{error:'仅允许本机工作台访问'});return;}
  const url=new URL(req.url,`http://${host}:${port}`);
  try{
    if(url.pathname.startsWith('/api/')){
      if(req.method==='GET'&&url.pathname==='/api/bootstrap'){json(res,200,{token,...service.snapshot()});return;}
      if(req.method==='GET'&&url.pathname==='/api/documents/bootstrap'){json(res,200,{token,capabilities:{localFilePreview:true}});return;}
      if(req.method==='GET'&&url.pathname==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(`event: snapshot\ndata: ${JSON.stringify(service.snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;
      }
      if(req.method!=='POST'){json(res,405,{error:'不支持的操作'});return;}
      if(url.pathname==='/api/member-tool'){const data=await body(req);json(res,200,await service.callMemberTool(req.headers['x-office-member-token'],data.tool,data.arguments));return;}
      if(req.headers['x-office-token']!==token){json(res,403,{error:'会话已过期，请刷新页面'});return;}
      const data=await body(req);
      const fileRoute=url.pathname.match(/^\/api\/missions\/(mission_[a-f0-9-]+)\/file$/);
      if(fileRoute){const result=await readDocument(service.get(fileRoute[1]),data.path,{raw:data.raw===true});if(data.raw===true){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(result.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`,'Cache-Control':'no-store'});res.end(result.data);}else json(res,200,result);return;}
      if(url.pathname==='/api/connect'){await service.reconnectRuntimes({provider:typeof data.provider==='string'?data.provider:'',force:data.force!==false});json(res,200,service.snapshot());return;}
      if(url.pathname==='/api/pick-directory'){const cwd=await pickDirectory();json(res,200,{cwd});return;}
      if(url.pathname==='/api/projects'){json(res,201,{project:await service.createProject(data)});return;}
      const projectRoute=url.pathname.match(/^\/api\/projects\/(project_[a-f0-9-]+)\/(rename|hide|restore)$/);
      if(projectRoute){const [,id,action]=projectRoute;const project=action==='rename'?await service.renameProject(id,data.name):await service.setProjectHidden(id,action==='hide');json(res,200,{project});return;}
      if(url.pathname==='/api/missions'){
        const key=data.clientRequestId;if(typeof key!=='string'||!/^[\w-]{8,80}$/.test(key))throw Object.assign(new Error('缺少请求标识，请刷新页面重试'),{status:400});
        let mission=service.missions.find(m=>m.clientRequestId===key);
        if(!mission){let pending=pendingCreates.get(key);if(!pending){pending=service.create(data).then(m=>{m.clientRequestId=key;service.touch(m);return m;});pendingCreates.set(key,pending);}try{mission=await pending;}finally{pendingCreates.delete(key);}}
        json(res,201,{mission});return;
      }
      const route=url.pathname.match(/^\/api\/missions\/(mission_[a-f0-9-]+)\/(message|stop|answer|accept|archive|restore|resume|rename)$/);
      if(route){const [,id,action]=route;const mission=['archive','restore'].includes(action)?service.setArchived(id,action==='archive'):action==='message'?await service.sendMessage(id,data):action==='stop'?await service.stop(id):action==='answer'?await service.answer(id,data.requestId,data):action==='resume'?await service.resume(id,{agentId:typeof data.agentId==='string'?data.agentId:'',retryFailed:data.retryFailed===true}):action==='rename'?service.rename(id,data.title):service.accept(id);json(res,200,{mission});return;}
      json(res,404,{error:'接口不存在'});return;
    }
    if(vite){vite.middlewares(req,res);return;}
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const dist=path.join(root,'dist');let file=path.resolve(dist,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(dist+path.sep)&&file!==dist){res.writeHead(403);res.end();return;}
    try{if(!(await stat(file)).isFile())file=path.join(dist,'index.html');}catch{file=path.join(dist,'index.html');}
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
    // A rebuilt bundle must reach the browser on a plain refresh: the shell is
    // never cached, hashed assets are immutable, anything else revalidates.
    res.setHeader('Cache-Control',file.endsWith('.html')?'no-store':file.includes(`${path.sep}assets${path.sep}`)?'public, max-age=31536000, immutable':'no-cache');
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch(error){json(res,error.status||500,{error:error.message||'操作失败'});}
});
service.on('change',()=>{const data=`event: snapshot\ndata: ${JSON.stringify(service.snapshot())}\n\n`;for(const res of clients){if(res.writableLength>2000000){clients.delete(res);res.destroy();}else res.write(data);}});
const heartbeat=setInterval(()=>{for(const res of clients)res.write(': heartbeat\n\n');},15000);heartbeat.unref();
server.listen(port,host,()=>{console.log(`Readyroom → http://${host}:${port}`);void service.connect();});
server.on('error',error=>{console.error(error.message);process.exit(1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{service.save();bridge.close();for(const res of clients)res.end();server.close();void vite?.close();setTimeout(()=>process.exit(0),150).unref();});
