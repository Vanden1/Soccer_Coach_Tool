# Soccer-Coach-Tool Project Understanding

## Module Responsibilities

- `src/main.tsx`: SPA bootstrap (`createRoot`, `StrictMode`).
- `src/App.tsx`: top-level shell, tutorial modal, theme toggle, and video-mode layout switching.
- `src/components/SoccerField.tsx`: core product behavior (team setup, player movement, annotations, recordings, and video markup) plus local persistence glue.
- `src/components/fieldAnnotations.ts`: annotation domain model, geometry helpers, hit-testing, and annotation persistence helpers.
- `src/theme.ts`: load/apply/persist theme selection.

## Core Runtime Workflows

1. Startup
   - `index.html` applies saved light/dark theme early.
   - `main.tsx` mounts `App`, then `SoccerField` initializes state from `localStorage`.
2. Team and formations
   - Team size updates reset offense/defense formations to defaults for that size.
   - `buildPieces` + formation helpers compute normalized field positions.
   - Goalkeeper drags persist in `soccerCoach.gkOverrides.v1`.
3. Player naming
   - Inputs in the `Player names` tab update `playerNames`.
   - Names are merged onto pieces and persisted via `soccerCoach.playerNames.v1`.
4. Field annotation
   - SVG pointer interactions create/erase/move line/circle/arrow annotations.
   - Annotation array persists via `soccerCoach.annotations.v1`.
5. Play recording and playback
   - `Create play` stores snapshots, `Save step` captures movements, `Save play` persists to `soccerCoach.plays.v1`.
   - Playback animates step transitions with `requestAnimationFrame`.
6. Video markup
   - Local video file is loaded through `URL.createObjectURL`.
   - Video annotations are intentionally transient and reset on tab/file changes.

## Suggested Seams For Splitting `SoccerField.tsx`

1. `soccerDomain.ts`
   - Formation parsing and layout (`parseFormation`, `positionsFromFormation`, `buildPieces`).
   - Snapshot/playback primitives (`snapshotPieces`, `snapshotsToMap`, interpolation).
2. `useTeamBoardState.ts`
   - Team-size/formation state, player names, draggable pieces, goalkeeper persistence.
3. `useFieldAnnotations.ts`
   - Tool mode, drafts, pointer handlers, annotation persistence.
4. `usePlayRecordings.ts`
   - Draft play lifecycle, save/load, step navigation, playback state machine.
5. `useVideoMarkup.ts`
   - File loading, media controls state, video annotation interactions.

## Quality Baseline Implemented

- Added unit tests for formation parsing/layout and playback interpolation.
- Added CI workflow for `lint`, `build`, and `test` on pull requests and pushes to `main`.
- Added explicit `typecheck` script (`tsc -b`) and wired it into CI.

## Remaining Gaps

- No strict TypeScript mode yet (`"strict": true` not enabled).
- No end-to-end coverage for pointer-heavy interactions.
- `SoccerField.tsx` remains the main complexity hotspot until seam extraction is completed.
