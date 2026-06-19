import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMemoryDB, resetMemoryDB } from '../src/lib/memory-db.mjs';
import { createBoulderPlan, completeBoulderTask } from '../src/agent/core/planner-integration.mjs';

const TMP = resolve(process.cwd(), '.test-debug-data-' + Date.now());
const DB_PATH = resolve(TMP, 'debug.db');
process.env.SMART_MEMORY_PATH = DB_PATH;

mkdirSync(TMP, { recursive: true });
resetMemoryDB();
getMemoryDB(DB_PATH);

const result = createBoulderPlan('大型功能開發', [
  '需求分析', '設計規格', '前端實作', '後端實作', '整合測試', '部署上線',
]);
const planId = result.boulderPlanId;
const taskIds = result.tasks.map(t => t.id);
console.log('taskIds:', taskIds);

completeBoulderTask(taskIds[0], { result: 'done0', nextIntent: '開始設計規格' });
completeBoulderTask(taskIds[1], { result: 'done1', nextIntent: '開始前端實作' });

const db = getMemoryDB();
db.updateTask(taskIds[2], { status: 'in_progress' });
db.updatePlan(planId, { current_task_id: taskIds[2] });
db.saveCheckpoint(planId, { taskId: taskIds[2], contextSummary: '進行中', nextIntent: '繼續前端開發' });

const ctx = db.getContinuationContext(planId);
console.log('Current task ID from ctx:', ctx.currentTask?.id);
console.log('taskIds[2]:', taskIds[2]);

completeBoulderTask(taskIds[2], { result: 'done2', nextIntent: '開始後端' });
completeBoulderTask(taskIds[3], { result: 'done3', nextIntent: '開始整合' });
completeBoulderTask(taskIds[4], { result: 'done4', nextIntent: '準備部署' });
completeBoulderTask(taskIds[5], { result: 'done5', filesChanged: ['deploy/k8s.yaml'], decisions: ['blue-green'] });

const allCkpts = db.listCheckpoints(planId, 20);
console.log('\nAll checkpoints:');
allCkpts.forEach((c, i) => console.log(`  [${i}] task_id="${c.task_id}" next_intent="${c.next_intent}"`));

console.log('\ntaskIds[5]:', taskIds[5]);
const found = allCkpts.find(c => c.task_id === taskIds[5]);
console.log('Found:', found ? `YES (id=${found.id})` : 'NULL!');

rmSync(TMP, { recursive: true, force: true });
resetMemoryDB();
