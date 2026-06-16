// boulder-planner.test.mjs — Phase 4 Boulder planner integration tests
//
// Covers:
//   4.1 createBoulderPlan — 從 goal + steps 建立 plan + tasks
//   4.2 completeBoulderTask — 完成 task + 自動存 checkpoint
//   4.3 跨 session 續命流程 — plan → complete → resume → verify
//
// Run: node --test tests/boulder-planner.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryDB, getMemoryDB, resetMemoryDB } from '../src/lib/memory-db.mjs';

// We import the module functions directly — they call getMemoryDB()
// internally.  For test isolation we use a temp DB path.
const TMP = resolve(process.cwd(), '.test-boulder-planner-' + Date.now());
const DB_PATH = resolve(TMP, 'boulder-planner-test.db');

// Override SMART_MEMORY_PATH so getMemoryDB() uses our test DB
process.env.SMART_MEMORY_PATH = DB_PATH;

// Import module functions AFTER setting env var
const { createBoulderPlan, completeBoulderTask, planAndExecute } =
  await import('../src/agent/core/planner-integration.mjs');

describe('Phase 4.1 — createBoulderPlan()', () => {
  before(() => {
    mkdirSync(TMP, { recursive: true });
    resetMemoryDB();
    // Prime the singleton with test DB
    getMemoryDB(DB_PATH);
  });

  after(() => {
    try { resetMemoryDB(); } catch { /* ok */ }
    rmSync(TMP, { recursive: true, force: true });
  });

  it('從 goal + string steps 建立 plan + tasks', () => {
    const result = createBoulderPlan('重構登入模組', [
      '分析現有程式碼',
      '設計新架構',
      '實作核心邏輯',
      '撰寫測試',
    ]);

    assert.ok(result.plan);
    assert.equal(result.plan.name, '重構登入模組');
    assert.equal(result.plan.total_tasks, 4);
    assert.equal(result.plan.completed_tasks, 0);
    assert.ok(result.boulderPlanId);

    assert.equal(result.tasks.length, 4);
    assert.equal(result.tasks[0].name, '分析現有程式碼');
    assert.equal(result.tasks[1].name, '設計新架構');
    assert.equal(result.tasks[2].name, '實作核心邏輯');
    assert.equal(result.tasks[3].name, '撰寫測試');
    assert.equal(result.tasks[0].sort_order, 0);
    assert.equal(result.tasks[3].sort_order, 3);
  });

  it('接受 object steps（含 name + description）', () => {
    const result = createBoulderPlan('整合 API', [
      { name: '設計 endpoint', description: '設計 REST API 規格' },
      { name: '實作 handler', description: '撰寫 route handler' },
    ], { description: '第三方 API 整合' });

    assert.equal(result.plan.description, '第三方 API 整合');
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0].name, '設計 endpoint');
    assert.equal(result.tasks[1].name, '實作 handler');
  });

  it('空 steps 建立只有 plan 無 task', () => {
    const result = createBoulderPlan('空計畫');

    assert.ok(result.plan);
    assert.equal(result.tasks.length, 0);
    assert.equal(result.plan.total_tasks, 0);
  });
});

describe('Phase 4.2 — completeBoulderTask()', () => {
  let planId;
  let taskIds;

  before(() => {
    mkdirSync(TMP, { recursive: true });
    resetMemoryDB();
    getMemoryDB(DB_PATH);

    // 建立測試資料
    const result = createBoulderPlan('測試完成 task', [
      '第一步',
      '第二步',
      '第三步',
    ]);
    planId = result.boulderPlanId;
    taskIds = result.tasks.map(t => t.id);
  });

  after(() => {
    try { resetMemoryDB(); } catch { /* ok */ }
    rmSync(TMP, { recursive: true, force: true });
  });

  it('完成 task 並自動存 checkpoint', () => {
    const { task, checkpoint } = completeBoulderTask(taskIds[0], {
      result: '完成了第一步的分析',
      filesChanged: ['src/step1.mjs', 'src/utils.mjs'],
      decisions: ['決定使用模組化架構'],
      nextIntent: '開始第二步',
    });

    assert.equal(task.status, 'completed');
    assert.ok(task.completed_at);
    assert.equal(task.result, '完成了第一步的分析');

    // 驗證 checkpoint
    assert.ok(checkpoint);
    assert.equal(checkpoint.plan_id, planId);
    assert.equal(checkpoint.task_id, taskIds[0]);
    assert.ok(checkpoint.context_summary.includes('完成了第一步的分析'));
    assert.ok(checkpoint.files_changed.includes('src/step1.mjs'));
    assert.ok(checkpoint.decisions.includes('模組化架構'));
    assert.equal(checkpoint.next_intent, '開始第二步');
  });

  it('task 完成後 plan progress 自動更新', () => {
    const db = getMemoryDB();
    const plan = db.getPlan(planId);
    assert.equal(plan.completed_tasks, 1);
  });

  it('完成多個 task 累積 checkpoint', () => {
    completeBoulderTask(taskIds[1], {
      result: '第二步完成',
      filesChanged: ['src/step2.mjs'],
      nextIntent: '開始第三步',
    });

    const db = getMemoryDB();
    const checkpoints = db.listCheckpoints(planId);
    assert.equal(checkpoints.length, 2);

    // 兩個 checkpoint 都存在（created_at 為秒級精度，不假定順序）
    const taskIdsInCheckpoints = checkpoints.map(c => c.task_id);
    assert.ok(taskIdsInCheckpoints.includes(taskIds[0]));
    assert.ok(taskIdsInCheckpoints.includes(taskIds[1]));

    // plan progress 累積
    const plan = db.getPlan(planId);
    assert.equal(plan.completed_tasks, 2);
  });

  it('不存在的 task 拋錯', () => {
    assert.throws(() => {
      completeBoulderTask('nonexistent_task_id');
    }, /Boulder task not found/);
  });
});

describe('Phase 4.3 — 跨 session 續命流程', () => {
  let planId;
  let taskIds;

  before(() => {
    mkdirSync(TMP, { recursive: true });
    resetMemoryDB();
    getMemoryDB(DB_PATH);

    // 模擬「第一次 session」：建立 plan + 完成部分 task
    const result = createBoulderPlan('大型功能開發', [
      '需求分析',
      '設計規格',
      '前端實作',
      '後端實作',
      '整合測試',
      '部署上線',
    ]);
    planId = result.boulderPlanId;
    taskIds = result.tasks.map(t => t.id);
  });

  after(() => {
    try { resetMemoryDB(); } catch { /* ok */ }
    rmSync(TMP, { recursive: true, force: true });
  });

  it('Session A：完成前 2 個 task，第 3 個 in_progress', () => {
    // 完成 task 1 + 2
    completeBoulderTask(taskIds[0], {
      result: '需求訪談完成',
      decisions: ['確認 MVP 範圍'],
      nextIntent: '開始設計規格',
    });
    completeBoulderTask(taskIds[1], {
      result: 'API 規格完成',
      filesChanged: ['docs/api.md'],
      nextIntent: '開始前端實作',
    });

    // 設定第 3 個 task 為 in_progress
    const db = getMemoryDB();
    db.updateTask(taskIds[2], { status: 'in_progress' });
    db.updatePlan(planId, { current_task_id: taskIds[2] });

    // 存一個 checkpoint 表示目前狀態
    db.saveCheckpoint(planId, {
      taskId: taskIds[2],
      contextSummary: '前端實作進行中',
      filesChanged: JSON.stringify(['src/frontend/']),
      nextIntent: '繼續前端開發',
    });

    const plan = db.getPlan(planId);
    assert.equal(plan.completed_tasks, 2);
    assert.equal(plan.current_task_id, taskIds[2]);
  });

  it('Session B（模擬續命）：getContinuationContext 正確組裝進度', () => {
    // 模擬新 session 啟動：getActivePlan → getContinuationContext
    const db = getMemoryDB();
    const activePlan = db.getActivePlan();
    assert.ok(activePlan);
    assert.equal(activePlan.id, planId);

    const ctx = db.getContinuationContext(planId);
    assert.ok(ctx);
    assert.equal(ctx.plan.name, '大型功能開發');
    assert.equal(ctx.progress, '2/6');
    assert.ok(ctx.currentTask);
    assert.equal(ctx.currentTask.name, '前端實作');
    assert.equal(ctx.currentTask.status, 'in_progress');

    // continuation context 一定包含 checkpoint
    // （created_at 為秒級精度，同秒內可能有多個 checkpoint — 不假定特定順序）
    assert.ok(ctx.checkpoint);
    assert.ok(ctx.checkpoint.task_id); // 一定有 task_id
    assert.ok(ctx.checkpoint.next_intent); // 一定有 next_intent
  });

  it('Session B：繼續完成剩餘 task', () => {
    const db = getMemoryDB();
    const ctx = db.getContinuationContext(planId);

    // 從中斷處繼續：完成目前的 task
    completeBoulderTask(ctx.currentTask.id, {
      result: '前端 UI 完成',
      filesChanged: ['src/frontend/app.tsx', 'src/frontend/styles.css'],
      decisions: ['選用 TailwindCSS'],
      nextIntent: '開始後端實作',
    });

    // 完成後端
    completeBoulderTask(taskIds[3], {
      result: '後端 API 完成',
      filesChanged: ['src/backend/routes.ts'],
      nextIntent: '開始整合測試',
    });

    // 完成整合測試
    completeBoulderTask(taskIds[4], {
      result: '所有測試通過',
      nextIntent: '準備部署',
    });

    // 完成部署
    const lastTask = completeBoulderTask(taskIds[5], {
      result: '部署到 production 完成',
      filesChanged: ['deploy/k8s.yaml'],
      decisions: ['使用 blue-green 部署'],
      nextIntent: '上線完成',
    });

    // 全部完成
    const plan = db.getPlan(planId);
    assert.equal(plan.completed_tasks, 6);

    // 標記 plan 完成
    db.completePlan(planId);
    const done = db.getPlan(planId);
    assert.equal(done.status, 'completed');
    assert.ok(done.completed_at);
  });

  it('plan 完成後 getActivePlan 回傳 null（無 active plan）', () => {
    const db = getMemoryDB();
    const active = db.getActivePlan();
    assert.equal(active, null);
  });

  it('完整的 checkpoint 歷史可回溯', () => {
    const db = getMemoryDB();
    const checkpoints = db.listCheckpoints(planId, 20);

    // 至少 5 個 checkpoint：2 完成 + 1 in_progress checkpoint + 3 完成
    assert.ok(checkpoints.length >= 5);

    // 所有 task 都有對應的 checkpoint
    const taskIdsInCheckpoints = checkpoints.map(c => c.task_id);
    for (const tid of taskIds.slice(0, 6)) {
      assert.ok(taskIdsInCheckpoints.includes(tid),
        `Task ${tid} should have a checkpoint`);
    }

    // 最後一個 task 的 checkpoint 內容正確（找 taskIds[5] 的 checkpoint）
    const deployCheckpoint = checkpoints.find(c => c.task_id === taskIds[5]);
    assert.ok(deployCheckpoint);
    assert.equal(deployCheckpoint.next_intent, '上線完成');
    assert.ok(deployCheckpoint.files_changed.includes('deploy/k8s.yaml'));
  });
});

describe('planAndExecute 向後相容', () => {
  // DB 重設後需重新初始化
  before(() => {
    mkdirSync(TMP, { recursive: true });
    resetMemoryDB();
    getMemoryDB(DB_PATH);
  });

  after(() => {
    try { resetMemoryDB(); } catch { /* ok */ }
    rmSync(TMP, { recursive: true, force: true });
  });

  it('planAndExecute 回傳格式不變', () => {
    const result = planAndExecute('test goal', { steps: 3 });
    assert.ok(result.command);
    assert.ok(result.planId);
    assert.ok(result.estimatedComplexity);
    assert.equal(result.goal, 'test goal');
  });

  it('createBoulderPlan 不影響 planAndExecute', () => {
    // 兩個函式應獨立運作
    const planResult = planAndExecute('獨立目標');
    assert.ok(planResult.command);

    const boulderResult = createBoulderPlan('Boulder 目標', ['step1']);
    assert.ok(boulderResult.boulderPlanId);
    assert.notEqual(planResult.planId, boulderResult.boulderPlanId);
  });
});
