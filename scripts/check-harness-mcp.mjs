// Real local Codex protocol smoke test. No turn/start or model generation.
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {CodexBridge} from '../server/codex.js';
const root=fileURLToPath(new URL('..',import.meta.url)),seen=[];
const server=http.createServer(async(req,res)=>{for await(const chunk of req){}seen.push(req.headers['x-office-member-token']);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fixture:true,generation:seen.at(-1)}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const bridge=new CodexBridge({cwd:root});
const ownThreads=[];let stage='connect';
try{
  await bridge.start();
  const config=generation=>({cwd:root,model:'gpt-5.6-sol',sandbox:'read-only',approvalPolicy:'never',config:{'features.multi_agent':false,'mcp_servers.office':{command:process.execPath,args:[fileURLToPath(new URL('../server/office-mcp.mjs',import.meta.url))],env:{OFFICE_MCP_URL:`http://127.0.0.1:${port}`,OFFICE_MCP_TOKEN:generation,OFFICE_MCP_ROLE:'boss'},required:true}}});
  stage='start';const first=await bridge.request('thread/start',{...config('fixture-generation-1'),ephemeral:false,dynamicTools:[]});ownThreads.push(first.thread.id);
  await bridge.request('thread/name/set',{threadId:first.thread.id,name:'Office harness MCP verification · no model turns'});
  stage='inventory';
  const inventory=await bridge.request('mcpServerStatus/list',{threadId:first.thread.id,detail:'toolsAndAuthOnly'}),office=inventory.data.find(s=>s.name==='office');
  assert.ok(office.tools.office_submit_graph);assert.ok(office.tools.office_suspend);
  const call=()=>bridge.request('mcpServer/tool/call',{threadId:first.thread.id,server:'office',tool:'office_inbox',arguments:{}});
  stage='first tool';await call();assert.equal(seen.at(-1),'fixture-generation-1');
  stage='resume';
  await bridge.request('thread/resume',{threadId:first.thread.id,...config('fixture-generation-2')});
  stage='resumed tool';await call();const loadedResumeRefreshesMcp=seen.at(-1)==='fixture-generation-2';
  stage='isolated generation';const second=await bridge.request('thread/start',{...config('fixture-generation-2'),ephemeral:false,dynamicTools:[]});ownThreads.push(second.thread.id);
  await bridge.request('thread/name/set',{threadId:second.thread.id,name:'Office harness MCP verification generation 2 · no model turns'});
  await bridge.request('mcpServer/tool/call',{threadId:second.thread.id,server:'office',tool:'office_inbox',arguments:{}});assert.equal(seen.at(-1),'fixture-generation-2');
  console.log(JSON.stringify({verified:true,modelTurns:0,toolCount:Object.keys(office.tools).length,loadedResumeRefreshesMcp,isolatedGenerationTokenVerified:true}));
}catch(error){console.error(`MCP smoke failed at ${stage}: ${error.message}`);process.exitCode=1;}
finally{for(const threadId of ownThreads)await bridge.request('thread/archive',{threadId}).catch(()=>{});bridge.close();await new Promise(resolve=>server.close(resolve));}
