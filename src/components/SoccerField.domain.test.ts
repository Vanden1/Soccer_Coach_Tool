import { describe, expect, it } from 'vitest'
import {
  buildPieces,
  interpolateStepPositions,
  parseFormation,
  positionsFromFormation,
  snapshotPieces,
  snapshotsToMap,
} from './soccerDomain'

describe('formation parsing and layout', () => {
  it('parses hyphen-separated formation numbers', () => {
    expect(parseFormation('1-3-4-3')).toEqual([1, 3, 4, 3])
  })

  it('throws for invalid formation segments', () => {
    expect(() => parseFormation('1-2-a')).toThrow('Invalid formation segment: a')
    expect(() => parseFormation('1-2-1.5')).toThrow()
  })

  it('builds expected team count and goalkeeper lane positions', () => {
    const offense = positionsFromFormation('1-3-3-2', 'offense')
    const defense = positionsFromFormation('1-3-3-2', 'defense')

    expect(offense).toHaveLength(9)
    expect(defense).toHaveLength(9)
    expect(offense[0]?.x).toBeCloseTo(0.09, 5)
    expect(defense[0]?.x).toBeCloseTo(0.91, 5)
  })
})

describe('piece and playback helpers', () => {
  it('respects goalkeeper overrides when building pieces', () => {
    const pieces = buildPieces(7, '1-2-3-1', '1-2-3-1', {
      offense: { x: 0.12, y: 0.44 },
      defense: { x: 0.88, y: 0.56 },
    })

    const offenseGk = pieces.find((piece) => piece.id === 'offense-1')
    const defenseGk = pieces.find((piece) => piece.id === 'defense-1')
    const ball = pieces.find((piece) => piece.id === 'ball')

    expect(pieces).toHaveLength(15)
    expect(offenseGk?.pos).toEqual({ x: 0.12, y: 0.44 })
    expect(defenseGk?.pos).toEqual({ x: 0.88, y: 0.56 })
    expect(ball?.pos).toEqual({ x: 0.5, y: 0.5 })
  })

  it('creates snapshot map for fast lookup', () => {
    const pieces = buildPieces(7, '1-2-3-1', '1-2-3-1')
    const snaps = snapshotPieces(pieces)
    const map = snapshotsToMap(snaps)

    expect(snaps).toHaveLength(15)
    expect(map.get('offense-1')).toEqual(pieces[0]?.pos)
    expect(map.get('ball')).toEqual({ x: 0.5, y: 0.5 })
  })

  it('interpolates movement forward and backward', () => {
    const pieces = buildPieces(7, '1-2-3-1', '1-2-3-1')
    const player = pieces.find((piece) => piece.id === 'offense-2')
    expect(player).toBeDefined()
    if (!player) return

    const moved = interpolateStepPositions(
      pieces,
      [
        {
          id: 'offense-2',
          from: player.pos,
          to: { x: 0.4, y: 0.4 },
        },
      ],
      0.5,
      'forward',
    )
    const halfway = moved.find((piece) => piece.id === 'offense-2')
    expect(halfway?.pos.x).toBeCloseTo((player.pos.x + 0.4) / 2, 5)
    expect(halfway?.pos.y).toBeCloseTo((player.pos.y + 0.4) / 2, 5)

    const rewind = interpolateStepPositions(
      pieces,
      [
        {
          id: 'offense-2',
          from: player.pos,
          to: { x: 0.4, y: 0.4 },
        },
      ],
      0.5,
      'backward',
    )
    const reverseHalfway = rewind.find((piece) => piece.id === 'offense-2')
    expect(reverseHalfway?.pos.x).toBeCloseTo((player.pos.x + 0.4) / 2, 5)
    expect(reverseHalfway?.pos.y).toBeCloseTo((player.pos.y + 0.4) / 2, 5)
  })
})
