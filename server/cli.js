import {existsSync} from 'node:fs';

// 跨平台 CLI 解析与启动：Windows 上 npm 安装的 CLI 通常是 .cmd 垫片，直接
// spawn 会 EINVAL；无扩展名脚本和 .exe 可以直启。三个运行环境桥接共用这一层，
// 让「接入哪个 agent」与「跑在 macOS 还是 Windows」无关。
export function firstExisting(paths,exists=existsSync){
  for(const candidate of paths.filter(Boolean)){
    const variants=process.platform==='win32'?[candidate,`${candidate}.exe`,`${candidate}.cmd`]:[candidate];
    const found=variants.find(variant=>exists(variant));
    if(found)return found;
  }
  return null;
}

export function spawnCli(spawn,binary,args,options={}){
  if(process.platform==='win32'&&/\.(cmd|bat)$/i.test(binary))return spawn(binary,args,{...options,shell:true});
  return spawn(binary,args,options);
}
