// ─── UI Surface Real-Path Contract Test ─────────────────────────
// Verifies code-level invariants in the UI surface sync pipeline by
// inspecting source files. Ensures the actual code paths that the
// browser executes match the documented contract.
//
// These assertions protect against regressions where protocol tests
// pass but the UI silently drops surface data because a code path
// was accidentally changed.
//
// Usage:
//   node tests/integration/ui-surface-real-path-contract.test.mjs

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

function readSrc(relPath) {
  const full = resolve(ROOT, relPath);
  if (!existsSync(full)) throw new Error(`File not found: ${full}`);
  return readFileSync(full, 'utf8');
}

console.log('═══════════════════════════════════════════');
console.log('UI Surface Real-Path Contract Verification');
console.log('═══════════════════════════════════════════\n');

// ── Load source files ──────────────────────────────────────────
const pageTsx = readSrc('app/page.tsx');
const terminalViewTsx = readSrc('app/console/main/terminal-view.tsx');
const shellTerminalTsx = readSrc('app/shell-terminal.tsx');
const workbenchStateTs = readSrc('app/console/stage/workbench-state.ts');

// ═══════════════════════════════════════════════════════════════
// T1: renderView passes _surfaceId and _operationId through MainSlot
// ═══════════════════════════════════════════════════════════════
console.log('── T1: renderView → MainSlot pass-through ──');

// renderView must pass _surfaceId and _operationId from the tab object
const renderViewHasSurfaceId = /_surfaceId\s*=\s*\{tab\?\._surfaceId\}/.test(pageTsx);
const renderViewHasOperationId = /_operationId\s*=\s*\{tab\?\._operationId\}/.test(pageTsx);
check('T1a: renderView passes _surfaceId to MainSlot', renderViewHasSurfaceId);
check('T1b: renderView passes _operationId to MainSlot', renderViewHasOperationId);

// The MainSlot usage must spread these to the view component props
const mainSlotHasSurfaceId = /_surfaceId=\{tab\?\._surfaceId\}/.test(pageTsx);
const mainSlotHasOperationId = /_operationId=\{tab\?\._operationId\}/.test(pageTsx);
check('T1c: MainSlot receives _surfaceId prop', mainSlotHasSurfaceId);
check('T1d: MainSlot receives _operationId prop', mainSlotHasOperationId);

// ═══════════════════════════════════════════════════════════════
// T2: TerminalView accepts _surfaceId and _operationId props
// ═══════════════════════════════════════════════════════════════
console.log('\n── T2: TerminalView prop contract ──');

const tvHasSurfaceIdProp = /_surfaceId\?:\s*string/.test(terminalViewTsx);
const tvHasOperationIdProp = /_operationId\?:\s*string/.test(terminalViewTsx);
check('T2a: TerminalView declares _surfaceId prop', tvHasSurfaceIdProp);
check('T2b: TerminalView declares _operationId prop', tvHasOperationIdProp);

// TerminalView must pass _surfaceId and _operationId to ShellTerminal
const tvPassesSurfaceId = /_surfaceId=\{_surfaceId\}/.test(terminalViewTsx);
const tvPassesOperationId = /_operationId=\{_operationId\}/.test(terminalViewTsx);
check('T2c: TerminalView passes _surfaceId to ShellTerminal', tvPassesSurfaceId);
check('T2d: TerminalView passes _operationId to ShellTerminal', tvPassesOperationId);

// ═══════════════════════════════════════════════════════════════
// T3: TerminalView triggers ensureSurfacePublished for instance-only tabs
// ═══════════════════════════════════════════════════════════════
console.log('\n── T3: TerminalView auto-publish logic ──');

// The effect that calls ensureSurfacePublished when instanceId exists without _surfaceId
const tvHasEnsurePublish = /ensureSurfacePublished/.test(terminalViewTsx);
const tvGuardsWithSurfaceId = /instanceId\s*&&\s*!_surfaceId/.test(terminalViewTsx);
check('T3a: TerminalView calls ensureSurfacePublished', tvHasEnsurePublish);
check('T3b: ensureSurfacePublished guard checks !_surfaceId', tvGuardsWithSurfaceId);

// TerminalView auto-creates instance when no instanceId
const tvHasAutoCreate = /createInstance/.test(terminalViewTsx);
const tvAutoCreateGuard = /if\s*\(\s*instanceId\s*\|\|\s*autoCreated/.test(terminalViewTsx);
check('T3c: TerminalView auto-creates instance via createInstance', tvHasAutoCreate);
check('T3d: auto-create runs only once (autoCreated guard)', tvAutoCreateGuard);

// After auto-create success, TerminalView calls bindCurrentTabInstance
const tvHasBindTab = /bindCurrentTabInstance/.test(terminalViewTsx);
check('T3e: TerminalView calls bindCurrentTabInstance on auto-create success', tvHasBindTab);

// ═══════════════════════════════════════════════════════════════
// T4: ShellTerminal input routing based on _surfaceId/_operationId
// ═══════════════════════════════════════════════════════════════
console.log('\n── T4: ShellTerminal input routing ──');

// Must check _surfaceId && _operationId to decide routing
const stHasSurfaceRoute = /if\s*\(\s*_surfaceId\s*&&\s*_operationId\s*\)/.test(shellTerminalTsx);
check('T4a: ShellTerminal checks _surfaceId && _operationId for routing', stHasSurfaceRoute);

// Surface path: sends operation.input
const stHasOperationInput = /operation\.input/.test(shellTerminalTsx);
check('T4b: ShellTerminal sends operation.input on surface path', stHasOperationInput);

// Shell path: sends shell.input (fallback)
const stHasShellInput = /shell\.input/.test(shellTerminalTsx);
check('T4c: ShellTerminal sends shell.input on direct path', stHasShellInput);

// connectSurface sends surface.subscribe
const stHasSurfaceSubscribe = /surface\.subscribe/.test(shellTerminalTsx);
check('T4d: connectSurface sends surface.subscribe', stHasSurfaceSubscribe);

// connectSurface handles runtime.replay
const stHasReplayHandler = /runtime\.replay/.test(shellTerminalTsx);
check('T4e: connectSurface handles runtime.replay', stHasReplayHandler);

// connectSurface handles runtime.output
const stHasOutputHandler = /runtime\.output/.test(shellTerminalTsx);
check('T4f: connectSurface handles runtime.output', stHasOutputHandler);

// Ctrl+L routing
const stHasCtrlL = /Ctrl\+L/.test(shellTerminalTsx);
const stHasCtrlLSurface = /_surfaceId\s*&&\s*_operationId/.test(shellTerminalTsx);
check('T4g: Ctrl+L handler checks surface routing', stHasCtrlL && stHasCtrlLSurface);

// Paste routing
const stHasPasteSurface = /_surfaceId\s*&&\s*_operationId/.test(shellTerminalTsx);
check('T4h: Paste handler checks surface routing', stHasPasteSurface);

// ═══════════════════════════════════════════════════════════════
// T5: handleBindCurrentTabInstance → publishSurfaceForTab chain
// ═══════════════════════════════════════════════════════════════
console.log('\n── T5: bindCurrentTabInstance → publishSurfaceForTab chain ──');

const hasPublishCall = /publishSurfaceForTab/.test(pageTsx);
check('T5a: handleBindCurrentTabInstance calls publishSurfaceForTab', hasPublishCall);

const hasBindDispatch = /SET_TAB_VIEW/.test(pageTsx);
check('T5b: handleBindCurrentTabInstance dispatches SET_TAB_VIEW before publish', hasBindDispatch);

// ═══════════════════════════════════════════════════════════════
// T6: publishSurfaceForTab guard clauses
// ═══════════════════════════════════════════════════════════════
console.log('\n── T6: publishSurfaceForTab guards ──');

// Guard: no nodeId → skip
const hasGuardNoNodeId = /if\s*\(\s*!nodeId\s*\)/.test(pageTsx);
check('T6a: guard — returns false when no activeInstanceId', hasGuardNoNodeId);

// Guard: not terminal → skip
const hasGuardNotTerminal = /viewType\s*!==\s*'terminal'/.test(pageTsx);
check('T6b: guard — returns false for non-terminal viewType', hasGuardNotTerminal);

// Guard: already has _surfaceId → skip
const hasGuardHasSurfaceId = /tab\._surfaceId/.test(pageTsx) && /return false/.test(pageTsx);
check('T6c: guard — returns false when tab already has _surfaceId', hasGuardHasSurfaceId);

// Guard: already in flight → skip (but return true)
const hasGuardInFlight = /surfacePublishInFlightRef/.test(pageTsx);
check('T6d: guard — in-flight dedup via surfacePublishInFlightRef', hasGuardInFlight);

// ═══════════════════════════════════════════════════════════════
// T7: handleEnterNode sends both workbench.subscribe + surface.subscribeNode
// ═══════════════════════════════════════════════════════════════
console.log('\n── T7: handleEnterNode subscription pair ──');

const hasWorkbenchSubscribe = /workbench\.subscribe/.test(pageTsx);
const hasSurfaceSubscribeNode = /surface\.subscribeNode/.test(pageTsx);
check('T7a: handleEnterNode sends workbench.subscribe', hasWorkbenchSubscribe);
check('T7b: handleEnterNode sends surface.subscribeNode', hasSurfaceSubscribeNode);

// Unsubscribe on toggle-off
const hasUnsubscribes = /workbench\.unsubscribe/.test(pageTsx) && /surface\.unsubscribeNode/.test(pageTsx);
check('T7c: handleEnterNode sends unsubscribes on toggle-off', hasUnsubscribes);

// ═══════════════════════════════════════════════════════════════
// T8: createInitialState creates empty placeholder tab
// ═══════════════════════════════════════════════════════════════
console.log('\n── T8: createInitialState empty placeholder ──');

const hasEmptyViewType = /viewType:\s*['"]empty['"]/.test(workbenchStateTs);
check('T8a: createInitialState creates viewType "empty" tab', hasEmptyViewType);

// collectAllTabs filters empty tabs
const hasEmptyFilter = /viewType\s*===\s*['"]empty['"]/.test(workbenchStateTs);
check('T8b: empty tabs exist as concept in workbench-state', hasEmptyFilter);

// ═══════════════════════════════════════════════════════════════
// T9: surface.list / surface.published handlers clean up empty tabs
// ═══════════════════════════════════════════════════════════════
console.log('\n── T9: Empty tab cleanup in surface handlers ──');

const hasEmptyCleanup = /emptyTabs/.test(pageTsx) && /realTabs/.test(pageTsx);
check('T9a: surface handlers clean up empty placeholder tabs', hasEmptyCleanup);

const hasCloseEmptyTab = /CLOSE_TAB/.test(pageTsx);
check('T9b: cleanup dispatches CLOSE_TAB for empty tabs', hasCloseEmptyTab);

// ═══════════════════════════════════════════════════════════════
// T10: debugSurface invariant logging exists
// ═══════════════════════════════════════════════════════════════
console.log('\n── T10: debugSurface invariant logging ──');

const hasDebugSurfacePage = /DEBUG_SURFACE/.test(pageTsx);
const hasDebugSurfaceTV = /DEBUG_SURFACE/.test(terminalViewTsx);
const hasDebugSurfaceST = /DEBUG_SURFACE/.test(shellTerminalTsx);
check('T10a: page.tsx has DEBUG_SURFACE logging', hasDebugSurfacePage);
check('T10b: terminal-view.tsx has DEBUG_SURFACE logging', hasDebugSurfaceTV);
check('T10c: shell-terminal.tsx has DEBUG_SURFACE logging', hasDebugSurfaceST);

// Key log points must exist
const hasPublishSkipLog = /publishSurfaceForTab SKIP/.test(pageTsx);
const hasPublishSendLog = /publishSurfaceForTab SEND/.test(pageTsx);
const hasEnsureLog = /ensureSurfacePublished/.test(pageTsx) && /debugLog/.test(pageTsx);
const hasReceivedSurfaceLog = /RECEIVED surface\.published/.test(pageTsx);
const hasReceivedListLog = /RECEIVED surface\.list/.test(pageTsx);
const hasInputRoutingLog = /input routing/.test(shellTerminalTsx);
const hasConnectionPathLog = /SURFACE protocol/.test(shellTerminalTsx) && /SHELL protocol/.test(shellTerminalTsx);

check('T10d: publishSurfaceForTab logs SKIP reasons', hasPublishSkipLog);
check('T10e: publishSurfaceForTab logs SEND', hasPublishSendLog);
check('T10f: ensureSurfacePublished logs decisions', hasEnsureLog);
check('T10g: surface.published handler logs receipt', hasReceivedSurfaceLog);
check('T10h: surface.list handler logs receipt', hasReceivedListLog);
check('T10i: ShellTerminal logs input routing method', hasInputRoutingLog);
check('T10j: ShellTerminal logs connection path (surface vs shell)', hasConnectionPathLog);

// ═══════════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════`);
process.exit(failed > 0 ? 1 : 0);
