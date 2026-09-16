// Real local DSH (DeepSeek Harness) protocol smoke test through the office
// bridge: it starts `dsh --profile acp`, mounts the real office MCP server,
// selects a DeepSeek model and runs one tiny model turn. Needs a working local
// dsh login; run it by hand: `node scripts/check-dsh-acp.mjs`.
import http from 'node:http';
import path from 'node:path';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {DshBridge,DSH_PREFIX} from '../server/dsh.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const work=mkdtempSync(path.join(tmpdir(),'office-dsh-smoke-'));
const marker=path.join(work,'office-mcp-started.json');
const mcpWrapper=path.join(work,'office-mcp-wrapper.mjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// The office MCP server is a stdio wrapper around one HTTP tool endpoint. The
// wrapper records that the harness really launched it, then hands over to the
// shipped server, so the check proves the MCP mount instead of assuming it.
writeFileSync(mcpWrapper,[
  "import {writeFileSync} from 'node:fs';",
  "writeFileSync(process.env.OFFICE_MCP_MARKER,JSON.stringify({role:process.env.OFFICE_MCP_ROLE,token:Boolean(process.env.OFFICE_MCP_TOKEN)}));",
  `await import(${JSON.stringify(fileURLToPath(new URL('../server/office-mcp.mjs',import.meta.url)))});`
].join('\n'));

const calls=[];
const server=http.createServer(async(request,response)=>{
  let body='';for await(const chunk of request)body+=chunk;
  calls.push({token:request.headers['x-office-member-token'],body});
  response.setHeader('Content-Type','application/json');
  response.end(JSON.stringify({fixture:true,recorded:true}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const memberURL=`http://127.0.0.1:${server.address().port}/api/member-tool`;

const bridge=new DshBridge({cwd:work});
const events=[];
let stage='connect',threadId=null;
try{
  await bridge.start();
  stage='model catalog';
  const models=(await bridge.request('model/list')).data;
  console.log(`DSH 模型：${models.map(model=>`${model.model} → ${model.displayName}`).join('，')}`);
  assert.ok(models.some(model=>model.model==='deepseek-flash'),'缺少 deepseek-flash (DeepSeek-V41-Flash)');

  stage='session with office MCP';
  bridge.on('notification',event=>events.push(event));
  const started=await bridge.request('thread/start',{cwd:work,model:'deepseek-flash',officeEffort:'low',developerInstructions:'你是桥接自检成员，回答只用一句话。',officeMcpServers:[{name:'office',command:process.execPath,args:[mcpWrapper],env:[{name:'OFFICE_MCP_URL',value:memberURL},{name:'OFFICE_MCP_TOKEN',value:'smoke-token'},{name:'OFFICE_MCP_ROLE',value:'ops'},{name:'OFFICE_MCP_MARKER',value:marker}],isolation:'session'}]});
  threadId=started.thread.id;
  assert.equal(started.provider,'dsh');
  assert.equal(started.model,'deepseek-flash');
  assert.match(threadId,new RegExp(`^${DSH_PREFIX}`));
  for(let attempt=0;attempt<40&&!existsSync(marker);attempt++)await sleep(250);
  assert.ok(existsSync(marker),'harness 没有启动待命室 MCP 服务');
  const mounted=JSON.parse(readFileSync(marker,'utf8'));
  assert.deepEqual(mounted,{role:'ops',token:true});
  console.log('待命室 MCP 已由 harness 启动，角色与令牌已注入。');

  stage='model turn';
  const turn=await bridge.request('turn/start',{threadId,input:[{type:'text',text:'请只回复这句话：DSH 桥接自检通过'}]});
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
    const completed=events.find(event=>event.method==='turn/completed'&&event.params.turn.id===turn.turn.id);
    if(completed){
      assert.equal(completed.params.turn.status,'completed',completed.params.turn.error?.message||'轮次未成功结束');
      const text=completed.params.turn.items.map(item=>item.text).join('\n').trim();
      assert.ok(text,'模型没有返回文本');
      console.log(`模型回复：${text.split('\n')[0]}`);
      console.log(`待命室事件：${[...new Set(events.map(event=>event.method))].join(', ')}`);
      console.log('DSH ACP 自检通过。');
      break;
    }
    if(events.some(event=>event.method==='error'))throw new Error(events.find(event=>event.method==='error').params.error.message);
    await sleep(500);
  }
  if(!events.some(event=>event.method==='turn/completed'&&event.params.turn.id===turn.turn.id))throw new Error('等待模型轮次超时');
}catch(error){
  console.error(`DSH ACP 自检失败（${stage}）：${error.message}`);
  const tail=String(bridge.stderr||'').trim();
  if(tail)console.error(`harness stderr：\n${tail.slice(-2000)}`);
  process.exitCode=1;
}finally{
  bridge.close();server.close();rmSync(work,{recursive:true,force:true});
}
