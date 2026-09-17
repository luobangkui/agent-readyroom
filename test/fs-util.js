import {symlinkSync} from 'node:fs';
import {symlink} from 'node:fs/promises';

// Windows 默认要开发者模式或管理员权限才能创建符号链接；目录可以改用
// junction（免特权，realpath 行为等价）。文件符号链接实在建不了就返回
// false，由测试自己 t.skip，而不是让整套套件在 Windows 上变红。
export function trySymlinkDirSync(target,link){
  try{symlinkSync(target,link,process.platform==='win32'?'junction':undefined);return true;}
  catch(error){if(error?.code==='EPERM')return false;throw error;}
}
export function trySymlinkSync(target,link){
  try{symlinkSync(target,link);return true;}
  catch(error){if(error?.code==='EPERM'&&process.platform==='win32')return false;throw error;}
}
export async function trySymlink(target,link){
  try{await symlink(target,link);return true;}
  catch(error){if(error?.code==='EPERM'&&process.platform==='win32')return false;throw error;}
}
