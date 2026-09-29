// 端接验收业务规则：纯函数，不读写台账，不依赖 HTTP。

export const ACCEPTANCE_STATUSES = ["待拉脱", "待返工", "合格"];
export const OPEN_STATUSES = new Set(["待拉脱", "待返工"]);
export const PASSED_STATUS = "合格";

// 拉脱判定阈值（毫米）：位移超过 1mm 或滑移量超过 0.3mm 即转待返工，临界值判合格。
export const DISPLACEMENT_LIMIT_MM = 1;
export const SLIP_LIMIT_MM = 0.3;

// 改动这三项会让原拉脱结论失效；改压接工/模具不在此列。
export const SPEC_FIELDS = ["cableDiameter", "terminationType", "ferruleBatch"];
const FIELD_LABELS = {
  position: "索位",
  cableDiameter: "索径",
  terminationType: "端接型式",
  ferruleBatch: "压套批号",
  crimper: "压接工",
  die: "模具号",
  displacement: "位移",
  slip: "滑移量",
  reviewer: "复查人",
};
export const TERMINATION_TYPES = ["铝套压制", "铜套压制", "开口套管压制", "锡浇铸"];

export class DomainError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
    Object.assign(this, extra);
  }
}

function text(value, label, { optional = false } = {}) {
  const t = String(value ?? "").trim();
  if (!t) {
    if (optional) return "";
    throw new DomainError(400, "missing_field", `缺少${label}`);
  }
  return t;
}

function number(value, label, { min = 0, allowZero = true } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || (!allowZero && n === 0)) {
    throw new DomainError(400, "invalid_number", `${label}必须是不小于${min}的数字（毫米）`);
  }
  return n;
}

// 每根索提交：索径、端接型式、压套批号、压接工（模具号仅登记）。
export function normalizeSubmission(input = {}) {
  return {
    position: text(input.position, FIELD_LABELS.position),
    cableDiameter: number(input.cableDiameter, FIELD_LABELS.cableDiameter, { min: 0, allowZero: false }),
    terminationType: text(input.terminationType, FIELD_LABELS.terminationType),
    ferruleBatch: text(input.ferruleBatch, FIELD_LABELS.ferruleBatch),
    crimper: text(input.crimper, FIELD_LABELS.crimper),
    die: text(input.die, FIELD_LABELS.die, { optional: true }),
  };
}

// 同一模型、同一索位存在未结束单时冲突；模具占用不参与互斥判断。
export function findOpenAcceptance(orders, modelKey, position) {
  const pos = String(position).trim();
  return orders.find(o => o.modelKey === modelKey && o.position === pos && OPEN_STATUSES.has(o.status));
}

export function deliveryEligible(orders) {
  return orders.length === 0 || orders.every(o => o.status === PASSED_STATUS);
}

// 拉脱记录：位移、滑移量、复查人；压接工不能复查自己的单。
export function buildPullRecord(order, input = {}) {
  const reviewer = text(input.reviewer, FIELD_LABELS.reviewer);
  if (reviewer === order.crimper) {
    throw new DomainError(403, "self_review_forbidden", "压接工不能复查自己的单，请安排他人复查");
  }
  const displacement = number(input.displacement, FIELD_LABELS.displacement);
  const slip = number(input.slip, FIELD_LABELS.slip);
  const pass = displacement <= DISPLACEMENT_LIMIT_MM && slip <= SLIP_LIMIT_MM;
  return { at: new Date().toISOString(), kind: "拉脱", displacement, slip, reviewer, pass };
}

export function applyPullRecord(order, record) {
  order.history.push(record);
  order.conclusion = { ...record };
  if (record.pass) {
    order.status = PASSED_STATUS;
  } else {
    order.status = "待返工";
    order.reworkCount += 1; // 累计返工次数：复测合格也不清零
  }
  return order;
}

// 修改规格：索径/端接型式/压套批号任一变化，原结论失效并回到待拉脱，返工累计保留。
export function applySpecPatch(order, patch = {}) {
  const allowed = new Set([...SPEC_FIELDS, "crimper", "die"]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new DomainError(400, "unsupported_field", `字段${FIELD_LABELS[key] || key}不可修改`);
  }
  const changed = [];
  for (const key of SPEC_FIELDS) {
    if (patch[key] === undefined) continue;
    let next = patch[key];
    if (key === "cableDiameter") next = number(next, FIELD_LABELS.cableDiameter, { min: 0, allowZero: false });
    else next = text(next, FIELD_LABELS[key]);
    if (String(next) !== String(order[key])) changed.push(key);
    order[key] = next;
  }
  if (patch.crimper !== undefined) order.crimper = text(patch.crimper, FIELD_LABELS.crimper);
  if (patch.die !== undefined) order.die = text(patch.die, FIELD_LABELS.die, { optional: true });

  if (changed.length && order.conclusion) {
    order.history.push({
      at: new Date().toISOString(),
      kind: "结论失效",
      changed,
      labels: changed.map(k => FIELD_LABELS[k]),
      before: { ...order.conclusion },
    });
    order.conclusion = null;
    order.status = "待拉脱";
  }
  return { changed };
}
