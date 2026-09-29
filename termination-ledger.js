// 端接验收台账：持久化到独立 JSON 文件，承载提交、拉脱、返工、复测、改料失效流程。
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  changedKeyFields,
  checkReviewer,
  deliveryBlockers,
  effectiveConclusion,
  evaluatePullTest,
  findOpenOrder,
  isOpenOrder,
  keyFields,
  ordersForModel,
  terminationStates,
} from "./termination-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgerPath = join(__dirname, "data", "termination-orders.json");

export class RuleError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function loadLedger() {
  if (!existsSync(ledgerPath)) {
    await mkdir(dirname(ledgerPath), { recursive: true });
    await writeFile(ledgerPath, JSON.stringify({ orders: [] }, null, 2));
  }
  return JSON.parse(await readFile(ledgerPath, "utf8"));
}

async function saveLedger(db) {
  await writeFile(ledgerPath, JSON.stringify(db, null, 2));
}

export function newOrderId() {
  return "TO-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function now() {
  return new Date().toISOString();
}

function asMm(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RuleError(400, "invalid_number", { field: label });
  }
  return n;
}

function asNonNegativeMm(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new RuleError(400, "invalid_number", { field: label });
  }
  return n;
}

function required(input, field, label) {
  const value = input[field];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new RuleError(400, "field_required", { field: label });
  }
  return String(value).trim();
}

// 端接单对外视图：带上累计返工次数与当前有效结论
export function summarize(order) {
  return {
    ...order,
    reworkCount: (order.reworks || []).length,
    open: isOpenOrder(order),
    effective: effectiveConclusion(order),
  };
}

// ---- 查询 ----

export async function listOrders(modelCode) {
  const db = await loadLedger();
  const orders = modelCode
    ? db.orders.filter((o) => o.modelCode === modelCode)
    : db.orders;
  return orders.map(summarize);
}

export async function openOrdersFor(model) {
  const db = await loadLedger();
  return ordersForModel(db.orders, model).filter(isOpenOrder);
}

export async function blockersFor(model) {
  const db = await loadLedger();
  return deliveryBlockers(db.orders, model);
}

function findOrder(db, id) {
  const order = db.orders.find((o) => o.id === id);
  if (!order) throw new RuleError(404, "termination_order_not_found");
  return order;
}

// ---- 流程 ----

// 提交端接：每根索提交索径、端接型式、压套批号、压接工。
// 同模型同索位已有未结束单 -> 409（模具/批号占用不检查，可并行压接）
export async function submitOrder(model, input) {
  const db = await loadLedger();
  if (!model) throw new RuleError(404, "item_not_found");
  const position = required(input, "position", "索位");
  const ropeDiameter = asMm(input.ropeDiameter, "索径");
  const terminationType = required(input, "terminationType", "端接型式");
  const ferruleBatch = required(input, "ferruleBatch", "压套批号");
  const crimper = required(input, "crimper", "压接工");

  const conflict = findOpenOrder(db.orders, model, position);
  if (conflict) {
    throw new RuleError(409, "open_order_exists", { existingOrderId: conflict.id });
  }

  const order = {
    id: newOrderId(),
    modelId: model.id,
    modelCode: model.code,
    position,
    ropeDiameter,
    terminationType,
    ferruleBatch,
    crimper,
    status: terminationStates.PENDING,
    createdAt: now(),
    tests: [],
    reworks: [],
    history: [{ at: now(), action: "提交", by: crimper, note: "端接资料提交，等待拉脱" }],
  };
  db.orders.unshift(order);
  await saveLedger(db);
  return summarize(order);
}

// 拉脱（也用于复测）：记录位移、滑移量、复查人；压接工不能复查自己的单。
export async function recordPullTest(orderId, input) {
  const db = await loadLedger();
  const order = findOrder(db, orderId);
  if (order.status === terminationStates.PASSED) {
    throw new RuleError(409, "order_already_closed");
  }
  if (order.status === terminationStates.REWORK) {
    throw new RuleError(409, "rework_required_before_retest");
  }
  const displacementMm = asNonNegativeMm(input.displacementMm, "位移");
  const slipMm = asNonNegativeMm(input.slipMm, "滑移量");
  const reviewer = required(input, "reviewer", "复查人");
  const review = checkReviewer(reviewer, order.crimper);
  if (!review.ok) throw new RuleError(403, review.code);

  const round = order.tests.length + 1;
  const { pass, reasons } = evaluatePullTest(displacementMm, slipMm);
  const wasInvalidated = order.tests.some((t) => t.invalidated);
  order.tests.push({
    round,
    at: now(),
    displacementMm,
    slipMm,
    reviewer,
    result: pass ? "合格" : "不合格",
    recheck: round > 1,
    afterInvalidation: wasInvalidated,
    reasons,
  });
  order.status = pass ? terminationStates.PASSED : terminationStates.REWORK;
  order.history.push({
    at: now(),
    action: pass ? (round > 1 ? "复测通过" : "拉脱通过") : "拉脱不合格",
    by: reviewer,
    note: pass
      ? `位移${displacementMm}mm / 滑移${slipMm}mm，恢复交付资格`
      : `位移${displacementMm}mm / 滑移${slipMm}mm，转待返工：${reasons.join("；")}`,
  });
  await saveLedger(db);
  return summarize(order);
}

// 返工登记：返工处理（可顺手更新资料），完成后回到待拉脱做复测；旧结论保留在卡片并标记“已被返工取代”。
export async function recordRework(orderId, input = {}) {
  const db = await loadLedger();
  const order = findOrder(db, orderId);
  if (order.status !== terminationStates.REWORK) {
    throw new RuleError(409, "order_not_in_rework");
  }
  const lastTest = order.tests.at(-1);
  if (lastTest) lastTest.superseded = true;

  const reworker = input.reworker ? String(input.reworker).trim() : order.crimper;
  const patch = {};
  for (const [field] of keyFields) {
    if (input[field] !== undefined && String(input[field]).trim() !== "") {
      patch[field] = field === "ropeDiameter"
        ? asMm(input[field], "索径")
        : String(input[field]).trim();
    }
  }
  if (input.crimper && String(input.crimper).trim()) patch.crimper = String(input.crimper).trim();
  Object.assign(order, patch);

  const count = order.reworks.length + 1;
  order.reworks.push({
    no: count,
    at: now(),
    by: String(reworker).trim() || order.crimper,
    note: input.note ? String(input.note).trim() : "返工完成，等待复测",
    changed: Object.keys(patch),
  });
  order.status = terminationStates.PENDING;
  order.history.push({
    at: now(),
    action: `返工第${count}次`,
    by: order.reworks.at(-1).by,
    note: order.reworks.at(-1).note + (Object.keys(patch).length ? `；资料更新：${Object.keys(patch).map((k) => keyFields.find(([f]) => f === k)?.[1] || (k === "crimper" ? "压接工" : k)).join("、")}` : ""),
  });
  await saveLedger(db);
  return summarize(order);
}

// 改索径 / 端接型式 / 压套批号 -> 原结论失效，需重新拉脱；通过后才恢复交付资格。
export async function updateOrder(orderId, input) {
  const db = await loadLedger();
  const order = findOrder(db, orderId);
  const patch = {};
  for (const [field, label] of keyFields) {
    if (input[field] !== undefined) {
      patch[field] = field === "ropeDiameter" ? asMm(input[field], label) : required(input, field, label);
    }
  }
  if (input.crimper !== undefined) patch.crimper = required(input, "crimper", "压接工");
  if (Object.keys(patch).length === 0) throw new RuleError(400, "no_editable_field");

  const changed = changedKeyFields(order, patch);
  Object.assign(order, patch);

  if (changed.length) {
    const lastTest = order.tests.at(-1);
    if (lastTest && !lastTest.invalidated && !lastTest.superseded) {
      lastTest.invalidated = true;
      lastTest.invalidReason = changed.map((c) => c.label).join("、") + "变更";
    }
    order.status = terminationStates.PENDING;
    order.history.push({
      at: now(),
      action: "资料变更",
      by: order.crimper,
      note: `${changed.map((c) => c.label).join("、")}变更，原拉脱结论失效，需重新拉脱`,
    });
  } else {
    order.history.push({ at: now(), action: "资料更新", by: order.crimper, note: "非关键项更新，结论保持有效" });
  }
  await saveLedger(db);
  return summarize(order);
}
