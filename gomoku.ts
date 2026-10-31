export const BOARD_SIZE = 15
export type Stone = 0 | 1 | 2
export type Gomoku = { cells: Stone[]; moves: number[]; turn: 1 | 2; winner: Stone; draw: boolean; line: number[] }

export function newGomoku(): Gomoku {
  return { cells: Array<Stone>(225).fill(0), moves: [], turn: 1, winner: 0, draw: false, line: [] }
}

export function playGomoku(game: Gomoku, index: number): Gomoku {
  if (!Number.isInteger(index) || index < 0 || index >= 225 || game.cells[index] || game.winner || game.draw) return game
  const cells = [...game.cells]
  cells[index] = game.turn
  const x = index % 15, y = Math.floor(index / 15)
  let line: number[] = []
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const run = [index]
    for (const sign of [-1, 1]) {
      for (let step = 1; step < 15; step++) {
        const nx = x + dx * step * sign, ny = y + dy * step * sign
        if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15 || cells[ny * 15 + nx] !== game.turn) break
        run.push(ny * 15 + nx)
      }
    }
    if (run.length >= 5) { line = run; break }
  }
  const moves = [...game.moves, index]
  return { cells, moves, turn: game.turn === 1 ? 2 : 1, winner: line.length ? game.turn : 0, draw: !line.length && moves.length === 225, line }
}

export function replayGomoku(moves: readonly number[]): Gomoku {
  if (!Array.isArray(moves) || moves.length > 225) throw new Error("Invalid move list")
  let game = newGomoku()
  for (const index of moves) {
    const next = playGomoku(game, index)
    if (next === game) throw new Error("Invalid move history")
    game = next
  }
  return game
}

export function gomokuPrompt(game: Gomoku): string {
  const rows = Array.from({ length: 15 }, (_, y) =>
    `${String(y + 1).padStart(2)} ${game.cells.slice(y * 15, y * 15 + 15).map((c) => c === 1 ? "X" : c === 2 ? "O" : ".").join(" ")}`)
  return `Play one Gomoku move. You are ${game.turn === 1 ? "black (X)" : "white (O)"}. Columns x and rows y are 1..15, top-left is (1,1). Five or more in a row wins; no forbidden moves. Dots are empty. Call gomoku_move exactly once with an EMPTY position. An optional brief Chinese comment is welcome. No other task.\nColumns: ${Array.from({ length: 15 }, (_, i) => i + 1).join(" ")}\n${rows.join("\n")}\nMoves (x,y): ${game.moves.map((i) => `(${i % 15 + 1},${Math.floor(i / 15) + 1})`).join(" ") || "none"}`
}
