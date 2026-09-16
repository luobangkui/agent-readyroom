// Preloaded only by the macOS service. Observe failures without swallowing
// exceptions or changing the application's existing graceful shutdown.
import {writeSync} from 'node:fs';

const record=(event,details={},fd=1)=>{
  try{writeSync(fd,JSON.stringify({time:new Date().toISOString(),service:'readyroom',event,pid:process.pid,...details})+'\n');}catch{}
};
record('start',{ppid:process.ppid,node:process.version});
process.on('uncaughtExceptionMonitor',(error,origin)=>record('fatal',{origin,name:error?.name,code:error?.code,message:String(error?.message||error)},2));
process.on('exit',code=>record('exit',{code},code?2:1));
// Only observe signals that the application already handles. In particular,
// do not install an unhandledRejection handler that would keep a corrupt
// process alive, or imply SIGKILL/OOM exits can be caught in JavaScript.
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>record('signal',{signal}));
