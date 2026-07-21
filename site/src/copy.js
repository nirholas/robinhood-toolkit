/**
 * robinhood-toolkit · copy-to-clipboard for code blocks
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Every snippet that would sign or send a transaction is copy-only by design.
 * Nothing in this site executes a write path in the reader's browser, so the
 * copy button is the handoff point to the reader's own terminal.
 */

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Older Safari and any non-secure context: the selection path still works.
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('Clipboard unavailable')
}

export function initCopyButtons(root = document) {
  for (const button of root.querySelectorAll('[data-copy-target]')) {
    button.addEventListener('click', async () => {
      const source = document.getElementById(button.dataset.copyTarget)
      if (!source) return
      const original = button.dataset.copyLabel || button.textContent.trim()
      button.dataset.copyLabel = original
      try {
        await writeClipboard(source.textContent)
        button.textContent = 'Copied'
        button.dataset.copied = 'true'
      } catch {
        button.textContent = 'Press Ctrl+C'
        const range = document.createRange()
        range.selectNodeContents(source)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      }
      window.setTimeout(() => {
        button.textContent = original
        delete button.dataset.copied
      }, 2000)
    })
  }
}
