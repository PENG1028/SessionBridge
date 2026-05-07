// ─── Dashboard HTML ────────────────────────────────────────────
// Embedded single-page dashboard served by the agent's local
// HTTP server. Plain HTML/CSS/JS — zero framework, zero build.

export function dashboardHtml(label: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SessionBridge — ${escapeHtml(label)}</title>
<style>
:root {
  --bg: #0d1117; --fg: #e6edf3; --accent: #58a6ff;
  --border: #30363d; --card: #161b22; --muted: #8b949e;
  --green: #3fb950; --yellow: #d29922; --red: #f85149;
  --purple: #a371f7;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: Menlo, Monaco, "Courier New", monospace;
  background: var(--bg); color: var(--fg); font-size: 12px;
  line-height: 1.5; padding: 24px; max-width: 860px; margin: 0 auto;
}
h1 { font-size: 16px; margin-bottom: 20px; }
h1 span { color: var(--purple); }
h2 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 8px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; }
.row { display: flex; align-items: center; gap: 8px; }
.row.between { justify-content: space-between; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot.green { background: var(--green); }
.dot.red { background: var(--red); }
.dot.yellow { background: var(--yellow); }
.badge {
  font-size: 10px; padding: 2px 6px; border-radius: 3px;
  background: var(--border); color: var(--muted);
}
.badge.green { background: #1a3a24; color: var(--green); }
.badge.red { background: #3a1a1a; color: var(--red); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: normal; font-size: 10px; }
.toggle { position: relative; width: 36px; height: 20px; display: inline-block; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle .slider {
  position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--border); border-radius: 20px; transition: .2s;
}
.toggle .slider::before {
  content: ""; position: absolute; height: 14px; width: 14px;
  left: 3px; bottom: 3px; background: var(--fg); border-radius: 50%; transition: .2s;
}
.toggle input:checked + .slider { background: var(--green); }
.toggle input:checked + .slider::before { transform: translateX(16px); }
.gauge { display: flex; gap: 16px; flex-wrap: wrap; }
.gauge-item { flex: 1; min-width: 100px; }
.gauge-bar { height: 6px; background: var(--border); border-radius: 3px; margin-top: 4px; overflow: hidden; }
.gauge-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width .5s; }
.gauge-fill.warn { background: var(--yellow); }
.gauge-fill.danger { background: var(--red); }
pre { background: #0a0a0a; padding: 8px 12px; border-radius: 4px; max-height: 200px; overflow-y: auto; font-size: 11px; margin-top: 8px; }
button {
  background: var(--border); color: var(--fg); border: none;
  padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px;
  font-family: inherit;
}
button:hover { background: var(--muted); }
button.primary { background: var(--purple); }
button.primary:hover { background: #7c3aed; }
#log { max-height: 180px; overflow-y: auto; }
</style>
</head>
<body>
<h1>SessionBridge <span>Agent</span></h1>

<div class="card">
  <div class="row between">
    <div class="row">
      <span id="status-dot" class="dot yellow"></span>
      <strong id="label">${escapeHtml(label)}</strong>
    </div>
    <span class="badge" id="version">-</span>
  </div>
  <div class="row" style="margin-top: 8px; gap: 16px; color: var(--muted);">
    <span>Relay: <span id="relay-status">connecting...</span></span>
    <span>Uptime: <span id="uptime">-</span></span>
    <span>PID: <span id="pid">-</span></span>
  </div>
</div>

<h2>System</h2>
<div class="card">
  <div class="gauge" id="gauges"></div>
  <div class="row" style="margin-top: 12px; gap: 16px; color: var(--muted); font-size: 11px;">
    <span id="os-info">-</span>
    <span id="cpu-info">-</span>
    <span id="mem-info">-</span>
  </div>
</div>

<h2>Permissions</h2>
<div class="card" id="perms-card"></div>

<h2>Notifications</h2>
<div class="card" id="notifs-card">
  <span style="color: var(--muted);">Loading...</span>
</div>

<h2>Adapters</h2>
<div class="card" id="adapters-card">
  <span style="color: var(--muted);">Loading...</span>
</div>

<h2>Extensions</h2>
<div class="card" id="extensions-card">
  <span style="color: var(--muted);">Loading...</span>
</div>

<h2>Processes</h2>
<div class="card">
  <div style="max-height: 200px; overflow-y: auto;">
    <table id="proc-table"><thead><tr><th>PID</th><th>Name</th><th>User</th><th>State</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<h2>Log</h2>
<div class="card">
  <pre id="log">Loading...</pre>
</div>

<script>
const API = '/api';

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

function setDot(el, ok) {
  el.className = 'dot ' + (ok ? 'green' : 'red');
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: cat, value: checked }),
  });
}

async function toggleNotif(id, checked) {
  await fetch(API + '/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId: id, value: checked }),
  });
}

async function reloadExtensions(btn) {
  if (btn) { btn.textContent = 'Reloading...'; btn.disabled = true; }
  try {
    await fetch(API + '/extensions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reload' }),
    });
    setTimeout(refresh, 1000);
  } catch (err) {
    console.error('Reload failed:', err);
  }
  if (btn) setTimeout(() => { btn.textContent = 'Reload Extensions'; btn.disabled = false; }, 2000);
}

async function refresh() {
  try {
    const s = await fetchJson(API + '/status');

    // Status dot
    setDot(document.getElementById('status-dot'), s.relayConnected);
    document.getElementById('version').textContent = 'v' + s.version;
    document.getElementById('relay-status').textContent = s.relayConnected ? 'connected (' + s.relay + ')' : 'disconnected';
    document.getElementById('uptime').textContent = formatUptime(s.uptime);
    document.getElementById('pid').textContent = s.pid;
    document.getElementById('label').textContent = s.label;
    document.getElementById('os-info').textContent = s.system.platform + ' ' + s.system.arch + ' · Node ' + s.system.nodeVersion;
    document.getElementById('cpu-info').textContent = 'CPUs: ' + s.system.cpus + ' · Load: ' + (s.system.loadavg || []).map(n => n.toFixed(1)).join(' ');
    document.getElementById('mem-info').textContent = 'Mem: ' + formatBytes(s.system.memory.free) + ' free / ' + formatBytes(s.system.memory.total);

    // System gauges
    const memPct = s.system.memory.total ? ((1 - s.system.memory.free / s.system.memory.total) * 100).toFixed(0) : 0;
    const loadPct = s.system.cpus ? ((s.system.loadavg?.[0] || 0) / s.system.cpus * 100).toFixed(0) : 0;
    document.getElementById('gauges').innerHTML =
      '<div class="gauge-item">Memory <div class="gauge-bar"><div class="gauge-fill' + (memPct > 80 ? ' danger' : '') + '" style="width:' + memPct + '%"></div></div><span style="font-size:10px;color:var(--muted)">' + memPct + '%</span></div>' +
      '<div class="gauge-item">CPU Load <div class="gauge-bar"><div class="gauge-fill' + (loadPct > 80 ? ' warn' : '') + '" style="width:' + loadPct + '%"></div></div><span style="font-size:10px;color:var(--muted)">' + loadPct + '%</span></div>';

    // Permissions
    const pc = document.getElementById('perms-card');
    pc.innerHTML = '';
    for (const [cat, val] of Object.entries(s.permissions || {})) {
      const div = document.createElement('div');
      div.className = 'row between';
      div.style.marginBottom = '4px';
      div.innerHTML = '<span>' + cat + '</span>' +
        '<label class="toggle"><input type="checkbox" ' + (val ? 'checked' : '') + ' onchange="togglePerm(\\'' + cat + '\\', this.checked)"><span class="slider"></span></label>';
      pc.appendChild(div);
    }

    // Notifications
    const nc = document.getElementById('notifs-card');
    const nd = s.notifications || { scenarios: [], settings: {} };
    if (nd.scenarios.length === 0) {
      nc.innerHTML = '<span style="color:var(--muted)">No notification scenarios</span>';
    } else {
      // Group by source
      const groups = {};
      for (const sc of nd.scenarios) {
        const src = sc.source || 'system';
        if (!groups[src]) groups[src] = [];
        groups[src].push(sc);
      }
      nc.innerHTML = '';
      for (const [src, scenarios] of Object.entries(groups)) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size:10px;color:var(--muted);text-transform:uppercase;margin:8px 0 4px';
        label.textContent = src;
        nc.appendChild(label);
        for (const sc of scenarios) {
          const div = document.createElement('div');
          div.className = 'row between';
          div.style.marginBottom = '4px';
          div.title = sc.description || '';
          const checked = nd.settings[sc.id] !== false;
          div.innerHTML = '<span>' + escapeHtml(sc.label) + '</span>' +
            '<label class="toggle"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="toggleNotif(\\'' + sc.id + '\\', this.checked)"><span class="slider"></span></label>';
          nc.appendChild(div);
        }
      }
    }

    // Adapters
    const ac = document.getElementById('adapters-card');
    ac.innerHTML = (s.adapters || []).map(a =>
      '<div class="row between" style="margin-bottom:4px"><span>' + a.id + '</span><span class="badge ' + (a.available ? 'green' : 'red') + '">' + (a.available ? 'available' : 'n/a') + '</span></div>'
    ).join('') || '<span style="color:var(--muted)">No adapters detected</span>';

    // Extensions (dev mode)
    try {
      const ext = await fetchJson(API + '/extensions');
      const ec = document.getElementById('extensions-card');
      if (!ext.enabled) {
        ec.innerHTML = '<span style="color:var(--muted)">Extension host disabled (use --dev to enable)</span>';
      } else {
        const stateDot = ext.state === 'running' ? 'green' : ext.state === 'crashed' ? 'red' : 'yellow';
        const uptimeStr = ext.uptime ? Math.floor(ext.uptime / 1000) + 's' : '-';
        const devBadge = ext.mode === 'development' ? '<span class="badge" style="background:#2d1b69;color:#a371f7;margin-left:8px">DEV</span>' : '';

        let html = '<div class="row between" style="margin-bottom:8px">' +
          '<div class="row"><span class="dot ' + stateDot + '"></span><strong>' + ext.state + '</strong>' + devBadge +
          '<span style="color:var(--muted);font-size:10px">pid ' + (ext.pid || '-') + ' · up ' + uptimeStr + ' · crashes ' + ext.crashCount + '</span></div>';

        if (ext.state === 'running') {
          html += '<button class="primary" onclick="reloadExtensions(this)">Reload Extensions</button>';
        }
        html += '</div>';

        // Extension list
        if (ext.activatedExtensionIds && ext.activatedExtensionIds.length > 0) {
          html += '<div style="font-size:10px;color:var(--muted);margin-bottom:4px">Activated (' + ext.activatedExtensionIds.length + '):</div>';
          for (const id of ext.activatedExtensionIds) {
            html += '<span class="badge green" style="margin:2px 4px 2px 0">' + escapeHtml(id) + '</span>';
          }
        } else if (ext.state === 'running') {
          html += '<div style="color:var(--muted)">No extensions activated</div>';
        }

        // Instance count
        html += '<div style="margin-top:8px;font-size:10px;color:var(--muted)">Instances: ' + (ext.instanceCount || 0) + '</div>';

        // Configuration schemas from extension manifests
        if (ext.configurations && ext.configurations.length > 0) {
          html += '<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">';
          html += '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Extension Configurations</div>';
          for (const cfg of ext.configurations) {
            html += '<div style="margin-bottom:6px;padding:4px 6px;background:#0a0a0a;border-radius:4px">';
            html += '<div style="font-size:10px;color:var(--accent);margin-bottom:2px">' + escapeHtml(cfg.title) + '</div>';
            const schema = cfg.schema || {};
            const props = schema.properties || {};
            for (const [key, prop] of Object.entries(props)) {
              const p = prop;
              const defaultValue = p.default !== undefined ? p.default : '-';
              const description = p.description || '';
              if (p.type === 'boolean') {
                html += '<label class="row" style="margin:2px 0;font-size:10px">' +
                  '<span>' + escapeHtml(key) + '</span>' +
                  '<label class="toggle" style="margin-left:auto"><input type="checkbox" ' + (defaultValue ? 'checked' : '') + ' disabled>' +
                  '<span class="slider"></span></label></label>';
              } else if (p.enum) {
                html += '<div style="margin:2px 0;font-size:10px;color:var(--muted)">' +
                  escapeHtml(key) + ': <span style="color:var(--fg)">' + escapeHtml(String(defaultValue)) + '</span>' +
                  (description ? ' <span style="color:var(--muted)">— ' + escapeHtml(description) + '</span>' : '') + '</div>';
              } else {
                html += '<div style="margin:2px 0;font-size:10px;color:var(--muted)">' +
                  escapeHtml(key) + ': <span style="color:var(--fg)">' + escapeHtml(String(defaultValue)) + '</span>' +
                  (description ? ' <span style="color:var(--muted)">— ' + escapeHtml(description) + '</span>' : '') + '</div>';
              }
            }
            html += '</div>';
          }
          html += '</div>';
        }

        // Debugger info (dev mode)
        if (ext.mode === 'development') {
          html += '<div style="margin-top:8px;padding:6px 8px;background:#0a0a0a;border-radius:4px;font-size:10px;color:var(--muted)">' +
            'Debug: open <code style="color:var(--accent)">chrome://inspect</code> and look for a remote target on port 9229' +
            '</div>';
        }

        ec.innerHTML = html;
      }
    } catch { /* extensions endpoint may not be available */ }

  } catch (err) {
    document.getElementById('relay-status').textContent = 'error: ' + err.message;
    setDot(document.getElementById('status-dot'), false);
  }

  // Processes
  try {
    const procs = await fetchJson(API + '/processes');
    const tb = document.querySelector('#proc-table tbody');
    tb.innerHTML = (procs || []).slice(0, 60).map(p =>
      '<tr><td>' + p.pid + '</td><td>' + escapeHtml(p.name) + '</td><td>' + (p.user || '-') + '</td><td>' + (p.state || '-') + '</td></tr>'
    ).join('');
  } catch { /* ok */ }

  // Logs
  try {
    const logs = await fetchJson(API + '/logs');
    document.getElementById('log').textContent = (logs || []).join('\\n');
  } catch { /* ok */ }
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
