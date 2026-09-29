// 台账：JSON 文件持久化，端接验收单的增改与查询都落在这里。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPullRecord,
  applySpecPatch,
  buildPullRecord,
  deliveryEligible,
  findOpenAcceptance,
  normalizeSubmission,
  OPEN_STATUSES,
  PASSED_STATUS,
  DomainError,
} from "./rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "model-rigging-calibration.json");

const seed = {
  items: [
    {
      code: "MR-001",
      shipType: "福船",
      scale: "1:48",
      mastCount: 3,
      riggingMaterial: "蜡线",
      owner: "周宁",
      dueDate: "2026-06-28",
      status: "校准中",
      deliveryEligible: true,
      tasks: [
        { id: "T-1", position: "前桅侧支索", tension: "偏松", status: "调整中", logs: [{ at: "2026-06-12", note: "已缩短2mm" }] },
      ],
      logs: [],
    },
  ],
  acceptances: [],
};

let cache = null;

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    cache = structuredClone(seed);
    return cache;
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.acceptances ||= [];
  for (const item of db.items) item.deliveryEligible = item.deliveryEligible !== false;
  cache = db;
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
  cache = db;
}

export function findItem(db, idOrCode) {
  return db.items.find(x => x.id === idOrCode || x.code === idOrCode) || null;
}

export function findAcceptance(db, id) {
  return db.acceptances.find(a => a.id === id) || null;
}

export function ordersOf(db, modelKey) {
  return db.acceptances.filter(a => a.modelKey === modelKey);
}

export function summarizeItem(item, db) {
  const orders = ordersOf(db, itemKey(item));
  const logCount =
    (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return {
    ...item,
    logCount,
    acceptanceCount: orders.length,
    reworkTotal: orders.reduce((n, o) => n + (o.reworkCount || 0), 0),
  };
}

export function itemKey(item) {
  return item.code || item.id;
}

// 提交端接验收单（同模型同索位有未结束单 → 409；模具占用不影响）。
export async function createAcceptance(db, item, input) {
  const spec = normalizeSubmission(input);
  const key = itemKey(item);
  const clash = findOpenAcceptance(db.acceptances, key, spec.position);
  if (clash) {
    throw new DomainError(409, "open_acceptance_exists", "该模型此索位已有未结束的端接验收单", {
      position: spec.position,
      existingId: clash.id,
      existingStatus: clash.status,
    });
  }
  const now = new Date().toISOString();
  const order = {
    id: "EJ-" + Date.now(),
    modelKey: key,
    modelCode: item.code || item.id,
    ...spec,
    status: "待拉脱",
    conclusion: null,
    reworkCount: 0,
    createdAt: now,
    history: [{ at: now, kind: "提交", note: "新钢丝索端接验收单" }],
  };
  db.acceptances.unshift(order);
  await recomputeEligibility(db, item, now, "提交端接单：" + order.position);
  await saveDb(db);
  return order;
}

// 记录拉脱试验；失败转待返工，合格恢复交付资格。
export async function recordPull(db, id, input) {
  const order = findAcceptance(db, id);
  if (!order) throw new DomainError(404, "acceptance_not_found", "端接验收单不存在");
  if (order.status === PASSED_STATUS) {
    throw new DomainError(409, "already_passed", "该单已合格，不能重复记录拉脱");
  }
  const record = buildPullRecord(order, input);
  applyPullRecord(order, record);
  const item = findItem(db, order.modelKey);
  const note = record.pass
    ? `拉脱合格：${order.position}（${record.displacement}mm/${record.slip}mm）`
    : `拉脱不合格转待返工：${order.position}（位移${record.displacement}mm，滑移${record.slip}mm）`;
  if (item) await recomputeEligibility(db, item, record.at, note);
  await saveDb(db);
  return order;
}

// 修改规格/压接信息；索径、端接型式、压套批号变化使原结论失效。
export async function patchAcceptance(db, id, patch) {
  const order = findAcceptance(db, id);
  if (!order) throw new DomainError(404, "acceptance_not_found", "端接验收单不存在");
  const { changed } = applySpecPatch(order, patch);
  const now = new Date().toISOString();
  if (changed.length) {
    order.history.push({ at: now, kind: "改规格", labels: changed });
    const item = findItem(db, order.modelKey);
    if (item) await recomputeEligibility(db, item, now, "规格变更致结论失效：" + order.position);
  }
  await saveDb(db);
  return order;
}

// 交付资格：该模型所有端接单均合格才可交付（待拉脱/待返工均挂起）。
async function recomputeEligibility(db, item, at, note) {
  const before = item.deliveryEligible !== false;
  const orders = ordersOf(db, itemKey(item));
  const after = deliveryEligible(orders);
  item.deliveryEligible = after;
  item.logs ||= [];
  if (before !== after || orders.some(o => OPEN_STATUSES.has(o.status))) {
    item.logs.push({
      at,
      step: "交付资格",
      note: `${note} → ${after ? "可交付" : "挂起交付"}`,
    });
  }
}

export function canDeliver(db, item) {
  return deliveryEligible(ordersOf(db, itemKey(item)));
}
