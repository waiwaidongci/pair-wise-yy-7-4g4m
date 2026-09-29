// HTTP 入口：规则见 rules.js，台账见 ledger.js，页面见 page.js。
import http from "node:http";
import {
  canDeliver,
  createAcceptance,
  findItem,
  loadDb,
  patchAcceptance,
  recordPull,
  saveDb,
  summarizeItem,
} from "./ledger.js";
import { DomainError } from "./rules.js";
import { page } from "./page.js";

const port = Number(process.env.PORT || 3038);
const statLabels = ["待检查", "校准中", "待复核", "已交付"];

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() { return "MR-" + Date.now(); }
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") return html(res, page());

    if (req.method === "GET" && url.pathname === "/api/items") {
      return send(res, 200, db.items.map(item => summarizeItem(item, db)));
    }

    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const item = {
        id: newId(),
        ...input,
        deliveryEligible: true,
        logs: [{ at: new Date().toISOString(), step: "建档", note: "创建模型" }],
      };
      item.tasks = [];
      db.items.unshift(item);
      await saveDb(db);
      return send(res, 201, summarizeItem(item, db));
    }

    const itemPatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (itemPatch && req.method === "PATCH") {
      const item = findItem(db, itemPatch[1]);
      if (!item) throw new DomainError(404, "item_not_found", "模型不存在");
      const input = await body(req);
      // 有待拉脱/待返工端接单时不得交付，复测全部合格后才恢复交付资格。
      if (input.status === "已交付" && item.status !== "已交付" && !canDeliver(db, item)) {
        throw new DomainError(409, "delivery_blocked", "存在未合格的端接验收单，交付资格挂起");
      }
      Object.assign(item, input);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
      await saveDb(db);
      return send(res, 200, summarizeItem(item, db));
    }

    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const item = findItem(db, log[1]);
      if (!item) throw new DomainError(404, "item_not_found", "模型不存在");
      const input = await body(req);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: input.step || "记录", note: input.note || "" });
      await saveDb(db);
      return send(res, 201, item);
    }

    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = findItem(db, action[1]);
      if (!item) throw new DomainError(404, "item_not_found", "模型不存在");
      const input = await body(req);
      item.logs ||= [];
      item.tasks ||= [];
      item.tasks.push({ id: "T-" + Date.now(), position: input.position, tension: input.tension, status: "待检查", logs: [{ at: new Date().toISOString(), note: input.note || "新增帆索任务" }] });
      item.status = "校准中";
      item.logs.push({ at: new Date().toISOString(), step: "帆索", note: input.position + " · " + input.tension });
      await saveDb(db);
      return send(res, 201, summarizeItem(item, db));
    }

    // 端接验收单：同模型同索位未结束单冲突 → 409（模具占用不参与）。
    const submit = url.pathname.match(/^\/api\/items\/([^/]+)\/acceptances$/);
    if (submit && req.method === "POST") {
      const item = findItem(db, submit[1]);
      if (!item) throw new DomainError(404, "item_not_found", "模型不存在");
      const order = await createAcceptance(db, item, await body(req));
      return send(res, 201, order);
    }

    if (req.method === "GET" && url.pathname === "/api/acceptances") {
      const modelKey = url.searchParams.get("model");
      const list = modelKey ? db.acceptances.filter(a => a.modelKey === modelKey) : db.acceptances;
      return send(res, 200, list);
    }

    const pull = url.pathname.match(/^\/api\/acceptances\/([^/]+)\/pull$/);
    if (pull && req.method === "POST") {
      const order = await recordPull(db, pull[1], await body(req));
      return send(res, 201, order);
    }

    const acceptancePatch = url.pathname.match(/^\/api\/acceptances\/([^/]+)$/);
    if (acceptancePatch && req.method === "PATCH") {
      const order = await patchAcceptance(db, acceptancePatch[1], await body(req));
      return send(res, 200, order);
    }

    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));

    send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof DomainError) {
      return send(res, error.status, { error: error.code, message: error.message, ...error.extra });
    }
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log("古船模型帆索校准 listening on http://localhost:" + port));
