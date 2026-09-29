// 钢丝索端接验收业务规则：只做判定，不碰存取，方便单独核对。

export const terminationStates = {
  PENDING: "待拉脱", // 已提交，等待拉脱（含复测）
  REWORK: "待返工", // 拉脱不合格，返工后再复测
  PASSED: "合格", // 拉脱通过，端接单结束
};

// 拉脱判定阈值：位移超过 1mm，或滑移量超过 0.3mm，即转待返工（“超过”为严格大于）
export const pullLimits = { displacementMm: 1, slipMm: 0.3 };

// 改动这三项会让原拉脱结论失效
export const keyFields = [
  ["ropeDiameter", "索径"],
  ["terminationType", "端接型式"],
  ["ferruleBatch", "压套批号"],
];

export function isOpenOrder(order) {
  return order.status !== terminationStates.PASSED;
}

export function isSameModel(order, model) {
  return Boolean(
    (model.id && order.modelId === model.id) ||
      (model.code && order.modelCode === model.code),
  );
}

export function ordersForModel(orders, model) {
  return (orders || []).filter((o) => isSameModel(o, model));
}

// 同模型同索位存在未结束单时，新提交不允许（压接模具/压套批号可并行占用，不在此限制）
export function findOpenOrder(orders, model, position) {
  const pos = String(position || "").trim();
  return ordersForModel(orders, model).find(
    (o) => String(o.position).trim() === pos && isOpenOrder(o),
  );
}

// 交付资格：该模型不存在未结束端接单时才具备；复测通过后自然恢复
export function deliveryBlockers(orders, model) {
  return ordersForModel(orders, model).filter(isOpenOrder);
}

export function evaluatePullTest(displacementMm, slipMm) {
  const reasons = [];
  if (displacementMm > pullLimits.displacementMm) {
    reasons.push(`位移${displacementMm}mm超过${pullLimits.displacementMm}mm`);
  }
  if (slipMm > pullLimits.slipMm) {
    reasons.push(`滑移量${slipMm}mm超过${pullLimits.slipMm}mm`);
  }
  return { pass: reasons.length === 0, reasons };
}

// 复查人校验：必填且不能是本单压接工
export function checkReviewer(reviewer, crimper) {
  if (!reviewer) return { ok: false, error: "reviewer_required" };
  if (reviewer === crimper) return { ok: false, error: "self_review_forbidden" };
  return { ok: true };
}

function sameValue(field, a, b) {
  if (field === "ropeDiameter") return Number(a) === Number(b);
  return String(a).trim() === String(b).trim();
}

// 对比提交资料中被改动的关键项（索径/端接型式/压套批号）
export function changedKeyFields(order, patch) {
  const changed = [];
  for (const [field, label] of keyFields) {
    if (patch[field] !== undefined && !sameValue(field, order[field], patch[field])) {
      changed.push({ field, label });
    }
  }
  return changed;
}

// 最近一条仍然有效的结论（未被返工取代、未因改料失效）
export function effectiveConclusion(order) {
  const last = (order.tests || []).at(-1);
  if (!last || last.superseded || last.invalidated) return null;
  return last;
}
