import { useEffect, useId, useRef } from 'react'
import styles from './TutorialModal.module.css'

type TutorialModalProps = {
  open: boolean
  onClose: () => void
}

export function TutorialModal({ open, onClose }: TutorialModalProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            How to use this app
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close tutorial"
          >
            ×
          </button>
        </div>
        <div className={styles.body}>
          <p className={styles.lead}>
            Use the tabs to set formations, name players, record plays, draw
            tactics, and mark up video. Everything runs in your browser. Field
            drawings, saved plays, goalkeeper positions, and player names are
            stored on this device; video markups are temporary.
          </p>

          <section className={styles.section}>
            <h3 className={styles.h3}>Team Organization tab</h3>
            <p>
              Choose <strong>players per team</strong> (7, 9, or 11), then pick
              offense and defense formations. Use <strong>Reset positions</strong>{' '}
              to snap players back to the selected formations while keeping the
              ball where it is. Goalkeeper positions (player #1) that you drag
              are remembered.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Player names tab</h3>
            <p>
              Enter optional names for offense and defense players. Names appear
              under jersey numbers on the field and are saved locally in your
              browser.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Recordings tab (saved plays)</h3>
            <ol className={styles.steps}>
              <li>
                Press <strong>Create play</strong> to start from the current
                layout.
              </li>
              <li>
                Move pieces, then press <strong>Save step</strong> for each phase
                of movement.
              </li>
              <li>
                Press <strong>Save play</strong> to store the play.
              </li>
            </ol>
            <p>
              Select a play under <strong>Saved plays</strong>, then use{' '}
              <strong>Play all</strong> for a full run-through, or{' '}
              <strong>Previous step</strong> / <strong>Next step</strong> to step
              manually. <strong>Restart</strong> returns to the play start.
              Loading a play also restores its saved team size, formations, and
              goalkeeper positions.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Annotations tab (field drawing)</h3>
            <p>
              Tools: <strong>Move</strong>, <strong>Line</strong>,{' '}
              <strong>Free Draw</strong>, <strong>Circle</strong>,{' '}
              <strong>Arrow</strong>, and <strong>Erase</strong>. Pick color and
              thickness, then draw directly on the field.
            </p>
            <p>
              In <strong>Move</strong>, drag players and the ball. You can also
              move line/circle/arrow annotations. Free-draw strokes are erasable
              but are not draggable as a single shape.
            </p>
            <p>
              Use <strong>Erase</strong> to remove one drawing or{' '}
              <strong>Clear drawings</strong> to remove all field annotations.
              Field annotations are saved locally.
            </p>
            <p>
              On supported stylus devices (including Microsoft Surface Pen),
              drawing responds to pen pressure for thickness, the pen eraser
              acts as erase mode, and touch input is ignored while the pen is
              active to reduce accidental palm marks.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Play Video tab</h3>
            <p>
              Upload a local video file, then use playback controls to play/pause,
              jump ±10 seconds, adjust speed, and scrub the timeline.
            </p>
            <p>
              Video markup tools match the field tools (Move, Line, Free Draw,
              Circle, Arrow, Erase). Use <strong>Clear markups</strong> to remove
              all video drawings.
            </p>
            <p>
              Video markups are temporary and are cleared when you switch away
              from the tab or load another video.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Theme and help</h3>
            <p>
              Use the <strong>Theme</strong> control in the header for system,
              light, or dark appearance. If you are in <strong>Play Video</strong>
              , switch tabs to access the header and reopen this help modal.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
