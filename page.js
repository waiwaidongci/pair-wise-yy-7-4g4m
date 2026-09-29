// 页面入口：HTML 与浏览器端脚本，业务校验仍以规则接口为准。

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古船模型帆索校准 · 端接验收</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --ok:#3c6b4f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    .side > * { margin-bottom:14px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.small { padding:5px 9px; font-size:12px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.ok { border-color:var(--ok); color:var(--ok); } .pill.hold { border-color:var(--warn); color:var(--warn); }
    .pill.bad { background:var(--warn); color:#fff; border-color:var(--warn); }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:110px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .row { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .row label { margin-top:6px; }
    details { border-top:1px dashed var(--line); padding-top:6px; } summary { cursor:pointer; font-size:13px; color:var(--muted); }
    #toast { position:fixed; top:16px; right:16px; background:var(--warn); color:#fff; padding:10px 14px; border-radius:8px; display:none; max-width:340px; }
    .section-title { display:flex; justify-content:space-between; align-items:center; margin:18px 0 10px; } .section-title h2 { margin:0; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古船模型帆索校准</h1><div class="meta">模型、帆索任务、新钢丝索端接验收串联</div></div><button id="reload">刷新</button></header>
  <main>
    <section class="side">
      <form id="createForm"><h2>新增模型</h2><div id="fields"></div><label>初始状态</label><select name="status"><option>待检查</option><option>校准中</option><option>待复核</option><option>已交付</option></select><button>保存模型</button></form>
      <form id="actionForm"><h2>新增帆索任务</h2><label>选择模型</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
      <form id="acceptanceForm"><h2>提交端接验收</h2>
        <label>选择模型</label><select name="modelKey" id="acceptModel"></select>
        <label>索位</label><input name="position" required placeholder="如：前桅侧支索">
        <div class="row"><div><label>索径(mm)</label><input name="cableDiameter" type="number" step="0.01" min="0.01" required></div>
        <div><label>端接型式</label><select name="terminationType"><option>铝套压制</option><option>铜套压制</option><option>开口套管压制</option><option>锡浇铸</option></select></div></div>
        <label>压套批号</label><input name="ferruleBatch" required placeholder="如：PT-2026-09-A">
        <label>压接工</label><input name="crimper" required>
        <label>模具号（选填，仅登记不参与互斥）</label><input name="die" placeholder="同一模具被占用不影响提交">
        <button>提交验收单</button>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option><option>待检查</option><option>校准中</option><option>待复核</option><option>已交付</option></select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>模型卡片（含端接单数与交付资格）</h2><div class="grid" id="cards"></div></div>
      <div class="section-title"><h2>端接验收单</h2><select id="acceptFilter" style="width:auto"><option value="">全部单据</option><option>待拉脱</option><option>待返工</option><option>合格</option></select></div>
      <div class="panel"><div class="grid" id="acceptCards"></div></div>
    </section>
  </main>
  <div id="toast"></div>
  <script>
    const fields = [["code","模型编号","text"],["shipType","船型","text"],["scale","比例","text"],["mastCount","桅杆数量","number"],["riggingMaterial","帆索材料","text"],["owner","负责人","text"],["dueDate","交付日期","date"]];
    const stages = ["待检查","校准中","待复核","已交付"];
    const extraFields = [["position","索具位置"],["tension","松紧状态"],["note","调整备注"]];
    const acceptanceStatuses = ["待拉脱","待返工","合格"];
    const terminationTypes = ["铝套压制","铜套压制","开口套管压制","锡浇铸"];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const acceptanceForm = document.querySelector('#acceptanceForm');
    const cards = document.querySelector('#cards');
    const acceptCards = document.querySelector('#acceptCards');
    const statsEl = document.querySelector('#stats');
    const itemSelect = document.querySelector('#itemSelect');
    const acceptModel = document.querySelector('#acceptModel');
    const toastEl = document.querySelector('#toast');
    let toastTimer = null;
    let items = [], acceptances = [];
    function toast(message) {
      toastEl.textContent = message; toastEl.style.display = 'block';
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.style.display = 'none', 4000);
    }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || '请求失败');
      return data;
    }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function itemId(item) { return item.id || item.code; }
    function render() {
      const options = items.map(item => '<option value="'+itemId(item)+'">'+(item.code || item.id)+' · '+(item.shipType||'')+'</option>').join('');
      itemSelect.innerHTML = options; acceptModel.innerHTML = options;
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      stats['待返工端接'] = acceptances.filter(a => a.status === '待返工').length;
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      renderAcceptances(q);
      bindModelControls();
      bindAcceptanceControls();
    }
    function renderAcceptances(q) {
      const f = document.querySelector('#acceptFilter').value;
      const visible = acceptances.filter(a => (!f || a.status === f) && (!q || JSON.stringify(a).includes(q)));
      acceptCards.innerHTML = visible.map(acceptanceHtml).join('') || '<div class="meta">暂无端接验收单</div>';
    }
    function cardHtml(item) {
      const main = fields.slice(0,4).map(([key,label]) => '<div><b>'+label+'</b> '+(item[key] ?? '')+'</div>').join('');
      const tasks = (item.tasks || []).map(t => '<div class="meta">任务 '+t.position+' · '+t.status+' · '+t.tension+'</div>').join('');
      const logs = (item.logs || []).slice(-3).map(l => '<div>'+(l.step||'')+'：'+l.note+'</div>').join('');
      const eligible = item.deliveryEligible !== false;
      const eligibility = eligible ? '<span class="pill ok">可交付</span>' : '<span class="pill hold">交付挂起</span>';
      const reworkWarn = item.reworkTotal > 0 ? ' <span class="warn">累计返工 '+item.reworkTotal+' 次</span>' : '';
      return '<article class="card"><h3>'+(item.code || item.id)+'</h3><div>'+eligibility+' <span class="pill">端接单 '+(item.acceptanceCount||0)+'</span>'+reworkWarn+'</div>'+main+tasks+
        '<label>状态</label><select data-status="'+itemId(item)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select>'+
        '<button class="secondary" data-note="'+itemId(item)+'">追加备注</button><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    function acceptanceHtml(a) {
      const statusPill = a.status === '合格' ? '<span class="pill ok">合格</span>' : a.status === '待返工' ? '<span class="pill bad">待返工</span>' : '<span class="pill">待拉脱</span>';
      const rework = a.reworkCount > 0 ? '<span class="warn">累计返工 '+a.reworkCount+' 次</span>' : '<span class="meta">无返工</span>';
      const c = a.conclusion;
      let conclusion = '<div class="meta">尚未拉脱</div>';
      if (c) {
        conclusion = '<div class="meta">末次结论：'+(c.pass ? '<b style="color:var(--ok)">合格</b>' : '<b class="warn">不合格</b>')+' · 位移 '+c.displacement+'mm · 滑移 '+c.slip+'mm · 复查人 '+c.reviewer+'</div>';
      }
      const pullForm = a.status === '合格' ? '<div class="meta">已合格，复测流程结束</div>'
        : '<form data-pull="'+a.id+'"><div class="row"><div><label>位移(mm)</label><input name="displacement" type="number" step="0.01" min="0" required></div><div><label>滑移量(mm)</label><input name="slip" type="number" step="0.01" min="0" required></div></div><label>复查人（不得为压接工 '+a.crimper+'）</label><input name="reviewer" required><button class="small">记录拉脱</button></form>';
      const history = (a.history || []).slice(-5).map(h => {
        if (h.kind === '拉脱') return '<div>'+h.kind+'：'+(h.pass?'合格':'不合格')+' · 位移'+h.displacement+'mm · 滑移'+h.slip+'mm · '+h.reviewer+'</div>';
        if (h.kind === '结论失效') return '<div class="warn">结论失效：'+h.labels.join('、')+'变更（复测通过前不可交付）</div>';
        return '<div>'+h.kind+'：'+(h.labels ? h.labels.join('、')+'变更' : (h.note||''))+'</div>';
      }).join('');
      return '<article class="card"><h3>'+a.id+' · '+a.modelCode+'</h3><div>'+statusPill+' '+rework+'</div>'+
        '<div><b>索位</b> '+a.position+'</div><div><b>索径</b> '+a.cableDiameter+'mm · <b>端接型式</b> '+a.terminationType+'</div>'+
        '<div><b>压套批号</b> '+a.ferruleBatch+'</div><div class="meta">压接工 '+a.crimper+(a.die ? ' · 模具 '+a.die : '')+'</div>'+
        conclusion+pullForm+
        '<details><summary>修改规格（改索径/端接型式/压套批号会令原结论失效）</summary><form data-patch="'+a.id+'">'+
        '<div class="row"><div><label>索径(mm)</label><input name="cableDiameter" type="number" step="0.01" value="'+a.cableDiameter+'"></div><label>端接型式</label><select name="terminationType">'+terminationTypes.map(t => '<option '+(t===a.terminationType?'selected':'')+'>'+t+'</option>').join('')+'</select></div>'+
        '<label>压套批号</label><input name="ferruleBatch" value="'+a.ferruleBatch+'"><label>压接工</label><input name="crimper" value="'+a.crimper+'"><label>模具号</label><input name="die" value="'+(a.die||'')+'">'+
        '<button class="small secondary">保存规格</button></form></details>'+
        '<div class="logs meta">'+(history || '暂无记录')+'</div></article>';
    }
    function bindModelControls() {
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => {
        try { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); }
        catch (e) { toast(e.message); }
        await load();
      });
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => { const note = prompt('记录备注'); if (note) { await api('/api/items/'+btn.dataset.note+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } });
    }
    function bindAcceptanceControls() {
      document.querySelectorAll('form[data-pull]').forEach(form => form.onsubmit = async event => {
        event.preventDefault();
        try { await api('/api/acceptances/'+form.dataset.pull+'/pull', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); }
        catch (e) { toast(e.message); }
        await load();
      });
      document.querySelectorAll('form[data-patch]').forEach(form => form.onsubmit = async event => {
        event.preventDefault();
        try { await api('/api/acceptances/'+form.dataset.patch, { method:'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); }
        catch (e) { toast(e.message); }
        await load();
      });
    }
    async function load() {
      [items, acceptances] = await Promise.all([api('/api/items'), api('/api/acceptances')]);
      render();
    }
    createForm.onsubmit = async event => { event.preventDefault(); await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); await load(); };
    actionForm.onsubmit = async event => { event.preventDefault(); await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); await load(); };
    acceptanceForm.onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(acceptanceForm).entries());
      try { await api('/api/items/'+data.modelKey+'/acceptances', { method:'POST', body: JSON.stringify(data) }); acceptanceForm.reset(); toast('端接验收单已提交，待拉脱'); }
      catch (e) { toast(e.message); }
      await load();
    };
    document.querySelector('#statusFilter').onchange = render;
    document.querySelector('#acceptFilter').onchange = render;
    document.querySelector('#search').oninput = render;
    document.querySelector('#reload').onclick = load;
    renderForms(); load();
  </script>
</body>
</html>`;
}
