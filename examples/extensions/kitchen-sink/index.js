// ─── Kitchen Sink — Example Extension ────────────────────────────
// Demonstrates the full extension contract without providing an
// AgentAdapter.  Activated purely for manifest contributions
// (commands, menus, views, notifications, configuration, languages).
//
// This extension is a reference for plugin authors.
// It does NOT spawn processes, access the network, or modify any files.
//
// No import statements — the context object is provided by the runtime.
// Works when copied to ~/.sessionbridge/extensions/kitchen-sink/ as-is.

export async function activate(context) {
  context.log.info('Kitchen Sink activation started');

  // ── State store demonstration ────────────────────────────────
  const visitCount = context.globalState.get('visitCount') ?? 0;
  context.globalState.set('visitCount', visitCount + 1);
  context.workspaceState.set('activatedAt', Date.now());

  context.log.info('Kitchen Sink visit #' + (visitCount + 1));

  // ── Subscriptions (disposed on deactivation) ─────────────────
  context.subscriptions.push({
    dispose: () => {
      context.log.info('Kitchen Sink subscription disposed');
    },
  });

  // Register a timer-based disposable so we can verify cleanup
  const interval = setInterval(() => {
    context.log.verbose('Kitchen Sink heartbeat');
  }, 60000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  context.log.info('Kitchen Sink activated successfully');
}
