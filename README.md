# 古船模型帆索校准

运行：

```bash
npm start
```

访问 `http://localhost:3038`。模型校准数据保存在 `data/model-rigging-calibration.json`。

## 钢丝索端接验收

首页点击「钢丝索端接验收」进入（路由 `/terminations`），端接单数据独立保存在 `data/termination-orders.json`。

代码按职责拆为三个文件：

- `termination-rules.js`：验收规则（拉脱阈值、未结束单判定、自复查校验、关键项变更失效、交付资格）。
- `termination-ledger.js`：端接台账的持久化与流程操作（提交、拉脱、返工、复测、资料变更）。
- `termination-page.js`：验收页面入口（表单与卡片）。

### 规则

1. 每根索提交：索径、端接型式、压套批号、压接工。
2. 同模型同索位已有未结束单（非「合格」）时，新提交返回 `409 open_order_exists`；压套模具/批号可并行占用，不受影响。
3. 拉脱记录位移、滑移量和复查人；位移 **> 1mm** 或滑移量 **> 0.3mm** 转「待返工」。
4. 压接工不能复查自己的单（`403 self_review_forbidden`）。
5. 待返工单须先登记返工才能复测；复测通过才恢复该模型的交付资格（存在未结束单时置「已交付」返回 `409 delivery_blocked`）。
6. 修改索径、端接型式或压套批号会让原拉脱结论失效（旧结论保留在卡片并标注），需重新拉脱。
7. 卡片显示累计返工次数；历次拉脱/返工记录全部保留。

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/terminations` | 提交端接单（可能 400/404/409） |
| GET | `/api/terminations?model=模型编号` | 端接单列表 |
| POST | `/api/terminations/:id/pull-tests` | 记录拉脱/复测 |
| POST | `/api/terminations/:id/reworks` | 登记返工（可附新资料） |
| PATCH | `/api/terminations/:id` | 修改资料（关键项变更致结论失效） |
