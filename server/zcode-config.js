import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const ZCODE_TOKEN_ENV='OFFICE_ZCODE_PROVIDER_TOKEN';
export async function readZcodeConfig({configPath=process.env.OFFICE_ZCODE_CONFIG||path.join(os.homedir(),'.zcode/v2/config.json'),settingsPath=path.join(os.homedir(),'.zcode/v2/setting.json')}={}){
  let config,settings={};
  try{config=JSON.parse(await readFile(configPath,'utf8'));}catch{throw new Error('未找到 ZCode 模型配置，请先在 ZCode 中配置 GLM。');}
  try{settings=JSON.parse(await readFile(settingsPath,'utf8'));}catch{}
  const entries=Object.entries(config.provider||{}),selected=settings.modelProviderFamilySelectedKeys?.[settings.providerFamilyDomain||'bigmodel'];
  const match=entries.find(([id])=>selected?.endsWith(id))||entries.find(([,p])=>p.enabled!==false&&p.models?.['GLM-5.3']&&p.models?.['GLM-5.3-Flash']&&p.options?.apiKey);
  if(!match)throw new Error('ZCode 中没有可用的 GLM 提供方。');
  const [providerId,source]=match;
  if(source.enabled===false||!source.options?.apiKey)throw new Error('ZCode 当前 GLM 提供方未登录或缺少密钥，请在 ZCode 中重新连接。');
  const models=['GLM-5.3','GLM-5.3-Flash'].map(modelId=>{
    const model=source.models?.[modelId];if(!model||model.deleted||model.disabled)throw new Error(`ZCode 当前提供方未配置 ${modelId}。`);
    const levels=[...(model.reasoning?.variants||['low','high','max'])];
    // ZCode calls this field `defaultVariant`; preserving it avoids silently
    // changing the user's configured effort when a model has no `high` tier.
    const configuredDefault=model.reasoning?.defaultVariant;
    const defaultLevel=levels.includes(configuredDefault)
      ? configuredDefault
      : levels.includes('high')?'high':levels[0];
    return {modelId,label:modelId,contextWindow:model.limit?.context||1000000,maxOutputTokens:model.limit?.output||128000,supportsTools:true,supportsImages:model.modalities?.input?.includes('image')||false,reasoning:{enabled:model.reasoning?.enabled!==false,defaultLevel,levels:levels.map(value=>({value,label:value}))}};
  });
  const kind=source.kind||'anthropic';
  const apiFormat=source.apiFormat||(kind==='openai'||kind==='openai-compatible'?'openai-chat-completions':'anthropic-messages');
  const provider={providerId,kind,apiFormat,label:source.name||'ZCode GLM',source:'ephemeral',baseURL:source.options.baseURL,apiKey:{source:'env',name:ZCODE_TOKEN_ENV},apiKeyRequired:true,models};
  return {provider,env:{[ZCODE_TOKEN_ENV]:source.options.apiKey}};
}
export function zcodeRuntime(provider,model,effort='high'){
  if(!provider.models.some(m=>m.modelId===model))throw new Error(`ZCode 未提供指定模型 ${model}`);
  return {revision:`office:${provider.providerId}:${model}:${effort}`,generatedAt:Date.now(),model:{providerId:provider.providerId,modelId:model},provider,thoughtLevel:effort};
}
