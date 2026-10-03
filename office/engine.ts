/** Mesh adapter over the complete upstream HiveManager coordination component. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HiveManager } from '../vendor/munder-difflin/src/main/hive';
import { CircuitBreaker } from '../vendor/munder-difflin/src/main/breaker';
import { ControlRegistry } from '../vendor/munder-difflin/src/main/control';

const body = JSON.parse(readFileSync(0, 'utf8'));
const home = body.home;
if (typeof home !== 'string' || !isAbsolute(home)) throw Error('office_path_invalid');
const hive = new HiveManager(() => home);
const controls = new ControlRegistry();
hive.ensureHive();
const settingsPath = join(home, 'mesh-office.json');
let settings: any;
try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
catch { settings = { paused: false, maxIterations: 8, events: [], goals: {} }; }
const save = () => writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 });
const roster = () => Object.values(hive.registry().agents).filter((a: any) => !a.archived);
const agent = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !hive.registry().agents[id] || hive.registry().agents[id].archived) throw Error('office_agent_not_found');
  return hive.registry().agents[id];
};
const log = (event: any) => hive.appendLog({ ...event, ts: new Date().toISOString() });
async function hire(name: string, role: string, goal: string, god = false) {
  if (roster().length >= 12) throw Error('office_capacity');
  if (roster().some((a: any) => a.role === role)) throw Error('office_role_already_exists');
  const id = god ? 'orchestrator' : 'worker-' + randomUUID().replaceAll('-', '').slice(0, 12);
  await hive.ensureAgent({ id, name, role, provider: 'mesh' as any, cwd: home, isGod: god }, { semanticMemory: false, knowledgeGraph: false, mcpDefaults: {} });
  settings.goals[id] = goal;
  save();
  return id;
}
if (!hive.registry().godId) await hire('Director', 'Orchestrator', 'Delegate, coordinate dependencies and deliver the owner’s mission.', true);
const args = body.args || {};
let result: any = {};
switch (body.operation) {
  case 'snapshot': break;
  case 'hire': {
    const id = await hire(args.name, args.role, args.goal);
    result = { id };
    break;
  }
  case 'archive': {
    agent(args.id);
    if (hive.isGod(args.id)) throw Error('director_required');
    if ((hive.tasks() as any).tasks.some((t: any) => t.assignee === args.id && t.status !== 'done')) throw Error('agent_has_open_tasks');
    hive.setArchived(args.id, true);
    break;
  }
  case 'task.create': {
    if ((hive.tasks() as any).tasks.filter((t: any) => t.status !== 'done').length >= 100) throw Error('task_capacity');
    if (args.assignee) agent(args.assignee);
    const tasks = (hive.tasks() as any).tasks;
    if (args.dependsOn.some((id: string) => !tasks.some((t: any) => t.id === id))) throw Error('dependency_not_found');
    const id = 'task-' + randomUUID().replaceAll('-', '').slice(0, 12);
    hive.addTask({ id, title: args.title, description: args.description, assignee: args.assignee || 'orchestrator',
      status: args.needsApproval ? 'blocked' : 'todo', dependsOn: args.dependsOn, priority: 1,
      createdAt: new Date().toISOString(), ...(args.needsApproval ? {humanQA: [{q: 'Approve this mission before execution?', askedAt: new Date().toISOString()}]} : {}) });
    hive.send({ to: args.assignee || 'god', act: 'request', subject: args.title, body: args.description || args.title }, 'owner');
    result = { id };
    break;
  }
  case 'task.priority': {
    const task=hive.tasks().tasks.find(t=>t.id===args.id);
    if(!task || task.status!=='todo')throw Error('task_not_ready');
    hive.patchTask(args.id,{priority:args.priority});log({kind:'task.priority',taskId:args.id,priority:args.priority});result={saved:true};break;
  }
  case 'task.approve': {
    const task = (hive.tasks() as any).tasks.find((t: any) => t.id === args.id);
    if (!task || task.status !== 'blocked') throw Error('approval_not_pending');
    hive.patchTask(args.id, {status: 'todo', humanQA: [...(task.humanQA || []).map((qa: any) => qa.a ? qa : {...qa, a: args.answer, answeredAt: new Date().toISOString()})]});
    log({kind: 'approval', taskId: args.id, decision: 'approved'});
    break;
  }
  case 'message': {
    agent(args.to);
    result = hive.send({ to: args.to, subject: 'Owner message', body: args.text, act: 'inform' }, 'owner');
    break;
  }
  case 'pause':
    controls.pause('office', args.paused);
    settings.paused = controls.snapshot('office').paused;
    log({kind: 'office.pause', paused: settings.paused}); save(); break;
  case 'settings':
    settings.maxIterations = args.maxIterations; save(); break;
  case 'memory':
    agent(args.id); result = {text: hive.memory(args.id)}; break;
  case 'memory.save':
    agent(args.id);
    writeFileSync(join(hive.root()!, 'agents', args.id, 'memory.md'), args.text, {mode: 0o600});
    hive.commit('mesh: reviewed office memory'); break;
  case 'begin': {
    if (settings.paused) throw Error('office_paused');
    const tasks = (hive.tasks() as any).tasks;
    const task = tasks.find((t: any) => t.id === args.id);
    if (!task || task.status !== 'todo' || task.dependsOn.some((id: string) => !tasks.some((t: any) => t.id === id && t.status === 'done'))) throw Error('task_not_ready');
    hive.patchTask(args.id, {status: 'doing'});
    log({kind: 'mission.start', taskId: args.id});
    result = {task, agents: roster().map((a: any) => ({id: a.id, name: a.name, role: a.role, goal: settings.goals[a.id],
      memory: hive.memory(a.id).slice(-4000), messages: hive.inbox(a.id).slice(-8).map(m => m.body).join('\n').slice(-4000)})), maxIterations: settings.maxIterations};
    break;
  }
  case 'event': {
    if (args.agentId) agent(args.agentId);
    log({kind: args.kind, agentId: args.agentId, taskId: args.taskId, summary: args.summary?.slice(0, 1000)});
    if (args.to && args.agentId) {
      agent(args.to);
      hive.send({to: args.to, subject: 'Delegation', body: args.summary || 'Task delegated', act: 'request'}, args.agentId);
    }
    break;
  }
  case 'finish': {
    const task = (hive.tasks() as any).tasks.find((t: any) => t.id === args.id);
    if (!task || task.status !== 'doing') throw Error('task_not_running');
    hive.patchTask(args.id, {status: args.ok ? 'done' : 'blocked', result: args.result?.slice(0, 6000),
      ...(!args.ok ? {humanQA: [{q: 'Mission stopped. Review the failure and approve a retry.', askedAt: new Date().toISOString()}]} : {})});
    hive.send({to: 'god', act: args.ok ? 'done' : 'refuse', subject: task.title, body: args.result || 'Mission stopped'}, 'system');
    log({kind: 'mission.finish', taskId: args.id, ok: args.ok}); break;
  }
  default: throw Error('unknown_office_operation');
}
const events: any[] = hive.logTail(80) as any[];
const breaker = new CircuitBreaker(() => ({enabled: true, hardStop: true, errorStormLimit: 5}));
for (const event of events.filter(e => Date.now() - (typeof e.ts === 'number' ? e.ts : Date.parse(e.ts || '')) < 60000)) {
  if (event.kind === 'agent.error' && event.agentId) breaker.recordError(event.agentId);
}
const decisions = breaker.tick(roster().map((a: any) => ({agentId: a.id, sample: null, progressing: true})));
if (decisions.some(d => d.action === 'stop')) { settings.paused = true; save(); }
const snapshot = {agents: roster().map((a: any) => ({id: a.id, name: a.name, role: a.role, goal: settings.goals[a.id], isDirector: a.isGod,
    state: settings.paused ? 'paused' : events.slice().reverse().find(e => e.agentId === a.id && ['agent.start', 'agent.complete', 'agent.error'].includes(e.kind))?.kind === 'agent.start' ? 'working' : 'idle',
    pendingMessages: hive.inboxBacklog(a.id), breaker: breaker.levelFor(a.id)})),
  tasks: (hive.tasks() as any).tasks, messages: hive.voiceMessages({limit: 30}), events, paused: settings.paused, maxIterations: settings.maxIterations,
  components: {coordination: 'Munder Difflin HiveManager', execution: 'CrewAI hierarchical crews'}};
process.stdout.write(JSON.stringify({ok: true, result, snapshot}) + '\n');
