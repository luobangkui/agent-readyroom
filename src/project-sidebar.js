import {canArchive} from './mission-archive.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function entryStatus(entry,statusNames){return entry.archivedAt?'已归档':entry.kind==='chat'&&entry.status==='completed'?'待续聊':entry.accepted?'已验收':statusNames[entry.status]||entry.status;}
// 每行的「⋯」菜单：会话给重命名 + 归档/恢复，项目给重命名 + 从列表移除/放回。
// 菜单内容由 index.html 里的一个共享 popover 承载，这里只声明它能做什么。
export function entryMenuItems(entry,{archived=false,hidden=false}={}){
  if(entry.id.startsWith('project_')){
    const count=(entry.entries||[]).length;
    return hidden
      ? [{action:'restore-project',label:'放回列表',hint:`重新显示项目${count?`和它的 ${count} 条记录`:''}，目录和对话一直都在`}]
      : [{action:'rename-project',label:'重命名项目',hint:'只改列表里的名字，目录不动'},{action:'hide-project',label:'从列表移除',hint:`只隐藏这个项目${count?`和它的 ${count} 条记录`:''}，不删除任何文件`}];
  }
  if(archived)return [{action:'rename-mission',label:'重命名',hint:'只改列表里的名字'},{action:'restore',label:'恢复到当前列表',hint:'回到未归档列表，可以继续对话'}];
  return [{action:'rename-mission',label:'重命名',hint:'只改列表里的名字'},{action:'archive',label:'归档',hint:canArchive(entry)?'移出当前列表，对话和文件都保留':'请先停止执行再归档',disabled:!canArchive(entry)}];
}
function menu(entry,label,options){
  return entryMenuItems(entry,options).length?`<button class="entry-menu-button" type="button" data-entry-menu="${escape(entry.id)}" aria-label="${escape(label)}" aria-haspopup="menu" title="${escape(label)}">⋯</button>`:'';
}
export function projectSidebar(projects,missions,{selectedProjectId,selectedId,collapsed,statusNames,view='current'}={}){
  const archived=view==='archived',hidden=view==='hidden';
  const countFor=project=>missions.filter(m=>m.projectId===project.id&&!!m.archivedAt===archived).length;
  if(hidden){
    // 「已隐藏」范围只列被移除的项目，里面是恢复入口，不展开会话列表。
    const hiddenProjects=projects.filter(project=>project.hiddenAt);
    if(!hiddenProjects.length)return '<div class="rail-empty">没有被移除的项目。<br>在项目行的「⋯」里可以把它从列表移除，随时放回。</div>';
    return hiddenProjects.map(project=>{
      const entries=missions.filter(m=>m.projectId===project.id&&!m.archivedAt);
      return `<section class="project-group hidden-project">
      <div class="project-heading"><span class="project-toggle-spacer" aria-hidden="true"></span><div class="project-select static" title="${escape(project.cwd)}"><span>▱</span><strong>${escape(project.name)}</strong><small>${entries.length}</small></div>${menu({...project,entries},`项目 ${project.name} 的更多操作`,{hidden:true})}</div>
      <div class="project-children"><p class="project-empty">已从列表移除 ${escape((project.hiddenAt||'').slice(0,10))} · 目录 ${escape(project.cwd)}</p></div></section>`;
    }).join('');
  }
  const visible=projects.filter(project=>!project.hiddenAt);
  if(!visible.length)return projects.length?'<div class="rail-empty">项目都被移除了。<br>在左侧切到「已移除」可以放回来。</div>':'<div class="rail-empty">选择一个本地目录，<br>开始你的第一个项目。</div>';
  return visible.map(project=>{
    const entries=missions.filter(m=>m.projectId===project.id&&!!m.archivedAt===archived),open=!collapsed.has(project.id),active=project.id===selectedProjectId;
    return `<section class="project-group ${active?'selected-project':''}">
      <div class="project-heading"><button class="project-toggle" data-toggle-project="${escape(project.id)}" aria-label="${open?'收起':'展开'}项目 ${escape(project.name)}" aria-expanded="${open}" aria-controls="children-${escape(project.id)}">${open?'▾':'▸'}</button><button class="project-select" data-project="${escape(project.id)}" aria-current="${active?'true':'false'}" title="${escape(project.cwd)}"><span>▱</span><strong>${escape(project.name)}</strong><small>${entries.length}</small></button>${menu({...project,entries},`项目 ${project.name} 的更多操作`,{archived})}</div>
      <div class="project-children" id="children-${escape(project.id)}" ${open?'':'hidden'}>
        <div class="project-actions"><button data-new-goal="${escape(project.id)}" aria-label="在 ${escape(project.name)} 新建目标">＋ 目标</button><button data-new-chat="${escape(project.id)}" aria-label="在 ${escape(project.name)} 新建对话">＋ 对话</button></div>
        ${entries.length?entries.map(m=>`<div class="mission-row"><button class="mission-entry ${m.id===selectedId?'active':''}" data-mission="${escape(m.id)}" aria-current="${m.id===selectedId?'page':'false'}" title="${escape(m.title)}"><strong><span class="entry-kind">${m.kind==='chat'?'◌':'◎'}</span>${escape(m.title)}</strong><span>${m.kind==='chat'?'对话':'目标'} · ${escape(entryStatus(m,statusNames))}</span></button>${menu(m,`${archived?'已归档':''}${m.kind==='chat'?'对话':'目标'} ${m.title} 的更多操作`,{archived})}</div>`).join(''):`<p class="project-empty">${archived?'没有已归档的记录':'还没有目标或对话'}</p>`}
      </div></section>`;
  }).join('');
}
