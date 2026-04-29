export type AnnotateTool = 'move' | 'line' | 'circle' | 'arrow' | 'erase'

export type FieldAnnotation =
  | {
      id: string
      kind: 'line'
      x1: number
      y1: number
      x2: number
      y2: number
      color: string
      strokeLevel: number
    }
  | {
      id: string
      kind: 'circle'
      cx: number
      cy: number
      r: number
      color: string
      strokeLevel: number
    }
  | {
      id: string
      kind: 'arrow'
      x1: number
      y1: number
      x2: number
      y2: number
      color: string
      strokeLevel: number
    }

export const ANNOTATION_COLORS = [
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#eab308',
  '#ffffff',
  '#111827',
  '#a855f7',
  '#f97316',
] as const

export const ANNOTATIONS_STORAGE_KEY = 'soccerCoach.annotations.v1'

export function loadAnnotations(): FieldAnnotation[] {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: FieldAnnotation[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (typeof o.id !== 'string' || typeof o.kind !== 'string') continue
      if (typeof o.color !== 'string' || typeof o.strokeLevel !== 'number')
        continue
      if (o.kind === 'line' || o.kind === 'arrow') {
        if (
          typeof o.x1 === 'number' &&
          typeof o.y1 === 'number' &&
          typeof o.x2 === 'number' &&
          typeof o.y2 === 'number'
        ) {
          out.push(o as FieldAnnotation)
        }
      } else if (o.kind === 'circle') {
        if (
          typeof o.cx === 'number' &&
          typeof o.cy === 'number' &&
          typeof o.r === 'number'
        ) {
          out.push(o as FieldAnnotation)
        }
      }
    }
    return out
  } catch {
    return []
  }
}

export function saveAnnotations(annotations: FieldAnnotation[]) {
  try {
    localStorage.setItem(ANNOTATIONS_STORAGE_KEY, JSON.stringify(annotations))
  } catch {
    // ignore
  }
}

export function strokeLevelToSvgWidth(level: number): number {
  const t = (Math.min(16, Math.max(1, level)) - 1) / 15
  return 0.0011 + t * 0.02
}

function distPointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-14) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const nx = x1 + t * dx
  const ny = y1 + t * dy
  return Math.hypot(px - nx, py - ny)
}

function distPointToCircleOutline(
  px: number,
  py: number,
  cx: number,
  cy: number,
  r: number,
): number {
  return Math.abs(Math.hypot(px - cx, py - cy) - r)
}

export function hitTestAnnotation(
  annotations: FieldAnnotation[],
  x: number,
  y: number,
): string | null {
  let bestId: string | null = null
  let best = Infinity
  const base = 0.022

  for (const a of annotations) {
    if (a.kind === 'line' || a.kind === 'arrow') {
      const w = strokeLevelToSvgWidth(a.strokeLevel)
      const d = distPointToSegment(x, y, a.x1, a.y1, a.x2, a.y2)
      const thresh = base + w * 4
      if (d < thresh && d < best) {
        best = d
        bestId = a.id
      }
    } else {
      const w = strokeLevelToSvgWidth(a.strokeLevel)
      const d = distPointToCircleOutline(x, y, a.cx, a.cy, a.r)
      const thresh = base + w * 4
      if (d < thresh && d < best) {
        best = d
        bestId = a.id
      }
    }
  }
  return bestId
}

/** Normalized isosceles triangle pointing toward (x2,y2) from segment direction; size in viewBox units. */
export function arrowHeadPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number,
): string {
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const bx = x2 - size * Math.cos(ang)
  const by = y2 - size * Math.sin(ang)
  const half = size * 0.55
  const px = half * Math.sin(ang)
  const py = -half * Math.cos(ang)
  return `${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}`
}
