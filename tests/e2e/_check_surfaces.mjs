// Check surface debug events on both relays to diagnose cross-machine sync
const localUrl = 'http://localhost:14400/api/debug/surfaces';
const vpsUrl = 'http://localhost:18080/api/debug/surfaces';

async function check(url, label) {
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    const surf = data.surfaceDebug;
    console.log(`\n=== ${label} (${data.localNode}) ===`);
    console.log(`Surfaces: ${surf.surfaces.length}`);
    // List surface ids + titles
    for (const s of surf.surfaces.slice(-10)) {
      console.log(`  ${s.surfaceId} nodeId=${s.nodeId} title="${s.title}" viewType=${s.viewType} orphaned=${s.orphaned}`);
    }
    console.log(`Events: ${surf.events?.length || 0}`);
    for (const e of (surf.events || []).slice(-15)) {
      console.log(`  [${e.kind}] nodeId=${e.nodeId} ${e.message || ''}`);
    }
  } catch (err) {
    console.error(`Error checking ${label}: ${err.message}`);
  }
}

await check(localUrl, 'LOCAL');
await check(vpsUrl, 'VPS');

// Check workbench tabs via API
async function checkWorkbench(url, label) {
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    console.log(`\n=== ${label} workbench.tabs ===`);
    if (data.workbenchTabs) {
      for (const [nodeId, tabs] of Object.entries(data.workbenchTabs)) {
        console.log(`  nodeId=${nodeId}: ${(tabs||[]).length} tabs`);
        for (const t of (tabs||[]).slice(0, 5)) {
          console.log(`    id=${t.id} title="${t.title}" viewType=${t.viewType}`);
        }
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}

const localStatus = await fetch('http://localhost:14400/api/status').then(r=>r.json());
const vpsStatus = await fetch('http://localhost:18080/api/status').then(r=>r.json());

await checkWorkbench('http://localhost:14400/api/debug/surfaces', 'LOCAL');
await checkWorkbench('http://localhost:18080/api/debug/surfaces', 'VPS');

console.log('\n=== Instances ===');
console.log('Local instances:', localStatus.instances?.map(i => `${i.id} (${i.label}, ${i.source})`).join(', '));
console.log('VPS instances:', vpsStatus.instances?.map(i => `${i.id} (${i.label}, ${i.source})`).join(', '));
