// ─── Dashboard HTML ────────────────────────────────────────────
// Embedded single-page dashboard served by the agent's local
// HTTP server. Refreshes via /api/status every 3s.

export function dashboardHtml(label: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SessionBridge — ${escapeHtml(label)}</title>
<style>
:root {
  --bg: #0d1117; --fg: #e6edf3; --accent: #58a6ff;
  --border: #30363d; --card: #161b22; --muted: #8b949e;
  --green: #3fb950; --yellow: #d29922; --red: #f85149;
  --purple: #a371f7; --orange: #f0883e;
}
* { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #484f58; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  background: var(--bg); color: var(--fg); font-size: 13px;
  line-height: 1.5; min-height: 100vh;
}

/* ── Top Bar ── */
.topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 20px; border-bottom: 1px solid var(--border);
  background: var(--card); position: sticky; top: 0; z-index: 100;
}
.topbar h1 { font-size: 14px; font-weight: 600; }
.topbar h1 span { color: var(--purple); }
.topbar .spacer { flex: 1; }
.topbar .node-status { font-size: 11px; display: flex; align-items: center; gap: 6px; }
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 6px; font-size: 12px;
  font-weight: 500; cursor: pointer; border: 1px solid var(--border);
  background: var(--card); color: var(--fg); text-decoration: none;
  transition: background .15s, border-color .15s;
}
.btn:hover { background: #1c2333; border-color: var(--muted); }
.btn-console {
  background: var(--purple); color: #fff; border-color: var(--purple);
}
.btn-console:hover { background: #7c3aed; border-color: #7c3aed; }

/* ── Layout ── */
.container { max-width: 900px; margin: 0 auto; padding: 20px; }

/* ── Cards ── */
.section { margin-bottom: 16px; }
.section-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; cursor: pointer; user-select: none;
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--muted);
  background: var(--card); border: 1px solid var(--border);
  border-radius: 6px 6px 0 0;
  transition: background .15s;
}
.section-header:hover { background: #1c2333; }
.section-header .arrow {
  font-size: 10px; transition: transform .2s;
}
.section-header .arrow.open { transform: rotate(90deg); }
.section-body {
  border: 1px solid var(--border); border-top: none;
  border-radius: 0 0 6px 6px; padding: 12px 16px;
  background: var(--card);
}
.section-body.collapsed { display: none; }

/* ── Status Row ── */
.status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
.status-item {
  display: flex; flex-direction: column; gap: 2px;
}
.status-item .label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.3px; }
.status-item .value { font-size: 14px; font-weight: 600; font-family: Menlo, Monaco, monospace; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot.green { background: var(--green); box-shadow: 0 0 6px rgba(63,185,80,.4); }
.dot.red { background: var(--red); box-shadow: 0 0 6px rgba(248,81,73,.4); }
.dot.yellow { background: var(--yellow); }

/* ── Gauges ── */
.gauge-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.gauge-item { }
.gauge-item .g-label { font-size: 10px; color: var(--muted); margin-bottom: 4px; }
.gauge-bar { height: 8px; background: #0d1117; border-radius: 4px; overflow: hidden; }
.gauge-fill { height: 100%; border-radius: 4px; transition: width .6s ease; }
.gauge-fill.green { background: var(--green); }
.gauge-fill.yellow { background: var(--yellow); }
.gauge-fill.red { background: var(--red); }
.gauge-pct { font-size: 11px; font-weight: 600; margin-top: 2px; }

/* ── Permission / Notification rows ── */
.toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 0; border-bottom: 1px solid rgba(48,54,61,.5);
}
.toggle-row:last-child { border-bottom: none; }
.toggle { position: relative; width: 32px; height: 18px; display: inline-block; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle .slider {
  position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
  background: #21262d; border-radius: 18px; transition: .2s;
}
.toggle .slider::before {
  content: ""; position: absolute; height: 12px; width: 12px;
  left: 3px; bottom: 3px; background: var(--muted); border-radius: 50%; transition: .2s;
}
.toggle input:checked + .slider { background: var(--green); }
.toggle input:checked + .slider::before { background: #fff; transform: translateX(14px); }

/* ── Table ── */
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; font-size: 10px; }
td:first-child, th:first-child { padding-left: 0; }
td:last-child, th:last-child { padding-right: 0; }

/* ── Log ── */
#log { font-size: 11px; line-height: 1.6; max-height: 150px; overflow-y: auto; }

/* ── Badge ── */
.badge {
  display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px;
}
.badge.green { background: rgba(63,185,80,.15); color: var(--green); }
.badge.red { background: rgba(248,81,73,.15); color: var(--red); }
.badge.yellow { background: rgba(210,153,34,.15); color: var(--yellow); }

/* ── Responsive ── */
@media (max-width: 640px) {
  .topbar { flex-wrap: wrap; }
  .gauge-grid { grid-template-columns: 1fr; }
  .container { padding: 12px; }
}
</style>
</head>
<body>

<div class="topbar">
  <h1>SessionBridge <span>Agent</span></h1>
  <span class="badge" id="version-badge">-</span>
  <div class="spacer"></div>
  <span class="node-status">
    <span id="status-dot" class="dot yellow"></span>
    <span id="relay-status">连接中…</span>
  </span>
  <a class="btn btn-console" href="http://localhost:8080" target="_blank" title="在浏览器中打开工作台">
    ⋮ 打开控制台
  </a>
</div>

<div class="container">

  <!-- ── 系统状态 ── -->
  <div class="section">
    <div class="section-header" onclick="toggleSection('sys-body')">
      <span class="arrow open" id="sys-arrow">▶</span> 系统状态
    </div>
    <div class="section-body" id="sys-body">
      <div class="status-grid">
        <div class="status-item">
          <span class="label">运行时间</span>
          <span class="value" id="uptime">-</span>
        </div>
        <div class="status-item">
          <span class="label">PID</span>
          <span class="value" id="pid">-</span>
        </div>
        <div class="status-item">
          <span class="label">Relay 端口</span>
          <span class="value" id="relay-port">8080</span>
        </div>
        <div class="status-item">
          <span class="label">控制台端口</span>
          <span class="value">9843</span>
        </div>
      </div>
      <div style="margin-top:12px">
        <div class="gauge-grid">
          <div class="gauge-item">
            <div class="g-label">内存</div>
            <div class="gauge-bar"><div class="gauge-fill" id="mem-bar" style="width:0%"></div></div>
            <div class="gauge-pct" id="mem-pct">-</div>
          </div>
          <div class="gauge-item">
            <div class="g-label">CPU</div>
            <div class="gauge-bar"><div class="gauge-fill" id="cpu-bar" style="width:0%"></div></div>
            <div class="gauge-pct" id="cpu-pct">-</div>
          </div>
        </div>
      </div>
      <div style="margin-top:10px; font-size:11px; color:var(--muted);">
        <span id="os-info">-</span> ·
        <span id="cpu-info">-</span> ·
        <span id="mem-info">-</span>
      </div>
    </div>
  </div>

  <!-- ── 权限 ── -->
  <div class="section">
    <div class="section-header" onclick="toggleSection('perms-body')">
      <span class="arrow open" id="perms-arrow">▶</span> 权限
    </div>
    <div class="section-body" id="perms-body"><div id="perms-card"></div></div>
  </div>

  <!-- ── 通知 ── -->
  <div class="section">
    <div class="section-header" onclick="toggleSection('notifs-body')">
      <span class="arrow open" id="notifs-arrow">▶</span> 通知
    </div>
    <div class="section-body" id="notifs-body"><div id="notifs-card"></div></div>
  </div>

  <!-- ── 适配器 + 扩展 ── -->
  <div class="section">
    <div class="section-header" onclick="toggleSection('ext-body')">
      <span class="arrow open" id="ext-arrow">▶</span> 适配器 &amp; 扩展
    </div>
    <div class="section-body" id="ext-body">
      <div style="margin-bottom:12px"><span style="font-size:10px;color:var(--muted);text-transform:uppercase">适配器</span><div id="adapters-card" style="margin-top:4px"></div></div>
      <div><span style="font-size:10px;color:var(--muted);text-transform:uppercase">扩展</span><div id="extensions-card" style="margin-top:4px"></div></div>
    </div>
  </div>

  <!-- ── 进程 (top 10) ── -->
  <div class="section">
    <div class="section-header" onclick="toggleSection('proc-body')">
      <span class="arrow open" id="proc-arrow">▶</span> 进程 <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(前10)</span>
    </div>
    <div class="section-body" id="proc-body">
      <div style="max-height:200px;overflow-y:auto">
        <table><thead><tr><th>PID</th><th>名称</th><th>CPU</th><th>内存</th></tr></thead><tbody id="proc-body-rows"></tbody></table>
      </div>
    </div>
  </div>

  <!-- ── 日志 ── -->
  <div class="section">
    <div class="section-header" onclick="toggleSection('log-body')">
      <span class="arrow open" id="log-arrow">▶</span> 日志
    </div>
    <div class="section-body" id="log-body">
      <pre id="log">加载中…</pre>
    </div>
  </div>

</div>

<script>
const API = '/api';

function toggleSection(id) {
  const body = document.getElementById(id);
  const arrow = document.getElementById(id.replace('body', 'arrow'));
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (arrow) arrow.className = 'arrow' + (open ? '' : ' open');
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

function formatBytes(b) {
  if (!b) return '-';
  const gb = b / 1e9;
  return gb >= 1 ? gb.toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
}

function formatUptime(s) {
  if (!s) return '-';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h + 'h ' + m + 'm';
}

async function togglePerm(cat, checked) {
  await fetch(API + '/permissions', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({category: cat, value: checked}),
  });
}

async function toggleNotif(id, checked) {
  await fetch(API + '/notifications', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({scenarioId: id, value: checked}),
  });
}

async function refresh() {
  try {
    const s = await fetchJson(API + '/status');

    // Top bar
    const connected = s.relayConnected;
    const sd = document.getElementById('status-dot');
    sd.className = 'dot ' + (connected ? 'green' : 'red');
    document.getElementById('version-badge').textContent = 'v' + s.version;
    document.getElementById('relay-status').textContent = connected ? '已连接' : '未连接';
    document.getElementById('uptime').textContent = formatUptime(s.uptime);
    document.getElementById('pid').textContent = s.pid;

    // System
    document.getElementById('os-info').textContent = s.system.platform + ' ' + s.system.arch + ' · Node ' + s.system.nodeVersion;
    document.getElementById('cpu-info').textContent = 'CPU: ' + s.system.cpus + ' 核 · 负载 ' + (s.system.loadavg || []).map(n => n.toFixed(1)).join(' ');
    document.getElementById('mem-info').textContent = '内存: ' + formatBytes(s.system.memory.free) + ' 空闲 / ' + formatBytes(s.system.memory.total);

    // Gauges
    const memPct = s.system.memory.total ? ((1 - s.system.memory.free / s.system.memory.total) * 100).toFixed(0) : 0;
    const loadAvg = (s.system.loadavg?.[0] || 0);
    const cpuPct = s.system.cpus ? Math.min(100, (loadAvg / s.system.cpus * 100).toFixed(0)) : 0;
    const memBar = document.getElementById('mem-bar');
    const cpuBar = document.getElementById('cpu-bar');
    memBar.style.width = memPct + '%';
    memBar.className = 'gauge-fill ' + (memPct > 80 ? 'red' : memPct > 50 ? 'yellow' : 'green');
    cpuBar.style.width = cpuPct + '%';
    cpuBar.className = 'gauge-fill ' + (cpuPct > 80 ? 'red' : cpuPct > 50 ? 'yellow' : 'green');
    document.getElementById('mem-pct').textContent = memPct + '%';
    document.getElementById('cpu-pct').textContent = cpuPct + '%';
    document.getElementById('mem-pct').style.color = memPct > 80 ? 'var(--red)' : memPct > 50 ? 'var(--yellow)' : 'var(--green)';
    document.getElementById('cpu-pct').style.color = cpuPct > 80 ? 'var(--red)' : cpuPct > 50 ? 'var(--yellow)' : 'var(--green)';

    // Permissions
    const pc = document.getElementById('perms-card');
    pc.innerHTML = '';
    for (const [cat, val] of Object.entries(s.permissions || {})) {
      const div = document.createElement('div');
      div.className = 'toggle-row';
      div.innerHTML = '<span style="font-size:12px;font-family:Menlo,Monaco,monospace">' + cat + '</span>' +
        '<label class="toggle"><input type="checkbox" ' + (val ? 'checked' : '') + ' onchange="togglePerm(\\'' + cat + '\\', this.checked)"><span class="slider"></span></label>';
      pc.appendChild(div);
    }

    // Notifications
    const nc = document.getElementById('notifs-card');
    const nd = s.notifications || {scenarios:[],settings:{}};
    if (nd.scenarios.length === 0) {
      nc.innerHTML = '<span style="color:var(--muted);font-size:12px">无通知场景</span>';
    } else {
      const groups = {};
      for (const sc of nd.scenarios) {
        const src = sc.source || 'system';
        if (!groups[src]) groups[src] = [];
        groups[src].push(sc);
      }
      let html = '';
      for (const [src, scenarios] of Object.entries(groups)) {
        html += '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin:6px 0 4px;letter-spacing:0.3px">' + escapeHtml(src) + '</div>';
        for (const sc of scenarios) {
          const checked = nd.settings[sc.id] !== false;
          html += '<div class="toggle-row" title="' + escapeHtml(sc.description || '') + '">' +
            '<span style="font-size:12px">' + escapeHtml(sc.label) + '</span>' +
            '<label class="toggle"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="toggleNotif(\\'' + sc.id + '\\', this.checked)"><span class="slider"></span></label></div>';
        }
      }
      nc.innerHTML = html;
    }

    // Adapters
    const ac = document.getElementById('adapters-card');
    ac.innerHTML = (s.adapters || []).map(a =>
      '<div class="toggle-row"><span style="font-size:12px;font-family:Menlo,Monaco,monospace">' + escapeHtml(a.id) + '</span><span class="badge ' + (a.available ? 'green' : 'red') + '">' + (a.available ? '可用' : '不可用') + '</span></div>'
    ).join('') || '<span style="font-size:12px;color:var(--muted)">未检测到适配器</span>';

    // Extensions
    try {
      const ext = await fetchJson(API + '/extensions');
      const ec = document.getElementById('extensions-card');
      if (!ext.enabled) {
        ec.innerHTML = '<span style="font-size:12px;color:var(--muted)">扩展管理器已禁用（使用 --dev 启用）</span>';
      } else {
        const stateDot = ext.state === 'running' ? 'green' : ext.state === 'crashed' ? 'red' : 'yellow';
        let html = '<div class="toggle-row"><span><span class="dot ' + stateDot + '" style="margin-right:6px"></span><strong>' + ext.state + '</strong> <span style="color:var(--muted);font-size:11px">pid ' + (ext.pid || '-') + ' · 崩溃 ' + ext.crashCount + ' 次</span></span>';
        if (ext.state === 'running') {
          html += '<button class="btn" style="padding:3px 8px;font-size:10px" onclick="reloadExtensions(this)">重新加载</button>';
        }
        html += '</div>';
        if (ext.activatedExtensionIds && ext.activatedExtensionIds.length > 0) {
          html += '<div style="margin-top:6px;font-size:11px;color:var(--muted)">已激活 (' + ext.activatedExtensionIds.length + '):<br>';
          for (const id of ext.activatedExtensionIds) {
            html += '<span class="badge green" style="margin:2px 4px 2px 0">' + escapeHtml(id) + '</span>';
          }
          html += '</div>';
        }
        ec.innerHTML = html;
      }
    } catch { /* extensions endpoint may not be available */ }

  } catch (err) {
    document.getElementById('relay-status').textContent = '错误: ' + err.message;
    document.getElementById('status-dot').className = 'dot red';
  }

  // Processes (top 10 by CPU)
  try {
    const procs = await fetchJson(API + '/processes?sort=cpu&limit=10');
    const tb = document.querySelector('#proc-body-rows');
    tb.innerHTML = (procs || []).map(p =>
      '<tr><td>' + p.pid + '</td><td>' + escapeHtml(p.name) + '</td><td>' + (p.cpu != null ? p.cpu.toFixed(1) + '%' : '-') + '</td><td>' + (p.mem != null ? p.mem.toFixed(1) + '%' : '-') + '</td></tr>'
    ).join('');
  } catch { /* ok */ }

  // Logs
  try {
    const logs = await fetchJson(API + '/logs');
    document.getElementById('log').textContent = (logs || []).join('\\n');
  } catch { /* ok */ }
}

function reloadExtensions(btn) {
  if (btn) { btn.textContent = '重新加载中…'; btn.disabled = true; }
  fetch(API + '/extensions', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({action: 'reload'}),
  }).then(() => setTimeout(refresh, 1000)).catch(() => {});
  if (btn) setTimeout(() => { btn.textContent = '重新加载'; btn.disabled = false; }, 2000);
}

function escapeHtml(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
