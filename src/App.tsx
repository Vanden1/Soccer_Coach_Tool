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

const SHARED_PASSWORD = 'soccer-coach'


function App() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
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
        await createUserWithEmailAndPassword(auth, email.trim(), SHARED_PASSWORD)
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), SHARED_PASSWORD)
      }
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
            Enter your email to {authMode === 'signup' ? 'create your account' : 'sign in'}.
          </p>
          <p className="authHint">Password is set automatically for this app.</p>
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
