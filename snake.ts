export type Direction = "up" | "down" | "left" | "right"
export type SnakeGame = {
  width: number
  height: number
  snake: number[]
  direction: Direction
  turns: Direction[]
  food: number | null
  score: number
  phase: "ready" | "playing" | "paused" | "lost" | "won"
}

export const speeds = [
  { name: "悠闲", ms: 240 },
  { name: "普通", ms: 160 },
  { name: "快速", ms: 100 },
] as const

const opposite: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" }

function placeFood(width: number, height: number, snake: number[], random: () => number): number | null {
  const occupied = new Set(snake)
  const free = Array.from({ length: width * height }, (_, index) => index).filter((index) => !occupied.has(index))
  return free.length ? free[Math.floor(random() * free.length)] : null
}

export function newSnake(width = 28, height = 12, random = Math.random): SnakeGame {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 6 || height < 4) {
    throw new Error("Snake board must be at least 6×4")
  }
  const head = Math.floor(height / 2) * width + Math.floor(width / 2)
  const snake = [head, head - 1, head - 2]
  return { width, height, snake, direction: "right", turns: [], food: placeFood(width, height, snake, random), score: 0, phase: "ready" }
}

export function turnSnake(game: SnakeGame, direction: Direction): SnakeGame {
  if (game.phase === "lost" || game.phase === "won" || game.turns.length >= 2) return game
  const last = game.turns.at(-1) ?? game.direction
  if (direction === last || direction === opposite[last]) return game
  return { ...game, turns: [...game.turns, direction] }
}

export function toggleSnake(game: SnakeGame): SnakeGame {
  if (game.phase === "ready" || game.phase === "paused") return { ...game, phase: "playing" }
  if (game.phase === "playing") return pauseSnake(game)
  return game
}

export function pauseSnake(game: SnakeGame): SnakeGame {
  return game.phase === "playing" ? { ...game, phase: "paused" } : game
}

export function stepSnake(game: SnakeGame, random = Math.random): SnakeGame {
  if (game.phase !== "playing") return game
  const direction = game.turns[0] ?? game.direction
  const turns = game.turns.slice(1)
  // Opposite edges connect; resolve wrapping before checking food and body collisions.
  const x = (game.snake[0] % game.width + (direction === "left" ? -1 : direction === "right" ? 1 : 0) + game.width) % game.width
  const y = (Math.floor(game.snake[0] / game.width) + (direction === "up" ? -1 : direction === "down" ? 1 : 0) + game.height) % game.height
  const head = y * game.width + x
  const ate = head === game.food
  // The tail vacates its cell on a non-growing move, so entering that cell is legal.
  const occupied = ate ? game.snake : game.snake.slice(0, -1)
  if (occupied.includes(head)) return { ...game, direction, turns, phase: "lost" }
  const snake = [head, ...game.snake]
  if (!ate) snake.pop()
  const food = ate ? placeFood(game.width, game.height, snake, random) : game.food
  return { ...game, snake, direction, turns, food, score: game.score + Number(ate), phase: food === null ? "won" : "playing" }
}
