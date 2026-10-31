export type Cell = { mine: boolean; adjacent: number; open: boolean; flag: boolean }
export type Game = {
  width: number
  height: number
  mines: number
  cells: Cell[]
  phase: "ready" | "playing" | "won" | "lost"
  startedAt: number | null
  endedAt: number | null
  exploded: number | null
}

export const levels = [
  { name: "EASY", width: 9, height: 9, mines: 10 },
  { name: "NORMAL", width: 16, height: 12, mines: 30 },
  { name: "HARD", width: 24, height: 16, mines: 75 },
] as const

export function neighbors(game: Game, index: number): number[] {
  const x = index % game.width
  const y = Math.floor(index / game.width)
  const result: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < game.width && ny < game.height) {
        result.push(ny * game.width + nx)
      }
    }
  }
  return result
}

export function newGame(width = 9, height = 9, mines = 10): Game {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
    !Number.isInteger(mines) || mines < 1 || mines > width * height - Math.min(width, 3) * Math.min(height, 3)) {
    throw new Error("Board must leave room for a mine-free first-click neighborhood")
  }
  return {
    width, height, mines,
    cells: Array.from({ length: width * height }, () => ({ mine: false, adjacent: 0, open: false, flag: false })),
    phase: "ready", startedAt: null, endedAt: null, exploded: null,
  }
}

function clone(game: Game): Game {
  return { ...game, cells: game.cells.map((cell) => ({ ...cell })) }
}

function plant(game: Game, first: number, random: () => number, now: number) {
  const safe = new Set([first, ...neighbors(game, first)])
  const candidates = game.cells.map((_, index) => index).filter((index) => !safe.has(index))
  // Partial Fisher-Yates: sample distinct cells without replacement.
  for (let i = 0; i < game.mines; i++) {
    const j = i + Math.floor(random() * (candidates.length - i))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
    game.cells[candidates[i]].mine = true
  }
  for (let i = 0; i < game.cells.length; i++) {
    game.cells[i].adjacent = neighbors(game, i).filter((n) => game.cells[n].mine).length
  }
  game.phase = "playing"
  game.startedAt = now
}

function flood(game: Game, start: number, now: number) {
  const pending = [start]
  while (pending.length) {
    const index = pending.pop()!
    const cell = game.cells[index]
    if (cell.open || cell.flag) continue
    cell.open = true
    if (cell.mine) {
      game.exploded = index
      game.phase = "lost"
      game.endedAt = now
      return
    }
    if (cell.adjacent === 0) pending.push(...neighbors(game, index))
  }
}

function finish(game: Game, now: number) {
  if (game.phase === "playing" && game.cells.every((cell) => cell.mine || cell.open)) {
    game.phase = "won"
    game.endedAt = now
    for (const cell of game.cells) if (cell.mine) cell.flag = true
  }
}

export function reveal(game: Game, index: number, random = Math.random, now = Date.now()): Game {
  if (!game.cells[index] || game.phase === "lost" || game.phase === "won" || game.cells[index].flag) return game
  if (game.cells[index].open) return chord(game, index, now)
  const next = clone(game)
  if (next.phase === "ready") plant(next, index, random, now)
  flood(next, index, now)
  finish(next, now)
  return next
}

export function toggleFlag(game: Game, index: number): Game {
  if (!game.cells[index] || game.cells[index].open || game.phase === "lost" || game.phase === "won") return game
  const next = clone(game)
  next.cells[index].flag = !next.cells[index].flag
  return next
}

export function chord(game: Game, index: number, now = Date.now()): Game {
  const cell = game.cells[index]
  if (game.phase !== "playing" || !cell?.open || cell.adjacent === 0) return game
  const nearby = neighbors(game, index)
  if (nearby.filter((n) => game.cells[n].flag).length !== cell.adjacent) return game
  const next = clone(game)
  for (const n of nearby) {
    flood(next, n, now)
    if (next.phase === "lost") break
  }
  finish(next, now)
  return next
}
