import { useEffect, useState } from 'react'
import {
  applyThemeToDocument,
  getStoredTheme,
  persistTheme,
  type ThemeChoice,
} from '../theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(() => getStoredTheme())

  useEffect(() => {
    applyThemeToDocument(theme)
    persistTheme(theme)
  }, [theme])

  return (
    <label className="themeToggle">
      <span className="themeToggleLabel">Theme</span>
      <select
        className="select"
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeChoice)}
        aria-label="Color theme"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  )
}
