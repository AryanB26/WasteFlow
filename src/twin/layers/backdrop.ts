import type { NetworkGeometry } from '../network'
import type { RenderContext } from '../renderContext'
import { C, rgbaStr, type RGB } from '../palette'
import { hashString, seeded } from '@/lib/utils'
import { label } from '../text'

export interface Backdrop {
  streets: Path2D
  buildings: Path2D
  water: Path2D
  districts: { x: number; y: number; text: string; color: RGB }[]
  halos: { x: number; y: number; r: number; color: RGB }[]
  bounds: { width: number; height: number }
}

/**
 * The city underneath the network. Generated deterministically from node ids so
 * the twin looks identical on every load — it reads as a real municipal plan,
 * not random noise.
 */
export function buildBackdrop(geo: NetworkGeometry, world: { width: number; height: number }): Backdrop {
  const streets = new Path2D()
  const buildings = new Path2D()
  const districts: Backdrop['districts'] = []
  const halos: Backdrop['halos'] = []

  for (const node of geo.nodes) {
    if (node.facility.kind !== 'zone') continue
    const rand = seeded(hashString(node.id) + 17)
    const halfW = 120 + rand() * 34
    const halfH = 96 + rand() * 26

    // Street grid with jittered spacing.
    const cols = 4 + Math.floor(rand() * 2)
    for (let i = 0; i <= cols; i++) {
      const x = node.x - halfW + (i / cols) * halfW * 2 + (rand() - 0.5) * 10
      streets.moveTo(x, node.y - halfH + rand() * 18)
      streets.lineTo(x, node.y + halfH - rand() * 18)
    }
    const rows = 3 + Math.floor(rand() * 2)
    for (let j = 0; j <= rows; j++) {
      const y = node.y - halfH + (j / rows) * halfH * 2 + (rand() - 0.5) * 10
      streets.moveTo(node.x - halfW + rand() * 18, y)
      streets.lineTo(node.x + halfW - rand() * 18, y)
    }

    // Built form: rectangles sized by distance from the district core.
    const blocks = 26 + Math.floor(rand() * 16)
    for (let b = 0; b < blocks; b++) {
      const ang = rand() * Math.PI * 2
      const dist = Math.sqrt(rand())
      const bx = node.x + Math.cos(ang) * dist * halfW
      const by = node.y + Math.sin(ang) * dist * halfH
      const bw = 7 + rand() * 17
      const bh = 6 + rand() * 15
      buildings.rect(bx - bw / 2, by - bh / 2, bw, bh)
    }

    districts.push({
      x: node.x,
      y: node.y - halfH - 26,
      text: node.facility.shortName,
      color: C.ink,
    })
    halos.push({ x: node.x, y: node.y, r: 210, color: node.stateColor })
  }

  // Infrastructure compounds — quieter, larger footprints on the east side.
  for (const node of geo.nodes) {
    if (node.facility.kind === 'zone' || node.facility.kind === 'landfill') continue
    const rand = seeded(hashString(node.id) + 91)
    const halfW = 54 + rand() * 26
    const halfH = 44 + rand() * 20
    for (let i = 0; i <= 3; i++) {
      const x = node.x - halfW + (i / 3) * halfW * 2
      streets.moveTo(x, node.y - halfH)
      streets.lineTo(x, node.y + halfH)
    }
    for (let j = 0; j <= 2; j++) {
      const y = node.y - halfH + (j / 2) * halfH * 2
      streets.moveTo(node.x - halfW, y)
      streets.lineTo(node.x + halfW, y)
    }
    for (let b = 0; b < 10; b++) {
      const bw = 12 + rand() * 26
      const bh = 10 + rand() * 20
      buildings.rect(
        node.x + (rand() - 0.5) * halfW * 1.7 - bw / 2,
        node.y + (rand() - 0.5) * halfH * 1.7 - bh / 2,
        bw,
        bh,
      )
    }
  }

  // Harbour: the coastal city the network serves. Kept in the extreme corners
  // so no piece of the network is ever plotted over water.
  const water = new Path2D()
  water.moveTo(-40, -40) // north quay inlet
  water.lineTo(430, -40)
  water.bezierCurveTo(300, 60, 150, 132, -40, 168)
  water.closePath()
  water.moveTo(-40, world.height + 40) // south dock
  water.lineTo(300, world.height + 40)
  water.bezierCurveTo(215, world.height - 34, 96, world.height - 78, -40, world.height - 96)
  water.closePath()

  return { streets, buildings, water, districts, halos, bounds: world }
}

/** Draws the backdrop: base wash, grid, plan, water, halos. */
export function drawBackdrop(rc: RenderContext, backdrop: Backdrop) {
  const { ctx, camera, width, height } = rc
  const world = backdrop.bounds

  // Base wash — deepest void at the edges, a hint of light over the network.
  ctx.fillStyle = rgbaStr(C.void, 1)
  ctx.fillRect(0, 0, width, height)

  const g = ctx.createRadialGradient(
    width * 0.46,
    height * 0.44,
    0,
    width * 0.46,
    height * 0.44,
    Math.max(width, height) * 0.78,
  )
  const isLight = document.documentElement.classList.contains('light-mode')
  if (isLight) {
    g.addColorStop(0, rgbaStr(C.base, 0.55))
    g.addColorStop(0.45, rgbaStr(C.base, 0.35))
    g.addColorStop(1, rgbaStr(C.void, 0))
  } else {
    g.addColorStop(0, 'rgba(18,26,30,0.55)')
    g.addColorStop(0.45, 'rgba(10,13,16,0.35)')
    g.addColorStop(1, 'rgba(4,5,6,0)')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)

  // World grid — the instrument's millimetre paper.
  const gridStep = 48
  const invScale = 1 / camera.scale
  const worldLeft = camera.x - (width * 0.5) * invScale
  const worldTop = camera.y - (height * 0.5) * invScale
  const worldRight = camera.x + (width * 0.5) * invScale
  const worldBottom = camera.y + (height * 0.5) * invScale

  ctx.save()
  ctx.lineWidth = 1 * invScale
  ctx.strokeStyle = rgbaStr(C.ink, 0.028)
  ctx.beginPath()
  const startX = Math.floor(worldLeft / gridStep) * gridStep
  const startY = Math.floor(worldTop / gridStep) * gridStep
  for (let x = startX; x <= worldRight; x += gridStep) {
    ctx.moveTo(x, worldTop)
    ctx.lineTo(x, worldBottom)
  }
  for (let y = startY; y <= worldBottom; y += gridStep) {
    ctx.moveTo(worldLeft, y)
    ctx.lineTo(worldRight, y)
  }
  ctx.stroke()

  // Sparse brighter grid every 4 cells for depth.
  const major = gridStep * 4
  ctx.strokeStyle = rgbaStr(C.ink, 0.04)
  ctx.beginPath()
  for (let x = Math.floor(worldLeft / major) * major; x <= worldRight; x += major) {
    ctx.moveTo(x, worldTop)
    ctx.lineTo(x, worldBottom)
  }
  for (let y = Math.floor(worldTop / major) * major; y <= worldBottom; y += major) {
    ctx.moveTo(worldLeft, y)
    ctx.lineTo(worldRight, y)
  }
  ctx.stroke()

  // Municipal plan (disabled per user request)
  // ctx.lineWidth = 1.2 * invScale
  // ctx.strokeStyle = rgbaStr(C.ink, 0.05)
  // ctx.stroke(backdrop.streets)
  // ctx.fillStyle = rgbaStr(C.ink, 0.022)
  // ctx.fill(backdrop.buildings)

  // Harbour.
  ctx.fillStyle = rgbaStr(C.base, 0.72)
  ctx.fill(backdrop.water)
  ctx.lineWidth = 1.1 * invScale
  ctx.strokeStyle = rgbaStr(C.glass, 0.22)
  ctx.stroke(backdrop.water)
  // Second shoreline contour, drawn slightly inside the coast for depth.
  ctx.save()
  ctx.clip(backdrop.water)
  ctx.strokeStyle = rgbaStr(C.glass, 0.09)
  ctx.lineWidth = 1 * invScale
  ctx.beginPath()
  ctx.moveTo(430, -40)
  ctx.bezierCurveTo(300, 60, 150, 132, -40, 168)
  ctx.moveTo(300, world.height + 40)
  ctx.bezierCurveTo(215, world.height - 34, 96, world.height - 78, -40, world.height - 96)
  ctx.stroke()
  ctx.restore()

  // District halos — a low glow anchoring each collection zone to the map.
  for (const halo of backdrop.halos) {
    const rg = ctx.createRadialGradient(halo.x, halo.y, 0, halo.x, halo.y, halo.r)
    rg.addColorStop(0, rgbaStr(halo.color, 0.07))
    rg.addColorStop(0.6, rgbaStr(halo.color, 0.02))
    rg.addColorStop(1, rgbaStr(halo.color, 0))
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.arc(halo.x, halo.y, halo.r, 0, Math.PI * 2)
    ctx.fill()
  }

  // District lettering, scaled with the map but clamped for legibility. (disabled per user request)
  // const fit = Math.max(0.55, Math.min(1.6, camera.scale))
  // for (const d of backdrop.districts) {
  //   label(ctx, d.text, d.x, d.y, 15 / fit, rgbaStr(C.ink, 0.062), {
  //     align: 'center',
  //     weight: 500,
  //     tracking: 6 / fit,
  //   })
  // }
  ctx.restore()
}
