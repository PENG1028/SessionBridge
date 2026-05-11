# Extension Capability Benchmarks

> Last updated: 2026-05-11
> Purpose: collect future extension capability cases and reference products so SessionBridge does not accidentally design its plugin system too narrowly.

This document is **not an implementation plan** and does not mean every capability is available today. It is a north-star case library. When adding a new extension point, runtime API, service API, or UI surface, compare the design against these cases and make sure today's shortcut does not make a future capability impossible.

SessionBridge should not be treated as a pure UI plugin host. It is moving toward an **agent/developer automation host** that may support UI, CLI, adapters, tasks, deployments, service callbacks, monitoring, and platform control.

## 1. Capability Map

| Capability | Chinese Name | Reference Products | Current Support | Future Module |
|---|---|---|---|---|
| Visual extension | 可视化插件 | VS Code Webviews, Grafana panels | Partial: host-rendered panels/chrome; no external React loading | Shared UI Catalog, dynamic UI later |
| CLI extension | CLI 插件 | GitHub CLI, Vercel CLI, Railway CLI | Not implemented | `contributes.cli`, command routing |
| Adapter/runtime | 运行时适配器 | VS Code language servers, Claude Code, shell adapters | Implemented for built-ins | Adapter API hardening |
| Task provider | 任务提供器 | Trigger.dev, Inngest, Temporal, GitHub Actions | Not implemented as first-class model | Task/Job Runtime |
| Deployment provider | 部署提供器 | Vercel, Railway, Coolify, Argo CD, Flagger | Not implemented | DeploymentProvider |
| Service plugin | 服务型插件 | Webhook gateway, Cloudflare Workers, ngrok-style callbacks | Not production-ready | Service Plugin Runtime |
| Integration provider | 外部平台集成 | Backstage plugins, GitHub/GitLab integrations | Partial via activation/process/network | IntegrationProvider |
| Monitor provider | 监控提供器 | Grafana, Uptime Kuma, OpenTelemetry | Not implemented | MonitorProvider, health/metrics |
| Configuration | 配置系统 | VS Code Settings | In progress/design | Configuration System |
| Secret storage | 密钥存储 | VS Code SecretStorage, 1Password, Doppler | Not implemented | Secret API/keychain |
| Permission/approval | 权限与审批 | Browser permissions, GitHub App scopes | Basic boolean permissions | Scoped permissions, approval workflow |
| API gateway/rate limit | API 网关/限流 | Kong, Apache APISIX, Zuplo | Not implemented | Gateway/Service Runtime |
| Developer portal | 开发者门户 | Backstage, Port, Cortex | Not implemented | Portal/catalog integration |
| Multi-agent control | 多 Agent 调控 | K8s control plane, Argo, internal IDPs | Partial: instances/nodes exist | Agent distribution/control plane |

## 2. Extension Kinds

Extensions may declare one or more kinds. These kinds describe what the extension **does**, not just where it renders UI.

```ts
type ExtensionKind =
  | 'visual'
  | 'adapter'
  | 'cli'
  | 'task-provider'
  | 'deployment-provider'
  | 'service'
  | 'integration'
  | 'monitor-provider'
  | 'configuration-only';
```

Example:

```json
{
  "id": "trigger-dev",
  "extensionKind": [
    "cli",
    "task-provider",
    "deployment-provider",
    "integration",
    "visual"
  ]
}
```

The manifest field is a future-facing design target. Current manifests may not enforce it yet.

## 3. Design Rules

1. **Action is capability; surface is display location.** UI buttons, CLI commands, context menus, command palette entries, and status items should call the same command/action path.
2. **Do not put runtime concepts into UI-only abstractions.** A deployment, task run, service callback, or monitor check is not a panel.
3. **Do not put long-running jobs into `Instance` unless they are truly runtime instances.** Tasks/jobs need their own model.
4. **Do not let service plugins open arbitrary ports as the default model.** Prefer host-owned gateway routes, auth, rate limits, metrics, and lifecycle.
5. **Do not make SessionBridge a hard dependency of external platforms.** It should be a control-plane enhancer, debugging surface, and automation host.
6. **CLI and UI should share command definitions.** A platform operation should be callable from CLI, command palette, menu, and automation using the same command ID.
7. **Plugin configuration must be schema-driven.** SettingsPanel should not hardcode plugin fields.
8. **Secrets are not normal settings.** API keys, webhooks, tokens, and credentials need a future Secret API even if Phase 1 stores are simpler.
9. **Mobile/desktop behavior is host-owned.** Plugins can declare capability and preference; host decides final placement and fallback.
10. **Current implementation can be smaller than the future model.** Leave explicit extension points and docs so future capabilities remain possible.

## 4. Case: InfraCore Platform Control Plugin

### Chinese / English

平台控制插件 / Platform Control Plugin

### References

- Backstage, Port, Cortex: developer portal and service catalog
- Argo CD, Flagger: deployment/progressive delivery
- Trigger.dev, Inngest: task orchestration
- Grafana, Uptime Kuma: monitoring/health
- Railway, Coolify, Kubero: app platform control
- GitHub CLI, Vercel CLI: CLI-first platform operation

### User Goal

Use a SessionBridge plugin as a temporary or semi-permanent control plane for InfraCore-like platforms: trigger deploys, distribute work to agents, inspect scheduler jobs, view service status, coordinate multi-agent releases, and debug operations.

### Extension Kinds

- `cli`
- `integration`
- `deployment-provider`
- `task-provider`
- `monitor-provider`
- `visual`
- `service` (future)

### Required Host Capabilities

- Configuration System
- Secret Storage
- Unified Command Dispatch
- CLI Contribution
- Task/Job Runtime
- DeploymentProvider
- MonitorProvider
- Multi-node routing
- Audit log
- Notification/Approval
- Shared UI components for status, logs, topology, and runs

### Current Support

- Commands, menus, chrome/contextControls
- Configuration schema declarations
- Adapter/activation logic
- Process/network capability through capability host
- Status bar and dock panel contribution
- Unified command dispatch

### Gaps

- No `contributes.cli`
- No TaskProvider/Job model
- No DeploymentProvider
- No MonitorProvider
- No Secret API
- No multi-node plugin distribution
- External plugins cannot provide complex React panels

### Design Constraints

- Do not make the plugin the InfraCore database, scheduler, or primary control plane.
- Do not put scheduler state into ordinary `Instance`.
- Do not model deployment status as only a UI panel.
- Do not split CLI and UI into separate command systems.
- Deployment, rollback, traffic shifting, and destructive operations must require explicit permission/audit.

### Future Direction

Start with read/control integration: configuration, commands, status, logs, and manual triggers. Add task/deployment providers later. Add service/webhook runtime only after lifecycle, gateway, queue, and permissions are ready.

## 5. Case: Trigger.dev-like Task Platform Integration

### Chinese / English

任务平台集成 / Task Platform Integration

### References

- Trigger.dev
- Inngest
- Temporal
- GitHub Actions
- Cloudflare Queues / Workers Queues

### User Goal

Connect an external task platform, register or trigger jobs, view runs/logs, receive callbacks/webhooks, and route work to local or remote agents.

### Extension Kinds

- `cli`
- `task-provider`
- `integration`
- `visual`
- `service` (for callbacks/webhooks)

### Required Host Capabilities

- Configuration System
- Secret Storage
- Task/Job Runtime
- Service Plugin Runtime
- Webhook Gateway
- Durable Queue
- Logs/Metrics/Health
- Notification/Approval
- Multi-node routing

### Current Support

- Can declare commands/menus/chrome/configuration
- Can run activation logic
- Can use process/network capabilities in trusted code
- Can show simple host-rendered status/control entries

### Gaps

- No first-class TaskProvider
- No durable event queue
- No service/webhook gateway
- No secret storage
- No run/artifact model
- No retry/dead-letter semantics

### Design Constraints

- Do not model a task run as a chat session.
- Do not model task state as only text output.
- Do not let webhook handlers live as arbitrary plugin-owned HTTP servers by default.
- Do not make retry/queue/backpressure each plugin's responsibility.

### Future Direction

Create TaskProvider and JobRun models. Later add Service Plugin Runtime and Durable Queue. UI can then use shared run list, log viewer, metrics, and status components.

## 6. Case: Service Plugin / Webhook Gateway

### Chinese / English

服务型插件 / Service Plugin

### References

- Webhook gateways
- Cloudflare Workers
- ngrok-style callback endpoints
- Kong / Apache APISIX / Zuplo for gateway concepts

### User Goal

Allow an extension to expose stable inbound routes for webhooks, callbacks, or service events without each plugin manually opening ports and implementing auth, retries, metrics, and lifecycle from scratch.

### Extension Kinds

- `service`
- `integration`
- `task-provider`
- `visual`

### Required Host Capabilities

- Host-owned gateway route registry
- Auth/signature verification
- Request size limits
- Rate limiting
- Durable Queue
- Retry/dead-letter policy
- Health checks
- Metrics/logs
- Service lifecycle supervisor
- Permission and audit model

### Current Support

- A plugin could technically start a local server in `activate()` or spawn a process.
- This is suitable for development experiments only.

### Gaps

- No host-owned route gateway
- No restart/supervisor policy
- No queue/backpressure
- No per-plugin rate limits
- No structured metrics
- No route-level permissions
- No HA/clustering

### Design Constraints

- Do not encourage plugins to listen on arbitrary ports as the official model.
- Do not expose public network endpoints without auth/audit.
- Do not accept production traffic without durable queues, backpressure, and observability.

### Future Direction

Design `contributes.services` and `context.services.registerHttpHandler()`. Host owns route, security, lifecycle, metrics, and queue. Plugin owns handler logic.

## 7. Case: Deployment Provider / Progressive Delivery

### Chinese / English

部署提供器 / Deployment Provider

### References

- Vercel
- Railway
- Coolify
- Kubero
- Argo CD
- Flagger
- GitHub Actions

### User Goal

Deploy a workspace or service, inspect deployment state, roll back, run smoke checks, and eventually coordinate traffic shifting, canary, and feature-gated releases.

### Extension Kinds

- `deployment-provider`
- `cli`
- `integration`
- `task-provider`
- `visual`

### Required Host Capabilities

- Configuration and secrets
- DeploymentProvider API
- Task/Job Runtime
- Approval workflow
- Audit log
- Logs/artifacts
- Service health/monitoring
- Optional feature flag integration

### Current Support

- Commands can trigger deploy-like scripts.
- Process capability can run deployment commands.
- UI can show simple status panels if host provides components.

### Gaps

- No deployment entity/model
- No rollback model
- No environment model
- No traffic/canary model
- No approval/audit workflow for deployments
- No artifact model

### Design Constraints

- Do not make deployment just a terminal command.
- Do not make rollback a hidden plugin-specific action.
- Do not mix deployment environments with workspace config casually.
- Destructive operations must be auditable.

### Future Direction

Define deployment entities: Project, Environment, Release, DeploymentRun, Check, Rollback. Let providers implement deploy/rollback/status/logs while host renders shared UI.

## 8. Case: Monitor / Health Provider

### Chinese / English

监控提供器 / Monitor Provider

### References

- Grafana
- Uptime Kuma
- OpenTelemetry
- Datadog-style monitors

### User Goal

Monitor service health, agent heartbeats, queue depth, deployment health, webhook failures, and runtime availability.

### Extension Kinds

- `monitor-provider`
- `integration`
- `visual`
- `service` (optional)

### Required Host Capabilities

- Scheduled checks
- Health state model
- Metrics/log collection
- Alert/notification rules
- Status panels
- Historical event store

### Current Support

- System info and process lists exist.
- Notifications exist in basic form.
- Status bar/chrome can show small health labels.

### Gaps

- No monitor provider API
- No stable metrics store
- No alert rule model
- No health check scheduler
- No uptime/history display

### Design Constraints

- Do not hardcode health checks into UI panels.
- Do not make every plugin implement its own polling/scheduling.
- Do not treat notification display as the monitoring system.

### Future Direction

Add MonitorProvider with check definitions, thresholds, status, metrics, and notification scenarios. Use shared UI for health cards, status lists, and timelines.

## 9. Case: Auth / Billing / Feature Flag / Platform Modules

### Chinese / English

平台业务模块集成 / Platform Module Integration

### References

- Auth/IAM: Keycloak, ZITADEL, Authentik, Logto
- Billing: Meteroid, Kill Bill, Stripe
- Feature flags: Unleash, Flipt, Bucketeer, LaunchDarkly
- Backend platforms: Appwrite, Supabase
- SaaS platform references: Kinde, LaunchFrame, Rook Framework

### User Goal

Integrate platform modules used by an InfraCore-like system: auth, billing, feature flags, entitlement, tenants, quotas, and platform operations.

### Extension Kinds

- `integration`
- `cli`
- `visual`
- `service` (future callbacks)
- `configuration-only`

### Required Host Capabilities

- Configuration System
- Secret Storage
- IntegrationProvider
- Shared UI tables/forms
- Audit/permission model
- Optional service callback support

### Current Support

- Commands/configuration/menus/chrome
- Activation logic can call APIs
- Host-rendered panels if a component override exists

### Gaps

- No secret storage
- No shared DataTable/Form component catalog for external plugins
- No integration provider contract
- No callback/service runtime

### Design Constraints

- Do not embed platform business modules into SessionBridge core.
- Do not make SessionBridge the source of truth for auth/billing/flags.
- Treat SessionBridge as operator/control-plane tooling unless deliberately building a product module.

### Future Direction

Let plugins act as connectors/control surfaces for platform modules. Keep the platform's own database/model authoritative.

## 10. Case: Developer Portal / Internal Platform

### Chinese / English

开发者门户 / Internal Developer Portal

### References

- Backstage
- Port
- Cortex
- CNCF platform engineering case studies

### User Goal

Expose service catalog, runbooks, self-service actions, docs, environments, owners, and operational status through a unified interface.

### Extension Kinds

- `visual`
- `integration`
- `cli`
- `task-provider`
- `monitor-provider`

### Required Host Capabilities

- Entity/catalog model
- Relation graph
- Shared UI catalog
- Search
- Permissions/RBAC
- Task/deployment/monitor providers

### Current Support

- Workbench/panels/chrome can host some surfaces.
- Commands and menus can trigger self-service actions.

### Gaps

- No catalog/entity model
- No relation graph
- No portal-specific search
- External plugin UI is limited

### Design Constraints

- Do not turn SettingsPanel or Dashboard into a developer portal by accident.
- Do not hardcode platform entities into core.
- If catalog is added, make it a model/provider, not only UI.

### Future Direction

Add CatalogProvider/Entity model only when needed. Until then, keep platform portal integrations as plugins that consume external APIs.

## 11. Case: Multi-Agent Distribution and Control

### Chinese / English

多 Agent 分发与调控 / Multi-Agent Distribution and Control

### References

- Kubernetes control plane concepts
- Argo CD application controller
- Worker pool/orchestrator systems
- Internal automation platforms

### User Goal

Distribute commands, deployments, checks, or tasks across multiple SessionBridge nodes/agents; observe status; retry failed operations; coordinate rollouts.

### Extension Kinds

- `task-provider`
- `deployment-provider`
- `monitor-provider`
- `integration`
- `visual`

### Required Host Capabilities

- Node registry
- Agent capability discovery
- Task/Job Runtime
- Routing and assignment
- Durable state
- Permission/audit
- Observability

### Current Support

- Nodes/instances exist in the runtime architecture.
- Some remote agent paths exist.
- Workbench can display instances and state.

### Gaps

- No first-class assignment model
- No scheduler
- No durable distributed task state
- No plugin distribution across nodes
- No role/capability matching API

### Design Constraints

- Do not overload `activeInstanceId` or UI focus for distributed scheduling.
- Do not make one browser tab the source of truth for multi-agent operations.
- Do not hide assignment/retry/rollback inside a visual panel.

### Future Direction

Define Node, AgentCapability, Task, Assignment, Run, Artifact, and Result as explicit models. Scheduler can remain separate and integrate through provider APIs.

## 12. Case: Shared UI Component Catalog

### Chinese / English

共享 UI 组件目录 / Shared UI Component Catalog

### References

- VS Code TreeView/Webview split
- Grafana panels
- Backstage entity tables
- Retool/internal tool components

### User Goal

Let plugins build useful UI without shipping arbitrary React at first. Host provides stable components, plugins provide schema/data/actions.

### Extension Kinds

- `visual`
- `integration`
- `monitor-provider`
- `task-provider`

### Required Host Capabilities

- Component catalog
- Data provider contracts
- Action integration
- Context menu provider
- Mobile fallback
- Theming/density rules

### Current Support

- Host has some components: panels, file explorer, process list, logs, terminal.
- External plugins cannot dynamically ship React panels.

### Gaps

- No formal component catalog
- No data schema for ResourceTree/DataTable/LogViewer/Timeline/FormPanel
- No external plugin renderer contract

### Design Constraints

- Do not let every plugin build its own tree/table/log UI.
- Do not open arbitrary React loading too early without security/versioning/CSS isolation.
- Host should own layout, mobile fallback, and menu primitives.

### Future Direction

Introduce host components such as `ResourceTree`, `DataTable`, `LogViewer`, `Timeline`, `KeyValueList`, and `FormPanel`. Later consider dynamic React loading after install/security model matures.

## 13. Reference Links

These references are starting points for design comparison. They do not imply direct dependency or implementation parity.

- Kinde: https://www.kinde.com/blog/engineering/why-we-built-an-all-in-one-developer-platform/
- Appwrite: https://appwrite.io/
- Zepto CNCF case study: https://www.cncf.io/announcements/2025/08/05/zepto-wins-cncf-end-user-case-study-contest
- Backstage: https://backstage.io/
- Port: https://www.getport.io/
- Flagger: https://fluxcd.io/flagger/
- Kubero: https://github.com/kubero-dev/kubero
- Unleash: https://www.getunleash.io/
- Flipt: https://www.flipt.io/
- Meteroid: https://github.com/meteroid-oss/meteroid
- Kill Bill: https://killbill.io/
- Keycloak: https://www.keycloak.org/
- ZITADEL: https://zitadel.com/
- Authentik: https://goauthentik.io/
- Trigger.dev: https://trigger.dev/
- Inngest: https://www.inngest.com/
- Temporal: https://temporal.io/

## 14. How To Use This Document

Before adding a new extension point or runtime API:

1. Pick the closest case in this document.
2. Identify whether the feature is UI, CLI, service, task, deployment, monitor, integration, or configuration.
3. Check the design constraints.
4. If current implementation is intentionally smaller, document the future path.
5. Avoid hardcoding a product-specific shortcut into core when it belongs to a provider or plugin capability.

