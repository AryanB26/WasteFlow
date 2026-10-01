/**
 * REROUTE PLANNER
 * Full-featured reroute workflow panel. Opens as a modal overlay when the user
 * clicks "REROUTE" in the RoutePanel. Connects to the real network data model.
 */

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Route as RouteIcon,
  X,
  Zap,
  RotateCcw,
  Play,
  ChevronRight,
} from 'lucide-react'
import { useTwinStore } from '@/state/twinStore'
import { useTwinModel } from '@/hooks/useTwinModel'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import type { AlternativeRoute, ReroutePlan, DiversionAllocation } from '@/engine/rerouteEngine'

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt1(n: number) { return n.toFixed(1) }
function fmt0(n: number) { return Math.round(n).toLocaleString() }

function StatusPill({ label, variant }: { label: string; variant: 'blocked' | 'ok' | 'warn' | 'info' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-[2px] font-mono text-[9px] tracking-[0.14em] border',
        variant === 'blocked' && 'border-critical/60 bg-critical/10 text-critical',
        variant === 'ok'      && 'border-signal/50 bg-signal/10 text-signal',
        variant === 'warn'    && 'border-amber-400/50 bg-amber-400/10 text-amber-400',
        variant === 'info'    && 'border-white/20 bg-white/5 text-ink-dim',
      )}
    >
      {label}
    </span>
  )
}

function DataRow({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[5px]">
      <span className="font-mono text-[9.5px] tracking-[0.1em] text-ink-ghost uppercase">{label}</span>
      <span className={cn('font-mono text-[10.5px] tabular-nums', dim ? 'text-ink-dim' : 'text-ink')}>{value}</span>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-3">
      <span className="font-mono text-[8.5px] tracking-[0.18em] text-ink-ghost uppercase">{children}</span>
      <span className="flex-1 h-px bg-white/8" />
    </div>
  )
}

function ImpactCompare({
  label, current, rerouted, unit, better,
}: {
  label: string; current: number; rerouted: number; unit: string; better?: 'lower' | 'higher'
}) {
  const improved = better === 'lower' ? rerouted < current : rerouted > current
  const changed = Math.abs(rerouted - current) > 0.01
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 items-center py-[5px]">
      <span className="font-mono text-[9px] tracking-[0.1em] text-ink-ghost uppercase w-28 shrink-0">{label}</span>
      <span className="font-mono text-[10.5px] text-ink-dim tabular-nums text-right">{fmt1(current)} {unit}</span>
      <span className={cn(
        'font-mono text-[10.5px] tabular-nums text-right',
        !changed ? 'text-ink-dim' : improved ? 'text-signal' : 'text-amber-400',
      )}>
        {fmt1(rerouted)} {unit}
      </span>
    </div>
  )
}

// ─── Alternative route card ───────────────────────────────────────────────────

function AltCard({
  alt,
  selected,
  allocatedT,
  onToggle,
}: {
  alt: AlternativeRoute
  selected: boolean
  allocatedT: number
  onToggle: () => void
}) {
  const cap = alt.isSufficient ? 'SUFFICIENT' : 'PARTIAL'
  const capVariant = alt.isSufficient ? 'ok' : 'warn'

  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full text-left border transition-all duration-150 px-3 py-2.5',
        selected
          ? 'border-signal/60 bg-signal/8'
          : 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.04]',
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-ink">{alt.route.id}</span>
        <StatusPill label={cap} variant={capVariant} />
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="font-mono text-[9px] text-ink-dim">{alt.route.from}</span>
        <ArrowRight size={10} className="text-ink-ghost" />
        <span className="font-mono text-[9px] text-ink-dim">{alt.route.to}</span>
      </div>
      {alt.route.label && (
        <p className="font-mono text-[8.5px] text-ink-ghost mb-2 leading-relaxed">{alt.route.note?.slice(0, 80)}</p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <DataRow label="Avail. cap." value={`${fmt0(alt.availableCapacityT)} T/DAY`} dim />
        <DataRow label="Can absorb" value={`${fmt0(alt.absorbableT)} T/DAY`} dim />
        <DataRow label="+Distance" value={alt.additionalKm > 0 ? `+${fmt1(alt.additionalKm)} KM` : 'SAME'} dim />
        <DataRow label="+Time" value={alt.additionalMin > 0 ? `+${alt.additionalMin} MIN` : 'SAME'} dim />
        {allocatedT > 0 && (
          <>
            <DataRow label="Allocated" value={`${fmt0(allocatedT)} T/DAY`} />
            <DataRow label="Est. CO₂" value={`${fmt0(alt.additionalCo2Kg)} KG/DAY`} dim />
          </>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <div
          className="h-[3px] rounded-full transition-all duration-300"
          style={{
            width: '100%',
            background: `linear-gradient(to right, ${selected ? '#4FE3C1' : '#ffffff22'} ${(alt.utilizationPct)}%, #ffffff11 ${alt.utilizationPct}%)`,
          }}
        />
        <span className="font-mono text-[8.5px] text-ink-ghost shrink-0">{fmt1(alt.utilizationPct)}% UTIL</span>
      </div>
    </button>
  )
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  plan,
  onConfirm,
  onCancel,
}: {
  plan: ReroutePlan
  onConfirm: () => void
  onCancel: () => void
}) {
  const addCo2 = plan.impact.reroutedCo2Kg - plan.impact.currentCo2Kg
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-[2px]">
      <div className="surface border-hair w-[320px] px-4 py-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={13} className="text-amber-400" strokeWidth={1.75} />
          <span className="font-mono text-[11px] tracking-[0.14em] text-ink">APPLY REROUTE?</span>
        </div>
        <div className="border-l border-hair2 pl-3 mb-3 space-y-1.5">
          <DataRow label="Blocked route" value={plan.blockedRouteId} />
          <DataRow label="Affected flow" value={`${fmt0(plan.affectedFlowT)} T/DAY`} />
          <DataRow label="Diverting to" value={plan.allocations.map((a: DiversionAllocation) => a.routeId).join(' + ')} />
          <DataRow label="Est. addl. CO₂" value={`+${fmt0(Math.max(0, addCo2))} KG/DAY`} />
          {plan.unresolvedT > 0 && (
            <DataRow label="Unresolved" value={`${fmt0(plan.unresolvedT)} T/DAY`} />
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="danger" size="sm" onClick={onConfirm} block>
            Confirm reroute
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel} block>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ReroutePlanner() {
  const rerouteState = useTwinStore(s => s.rerouteState)
  const closeReroute = useTwinStore(s => s.closeReroute)
  const selectRerouteAlternatives = useTwinStore(s => s.selectRerouteAlternatives)
  const simulateReroute = useTwinStore(s => s.simulateReroute)
  const applyReroute = useTwinStore(s => s.applyReroute)
  const restoreOriginalRoute = useTwinStore(s => s.restoreOriginalRoute)
  const model = useTwinModel()

  const [confirmOpen, setConfirmOpen] = useState(false)

  const { status, activeRouteId, plan } = rerouteState

  if (status === 'idle' || !activeRouteId) return null

  const blocked = model.snapshot.routes.find(r => r.id === activeRouteId)
  if (!blocked) return null

  const fromFacility = model.derivedById[blocked.from]?.facility
  const toFacility = model.derivedById[blocked.to]?.facility

  function toggleAlt(id: string) {
    if (!plan) return
    const current = plan.selectedAlternativeIds
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    selectRerouteAlternatives(next, model)
  }

  function getAllocatedT(routeId: string): number {
    return plan?.allocations.find(a => a.routeId === routeId)?.allocatedT ?? 0
  }

  const isApplied = status === 'applied'
  const isSimulated = status === 'simulated' || isApplied
  const canSimulate = (plan?.selectedAlternativeIds.length ?? 0) > 0
  const canApply = isSimulated && canSimulate

  return (
    <AnimatePresence>
      <motion.div
        key="reroute-planner"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="pointer-events-auto absolute inset-0 z-40 flex items-start justify-center overflow-auto py-6 bg-black/55"
        onClick={e => { if (e.target === e.currentTarget) closeReroute() }}
      >
        <motion.div
          initial={{ y: 24, scale: 0.97 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: 16, scale: 0.97 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="surface ticks border-hair shadow-panel relative flex w-[720px] flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {confirmOpen && plan && (
            <ConfirmDialog
              plan={plan}
              onConfirm={() => { applyReroute(); setConfirmOpen(false) }}
              onCancel={() => setConfirmOpen(false)}
            />
          )}

          {/* ── Header ───────────────────────────────────────────── */}
          <header className="flex items-start justify-between border-b border-hair px-4 py-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <RouteIcon size={12} strokeWidth={1.75} className="text-signal/80" />
                <span className="font-mono text-[10px] tracking-[0.18em] text-ink-faint">REROUTE PLANNER</span>
                <StatusPill
                  label={isApplied ? 'APPLIED' : isSimulated ? 'SIMULATED' : 'ANALYZING'}
                  variant={isApplied ? 'ok' : isSimulated ? 'warn' : 'info'}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] uppercase tracking-[0.1em] text-ink">{activeRouteId}</span>
                <span className="font-mono text-[11px] text-ink-ghost">·</span>
                <span className="font-mono text-[11px] uppercase text-ink-dim">
                  {fromFacility?.shortName ?? blocked.from}
                </span>
                <ArrowRight size={12} className="text-ink-ghost" />
                <span className="font-mono text-[11px] uppercase text-ink-dim">
                  {toFacility?.shortName ?? blocked.to}
                </span>
              </div>
            </div>
            <button
              onClick={closeReroute}
              className="focus-ring -mr-1 -mt-0.5 grid h-6 w-6 place-items-center text-ink-faint hover:text-ink"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </header>

          <div className="flex flex-1 overflow-hidden">
            {/* ── Left column: blocked route + alternatives ──────── */}
            <div className="flex w-[340px] shrink-0 flex-col border-r border-hair overflow-y-auto px-4 py-3">

              {/* Blocked corridor facts */}
              <SectionHeader>Blocked corridor</SectionHeader>
              <div className="mb-1">
                <StatusPill label="BLOCKED" variant="blocked" />
              </div>
              <p className="font-mono text-[9px] text-ink-ghost mt-1 mb-3 leading-relaxed">
                {blocked.note ?? 'Corridor is operationally blocked.'}
              </p>
              <div className="grid grid-cols-2 border border-hair divide-x divide-y divide-hair">
                {[
                  ['AFFECTED FLOW', `${fmt0(blocked.volumeT)} T/DAY`],
                  ['HELD LOADS', `${fmt0(blocked.volumeT)} T/DAY`],
                  ['DISTANCE', `${fmt1(blocked.distanceKm)} KM`],
                  ['TRAVEL TIME', `${blocked.travelTimeMin} MIN`],
                  ['VEHICLES', `${plan?.vehiclesAvailable ?? blocked.vehicleCount}`],
                  ['CAPACITY', `${fmt0(blocked.capacityT)} T/DAY`],
                ].map(([l, v]) => (
                  <div key={l} className="px-2.5 py-2">
                    <span className="block font-mono text-[8px] tracking-[0.14em] text-ink-ghost">{l}</span>
                    <span className="block font-mono text-[11.5px] text-ink mt-0.5 tabular-nums">{v}</span>
                  </div>
                ))}
              </div>

              {/* Alternatives */}
              <SectionHeader>Alternative routes</SectionHeader>
              {!plan || plan.alternatives.length === 0 ? (
                <div className="border border-critical/30 bg-critical/5 px-3 py-4 text-center">
                  <AlertTriangle size={16} className="text-critical mx-auto mb-2" />
                  <p className="font-mono text-[10px] text-critical uppercase tracking-[0.12em]">No feasible reroute</p>
                  <p className="font-mono text-[9px] text-ink-ghost mt-1">
                    Available network capacity cannot absorb<br />
                    {fmt0(blocked.volumeT)} T/DAY of affected waste.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {plan.alternatives.map(alt => (
                    <AltCard
                      key={alt.route.id}
                      alt={alt}
                      selected={plan.selectedAlternativeIds.includes(alt.route.id)}
                      allocatedT={getAllocatedT(alt.route.id)}
                      onToggle={() => toggleAlt(alt.route.id)}
                    />
                  ))}
                </div>
              )}

              {/* Capacity summary */}
              {plan && plan.alternatives.length > 0 && (
                <>
                  <SectionHeader>Capacity validation</SectionHeader>
                  <div className="border border-hair px-3 py-2.5 space-y-1">
                    <DataRow label="Affected flow" value={`${fmt0(plan.affectedFlowT)} T/DAY`} />
                    <DataRow label="Total diverted" value={`${fmt0(plan.totalDivertedT)} T/DAY`} />
                    {plan.unresolvedT > 0 ? (
                      <div className="flex items-center justify-between py-[5px]">
                        <span className="font-mono text-[9.5px] tracking-[0.1em] text-ink-ghost uppercase">Unresolved</span>
                        <span className="font-mono text-[10.5px] text-critical">{fmt0(plan.unresolvedT)} T/DAY</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 mt-1">
                        <CheckCircle2 size={11} className="text-signal" />
                        <span className="font-mono text-[9.5px] text-signal tracking-[0.1em]">CAPACITY SUFFICIENT</span>
                      </div>
                    )}
                  </div>

                  {/* Fleet */}
                  <SectionHeader>Vehicle assignment</SectionHeader>
                  <div className="border border-hair px-3 py-2.5 space-y-1">
                    <DataRow label="Affected vehicles" value={`${plan.vehiclesAvailable}`} />
                    <DataRow label="Vehicles required" value={`${plan.vehiclesRequired}`} />
                    {plan.allocations.map(a => (
                      <DataRow key={a.routeId} label={`${a.routeId} trips`} value={`${a.additionalTripsPerDay}/DAY`} dim />
                    ))}
                    {plan.fleetConstrained && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <AlertTriangle size={11} className="text-amber-400" />
                        <span className="font-mono text-[9.5px] text-amber-400 tracking-[0.1em]">FLEET CAPACITY CONSTRAINT</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── Right column: impact preview + actions ─────────── */}
            <div className="flex flex-1 flex-col overflow-y-auto px-4 py-3">
              {/* Multi-route distribution */}
              {plan && plan.allocations.length > 1 && (
                <>
                  <SectionHeader>Flow distribution</SectionHeader>
                  <div className="mb-1 space-y-1.5">
                    {plan.allocations.map(alloc => {
                      const pct = plan.affectedFlowT > 0 ? (alloc.allocatedT / plan.affectedFlowT) * 100 : 0
                      return (
                        <div key={alloc.routeId} className="border border-hair px-3 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-[10px] text-ink">{alloc.routeId}</span>
                            <span className="font-mono text-[10px] text-signal">{fmt0(alloc.allocatedT)} T/DAY</span>
                          </div>
                          <div className="h-[3px] w-full bg-white/8">
                            <div className="h-full bg-signal/70" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                    <div className="border border-signal/30 bg-signal/5 px-3 py-1.5 flex justify-between">
                      <span className="font-mono text-[9.5px] text-signal tracking-[0.1em]">TOTAL DIVERTED</span>
                      <span className="font-mono text-[10px] text-signal">{fmt0(plan.totalDivertedT)} T/DAY</span>
                    </div>
                  </div>
                </>
              )}

              {/* Impact preview */}
              {plan && (
                <>
                  <SectionHeader>Impact preview</SectionHeader>
                  <div className="border border-hair mb-3">
                    <div className="grid grid-cols-3 border-b border-hair px-3 py-1.5">
                      <span className="font-mono text-[8.5px] text-ink-ghost" />
                      <span className="font-mono text-[8.5px] text-ink-ghost text-right">CURRENT</span>
                      <span className={cn(
                        'font-mono text-[8.5px] text-right',
                        isSimulated ? 'text-signal' : 'text-ink-ghost',
                      )}>
                        {isApplied ? 'APPLIED' : isSimulated ? 'SIMULATED' : 'PROJECTED'}
                      </span>
                    </div>
                    <div className="px-3">
                      <ImpactCompare
                        label="Waste delivered"
                        current={0}
                        rerouted={plan.impact.wasteDeliveredT}
                        unit="T/DAY"
                        better="higher"
                      />
                      <ImpactCompare
                        label="Waste held"
                        current={plan.impact.wasteHeldT + plan.totalDivertedT}
                        rerouted={plan.impact.wasteHeldT}
                        unit="T/DAY"
                        better="lower"
                      />
                      <ImpactCompare
                        label="Travel distance"
                        current={plan.impact.currentDistanceKm}
                        rerouted={plan.impact.reroutedDistanceKm}
                        unit="KM"
                        better="lower"
                      />
                      <ImpactCompare
                        label="Travel time"
                        current={plan.impact.currentTravelMin}
                        rerouted={plan.impact.reroutedTravelMin}
                        unit="MIN"
                        better="lower"
                      />
                      <ImpactCompare
                        label="CO₂ emissions"
                        current={plan.impact.currentCo2Kg}
                        rerouted={plan.impact.reroutedCo2Kg}
                        unit="KG/DAY"
                        better="lower"
                      />
                      <ImpactCompare
                        label="Dest. utilisation"
                        current={0}
                        rerouted={plan.impact.destinationUtilizationPct}
                        unit="%"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Map visual cue */}
              {isSimulated && (
                <div className="border border-signal/30 bg-signal/5 px-3 py-2.5 mb-3 flex items-start gap-2">
                  <Zap size={11} className="text-signal mt-0.5 shrink-0" />
                  <div>
                    <p className="font-mono text-[9.5px] text-signal tracking-[0.12em]">
                      {isApplied ? 'DIVERSION ACTIVE' : 'SIMULATION ACTIVE'}
                    </p>
                    <p className="font-mono text-[9px] text-ink-ghost mt-0.5 leading-relaxed">
                      {activeRouteId} remains {isApplied ? 'blocked' : 'blocked'} on the map.
                      Alternative route{plan!.allocations.length > 1 ? 's are' : ' is'} highlighted in cyan.
                    </p>
                  </div>
                </div>
              )}

              {isApplied && (
                <div className="border border-signal/40 bg-signal/8 px-3 py-2.5 mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 size={12} className="text-signal" />
                    <span className="font-mono text-[10px] text-signal tracking-[0.12em]">REROUTE APPLIED</span>
                  </div>
                  <p className="font-mono text-[9px] text-ink-ghost leading-relaxed">
                    Network state updated. {fmt0(plan!.totalDivertedT)} T/DAY diverted.
                    Vehicle assignments updated. Original route remains blocked.
                  </p>
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Action footer */}
              <div className="border-t border-hair pt-3 space-y-2">
                {!isApplied ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      block
                      disabled={!canSimulate}
                      icon={<Play size={11} strokeWidth={1.75} />}
                      onClick={simulateReroute}
                    >
                      {isSimulated ? 'Re-simulate reroute' : 'Simulate reroute'}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      block
                      disabled={!canApply}
                      icon={<ChevronRight size={11} strokeWidth={1.75} />}
                      onClick={() => setConfirmOpen(true)}
                    >
                      Apply reroute
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    block
                    icon={<RotateCcw size={11} strokeWidth={1.75} />}
                    onClick={restoreOriginalRoute}
                  >
                    Restore original route
                  </Button>
                )}
                <Button variant="ghost" size="sm" block onClick={closeReroute}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
