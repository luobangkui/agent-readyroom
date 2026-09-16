import {WORKSTATIONS,LEISURE} from './room-layout.js';
import {findRoute} from './scene-director.js';
const BOSS=WORKSTATIONS[0].home,EMPLOYEE=WORKSTATIONS[1].home,MEET={x:BOSS.x+1.1,z:BOSS.z};
// Local scene choreography. Replace this boundary with agent events later.
export class OfficeSimulation {
  constructor(actors,onChange,onLog) {
    this.actors=actors;this.onChange=onChange;this.onLog=onLog;this.reset();
  }
  reset(){
    this.queue=[];this.segment=null;this.elapsed=0;this.auto=false;this.autoWait=0;this.autoIndex=0;
    this.state={activity:'idle',stage:'idle',title:'好点子，等待发生',description:'派个任务，看看他们如何协作',progress:0,completed:0,bossStatus:'思考中',employeeStatus:'待命中',bossBubble:'今天，做点有意思的。',employeeBubble:'准备好了，老板！',bossLocation:'老板工位',employeeLocation:'员工工位'};
    for(const a of Object.values(this.actors)){a.root.position.copy(a.home);a.targetRotation=a.homeRotation??(a.id==='boss'?0:Math.PI);a.mode='idle';}
    this.onChange(this.state);
  }
  get busy(){return this.state.activity!=='idle';}
  patch(data){Object.assign(this.state,data);this.onChange(this.state);}
  log(text){this.onLog(text);}
  face(id,x,z){const a=this.actors[id];a.targetRotation=Math.atan2(x-a.root.position.x,z-a.root.position.z);}
  wait(duration,start,update){return {duration,start,update};}
  move(id,path,start){return {id,destinations:path.map(([x,z])=>({x,z})),start};}
  begin(activity,segments){if(this.busy)return false;this.patch({activity});this.queue=segments;this.next();return true;}
  next(){
    this.segment=this.queue.shift()??null;this.elapsed=0;
    if(!this.segment){for(const a of Object.values(this.actors)){a.mode='idle';a.targetRotation=a.homeRotation??(a.id==='boss'?0:Math.PI);}this.patch({activity:'idle',bossStatus:'思考中',employeeStatus:'待命中',bossLocation:'老板工位',employeeLocation:'员工工位'});this.autoWait=0;return;}
    this.segment.start?.();if(this.segment.id){const actor=this.actors[this.segment.id];let previous=actor.root.position;this.segment.path=[];for(const target of this.segment.destinations){this.segment.path.push(...findRoute(previous,target));previous=target;}actor.mode='walking';}
  }
  assign(){
    const n=this.state.completed+1,title=['设计我们的第一张名片','整理下周的创意清单','做一个有趣的小作品'][(n-1)%3];
    const toBoss=[[MEET.x,MEET.z]],home=[[EMPLOYEE.x,EMPLOYEE.z]];
    return this.begin('task',[
      this.wait(1.8,()=>{this.patch({title,description:'老罗正在给小林介绍新任务',stage:'briefing',progress:5,bossStatus:'派任务',employeeStatus:'听需求',bossBubble:'小林，来做个小项目吧。',employeeBubble:'好嘞，我来看看！'});this.actors.boss.mode='talking';this.log('老罗派发了一个新任务');}),
      this.move('employee',toBoss,()=>this.patch({employeeStatus:'接需求',employeeLocation:'前往老板工位',employeeBubble:'这就来。'})),
      this.wait(2,()=>{this.face('employee',BOSS.x,BOSS.z);this.face('boss',MEET.x,MEET.z);this.actors.employee.mode='talking';this.patch({bossBubble:'大胆试试，先让想法跑起来。',employeeBubble:'明白，先做一个小样。',employeeLocation:'老板工位',progress:15});}),
      this.move('employee',home,()=>{this.patch({employeeStatus:'回工位',employeeLocation:'回工位途中',employeeBubble:'开工！',bossBubble:'期待你的好消息。'});this.actors.boss.mode='idle';this.actors.boss.targetRotation=0;}),
      this.wait(6,()=>{this.actors.employee.mode='working';this.actors.employee.targetRotation=this.actors.employee.homeRotation??0;this.patch({stage:'working',description:'小林正在工位上专心完成任务',employeeStatus:'专注中',bossStatus:'等待结果',employeeLocation:'员工工位',bossBubble:'给好想法一点时间。',employeeBubble:'正在把想法变成现实…'});this.log('小林开始执行任务');},p=>this.patch({progress:20+p*55})),
      this.move('employee',toBoss,()=>{this.patch({stage:'reporting',progress:80,description:'小林完成了初稿，正在向老罗汇报',employeeStatus:'去汇报',employeeLocation:'前往老板工位',employeeBubble:'搞定！给你看看。',bossBubble:'让我看看成果。'});this.log('小林带着成果向老罗汇报');}),
      this.wait(2.5,()=>{this.face('employee',BOSS.x,BOSS.z);this.face('boss',MEET.x,MEET.z);this.actors.employee.mode='talking';this.actors.boss.mode='talking';this.patch({employeeLocation:'老板工位',employeeStatus:'汇报中',bossStatus:'看成果',employeeBubble:'小样做好了，随时可以继续。',bossBubble:'不错，这就是我们要的！',progress:93});}),
      this.move('employee',home,()=>{this.patch({stage:'done',completed:n,progress:100,description:'任务已完成，给默契的配合点个赞',employeeStatus:'回工位',employeeLocation:'回工位途中',employeeBubble:'又完成一件小事 ✓',bossBubble:'干得漂亮，一起继续。'});this.actors.boss.mode='idle';this.actors.boss.targetRotation=0;this.log(`任务完成：${title}`);}),
      this.wait(.5,()=>this.patch({employeeLocation:'员工工位'}))
    ]);
  }
  coffee(){
    return this.begin('coffee',[
      this.move('employee',[[LEISURE.coffee.x,LEISURE.coffee.z]],()=>{this.patch({employeeStatus:'去接咖啡',employeeLocation:'前往咖啡角',employeeBubble:'脑子转累了，续一杯。',bossBubble:'劳逸结合，灵感才多。'});this.log('小林去咖啡角补充能量');}),
      this.wait(4,()=>{this.actors.employee.mode='coffee';this.actors.employee.targetRotation=Math.PI;this.patch({employeeStatus:'咖啡时间',employeeLocation:'咖啡角',employeeBubble:'嗯，这杯刚刚好 ☕'});}),
      this.move('employee',[[EMPLOYEE.x,EMPLOYEE.z]],()=>this.patch({employeeStatus:'回工位',employeeLocation:'回工位途中',employeeBubble:'电量满格，再来！',bossBubble:'欢迎回来。'})),
      this.wait(.2,()=>this.log('咖啡续上了，小林回到工位'))
    ]);
  }
  meeting(){
    return this.begin('meeting',[
      this.move('employee',[[MEET.x,MEET.z]],()=>{this.patch({bossStatus:'约个碰头',employeeStatus:'去碰头',employeeLocation:'前往老板工位',bossBubble:'来聊聊下一个好点子？',employeeBubble:'正好，我有个新想法。'});this.log('老罗和小林开始一场轻松的碰头');}),
      this.wait(3,()=>{this.face('boss',MEET.x,MEET.z);this.face('employee',BOSS.x,BOSS.z);this.actors.boss.mode='talking';this.actors.employee.mode='talking';this.patch({bossStatus:'聊想法',employeeStatus:'聊想法',employeeLocation:'老板工位',bossBubble:'如果让工作更有趣一点呢？',employeeBubble:'那就先从这间待命室开始。'});}),
      this.wait(3,()=>this.patch({bossBubble:'好，就这么定了！',employeeBubble:'默契 +1 ✦'})),
      this.move('employee',[[EMPLOYEE.x,EMPLOYEE.z]],()=>{this.actors.boss.mode='idle';this.actors.boss.targetRotation=0;this.patch({employeeStatus:'回工位',employeeLocation:'回工位途中',bossBubble:'小团队，大有可为。',employeeBubble:'灵感有了，开工！'});this.log('碰头结束，收获了一个好点子');})
    ]);
  }
  update(dt){
    if(!this.segment){if(this.auto){this.autoWait+=dt;if(this.autoWait>2){const action=['assign','coffee','meeting'][this.autoIndex++%3];this[action]();}}return;}
    this.elapsed+=dt;const seg=this.segment;
    if(seg.id){const a=this.actors[seg.id],p=seg.path[0];if(!p){this.next();return;}
      const dx=p.x-a.root.position.x,dz=p.z-a.root.position.z,dist=Math.hypot(dx,dz),step=2.8*dt;
      if(dist<=step){a.root.position.x=p.x;a.root.position.z=p.z;seg.path.shift();if(!seg.path.length)this.next();}
      else {a.root.position.x+=dx/dist*step;a.root.position.z+=dz/dist*step;a.targetRotation=Math.atan2(dx,dz);}
    }else{seg.update?.(Math.min(1,this.elapsed/seg.duration));if(this.elapsed>=seg.duration)this.next();}
  }
}
