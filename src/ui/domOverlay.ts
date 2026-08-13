// Phaser has no native editable text field, so anything that needs real text
// entry (e.g. typing a room code) has to be a DOM element layered over the
// canvas. This overlay always covers the same box the canvas fills (#app),
// so it never needs to know a fixed pixel size or align to canvas coordinates.

export interface TextInputOverlayOptions {
  placeholder: string
  submitLabel: string
  cancelLabel: string
  maxLength?: number
  onSubmit: (value: string) => void
  onCancel: () => void
}

export interface OverlayHandle {
  destroy(): void
}

export function showTextInputOverlay(options: TextInputOverlayOptions): OverlayHandle {
  const appEl = document.getElementById('app')
  if (!appEl) {
    throw new Error('#app element not found')
  }

  const backdrop = document.createElement('div')
  backdrop.className = 'dom-overlay'

  const panel = document.createElement('div')
  panel.className = 'dom-overlay-panel'

  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = options.placeholder
  input.className = 'dom-overlay-input'
  if (options.maxLength) {
    input.maxLength = options.maxLength
  }

  const buttonRow = document.createElement('div')
  buttonRow.className = 'dom-overlay-buttons'

  const submitButton = document.createElement('button')
  submitButton.type = 'button'
  submitButton.textContent = options.submitLabel
  submitButton.className = 'dom-overlay-button dom-overlay-button-primary'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.textContent = options.cancelLabel
  cancelButton.className = 'dom-overlay-button'

  const submit = () => {
    const value = input.value.trim()
    if (value.length > 0) {
      options.onSubmit(value)
    }
  }

  submitButton.addEventListener('click', submit)
  cancelButton.addEventListener('click', () => options.onCancel())
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submit()
    }
  })

  buttonRow.append(submitButton, cancelButton)
  panel.append(input, buttonRow)
  backdrop.append(panel)
  appEl.append(backdrop)
  input.focus()

  return {
    destroy() {
      backdrop.remove()
    },
  }
}
