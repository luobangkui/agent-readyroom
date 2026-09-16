import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {CodexBridge,isAuthenticationFailure} from '../server/codex.js';

class FakeChild extends EventEmitter {
  constructor(){super();this.stdout=new PassThrough();this.stderr=new PassThrough();this.killed=false;this.stdin=new PassThrough();this.stdin.write=data=>{
    const message=JSON.parse(data);
    if(message.id&&message.method==='initialize')this.stdout.write(`${JSON.stringify({id:message.id,result:{}})}\n`);
    return true;
  };}
  kill(){this.killed=true;this.emit('exit',null,'SIGTERM');}
}

test('authentication errors from a turn invalidate the Codex bridge',async()=>{
  const children=[];const bridge=new CodexBridge({binary:'fake-codex',spawnProcess:()=>{const child=new FakeChild();children.push(child);return child;}});
  const disconnected=new Promise(resolve=>bridge.once('disconnected',resolve));
  await bridge.start();
  children[0].stdout.write(`${JSON.stringify({method:'turn/completed',params:{turn:{error:{message:'Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.'}}}})}\n`);
  assert.equal(await disconnected,'本地 Codex 连接已失效，请重新登录后点击“重建本地连接”。');
  assert.equal(bridge.ready,false);
  assert.equal(children[0].killed,true);
});

test('restart always starts a fresh app-server process',async()=>{
  const children=[];const bridge=new CodexBridge({binary:'fake-codex',spawnProcess:()=>{const child=new FakeChild();children.push(child);return child;}});
  const disconnected=new Promise(resolve=>bridge.once('disconnected',resolve));
  await bridge.start();
  await bridge.restart();
  assert.equal(children.length,2);
  assert.equal(children[0].killed,true);
  assert.equal(bridge.ready,true);
  assert.equal(await disconnected,'本地 Codex 连接正在重建');
});

test('authentication failure matching is narrow enough for ordinary model errors',()=>{
  assert.equal(isAuthenticationFailure('Your access token could not be refreshed'),true);
  assert.equal(isAuthenticationFailure('Selected model is at capacity'),false);
});

test('the reconcile probe reports a signed-out Codex instead of a stale connection',async()=>{
  const children=[];
  const bridge=new CodexBridge({binary:'fake-codex',spawnProcess:()=>{
    const child=new FakeChild();
    child.stdin.write=data=>{
      const message=JSON.parse(data);
      if(message.id&&message.method==='initialize')child.stdout.write(`${JSON.stringify({id:message.id,result:{}})}\n`);
      if(message.id&&message.method==='account/read')child.stdout.write(`${JSON.stringify({id:message.id,result:{account:null,requiresOpenaiAuth:true}})}\n`);
      return true;
    };
    children.push(child);return child;
  }});
  await bridge.start();
  assert.deepEqual(await bridge.pollStatus(),{connected:true,authenticated:false,message:'请先登录 Codex'});
  bridge.close();
  assert.equal((await bridge.pollStatus()).connected,false,'进程已关闭时不再声称已连接');
});
