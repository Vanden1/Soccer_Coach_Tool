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
            This is an interactive soccer field for coaching: arrange players and
            the ball, sketch tactics, record multi-step plays, and optionally
            label athletes by name. Everything runs in your browser; plays and
            names are stored on this device.
          </p>

          <section className={styles.section}>
            <h3 className={styles.h3}>Moving pieces</h3>
            <p>
              Open the <strong>Annotations</strong> tab and choose{' '}
              <strong>Move</strong>. While Move is active, drag players and the
              ball on the field. Goalkeeper positions you drag are remembered for
              future sessions.
            </p>
            <p>
              You can also drag any existing annotation (line, circle, or arrow)
              to reposition it while Move is active. This works with mouse,
              touch, and pen input.
            </p>
            <p>
              With Move selected, <strong>double-click</strong> a player (or{' '}
              <strong>double-tap</strong> on touch) to highlight them for
              emphasis.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Team Organization</h3>
            <p>
              Set <strong>players per team</strong> (7, 9, or 11), then pick{' '}
              <strong>offense</strong> and <strong>defense</strong> formations.
              Use <strong>Reset positions</strong> to snap everyone back to those
              formations while keeping the ball where it is.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Player names</h3>
            <p>
              Optional names appear under jersey numbers on the field. They are
              saved locally in your browser.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Recordings (saved plays)</h3>
            <ol className={styles.steps}>
              <li>
                <strong>Create play</strong> to start recording from the current
                layout.
              </li>
              <li>
                Move pieces, then press <strong>Save step</strong> to capture that
                motion. Repeat for each phase of the play.
              </li>
              <li>
                <strong>Save play</strong> stores the play with the title you
                entered (or a default name).
              </li>
            </ol>
            <p>
              Choose a play under <strong>Saved plays</strong>, then use{' '}
              <strong>Play all</strong> for a full run-through, or{' '}
              <strong>Previous step</strong> / <strong>Next step</strong> to step
              manually. <strong>Restart</strong> jumps back to the opening
              positions.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Annotations</h3>
            <p>
              Besides Move, you can draw <strong>lines</strong>,{' '}
              <strong>circles</strong>, and <strong>arrows</strong> on the pitch.
              Pick a color and line thickness, then click and drag on the field.
              Use <strong>Erase</strong> and tap a drawing to remove it, or{' '}
              <strong>Clear drawings</strong> to remove all annotations at once.
            </p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.h3}>Theme</h3>
            <p>
              Use the <strong>Theme</strong> control in the header for system,
              light, or dark appearance.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
