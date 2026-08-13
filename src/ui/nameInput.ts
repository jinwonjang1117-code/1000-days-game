import { getPlayerName, setPlayerName, clearPlayerName } from '../config/playerProfile'

const NAME_MAX_LENGTH = 12

export interface NameInputHandle {
  destroy(): void
}

/**
 * A small persistent "이름" field pinned to the hub's corner (not a modal
 * like domOverlay.ts). Starts in edit mode if no name is saved yet; once
 * saved it collapses to plain text (click it to edit again).
 */
export function createNameInput(): NameInputHandle {
  const appEl = document.getElementById('app')
  if (!appEl) {
    throw new Error('#app element not found')
  }

  const wrapper = document.createElement('div')
  wrapper.className = 'name-input-wrapper'
  appEl.append(wrapper)

  const renderDisplay = (name: string) => {
    wrapper.replaceChildren()

    const label = document.createElement('label')
    label.textContent = '이름:'
    label.className = 'name-input-label'

    const nameText = document.createElement('span')
    nameText.textContent = name
    nameText.className = 'name-input-display'
    nameText.title = '클릭해서 수정'
    nameText.addEventListener('click', renderEdit)

    const logoutButton = document.createElement('button')
    logoutButton.type = 'button'
    logoutButton.textContent = '로그아웃'
    logoutButton.className = 'name-input-logout'
    logoutButton.addEventListener('click', () => {
      clearPlayerName()
      renderEdit()
    })

    wrapper.append(label, nameText, logoutButton)
  }

  const renderEdit = () => {
    wrapper.replaceChildren()

    const label = document.createElement('label')
    label.textContent = '이름:'
    label.className = 'name-input-label'

    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = NAME_MAX_LENGTH
    input.value = getPlayerName()
    input.placeholder = '이름을 입력하세요'
    input.className = 'name-input-field'

    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.textContent = '저장'
    saveButton.className = 'name-input-save'

    const save = () => {
      const name = input.value.trim()
      setPlayerName(name)
      if (name.length > 0) {
        renderDisplay(name)
      }
    }

    saveButton.addEventListener('click', save)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        save()
      }
    })

    wrapper.append(label, input, saveButton)
    input.focus()
  }

  const savedName = getPlayerName().trim()
  if (savedName.length > 0) {
    renderDisplay(savedName)
  } else {
    renderEdit()
  }

  return {
    destroy() {
      wrapper.remove()
    },
  }
}
