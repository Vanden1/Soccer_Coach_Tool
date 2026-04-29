import { useState } from 'react'
import './App.css'
import { SoccerField, type SoccerFieldTab } from './components/SoccerField'
import { ThemeToggle } from './components/ThemeToggle'
import { TutorialModal } from './components/TutorialModal'


function App() {
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SoccerFieldTab>('team')
  const isVideoMode = activeTab === 'playVideo'

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
            <ThemeToggle />
          </div>
        </header>
      ) : null}
      <main className={`main ${isVideoMode ? 'mainVideoMode' : ''}`}>
        <div className={`card ${isVideoMode ? 'cardVideoMode' : ''}`}>
          <SoccerField onActiveTabChange={setActiveTab} />
        </div>
      </main>
      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </div>
  )
}

export default App
