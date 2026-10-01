/**
 * REROUTE ENGINE
 * Pure functions over the data model — finds alternative paths, validates
 * capacity, calculates diversion allocations and impact metrics.
 */

import type { Route, Vehicle } from '@/types'
import type { TwinModel } from '@/data/metrics'
import { routeEmissionFactor } from './wasteFlowEngine'

export type RerouteStatus = 'idle' | 'analyzing' | 'simulated' | 'applied'

export interface AlternativeRoute {
  route: Route
  availableCapacityT: number
  absorbableT: number
  isSufficient: boolean
  additionalKm: number
  additionalMin: number
  additionalCo2Kg: number
  utilizationPct: number
}

export interface DiversionAllocation {
  routeId: string
  route: Route
  allocatedT: number
  vehiclesReassigned: number
  additionalTripsPerDay: number
}

export interface RerouteImpact {
  currentDistanceKm: number
  reroutedDistanceKm: number
  currentTravelMin: number
  reroutedTravelMin: number
  wasteDeliveredT: number
  wasteHeldT: number
  currentCo2Kg: number
  reroutedCo2Kg: number
  currentVehicleCount: number
  additionalVehicles: number
  destinationUtilizationPct: number
}

export interface ReroutePlan {
  blockedRouteId: string
  affectedFlowT: number
  heldLoadsT: number
  alternatives: AlternativeRoute[]
  selectedAlternativeIds: string[]
  allocations: DiversionAllocation[]
  totalDivertedT: number
  unresolvedT: number
  vehiclesAvailable: number
  vehiclesRequired: number
  fleetConstrained: boolean
  impact: RerouteImpact
}

export interface RerouteState {
  status: RerouteStatus
  activeRouteId: string | null
  plan: ReroutePlan | null
}

function avgVehicleCapacityForRoute(route: Route, vehicles: Vehicle[]): number {
  const assigned = vehicles.filter(v => v.routeId === route.id)
  if (!assigned.length) return 8
  return assigned.reduce((s, v) => s + v.capacityT, 0) / assigned.length
}

function calculateImpact(
  blocked: Route,
  allocations: DiversionAllocation[],
  model: TwinModel,
): RerouteImpact {
  const currentCo2Kg = blocked.volumeT * blocked.distanceKm * routeEmissionFactor(blocked)
  let reroutedDistanceKm = 0
  let reroutedTravelMin = 0
  let reroutedCo2Kg = 0
  let totalDiverted = 0

  for (const alloc of allocations) {
    const r = alloc.route
    const ef = routeEmissionFactor(r)
    const share = alloc.allocatedT / Math.max(blocked.volumeT, 1)
    reroutedDistanceKm += r.distanceKm * share
    reroutedTravelMin += r.travelTimeMin * share
    reroutedCo2Kg += alloc.allocatedT * r.distanceKm * ef
    totalDiverted += alloc.allocatedT
  }

  const dest = model.derivedById[blocked.to]
  const destCapacity = dest?.facility.capacity ?? 1
  const destCurrentFlow = dest?.inflow ?? 0
  const destinationUtilizationPct = Math.min(
    100,
    ((destCurrentFlow + totalDiverted) / destCapacity) * 100,
  )
  const blockedVehicles = model.snapshot.vehicles.filter(v => v.routeId === blocked.id)

  return {
    currentDistanceKm: blocked.distanceKm,
    reroutedDistanceKm,
    currentTravelMin: blocked.travelTimeMin,
    reroutedTravelMin,
    wasteDeliveredT: totalDiverted,
    wasteHeldT: Math.max(0, blocked.volumeT - totalDiverted),
    currentCo2Kg,
    reroutedCo2Kg,
    currentVehicleCount: blockedVehicles.length || blocked.vehicleCount,
    additionalVehicles: allocations.reduce((s, a) => s + a.vehiclesReassigned, 0),
    destinationUtilizationPct,
  }
}

function findAlternativeRoutes(
  blocked: Route,
  allRoutes: Route[],
  model: TwinModel,
): AlternativeRoute[] {
  const results: AlternativeRoute[] = []
  const blockedIds = new Set(allRoutes.filter(r => r.status === 'blocked').map(r => r.id))

  // Direct alternatives (same from→to)
  const direct = allRoutes.filter(
    r => r.id !== blocked.id && !blockedIds.has(r.id) && r.from === blocked.from && r.to === blocked.to,
  )

  // Via-node alternatives (same from, different via, same final to)
  const viaAlts: Route[] = []
  const fromSame = allRoutes.filter(r => r.id !== blocked.id && !blockedIds.has(r.id) && r.from === blocked.from)
  for (const leg1 of fromSame) {
    const leg2 = allRoutes.find(
      r => r.from === leg1.to && r.to === blocked.to && !blockedIds.has(r.id) && r.id !== blocked.id,
    )
    if (leg2) {
      const currentFlow1 = model.routeDerivedById[leg1.id]?.route.volumeT ?? leg1.volumeT
      const currentFlow2 = model.routeDerivedById[leg2.id]?.route.volumeT ?? leg2.volumeT
      const availCap = Math.min(leg1.capacityT - currentFlow1, leg2.capacityT - currentFlow2)
      viaAlts.push({
        ...leg1,
        id: `${leg1.id}+${leg2.id}`,
        distanceKm: leg1.distanceKm + leg2.distanceKm,
        travelTimeMin: leg1.travelTimeMin + leg2.travelTimeMin,
        capacityT: Math.max(0, availCap) + (model.routeDerivedById[leg1.id]?.route.volumeT ?? leg1.volumeT),
        label: `VIA ${leg1.to}`,
        note: `Two-leg diversion: ${leg1.id} → ${leg2.id}`,
      })
    }
  }

  // Cross-network: same origin, different destination (nearest reachable)
  const crossAlts = allRoutes.filter(
    r =>
      r.id !== blocked.id &&
      !blockedIds.has(r.id) &&
      r.from === blocked.from &&
      r.to !== blocked.to &&
      r.to !== blocked.from,
  )

  const candidates = [...direct, ...viaAlts, ...crossAlts]
  const seen = new Set<string>()

  for (const route of candidates) {
    if (seen.has(route.id)) continue
    seen.add(route.id)

    const currentFlow = model.routeDerivedById[route.id]?.route.volumeT ?? route.volumeT
    const availableCapacityT = Math.max(0, route.capacityT - currentFlow)
    const absorbableT = Math.min(availableCapacityT, blocked.volumeT)
    const isSufficient = availableCapacityT >= blocked.volumeT
    const utilizationPct = route.capacityT > 0 ? (currentFlow / route.capacityT) * 100 : 0
    const additionalKm = Math.max(0, route.distanceKm - blocked.distanceKm)
    const additionalMin = Math.max(0, route.travelTimeMin - blocked.travelTimeMin)
    const emFactor = routeEmissionFactor(route)
    const additionalCo2Kg = blocked.volumeT * route.distanceKm * emFactor

    results.push({ route, availableCapacityT, absorbableT, isSufficient, additionalKm, additionalMin, additionalCo2Kg, utilizationPct })
  }

  results.sort((a, b) => {
    if (a.isSufficient !== b.isSufficient) return a.isSufficient ? -1 : 1
    return a.additionalKm - b.additionalKm
  })

  return results
}

function buildAllocations(
  blocked: Route,
  selectedAlts: AlternativeRoute[],
  vehiclesAvailable: number,
  vehicles: Vehicle[],
): DiversionAllocation[] {
  const allocations: DiversionAllocation[] = []
  let totalDivertedT = 0

  for (const alt of selectedAlts) {
    if (totalDivertedT >= blocked.volumeT) break
    const needed = blocked.volumeT - totalDivertedT
    const absorb = Math.min(needed, alt.availableCapacityT)
    if (absorb <= 0) continue

    const avgCap = avgVehicleCapacityForRoute(alt.route, vehicles)
    const tripsNeeded = Math.ceil(absorb / Math.max(avgCap, 1))
    const vehiclesNeeded = Math.ceil(tripsNeeded / 8)

    allocations.push({
      routeId: alt.route.id,
      route: alt.route,
      allocatedT: absorb,
      vehiclesReassigned: Math.min(vehiclesNeeded, vehiclesAvailable),
      additionalTripsPerDay: tripsNeeded,
    })
    totalDivertedT += absorb
  }

  return allocations
}

export function buildReroutePlan(blockedRouteId: string, model: TwinModel): ReroutePlan {
  const snapshot = model.snapshot
  const blocked = snapshot.routes.find(r => r.id === blockedRouteId)
  if (!blocked) throw new Error(`Route ${blockedRouteId} not found`)

  const blockedVehicles = snapshot.vehicles.filter(v => v.routeId === blockedRouteId)
  const vehiclesAvailable = blockedVehicles.length || blocked.vehicleCount

  const alternatives = findAlternativeRoutes(blocked, snapshot.routes, model)

  // Auto-select greedy: pick sufficient alternatives first
  const autoSelected: string[] = []
  let covered = 0
  for (const alt of alternatives) {
    if (covered >= blocked.volumeT) break
    autoSelected.push(alt.route.id)
    covered += alt.availableCapacityT
  }

  const selectedAlts = alternatives.filter(a => autoSelected.includes(a.route.id))
  const allocations = buildAllocations(blocked, selectedAlts, vehiclesAvailable, snapshot.vehicles)
  const totalDivertedT = allocations.reduce((s, a) => s + a.allocatedT, 0)
  const vehiclesRequired = allocations.reduce((s, a) => s + a.vehiclesReassigned, 0)
  const impact = calculateImpact(blocked, allocations, model)

  return {
    blockedRouteId,
    affectedFlowT: blocked.volumeT,
    heldLoadsT: blocked.volumeT,
    alternatives,
    selectedAlternativeIds: autoSelected,
    allocations,
    totalDivertedT,
    unresolvedT: Math.max(0, blocked.volumeT - totalDivertedT),
    vehiclesAvailable,
    vehiclesRequired,
    fleetConstrained: vehiclesRequired > vehiclesAvailable,
    impact,
  }
}

export function recalculatePlan(
  plan: ReroutePlan,
  selectedIds: string[],
  model: TwinModel,
): ReroutePlan {
  const blocked = model.snapshot.routes.find(r => r.id === plan.blockedRouteId)!
  const selectedAlts = plan.alternatives.filter(a => selectedIds.includes(a.route.id))
  const allocations = buildAllocations(blocked, selectedAlts, plan.vehiclesAvailable, model.snapshot.vehicles)
  const totalDivertedT = allocations.reduce((s, a) => s + a.allocatedT, 0)
  const vehiclesRequired = allocations.reduce((s, a) => s + a.vehiclesReassigned, 0)
  const impact = calculateImpact(blocked, allocations, model)

  return {
    ...plan,
    selectedAlternativeIds: selectedIds,
    allocations,
    totalDivertedT,
    unresolvedT: Math.max(0, plan.affectedFlowT - totalDivertedT),
    vehiclesRequired,
    fleetConstrained: vehiclesRequired > plan.vehiclesAvailable,
    impact,
  }
}
