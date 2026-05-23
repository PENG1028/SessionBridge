'use client';

import React, { useState } from 'react';
import type { CoreClient } from '../core/core-types';
import { PageHeader, PageEmpty } from './page-utils';

type AccessControlTab = 'users' | 'groups' | 'roles' | 'policy-bindings' | 'service-tokens' | 'plugin-grants' | 'audit';

const TABS: { id: AccessControlTab; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'groups', label: 'Groups' },
  { id: 'roles', label: 'Roles' },
  { id: 'policy-bindings', label: 'Policy Bindings' },
  { id: 'service-tokens', label: 'Service Tokens' },
  { id: 'plugin-grants', label: 'Plugin Grants' },
  { id: 'audit', label: 'Permission Audit' },
];

interface AccessControlProps {
  core: CoreClient;
}

/**
 * Access Control — manage users, groups, roles, policies, tokens.
 * Page skeleton with empty states. Follows ACCESS_CONTROL_WIREFRAMES.md structure.
 * Full API implementation deferred to Phase 2.
 *
 * Calls (Phase 2): auth.users.*, auth.groups.*, auth.roles.*,
 *   auth.policies.*, auth.tokens.*, plugin.permissions.*, auth.audit.list
 */
export function AccessControl({ core: _core }: AccessControlProps) {
  const [activeTab, setActiveTab] = useState<AccessControlTab>('users');

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader title="Access Control" />

      {/* Tab nav */}
      <div className="flex border-b border-gray-800 px-4 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-[10px] font-mono whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 p-4">
        {activeTab === 'users' && (
          <EmptySection
            title="Users"
            description="Manage user accounts. Create, disable, and assign roles."
            api="auth.users.*"
          />
        )}
        {activeTab === 'groups' && (
          <EmptySection
            title="Groups"
            description="Manage user groups for bulk role assignment."
            api="auth.groups.*"
          />
        )}
        {activeTab === 'roles' && (
          <EmptySection
            title="Roles"
            description="Define roles with policy-based access control."
            api="auth.roles.*"
          />
        )}
        {activeTab === 'policy-bindings' && (
          <EmptySection
            title="Policy Bindings"
            description="Bind subjects (users/groups/services) to roles with scope."
            api="auth.policies.*"
          />
        )}
        {activeTab === 'service-tokens' && (
          <EmptySection
            title="Service Tokens"
            description="Generate and revoke API tokens for external clients."
            api="auth.tokens.*"
          />
        )}
        {activeTab === 'plugin-grants' && (
          <EmptySection
            title="Plugin Grants"
            description="View and manage plugin permissions aggregated across all plugins."
            api="plugin.permissions.*"
          />
        )}
        {activeTab === 'audit' && (
          <EmptySection
            title="Permission Audit Log"
            description="Immutable audit trail of all permission changes."
            api="auth.audit.list"
          />
        )}
      </div>
    </div>
  );
}

function EmptySection({ title, description, api }: { title: string; description: string; api: string }) {
  return (
    <div>
      <h3 className="text-[11px] font-mono text-gray-400 mb-1">{title} (Phase 2)</h3>
      <p className="text-[10px] text-gray-500 mb-2">{description}</p>
      <p className="text-[9px] text-gray-600">Core API: {api}</p>
      <div className="mt-4">
        <PageEmpty title={`No ${title.toLowerCase()} yet`} description="Full implementation deferred to Phase 2." />
      </div>
    </div>
  );
}
