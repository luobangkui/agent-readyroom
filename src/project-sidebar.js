import {canArchive} from './mission-archive.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function entryStatus(entry,statusNames){return entry.archivedAt?'已归档':entry.kind==='chat'&&entry.status==='completed'?'待续聊':entry.accepted?'已验收':statusNames[entry.status]||entry.status;}
export function projectSidebar(projects,missions,{selectedProjectId,selectedId,collapsed,statusNames,archived=false}){
  if(!projects.length)return '<div class="rail-empty">选择一个本地目录，<br>开始你的第一个项目。</div>';
  return projects.map(project=>{
    const entries=missions.filter(m=>m.projectId===project.id&&!!m.archivedAt===archived),open=!collapsed.has(project.id),active=project.id===selectedProjectId;
    return `<section class="project-group ${active?'selected-project':''}">
      <div class="project-heading"><button class="project-toggle" data-toggle-project="${escape(project.id)}" aria-label="${open?'收起':'展开'}项目 ${escape(project.name)}" aria-expanded="${open}" aria-controls="children-${escape(project.id)}">${open?'▾':'▸'}</button><button class="project-select" data-project="${escape(project.id)}" aria-current="${active?'true':'false'}" title="${escape(project.cwd)}"><span>▱</span><strong>${escape(project.name)}</strong><small>${entries.length}</small></button></div>
      <div class="project-children" id="children-${escape(project.id)}" ${open?'':'hidden'}>
        <div class="project-actions"><button data-new-goal="${escape(project.id)}" aria-label="在 ${escape(project.name)} 新建目标">＋ 目标</button><button data-new-chat="${escape(project.id)}" aria-label="在 ${escape(project.name)} 新建对话">＋ 对话</button></div>
        ${entries.length?entries.map(m=>`<div class="mission-row"><button class="mission-entry ${m.id===selectedId?'active':''}" data-mission="${escape(m.id)}" aria-current="${m.id===selectedId?'page':'false'}" title="${escape(m.title)}"><strong><span class="entry-kind">${m.kind==='chat'?'◌':'◎'}</span>${escape(m.title)}</strong><span>${m.kind==='chat'?'对话':'目标'} · ${escape(entryStatus(m,statusNames))}</span></button><button class="mission-archive" data-${archived?'restore':'archive'}="${escape(m.id)}" aria-label="${archived?'恢复':'归档'} ${escape(m.title)}" title="${archived?'恢复到当前列表':canArchive(m)?'归档，保留对话和文件':'请先停止执行再归档'}" ${!archived&&!canArchive(m)?'disabled':''}>${archived?'恢复':'归档'}</button></div>`).join(''):`<p class="project-empty">${archived?'没有已归档的记录':'还没有目标或对话'}</p>`}
      </div></section>`;
  }).join('');
}
