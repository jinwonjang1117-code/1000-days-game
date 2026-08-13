import { TextureKeys } from './textureKeys'

export interface CharacterSpriteSet {
  normalTexture: string
  inhalingTexture: string
  fullTexture: string
  projectileTexture: string
}

export interface CharacterDefinition extends CharacterSpriteSet {
  id: string
  name: string
  subtitle: string
}

export const CHARACTERS: CharacterDefinition[] = [
  {
    id: 'jihee princess',
    name: '지히 공주',
    subtitle: '무기: 없음\n공격: 황금색 미니언 똥',
    normalTexture: TextureKeys.Player,
    inhalingTexture: TextureKeys.PlayerInhaling,
    fullTexture: TextureKeys.PlayerFull,
    projectileTexture: TextureKeys.Projectile,
  },
  {
    id: 'jihee wizard',
    name: '지히 마법사',
    subtitle: '무기: 지팡이\n공격: 마법 별',
    normalTexture: TextureKeys.Player2,
    inhalingTexture: TextureKeys.Player2Inhaling,
    fullTexture: TextureKeys.Player2Full,
    projectileTexture: TextureKeys.Projectile2,
  },
]

let selectedCharacterId: string = CHARACTERS[0].id

export function getSelectedCharacterId(): string {
  return selectedCharacterId
}

export function setSelectedCharacterId(id: string) {
  selectedCharacterId = id
}

export function getSelectedCharacter(): CharacterDefinition {
  return CHARACTERS.find((character) => character.id === selectedCharacterId) ?? CHARACTERS[0]
}
