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
