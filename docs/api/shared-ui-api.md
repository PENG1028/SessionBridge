# Shared UI API

Shared UI components and their contracts.

## Dock System Status

Current implementation supports `left` and `right` dock areas through `LeftSidebar` / `RightSidebar` and `PanelRegistration.side`. The product model is broader:

| Concept | Current status | Target |
|---|---|---|
| Dock areas | `left`, `right` implemented | `left`, `right`, `bottom`, `floating` |
| Panel order | Persisted per view Dock Profile | Persist per Focus Scope / Dock Profile |
| Collapse state | Persisted per view Dock Profile | Persist per Focus Scope / Dock Profile |
| Panel size | API prepared, resize UI pending | Persist per Focus Scope / Dock Profile |
| Mobile mapping | Partially via mobile sidebar | Host maps dock areas to drawer/sheet/fullscreen |

Dock areas are stable host layout regions. Focus changes should filter dock panels and restore a profile; they should not destroy the whole dock area.

## DockPanelFrame

Location: `app/console/sidebar/panel-dnd-wrapper.tsx`

Unified wrapper for all sidebar panels. Renders a consistent header (title, icon, actions, collapse chevron, drag handle) and children body.

```typescript
interface DockPanelFrameProps {
  panelId: string;                                                  // unique panel ID, used for collapse state + DnD
  title: string;                                                    // display title in header
  icon?: ReactNode;                                                 // icon element rendered in header (resolved from PanelRegistration.icon)
  profileKey: string;                                               // dock profile key for persisting collapse state per view scope
  actions?: ReactNode;                                              // action buttons in header (resolved from PanelRegistration.getActions)
  children: ReactNode;                                              // panel body — always mounted (hidden when collapsed via CSS)
  onReorder: (dragId: string, targetId: string) => void;            // called when this panel is dropped on another
}
```

### Behavior Contract

| Feature | Implementation |
|---------|---------------|
| **Collapse** | Chevron button toggles collapse, persisted per view Dock Profile. |
| **Drag & Drop** | Absolute-positioned drag handle on the left edge, visible on group hover. Drop indicator is an absolute `2px` purple line overlay |
| **Actions** | Rendered in header right side, always visible regardless of collapse state |
| **Children** | Always mounted in the React tree; hidden via `className="hidden"` when collapsed. Rationale: panels with internal timers/polling (e.g. InstanceList) continue to work |
| **Sync** | Collapse state re-reads from Dock Profile when `profileKey` or `panelId` changes (focus switch or DnD replacement) |

### Collapse Persistence

See `app/console/sidebar/dock-profile.ts`:

```typescript
function isPanelCollapsed(profileKey: string, panelId: string): boolean;
function setPanelCollapsed(profileKey: string, panelId: string, collapsed: boolean): void;
```

Stored under `sessionbridge-dock-profiles` key as a JSON object keyed by profile key (`view:<viewType>`).

### Panel Order Persistence

See `app/console/sidebar/dock-profile.ts`:

```typescript
function loadPanelOrder(area: DockArea, profileKey: string): string[] | null;
function savePanelOrder(area: DockArea, profileKey: string, order: string[]): void;
function applyPanelOrder<T extends { id: string }>(panels: T[], savedOrder: string[] | null): T[];
```

Legacy keys `sessionbridge-sidebar-order` and `sessionbridge-collapsed-panels` are migrated on first read and then cleared.

## DockProfile

Location: `app/console/sidebar/dock-profile.ts`

```typescript
type DockArea = 'left' | 'right';

interface DockProfileState {
  order?: Partial<Record<DockArea, string[]>>;
  collapsed?: string[];
  sizes?: Record<string, number>;
}

// Public API
function loadPanelOrder(area: DockArea, profileKey: string): string[] | null;
function savePanelOrder(area: DockArea, profileKey: string, order: string[]): void;
function loadCollapsedPanels(profileKey: string): string[];
function isPanelCollapsed(profileKey: string, panelId: string): boolean;
function setPanelCollapsed(profileKey: string, panelId: string, collapsed: boolean): void;
function loadPanelSize(profileKey: string, panelId: string): number | null;    // API prepared, UI pending
function savePanelSize(profileKey: string, panelId: string, size: number): void;
function applyPanelOrder<T extends { id: string }>(panels: T[], savedOrder: string[] | null): T[];
```

Profile keys are formatted as `view:<viewType>`, e.g. `view:claude-chat`, `view:terminal`. Instance-scoped profiles (`instance:<instanceId>`) are future.

## PanelRegistration

Location: `app/console/panels/panel-registry.ts`

```typescript
interface PanelRegistration {
  id: string;
  side: 'left' | 'right';                                          // Future: replace with dock area
  title: string;
  order: number;
  when?: string;                                                    // when-condition for visibility (evaluateWhen syntax)
  component: ComponentType<any>;                                    // React component rendered in the panel body
  icon?: ComponentType<{ className?: string }>;                     // Icon component resolved at sidebar render time
  getActions?: (props: Record<string, any>) => ReactNode;           // Action buttons resolved at sidebar render time

  // Dock Profile / Layout hints (Phase 4I+, prepared but not enforced)
  defaultSize?: 'compact' | 'normal' | 'expanded' | number;
  minSize?: number;
  maxSize?: number;
  keepMounted?: boolean;
  preferredArea?: 'left' | 'right' | 'bottom' | 'floating';
  allowedAreas?: Array<'left' | 'right' | 'bottom' | 'floating'>;
  mobile?: {
    placement?: 'auto' | 'drawer' | 'sheet' | 'fullscreen' | 'hidden';
    priority?: number;
    custom?: boolean;
  };
}
```

### Registry Functions

```typescript
function registerPanel(reg: PanelRegistration): void;
function unregisterPanel(id: string): void;
function clearPanels(): void;
function getPanels(side: 'left' | 'right', ctx?: WhenContext): PanelRegistration[];
```

### Component Override System

For extension panels declared in server manifests (no React component in registration):

```typescript
function registerPanelComponent(id: string, component: ComponentType<any>): void;
function getPanelComponentOverride(id: string): ComponentType<any> | undefined;
function syncExtensionPanels(
  leftViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string; order?: number }[],
  rightViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string; order?: number }[],
): void;
```

Core panels (registered before sync) are never overwritten by extension panels.
Extension panels without a registered component override are skipped with a dev console warning (`[panel-registry] Skipping extension panel ...`).

### Core Panel Registrations

Defined in `app/console/panels/register-core-panels.tsx`.

| ID | Side | Order | Icon | When | Actions |
|----|------|-------|------|------|---------|
| `files` | left | 10 | `Folder` | _(always)_ | Upload button → `emitPanelAction('files-upload')` |
| `instances` | left | 20 | `Cpu` | _(always)_ | New Instance button → `emitPanelAction('instances-new')` |
| `quick-actions` | left | 30 | `Zap` | `view == "claude-chat"` | — |
| `session-actions` | right | 20 | `Play` | `view == "claude-chat"` | — |
| `snapshots` | right | 30 | `Camera` | `view == "claude-chat"` | — |
| `files-context` | right | 40 | `FileText` | `view == "claude-chat"` | — |
| `terminal-log` | right | 50 | `Terminal` | `view == "terminal"` | — |

### Extension Panel Registrations

Extension panels are declared in adapter manifests (`sb-extension.json` `contributes.views`) and synced via `syncExtensionPanels()`. Core provides React components via `registerPanelComponent()`.

| ID | Side | Order | When | Component Override | Manifest Owner |
|----|------|-------|------|--------------------|----------------|
| `logs` | right | 100 | `view == "claude-chat"` | `LogsPanel` | claude-code |
| `terminal` | right | 100 | `view == "claude-chat"` | `TerminalPanel` | claude-code |
| `tasks` | right | 10 | `view == "claude-chat"` | `TaskPanel` | claude-code |
| `processes` | right | 100 | `view == "terminal"` | `ProcessesPanel` | shell |
| `system` | right | 100 | `view == "dashboard"` | `SystemPanel` | system-info |

## Workbench Chrome Contributions

Status: **Implemented in Phase 4J**. Chrome items are host-rendered declarative contributions from extension manifests. No React injection supported.

Workbench Chrome Contributions are host-rendered lightweight items for the global UI frame. They are different from Dock Panels:

| Surface | Host component | Contribution key | Content |
|---|---|---|---|
| Header | `ConsoleHeader` | `contributes.chrome.header` | Small text buttons, rendered in header right area |
| Status bar | `StatusBar` | `contributes.chrome.statusBar` | Compact text items, left/right sides |
| Key hints | `KeyHintOverlay` | `contributes.chrome.keyHints` | **Legacy** — auto-converted to contextControls (kind: hint, placement: bottom-right) |
| Context controls | `KeyHintOverlay` | `contributes.chrome.contextControls` | Adaptive controls in bottom-right overlay: hints as kbd+label, others as capsules. Max 6, `hidden md:flex` |

Target contribution types:

```typescript
interface HeaderChromeContribution {
  id: string;
  title?: string;
  text?: string;
  icon?: string;
  side?: 'left' | 'right';
  group?: string;
  order?: number;
  when?: string;
  command?: string;
  priority?: 'low' | 'normal' | 'high';
  mobile?: 'show' | 'collapse' | 'hide';
}

interface StatusBarChromeContribution {
  id: string;
  text: string;
  title?: string;
  icon?: string;
  side?: 'left' | 'right';
  group?: string;
  order?: number;
  when?: string;
  command?: string;
  priority?: 'low' | 'normal' | 'high';
  mobile?: 'show' | 'collapse' | 'hide';
}

interface KeyHintChromeContribution {
  id: string;
  label: string;
  keys: string;
  order?: number;
  when?: string;
  command?: string;
  group?: string;
  priority?: 'low' | 'normal' | 'high';
  mobile?: 'show' | 'collapse' | 'hide';
}

// ─── Context Controls (Phase 4J-b — primary model) ─────────

type ContextControlKind =
  | 'hint' | 'button' | 'toggle' | 'menu' | 'progress' | 'approval' | 'jump';

type ContextControlPlacement =
  | 'bottom-left' | 'bottom-right' | 'header-right' | 'status-left' | 'status-right' | 'auto';

interface ContextControlContribution {
  id: string;
  kind: ContextControlKind;
  label: string;
  icon?: string;
  keys?: string;
  placement?: ContextControlPlacement;
  command?: string;
  when?: string;
  order?: number;
  priority?: number;         // Higher = more likely to show, default 50
  group?: string;
  ttlMs?: number;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  mobile?: 'show' | 'collapse' | 'hide';
  variant?: 'default' | 'primary' | 'danger' | 'warning' | 'success';
  reason?: string;
}

interface ChromeContributions {
  header?: HeaderChromeContribution[];
  statusBar?: StatusBarChromeContribution[];
  /** @deprecated Use contextControls with kind: "hint", placement: "bottom-right" instead. */
  keyHints?: KeyHintChromeContribution[];
  contextControls?: ContextControlContribution[];
}
```

Host rendering rules:

| Rule | Implementation |
|---|---|
| Filtering | Items filtered by `when` using pane-focus `WhenContext` in `getHeaderChromeItems()` / `getStatusBarChromeItems()` / `getContextControls()`. |
| Sorting | header/statusBar sort by `side` (left first), then `group`, then `order ?? 100`. Context controls sort by `placement` → `priority` (desc) → `order`. |
| Conflicts | Host/core not applicable yet — all chrome items come from aggregated manifest data. |
| Icons | Icon field captured but not resolved to Lucide icons in Phase 4J. Only `text`/`title` rendered. |
| Commands | Click routes through action registry first (host actions like `host.commandPalette.open`), falling back to `sendCommand` (adapter/runtime commands like `shell.clear`, `shell.kill`). Unknown commands produce dev console warning. |
| Missing `when` | Allowed — item is always visible across all focus contexts. |
| Mobile | Context controls and key hints hidden on mobile (`hidden md:flex`). Header and statusBar items unchanged. |

#### Phase 4J-b Placement Scope

`contextControls` supports multiple `placement` values, but Phase 4J-b only renders the **bottom-right** surface:

| Placement | Rendered in Phase 4J-b | Notes |
|-----------|------------------------|-------|
| `bottom-right` | Yes | Primary placement for the `KeyHintOverlay` |
| `auto` | Yes, as bottom-right | Host fallback — shown at bottom-right; comment noted |
| _(undefined) + kind `hint`_ | Yes, as bottom-right | Legacy keyHint converted to contextControls |
| `header-right` | **No** | Future — use `chrome.header` for header items instead |
| `status-left` | **No** | Future — use `chrome.statusBar` for status items instead |
| `status-right` | **No** | Future — use `chrome.statusBar` for status items instead |
| `bottom-left` | **No** | Future — not yet implemented |

Example manifest:

```json
{
  "contributes": {
    "chrome": {
      "header": [
        {
          "id": "terminal.clear",
          "title": "Clear",
          "icon": "eraser",
          "side": "right",
          "order": 20,
          "when": "view == \"terminal\"",
          "command": "terminal.clear"
        }
      ],
      "statusBar": [
        {
          "id": "terminal.connection",
          "text": "Terminal",
          "side": "left",
          "order": 10,
          "when": "view == \"terminal\""
        }
      ],
      "contextControls": [
        {
          "id": "terminal.stop",
          "kind": "hint",
          "label": "Stop",
          "keys": "Esc",
          "placement": "bottom-right",
          "priority": 90,
          "when": "view == \"terminal\" && isRunning",
          "command": "terminal.stop"
        }
      ]
    }
  }
}
```

Implementation plan:

1. Extend manifest types with `contributes.chrome`.
2. Validate chrome contribution arrays in the extension loader.
3. Aggregate contributions in extension points.
4. Add a client `chrome-registry.ts`.
5. Render header items from `ConsoleHeader`.
6. Render status items from `StatusBar`.
7. Add `KeyHintOverlay`.
8. Migrate simple hardcoded shortcut hints.
9. Add mobile fallback policy.
10. Add diagnostics for ID conflicts, unknown icons, unknown commands, and global plugin-owned items.

#### Phase 4J-b: Context Controls

11. Add `ContextControlContribution` type (kind: hint/button/toggle/menu/progress/approval/jump, placement: bottom-left/bottom-right/header-right/status-left/status-right/auto).
12. Extend `ChromeContributions` with `contextControls`; mark `keyHints` as `@deprecated`.
13. Add manifest validation for contextControls fields (kind, placement, order, priority, ttlMs, mobile, variant, collapsible).
14. Update extension-points aggregation to collect contextControls and convert legacy keyHints.
15. Update chrome-registry with `getContextControls()`, `getContextControlHints()`; sorting by placement → priority (desc) → order.
16. Upgrade `KeyHintOverlay` to render all kinds (hints as kbd+label, others as capsules with variant).
17. Migrate shell and claude-code manifests to use `contextControls` instead of `keyHints`.
18. `getKeyHintItems()` becomes a wrapper around `getContextControls().filter(kind === 'hint')`.

Done: All items are implemented. `keyHints` is legacy compat; `contextControls` is the primary model.

## Notification System

### NotificationProvider

Location: `app/console/shared/notification-context.tsx`

React context providing a global toast notification queue.

```typescript
interface AppNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;          // ms; 0 = persistent, default 4000
  action?: { label: string; onClick: () => void };
}

// Hook
function useNotification(): {
  notifications: AppNotification[];
  notify: (n: Omit<AppNotification, 'id'> & { id?: string }) => void;  // if id matches existing, updates in-place
  dismiss: (id: string) => void;
};
```

### ToastContainer

Location: `app/console/shared/toast-container.tsx`

Renders active notifications as stacked toasts in fixed position `bottom-4 right-4`. Uses `useNotification()`.

### Server Notification Integration

`WSCallback.onSystemNotify` maps directly to `useNotification().notify()`.
`WSCallback.onSystemNotifyDismiss` maps to `useNotification().dismiss()`.

## ContextMenu

Location: `app/console/shell/context-menu.tsx`

See [action-api.md](action-api.md#context-menu) for the component interface.

## Focus System

Location: `app/console/workbench/focus-context.tsx`

```typescript
interface FocusState {
  viewId: string;
  instanceId: string | null;
  adapterId: string | null;
  isRunning: boolean;
  sessionKey: string;
  paneId: string | null;
  paneViewType: string | null;
  whenContext: WhenContext;
  dockProfileKey: string;                      // "view:<viewType>" e.g. "view:claude-chat"
}

interface PaneFocusInfo {
  paneId: string;
  viewType: string;
  instanceId?: string;    // from active tab's bound instance
}

// Hooks
function useFocus(): FocusState;
function useWhenContext(): WhenContext;
```

`dockProfileKey` is derived from the pane focus view type. Always `view:<viewType>`. Never contains `activeInstanceId`. Instance-scoped profiles are future.

Resolution order for `instanceId`: `paneFocus.instanceId` only. `activeInstanceId` is a sidebar/management selection and must not be used as a fallback for UI focus.

## WorkbenchContext

Location: `app/console/workbench/workbench-context.tsx`

Provides session-level state (messages, phase, input, instances, etc.) to the main workbench area. See the source file for the complete `WorkbenchContextValue` interface.
