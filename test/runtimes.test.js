import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readZcodeConfig,zcodeRuntime} from '../server/zcode-config.js';
import {OfficeRuntimes} from '../server/runtimes.js';

class Bridge extends EventEmitter {
  constructor(account, models=[]) { super(); this.account=account; this.models=models; this.calls=[]; this.restartCount=0; }
  async start() { this.started=true; }
  async restart() { this.restartCount++; this.started=true; }
  async request(method, params) { this.calls.push({method,params}); if(method==='account/read') return {account:this.account}; if(method==='model/list') return {data:this.models}; return {}; }
  respond() {}
  reject() {}
  close() {}
}

test('ZCode config exposes the two configured GLM models without leaking the key', async () => {
  const {provider,env}=await readZcodeConfig();
  assert.deepEqual(provider.models.map(m=>m.modelId), ['GLM-5.3','GLM-5.3-Flash']);
  assert.equal(provider.apiKey.source, 'env');
  assert.equal(provider.apiKey.name, 'OFFICE_ZCODE_PROVIDER_TOKEN');
  assert.equal(provider.models[0].reasoning.defaultLevel, 'max');
  assert.equal(provider.models[1].supportsImages, true);
  assert.ok(env.OFFICE_ZCODE_PROVIDER_TOKEN);
  assert.equal(JSON.stringify(provider).includes(env.OFFICE_ZCODE_PROVIDER_TOKEN), false);
});

test('runtime descriptor uses the protocol model/provider reference and requested effort', async () => {
  const {provider}=await readZcodeConfig();
  const runtime=zcodeRuntime(provider,'GLM-5.3','high');
  assert.deepEqual(runtime.model,{providerId:provider.providerId,modelId:'GLM-5.3'});
  assert.equal(runtime.thoughtLevel,'high');
  assert.equal(runtime.provider.apiKey.source,'env');
  assert.throws(()=>zcodeRuntime(provider,'GLM-unknown'),/未提供指定模型/);
});

test('OfficeRuntimes routes GLM sessions to ZCode and GPT sessions to Codex', async () => {
  const codex=new Bridge({type:'codex'},[{model:'gpt-6-astra',displayName:'GPT-6 Astra',supportedReasoningEfforts:[]}]);
  const zcode=new Bridge({type:'zcode'},[{model:'GLM-5.3',displayName:'GLM-5.3',supportedReasoningEfforts:[]}]);
  const runtimes=new OfficeRuntimes({codex,zcode});
  await runtimes.start();
  assert.equal(runtimes.getFor({model:'gpt-5.6-sol'}),'codex');
  assert.equal(runtimes.getFor({model:'gpt-6-astra'}),'codex');
  assert.equal(runtimes.getFor({model:'GLM-5.3'}),'zcode');
  assert.equal(runtimes.getFor({provider:'zcode',model:'custom-glm'}),'zcode');
  assert.equal(runtimes.getFor({threadId:'zcode:session-1'}),'zcode');
  const list=await runtimes.request('model/list');
  assert.deepEqual(list.data.map(m=>m.provider),['codex','zcode']);
  assert.equal(runtimes.providers.codex.authenticated,true);
  assert.equal(runtimes.providers.zcode.authenticated,true);
});

test('manual reconnect restarts the Codex runtime after an account switch without restarting ZCode', async () => {
  const codex=new Bridge({type:'codex'},[{model:'gpt-6-astra',displayName:'GPT-6 Astra',supportedReasoningEfforts:[]}]);
  const zcode=new Bridge({type:'zcode'},[{model:'GLM-5.3',displayName:'GLM-5.3',supportedReasoningEfforts:[]}]);
  const runtimes=new OfficeRuntimes({codex,zcode});
  await runtimes.start();
  await runtimes.reconnect('codex');
  assert.equal(codex.restartCount,1);
  assert.equal(zcode.restartCount,0);
  assert.equal(runtimes.providers.codex.authenticated,true);
  assert.equal(runtimes.providers.zcode.authenticated,true);
});

test('ensureConnected 只重建掉线的运行环境，健康的进程不重启',async()=>{
  const codex=new Bridge({type:'codex'},[{model:'gpt-6-astra',displayName:'GPT-6 Astra',supportedReasoningEfforts:[]}]);
  const zcode=new Bridge({type:'zcode'},[{model:'GLM-5.3',displayName:'GLM-5.3',supportedReasoningEfforts:[]}]);
  const runtimes=new OfficeRuntimes({codex,zcode});
  await runtimes.start();
  // 让 zcode 掉线，codex 保持健康
  runtimes.providers.zcode={connected:false,authenticated:false,message:'ZCode 连接已关闭'};
  const providers=await runtimes.ensureConnected();
  assert.equal(zcode.restartCount,1,'掉线的运行环境被重建');
  assert.equal(codex.restartCount,0,'健康的运行环境不动');
  assert.equal(providers.zcode.authenticated,true);
  assert.equal(providers.codex.authenticated,true);
});

test('全部健康时 ensureConnected 是空操作',async()=>{
  const codex=new Bridge({type:'codex'},[]),zcode=new Bridge({type:'zcode'},[]);
  const runtimes=new OfficeRuntimes({codex,zcode});
  await runtimes.start();
  await runtimes.ensureConnected();
  assert.equal(codex.restartCount+zcode.restartCount,0);
});
