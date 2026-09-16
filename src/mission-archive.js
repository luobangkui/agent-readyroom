const terminal=new Set(['idle','completed','failed','stopped','interrupted','needs_attention']);
export const canArchive=mission=>terminal.has(mission.status)&&!(mission.agents||[]).some(agent=>agent.turnId||!terminal.has(agent.status))&&!(mission.requests||[]).some(request=>request.status==='pending');
