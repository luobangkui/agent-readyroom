import {existsSync,readFileSync,writeFileSync,renameSync,realpathSync} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const invalid=message=>Object.assign(new Error(message),{status:400});
export async function projectDirectory(value){
  if(typeof value!=='string'||!value.trim()||value.length>4000||!path.isAbsolute(value.trim()))throw invalid('请填写本机目录的绝对路径。');
  try{const cwd=await realpath(value.trim());if(!(await stat(cwd)).isDirectory())throw new Error();return cwd;}
  catch{throw invalid('项目目录不存在，请选择本机已存在的文件夹。');}
}
// 重命名时空名称 = 回到目录名；创建项目时空名称仍然是无意义的输入。
export function projectName(value,{allowEmpty=false}={}){
  if(typeof value!=='string')throw invalid('项目名称需为 1–100 个字。');
  const name=value.trim();
  if(!allowEmpty&&!name)throw invalid('项目名称需为 1–100 个字。');
  if(name.length>100)throw invalid('项目名称需为 1–100 个字。');
  return name;
}

export class ProjectStore {
  constructor(directory){
    this.file=path.join(directory,'projects.json');
    this.projects=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):[];
    if(!Array.isArray(this.projects))throw new Error('项目记录格式无效');
  }
  get(id){const project=this.projects.find(item=>item.id===id);if(!project)throw Object.assign(new Error('项目不存在，请重新选择项目。'),{status:404});return project;}
  save(){const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.projects),{mode:0o600});renameSync(temp,this.file);}
  addCanonical(cwd,name){
    const existing=this.projects.find(item=>item.cwd===cwd);if(existing)return existing;
    const project={id:`project_${randomUUID()}`,name:name||path.basename(cwd)||cwd,cwd,createdAt:new Date().toISOString(),hiddenAt:null};
    this.projects.push(project);
    try{this.save();}catch(error){this.projects.pop();throw error;}
    return project;
  }
  async create({cwd,name}){
    const normalized=name===undefined?undefined:projectName(name);
    return this.addCanonical(await projectDirectory(cwd),normalized);
  }
  // 重命名只影响界面标签：目录、目标和对话都不动；空名称回到目录默认名。
  async rename(id,value){
    const project=this.get(id),name=projectName(value,{allowEmpty:true})||path.basename(project.cwd)||project.cwd,previous=project.name;
    if(previous===name)return project;
    project.name=name;
    try{this.save();}catch(error){project.name=previous;throw error;}
    return project;
  }
  // 隐藏即「从页面移除」：只写时间戳，目录内容、目标、对话与历史一条不删。
  async setHidden(id,hidden,{activeMissions=0,maxActive=100}={}){
    const project=this.get(id);
    if(!!project.hiddenAt===hidden)return project;
    if(!hidden&&activeMissions>=maxActive)throw Object.assign(new Error(`未隐藏的任务和对话已达 ${maxActive} 个，请先归档其他记录再恢复项目。`),{status:409});
    const previous=project.hiddenAt;
    project.hiddenAt=hidden?new Date().toISOString():null;
    try{this.save();}catch(error){if(previous===undefined)delete project.hiddenAt;else project.hiddenAt=previous;throw error;}
    return project;
  }
  migrate(missions){
    let changed=false;
    for(const project of this.projects)if(project.hiddenAt===undefined){project.hiddenAt=null;changed=true;}
    for(const mission of missions){
      if(!mission.kind){mission.kind='goal';changed=true;}
      if(this.projects.some(project=>project.id===mission.projectId))continue;
      let cwd=path.resolve(mission.cwd);try{cwd=realpathSync(cwd);}catch{}
      mission.projectId=this.addCanonical(cwd).id;changed=true;
    }
    return changed;
  }
}
