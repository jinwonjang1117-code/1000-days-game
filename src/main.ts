import './style.css'
import Phaser from 'phaser'
import gameConfig from './config/gameConfig'
import { initRouter } from './router'

const game = new Phaser.Game(gameConfig)
initRouter(game)
