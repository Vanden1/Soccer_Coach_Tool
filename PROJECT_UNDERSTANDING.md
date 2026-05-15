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

## Session Update (Current Handoff Snapshot)

This section captures everything implemented in the latest UI iteration so a new agent can continue immediately.

### High-level product state

- App remains a single React/Vite SPA with Firebase Auth + Firestore-backed plays.
- Primary active work area is tablet/coarse layout behavior in `App` header and `SoccerField`.
- Desktop behavior is intentionally preserved; most new behavior is gated behind coarse-pointer + tablet-width media rules.

### Files changed in this session

- `src/App.tsx`
  - Header title container now includes `titleCompactTablet` hook class.
- `src/App.css`
  - Added tablet header compaction rules (`@media (pointer: coarse) and (min-width: 700px)`):
    - `Coaching tool` + `Soccer Field` inline on one row.
    - Reduced topbar vertical padding.
    - Smaller right-side controls (`How to use`, `Sign out`, theme selector) for tighter header height.
- `src/components/SoccerField.tsx`
  - Introduced shared tab metadata (`TAB_ITEMS`) and tool metadata (`TOOL_ITEMS`).
  - Added tablet navigation shell (`tabletWorkspace`, `tabletNavRail`, `mainContent`) using icon tabs.
  - Play Video:
    - Removed displayed filename text from Play Video controls.
    - Added right-side icon rail with collapsible color palette + thickness slider.
  - Team mode:
    - Added `TeamTabletPopover` state (`players`, `offenseFormation`, `defenseFormation`, `null`).
    - Added right-side icon rail with left-opening popouts for:
      - players-per-team select
      - offense formation
      - defense formation
      - reset positions
    - Popouts auto-close on selection and reset when leaving Team tab.
    - Desktop Team toolbar retained but hidden on tablet Team mode.
    - Team legends (offense/defense/ball chips) hidden in tablet Team mode only.
- `src/components/SoccerField.module.css`
  - Added tablet shell/rail layout classes:
    - `tabletWorkspace`, `tabletNavRail`, `mainContent`
    - `playVideoWorkspace` and `playVideoTabletToolsRail`
    - `teamWorkspace` and `teamTabletToolsRail`
    - popout classes (`teamTabletPopover`, `teamTabletOptionBtn`, active states)
  - Added coarse tablet media behavior:
    - hide top horizontal tabs in tablet rail modes
    - show left icon nav rail globally for tablet
    - show right rail for Play Video and Team tab contexts

### Current runtime UX behavior (important)

1. Global navigation on tablet/coarse (`min-width: 700px`)
   - Left side icon tab rail is the primary tab switcher.
   - Horizontal tab strip is hidden in this mode.
2. Play Video tab on tablet
   - Left icon rail persists for tab nav.
   - Right icon rail controls upload/markup/color/thickness/clear.
   - Color and thickness are toggle panels; color auto-closes after pick.
3. Team Organization tab on tablet
   - Right icon rail replaces inline Team toolbar.
   - Three selectors open as horizontal popouts to the left and close after selection.
   - Offense/Defense/Ball legend chips are suppressed in this mode.
4. Desktop/non-tablet
   - Existing top tab list and inline controls remain the expected default.

### Validation run results (latest)

- `npm run lint`: passes with one pre-existing warning in `src/components/SoccerField.tsx`:
  - `react-hooks/exhaustive-deps` for missing `gkOverrides` dependency in the team-size effect.
- `npm run typecheck`: pass.
- `npm run test`: pass (current suite: 1 file, 6 tests).

### Why these changes were made

- User requested significantly more effective tablet use of vertical space.
- Strategy used:
  - move dense control surfaces from top bars into vertical icon rails,
  - gate behavior to tablet/coarse media conditions,
  - preserve desktop interaction model.

### Current risks / follow-up items for next agent

- `SoccerField.tsx` complexity increased further due to multiple tablet mode branches; extracting hooks/components is still advisable.
- Tablet interactions should be manually validated on real hardware for:
  - portrait/landscape sizing,
  - popout clipping/overflow at narrow widths,
  - touch target comfort and accidental overlap with field interactions.
- The `gkOverrides` effect dependency warning remains unresolved (known pre-existing issue).
- No E2E coverage exists for pointer-heavy/tablet-specific interactions.

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
