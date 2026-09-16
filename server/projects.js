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
    const project={id:`project_${randomUUID()}`,name:name||path.basename(cwd)||cwd,cwd,createdAt:new Date().toISOString()};
    this.projects.push(project);
    try{this.save();}catch(error){this.projects.pop();throw error;}
    return project;
  }
  async create({cwd,name}){
    if(name!==undefined&&(typeof name!=='string'||!name.trim()||name.length>100))throw invalid('项目名称需为 1–100 个字。');
    return this.addCanonical(await projectDirectory(cwd),name?.trim());
  }
  migrate(missions){
    let changed=false;
    for(const mission of missions){
      if(!mission.kind){mission.kind='goal';changed=true;}
      if(this.projects.some(project=>project.id===mission.projectId))continue;
      let cwd=path.resolve(mission.cwd);try{cwd=realpathSync(cwd);}catch{}
      mission.projectId=this.addCanonical(cwd).id;changed=true;
    }
    return changed;
  }
}
