import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
const cancelled=()=>Object.assign(new Error('选择已取消'),{code:'USER_CANCELLED',status:409});

export function normalizeDirectory(stdout){
  const value=String(stdout??'').trim();
  if(!value)throw cancelled();
  return value;
}

export async function pickDirectory({platform=process.platform,run=execFileAsync}={}){
  let command,args;
  if(platform==='darwin'){command='osascript';args=['-e','POSIX path of (choose folder with prompt "选择待命室项目目录")'];}
  else if(platform==='linux'){command='zenity';args=['--file-selection','--directory','--title=选择待命室项目目录'];}
  else if(platform==='win32'){command='powershell.exe';args=['-NoProfile','-Command','Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq "OK"){Write-Output $d.SelectedPath}'];}
  else throw Object.assign(new Error('当前系统不支持原生目录选择，请手动填写绝对路径。'),{status:501});
  try{const {stdout}=await run(command,args,{timeout:120000,maxBuffer:10000});return normalizeDirectory(stdout);}
  catch(error){if(error?.code==='USER_CANCELLED'||error?.code===-128||/cancel|canceled|cancelled|撤销/i.test(`${error?.message||''} ${error?.stderr||''}`))throw cancelled();throw Object.assign(new Error(`无法打开目录选择器：${error?.message||'未知错误'}`),{status:500});}
}
