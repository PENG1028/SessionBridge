# Action API

> 2026-05-11 status: this document describes the current partial action systems. The target direction is **Action Surface Registry**: one action contract feeding command palette, context menus, quick actions, header items, status bar items, keybindings, and mobile action sheets. Existing hardcoded surfaces should migrate into host-registered or extension-contributed actions before adding more plugin UI.

Three action/capability systems:

1. **Panel Action Event Bus** — lightweight cross-component signaling for sidebar panels
2. **View Registry** — view registration, adapter-to-view mapping, capability declaractions
3. **Context Menu** — ad-hoc right-click menu contract

## Panel Action Event Bus

Location: `app/console/sidebar/panel-action-events.ts`

A module-level event bus that allows DockPanelFrame header action buttons (rendered from `PanelRegistration.getActions`) to signal their child panel components without direct coupling.

```typescript
// Emit — called from getActions button onClick
function emitPanelAction(id: string): void;

// Subscribe — called from child panel useEffect; returns cleanup function
function onPanelAction(id: string, fn: () => void): () => void;
```

### Current Event IDs

| Event ID | Source Panel | Consumer | Effect |
|----------|-------------|----------|--------|
| `'files-upload'` | Files panel header button | `FilesPanel` | Clicks hidden `<input type="file">` |
| `'instances-new'` | Instances panel header button | `InstancesPanel` | Toggles inline new-instance form |

### Lifecycle

- `listeners` is a module-level `Map<string, Set<() => void>>`
- `onPanelAction(id, fn)` registers the fn and returns a teardown function that removes it from the set
- Used inside `useEffect(() => onPanelAction('id', handler), [])` — the returned teardown runs on unmount
- No scoping beyond string ID; treat IDs as module-level constants

## View Registry

Location: `app/console/main/view-registry.ts`

### View Registration

```typescript
function registerView(viewId: string, entry: ViewRegistryEntry): void;
function unregisterView(viewId: string): void;
function getViewEntry(viewId: string): ViewRegistryEntry | undefined;
function getAllViewEntries(): Array<[string, ViewRegistryEntry]>;
```

### ViewRegistryEntry / ViewMeta

```typescript
interface ViewMeta {
  title: string;
  icon: ComponentType<{ className?: string }>;
  sidebarRequirements?: {
    left?: 'auto' | 'hidden' | 'shown';
    right?: 'auto' | 'hidden' | 'shown';
  };
  chrome?: {
    header?: 'full' | 'minimal' | 'hidden';
    statusBar?: 'auto' | 'hidden' | 'shown';
    commandPalette?: boolean;
    globalShortcuts?: boolean;
  };
  openMode?: 'singleton' | 'instance-bound' | 'session-bound' | 'node-bound' | 'runtime-create';
  showInSelector?: boolean;
  category?: string;
}

interface ViewRegistryEntry {
  component: ComponentType<any>;
  meta: ViewMeta;
}
```

### Adapter-to-View Mapping

Maps adapter types to their preferred view types:

```typescript
function registerAdapterMapping(adapterId: string, viewId: string): void;
function setAdapterViewMap(map: Record<string, string>): void;
function getAdapterViewId(adapterId: string): string | undefined;
function getAdapterIdForView(viewId: string): string | undefined;
```

### Adapter Meta

Display metadata for adapter types:

```typescript
interface AdapterMeta {
  icon: ComponentType<{ className?: string }>;
  label: string;
  emoji: string;
}

function registerAdapterMeta(adapterId: string, meta: AdapterMeta): void;
function getAdapterMeta(adapterId?: string): AdapterMeta;
function getAllAdapterTypes(): Array<{ id: string; meta: AdapterMeta }>;
```

### Capabilities

```typescript
function getAdapterCapabilities(adapterId: string): Record<string, boolean> | undefined;
```

### Chrome Policy Resolution

```typescript
interface ChromePolicy {
  header: 'full' | 'minimal' | 'hidden';
  statusBar: 'auto' | 'hidden' | 'shown';
  commandPalette: boolean;
  globalShortcuts: boolean;
}

function resolveChromePolicy(chrome?: ViewMeta['chrome']): ChromePolicy;
```

### Sync from Server

All three sync functions are called when extension points data arrives from the server:

```typescript
function syncAdapterViewsFromExtensionData(eps: Record<string, unknown> | null): void;
function syncAdapterMetaFromExtensionData(eps: Record<string, unknown> | null): void;
function syncAdapterCapabilitiesFromExtensionData(eps: Record<string, unknown> | null): void;
```

## Context Menu

Location: `app/console/shell/context-menu.tsx`

A self-contained component for right-click menus. No registry — items are passed as props.

```typescript
interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;   // renders in red
  divider?: boolean;  // renders as separator
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}
```

Positioning clamps to window bounds. Closes on `mousedown` outside, scroll, or resize.

## Context Menu Provider Model (Phase 4K)

Location: `app/console/menus/context-menu-types.ts`, `app/console/menus/context-menu-registry.ts`, `app/console/hooks/use-context-menu.ts`

The context menu uses a **three-source model** where the Host owns rendering, positioning, and command dispatch.

### Types

```typescript
// What was clicked
interface ContextMenuTarget {
  kind: string;       // "workbench" | "view" | "terminal" | "chat" | "tab" | "instance" | ...
  id?: string;
  view?: string;
  adapterId?: string;
  instanceId?: string;
  tabId?: string;
  panelId?: string;
  path?: string;
  isDirectory?: boolean;
  messageId?: string;
  blockId?: string;
  rowId?: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}

// Full request to open a menu
interface ContextMenuRequest {
  event: React.MouseEvent | MouseEvent;
  menu?: string;
  chain?: string[];         // Most specific to most generic
  target: ContextMenuTarget;
  whenContext?: Record<string, unknown>;
  localItems?: ContextMenuItemSpec[];
  localOnly?: boolean;
}

// Spec for a single item (supports nesting)
interface ContextMenuItemSpec {
  id: string;
  title: string;
  icon?: string;
  shortcut?: string;
  command?: string;
  args?: Record<string, unknown>;
  when?: string;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  checked?: boolean;
  separator?: boolean;
  group?: string;
  order?: number;
  children?: ContextMenuItemSpec[];
}
```

### Registry API

```typescript
// Sync manifest menus (called in page.tsx useEffect)
function syncContextMenus(data: unknown): void;

// Legacy query by single target (kept for backward compat)
function getContextMenuItems(
  menuTarget: string,
  whenCtx: WhenContext,
  actionRunCtx?: ActionRunContext,
): ResolvedContextMenuItem[];

// Build items from ContextMenuRequest (3-source merge)
function buildMenuItems(
  request: ContextMenuRequest,
  actionRunCtx?: ActionRunContext,
): ResolvedContextMenuItem[];

// Clear all entries
function clearContextMenus(): void;
```

### Three Sources (priority order)

| Source | How | Priority |
|---|---|---|
| Component `localItems` | Passed at call time in `ContextMenuRequest` | Highest |
| Manifest `contributes.menus` | Synced via `syncContextMenus()`, matched by `chain` entries | Medium |
| Action registry with `surfaces: ['contextMenu']` | Registered via `registerAction()` | Lowest |

Items are deduplicated by `id` (earlier source wins), filtered by `when`-condition, and sorted by `group` (`navigation` → `edit` → `debug` → `view`) → `order` → `title`.

### Chain Resolution

The `chain` field allows a menu to collect items from multiple levels of specificity:

```
["message/context", "chat/context", "view/context", "workbench/context"]
```

The registry walks from most specific to most generic, collecting manifest menus that match each entry.

### Command Dispatch

When a menu item is clicked:

1. If `children` exists → open submenu, do not execute.
2. If `command` is set → `getAction(command)?.run({...actionRunCtx, target, args})`.
3. Fallback → `sendCommand(command, { ...args, target })`.
4. Unknown command → `console.warn`.
5. Disabled items do not execute.

### Nested Submenus

`ContextMenuItemSpec.children` enables nested menus. The renderer (`app/console/shell/context-menu.tsx`) recursively renders submenus on hover, positioned to the right with viewport clamping. Items with children do not fire an action.

### Host Hook

```typescript
function useContextMenu(
  actionRunCtx: ActionRunContext,
  whenCtx: WhenContext,
  getAllAdapterTypes: () => { id: string; meta: { label: string } }[],
  projectCwd: string,
  createInstance: (dir: string, label?: string, adapterId?: string) => unknown,
): {
  ctxMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  setCtxMenu: (menu: ...) => void;
  openContextMenu: (request: ContextMenuRequest) => void;
  handleWorkbenchContextMenu: (e: React.MouseEvent) => void;
  closeContextMenu: () => void;
};
```

### Menu Targets

| Target | Chain | Purpose |
|---|---|---|
| `workbench/context` (default) | `['workbench/context']` | Main workbench area |
| `view/context` | `['view/context', 'workbench/context']` | Any view surface |
| `terminal/context` | `['terminal/context', 'view/context', 'workbench/context']` | Terminal area |
| `chat/context` | `['chat/context', 'view/context', 'workbench/context']` | Chat area |
| `tab/context` | `['tab/context', 'view/context', 'workbench/context']` | Pane tabs |
| `instance/context` | `['instance/context', 'workbench/context']` | Instance list items |
| `file/context` | `['file/context', 'view/context', 'workbench/context']` | File tree entries |
| `panel/context` | `['panel/context', 'workbench/context']` | Panel headers |
| `message/context` | `['message/context', 'chat/context', 'view/context', 'workbench/context']` | Chat messages |
