import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
const script=fileURLToPath(new URL('../scripts/restart-service.mjs',import.meta.url));

const fixture=async(t,missions)=>{const server=http.createServer((request,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({connection:{providers:{codex:{connected:true,authenticated:true}}},missions}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());return server.address().port;};
// 关键：label 指向不存在的服务，测试绝不能把真实待命室服务 kill 掉
const call=async(port,extra={})=>run(process.execPath,[script],{env:{...process.env,OFFICE_PORT:String(port),OFFICE_RUNTIMES:'codex',OFFICE_RESTART_READY_TIMEOUT_MS:'1500',OFFICE_LAUNCHD_LABEL:'local.readyroom-does-not-exist',...extra}}).then(result=>({...result,code:0}),error=>({stdout:error.stdout||'',stderr:error.stderr||'',code:error.code}));

test('the restart helper refuses to interrupt a running mission',async t=>{
  const port=await fixture(t,[{title:'正在跑的目标',status:'running',agents:[{name:'鸣人',status:'running',summary:'正在实现接口'}]}]);
  const result=await call(port);
  assert.equal(result.code,1,'应当以失败退出，而不是真的重启');
  assert.match(result.stdout,/有活动任务/);
  assert.match(result.stdout,/鸣人/);
  assert.match(result.stdout,/--force/);
});

test('the restart helper goes ahead when nothing is running',async t=>{
  const port=await fixture(t,[]);
  const result=await call(port);
  // 没有活动任务时它会去调 launchctl；这里只断言它越过了活动任务检查
  assert.ok(!/有活动任务/.test(result.stdout));
  assert.match(result.stdout,/无活动任务|launchctl 重启失败/);
});

test('the restart helper re-checks just before killing',async t=>{
  let calls=0;
  const server=http.createServer((request,response)=>{
    calls++;
    // 第一次问是空的，复查时刚好有任务起来了
    const missions=calls===1?[]:[{title:'刚好开始',status:'running',agents:[{name:'鸣人',status:'running',summary:''}]}];
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({connection:{providers:{codex:{connected:true,authenticated:true}}},missions}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const result=await call(server.address().port);
  assert.equal(result.code,1,'复查发现有人在跑时应当中止');
  assert.match(result.stdout,/复查发现刚刚有任务开始执行/);
  assert.match(result.stdout,/鸣人/);
});

test('the restart helper waits for every runtime and warns about the ones still down',async t=>{
  const port=await fixture(t,[]);
  const result=await call(port,{OFFICE_RUNTIMES:'codex,zcode'});
  assert.equal(result.code,1,'有运行环境没就绪时以失败退出，便于脚本发现');
  assert.match(result.stdout,/zcode 在 2 秒内没有就绪|zcode 在 1 秒内没有就绪/);
  assert.match(result.stdout,/重建本地连接/);
});

test('the restart helper never signals the real service label during tests',async t=>{
  const port=await fixture(t,[]);
  const result=await call(port);
  // macOS 上走 launchctl（测试用的是不存在的 label）；其他平台直接跳过服务信号。
  assert.match(result.stdout,process.platform==='darwin'?/launchctl kill 未成功/:/没有 launchd 常驻服务/,'测试里用的是不存在的 label');
  assert.ok(!/tech\.dp\.readyroom|local\.readyroom$/m.test(result.stdout));
});
