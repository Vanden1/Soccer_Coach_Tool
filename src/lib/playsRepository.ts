import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  type DocumentData,
} from 'firebase/firestore'
import { db } from './firebase'
import type { SavedPlay } from '../components/SoccerField'

const PLAYS_STORAGE_KEY = 'soccerCoach.plays.v1'
const MIGRATION_MARKER_PREFIX = 'soccerCoach.playsMigrated'

function playsCollection(uid: string) {
  return collection(db, 'users', uid, 'plays')
}

function toSavedPlay(id: string, data: DocumentData): SavedPlay {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : `Play ${id}`,
    teamSize: data.teamSize === 7 || data.teamSize === 9 ? data.teamSize : 11,
    offenseFormation:
      typeof data.offenseFormation === 'string' ? data.offenseFormation : '1-3-4-3',
    defenseFormation:
      typeof data.defenseFormation === 'string' ? data.defenseFormation : '1-4-4-2',
    gkOverrides:
      data.gkOverrides && typeof data.gkOverrides === 'object' ? data.gkOverrides : {},
    startPositions: Array.isArray(data.startPositions) ? data.startPositions : [],
    steps: Array.isArray(data.steps) ? data.steps : [],
  }
}

export async function loadPlaysForUser(uid: string): Promise<SavedPlay[]> {
  const snapshot = await getDocs(playsCollection(uid))
  const plays = snapshot.docs.map((entry) => toSavedPlay(entry.id, entry.data()))
  plays.sort((a, b) => Number(a.id) - Number(b.id))
  return plays
}

export async function savePlaysForUser(uid: string, plays: SavedPlay[]): Promise<void> {
  const collectionRef = playsCollection(uid)
  const existingSnapshot = await getDocs(collectionRef)
  const incoming = new Set(plays.map((play) => play.id))

  await Promise.all(
    plays.map((play) =>
      setDoc(doc(collectionRef, play.id), {
        ...play,
        updatedAt: serverTimestamp(),
      }),
    ),
  )

  const deleteTasks = existingSnapshot.docs
    .filter((entry) => !incoming.has(entry.id))
    .map((entry) => deleteDoc(entry.ref))
  await Promise.all(deleteTasks)
}

function loadLocalPlays(): SavedPlay[] {
  try {
    const raw = localStorage.getItem(PLAYS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as SavedPlay[]) : []
  } catch {
    return []
  }
}

function migrationKeyFor(uid: string) {
  return `${MIGRATION_MARKER_PREFIX}.${uid}.v1`
}

export async function migrateLocalPlaysToUser(uid: string): Promise<void> {
  const marker = migrationKeyFor(uid)
  if (localStorage.getItem(marker) === '1') return

  const localPlays = loadLocalPlays()
  if (localPlays.length === 0) {
    localStorage.setItem(marker, '1')
    return
  }

  const collectionRef = playsCollection(uid)
  const remoteSnapshot = await getDocs(collectionRef)
  const remoteIds = new Set(remoteSnapshot.docs.map((entry) => entry.id))

  const missingLocal = localPlays.filter((play) => !remoteIds.has(play.id))
  await Promise.all(
    missingLocal.map((play) =>
      setDoc(doc(collectionRef, play.id), {
        ...play,
        updatedAt: serverTimestamp(),
      }),
    ),
  )

  localStorage.setItem(marker, '1')
}
