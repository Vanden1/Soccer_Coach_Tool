# Soccer-Coach-Tool Project Understanding

## Module Responsibilities

- `src/main.tsx`: SPA bootstrap (`createRoot`, `StrictMode`) and Firebase boot import.
- `src/App.tsx`: top-level shell, auth gating (Firebase email auth), tutorial modal, theme toggle, and video-mode layout switching.
- `src/components/SoccerField.tsx`: core product behavior (team setup, player movement, annotations, recordings, and video markup), now with Firestore-backed recordings by user.
- `src/components/fieldAnnotations.ts`: annotation domain model, geometry helpers, hit-testing, and annotation persistence helpers.
- `src/lib/firebase.ts`: Firebase app init + exported `auth` and `db` clients with env guardrails.
- `src/lib/playsRepository.ts`: Firestore recordings repository (`load/save`) and one-time localStorage migration logic.
- `src/theme.ts`: load/apply/persist theme selection.

## Core Runtime Workflows

1. Startup
   - `index.html` applies saved light/dark theme early.
   - `main.tsx` mounts `App`, initializes Firebase, then auth state decides whether to show login or `SoccerField`.
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
   - `Create play` stores snapshots, `Save step` captures movements, `Save play` updates in-memory plays.
   - Plays are loaded/saved to Firestore at `users/{uid}/plays/{playId}` through `playsRepository`.
   - On first login per UID, local `soccerCoach.plays.v1` is migrated once into Firestore (`soccerCoach.playsMigrated.{uid}.v1` marker).
   - Playback animates step transitions with `requestAnimationFrame`.
6. Video markup
   - Local video file is loaded through `URL.createObjectURL`.
   - Video annotations are intentionally transient and reset on tab/file changes.
7. Authentication
   - Login is currently email-only in UI.
   - Sign-up/sign-in both use shared password constant `soccer-coach` in `App.tsx`.
   - Auth state controls access to the main app and Firestore recordings data.

## Session Update (Tonight)

- Firebase client wiring is complete:
  - `firebase` dependency installed.
  - `.env.example` added and `.env` safely ignored.
  - Firestore/Auth clients exported from `src/lib/firebase.ts`.
- Firestore is enabled in the Firebase project and recordings save/load is working in production.
- Vercel production environment variables were configured and production redeployed successfully.
- Sign-in page was polished:
  - increased card spacing and form rhythm.
  - password field removed per latest requirement (email-only input).
- Field visuals were scaled up:
  - players and ball increased (current sizes intentionally retained).
  - field markings and center circle were enlarged.
- Tablet fit issue was addressed:
  - app/main height model changed to use remaining viewport under header.
  - field container spacing/constraints tuned to reduce clipping risk.

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
- Added Firebase auth + Firestore integration for recordings.

## Remaining Gaps

- Auth policy risk: shared password (`soccer-coach`) is intentionally simple but weak for real security.
- Login error UX can be improved (map Firebase codes to friendly text).
- Firestore preview env setup in Vercel should be re-verified from dashboard for non-main preview branches.
- Tablet responsiveness should be visually rechecked on real devices in both orientations after latest CSS adjustments.
- No strict TypeScript mode yet (`"strict": true` not enabled).
- No end-to-end coverage for pointer-heavy interactions.
- `SoccerField.tsx` remains the main complexity hotspot until seam extraction is completed.

## Next Session Suggested Starting Point

1. Manual QA pass on tablet portrait/landscape:
   - confirm full-field fit without page scroll.
   - confirm player/ball scale remains at current values.
2. Validate production auth + recordings flow once more after latest UI/layout changes.
3. Decide whether to keep shared-password auth approach or move to normal user-defined passwords.
