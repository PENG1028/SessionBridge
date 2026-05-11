# Shared UI API

Shared UI components and their contracts.

## Dock System Status

Current implementation supports `left` and `right` dock areas through `LeftSidebar` / `RightSidebar` and `PanelRegistration.side`. The product model is broader:

| Concept | Current status | Target |
|---|---|---|
| Dock areas | `left`, `right` implemented | `left`, `right`, `bottom`, `floating` |
| Panel order | Persisted per side globally | Persist per Focus Scope / Dock Profile |
| Collapse state | Persisted globally by panel id | Persist per Focus Scope / Dock Profile |
| Panel size | Not first-class | Persist per Focus Scope / Dock Profile |
| Mobile mapping | Partially via mobile sidebar | Host maps dock areas to drawer/sheet/fullscreen |

Dock areas are stable host layout regions. Focus changes should filter dock panels and restore a profile; they should not destroy the whole dock area.

## DockPanelFrame

Location: `app/console/sidebar/panel-dnd-wrapper.tsx`

Unified wrapper for all sidebar panels. Renders a consistent header (title, icon, actions, collapse chevron, drag handle) and children body.

```typescript
interface DockPanelFrameProps {
  panelId: string;                                                  // unique panel ID, used for collapse localStorage key + DnD
  title: string;                                                    // display title in header
  icon?: ReactNode;                                                 // icon element rendered in header (resolved from PanelRegistration.icon)
  actions?: ReactNode;                                              // action buttons in header (resolved from PanelRegistration.getActions)
  children: ReactNode;                                              // panel body — always mounted (hidden when collapsed via CSS)
  onReorder: (dragId: string, targetId: string) => void;            // called when this panel is dropped on another
}
```

### Behavior Contract

| Feature | Implementation |
|---------|---------------|
| **Collapse** | Chevron button toggles collapse, currently persisted to localStorage key `sessionbridge-collapsed-panels` as JSON string array. Target: scope by Dock Profile. |
| **Drag & Drop** | Absolute-positioned drag handle on the left edge, visible on group hover. Drop indicator is an absolute `2px` purple line overlay |
| **Actions** | Rendered in header right side, always visible regardless of collapse state |
| **Children** | Always mounted in the React tree; hidden via `className="hidden"` when collapsed. Rationale: panels with internal timers/polling (e.g. InstanceList) continue to work |
| **Sync** | Collapse state re-reads from localStorage when `panelId` changes (DnD replacement) |

### Collapse Persistence

```typescript
const COLLAPSE_KEY = 'sessionbridge-collapsed-panels';
// Format: string[] of panel IDs that are collapsed
```

### Panel Order Persistence

```typescript
const ORDER_KEY = 'sessionbridge-sidebar-order';
// Format: { left: string[], right: string[] } — panel IDs in display order

function loadPanelOrder(side: 'left' | 'right'): string[] | null;
function savePanelOrder(side: 'left' | 'right', order: string[]): void;
function applyPanelOrder<T extends { id: string }>(panels: T[], savedOrder: string[] | null): T[];
```

## PanelRegistration

Location: `app/console/panels/panel-registry.ts`

```typescript
interface PanelRegistration {
  id: string;
  side: 'left' | 'right';
  title: string;
  order: number;
  when?: string;                                            // when-condition for visibility (evaluateWhen syntax)
  component: ComponentType<any>;                            // React component rendered in the panel body
  icon?: ComponentType<{ className?: string }>;             // Icon component resolved at sidebar render time
  getActions?: (props: Record<string, any>) => ReactNode;    // Action buttons resolved at sidebar render time
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
  leftViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string }[],
  rightViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string }[],
): void;
```

Core panels (registered before sync) are never overwritten by extension panels.

### Core Panel Registrations

Defined in `app/console/panels/register-core-panels.tsx`.

| ID | Side | Order | Icon | Actions |
|----|------|-------|------|---------|
| `files` | left | 10 | `Folder` | Upload button → `emitPanelAction('files-upload')` |
| `instances` | left | 20 | `Cpu` | New Instance button → `emitPanelAction('instances-new')` |
| `quick-actions` | left | 30 | `Zap` | — |
| `session-actions` | right | 20 | `Play` | — |
| `snapshots` | right | 30 | `Camera` | — |
| `files-context` | right | 40 | `FileText` | — |
| `terminal-log` | right | 50 | `Terminal` | — |

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

Resolution order for `instanceId`: `paneFocus.instanceId` only. `activeInstanceId` is a sidebar/management selection and must not be used as a fallback for UI focus.

## WorkbenchContext

Location: `app/console/workbench/workbench-context.tsx`

Provides session-level state (messages, phase, input, instances, etc.) to the main workbench area. See the source file for the complete `WorkbenchContextValue` interface.
