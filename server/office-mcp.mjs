import {createInterface} from 'node:readline';
import {sharedTools,bossTools} from './prompts.js';

const send=message=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
createInterface({input:process.stdin}).on('line',async line=>{
  let request;try{request=JSON.parse(line);}catch{return;}if(request.id===undefined)return;
  try{
    let result;
    if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'office',version:'0.3.0'}};
    else if(request.method==='ping')result={};
    else if(request.method==='tools/list')result={tools:(process.env.OFFICE_MCP_ROLE==='boss'?bossTools:sharedTools).map(({name,description,inputSchema})=>({name,description,inputSchema}))};
    else if(request.method==='tools/call'){
      const response=await fetch(process.env.OFFICE_MCP_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Office-Member-Token':process.env.OFFICE_MCP_TOKEN},body:JSON.stringify({tool:request.params.name,arguments:request.params.arguments||{}}),signal:AbortSignal.timeout(40000)});
      const value=await response.json();result={isError:!response.ok,content:[{type:'text',text:JSON.stringify(value)}]};
    }else{send({id:request.id,error:{code:-32601,message:'Unsupported MCP method'}});return;}
    send({id:request.id,result});
  }catch(error){send({id:request.id,result:{isError:true,content:[{type:'text',text:error.message}]}});}
});
