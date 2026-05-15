import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './SoccerField.module.css'
import {
  ANNOTATION_COLORS,
  type AnnotateTool,
  type FieldAnnotation,
  arrowHeadPoints,
  hitTestAnnotation,
  loadAnnotations,
  saveAnnotations,
  strokeLevelToSvgWidth,
} from './fieldAnnotations'
import { interpolateStepPositions } from './soccerDomain'
import {
  loadPlaysForUser,
  migrateLocalPlaysToUser,
  savePlaysForUser,
} from '../lib/playsRepository'

type AnnotationDraft =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'freeDraw'; points: Point[] }

type TeamId = 'offense' | 'defense'

type PieceType = 'player' | 'ball'

type PieceId =
  | `offense-${number}`
  | `defense-${number}`
  | 'ball'

type Point = { x: number; y: number } // normalized: 0..1 within field

type Piece = {
  id: PieceId
  type: PieceType
  team?: TeamId
  label: string
  /** Optional display name (jersey # stays in `label`). */
  name?: string
  pos: Point
}

/** Stored without `ball`; keys like `offense-1`, `defense-11`. */
type PlayerNamesMap = Partial<Record<Exclude<PieceId, 'ball'>, string>>

type GkOverrides = Partial<Record<TeamId, Point>>

type PieceSnapshot = {
  id: PieceId
  pos: Point
}

type Movement = {
  id: PieceId
  from: Point
  to: Point
}

type PlaybackDirection = 'forward' | 'backward'

type PlayStep = {
  movements: Movement[]
}

export type SavedPlay = {
  id: string
  name: string
  teamSize: 7 | 9 | 11
  offenseFormation: string
  defenseFormation: string
  gkOverrides: GkOverrides
  startPositions: PieceSnapshot[]
  steps: PlayStep[]
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function isPenEraserInput(pointerType: string, button: number, buttons: number) {
  if (pointerType !== 'pen') return false
  return button === 5 || (buttons & 32) === 32
}

function pressureToStrokeLevel(pressure: number, fallback: number) {
  if (!Number.isFinite(pressure) || pressure <= 0) return fallback
  const normalized = clamp(pressure, 0, 1)
  const curved = Math.pow(normalized, 0.65)
  return Math.round(clamp(1 + curved * 15, 1, 16))
}

function blendStrokeLevel(current: number, next: number) {
  return Math.round(clamp(current * 0.65 + next * 0.35, 1, 16))
}

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const mins = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function offsetAnnotation(
  annotation: FieldAnnotation,
  dx: number,
  dy: number,
): FieldAnnotation {
  if (annotation.kind === 'circle') {
    return {
      ...annotation,
      cx: clamp01(annotation.cx + dx),
      cy: clamp01(annotation.cy + dy),
    }
  }
  if (annotation.kind === 'freeDraw') {
    return {
      ...annotation,
      points: annotation.points.map((point) => ({
        x: clamp01(point.x + dx),
        y: clamp01(point.y + dy),
      })),
    }
  }
  return {
    ...annotation,
    x1: clamp01(annotation.x1 + dx),
    y1: clamp01(annotation.y1 + dy),
    x2: clamp01(annotation.x2 + dx),
    y2: clamp01(annotation.y2 + dy),
  }
}

/** Formations per roster size (a-b-c-…: GK, back line, midfield, forwards, …). */
const FORMATIONS_BY_SIZE: Record<7 | 9 | 11, readonly string[]> = {
  7: ['1-2-3-1', '1-2-1-3', '1-1-3-2'],
  9: ['1-3-4-1', '1-4-3-1', '1-3-1-3-1', '1-3-3-2', '1-3-2-3'],
  11: ['1-3-4-3', '1-4-2-3-1', '1-4-4-2', '1-4-1-4-1', '1-3-5-2'],
}

const DEFAULT_FORMATION: Record<7 | 9 | 11, string> = {
  7: '1-2-3-1',
  9: '1-3-4-1',
  11: '1-3-4-3',
}

/** Horizontal band for each team (normalized x). Offense attacks right; defense is mirrored. */
const OFFENSE_X = { min: 0.22, max: 0.46 }
const DEFENSE_X = { min: 0.54, max: 0.78 }

/** GK sits centered in the penalty area. */
const GK_X = {
  offense: 0.09,
  defense: 0.91,
} as const

const GK_OVERRIDE_STORAGE_KEY = 'soccerCoach.gkOverrides.v1'
const PLAYER_NAMES_STORAGE_KEY = 'soccerCoach.playerNames.v1'

const PLAYER_NAME_MAX = 40

function isPlayerPieceId(s: string): s is Exclude<PieceId, 'ball'> {
  return /^(offense|defense)-\d+$/.test(s)
}

function loadPlayerNames(): PlayerNamesMap {
  try {
    const raw = localStorage.getItem(PLAYER_NAMES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: PlayerNamesMap = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (!isPlayerPieceId(k) || typeof v !== 'string') continue
      const t = v.trim().slice(0, PLAYER_NAME_MAX)
      if (t) out[k] = t
    }
    return out
  } catch {
    return {}
  }
}

function savePlayerNames(names: PlayerNamesMap) {
  try {
    const trimmed: Record<string, string> = {}
    for (const [k, v] of Object.entries(names)) {
      if (!isPlayerPieceId(k) || typeof v !== 'string') continue
      const t = v.trim().slice(0, PLAYER_NAME_MAX)
      if (t) trimmed[k] = t
    }
    localStorage.setItem(PLAYER_NAMES_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore
  }
}

function playerNameFromMap(
  names: PlayerNamesMap,
  id: PieceId,
): string | undefined {
  if (id === 'ball') return undefined
  return names[id as Exclude<PieceId, 'ball'>]?.trim() || undefined
}

function mergeNamesOntoPieces(
  pieces: Piece[],
  names: PlayerNamesMap,
): Piece[] {
  return pieces.map((p) => {
    if (p.type === 'ball') return p
    const name = playerNameFromMap(names, p.id)
    return { ...p, name }
  })
}

function isGkPieceId(id: PieceId): id is 'offense-1' | 'defense-1' {
  return id === 'offense-1' || id === 'defense-1'
}

function teamFromGkId(id: 'offense-1' | 'defense-1'): TeamId {
  return id === 'offense-1' ? 'offense' : 'defense'
}

function loadGkOverrides(): GkOverrides {
  try {
    const raw = localStorage.getItem(GK_OVERRIDE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const obj = parsed as Record<string, unknown>

    const out: GkOverrides = {}
    for (const team of ['offense', 'defense'] as const) {
      const v = obj[team]
      if (
        v &&
        typeof v === 'object' &&
        'x' in v &&
        'y' in v &&
        typeof v.x === 'number' &&
        typeof v.y === 'number'
      ) {
        out[team] = { x: clamp01(v.x), y: clamp01(v.y) }
      }
    }
    return out
  } catch {
    return {}
  }
}

function saveGkOverrides(next: GkOverrides) {
  try {
    localStorage.setItem(GK_OVERRIDE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore (private mode / quota / etc.)
  }
}

function snapshotPieces(pieces: Piece[]): PieceSnapshot[] {
  return pieces.map((p) => ({ id: p.id, pos: p.pos }))
}

function snapshotsToMap(snaps: PieceSnapshot[]): Map<PieceId, Point> {
  const m = new Map<PieceId, Point>()
  for (const s of snaps) {
    m.set(s.id, s.pos)
  }
  return m
}

function parseFormation(formation: string): number[] {
  return formation.split('-').map((p) => {
    const n = Number(p)
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Invalid formation segment: ${p}`)
    }
    return n
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

/** Even vertical spacing for n players in one horizontal line (pitch height 0..1). */
function ysForLine(n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [0.5]
  return Array.from({ length: n }, (_, k) => {
    const margin = 0.1
    const span = 1 - 2 * margin
    return margin + (span * (k + 0.5)) / n
  })
}

function positionsFromFormation(formation: string, team: TeamId): Point[] {
  const layers = parseFormation(formation)
  const sum = layers.reduce((a, b) => a + b, 0)
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

function buildPieces(
  teamSize: 7 | 9 | 11,
  offenseFormation: string,
  defenseFormation: string,
  gkOverrides?: GkOverrides,
): Piece[] {
  const offense = positionsFromFormation(offenseFormation, 'offense')
  const defense = positionsFromFormation(defenseFormation, 'defense')

  if (offense.length !== teamSize || defense.length !== teamSize) {
    console.warn(
      'Formation player count mismatch',
      teamSize,
      offenseFormation,
      defenseFormation,
    )
  }

  const offensePlayers: Piece[] = offense.slice(0, teamSize).map((pos, idx) => ({
    id: `offense-${idx + 1}`,
    type: 'player',
    team: 'offense',
    label: String(idx + 1),
    pos:
      idx === 0 && gkOverrides?.offense
        ? gkOverrides.offense
        : pos,
  }))

  const defensePlayers: Piece[] = defense.slice(0, teamSize).map((pos, idx) => ({
    id: `defense-${idx + 1}`,
    type: 'player',
    team: 'defense',
    label: String(idx + 1),
    pos:
      idx === 0 && gkOverrides?.defense
        ? gkOverrides.defense
        : pos,
  }))

  const ball: Piece = {
    id: 'ball',
    type: 'ball',
    label: 'ball',
    pos: { x: 0.5, y: 0.5 },
  }

  return [...offensePlayers, ...defensePlayers, ball]
}

type DragState =
  | {
      pieceId: PieceId
      pointerId: number
      pointerOffsetPx: { x: number; y: number }
      pieceSizePx: { width: number; height: number }
    }
  | undefined

type PendingDragState = {
  pieceId: PieceId
  pointerId: number
  pointerOffsetPx: { x: number; y: number }
  pieceSizePx: { width: number; height: number }
  startClientX: number
  startClientY: number
  target: HTMLElement
}

type AnnotationDragState = {
  annotationId: string
  pointerId: number
  startPointer: Point
  startAnnotation: FieldAnnotation
  hostEl: HTMLElement
}

const DRAG_THRESHOLD_PX = 6
const DOUBLE_TAP_MS = 420
const FREE_DRAW_POINT_MIN_DISTANCE = 0.0025
const FREE_DRAW_MIN_LENGTH = 0.004
const VIDEO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const VIDEO_MARKUP_COLORS = ['red', 'blue', 'yellow', 'white', 'black'] as const

type VideoMarkupColor = (typeof VIDEO_MARKUP_COLORS)[number]

function toVideoMarkupColor(color: string): VideoMarkupColor {
  if ((VIDEO_MARKUP_COLORS as readonly string[]).includes(color)) {
    return color as VideoMarkupColor
  }
  return 'red'
}

function appendFreeDrawPoint(points: Point[], point: Point): Point[] {
  const last = points[points.length - 1]
  if (!last) return [point]
  const distance = Math.hypot(point.x - last.x, point.y - last.y)
  if (distance < FREE_DRAW_POINT_MIN_DISTANCE) return points
  return [...points, point]
}

function freeDrawLength(points: Point[]): number {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    total += Math.hypot(current.x - previous.x, current.y - previous.y)
  }
  return total
}

export type SoccerFieldTab =
  | 'team'
  | 'playerNames'
  | 'recordings'
  | 'annotations'
  | 'playVideo'

const TAB_ITEMS: ReadonlyArray<{ id: SoccerFieldTab; label: string; icon: string }> = [
  { id: 'team', label: 'Team Organization', icon: '⚽' },
  { id: 'playerNames', label: 'Player names', icon: '👤' },
  { id: 'recordings', label: 'Recordings', icon: '⏺' },
  { id: 'annotations', label: 'Annotations', icon: '✏' },
  { id: 'playVideo', label: 'Play Video', icon: '▶' },
]

const TOOL_ITEMS: ReadonlyArray<{ id: AnnotateTool; label: string; icon: string }> = [
  { id: 'move', label: 'Move', icon: '✋' },
  { id: 'line', label: 'Line', icon: '／' },
  { id: 'freeDraw', label: 'Free Draw', icon: '✎' },
  { id: 'circle', label: 'Circle', icon: '◯' },
  { id: 'arrow', label: 'Arrow', icon: '➤' },
  { id: 'erase', label: 'Erase', icon: '⌫' },
]

type SoccerFieldProps = {
  userId: string
  onActiveTabChange?: (tab: SoccerFieldTab) => void
}

type TeamTabletPopover = 'players' | 'offenseFormation' | 'defenseFormation' | null

export function SoccerField({ userId, onActiveTabChange }: SoccerFieldProps) {
  const [teamSize, setTeamSize] = useState<7 | 9 | 11>(11)
  const [offenseFormation, setOffenseFormation] = useState(
    () => DEFAULT_FORMATION[11],
  )
  const [defenseFormation, setDefenseFormation] = useState(
    () => DEFAULT_FORMATION[11],
  )
  const [gkOverrides, setGkOverrides] = useState<GkOverrides>(() =>
    loadGkOverrides(),
  )
  const [playerNames, setPlayerNames] = useState<PlayerNamesMap>(() =>
    loadPlayerNames(),
  )
  const playerNamesRef = useRef<PlayerNamesMap>(playerNames)

  const [pieces, setPieces] = useState<Piece[]>(() =>
    mergeNamesOntoPieces(
      buildPieces(11, DEFAULT_FORMATION[11], DEFAULT_FORMATION[11], loadGkOverrides()),
      loadPlayerNames(),
    ),
  )
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState>(undefined)
  const pendingDragRef = useRef<PendingDragState | null>(null)
  const lastTouchTapRef = useRef<{ pieceId: PieceId; time: number } | null>(
    null,
  )
  const piecesRef = useRef<Piece[]>(pieces)

  const [highlightedPlayerIds, setHighlightedPlayerIds] = useState<
    Set<PieceId>
  >(() => new Set())

  // Play recording / playback state
  const [isRecording, setIsRecording] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftStart, setDraftStart] = useState<PieceSnapshot[] | null>(null)
  const [draftSteps, setDraftSteps] = useState<PlayStep[]>([])
  const [lastSnapshot, setLastSnapshot] = useState<PieceSnapshot[] | null>(null)

  const [plays, setPlays] = useState<SavedPlay[]>([])
  const [playsLoading, setPlaysLoading] = useState(true)
  const [playsError, setPlaysError] = useState<string | null>(null)
  const [selectedPlayId, setSelectedPlayId] = useState<string | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const animationRef = useRef<number | null>(null)
  const playsHydratedRef = useRef(false)

  const [annotateTool, setAnnotateTool] = useState<AnnotateTool>('move')
  const [annotations, setAnnotations] = useState<FieldAnnotation[]>(() =>
    loadAnnotations(),
  )
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(
    null,
  )
  const annotationDraftRef = useRef<AnnotationDraft | null>(null)
  const [annotationColor, setAnnotationColor] = useState('#e11d48')
  const [strokeLevel, setStrokeLevel] = useState(6)
  const annotationDragRef = useRef<AnnotationDragState | null>(null)
  const videoAnnotationDragRef = useRef<AnnotationDragState | null>(null)

  const [activeTab, setActiveTab] = useState<SoccerFieldTab>('team')
  const [selectedOffenseNumber, setSelectedOffenseNumber] = useState(1)
  const [selectedDefenseNumber, setSelectedDefenseNumber] = useState(1)
  const keepControlsVisible =
    activeTab === 'recordings' ||
    activeTab === 'annotations' ||
    activeTab === 'playVideo'

  const [videoAnnotateTool, setVideoAnnotateTool] = useState<AnnotateTool>('move')
  const [videoAnnotations, setVideoAnnotations] = useState<FieldAnnotation[]>([])
  const [videoAnnotationDraft, setVideoAnnotationDraft] =
    useState<AnnotationDraft | null>(null)
  const videoAnnotationDraftRef = useRef<AnnotationDraft | null>(null)
  const [videoSourceUrl, setVideoSourceUrl] = useState<string | null>(null)
  const videoObjectUrlRef = useRef<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoFieldRef = useRef<HTMLDivElement | null>(null)
  const videoFileInputRef = useRef<HTMLInputElement | null>(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1)
  const [videoColorPaletteOpen, setVideoColorPaletteOpen] = useState(false)
  const [videoThicknessOpen, setVideoThicknessOpen] = useState(false)
  const [teamTabletPopover, setTeamTabletPopover] = useState<TeamTabletPopover>(null)
  const activeVideoMarkupColor = toVideoMarkupColor(annotationColor)
  const activePenPointersRef = useRef<Set<number>>(new Set())
  const selectedOffenseId = `offense-${selectedOffenseNumber}` as Exclude<
    PieceId,
    'ball'
  >
  const selectedDefenseId = `defense-${selectedDefenseNumber}` as Exclude<
    PieceId,
    'ball'
  >

  function beginPenSession(pointerId: number, pointerType: string) {
    if (pointerType !== 'pen') return
    activePenPointersRef.current.add(pointerId)
  }

  function endPenSession(pointerId: number) {
    activePenPointersRef.current.delete(pointerId)
  }

  function shouldIgnoreTouch(pointerType: string) {
    return pointerType === 'touch' && activePenPointersRef.current.size > 0
  }

  const formationOptions = FORMATIONS_BY_SIZE[teamSize]

  const pieceById = useMemo(() => {
    const m = new Map<PieceId, Piece>()
    for (const p of pieces) m.set(p.id, p)
    return m
  }, [pieces])

  useEffect(() => {
    piecesRef.current = pieces
  }, [pieces])

  useEffect(() => {
    playerNamesRef.current = playerNames
  }, [playerNames])

  useEffect(() => {
    savePlayerNames(playerNames)
    setPieces((prev) =>
      prev.map((p) => {
        if (p.type === 'ball') return p
        const name = playerNameFromMap(playerNames, p.id)
        return { ...p, name }
      }),
    )
  }, [playerNames])

  useEffect(() => {
    saveAnnotations(annotations)
  }, [annotations])

  useEffect(() => {
    if (activeTab !== 'playVideo') {
      setVideoAnnotations([])
      setVideoAnnotationDraft(null)
      videoAnnotationDraftRef.current = null
      setVideoColorPaletteOpen(false)
      setVideoThicknessOpen(false)
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'team') {
      setTeamTabletPopover(null)
    }
  }, [activeTab])

  useEffect(() => {
    onActiveTabChange?.(activeTab)
  }, [activeTab, onActiveTabChange])

  useEffect(() => {
    let cancelled = false
    playsHydratedRef.current = false
    setPlaysLoading(true)
    setPlaysError(null)

    async function syncFromFirestore() {
      try {
        await migrateLocalPlaysToUser(userId)
        const nextPlays = await loadPlaysForUser(userId)
        if (cancelled) return
        playsHydratedRef.current = true
        setPlays(nextPlays)
        setSelectedPlayId((current) =>
          current && nextPlays.some((play) => play.id === current) ? current : null,
        )
      } catch (err) {
        if (cancelled) return
        setPlaysError(
          err instanceof Error ? err.message : 'Unable to load plays from Firebase.',
        )
      } finally {
        if (!cancelled) {
          setPlaysLoading(false)
        }
      }
    }

    void syncFromFirestore()
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!playsHydratedRef.current) return
    let cancelled = false

    async function persistPlays() {
      try {
        await savePlaysForUser(userId, plays)
        if (!cancelled) setPlaysError(null)
      } catch (err) {
        if (cancelled) return
        setPlaysError(
          err instanceof Error ? err.message : 'Unable to save plays to Firebase.',
        )
      }
    }

    void persistPlays()
    return () => {
      cancelled = true
    }
  }, [plays, userId])

  useEffect(() => {
    return () => {
      if (videoObjectUrlRef.current) {
        URL.revokeObjectURL(videoObjectUrlRef.current)
        videoObjectUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    function onPointerEnd(e: PointerEvent) {
      if (e.pointerType !== 'pen') return
      activePenPointersRef.current.delete(e.pointerId)
    }

    function clearAllPenSessions() {
      activePenPointersRef.current.clear()
    }

    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') {
        clearAllPenSessions()
      }
    }

    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    window.addEventListener('blur', clearAllPenSessions)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      window.removeEventListener('blur', clearAllPenSessions)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    function syncState() {
      const current = videoRef.current
      if (!current) return
      setIsVideoPlaying(!current.paused && !current.ended)
      setVideoCurrentTime(current.currentTime || 0)
      setVideoDuration(Number.isFinite(current.duration) ? current.duration : 0)
      setVideoPlaybackRate(current.playbackRate || 1)
    }
    videoEl.addEventListener('play', syncState)
    videoEl.addEventListener('pause', syncState)
    videoEl.addEventListener('ended', syncState)
    videoEl.addEventListener('loadedmetadata', syncState)
    videoEl.addEventListener('durationchange', syncState)
    videoEl.addEventListener('timeupdate', syncState)
    videoEl.addEventListener('seeked', syncState)
    videoEl.addEventListener('ratechange', syncState)
    syncState()
    return () => {
      videoEl.removeEventListener('play', syncState)
      videoEl.removeEventListener('pause', syncState)
      videoEl.removeEventListener('ended', syncState)
      videoEl.removeEventListener('loadedmetadata', syncState)
      videoEl.removeEventListener('durationchange', syncState)
      videoEl.removeEventListener('timeupdate', syncState)
      videoEl.removeEventListener('seeked', syncState)
      videoEl.removeEventListener('ratechange', syncState)
    }
  }, [videoSourceUrl])

  useEffect(() => {
    if (activeTab !== 'playVideo') return
    const videoEl = videoRef.current
    if (!videoEl) return
    const nextRate = clamp(videoPlaybackRate, 0.25, 3)
    if (Math.abs(videoEl.playbackRate - nextRate) > 0.001) {
      videoEl.playbackRate = nextRate
    }
  }, [activeTab, videoPlaybackRate, videoSourceUrl])

  const commitAnnotation = useCallback(
    (d: AnnotationDraft, color: string, sl: number) => {
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `ann-${Date.now()}-${Math.random().toString(36).slice(2)}`
      if (d.kind === 'freeDraw') {
        if (d.points.length < 2 || freeDrawLength(d.points) < FREE_DRAW_MIN_LENGTH) return
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: 'freeDraw',
            points: d.points,
            color,
            strokeLevel: sl,
          },
        ])
        return
      }
      if (d.kind === 'circle') {
        if (d.r < 0.004) return
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: 'circle',
            cx: d.cx,
            cy: d.cy,
            r: d.r,
            color,
            strokeLevel: sl,
          },
        ])
        return
      }
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1)
      if (len < 0.004) return
      if (d.kind === 'line') {
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: 'line',
            x1: d.x1,
            y1: d.y1,
            x2: d.x2,
            y2: d.y2,
            color,
            strokeLevel: sl,
          },
        ])
      } else {
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: 'arrow',
            x1: d.x1,
            y1: d.y1,
            x2: d.x2,
            y2: d.y2,
            color,
            strokeLevel: sl,
          },
        ])
      }
    },
    [],
  )

  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (annotateTool === 'move') return
      if (shouldIgnoreTouch(e.pointerType)) return
      e.stopPropagation()
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault()
      }
      const fieldEl = fieldRef.current
      if (!fieldEl) return
      const rect = fieldEl.getBoundingClientRect()
      const x = clamp01((e.clientX - rect.left) / rect.width)
      const y = clamp01((e.clientY - rect.top) / rect.height)
      const useEraser = annotateTool === 'erase' || isPenEraserInput(e.pointerType, e.button, e.buttons)

      if (useEraser) {
        const id = hitTestAnnotation(annotations, x, y)
        if (id) {
          setAnnotations((prev) => prev.filter((a) => a.id !== id))
        }
        return
      }

      const svgEl = e.currentTarget

      const tool = annotateTool
      if (tool === 'line' || tool === 'arrow') {
        const draft: AnnotationDraft = {
          kind: tool,
          x1: x,
          y1: y,
          x2: x,
          y2: y,
        }
        annotationDraftRef.current = draft
        setAnnotationDraft(draft)
      } else if (tool === 'freeDraw') {
        const draft: AnnotationDraft = {
          kind: 'freeDraw',
          points: [{ x, y }],
        }
        annotationDraftRef.current = draft
        setAnnotationDraft(draft)
      } else {
        const draft: AnnotationDraft = { kind: 'circle', cx: x, cy: y, r: 0 }
        annotationDraftRef.current = draft
        setAnnotationDraft(draft)
      }

      const pid = e.pointerId
      const colorAtStart = annotationColor
      let strokeAtStart =
        e.pointerType === 'pen'
          ? pressureToStrokeLevel(e.pressure, strokeLevel)
          : strokeLevel
      beginPenSession(pid, e.pointerType)

      try {
        svgEl.setPointerCapture(pid)
      } catch {
        // ignore if capture unsupported
      }

      const moveOpts: AddEventListenerOptions = { passive: false }

      function move(ev: PointerEvent) {
        if (ev.pointerId !== pid) return
        if (ev.pointerType === 'touch' || ev.pointerType === 'pen') ev.preventDefault()
        if (ev.pointerType === 'pen') {
          const penLevel = pressureToStrokeLevel(ev.pressure, strokeAtStart)
          strokeAtStart = blendStrokeLevel(strokeAtStart, penLevel)
        }
        const el = fieldRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const nx = clamp01((ev.clientX - r.left) / r.width)
        const ny = clamp01((ev.clientY - r.top) / r.height)
        const prev = annotationDraftRef.current
        if (!prev) return
        let next: AnnotationDraft
        if (prev.kind === 'circle') {
          const rad = Math.hypot(nx - prev.cx, ny - prev.cy)
          next = { ...prev, r: rad }
        } else if (prev.kind === 'freeDraw') {
          next = {
            ...prev,
            points: appendFreeDrawPoint(prev.points, { x: nx, y: ny }),
          }
        } else {
          next = { ...prev, x2: nx, y2: ny }
        }
        annotationDraftRef.current = next
        setAnnotationDraft(next)
      }

      function up(ev: PointerEvent) {
        if (ev.pointerId !== pid) return
        endPenSession(pid)
        window.removeEventListener('pointermove', move, moveOpts)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        try {
          if (svgEl.hasPointerCapture(pid)) svgEl.releasePointerCapture(pid)
        } catch {
          // ignore
        }
        const final = annotationDraftRef.current
        annotationDraftRef.current = null
        setAnnotationDraft(null)
        if (final) {
          commitAnnotation(final, colorAtStart, strokeAtStart)
        }
      }

      window.addEventListener('pointermove', move, moveOpts)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [annotateTool, annotations, annotationColor, strokeLevel, commitAnnotation],
  )

  const commitVideoAnnotation = useCallback(
    (d: AnnotationDraft, color: string, sl: number) => {
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `video-ann-${Date.now()}-${Math.random().toString(36).slice(2)}`
      if (d.kind === 'freeDraw') {
        if (d.points.length < 2 || freeDrawLength(d.points) < FREE_DRAW_MIN_LENGTH) return
        setVideoAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: 'freeDraw',
            points: d.points,
            color,
            strokeLevel: sl,
          },
        ])
        return
      }
      if (d.kind === 'circle') {
        if (d.r < 0.004) return
        setVideoAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: 'circle',
            cx: d.cx,
            cy: d.cy,
            r: d.r,
            color,
            strokeLevel: sl,
          },
        ])
        return
      }
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1)
      if (len < 0.004) return
      if (d.kind === 'line') {
        setVideoAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: 'line',
            x1: d.x1,
            y1: d.y1,
            x2: d.x2,
            y2: d.y2,
            color,
            strokeLevel: sl,
          },
        ])
      } else {
        setVideoAnnotations((prev) => [
          ...prev,
          {
            id,
            kind: 'arrow',
            x1: d.x1,
            y1: d.y1,
            x2: d.x2,
            y2: d.y2,
            color,
            strokeLevel: sl,
          },
        ])
      }
    },
    [],
  )

  const seekVideoBySeconds = useCallback((deltaSeconds: number) => {
    const videoEl = videoRef.current
    if (!videoEl) return
    const duration = Number.isFinite(videoEl.duration)
      ? videoEl.duration
      : Number.POSITIVE_INFINITY
    const target = clamp(videoEl.currentTime + deltaSeconds, 0, duration)
    videoEl.currentTime = target
  }, [])

  const toggleVideoPlayback = useCallback(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    if (videoEl.paused || videoEl.ended) {
      void videoEl.play()
    } else {
      videoEl.pause()
    }
  }, [])

  const handleVideoTimelineChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextTime = Number(e.target.value)
      const bounded = clamp(nextTime, 0, videoDuration || 0)
      const videoEl = videoRef.current
      if (!videoEl) return
      videoEl.currentTime = bounded
      setVideoCurrentTime(bounded)
    },
    [videoDuration],
  )

  const handleVideoTimelineInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const nextTime = Number(e.currentTarget.value)
      const bounded = clamp(nextTime, 0, videoDuration || 0)
      const videoEl = videoRef.current
      if (!videoEl) return
      videoEl.currentTime = bounded
      setVideoCurrentTime(bounded)
    },
    [videoDuration],
  )

  const handleVideoPlaybackRateChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const nextRate = Number(e.target.value)
      if (!Number.isFinite(nextRate)) return
      setVideoPlaybackRate(clamp(nextRate, 0.25, 3))
    },
    [],
  )

  const handleVideoSvgPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (videoAnnotateTool === 'move') return
      if (shouldIgnoreTouch(e.pointerType)) return
      e.stopPropagation()
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault()
      }
      const hostEl = videoFieldRef.current
      if (!hostEl) return
      const rect = hostEl.getBoundingClientRect()
      const x = clamp01((e.clientX - rect.left) / rect.width)
      const y = clamp01((e.clientY - rect.top) / rect.height)
      const useEraser =
        videoAnnotateTool === 'erase' || isPenEraserInput(e.pointerType, e.button, e.buttons)

      if (useEraser) {
        const id = hitTestAnnotation(videoAnnotations, x, y)
        if (id) {
          setVideoAnnotations((prev) => prev.filter((a) => a.id !== id))
        }
        return
      }

      const svgEl = e.currentTarget
      const tool = videoAnnotateTool
      if (tool === 'line' || tool === 'arrow') {
        const draft: AnnotationDraft = {
          kind: tool,
          x1: x,
          y1: y,
          x2: x,
          y2: y,
        }
        videoAnnotationDraftRef.current = draft
        setVideoAnnotationDraft(draft)
      } else if (tool === 'freeDraw') {
        const draft: AnnotationDraft = {
          kind: 'freeDraw',
          points: [{ x, y }],
        }
        videoAnnotationDraftRef.current = draft
        setVideoAnnotationDraft(draft)
      } else {
        const draft: AnnotationDraft = { kind: 'circle', cx: x, cy: y, r: 0 }
        videoAnnotationDraftRef.current = draft
        setVideoAnnotationDraft(draft)
      }

      const pid = e.pointerId
      const colorAtStart = activeVideoMarkupColor
      let strokeAtStart =
        e.pointerType === 'pen'
          ? pressureToStrokeLevel(e.pressure, strokeLevel)
          : strokeLevel
      let isActive = true
      beginPenSession(pid, e.pointerType)
      try {
        svgEl.setPointerCapture(pid)
      } catch {
        // ignore if capture unsupported
      }

      const moveOpts: AddEventListenerOptions = { passive: false }
      function move(ev: PointerEvent) {
        if (!isActive) return
        if (ev.pointerId !== pid) return
        if (ev.pointerType === 'touch' || ev.pointerType === 'pen') ev.preventDefault()
        if (ev.pointerType === 'pen') {
          const penLevel = pressureToStrokeLevel(ev.pressure, strokeAtStart)
          strokeAtStart = blendStrokeLevel(strokeAtStart, penLevel)
        }
        const el = videoFieldRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const nx = clamp01((ev.clientX - r.left) / r.width)
        const ny = clamp01((ev.clientY - r.top) / r.height)
        const prev = videoAnnotationDraftRef.current
        if (!prev) return
        let next: AnnotationDraft
        if (prev.kind === 'circle') {
          const rad = Math.hypot(nx - prev.cx, ny - prev.cy)
          next = { ...prev, r: rad }
        } else if (prev.kind === 'freeDraw') {
          next = {
            ...prev,
            points: appendFreeDrawPoint(prev.points, { x: nx, y: ny }),
          }
        } else {
          next = { ...prev, x2: nx, y2: ny }
        }
        videoAnnotationDraftRef.current = next
        setVideoAnnotationDraft(next)
      }

      function cleanupSession() {
        window.removeEventListener('pointermove', move, moveOpts)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('blur', cancelFromWindowBlur)
        document.removeEventListener('visibilitychange', cancelFromVisibilityChange)
        svgEl.removeEventListener('lostpointercapture', cancelFromCaptureLoss)
      }

      function finalizeSession() {
        if (!isActive) return
        isActive = false
        endPenSession(pid)
        cleanupSession()
        try {
          if (svgEl.hasPointerCapture(pid)) svgEl.releasePointerCapture(pid)
        } catch {
          // ignore
        }
        const final = videoAnnotationDraftRef.current
        videoAnnotationDraftRef.current = null
        setVideoAnnotationDraft(null)
        if (final) {
          commitVideoAnnotation(final, colorAtStart, strokeAtStart)
        }
      }

      function cancelSession() {
        if (!isActive) return
        isActive = false
        endPenSession(pid)
        cleanupSession()
        try {
          if (svgEl.hasPointerCapture(pid)) svgEl.releasePointerCapture(pid)
        } catch {
          // ignore
        }
        videoAnnotationDraftRef.current = null
        setVideoAnnotationDraft(null)
      }

      function up(ev: PointerEvent) {
        if (!isActive) return
        if (ev.pointerId !== pid) return
        finalizeSession()
      }

      function cancel(ev: PointerEvent) {
        if (!isActive) return
        if (ev.pointerId !== pid) return
        cancelSession()
      }

      function cancelFromCaptureLoss(ev: PointerEvent) {
        if (!isActive) return
        if (ev.pointerId !== pid) return
        cancelSession()
      }

      function cancelFromWindowBlur() {
        cancelSession()
      }

      function cancelFromVisibilityChange() {
        if (document.visibilityState !== 'visible') {
          cancelSession()
        }
      }

      window.addEventListener('pointermove', move, moveOpts)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('blur', cancelFromWindowBlur)
      document.addEventListener('visibilitychange', cancelFromVisibilityChange)
      svgEl.addEventListener('lostpointercapture', cancelFromCaptureLoss)
    },
    [
      activeVideoMarkupColor,
      commitVideoAnnotation,
      strokeLevel,
      videoAnnotateTool,
      videoAnnotations,
    ],
  )

  const handleFieldPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (shouldIgnoreTouch(e.pointerType)) return
      if (annotateTool !== 'move') return
      if (e.button !== 0 && e.pointerType === 'mouse') return
      if (annotationDragRef.current) return

      const fieldEl = fieldRef.current
      if (!fieldEl) return
      const rect = fieldEl.getBoundingClientRect()
      const x = clamp01((e.clientX - rect.left) / rect.width)
      const y = clamp01((e.clientY - rect.top) / rect.height)

      if (isPenEraserInput(e.pointerType, e.button, e.buttons)) {
        const id = hitTestAnnotation(annotations, x, y)
        if (id) {
          setAnnotations((prev) => prev.filter((a) => a.id !== id))
        }
        return
      }

      const id = hitTestAnnotation(annotations, x, y)
      if (!id) return

      const startAnnotation = annotations.find((a) => a.id === id)
      if (!startAnnotation) return
      if (startAnnotation.kind === 'freeDraw') return

      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault()
      }
      e.stopPropagation()

      const hostEl = e.currentTarget
      const drag: AnnotationDragState = {
        annotationId: id,
        pointerId: e.pointerId,
        startPointer: { x, y },
        startAnnotation,
        hostEl,
      }
      annotationDragRef.current = drag
      beginPenSession(e.pointerId, e.pointerType)

      try {
        hostEl.setPointerCapture(e.pointerId)
      } catch {
        // ignore if pointer capture unsupported
      }

      const moveOpts: AddEventListenerOptions = { passive: false }

      function move(ev: PointerEvent) {
        const current = annotationDragRef.current
        if (!current || ev.pointerId !== current.pointerId) return
        if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
          ev.preventDefault()
        }

        const el = fieldRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const nx = clamp01((ev.clientX - r.left) / r.width)
        const ny = clamp01((ev.clientY - r.top) / r.height)
        const dx = nx - current.startPointer.x
        const dy = ny - current.startPointer.y

        setAnnotations((prev) =>
          prev.map((a) =>
            a.id === current.annotationId ? offsetAnnotation(current.startAnnotation, dx, dy) : a,
          ),
        )
      }

      function end(ev: PointerEvent) {
        const current = annotationDragRef.current
        if (!current || ev.pointerId !== current.pointerId) return
        endPenSession(current.pointerId)
        window.removeEventListener('pointermove', move, moveOpts)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        try {
          if (current.hostEl.hasPointerCapture(current.pointerId)) {
            current.hostEl.releasePointerCapture(current.pointerId)
          }
        } catch {
          // ignore
        }
        annotationDragRef.current = null
      }

      window.addEventListener('pointermove', move, moveOpts)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [annotateTool, annotations],
  )

  const handleVideoFieldPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (shouldIgnoreTouch(e.pointerType)) return
      if (videoAnnotateTool !== 'move') return
      if (e.button !== 0 && e.pointerType === 'mouse') return
      if (videoAnnotationDragRef.current) return

      const target = e.target as HTMLElement | null
      if (target?.closest(`.${styles.videoControlsBar}`)) return

      const host = videoFieldRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const x = clamp01((e.clientX - rect.left) / rect.width)
      const y = clamp01((e.clientY - rect.top) / rect.height)

      if (isPenEraserInput(e.pointerType, e.button, e.buttons)) {
        const id = hitTestAnnotation(videoAnnotations, x, y)
        if (id) {
          setVideoAnnotations((prev) => prev.filter((a) => a.id !== id))
        }
        return
      }

      const id = hitTestAnnotation(videoAnnotations, x, y)
      if (!id) return

      const startAnnotation = videoAnnotations.find((a) => a.id === id)
      if (!startAnnotation) return
      if (startAnnotation.kind === 'freeDraw') return

      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault()
      }
      e.stopPropagation()

      const hostEl = e.currentTarget
      const drag: AnnotationDragState = {
        annotationId: id,
        pointerId: e.pointerId,
        startPointer: { x, y },
        startAnnotation,
        hostEl,
      }
      videoAnnotationDragRef.current = drag
      let isActive = true
      beginPenSession(e.pointerId, e.pointerType)

      try {
        hostEl.setPointerCapture(e.pointerId)
      } catch {
        // ignore if pointer capture unsupported
      }

      const moveOpts: AddEventListenerOptions = { passive: false }
      function move(ev: PointerEvent) {
        if (!isActive) return
        const current = videoAnnotationDragRef.current
        if (!current || ev.pointerId !== current.pointerId) return
        if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
          ev.preventDefault()
        }

        const el = videoFieldRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const nx = clamp01((ev.clientX - r.left) / r.width)
        const ny = clamp01((ev.clientY - r.top) / r.height)
        const dx = nx - current.startPointer.x
        const dy = ny - current.startPointer.y

        setVideoAnnotations((prev) =>
          prev.map((a) =>
            a.id === current.annotationId ? offsetAnnotation(current.startAnnotation, dx, dy) : a,
          ),
        )
      }

      function cleanupSession() {
        window.removeEventListener('pointermove', move, moveOpts)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('blur', cancelFromWindowBlur)
        document.removeEventListener('visibilitychange', cancelFromVisibilityChange)
        hostEl.removeEventListener('lostpointercapture', cancelFromCaptureLoss)
      }

      function end(ev: PointerEvent) {
        if (!isActive) return
        const current = videoAnnotationDragRef.current
        if (!current || ev.pointerId !== current.pointerId) return
        isActive = false
        endPenSession(current.pointerId)
        cleanupSession()
        try {
          if (current.hostEl.hasPointerCapture(current.pointerId)) {
            current.hostEl.releasePointerCapture(current.pointerId)
          }
        } catch {
          // ignore
        }
        videoAnnotationDragRef.current = null
      }

      function cancel(ev: PointerEvent) {
        if (!isActive) return
        const current = videoAnnotationDragRef.current
        if (!current || ev.pointerId !== current.pointerId) return
        isActive = false
        endPenSession(current.pointerId)
        cleanupSession()
        try {
          if (current.hostEl.hasPointerCapture(current.pointerId)) {
            current.hostEl.releasePointerCapture(current.pointerId)
          }
        } catch {
          // ignore
        }
        videoAnnotationDragRef.current = null
      }

      function cancelFromCaptureLoss(ev: PointerEvent) {
        cancel(ev)
      }

      function cancelFromWindowBlur() {
        const current = videoAnnotationDragRef.current
        if (!isActive || !current) return
        isActive = false
        endPenSession(current.pointerId)
        cleanupSession()
        try {
          if (current.hostEl.hasPointerCapture(current.pointerId)) {
            current.hostEl.releasePointerCapture(current.pointerId)
          }
        } catch {
          // ignore
        }
        videoAnnotationDragRef.current = null
      }

      function cancelFromVisibilityChange() {
        if (document.visibilityState !== 'visible') {
          cancelFromWindowBlur()
        }
      }

      window.addEventListener('pointermove', move, moveOpts)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('blur', cancelFromWindowBlur)
      document.addEventListener('visibilitychange', cancelFromVisibilityChange)
      hostEl.addEventListener('lostpointercapture', cancelFromCaptureLoss)
    },
    [videoAnnotateTool, videoAnnotations],
  )

  useEffect(() => {
    const def = DEFAULT_FORMATION[teamSize]
    setOffenseFormation(def)
    setDefenseFormation(def)
    setHighlightedPlayerIds(new Set())
    setPieces((prev) => {
      const ballPrev = prev.find((p) => p.id === 'ball')
      const next = mergeNamesOntoPieces(
        buildPieces(teamSize, def, def, gkOverrides),
        playerNamesRef.current,
      )
      if (ballPrev) {
        return next.map((p) =>
          p.id === 'ball' ? { ...p, pos: ballPrev.pos } : p,
        )
      }
      return next
    })
  }, [teamSize])

  useEffect(() => {
    setSelectedOffenseNumber((prev) => clamp(prev, 1, teamSize))
    setSelectedDefenseNumber((prev) => clamp(prev, 1, teamSize))
  }, [teamSize])

  const togglePlayerHighlight = useCallback((pieceId: PieceId) => {
    if (pieceId === 'ball') return
    setHighlightedPlayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(pieceId)) next.delete(pieceId)
      else next.add(pieceId)
      return next
    })
  }, [])

  useEffect(() => {
    const moveOpts: AddEventListenerOptions = { passive: false }

    function onPointerMove(e: PointerEvent) {
      if (e.pointerType === 'touch' && activePenPointersRef.current.size > 0) return
      const pending = pendingDragRef.current
      if (pending && e.pointerId === pending.pointerId) {
        const moved = Math.hypot(
          e.clientX - pending.startClientX,
          e.clientY - pending.startClientY,
        )
        if (moved > DRAG_THRESHOLD_PX) {
          const target = pending.target
          dragRef.current = {
            pieceId: pending.pieceId,
            pointerId: pending.pointerId,
            pointerOffsetPx: pending.pointerOffsetPx,
            pieceSizePx: pending.pieceSizePx,
          }
          pendingDragRef.current = null
          try {
            target.setPointerCapture(e.pointerId)
          } catch {
            // ignore
          }
        }
      }

      const drag = dragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      if (e.pointerType === 'touch' || e.pointerType === 'pen') e.preventDefault()

      const field = fieldRef.current
      if (!field) return

      const rect = field.getBoundingClientRect()

      const rawX = e.clientX - rect.left - drag.pointerOffsetPx.x
      const rawY = e.clientY - rect.top - drag.pointerOffsetPx.y

      const piece = pieceById.get(drag.pieceId)
      if (!piece) return

      const widthPx = drag.pieceSizePx.width
      const heightPx = drag.pieceSizePx.height

      const xPx = clamp(rawX, 0, rect.width - widthPx)
      const yPx = clamp(rawY, 0, rect.height - heightPx)

      const x = clamp01(xPx / rect.width)
      const y = clamp01(yPx / rect.height)

      setPieces((prev) =>
        prev.map((p) => (p.id === drag.pieceId ? { ...p, pos: { x, y } } : p)),
      )
    }

    function endDrag(e: PointerEvent) {
      endPenSession(e.pointerId)
      const pending = pendingDragRef.current
      if (pending && e.pointerId === pending.pointerId) {
        const moved = Math.hypot(
          e.clientX - pending.startClientX,
          e.clientY - pending.startClientY,
        )
        if (moved <= DRAG_THRESHOLD_PX) {
          if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            const now = Date.now()
            const last = lastTouchTapRef.current
            if (
              last &&
              last.pieceId === pending.pieceId &&
              now - last.time < DOUBLE_TAP_MS
            ) {
              togglePlayerHighlight(pending.pieceId)
              lastTouchTapRef.current = null
            } else {
              lastTouchTapRef.current = {
                pieceId: pending.pieceId,
                time: now,
              }
            }
          }
        }
        pendingDragRef.current = null
      }

      const drag = dragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return

      if (isGkPieceId(drag.pieceId)) {
        const team = teamFromGkId(drag.pieceId)
        const current = piecesRef.current.find((p) => p.id === drag.pieceId)
        if (current) {
          setGkOverrides((prev) => {
            const next: GkOverrides = { ...prev, [team]: current.pos }
            saveGkOverrides(next)
            return next
          })
        }
      }

      dragRef.current = undefined
    }

    window.addEventListener('pointermove', onPointerMove, moveOpts)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)

    return () => {
      window.removeEventListener('pointermove', onPointerMove, moveOpts)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [pieceById, togglePlayerHighlight])

  function reset() {
    setPieces((prev) => {
      const ballPrev = prev.find((p) => p.id === 'ball')
      const next = mergeNamesOntoPieces(
        buildPieces(
          teamSize,
          offenseFormation,
          defenseFormation,
          gkOverrides,
        ),
        playerNamesRef.current,
      )
      if (ballPrev) {
        return next.map((p) =>
          p.id === 'ball' ? { ...p, pos: ballPrev.pos } : p,
        )
      }
      return next
    })
  }

  function handleCreatePlay() {
    const snaps = snapshotPieces(piecesRef.current)
    setIsRecording(true)
    setDraftName('')
    setDraftStart(snaps)
    setDraftSteps([])
    setLastSnapshot(snaps)
    setSelectedPlayId(null)
    setCurrentStepIndex(0)
  }

  function handleSaveStep() {
    if (!isRecording || !lastSnapshot) return
    const prevMap = snapshotsToMap(lastSnapshot)
    const currentSnaps = snapshotPieces(piecesRef.current)
    const movements: Movement[] = currentSnaps.map((snap) => {
      const prev = prevMap.get(snap.id) ?? snap.pos
      return { id: snap.id, from: prev, to: snap.pos }
    })

    setDraftSteps((prev) => [...prev, { movements }])
    setLastSnapshot(currentSnaps)
  }

  function handleSavePlay() {
    if (!isRecording || !draftStart) return
    const name = draftName.trim() || `Play ${plays.length + 1}`

    const play: SavedPlay = {
      id: `${Date.now()}`,
      name,
      teamSize,
      offenseFormation,
      defenseFormation,
      gkOverrides,
      startPositions: draftStart,
      steps: draftSteps,
    }

    setPlays((prev) => {
      return [...prev, play]
    })

    setIsRecording(false)
    setDraftName('')
    setDraftStart(null)
    setDraftSteps([])
    setLastSnapshot(null)
    setSelectedPlayId(play.id)
    setCurrentStepIndex(0)
  }

  function applyPlayStart(play: SavedPlay) {
    // Ensure formations / team size match the play.
    setTeamSize(play.teamSize)
    setOffenseFormation(play.offenseFormation)
    setDefenseFormation(play.defenseFormation)
    setGkOverrides(play.gkOverrides)

    const startMap = snapshotsToMap(play.startPositions)
    setPieces((prev) =>
      prev.map((p) => {
        const pos = startMap.get(p.id)
        return pos ? { ...p, pos } : p
      }),
    )
  }

  function handleSelectPlay(id: string) {
    setIsRecording(false)
    setIsPlaying(false)
    if (animationRef.current != null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    setSelectedPlayId(id || null)
    setCurrentStepIndex(0)
    const play = plays.find((p) => p.id === id)
    if (play) {
      applyPlayStart(play)
    }
  }

  function runStep(
    play: SavedPlay,
    stepIndex: number,
    autoContinue: boolean,
    direction: PlaybackDirection = 'forward',
  ) {
    const step = play.steps[stepIndex]
    if (!step) {
      setIsPlaying(false)
      return
    }

    const duration = 700
    function frame(startTime: number, now: number) {
      const t = clamp01((now - startTime) / duration)
      setPieces((prev) => interpolateStepPositions(prev, step.movements, t, direction))

      if (t < 1) {
        animationRef.current = requestAnimationFrame((nextNow) =>
          frame(startTime, nextNow),
        )
      } else if (autoContinue && stepIndex + 1 < play.steps.length) {
        setCurrentStepIndex(stepIndex + 1)
        runStep(play, stepIndex + 1, true, 'forward')
      } else {
        setIsPlaying(false)
      }
    }

    setIsPlaying(true)
    animationRef.current = requestAnimationFrame((startTime) =>
      frame(startTime, startTime),
    )
  }

  function handlePlayAll() {
    const play = plays.find((p) => p.id === selectedPlayId)
    if (!play || play.steps.length === 0) return
    applyPlayStart(play)
    setCurrentStepIndex(0)
    runStep(play, 0, true, 'forward')
  }

  function handleReplay() {
    const play = plays.find((p) => p.id === selectedPlayId)
    if (!play) return

    setIsPlaying(false)
    if (animationRef.current != null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    applyPlayStart(play)
    setCurrentStepIndex(0)
  }

  function handleNextStep() {
    const play = plays.find((p) => p.id === selectedPlayId)
    if (!play || play.steps.length === 0) return

    const index = currentStepIndex
    if (index >= play.steps.length) return

    runStep(play, index, false, 'forward')
    setCurrentStepIndex(index + 1)
  }

  function handlePrevStep() {
    const play = plays.find((p) => p.id === selectedPlayId)
    if (!play || play.steps.length === 0) return

    const prevIndex = currentStepIndex - 1
    if (prevIndex < 0) return

    runStep(play, prevIndex, false, 'backward')
    setCurrentStepIndex(prevIndex)
  }

  function onPiecePointerDown(e: React.PointerEvent, pieceId: PieceId) {
    if (annotateTool !== 'move') return
    if (shouldIgnoreTouch(e.pointerType)) return
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (isPenEraserInput(e.pointerType, e.button, e.buttons)) return
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      e.preventDefault()
    }

    const target = e.currentTarget as HTMLElement
    const targetRect = target.getBoundingClientRect()

    const offsetX = e.clientX - targetRect.left
    const offsetY = e.clientY - targetRect.top

    pendingDragRef.current = {
      pieceId,
      pointerId: e.pointerId,
      pointerOffsetPx: { x: offsetX, y: offsetY },
      pieceSizePx: {
        width: targetRect.width,
        height: targetRect.height,
      },
      startClientX: e.clientX,
      startClientY: e.clientY,
      target,
    }
    beginPenSession(e.pointerId, e.pointerType)
  }

  function triggerVideoPicker() {
    videoFileInputRef.current?.click()
  }

  function handleVideoColorSelect(color: VideoMarkupColor) {
    setAnnotationColor(color)
    setVideoColorPaletteOpen(false)
  }

  function handleVideoFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current)
    }
    const objectUrl = URL.createObjectURL(file)
    videoObjectUrlRef.current = objectUrl
    setVideoSourceUrl(objectUrl)
    setIsVideoPlaying(false)
    setVideoCurrentTime(0)
    setVideoDuration(0)
    setVideoPlaybackRate(1)
    setVideoAnnotations([])
    setVideoAnnotationDraft(null)
    videoAnnotationDraftRef.current = null
    e.currentTarget.value = ''
  }

  function toggleTeamTabletPopover(target: Exclude<TeamTabletPopover, null>) {
    setTeamTabletPopover((current) => (current === target ? null : target))
  }

  function handleTeamSizeTabletSelect(size: 7 | 9 | 11) {
    setTeamSize(size)
    setTeamTabletPopover(null)
  }

  function handleOffenseFormationTabletSelect(next: string) {
    setOffenseFormation(next)
    setTeamTabletPopover(null)
  }

  function handleDefenseFormationTabletSelect(next: string) {
    setDefenseFormation(next)
    setTeamTabletPopover(null)
  }

  return (
    <div
      className={`${styles.wrapper} ${activeTab === 'playVideo' ? styles.wrapperVideoMode : ''} ${activeTab === 'team' ? styles.wrapperTeamMode : ''}`}
    >
      <div className={styles.tabletWorkspace}>
        <div className={styles.tabletNavRail} role="tablist" aria-label="Soccer coach sections">
          {TAB_ITEMS.map((tabItem) => (
            <button
              key={`rail-${tabItem.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tabItem.id}
              tabIndex={activeTab === tabItem.id ? 0 : -1}
              className={`${styles.iconRailBtn} ${activeTab === tabItem.id ? styles.iconRailBtnActive : ''}`}
              onClick={() => setActiveTab(tabItem.id)}
              aria-label={tabItem.label}
              title={tabItem.label}
            >
              <span className={styles.iconRailGlyph} aria-hidden>
                {tabItem.icon}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.mainContent}>
          <div
            className={`${styles.tabShell} ${keepControlsVisible ? styles.tabShellPinned : styles.tabShellCollapsible}`}
          >
        <div
          className={styles.tabList}
          role="tablist"
          aria-label="Soccer coach sections"
        >
          {TAB_ITEMS.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              id={`tab-${tabItem.id}`}
              role="tab"
              aria-selected={activeTab === tabItem.id}
              aria-controls={`panel-${tabItem.id}`}
              tabIndex={activeTab === tabItem.id ? 0 : -1}
              className={`${styles.tab} ${activeTab === tabItem.id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tabItem.id)}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        <div
          id="panel-team"
          role="tabpanel"
          aria-labelledby="tab-team"
          aria-hidden={activeTab !== 'team'}
          className={`${styles.tabPanel} ${activeTab !== 'team' ? styles.tabPanelHidden : ''}`}
        >
          <div className={`${styles.tabPanelInner} ${styles.teamDesktopControls}`}>
            <span className={styles.label}>Players per team</span>
            <select
              className={styles.select}
              value={teamSize}
              onChange={(e) => setTeamSize(Number(e.target.value) as 7 | 9 | 11)}
              aria-label="Players per team"
            >
              <option value={7}>7</option>
              <option value={9}>9</option>
              <option value={11}>11</option>
            </select>
            <span className={styles.label}>Offense formation</span>
            <select
              className={styles.select}
              value={
                formationOptions.includes(offenseFormation)
                  ? offenseFormation
                  : DEFAULT_FORMATION[teamSize]
              }
              onChange={(e) => setOffenseFormation(e.target.value)}
              aria-label="Offense formation"
            >
              {formationOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span className={styles.label}>Defense formation</span>
            <select
              className={styles.select}
              value={
                formationOptions.includes(defenseFormation)
                  ? defenseFormation
                  : DEFAULT_FORMATION[teamSize]
              }
              onChange={(e) => setDefenseFormation(e.target.value)}
              aria-label="Defense formation"
            >
              {formationOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button className={styles.btn} onClick={reset}>
              Reset positions
            </button>

            <span className={`${styles.legend} ${styles.teamLegend}`}>
              <span className={styles.legendSwatchOffense} /> Offense
            </span>
            <span className={`${styles.legend} ${styles.teamLegend}`}>
              <span className={styles.legendSwatchDefense} /> Defense
            </span>
            <span className={`${styles.legend} ${styles.teamLegend}`}>
              <span className={styles.legendSwatchBall} /> Ball
            </span>
          </div>
        </div>

        <div
          id="panel-playerNames"
          role="tabpanel"
          aria-labelledby="tab-playerNames"
          aria-hidden={activeTab !== 'playerNames'}
          className={`${styles.tabPanel} ${activeTab !== 'playerNames' ? styles.tabPanelHidden : ''}`}
        >
          <div className={`${styles.tabPanelInner} ${styles.nameTabPanelInner}`}>
            <div className={styles.nameSection}>
              <div className={styles.nameSectionTitle}>Player names</div>
              <p className={styles.nameSectionHint}>
                Choose a player number, then add or edit a name. Names appear
                under jersey numbers on the field (saved on this device).
              </p>
              <div className={styles.nameEditors}>
                <div className={styles.nameEditorCard}>
                  <div className={styles.nameColTitle}>Offense</div>
                  <label className={styles.nameEditorRow}>
                    <span className={styles.label}>Player #</span>
                    <select
                      className={styles.select}
                      value={selectedOffenseNumber}
                      onChange={(e) =>
                        setSelectedOffenseNumber(Number(e.target.value))
                      }
                      aria-label="Select offense player number"
                    >
                      {Array.from({ length: teamSize }, (_, i) => {
                        const n = i + 1
                        return (
                          <option key={`offense-option-${n}`} value={n}>
                            {n}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  <label className={styles.nameEditorRow}>
                    <span className={styles.label}>Name</span>
                    <input
                      className={styles.nameInput}
                      type="text"
                      value={playerNames[selectedOffenseId] ?? ''}
                      placeholder="Name"
                      maxLength={PLAYER_NAME_MAX}
                      onChange={(e) => {
                        const v = e.target.value
                        setPlayerNames((prev) => {
                          const next = { ...prev }
                          if (!v.trim()) delete next[selectedOffenseId]
                          else next[selectedOffenseId] = v
                          return next
                        })
                      }}
                      aria-label={`Offense player ${selectedOffenseNumber} name`}
                    />
                  </label>
                </div>

                <div className={styles.nameEditorCard}>
                  <div className={styles.nameColTitle}>Defense</div>
                  <label className={styles.nameEditorRow}>
                    <span className={styles.label}>Player #</span>
                    <select
                      className={styles.select}
                      value={selectedDefenseNumber}
                      onChange={(e) =>
                        setSelectedDefenseNumber(Number(e.target.value))
                      }
                      aria-label="Select defense player number"
                    >
                      {Array.from({ length: teamSize }, (_, i) => {
                        const n = i + 1
                        return (
                          <option key={`defense-option-${n}`} value={n}>
                            {n}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  <label className={styles.nameEditorRow}>
                    <span className={styles.label}>Name</span>
                    <input
                      className={styles.nameInput}
                      type="text"
                      value={playerNames[selectedDefenseId] ?? ''}
                      placeholder="Name"
                      maxLength={PLAYER_NAME_MAX}
                      onChange={(e) => {
                        const v = e.target.value
                        setPlayerNames((prev) => {
                          const next = { ...prev }
                          if (!v.trim()) delete next[selectedDefenseId]
                          else next[selectedDefenseId] = v
                          return next
                        })
                      }}
                      aria-label={`Defense player ${selectedDefenseNumber} name`}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          id="panel-recordings"
          role="tabpanel"
          aria-labelledby="tab-recordings"
          aria-hidden={activeTab !== 'recordings'}
          className={`${styles.tabPanel} ${activeTab !== 'recordings' ? styles.tabPanelHidden : ''}`}
        >
          <div className={styles.tabPanelInner}>
            {playsLoading ? (
              <span className={styles.label}>Loading plays from Firebase...</span>
            ) : null}
            {playsError ? <span className={styles.label}>{playsError}</span> : null}
            {isRecording && (
              <>
                <span className={styles.label}>Play title</span>
                <input
                  className={styles.input}
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder={`Play ${plays.length + 1}`}
                />
              </>
            )}
            <button
              className={styles.btn}
              onClick={handleCreatePlay}
              disabled={isRecording || playsLoading}
            >
              Create play
            </button>
            <button
              className={styles.btn}
              onClick={handleSaveStep}
              disabled={!isRecording}
            >
              Save step
            </button>
            <button
              className={styles.btn}
              onClick={handleSavePlay}
              disabled={!isRecording}
            >
              Save play
            </button>
            <span className={styles.label}>Saved plays</span>
            <select
              className={styles.select}
              value={selectedPlayId ?? ''}
              onChange={(e) => handleSelectPlay(e.target.value)}
              aria-label="Saved plays"
              disabled={playsLoading}
            >
              <option value="">None</option>
              {plays.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className={styles.btn}
              onClick={handlePlayAll}
              disabled={!selectedPlayId || isPlaying}
            >
              Play all
            </button>
            <button
              className={styles.btn}
              onClick={handleReplay}
              disabled={!selectedPlayId || isPlaying}
            >
              Restart
            </button>
            <button
              className={styles.btn}
              onClick={handlePrevStep}
              disabled={!selectedPlayId || isPlaying}
            >
              Previous step
            </button>
            <button
              className={styles.btn}
              onClick={handleNextStep}
              disabled={!selectedPlayId || isPlaying}
            >
              Next step
            </button>
          </div>
        </div>

        <div
          id="panel-annotations"
          role="tabpanel"
          aria-labelledby="tab-annotations"
          aria-hidden={activeTab !== 'annotations'}
          className={`${styles.tabPanel} ${activeTab !== 'annotations' ? styles.tabPanelHidden : ''}`}
        >
          <div className={styles.tabPanelInner}>
            <div className={styles.toolGroup}>
              {TOOL_ITEMS.map((toolItem) => (
                <button
                  key={toolItem.id}
                  type="button"
                  className={`${styles.toolBtn} ${annotateTool === toolItem.id ? styles.toolBtnActive : ''}`}
                  onClick={() => setAnnotateTool(toolItem.id)}
                >
                  {toolItem.label}
                </button>
              ))}
            </div>
            <span className={styles.label}>Color</span>
            <div className={styles.colorRow} aria-label="Annotation colors">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorSwatch} ${annotationColor === c ? styles.colorSwatchActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setAnnotationColor(c)}
                  aria-label={`Use color ${c}`}
                  title={c}
                />
              ))}
              <input
                className={styles.colorPicker}
                type="color"
                value={
                  /^#[0-9A-Fa-f]{6}$/.test(annotationColor)
                    ? annotationColor
                    : '#e11d48'
                }
                onChange={(e) => setAnnotationColor(e.target.value)}
                aria-label="Custom color"
              />
            </div>
            <span className={styles.label}>Thickness</span>
            <input
              className={styles.thicknessRange}
              type="range"
              min={1}
              max={16}
              value={strokeLevel}
              onChange={(e) => setStrokeLevel(Number(e.target.value))}
              aria-label="Line thickness"
            />
            <button
              type="button"
              className={styles.btn}
              onClick={() => setAnnotations([])}
              disabled={annotations.length === 0}
            >
              Clear drawings
            </button>
          </div>
        </div>

        <div
          id="panel-playVideo"
          role="tabpanel"
          aria-labelledby="tab-playVideo"
          aria-hidden={activeTab !== 'playVideo'}
          className={`${styles.tabPanel} ${activeTab !== 'playVideo' ? styles.tabPanelHidden : ''}`}
        >
          <div
            className={`${styles.tabPanelInner} ${styles.videoTabPanelInner} ${styles.videoDesktopControls}`}
          >
            <button type="button" className={styles.btn} onClick={triggerVideoPicker}>
              Upload video
            </button>
            <input
              ref={videoFileInputRef}
              type="file"
              accept="video/*"
              className={styles.videoFileInput}
              onChange={handleVideoFileSelected}
            />
            <div className={styles.toolGroup}>
              {TOOL_ITEMS.map((toolItem) => (
                <button
                  key={toolItem.id}
                  type="button"
                  className={`${styles.toolBtn} ${videoAnnotateTool === toolItem.id ? styles.toolBtnActive : ''}`}
                  onClick={() => setVideoAnnotateTool(toolItem.id)}
                >
                  {toolItem.label}
                </button>
              ))}
            </div>
            <span className={styles.label}>Color</span>
            <div className={styles.colorRow} aria-label="Video annotation colors">
              {VIDEO_MARKUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorSwatch} ${activeVideoMarkupColor === c ? styles.colorSwatchActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setAnnotationColor(c)}
                  aria-label={`Use color ${c}`}
                  title={c}
                />
              ))}
            </div>
            <span className={styles.label}>Thickness</span>
            <input
              className={`${styles.thicknessRange} ${styles.videoThicknessRange}`}
              type="range"
              min={1}
              max={16}
              value={strokeLevel}
              onChange={(e) => setStrokeLevel(Number(e.target.value))}
              aria-label="Line thickness"
            />
            <button
              type="button"
              className={styles.btn}
              onClick={() => setVideoAnnotations([])}
              disabled={videoAnnotations.length === 0}
            >
              Clear markups
            </button>
          </div>
        </div>
      </div>
      {activeTab === 'playVideo' ? (
        <div className={styles.playVideoWorkspace}>
          <div className={styles.videoFieldOuter}>
            <div
              className={styles.videoField}
              ref={videoFieldRef}
              onPointerDownCapture={handleVideoFieldPointerDownCapture}
            >
              {videoSourceUrl ? (
                <video
                  ref={videoRef}
                  className={styles.videoPlayer}
                  src={videoSourceUrl}
                  playsInline
                />
              ) : (
                <div className={styles.videoPlaceholder}>
                  Upload a local video file (e.g. mp4) to start playback.
                </div>
              )}
              {videoSourceUrl ? (
                <div className={styles.videoControlsBar}>
                  <div className={styles.videoButtonsRow}>
                    <button
                      type="button"
                      className={styles.videoControlBtn}
                      onClick={() => seekVideoBySeconds(-10)}
                    >
                      -10s
                    </button>
                    <button
                      type="button"
                      className={styles.videoControlBtn}
                      onClick={toggleVideoPlayback}
                    >
                      {isVideoPlaying ? 'Pause' : 'Play'}
                    </button>
                    <button
                      type="button"
                      className={styles.videoControlBtn}
                      onClick={() => seekVideoBySeconds(10)}
                    >
                      +10s
                    </button>
                    <div className={styles.videoSpeedRow}>
                      <label className={styles.videoSpeedLabel} htmlFor="video-speed-select">
                        Speed
                      </label>
                      <select
                        id="video-speed-select"
                        className={styles.videoSpeedSelect}
                        value={videoPlaybackRate}
                        onChange={handleVideoPlaybackRateChange}
                        aria-label="Playback speed"
                      >
                        {VIDEO_PLAYBACK_RATES.map((rate) => (
                          <option key={rate} value={rate}>
                            {rate}x
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className={styles.videoTimelineRow}>
                    <span className={styles.videoTimeText}>
                      {formatMediaTime(videoCurrentTime)}
                    </span>
                    <input
                      type="range"
                      className={styles.videoTimeline}
                      min={0}
                      max={Math.max(videoDuration, 0.001)}
                      step={0.1}
                      value={Math.min(videoCurrentTime, Math.max(videoDuration, 0.001))}
                      onInput={handleVideoTimelineInput}
                      onChange={handleVideoTimelineChange}
                      disabled={videoDuration <= 0}
                      aria-label="Video timeline"
                    />
                    <span className={styles.videoTimeText}>
                      {formatMediaTime(videoDuration)}
                    </span>
                  </div>
                </div>
              ) : null}
              <svg
                className={`${styles.videoAnnotationSvg} ${videoAnnotateTool !== 'move' ? styles.videoAnnotationSvgInteractive : ''} ${videoAnnotateTool === 'erase' ? styles.annotationSvgErase : ''}`}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden={videoAnnotateTool === 'move'}
                onPointerDown={handleVideoSvgPointerDown}
              >
                {videoAnnotations.map((a) => {
                  const sw = strokeLevelToSvgWidth(a.strokeLevel)
                  if (a.kind === 'line') {
                    return (
                      <line
                        key={a.id}
                        x1={a.x1}
                        y1={a.y1}
                        x2={a.x2}
                        y2={a.y2}
                        stroke={a.color}
                        strokeWidth={sw}
                        strokeLinecap="round"
                      />
                    )
                  }
                  if (a.kind === 'circle') {
                    return (
                      <circle
                        key={a.id}
                        cx={a.cx}
                        cy={a.cy}
                        r={a.r}
                        fill="none"
                        stroke={a.color}
                        strokeWidth={sw}
                      />
                    )
                  }
                  if (a.kind === 'freeDraw') {
                    return (
                      <polyline
                        key={a.id}
                        points={a.points.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="none"
                        stroke={a.color}
                        strokeWidth={sw}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )
                  }
                  const head = Math.max(0.012, sw * 5)
                  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1)
                  const lx2 = a.x2 - head * Math.cos(ang)
                  const ly2 = a.y2 - head * Math.sin(ang)
                  return (
                    <g key={a.id}>
                      <line
                        x1={a.x1}
                        y1={a.y1}
                        x2={lx2}
                        y2={ly2}
                        stroke={a.color}
                        strokeWidth={sw}
                        strokeLinecap="round"
                      />
                      <polygon
                        points={arrowHeadPoints(a.x1, a.y1, a.x2, a.y2, head)}
                        fill={a.color}
                      />
                    </g>
                  )
                })}
                {videoAnnotationDraft &&
                  (videoAnnotationDraft.kind === 'circle' ? (
                    <circle
                      cx={videoAnnotationDraft.cx}
                      cy={videoAnnotationDraft.cy}
                      r={videoAnnotationDraft.r}
                      fill="none"
                      stroke={activeVideoMarkupColor}
                      strokeWidth={strokeLevelToSvgWidth(strokeLevel)}
                      opacity={0.88}
                    />
                  ) : videoAnnotationDraft.kind === 'line' ? (
                    <line
                      x1={videoAnnotationDraft.x1}
                      y1={videoAnnotationDraft.y1}
                      x2={videoAnnotationDraft.x2}
                      y2={videoAnnotationDraft.y2}
                      stroke={activeVideoMarkupColor}
                      strokeWidth={strokeLevelToSvgWidth(strokeLevel)}
                      strokeLinecap="round"
                      opacity={0.88}
                    />
                  ) : videoAnnotationDraft.kind === 'freeDraw' ? (
                    <polyline
                      points={videoAnnotationDraft.points
                        .map((point) => `${point.x},${point.y}`)
                        .join(' ')}
                      fill="none"
                      stroke={activeVideoMarkupColor}
                      strokeWidth={strokeLevelToSvgWidth(strokeLevel)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.88}
                    />
                  ) : (
                    (() => {
                      const d = videoAnnotationDraft
                      const sw = strokeLevelToSvgWidth(strokeLevel)
                      const head = Math.max(0.012, sw * 5)
                      const ang = Math.atan2(d.y2 - d.y1, d.x2 - d.x1)
                      const lx2 = d.x2 - head * Math.cos(ang)
                      const ly2 = d.y2 - head * Math.sin(ang)
                      return (
                        <g opacity={0.88}>
                          <line
                            x1={d.x1}
                            y1={d.y1}
                            x2={lx2}
                            y2={ly2}
                            stroke={activeVideoMarkupColor}
                            strokeWidth={sw}
                            strokeLinecap="round"
                          />
                          <polygon
                            points={arrowHeadPoints(d.x1, d.y1, d.x2, d.y2, head)}
                            fill={activeVideoMarkupColor}
                          />
                        </g>
                      )
                    })()
                  ))}
              </svg>
            </div>
          </div>
          <div className={styles.playVideoTabletToolsRail} aria-label="Video tools">
            <button
              type="button"
              className={styles.iconRailBtn}
              onClick={triggerVideoPicker}
              aria-label="Upload video"
              title="Upload video"
            >
              <span className={styles.iconRailGlyph} aria-hidden>
                ⤴
              </span>
            </button>
            {TOOL_ITEMS.map((toolItem) => (
              <button
                key={`video-tool-${toolItem.id}`}
                type="button"
                className={`${styles.iconRailBtn} ${videoAnnotateTool === toolItem.id ? styles.iconRailBtnActive : ''}`}
                onClick={() => setVideoAnnotateTool(toolItem.id)}
                aria-label={toolItem.label}
                title={toolItem.label}
              >
                <span className={styles.iconRailGlyph} aria-hidden>
                  {toolItem.icon}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={`${styles.iconRailBtn} ${videoColorPaletteOpen ? styles.iconRailBtnActive : ''}`}
              onClick={() => setVideoColorPaletteOpen((prev) => !prev)}
              aria-label="Choose markup color"
              title="Choose markup color"
            >
              <span className={styles.iconRailGlyph} aria-hidden>
                🎨
              </span>
            </button>
            {videoColorPaletteOpen ? (
              <div className={styles.videoColorPopover} aria-label="Video annotation colors">
                {VIDEO_MARKUP_COLORS.map((c) => (
                  <button
                    key={`video-color-${c}`}
                    type="button"
                    className={`${styles.colorSwatch} ${activeVideoMarkupColor === c ? styles.colorSwatchActive : ''}`}
                    style={{ background: c }}
                    onClick={() => handleVideoColorSelect(c)}
                    aria-label={`Use color ${c}`}
                    title={c}
                  />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className={`${styles.iconRailBtn} ${videoThicknessOpen ? styles.iconRailBtnActive : ''}`}
              onClick={() => setVideoThicknessOpen((prev) => !prev)}
              aria-label="Toggle line thickness slider"
              title="Toggle line thickness slider"
            >
              <span className={styles.iconRailGlyph} aria-hidden>
                ≋
              </span>
            </button>
            {videoThicknessOpen ? (
              <input
                className={styles.videoRailThicknessRange}
                type="range"
                min={1}
                max={16}
                value={strokeLevel}
                onChange={(e) => setStrokeLevel(Number(e.target.value))}
                aria-label="Line thickness"
              />
            ) : null}
            <button
              type="button"
              className={styles.iconRailBtn}
              onClick={() => setVideoAnnotations([])}
              disabled={videoAnnotations.length === 0}
              aria-label="Clear markups"
              title="Clear markups"
            >
              <span className={styles.iconRailGlyph} aria-hidden>
                🧹
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.teamWorkspace}>
          <div className={styles.fieldOuter}>
            <div
              className={styles.field}
              ref={fieldRef}
              onPointerDownCapture={handleFieldPointerDownCapture}
            >
              <div className={styles.pitchLines} aria-hidden="true" />
              <div className={styles.penaltyBoxLeft} aria-hidden="true" />
              <div className={styles.penaltyBoxRight} aria-hidden="true" />
              <div className={styles.goalLeft} aria-hidden="true" />
              <div className={styles.goalRight} aria-hidden="true" />

              {pieces.map((p) => {
                const left = `${p.pos.x * 100}%`
                const top = `${p.pos.y * 100}%`

                if (p.type === 'ball') {
                  return (
                    <div
                      key={p.id}
                      className={styles.ball}
                      style={{ left, top }}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => onPiecePointerDown(e, p.id)}
                      aria-label="Ball"
                    />
                  )
                }

                const cls =
                  p.team === 'offense' ? styles.playerOffense : styles.playerDefense
                const isHighlighted = highlightedPlayerIds.has(p.id)

                const ariaPlayer = p.name
                  ? `${p.team} player ${p.label}, ${p.name}`
                  : `${p.team} player ${p.label}`

                return (
                  <div
                    key={p.id}
                    className={styles.playerWrap}
                    style={{ left, top }}
                  >
                    <div
                      className={`${styles.player} ${cls} ${isHighlighted ? styles.playerHighlighted : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isHighlighted}
                      onPointerDown={(e) => onPiecePointerDown(e, p.id)}
                      onDoubleClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (annotateTool !== 'move') return
                        togglePlayerHighlight(p.id)
                      }}
                      aria-label={ariaPlayer}
                    >
                      {p.label}
                    </div>
                    {p.name ? (
                      <div className={styles.playerNameTag} title={p.name}>
                        {p.name}
                      </div>
                    ) : null}
                  </div>
                )
              })}

              <svg
                className={`${styles.annotationSvg} ${annotateTool !== 'move' ? styles.annotationSvgInteractive : ''} ${annotateTool === 'erase' ? styles.annotationSvgErase : ''}`}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden={annotateTool === 'move'}
                onPointerDown={handleSvgPointerDown}
              >
                {annotations.map((a) => {
                  const sw = strokeLevelToSvgWidth(a.strokeLevel)
                  if (a.kind === 'line') {
                    return (
                      <line
                        key={a.id}
                        x1={a.x1}
                        y1={a.y1}
                        x2={a.x2}
                        y2={a.y2}
                        stroke={a.color}
                        strokeWidth={sw}
                        strokeLinecap="round"
                      />
                    )
                  }
                  if (a.kind === 'circle') {
                    return (
                      <circle
                        key={a.id}
                        cx={a.cx}
                        cy={a.cy}
                        r={a.r}
                        fill="none"
                        stroke={a.color}
                        strokeWidth={sw}
                      />
                    )
                  }
                  if (a.kind === 'freeDraw') {
                    return (
                      <polyline
                        key={a.id}
                        points={a.points.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="none"
                        stroke={a.color}
                        strokeWidth={sw}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )
                  }
                  const head = Math.max(0.012, sw * 5)
                  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1)
                  const lx2 = a.x2 - head * Math.cos(ang)
                  const ly2 = a.y2 - head * Math.sin(ang)
                  return (
                    <g key={a.id}>
                      <line
                        x1={a.x1}
                        y1={a.y1}
                        x2={lx2}
                        y2={ly2}
                        stroke={a.color}
                        strokeWidth={sw}
                        strokeLinecap="round"
                      />
                      <polygon
                        points={arrowHeadPoints(a.x1, a.y1, a.x2, a.y2, head)}
                        fill={a.color}
                      />
                    </g>
                  )
                })}
                {annotationDraft &&
                  (annotationDraft.kind === 'circle' ? (
                    <circle
                      cx={annotationDraft.cx}
                      cy={annotationDraft.cy}
                      r={annotationDraft.r}
                      fill="none"
                      stroke={annotationColor}
                      strokeWidth={strokeLevelToSvgWidth(strokeLevel)}
                      opacity={0.88}
                    />
                  ) : annotationDraft.kind === 'line' ? (
                    <line
                      x1={annotationDraft.x1}
                      y1={annotationDraft.y1}
                      x2={annotationDraft.x2}
                      y2={annotationDraft.y2}
                      stroke={annotationColor}
                      strokeWidth={strokeLevelToSvgWidth(strokeLevel)}
                      strokeLinecap="round"
                      opacity={0.88}
                    />
                  ) : annotationDraft.kind === 'freeDraw' ? (
                    <polyline
                      points={annotationDraft.points
                        .map((point) => `${point.x},${point.y}`)
                        .join(' ')}
                      fill="none"
                      stroke={annotationColor}
                      strokeWidth={strokeLevelToSvgWidth(strokeLevel)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.88}
                    />
                  ) : (
                    (() => {
                      const d = annotationDraft
                      const sw = strokeLevelToSvgWidth(strokeLevel)
                      const head = Math.max(0.012, sw * 5)
                      const ang = Math.atan2(d.y2 - d.y1, d.x2 - d.x1)
                      const lx2 = d.x2 - head * Math.cos(ang)
                      const ly2 = d.y2 - head * Math.sin(ang)
                      return (
                        <g opacity={0.88}>
                          <line
                            x1={d.x1}
                            y1={d.y1}
                            x2={lx2}
                            y2={ly2}
                            stroke={annotationColor}
                            strokeWidth={sw}
                            strokeLinecap="round"
                          />
                          <polygon
                            points={arrowHeadPoints(d.x1, d.y1, d.x2, d.y2, head)}
                            fill={annotationColor}
                          />
                        </g>
                      )
                    })()
                  ))}
              </svg>
            </div>
          </div>
          {activeTab === 'team' ? (
            <div className={styles.teamTabletToolsRail} aria-label="Team organization tools">
              <div className={styles.teamTabletToolSlot}>
                <button
                  type="button"
                  className={`${styles.iconRailBtn} ${teamTabletPopover === 'players' ? styles.iconRailBtnActive : ''}`}
                  onClick={() => toggleTeamTabletPopover('players')}
                  aria-label="Players per team"
                  title="Players per team"
                >
                  <span className={styles.iconRailGlyph} aria-hidden>
                    👥
                  </span>
                </button>
                {teamTabletPopover === 'players' ? (
                  <div className={styles.teamTabletPopover} aria-label="Players per team options">
                    {[7, 9, 11].map((size) => (
                      <button
                        key={`team-size-${size}`}
                        type="button"
                        className={`${styles.teamTabletOptionBtn} ${teamSize === size ? styles.teamTabletOptionBtnActive : ''}`}
                        onClick={() => handleTeamSizeTabletSelect(size as 7 | 9 | 11)}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={styles.teamTabletToolSlot}>
                <button
                  type="button"
                  className={`${styles.iconRailBtn} ${teamTabletPopover === 'offenseFormation' ? styles.iconRailBtnActive : ''}`}
                  onClick={() => toggleTeamTabletPopover('offenseFormation')}
                  aria-label="Offense formation"
                  title="Offense formation"
                >
                  <span className={styles.iconRailGlyph} aria-hidden>
                    O
                  </span>
                </button>
                {teamTabletPopover === 'offenseFormation' ? (
                  <div className={styles.teamTabletPopover} aria-label="Offense formation options">
                    {formationOptions.map((formation) => (
                      <button
                        key={`offense-formation-${formation}`}
                        type="button"
                        className={`${styles.teamTabletOptionBtn} ${offenseFormation === formation ? styles.teamTabletOptionBtnActive : ''}`}
                        onClick={() => handleOffenseFormationTabletSelect(formation)}
                      >
                        {formation}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={styles.teamTabletToolSlot}>
                <button
                  type="button"
                  className={`${styles.iconRailBtn} ${teamTabletPopover === 'defenseFormation' ? styles.iconRailBtnActive : ''}`}
                  onClick={() => toggleTeamTabletPopover('defenseFormation')}
                  aria-label="Defense formation"
                  title="Defense formation"
                >
                  <span className={styles.iconRailGlyph} aria-hidden>
                    D
                  </span>
                </button>
                {teamTabletPopover === 'defenseFormation' ? (
                  <div className={styles.teamTabletPopover} aria-label="Defense formation options">
                    {formationOptions.map((formation) => (
                      <button
                        key={`defense-formation-${formation}`}
                        type="button"
                        className={`${styles.teamTabletOptionBtn} ${defenseFormation === formation ? styles.teamTabletOptionBtnActive : ''}`}
                        onClick={() => handleDefenseFormationTabletSelect(formation)}
                      >
                        {formation}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className={styles.iconRailBtn}
                onClick={reset}
                aria-label="Reset positions"
                title="Reset positions"
              >
                <span className={styles.iconRailGlyph} aria-hidden>
                  ↺
                </span>
              </button>
            </div>
          ) : null}
        </div>
      )}
        </div>
      </div>
    </div>
  )
}

