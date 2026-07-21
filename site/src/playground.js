/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · live code playground
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Progressive enhancement over a pre-rendered `<pre>`. With JS blocked the
 * block stays a readable, copyable code sample. With JS on it becomes an
 * editable snippet that runs against the public read-only RPC inside a Web
 * Worker — no DOM, no cookies, no site storage, and no key surface anywhere.
 *
 * Every run spins up a fresh module worker and terminates it when the snippet
 * resolves OR when it blows the time budget. An infinite loop in a snippet
 * therefore hangs one throwaway worker and nothing else, and the Run button
 * recovers instead of wedging with no visible cause.
 */

const RUN_TIMEOUT_MS = 6000
const ICONS = { pending: '•', success: '✓', error: '✕' }

let runCounter = 0

/** Run one snippet in a throwaway worker; resolve with its posted result. */
function runInWorker(source, network) {
  return new Promise((resolve) => {
    let worker
    try {
      worker = new Worker(new URL('./playground-worker.js', import.meta.url), { type: 'module' })
    } catch (error) {
      resolve({ ok: false, logs: [], error: `Could not start the runner: ${error?.message ?? error}` })
      return
    }

    const id = ++runCounter
    const timer = setTimeout(() => {
      worker.terminate()
      resolve({
        ok: false,
        logs: [],
        error: `Timed out after ${RUN_TIMEOUT_MS}ms and was stopped. If the snippet has an infinite loop, remove it.`
      })
    }, RUN_TIMEOUT_MS)

    worker.onmessage = (event) => {
      if (event.data?.id !== id) return
      clearTimeout(timer)
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (event) => {
      clearTimeout(timer)
      worker.terminate()
      resolve({ ok: false, logs: [], error: event.message || 'The runner crashed.' })
    }

    worker.postMessage({ id, source, network })
  })
}

/** Build one labelled DOM element; children are strings or nodes. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('data-') || key === 'role' || key === 'type' || key === 'aria-live') {
      node.setAttribute(key, value)
    } else node[key] = value
  }
  for (const child of [].concat(children)) {
    node.append(child)
  }
  return node
}

/** The output pane, mirroring the existing .output component's markup. */
function buildOutput() {
  const icon = el('i', { class: 'output__icon', 'data-output-icon': '', 'aria-hidden': 'true', text: ICONS.pending })
  const label = el('span', { 'data-output-label': '', text: 'Idle' })
  const pre = el('pre')
  const head = el('div', { class: 'output__head' }, [icon, label])
  const output = el('div', {
    class: 'output',
    'data-output': '',
    'data-state': 'pending',
    role: 'status',
    'aria-live': 'polite'
  })
  output.hidden = true
  output.append(head, pre)
  return output
}

function setOutput(output, state, label, body) {
  output.dataset.state = state
  output.querySelector('[data-output-icon]').textContent = ICONS[state] || ICONS.pending
  output.querySelector('[data-output-label]').textContent = label
  // Untrusted RPC strings only ever reach the DOM through textContent.
  output.querySelector('pre').textContent = body
  output.hidden = false
}

/** Upgrade one pre-rendered [data-playground] block into a live editor. */
function enhance(block) {
  const codeNode = block.querySelector('code')
  if (!codeNode) return
  const source = codeNode.textContent
  const defaultNetwork = block.dataset.network === 'testnet' ? 'testnet' : 'mainnet'

  // Editor. Escape-then-Tab inserts a literal tab; a plain Tab always moves
  // focus out, so keyboard users are never trapped in the textarea.
  const editor = el('textarea', {
    class: 'playground__editor',
    spellcheck: false,
    autocomplete: 'off',
    autocapitalize: 'off',
    'data-editor': ''
  })
  editor.value = source
  editor.setAttribute('aria-label', 'Editable snippet. Ctrl or Cmd plus Enter runs it.')

  let escapeArmed = false
  editor.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      run()
      return
    }
    if (event.key === 'Escape') {
      escapeArmed = true
      return
    }
    if (event.key === 'Tab' && escapeArmed) {
      event.preventDefault()
      const { selectionStart: s, selectionEnd: e, value } = editor
      editor.value = `${value.slice(0, s)}\t${value.slice(e)}`
      editor.selectionStart = editor.selectionEnd = s + 1
    }
    escapeArmed = false
  })

  // Controls.
  const network = el('select', { class: 'playground__net', 'data-network-select': '', 'aria-label': 'Network' }, [
    el('option', { value: 'mainnet', text: 'mainnet · 4663' }),
    el('option', { value: 'testnet', text: 'testnet · 46630' })
  ])
  network.value = defaultNetwork

  const runBtn = el('button', { type: 'button', class: 'btn btn--sm btn--primary', text: 'Run' })
  const resetBtn = el('button', { type: 'button', class: 'btn btn--sm', text: 'Reset' })

  const controls = el('div', { class: 'playground__controls' }, [network, resetBtn, runBtn])
  const output = buildOutput()

  async function run() {
    runBtn.disabled = true
    runBtn.setAttribute('aria-busy', 'true')
    setOutput(output, 'pending', 'Running', '…')
    const started = performance.now()
    const result = await runInWorker(editor.value, network.value)
    const ms = Math.round(performance.now() - started)

    const logs = (result.logs || []).join('\n')
    if (result.ok) {
      const value = result.value == null || result.value === 'null' ? '' : result.value
      const body = [logs, value && `⤷ returned:\n${value}`].filter(Boolean).join('\n\n') || '(no output)'
      setOutput(output, 'success', `Ran on ${network.value} in ${ms}ms`, body)
    } else {
      const body = [result.error, logs && `— console before the error —\n${logs}`].filter(Boolean).join('\n\n')
      setOutput(output, 'error', 'Error', body)
    }
    runBtn.disabled = false
    runBtn.removeAttribute('aria-busy')
  }

  runBtn.addEventListener('click', run)
  resetBtn.addEventListener('click', () => {
    editor.value = source
    output.hidden = true
    editor.focus()
  })

  // Swap the static source display for the editor, keep head + note in place.
  const staticPre = block.querySelector('.playground__source')
  if (staticPre) staticPre.replaceWith(editor)
  editor.after(controls, output)
  block.dataset.enhanced = 'true'
}

export function initPlaygrounds(root = document) {
  for (const block of root.querySelectorAll('[data-playground]:not([data-enhanced])')) {
    try {
      enhance(block)
    } catch (error) {
      // A single broken block must never take the page down.
      console.error('playground: failed to enhance a block', error)
    }
  }
}
/* built by nirholas x.com/nichxbt */
