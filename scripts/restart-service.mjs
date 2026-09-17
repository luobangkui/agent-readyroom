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

// Windows 上 undici（fetch）的异步句柄若正好在关闭中，立即 process.exit 会
// 触发 libuv 断言（0xC0000409）把退出码弄丢。统一在主流程返回退出码后走
// settle：先置 exitCode 让事件循环自然排空，再用延迟硬退出兜底。
function settleExit(code){
  process.exitCode=code;
  setTimeout(()=>process.exit(code),250).unref();
}

async function bootstrap(timeoutMs=4000){
  const response=await fetch(`http://${host}:${port}/api/bootstrap`,{signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw new Error(`服务返回 HTTP ${response.status}`);
  return response.json();
}
const activeMembers=snapshot=>snapshot.missions.flatMap(mission=>mission.agents.filter(agent=>['running','queued','starting','waiting'].includes(agent.status)).map(agent=>({mission,agent})));
const activeMissions=snapshot=>snapshot.missions.filter(mission=>['running','queued','stopping','starting'].includes(mission.status));

async function main(){
  let snapshot;
  try{snapshot=await bootstrap();}
  catch(error){console.log(`服务当前不可达（${error.message}）；直接交给服务托管方拉起。`);}

  if(snapshot){
    const missions=activeMissions(snapshot),members=activeMembers(snapshot);
    if(missions.length||members.length){
      console.log('⚠️  有活动任务，重启会中断它们，且不会自动重跑：');
      for(const mission of missions)console.log(`   使命 ${mission.title.slice(0,40)} · ${mission.status}`);
      for(const {agent}of members)console.log(`   成员 ${agent.name} · ${agent.status} · ${(agent.summary||'').slice(0,50)}`);
      if(!force){
        console.log('\n先等它们结束，或在聊天里让成员收尾；确认要中断就加 --force。');
        return 1;
      }
      console.log('\n--force：按你的要求继续重启。');
    }else console.log('✓ 无活动任务，可以安全重启。');
  }

  // 检查与重启之间仍有窗口期：任务可能刚好被派发。杀掉之前再确认一次，
  // 把"以为没人跑、其实刚起来"的概率压到最小；真被中断的成员会在重启后
  // 由页面的「继续推进 / 重试」恢复。
  if(snapshot&&!force){
    await new Promise(resolve=>setTimeout(resolve,1200));
    const recheck=await bootstrap().catch(()=>null);
    const late=recheck?[...activeMissions(recheck),...activeMembers(recheck)]:[];
    if(late.length){
      console.log('⚠️  复查发现刚刚有任务开始执行，已中止重启：');
      for(const {agent}of activeMembers(recheck))console.log(`   成员 ${agent.name} · ${agent.status}`);
      for(const mission of activeMissions(recheck))console.log(`   使命 ${mission.title.slice(0,40)} · ${mission.status}`);
      console.log('\n等这一轮结束后再试；确认要中断就加 --force。');
      return 1;
    }
  }

  // launchd 只存在于 macOS；其他平台没有常驻服务可发信号，跳过 kill，
  // 直接进入就绪轮询（Windows 上 process.getuid 也不存在，不能硬调）。
  if(process.platform==='darwin'){
    await run('launchctl',['kill','SIGTERM',`gui/${process.getuid()}/${label}`]).catch(error=>{
      // 发信号失败不当作重启失败：服务可能正好处于"已退出、尚在拉起"的窗口，
      // 或者 label 写错。真正的判据是下面的就绪轮询——起不来就会以失败退出。
      console.log(`launchctl kill 未成功（${String(error.stderr||error.message).trim().slice(0,120)}），继续等它就绪。`);
    });
  }else{
    console.log(`当前平台（${process.platform}）没有 launchd 常驻服务，跳过服务信号；Windows 请直接重启进程或终端。`);
  }
  // Wait for the runtime bridges to settle: an immediately-answering service can
  // still be in the middle of connecting Codex/ZCode/DSH/Kimi.
  // 等到所有运行环境都就绪再报成功：重启后各运行环境要拉起子进程，几秒内
  // providers 可能只有一部分，这时候报"已重启"会让人以为连接已经好了。
  const EXPECTED=(process.env.OFFICE_RUNTIMES||'codex,zcode,dsh,kimi').split(',').map(name=>name.trim()).filter(Boolean);
  const readyTimeoutMs=Number(process.env.OFFICE_RESTART_READY_TIMEOUT_MS)||60000;
  const deadline=Date.now()+readyTimeoutMs;
  const pending=new Set(EXPECTED);
  while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,1500));
    try{
      const next=await bootstrap(2000),providers=next.connection.providers||{};
      for(const name of EXPECTED)if(providers[name]?.authenticated)pending.delete(name);
      if(pending.size)continue;
      const report=EXPECTED.map(name=>`${name}:${providers[name]?.authenticated?'已连接':providers[name]?.connected?'未认证':'未连接'}`);
      console.log(`✓ 服务已重启：${report.join(' · ')}`);
      return 0;
    }catch{}
  }
  for(const name of pending)console.log(`⚠️  ${name} 在 ${Math.round(readyTimeoutMs/1000)} 秒内没有就绪：可在页面点「重建本地连接」或检查该运行环境的登录状态。`);
  return pending.size?1:0;
}

settleExit(await main());
