import {loadModel,createRiggedModel,isSeatedMotion} from './rigged-model.js';
import {supportsAvatarSelection} from '../themes/index.js';
import {loadMotion} from './styloo.js';
import {officeAvatar} from './avatar-catalog.js';
import {loadOfficeModel} from './office-model.js';
import {DESK_ERGONOMICS} from '../desk-ergonomics.js';

export function attachRiggedAppearance(actor,initialTheme,{loader=loadModel,motionLoader=loadMotion,onError=()=>{}}={}){
  let theme=initialTheme,role=actor.id==='boss'?'boss':'builder',avatarId=actor.id;
  let model=null,key='',generation=0,disposed=false;
  const oldTheme=actor.setTheme,oldRole=actor.setRole,oldAvatar=actor.setAvatar,oldDispose=actor.disposeAppearance;
  const isTyping=()=>!actor.deskActivity&&(actor.mode==='working'||actor.mode==='thinking'||actor.mode==='idle'&&actor.deskTyping);
  const isAgreeing=()=>['talking','listening','celebrating'].includes(actor.mode);
  const targetFor=motion=>actor.mode==='walking'?'walking':isAgreeing()&&motion.has('agree')?'agree':actor.hasSeat&&actor.wantsSeat?(isTyping()&&motion.has('typing')?'typing':'sitting'):'idle';
  function positionModel(seated){
    actor.deskPullIn=(actor.modelMeta?.typingPull??DESK_ERGONOMICS.typingPull)*model.motion.typingBlend;
    model.root.position.set(0,.055+((actor.modelMeta?.seatOffsetY??.185)-.055)*seated,(actor.modelMeta?.seatOffsetZ??.057)*seated+actor.deskPullIn);actor.seatBlend=seated;
  }
  function sync(){
    const enabled=supportsAvatarSelection(theme);
    if(!enabled){generation++;key='';if(model)model.root.visible=false;actor.body.visible=true;actor.assetMotion=null;actor.assetState='inactive';return;}
    const item=officeAvatar(avatarId,role);
    const id=item.id,nextKey=id;if(key===nextKey)return;key=nextKey;const token=++generation;
    if(model&&actor.modelId===id){model.root.visible=true;actor.body.visible=false;actor.assetMotion=model.motion;actor.assetState='ready';return;}
    actor.assetState='loading';
    actor.modelReady=loadOfficeModel(item,{loader,motionLoader}).then(gltf=>{
      if(disposed||token!==generation)return;
      model?.dispose();model=createRiggedModel(gltf);model.root.scale.multiplyScalar(gltf.officeMeta?.scale??1);model.root.traverse(object=>{if(object.isMesh)object.userData.person=actor.id;});
      actor.root.add(model.root);
      const seed=[...actor.id].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261)/4294967296;
      model.motion.phaseOffset=seed;model.motion.typingRate=.92+seed*.16;
      actor.body.visible=false;actor.assetMotion=model.motion;actor.modelRoot=model.root;actor.modelId=id;actor.modelMeta=gltf.officeMeta;actor.assetState='ready';
      // A model change preserves the actor's current activity, including a
      // seated typing pose; it must not restart an entrance animation mid-task.
      const target=targetFor(model.motion);model.motion.target=target;model.motion.play(target,0);model.motion.mixer.update(0);model.motion.typingBlend=target==='typing'?1:0;positionModel(isSeatedMotion(target)?1:0);
    }).catch(error=>{if(disposed||token!==generation)return;key='';actor.assetState='error';actor.body.visible=true;if(model)model.root.visible=false;actor.assetMotion=null;onError('人物模型加载失败，请切换主题重试。');console.error(error);});
  }
  actor.setTheme=value=>{oldTheme(value);theme=value;sync();};
  actor.setRole=value=>{oldRole(value);role=value;sync();};
  actor.setAvatar=value=>{oldAvatar(value);avatarId=value||actor.id;sync();};
  actor.prepareWalk=()=>{if(!actor.assetMotion)return true;actor.wantsSeat=false;actor.assetMotion.request('walking');return actor.assetMotion.canMove;};
  actor.updateAssetPose=dt=>{
    if(!actor.assetMotion)return false;
    // Restore the mixer pose before applying this frame's optional gesture.
    const motion=actor.assetMotion;motion.request(targetFor(motion));motion.update(dt);
    const progress=motion.action?Math.min(1,motion.action.time/motion.action.getClip().duration):0;
    const seated=isSeatedMotion(motion.state)?1:motion.state==='sitDown'?progress:motion.state==='standUp'?1-progress:0;
    // Seat height and the model's authored backward root displacement are
    // calibrated together; the skeleton itself is never stretched.
    positionModel(seated);
    return true;
  };
  actor.disposeAppearance=()=>{disposed=true;generation++;model?.dispose();actor.assetMotion=null;oldDispose();};
  sync();return actor;
}
