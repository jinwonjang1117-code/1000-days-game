import Peer, { PeerErrorType } from 'peerjs'
import type { DataConnection } from 'peerjs'
import { TEAM_GAME_NAMESPACE } from '../gameId'

// Namespaced so this can never collide with an unrelated app's peer on
// PeerJS's shared public cloud broker. Dashes only — PeerJS validates ids
// against /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/, so dots aren't allowed.
const ID_PREFIX = `${TEAM_GAME_NAMESPACE}-`
const CODE_LENGTH = 4
const CODE_RETRY_LIMIT = 5
const JOIN_TIMEOUT_MS = 8000
const NAME_EXCHANGE_TIMEOUT_MS = 5000

let peer: Peer | null = null
let connection: DataConnection | null = null
let role: 'host' | 'joiner' | null = null

function generateCode(): string {
  return String(Math.floor(Math.random() * 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

function teardownPeer() {
  connection?.close()
  connection = null
  peer?.destroy()
  peer = null
  role = null
}

/** Tears down any active peer/connection, e.g. when leaving the lobby. */
export function disconnectPeer() {
  teardownPeer()
}

/** The live connection, if any — read by any scene that needs to send/receive once connected. */
export function getConnection(): DataConnection | null {
  return connection
}

/** Whether we're simulating the game (host) or only sending input (joiner). */
export function getRole(): 'host' | 'joiner' | null {
  return role
}

/**
 * Creates a Peer under a fresh random code, retrying on the (rare, ~1/10000)
 * chance the code is already taken. Calls onCodeReady as soon as the code is
 * confirmed live (so the UI can display it before anyone has joined), and
 * the returned promise resolves once a guest actually connects.
 */
export function hostGame(onCodeReady: (code: string) => void): Promise<DataConnection> {
  teardownPeer()

  return new Promise((resolve, reject) => {
    let attemptsLeft = CODE_RETRY_LIMIT

    const attempt = () => {
      const code = generateCode()
      const candidate = new Peer(ID_PREFIX + code)

      candidate.on('open', () => {
        peer = candidate
        onCodeReady(code)
        candidate.once('connection', (incoming) => {
          incoming.once('open', () => {
            connection = incoming
            role = 'host'
            // If the guest ever disconnects, the room closes for good rather
            // than leaving a stale peer registered under the code with
            // nothing listening for a new connection.
            incoming.once('close', () => {
              if (connection === incoming) {
                teardownPeer()
              }
            })
            resolve(incoming)
          })
        })
      })

      candidate.on('error', (err) => {
        if (err.type === PeerErrorType.UnavailableID) {
          candidate.destroy()
          attemptsLeft -= 1
          if (attemptsLeft > 0) {
            attempt()
          } else {
            reject(new Error('room code generation failed after retries'))
          }
          return
        }
        candidate.destroy()
        if (peer === candidate) {
          peer = null
        }
        reject(err)
      })
    }

    attempt()
  })
}

/** Connects to a hosted game by its 4-digit code. */
export function joinGame(code: string): Promise<DataConnection> {
  teardownPeer()

  return new Promise((resolve, reject) => {
    const candidate = new Peer()
    peer = candidate

    const timeout = setTimeout(() => {
      teardownPeer()
      reject(new Error('connection timed out'))
    }, JOIN_TIMEOUT_MS)

    candidate.on('open', () => {
      const outgoing = candidate.connect(ID_PREFIX + code, { reliable: true })

      outgoing.once('open', () => {
        clearTimeout(timeout)
        connection = outgoing
        role = 'joiner'
        outgoing.once('close', () => {
          if (connection === outgoing) {
            teardownPeer()
          }
        })
        resolve(outgoing)
      })
    })

    candidate.on('error', (err) => {
      clearTimeout(timeout)
      teardownPeer()
      if (err.type === PeerErrorType.PeerUnavailable) {
        reject(new Error('room not found'))
        return
      }
      reject(err)
    })
  })
}

interface NameMessage {
  type: 'name'
  name: string
}

function isNameMessage(data: unknown): data is NameMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'name' &&
    typeof (data as { name?: unknown }).name === 'string'
  )
}

/**
 * Sends our name over the connection and resolves with the peer's name once
 * theirs arrives. Falls back to an empty string if nothing arrives in time
 * (e.g. the other side is running older code) — callers should fall back to
 * the raw peer id in that case.
 */
export function exchangeNames(target: DataConnection, myName: string): Promise<string> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      target.off('data', onData)
      resolve('')
    }, NAME_EXCHANGE_TIMEOUT_MS)

    const onData = (data: unknown) => {
      if (isNameMessage(data)) {
        clearTimeout(timeout)
        target.off('data', onData)
        resolve(data.name)
      }
    }

    target.on('data', onData)
    target.send({ type: 'name', name: myName } satisfies NameMessage)
  })
}
