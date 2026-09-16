// Safe service restart: refuses to restart while missions are running.
//
// Restarting mid-flight interrupts every active member and marks their work
// interrupted; nothing is auto-replayed. That is documented behavior, and this
// script makes the documented "先确认无活动任务" rule enforceable instead of
// relying on whoever types the command to remember it.
//
//   node scripts/restart-service.mjs            # 有活动任务就拒绝
//   node scripts/restart-service.mjs --force     # 明确知道会中断时才用
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const port=Number(process.env.OFFICE_PORT||4317),host='127.0.0.1';
const label=process.env.OFFICE_LAUNCHD_LABEL||'local.readyroom';
const force=process.argv.includes('--force');

async function bootstrap(timeoutMs=4000){
  const response=await fetch(`http://${host}:${port}/api/bootstrap`,{signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw new Error(`服务返回 HTTP ${response.status}`);
  return response.json();
}
const activeMembers=snapshot=>snapshot.missions.flatMap(mission=>mission.agents.filter(agent=>['running','queued','starting','waiting'].includes(agent.status)).map(agent=>({mission,agent})));
const activeMissions=snapshot=>snapshot.missions.filter(mission=>['running','queued','stopping','starting'].includes(mission.status));

let snapshot;
try{snapshot=await bootstrap();}
catch(error){console.log(`服务当前不可达（${error.message}）；直接交给 launchd 拉起。`);}

if(snapshot){
  const missions=activeMissions(snapshot),members=activeMembers(snapshot);
  if(missions.length||members.length){
    console.log('⚠️  有活动任务，重启会中断它们，且不会自动重跑：');
    for(const mission of missions)console.log(`   使命 ${mission.title.slice(0,40)} · ${mission.status}`);
    for(const {agent}of members)console.log(`   成员 ${agent.name} · ${agent.status} · ${(agent.summary||'').slice(0,50)}`);
    if(!force){
      console.log('\n先等它们结束，或在聊天里让成员收尾；确认要中断就加 --force。');
      process.exit(1);
    }
    console.log('\n--force：按你的要求继续重启。');
  }else console.log('✓ 无活动任务，可以安全重启。');
}

await run('launchctl',['kill','SIGTERM',`gui/${process.getuid()}/${label}`]).catch(error=>{throw new Error(`launchctl 重启失败：${error.message}`);});
// Wait for the runtime bridges to settle: an immediately-answering service can
// still be in the middle of connecting Codex/ZCode/DSH/Edge0.
const deadline=Date.now()+40000;
while(Date.now()<deadline){
  await new Promise(resolve=>setTimeout(resolve,1000));
  try{
    const next=await bootstrap(2000),providers=Object.entries(next.connection.providers||{});
    if(!providers.length)continue;
    const report=providers.map(([name,status])=>`${name}:${status.authenticated?'已连接':status.connected?'未认证':'未连接'}`);
    console.log(`✓ 服务已重启：${report.join(' · ')}`);
    process.exit(providers.some(([,status])=>status.connected)?0:1);
  }catch{}
}
console.error('服务在 30 秒内没有重新就绪，请查看 ~/Library/Logs/Readyroom/stderr.log');
process.exit(1);
