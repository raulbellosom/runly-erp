import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import vm from 'node:vm'

class FakeEventTarget {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const entries = this.listeners.get(type) ?? new Set()
    entries.add(listener)
    this.listeners.set(type, entries)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName) {
    super()
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.dataset = {}
    this.style = {}
    this.className = ''
    this.textContent = ''
    this.value = ''
    this.checked = false
    this.disabled = false
  }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child)
    child.parentNode = null
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'class') this.className = String(value)
    if (name.startsWith('data-')) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      this.dataset[key] = String(value)
    }
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  closest(selector) {
    const selectors = selector.split(',').map((part) => part.trim())
    let current = this
    while (current) {
      for (const part of selectors) {
        if (
          part === 'form[data-runly-form-id]' &&
          current.tagName === 'FORM' &&
          current.dataset.runlyFormId
        ) {
          return current
        }
        if (part === '[data-runly-event]' && current.dataset.runlyEvent) {
          return current
        }
        if (part === '[data-atlas-event]' && current.dataset.atlasEvent) {
          return current
        }
      }
      current = current.parentNode
    }
    return null
  }

  querySelector(selector) {
    return findElement(this, selector)
  }

  set innerHTML(_value) {
    this.children = []
  }
}

function findElement(root, selector) {
  const matches = (element) => {
    if (selector.startsWith('.')) {
      return element.className.split(/\s+/).includes(selector.slice(1))
    }
    const nameMatch = selector.match(/^\[name="([^"]+)"\]$/)
    if (nameMatch) return element.name === nameMatch[1]
    return element.tagName === selector.toUpperCase()
  }
  for (const child of root.children) {
    if (matches(child)) return child
    const nested = findElement(child, selector)
    if (nested) return nested
  }
  return null
}

function createDocument() {
  const document = new FakeEventTarget()
  document.head = new FakeElement('head')
  document.body = new FakeElement('body')
  document.visibilityState = 'visible'
  document.referrer = ''
  document.createElement = (tagName) => new FakeElement(tagName)
  document.querySelector = (selector) =>
    findElement(document.body, selector) ?? findElement(document.head, selector)
  document.getElementById = (id) => {
    const findById = (root) => {
      for (const child of root.children) {
        if (child.id === id) return child
        const nested = findById(child)
        if (nested) return nested
      }
      return null
    }
    return findById(document.head) ?? findById(document.body)
  }
  return document
}

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

async function loadSdk() {
  const source = await readFile(
    new URL('../runly-sdk.js', import.meta.url),
    'utf8',
  )
  const calls = []
  const document = createDocument()
  const window = new FakeEventTarget()
  const storage = createStorage()
  window.window = window
  window.document = document
  window.localStorage = storage
  window.location = {
    pathname: '/contacto',
    href: 'https://shop.example.com/contacto',
  }
  window.navigator = {
    doNotTrack: '0',
    sendBeacon: () => true,
  }
  window.matchMedia = () => ({ matches: false })
  window.RUNLY_CONFIG = {
    apiUrl: 'https://erp.example.com',
    company: 'acme',
    siteId: '01900000-0000-7000-8000-000000000002',
    analyticsMode: 'consent_required',
    turnstileSiteKey: '',
  }

  const fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/public/storefront/v1/config')) {
      return response(200, {
        data: {
          siteId: window.RUNLY_CONFIG.siteId,
          analyticsMode: 'consent_required',
          respectDoNotTrack: true,
          capabilities: { analytics: true, forms: true },
        },
      })
    }
    if (url.includes('/events/batch')) {
      const body = JSON.parse(options.body)
      return response(202, {
        data: { accepted: body.events.length, rejected: [] },
      })
    }
    if (url.endsWith('/forms/form-1')) {
      return response(200, {
        data: {
          id: 'form-1',
          name: 'Contacto',
          description: 'Escribenos',
          submitLabel: 'Enviar',
          successMessage: 'Gracias',
          turnstileRequired: false,
          fields: [
            {
              id: 'field-1',
              name: 'email',
              label: 'Correo',
              fieldType: 'email',
              required: true,
              placeholder: 'tu@correo.com',
              options: null,
            },
          ],
        },
      })
    }
    if (url.endsWith('/forms/form-1/submissions')) {
      return response(201, {
        data: {
          submissionId: '01900000-0000-7000-8000-000000000004',
          leadId: '01900000-0000-7000-8000-000000000005',
          message: 'Gracias',
        },
      })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }
  window.fetch = fetch
  window.URLSearchParams = URLSearchParams
  window.setInterval = () => 1
  window.clearInterval = () => {}
  window.setTimeout = (callback) => {
    callback()
    return 1
  }
  window.clearTimeout = () => {}

  const context = vm.createContext({
    window,
    document,
    localStorage: storage,
    navigator: window.navigator,
    fetch,
    URLSearchParams,
    Promise,
    JSON,
    Date,
    Math,
    Error,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (callback) => {
      callback()
      return 1
    },
    clearTimeout: () => {},
  })
  vm.runInContext(source, context)
  await Promise.resolve()
  return { window, document, calls }
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
  await Promise.resolve()
}

// Separate harness (same FakeElement/FakeDocument primitives, its own fetch
// mock) for the guest-chat widget's endpoints — kept apart from loadSdk()
// above rather than bolting chat routes onto its analytics/forms-shaped mock.
// No supabaseUrl/supabaseAnonKey in RUNLY_CONFIG here means the realtime
// enhancement's loadSupabaseClient() rejects before ever reaching its
// dynamic import() of the Supabase CDN bundle, so these tests only exercise
// the polling-safety-net code path — which is also the one guaranteed to run
// for every guest regardless of network/CDN conditions.
async function loadChatSdk(configOverrides) {
  // Mirrors serveRunlySdk in apps/api/src/index.js: the chat widget is split
  // across runly-sdk-chat.js (session/REST/realtime) and
  // runly-sdk-chat-widget.js (DOM rendering, which reads the first file's
  // private window.__runlyChatApi bridge) to keep each source file under the
  // project's line-count limit — both must run, in this order, for
  // window.RunlyERP.renderChat to exist.
  const parts = await Promise.all(
    ['../runly-sdk.js', '../runly-sdk-chat.js', '../runly-sdk-chat-widget.js'].map((name) =>
      readFile(new URL(name, import.meta.url), 'utf8'),
    ),
  )
  const source = parts.join('\n')
  const calls = []
  const document = createDocument()
  const window = new FakeEventTarget()
  const storage = createStorage()
  window.window = window
  window.document = document
  window.localStorage = storage
  window.location = { pathname: '/', href: 'https://shop.example.com/' }
  window.navigator = { doNotTrack: '0', sendBeacon: () => true }
  window.matchMedia = () => ({ matches: false })
  window.RUNLY_CONFIG = Object.assign(
    { apiUrl: 'https://erp.example.com', company: 'acme' },
    configOverrides || {},
  )

  let messageCounter = 0
  const fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/public/storefront/chat/availability')) {
      return response(200, { data: { available: true, agentsOnline: 2 } })
    }
    if (url.endsWith('/public/chat/session')) {
      return response(201, {
        data: {
          token: 'guest-tok-1',
          conversationId: 'conv-1',
          trackingCode: 'CHAT-000001',
          realtimeToken: 'rt-1',
        },
      })
    }
    if (/\/public\/chat\/session\/[^/]+\/messages$/.test(url) && options.method === 'POST') {
      messageCounter += 1
      return response(201, {
        data: {
          messageId: `m-server-${messageCounter}`,
          createdAt: '2026-01-01T00:00:00.000Z',
          realtimeToken: `rt-${messageCounter + 1}`,
        },
      })
    }
    if (/\/public\/chat\/session\/[^/]+\/messages\?/.test(url)) {
      return response(200, { data: [], operatorLastReadAt: null })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }
  window.fetch = fetch
  window.URLSearchParams = URLSearchParams
  window.setInterval = () => 1
  window.clearInterval = () => {}
  window.setTimeout = (callback) => {
    callback()
    return 1
  }
  window.clearTimeout = () => {}

  const context = vm.createContext({
    window,
    document,
    localStorage: storage,
    navigator: window.navigator,
    fetch,
    URLSearchParams,
    Promise,
    JSON,
    Date,
    Math,
    Error,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (callback) => {
      callback()
      return 1
    },
    clearTimeout: () => {},
  })
  vm.runInContext(source, context)
  await Promise.resolve()
  return { window, document, calls }
}

describe('runly-sdk.js public surface', () => {
  it('exposes window.RunlyERP with window.AtlasERP kept as a live alias', async () => {
    const harness = await loadSdk()
    assert.equal(harness.window.AtlasERP, harness.window.RunlyERP)
  })

  it('exposes consent-aware analytics without leaking tagged values', async () => {
    const harness = await loadSdk()
    const { analytics } = harness.window.RunlyERP
    assert.equal(typeof analytics.start, 'function')
    assert.equal(typeof analytics.track, 'function')

    analytics.setConsent('granted')
    await analytics.start()
    analytics.track('cta_click', {
      placement: 'hero',
      email: 'private@example.com',
    })
    await analytics.flush()

    const eventCall = harness.calls.find((call) =>
      call.url.includes('/events/batch'),
    )
    const payload = JSON.parse(eventCall.options.body)
    assert.equal(payload.consent, 'granted')
    assert.equal(JSON.stringify(payload).includes('private@example.com'), false)
  })

  it('renders and submits an accessible public form through v1', async () => {
    const harness = await loadSdk()
    const target = new FakeElement('div')
    harness.document.body.appendChild(target)
    const successes = []
    harness.window.RunlyERP.analytics.setConsent('granted')
    await harness.window.RunlyERP.analytics.start()

    const controller = await harness.window.RunlyERP.renderForm(target, {
      formId: 'form-1',
      onSuccess: (result) => successes.push(result),
      labels: { title: 'Hablemos' },
    })

    const form = target.querySelector('form')
    const label = target.querySelector('label')
    const input = target.querySelector('[name="email"]')
    assert.equal(form.dataset.runlyFormId, 'form-1')
    assert.equal(label.htmlFor, input.id)
    assert.ok(target.querySelector('._ae-form-wrap'))

    input.value = 'ana@example.com'
    input.dispatch('input', { target: input })
    form.dispatch('submit', { preventDefault() {} })
    await settle()
    await harness.window.RunlyERP.analytics.flush()

    const submissionCall = harness.calls.find((call) =>
      call.url.endsWith('/forms/form-1/submissions'),
    )
    assert.equal(
      JSON.parse(submissionCall.options.body).values.email,
      'ana@example.com',
    )
    assert.equal(successes.length, 1)
    assert.equal(typeof controller.destroy, 'function')

    const analyticsBodies = harness.calls
      .filter((call) => call.url.includes('/events/batch'))
      .map((call) => call.options.body)
      .join('')
    const eventNames = harness.calls
      .filter((call) => call.url.includes('/events/batch'))
      .flatMap((call) => JSON.parse(call.options.body).events)
      .map((event) => event.name)
    assert.ok(eventNames.includes('form_view'))
    assert.ok(eventNames.includes('form_start'))
    assert.ok(eventNames.includes('form_submit'))
    assert.equal(analyticsBodies.includes('ana@example.com'), false)
  })
})

describe('runly-sdk.js renderChat (embeddable guest chat widget)', () => {
  it('mounts the closed launcher tab and exposes open/close/destroy', async () => {
    const harness = await loadChatSdk()
    const widget = harness.window.RunlyERP.renderChat({ companyName: 'Acme Support' })
    await settle()

    assert.equal(typeof widget.open, 'function')
    assert.equal(typeof widget.close, 'function')
    assert.equal(typeof widget.destroy, 'function')
    assert.ok(harness.document.querySelector('._ae-chat-tab'), 'launcher tab should be mounted on document.body')

    widget.destroy()
    assert.equal(harness.document.querySelector('._ae-chat-tab'), null)
  })

  it('walks welcome -> identify -> chat and sends a message without losing the textarea across renders', async () => {
    const harness = await loadChatSdk()
    const widget = harness.window.RunlyERP.renderChat()
    await settle() // availability resolves

    widget.open()
    const optionBtn = harness.document.querySelector('._ae-chat-option')
    assert.ok(optionBtn, 'welcome screen should offer to talk to an agent / leave a message')
    optionBtn.dispatch('click', {})

    const emailInput = harness.document.querySelector('._ae-chat-email')
    assert.ok(emailInput, 'identify screen should render an email field')
    emailInput.value = 'visitante@example.com'
    emailInput.dispatch('input', { target: emailInput })

    const startBtn = harness.document.querySelector('._ae-chat-start')
    assert.ok(startBtn)
    startBtn.dispatch('click', {})
    await settle()

    const sessionCall = harness.calls.find((c) => c.url.endsWith('/public/chat/session'))
    assert.ok(sessionCall, 'starting the chat should POST /public/chat/session')
    assert.equal(JSON.parse(sessionCall.options.body).email, 'visitante@example.com')

    const textArea1 = harness.document.querySelector('._ae-chat-textarea')
    assert.ok(textArea1, 'chat screen should render once the session starts')

    textArea1.value = 'Hola, necesito ayuda'
    textArea1.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault() {} })
    await settle()

    const firstSend = harness.calls.find((c) =>
      c.url.endsWith('/public/chat/session/guest-tok-1/messages') && c.options.method === 'POST',
    )
    assert.ok(firstSend)
    assert.equal(JSON.parse(firstSend.options.body).body, 'Hola, necesito ayuda')

    // The footer (textarea/buttons) must be the SAME DOM node across this
    // render, not a freshly rebuilt one — a naive full-subtree rebuild on
    // every state change (which is what a first pass at this widget did)
    // would silently steal focus and reset the cursor position out from
    // under anyone composing a message when a new message arrives.
    const textArea2 = harness.document.querySelector('._ae-chat-textarea')
    assert.equal(textArea2, textArea1, 'the textarea identity must survive a post-send render')

    textArea2.value = 'Otro mensaje'
    textArea2.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault() {} })
    await settle()

    const secondSend = harness.calls.filter((c) =>
      c.url.endsWith('/public/chat/session/guest-tok-1/messages') && c.options.method === 'POST',
    )
    assert.equal(secondSend.length, 2)
    assert.equal(harness.document.querySelector('._ae-chat-textarea'), textArea1)

    widget.destroy()
  })
})
