// Real office mission through the DSH runtime: the shipped scheduler, the real
// bridge and one tiny DeepSeek turn, in a throwaway data directory. It verifies
// the whole path the office uses — connect → role model → thread/start with the
// office MCP server → turn → delivery — without touching the running service.
// Run by hand: `node scripts/check-dsh-mission.mjs`.
import path from 'node:path';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {DshBridge} from '../server/dsh.js';
import {OfficeRuntimes} from '../server/runtimes.js';
import {MissionService} from '../server/missions.js';

const directory=mkdtempSync(path.join(tmpdir(),'office-dsh-mission-'));
const cwd=path.join(directory,'project');mkdirSync(cwd);
const runtimes=new OfficeRuntimes({dsh:new DshBridge({cwd})});
const service=new MissionService(runtimes,{directory,defaultCwd:cwd});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let failed=false;
try{
  await service.connect();
  const models=service.connection.models.filter(model=>model.provider==='dsh');
  console.log(`DSH 目录：${models.map(model=>model.name).join('，')}`);
  assert.equal(service.connection.connected,true,'DSH 未连接');
  assert.ok(models.some(model=>model.id==='deepseek-flash'),'缺少 DeepSeek-V41-Flash');

  const mission=await service.create({kind:'chat',roleModels:{tech:'deepseek-flash'},cwd});
  const lead=mission.agents.find(agent=>agent.role==='tech');
  assert.deepEqual([lead.provider,lead.model,lead.modelName],['dsh','deepseek-flash','DeepSeek-V41-Flash（DSH）']);
  await service.sendMessage(mission.id,{text:'请只回复一句话：待命室 DSH 通道已接通。不要使用任何工具。'});
  const deadline=Date.now()+240000;
  while(Date.now()<deadline&&!['completed','failed','needs_attention','interrupted'].includes(mission.status))await sleep(1000);
  assert.ok(['completed','failed','needs_attention','interrupted'].includes(mission.status),'等待模型轮次超时');
  const answer=mission.messages.filter(message=>message.kind==='assistant').at(-1);
  console.log(`成员状态：${lead.status} · 使命状态：${mission.status}`);
  console.log(`模型回复：${String(answer?.text||lead.error||'（无回复）').split('\n')[0]}`);
  console.log(`用量：${lead.usage?.totalTokens??0} tokens · 事件：${[...new Set(mission.events.map(event=>event.kind))].join('、')||'无'}`);
  assert.equal(mission.status,'completed',lead.error||'使命未完成');
  assert.ok(answer&&answer.text.trim(),'没有交付消息');
  console.log('DSH 使命链路自检通过。');
}catch(error){
  failed=true;
  console.error(`DSH 使命自检失败：${error.message}`);
  const tail=String(runtimes.backends.dsh.stderr||'').trim();
  if(tail)console.error(`harness stderr：\n${tail.slice(-2000)}`);
}finally{
  service.save();
  runtimes.close();
  clearInterval(service.harnessTimer);clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);
  rmSync(directory,{recursive:true,force:true});
  if(failed)process.exitCode=1;
}
