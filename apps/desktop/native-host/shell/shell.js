const status = document.getElementById('status')
const retry = document.getElementById('retry')
const diagnostics = document.getElementById('diagnostics')
const connectForm = document.getElementById('connect-form')
const originInput = document.getElementById('origin-input')
const connectButton = document.getElementById('connect-button')
const confirmPanel = document.getElementById('confirm-panel')
const confirmOrigin = document.getElementById('confirm-origin')
const confirmButton = document.getElementById('confirm-button')
const cancelButton = document.getElementById('cancel-button')
const forgetLink = document.getElementById('forget-link')
const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args)

function showForm(message) {
  status.textContent = message || 'Conecta con tu servidor Runly.'
  connectForm.hidden = false
  confirmPanel.hidden = true
  retry.hidden = true
}

function showConfirm(origin) {
  confirmOrigin.textContent = origin
  connectForm.hidden = true
  confirmPanel.hidden = false
  retry.hidden = true
}

function showConnecting() {
  status.textContent = 'Conectando con Runly…'
  connectForm.hidden = true
  confirmPanel.hidden = true
  retry.hidden = true
}

function showFailed(message) {
  status.textContent = message
  connectForm.hidden = true
  confirmPanel.hidden = true
  retry.hidden = false
}

async function attemptConnect(origin) {
  showConnecting()
  try {
    const result = await invoke('host_connect', { origin: origin ?? null })
    if (result?.status === 'pending_confirmation') showConfirm(result.origin)
    // status "connected" navigates the webview away; nothing else to do here.
  } catch (error) {
    diagnostics.textContent += `\nError: ${String(error)}\nRed: ${navigator.onLine ? 'disponible' : 'sin conexión'}`
    if (error === 'NO_ORIGIN_CONFIGURED') { showForm(); return }
    if (origin) showForm('No se pudo conectar. Revisa la URL e intenta de nuevo.')
    else showFailed('No se pudo conectar con Runly.')
  }
}

connectButton.addEventListener('click', () => {
  const value = originInput.value.trim()
  if (value) attemptConnect(value)
})

confirmButton.addEventListener('click', async () => {
  confirmButton.disabled = true
  try {
    await invoke('host_confirm_origin')
  } catch (error) {
    confirmButton.disabled = false
    showForm('No se pudo confirmar la conexión.')
  }
})

cancelButton.addEventListener('click', () => showForm())

forgetLink.addEventListener('click', async (event) => {
  event.preventDefault()
  await invoke('host_forget_origin').catch(() => {})
  showForm()
})

retry.addEventListener('click', () => attemptConnect())

invoke('host_info').then((info) => {
  diagnostics.textContent = `Host: ${info.nativeHostVersion}\nPlataforma: ${info.platform}\nSistema: ${info.osVersion}\nFrontend: ${info.frontendUrl ?? '(sin configurar)'}\nRed: ${navigator.onLine ? 'disponible' : 'sin conexión'}`
  if (location.hash === '#failed') showFailed('No se pudo conectar con Runly.')
  else attemptConnect()
}).catch(() => { status.textContent = 'No se pudo iniciar Runly. Reinicia la aplicación.' })
