export type TeamId = 'offense' | 'defense'

export type PieceType = 'player' | 'ball'

export type PieceId = `offense-${number}` | `defense-${number}` | 'ball'

export type Point = { x: number; y: number }

export type Piece = {
  id: PieceId
  type: PieceType
  team?: TeamId
  label: string
  name?: string
  pos: Point
}

export type GkOverrides = Partial<Record<TeamId, Point>>

export type PieceSnapshot = {
  id: PieceId
  pos: Point
}

export type Movement = {
  id: PieceId
  from: Point
  to: Point
}

export type PlaybackDirection = 'forward' | 'backward'

export const FORMATIONS_BY_SIZE: Record<7 | 9 | 11, readonly string[]> = {
  7: ['1-2-3-1', '1-2-1-3', '1-1-3-2'],
  9: ['1-3-4-1', '1-4-3-1', '1-3-1-3-1', '1-3-3-2', '1-3-2-3'],
  11: ['1-3-4-3', '1-4-2-3-1', '1-4-4-2', '1-4-1-4-1', '1-3-5-2'],
}

export const DEFAULT_FORMATION: Record<7 | 9 | 11, string> = {
  7: '1-2-3-1',
  9: '1-3-4-1',
  11: '1-3-4-3',
}

const OFFENSE_X = { min: 0.22, max: 0.46 }
const DEFENSE_X = { min: 0.54, max: 0.78 }

const GK_X = {
  offense: 0.09,
  defense: 0.91,
} as const

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function parseFormation(formation: string): number[] {
  return formation.split('-').map((part) => {
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid formation segment: ${part}`)
    }
    return value
  })
}

function formationLayerXs(layerCount: number, team: TeamId): number[] {
  if (layerCount <= 0) return []
  if (layerCount === 1) return [GK_X[team]]

  const out: number[] = new Array(layerCount)
  out[0] = GK_X[team]

  const remaining = layerCount - 1
  if (remaining === 1) {
    out[1] =
      team === 'offense'
        ? (OFFENSE_X.min + OFFENSE_X.max) / 2
        : (DEFENSE_X.min + DEFENSE_X.max) / 2
    return out
  }

  if (team === 'offense') {
    for (let i = 0; i < remaining; i++) {
      const t = i / (remaining - 1)
      out[i + 1] = OFFENSE_X.min + (OFFENSE_X.max - OFFENSE_X.min) * t
    }
    return out
  }

  for (let i = 0; i < remaining; i++) {
    const t = i / (remaining - 1)
    out[i + 1] = DEFENSE_X.max - (DEFENSE_X.max - DEFENSE_X.min) * t
  }
  return out
}

function ysForLine(playerCount: number): number[] {
  if (playerCount <= 0) return []
  if (playerCount === 1) return [0.5]
  return Array.from({ length: playerCount }, (_, index) => {
    const margin = 0.1
    const span = 1 - 2 * margin
    return margin + (span * (index + 0.5)) / playerCount
  })
}

export function positionsFromFormation(formation: string, team: TeamId): Point[] {
  const layers = parseFormation(formation)
  const sum = layers.reduce((acc, current) => acc + current, 0)
  if (sum === 0) return []

  const xs = formationLayerXs(layers.length, team)
  const out: Point[] = []

  for (let i = 0; i < layers.length; i++) {
    const count = layers[i]
    const x = xs[i]
    const ys = ysForLine(count)
    for (let k = 0; k < count; k++) {
      out.push({ x, y: ys[k] })
    }
  }

  return out
}

export function buildPieces(
  teamSize: 7 | 9 | 11,
  offenseFormation: string,
  defenseFormation: string,
  gkOverrides?: GkOverrides,
): Piece[] {
  const offense = positionsFromFormation(offenseFormation, 'offense')
  const defense = positionsFromFormation(defenseFormation, 'defense')

  const offensePlayers: Piece[] = offense.slice(0, teamSize).map((pos, idx) => ({
    id: `offense-${idx + 1}`,
    type: 'player',
    team: 'offense',
    label: String(idx + 1),
    pos: idx === 0 && gkOverrides?.offense ? gkOverrides.offense : pos,
  }))

  const defensePlayers: Piece[] = defense.slice(0, teamSize).map((pos, idx) => ({
    id: `defense-${idx + 1}`,
    type: 'player',
    team: 'defense',
    label: String(idx + 1),
    pos: idx === 0 && gkOverrides?.defense ? gkOverrides.defense : pos,
  }))

  const ball: Piece = {
    id: 'ball',
    type: 'ball',
    label: 'ball',
    pos: { x: 0.5, y: 0.5 },
  }

  return [...offensePlayers, ...defensePlayers, ball]
}

export function snapshotPieces(pieces: Piece[]): PieceSnapshot[] {
  return pieces.map((piece) => ({ id: piece.id, pos: piece.pos }))
}

export function snapshotsToMap(snaps: PieceSnapshot[]): Map<PieceId, Point> {
  const map = new Map<PieceId, Point>()
  for (const snap of snaps) {
    map.set(snap.id, snap.pos)
  }
  return map
}

export function interpolateStepPositions(
  pieces: Piece[],
  movements: Movement[],
  t: number,
  direction: PlaybackDirection,
): Piece[] {
  return pieces.map((piece) => {
    const movement = movements.find((mv) => mv.id === piece.id)
    if (!movement) return piece
    const from = direction === 'forward' ? movement.from : movement.to
    const to = direction === 'forward' ? movement.to : movement.from
    return {
      ...piece,
      pos: {
        x: clamp01(from.x + (to.x - from.x) * t),
        y: clamp01(from.y + (to.y - from.y) * t),
      },
    }
  })
}
