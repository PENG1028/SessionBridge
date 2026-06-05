'use client';

import { useState, useCallback } from 'react';
import { ChevronRight, RefreshCw, Bug } from 'lucide-react';
import { slotRegistry } from '../../../lib/slot-registry';
import type { SlotDeclaration, SlotFilling } from '../../../lib/slot-registry/slot-types';

// ── Types ──────────────────────────────────────────────────────

interface CollapsibleGroupProps {
  label: string;
  count: number;
  defaultOpen?: boolean;
  badgeColor?: string;
  children: React.ReactNode;
}

// ── Shared ─────────────────────────────────────────────────────

/** Collapsible section header with count badge. */
function CollapsibleGroup({
  label,
  count,
  defaultOpen = true,
  badgeColor = 'text-gray-500',
  children,
}: CollapsibleGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left"
      >
        <ChevronRight
          className={`w-2.5 h-2.5 text-gray-600 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="text-[10px] font-semibold text-gray-300 tracking-wider">{label}</span>
        <span
          className={`text-[9px] ${badgeColor} bg-white/[0.04] px-1.5 py-0.5 rounded ml-auto font-mono`}
        >
          {count}
        </span>
      </button>
      {open && count === 0 ? (
        <div className="px-4 pb-2 pt-0.5">
          <span className="text-[9px] text-gray-700 italic">None</span>
        </div>
      ) : null}
      {open && count > 0 ? (
        <div className="pb-1">{children}</div>
      ) : null}
    </div>
  );
}

/** Truncate a long string with ellipsis in the middle. */
function truncateMiddle(str: string, maxLen = 48): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + '...' + str.slice(str.length - half);
}

/** Full string as tooltip attribute. */
function tip(str: string): string | undefined {
  return str.length > 48 ? str : undefined;
}

// ── SlotItem ───────────────────────────────────────────────────

function SlotDeclarationItem({ decl }: { decl: SlotDeclaration }) {
  return (
    <div
      className="flex items-start gap-2 px-4 py-1 hover:bg-white/[0.01]"
      title={tip(decl.slotId)}
    >
      <span className="text-[10px] font-mono text-gray-400 truncate flex-1 min-w-0">
        {truncateMiddle(decl.slotId)}
      </span>
      <span className="text-[8px] text-gray-600 shrink-0 mt-0.5">
        by {truncateMiddle(decl.declaredBy, 24)}
      </span>
    </div>
  );
}

function FillingItem({
  filling,
  isOrphan = false,
}: {
  filling: SlotFilling;
  isOrphan?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-2 px-6 py-0.5 ${
        isOrphan ? 'hover:bg-red-900/10' : 'hover:bg-white/[0.01]'
      }`}
      title={tip(`${filling.fillingId} (plugin: ${filling.pluginId})`)}
    >
      <span
        className={`text-[10px] font-mono truncate flex-1 min-w-0 ${
          isOrphan ? 'text-red-400' : 'text-emerald-400'
        }`}
      >
        {truncateMiddle(filling.fillingId)}
      </span>
      <span
        className={`text-[8px] shrink-0 mt-0.5 ${
          isOrphan ? 'text-red-500' : 'text-gray-600'
        }`}
      >
        {filling.pluginId} {filling.order != null ? `order:${filling.order}` : ''}
      </span>
    </div>
  );
}

function UnfilledSlotItem({ decl }: { decl: SlotDeclaration }) {
  return (
    <div
      className="flex items-start gap-2 px-4 py-1 hover:bg-white/[0.01]"
      title={tip(decl.slotId)}
    >
      <span className="text-[10px] font-mono text-amber-400/80 truncate flex-1 min-w-0">
        {truncateMiddle(decl.slotId)}
      </span>
      <span className="text-[8px] text-gray-600 shrink-0 mt-0.5">
        no fillings
      </span>
    </div>
  );
}

function OrphanItem({ filling }: { filling: SlotFilling }) {
  return (
    <div
      className="flex items-start gap-2 px-4 py-1 hover:bg-red-900/10"
      title={tip(`${filling.fillingId} → ${filling.slotId}`)}
    >
      <span className="text-[10px] font-mono text-red-400 truncate flex-1 min-w-0">
        {truncateMiddle(filling.fillingId)}
      </span>
      <span className="text-[8px] text-red-500 shrink-0 mt-0.5">
        {truncateMiddle(filling.slotId, 24)}
      </span>
    </div>
  );
}

// ── SlotDevTools ───────────────────────────────────────────────

export function SlotDevTools() {
  // Use a render counter to force re-read on refresh
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Read registry state on each render (triggered by refreshKey change)
  const all = slotRegistry.getAll();
  const unfilled = slotRegistry.getUnfilledSlots();
  const orphans = slotRegistry.getOrphans();

  // Derive a flat list of { slotId, fillings[] } for easy rendering
  const slotFillings = Array.from(all.fillings.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="border-t border-amber-900/20 bg-[#0d0d0d]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-amber-900/20">
        <div className="flex items-center gap-2">
          <Bug className="w-3 h-3 text-amber-500/60" />
          <span className="text-[10px] font-semibold text-amber-500/60 tracking-wider">
            Slot Registry DevTools
          </span>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1 text-[9px] text-gray-600 hover:text-gray-400 transition-colors"
        >
          <RefreshCw className="w-2.5 h-2.5" />
          Refresh
        </button>
      </div>

      <div className="divide-y divide-gray-800/20 max-h-[400px] overflow-y-auto">
        {/* ── Declarations ────────────────────────────────────── */}
        <CollapsibleGroup
          label="Declarations"
          count={all.declarations.length}
          badgeColor="text-gray-400"
        >
          {all.declarations.map((decl) => (
            <SlotDeclarationItem key={decl.slotId} decl={decl} />
          ))}
        </CollapsibleGroup>

        {/* ── Fillings ────────────────────────────────────────── */}
        <CollapsibleGroup
          label="Fillings"
          count={slotFillings.reduce((sum, [, f]) => sum + f.length, 0)}
          badgeColor="text-emerald-400"
        >
          {slotFillings.length === 0 && (
            <div className="px-4 pb-2 pt-0.5">
              <span className="text-[9px] text-gray-700 italic">No fillings registered</span>
            </div>
          )}
          {slotFillings.map(([slotId, fillings]) => (
            <div key={slotId}>
              <div
                className="flex items-center gap-2 px-4 py-0.5 mt-1"
                title={tip(slotId)}
              >
                <span className="text-[8px] font-mono text-gray-600 truncate">
                  {truncateMiddle(slotId)}
                </span>
                <span className="text-[8px] text-gray-700 shrink-0">
                  ({fillings.length})
                </span>
              </div>
              {fillings.map((f) => (
                <FillingItem key={f.fillingId} filling={f} />
              ))}
            </div>
          ))}
        </CollapsibleGroup>

        {/* ── Unfilled Slots ──────────────────────────────────── */}
        <CollapsibleGroup
          label="Unfilled Slots"
          count={unfilled.length}
          defaultOpen={unfilled.length > 0}
          badgeColor="text-amber-400"
        >
          {unfilled.length === 0 && (
            <div className="px-4 pb-2 pt-0.5">
              <span className="text-[9px] text-gray-700 italic">All slots have fillings</span>
            </div>
          )}
          {unfilled.map((decl) => (
            <UnfilledSlotItem key={decl.slotId} decl={decl} />
          ))}
        </CollapsibleGroup>

        {/* ── Orphaned Fillings ───────────────────────────────── */}
        <CollapsibleGroup
          label="Orphaned Fillings"
          count={orphans.length}
          defaultOpen={orphans.length > 0}
          badgeColor="text-red-400"
        >
          {orphans.length === 0 && (
            <div className="px-4 pb-2 pt-0.5">
              <span className="text-[9px] text-gray-700 italic">No orphans</span>
            </div>
          )}
          {orphans.length > 0 && (
            <>
              <div className="px-4 pb-1 pt-1">
                <div className="flex items-start gap-2 px-2 py-1.5 bg-red-900/10 border border-red-800/20 rounded">
                  <span className="text-[8px] text-red-400/70 leading-relaxed">
                    These fillings target slots that were never declared. The target
                    component may not be installed.
                  </span>
                </div>
              </div>
              {orphans.map((f) => (
                <OrphanItem key={`${f.slotId}::${f.fillingId}`} filling={f} />
              ))}
            </>
          )}
        </CollapsibleGroup>
      </div>
    </div>
  );
}
