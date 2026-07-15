import { NodeObject } from 'force-graph'
import { initialColoring, initialVisuals } from '../config'
import { CommunityNames } from '../../util/communityNames'
import { getThemeColor } from '../../util/getThemeColor'
import { hexToRGBA } from '../../util/hexToRGBA'

type Point = [number, number]

// Andrew's monotone chain, returns hull in counter-clockwise order
const convexHull = (points: Point[]): Point[] => {
  if (points.length < 3) {
    return points
  }
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

const centroidOf = (points: Point[]): Point => {
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0])
  return [sum[0] / points.length, sum[1] / points.length]
}

// Communities are rarely perfectly separated in the layout; a few stray
// members would blow a hull up to cover the whole graph. Keep only the
// points reasonably close to the community's centroid.
const trimOutliers = (points: Point[]): Point[] => {
  if (points.length < 4) {
    return points
  }
  const [cx, cy] = centroidOf(points)
  const dists = points.map(([x, y]) => Math.hypot(x - cx, y - cy))
  const median = [...dists].sort((a, b) => a - b)[Math.floor(dists.length / 2)]
  const cutoff = median * 1.2
  const kept = points.filter((_, i) => dists[i] <= cutoff)
  return kept.length >= 3 ? kept : points
}

export interface DrawCommunitiesProps {
  ctx: CanvasRenderingContext2D
  globalScale: number
  nodes: NodeObject[]
  cluster: { [id: string]: number }
  communityNames: CommunityNames
  visuals: typeof initialVisuals
  coloring: typeof initialColoring
  theme: any
  // 'zones' is meant for onRenderFramePre (behind nodes and links),
  // 'labels' for onRenderFramePost (on top of them)
  layer: 'zones' | 'labels'
}

// Draws a soft convex-hull "zone" behind each community and the community's
// name at the zone's centroid.
export function drawCommunities(props: DrawCommunitiesProps) {
  const { ctx, globalScale, nodes, cluster, communityNames, visuals, coloring, theme, layer } =
    props

  if (coloring.method !== 'community') {
    return
  }
  if (layer === 'zones' ? !coloring.communityZones : !coloring.communityLabels) {
    return
  }

  const communityPoints: { [community: number]: Point[] } = {}
  for (const node of nodes) {
    const community = cluster[node.id as string]
    if (community === undefined || node.x === undefined || node.y === undefined) {
      continue
    }
    communityPoints[community] = communityPoints[community] ?? []
    communityPoints[community].push([node.x!, node.y!])
  }

  const padding = 15
  ctx.save()
  Object.entries(communityPoints).forEach(([communityKey, points]) => {
    const community = Number(communityKey)
    if (points.length < coloring.communityMinSize) {
      return
    }
    const core = trimOutliers(points)
    const communityColor = getThemeColor(
      visuals.nodeColorScheme[community % visuals.nodeColorScheme.length],
      theme,
    )

    if (layer === 'zones') {
      // fill plus a thick round-joined stroke of the same color pads the hull
      // outwards and rounds its corners; their overlap reads as a subtle border
      const hull = convexHull(core)
      ctx.beginPath()
      hull.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      const zoneColor = hexToRGBA(communityColor, coloring.zoneOpacity)
      ctx.fillStyle = zoneColor
      ctx.strokeStyle = zoneColor
      ctx.lineWidth = padding * 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
      ctx.fill()
      return
    }

    const name = communityNames[community]
    if (name) {
      const [x, y] = centroidOf(core)
      // roughly constant on-screen size, clamped in graph units so labels
      // neither dominate when zoomed out nor vanish when zoomed in
      const baseSize = coloring.communityLabelFontSize
      const fontSize = Math.min(Math.max(baseSize / globalScale, baseSize * 0.6), baseSize * 3)
      ctx.font = `bold ${fontSize}px Sans-Serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // an outline in the background color keeps labels readable over links
      ctx.strokeStyle = hexToRGBA(getThemeColor(visuals.backgroundColor, theme), 0.7)
      ctx.lineWidth = fontSize / 6
      ctx.lineJoin = 'round'
      ctx.strokeText(name, x, y)
      ctx.fillStyle = hexToRGBA(communityColor, 0.9)
      ctx.fillText(name, x, y)
    }
  })
  ctx.restore()
}
