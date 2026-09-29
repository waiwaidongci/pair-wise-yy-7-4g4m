// 端接验收页面入口（独立于 server.js，只负责视图）。
export function terminationPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>钢丝索端接验收</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --ok:#3d6b46; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:24px; } h2 { margin:0 0 12px; font-size:17px; } h3 { margin:0; font-size:16px; }
    main { display:grid; grid-template-columns:360px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 12px; font-weight:700; cursor:pointer; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select { width:auto; min-width:180px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:12px; }
    .card { display:grid; gap:6px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 9px; font-size:12px; }
    .pill.ok { color:var(--ok); border-color:var(--ok); } .pill.bad { color:var(--warn); border-color:var(--warn); } .pill.open { color:#8a6d1d; border-color:#c9a83c; }
    .sub { border-top:1px dashed var(--line); padding-top:8px; margin-top:6px; }
    .row { display:flex; gap:8px; } .row > * { flex:1; }
    .hist { border-top:1px solid var(--line); padding-top:8px; margin-top:6px; max-height:150px; overflow:auto; font-size:12.5px; }
    .strike { text-decoration:line-through; color:var(--muted); }
    .tip { font-size:12.5px; color:var(--muted); } .warn { color:var(--warn); font-weight:700; } .ok-text { color:var(--ok); font-weight:700; }
    a { color:var(--accent); } #toast { position:fixed; right:18px; bottom:18px; background:var(--ink); color:#fff; padding:10px 14px; border-radius:8px; display:none; max-width:70vw; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>钢丝索端接验收</h1><div class="meta">索径 · 端接型式 · 压套批号 · 压接工；拉脱位移与滑移判定，返工复测闭环</div></div>
    <div><a href="/">← 返回帆索校准</a> <button id="reload">刷新</button></div>
  </header>
  <main>
    <section>
      <form id="submitForm">
        <h2>提交端接单（每根索）</h2>
        <label>模型</label><select name="modelCode" id="modelSelect" required></select>
        <label>索位</label><input name="position" placeholder="如：前桅侧支索-1" required>
        <div class="row"><div><label>索径 (mm)</label><input name="ropeDiameter" type="number" step="0.01" min="0.01" required></div>
        <div><label>端接型式</label><select name="terminationType" required><option value="">请选择</option><option>压制套环</option><option>开式索节浇铸</option><option>闭式索节</option><option>鸡心环编插</option></select></div></div>
        <label>压套批号</label><input name="ferruleBatch" placeholder="如：FT-2026-09" required>
        <label>压接工</label><input name="crimper" required>
        <p class="tip">同模型同索位已有未结束单时返回 409；压套模具可并行占用，不做限制。</p>
        <button>提交端接</button>
      </form>
    </section>
    <section>
      <div class="toolbar">
        <select id="modelFilter"><option value="">全部模型</option></select>
        <select id="statusFilter"><option value="">全部状态</option><option>待拉脱</option><option>待返工</option><option>合格</option></select>
      </div>
      <div class="panel"><h2>端接单卡片</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <div id="toast"></div>
  <script>
    const submitForm = document.querySelector('#submitForm');
    const modelSelect = document.querySelector('#modelSelect');
    const modelFilter = document.querySelector('#modelFilter');
    const statusFilter = document.querySelector('#statusFilter');
    const cardsEl = document.querySelector('#cards');
    const toastEl = document.querySelector('#toast');
    let models = [], orders = [], toastTimer = null;

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
      });
    }
    function toast(msg, bad) {
      toastEl.textContent = msg;
      toastEl.style.background = bad ? '#9b4937' : '#20241f';
      toastEl.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, 3200);
    }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? Object.assign({}, options, { headers: { 'Content-Type': 'application/json' } }) : options);
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        const map = {
          open_order_exists: '同模型同索位已有未结束端接单（409）',
          self_review_forbidden: '压接工不能复查自己的单',
          item_not_found: '模型不存在',
          order_already_closed: '该端接单已合格结束',
          order_not_in_rework: '该单当前不在待返工状态',
          rework_required_before_retest: '请先登记返工，再提交复测',
          delivery_blocked: '存在未合格端接单，不能交付',
          field_required: '必填项缺失',
          invalid_number: '数值不合法',
        };
        throw new Error(map[data.error] || data.error || ('请求失败 ' + res.status));
      }
      return data;
    }
    async function load() {
      [models, orders] = await Promise.all([api('/api/items'), api('/api/terminations')]);
      renderModels();
      render();
    }
    function renderModels() {
      const opts = models.map(function (m) { return '<option value="' + esc(m.code) + '">' + esc(m.code) + ' · ' + esc(m.shipType) + '</option>'; }).join('');
      modelSelect.innerHTML = '<option value="">请选择模型</option>' + opts;
      modelFilter.innerHTML = '<option value="">全部模型</option>' + opts;
    }
    function statusPill(s) {
      const cls = s === '合格' ? 'ok' : (s === '待返工' ? 'bad' : 'open');
      return '<span class="pill ' + cls + '">' + esc(s) + '</span>';
    }
    function testsHtml(o) {
      if (!o.tests.length) return '<div class="meta">尚未拉脱</div>';
      return o.tests.map(function (t) {
        let tag = '<span class="pill">第' + t.round + '次' + (t.recheck ? '复测' : '拉脱') + '</span>';
        let line;
        if (t.invalidated) {
          line = '<span class="strike">' + t.result + '</span> <span class="warn">已失效（' + esc(t.invalidReason) + '）</span>';
        } else if (t.superseded) {
          line = '<span class="strike">' + t.result + '</span> <span class="warn">已被返工取代</span>';
        } else {
          line = t.result === '合格' ? '<span class="ok-text">' + t.result + '（当前结论）</span>' : '<span class="warn">' + t.result + '</span>';
        }
        const why = t.reasons && t.reasons.length ? ' · ' + esc(t.reasons.join('；')) : '';
        return '<div>' + tag + ' ' + line + '<div class="meta">位移' + t.displacementMm + 'mm（限1mm）/ 滑移' + t.slipMm + 'mm（限0.3mm） · 复查人 ' + esc(t.reviewer) + why + '</div></div>';
      }).join('');
    }
    function histHtml(o) {
      return (o.history || []).slice().reverse().map(function (h) {
        return '<div>· ' + esc(h.at).replace('T', ' ').slice(0, 16) + ' <b>' + esc(h.action) + '</b> ' + esc(h.note) + ' <span class="meta">' + esc(h.by) + '</span></div>';
      }).join('');
    }
    function actionsHtml(o) {
      let html = '';
      if (o.status === '待拉脱') {
        html += '<form class="sub" data-action="pull" data-id="' + o.id + '"><h3>' + (o.tests.length ? '提交复测' : '记录拉脱') + '</h3>'
          + '<div class="row"><div><label>位移 (mm)</label><input name="displacementMm" type="number" step="0.01" min="0" required></div>'
          + '<div><label>滑移量 (mm)</label><input name="slipMm" type="number" step="0.01" min="0" required></div></div>'
          + '<label>复查人（不得为压接工 ' + esc(o.crimper) + '）</label><input name="reviewer" required>'
          + '<p class="tip">位移 &gt; 1mm 或滑移 &gt; 0.3mm 转待返工；复测通过恢复交付资格。</p><button>提交</button></form>';
      } else if (o.status === '待返工') {
        html += '<form class="sub" data-action="rework" data-id="' + o.id + '"><h3>登记返工</h3>'
          + '<label>返工处理人</label><input name="reworker" placeholder="默认压接工 ' + esc(o.crimper) + '">'
          + '<label>返工说明</label><input name="note" placeholder="如：切除旧压套重新压制">'
          + '<div class="row"><div><label>新索径 (mm)</label><input name="ropeDiameter" type="number" step="0.01" min="0.01" placeholder="改料填写"></div>'
          + '<div><label>新端接型式</label><input name="terminationType" placeholder="改料填写"></div></div>'
          + '<label>新压套批号</label><input name="ferruleBatch" placeholder="改料填写">'
          + '<p class="tip">旧结论保留并标记“已被返工取代”；改料会让原结论失效。</p><button>返工完成，转复测</button></form>';
      }
      html += '<form class="sub" data-action="edit" data-id="' + o.id + '"><h3>修改资料</h3>'
        + '<div class="row"><div><label>索径 (mm)</label><input name="ropeDiameter" type="number" step="0.01" min="0.01" value="' + esc(o.ropeDiameter) + '"></div>'
        + '<div><label>端接型式</label><input name="terminationType" value="' + esc(o.terminationType) + '"></div></div>'
        + '<div class="row"><div><label>压套批号</label><input name="ferruleBatch" value="' + esc(o.ferruleBatch) + '"></div>'
        + '<div><label>压接工</label><input name="crimper" value="' + esc(o.crimper) + '"></div></div>'
        + (o.status === '合格' ? '<p class="tip warn">合格单改索径/端接型式/压套批号，原结论失效，需重新拉脱。</p>' : '<p class="tip">改索径、端接型式或压套批号会让原结论失效。</p>')
        + '<button>保存资料</button></form>';
      return html;
    }
    function cardHtml(o) {
      const model = models.find(function (m) { return m.code === o.modelCode; });
      const blockers = model && model.terminationBlockers ? model.terminationBlockers : 0;
      return '<article class="card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'
        + '<h3>' + esc(o.modelCode) + ' · ' + esc(o.position) + '</h3>' + statusPill(o.status) + '</div>'
        + '<div class="meta">索径 <b>' + o.ropeDiameter + 'mm</b> · 端接 <b>' + esc(o.terminationType) + '</b></div>'
        + '<div class="meta">压套批号 <b>' + esc(o.ferruleBatch) + '</b> · 压接工 <b>' + esc(o.crimper) + '</b></div>'
        + '<div>累计返工次数：<b class="' + (o.reworkCount ? 'warn' : '') + '">' + o.reworkCount + '</b> 次 · 拉脱 ' + o.tests.length + ' 轮</div>'
        + '<div class="sub">' + testsHtml(o) + '</div>'
        + actionsHtml(o)
        + '<div class="hist meta">' + histHtml(o) + '</div></article>';
    }
    function render() {
      const mf = modelFilter.value, sf = statusFilter.value;
      const visible = orders.filter(function (o) { return (!mf || o.modelCode === mf) && (!sf || o.status === sf); });
      cardsEl.innerHTML = visible.length ? visible.map(cardHtml).join('') : '<div class="meta">暂无端接单</div>';
    }
    submitForm.onsubmit = async function (e) {
      e.preventDefault();
      try {
        await api('/api/terminations', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(submitForm).entries())) });
        submitForm.reset();
        toast('端接单已提交');
        await load();
      } catch (err) { toast(err.message, true); }
    };
    cardsEl.addEventListener('submit', async function (e) {
      const form = e.target.closest('form[data-action]');
      if (!form) return;
      e.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        Object.keys(payload).forEach(function (k) { if (payload[k] === '') delete payload[k]; });
        const action = form.dataset.action;
        const path = '/api/terminations/' + form.dataset.id + (action === 'pull' ? '/pull-tests' : action === 'rework' ? '/reworks' : '');
        const method = action === 'edit' ? 'PATCH' : 'POST';
        await api(path, { method: method, body: JSON.stringify(payload) });
        toast('已保存');
        await load();
      } catch (err) { toast(err.message, true); }
    });
    modelFilter.onchange = render;
    statusFilter.onchange = render;
    document.querySelector('#reload').onclick = function () { load(); };
    load();
  </script>
</body>
</html>`;
}
