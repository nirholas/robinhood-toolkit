/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · theme controller
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Three states, not two: "system" follows prefers-color-scheme, "light" and
 * "dark" are explicit overrides that beat the OS setting in both directions.
 * The stamped data-theme attribute is what the CSS override blocks key off.
 * A blocking inline script in the document head applies the stored value
 * before first paint, so this module never causes a flash.
 */

const STORAGE_KEY = 'rht-theme'
const MODES = ['system', 'light', 'dark']

export function storedMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return MODES.includes(value) ? value : 'system'
  } catch {
    // Private mode or blocked storage. Fall back to following the OS.
    return 'system'
  }
}

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolvedTheme(mode = storedMode()) {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

export function applyMode(mode) {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)

  try {
    if (mode === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Storage unavailable: the choice still applies for this page view.
  }

  const theme = resolvedTheme(mode)
  root.style.colorScheme = theme
  // Anything that cannot read CSS custom properties reactively (the chart, for
  // one) listens for this instead of polling.
  window.dispatchEvent(new CustomEvent('themechange', { detail: { mode, theme } }))
  return theme
}

function label(mode) {
  const theme = resolvedTheme(mode)
  const next = theme === 'dark' ? 'light' : 'dark'
  const suffix = mode === 'system' ? ' (following system)' : ''
  return `Switch to ${next} theme. Currently ${theme}${suffix}.`
}

export function initTheme() {
  const button = document.querySelector('[data-theme-toggle]')
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const sync = () => {
    const mode = storedMode()
    if (button) {
      button.setAttribute('aria-label', label(mode))
      button.setAttribute('title', label(mode))
    }
  }

  media.addEventListener('change', () => {
    if (storedMode() === 'system') {
      window.dispatchEvent(
        new CustomEvent('themechange', { detail: { mode: 'system', theme: resolvedTheme('system') } })
      )
      sync()
    }
  })

  if (button) {
    button.addEventListener('click', () => {
      // Toggling from "system" commits to the opposite of what is on screen,
      // which is the behaviour a reader expects from a single button.
      applyMode(resolvedTheme() === 'dark' ? 'light' : 'dark')
      sync()
    })
  }

  sync()
  document.documentElement.style.colorScheme = resolvedTheme()
}

/** Read a resolved token value off the document. Used by the chart layer. */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
/* built by nirholas x.com/nichxbt */
