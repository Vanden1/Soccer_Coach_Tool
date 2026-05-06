import { useEffect, useState, type FormEvent } from 'react'
import './App.css'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { SoccerField, type SoccerFieldTab } from './components/SoccerField'
import { ThemeToggle } from './components/ThemeToggle'
import { TutorialModal } from './components/TutorialModal'
import { auth } from './lib/firebase'


function App() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SoccerFieldTab>('team')
  const isVideoMode = activeTab === 'playVideo'

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user)
      setAuthLoading(false)
      setAuthError(null)
    })
    return unsubscribe
  }, [])

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthError(null)
    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email.trim(), password)
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      }
      setPassword('')
      setShowPassword(false)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to authenticate.')
    }
  }

  async function handleLogout() {
    try {
      await signOut(auth)
      setActiveTab('team')
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to sign out.')
    }
  }

  if (authLoading) {
    return (
      <main className="authShell">
        <div className="authCard">Checking login session...</div>
      </main>
    )
  }

  if (!authUser) {
    return (
      <main className="authShell">
        <form className="authCard" onSubmit={handleAuthSubmit}>
          <div className="authTitle">Soccer Coaching Tool Login</div>
          <p className="authSubtitle">
            Sign in to load and save your Recordings.
          </p>
          <label className="authLabel" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="authInput"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
          <label className="authLabel" htmlFor="password">
            Password
          </label>
          <div className="authPasswordRow">
            <input
              id="password"
              className="authInput authInputPassword"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
            <span
              className="authPasswordToggle"
              role="button"
              tabIndex={0}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((current) => !current)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setShowPassword((current) => !current)
                }
              }}
            >
              <svg
                viewBox="0 0 24 24"
                className="authPasswordToggleIcon"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                {showPassword ? null : (
                  <path
                    d="M4 20 20 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </span>
          </div>
          {authError ? <p className="authError">{authError}</p> : null}
          <button className="tutorialTrigger" type="submit">
            {authMode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          <button
            className="authSecondaryBtn"
            type="button"
            onClick={() =>
              setAuthMode((prev) => (prev === 'signup' ? 'signin' : 'signup'))
            }
          >
            {authMode === 'signup'
              ? 'Already have an account? Sign in'
              : 'Need an account? Create one'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <div className={`app ${isVideoMode ? 'appVideoMode' : ''}`}>
      {!isVideoMode ? (
        <header className="topbar">
          <div className="title">
            <div className="kicker">Coaching tool</div>
            <div className="h1">Soccer Field</div>
          </div>
          <div className="topbarActions">
            <button
              type="button"
              className="tutorialTrigger"
              onClick={() => setTutorialOpen(true)}
              aria-haspopup="dialog"
            >
              How to use
            </button>
            <button type="button" className="authSecondaryBtn" onClick={handleLogout}>
              Sign out
            </button>
            <ThemeToggle />
          </div>
        </header>
      ) : null}
      <main className={`main ${isVideoMode ? 'mainVideoMode' : ''}`}>
        <div className={`card ${isVideoMode ? 'cardVideoMode' : ''}`}>
          <SoccerField userId={authUser.uid} onActiveTabChange={setActiveTab} />
        </div>
      </main>
      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </div>
  )
}

export default App
