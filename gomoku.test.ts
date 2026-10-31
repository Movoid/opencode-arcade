import { expect, test } from "bun:test"
import { gomokuPrompt, newGomoku, playGomoku, replayGomoku } from "./gomoku"

test("Gomoku alternates immutable moves and rejects occupied/out-of-bounds cells", () => {
  const empty = newGomoku(), first = playGomoku(empty, 112)
  expect(empty.cells.every((s) => s === 0)).toBe(true)
  expect(first.cells[112]).toBe(1)
  expect(first.turn).toBe(2)
  for (const i of [-1, 225, 1.5, NaN, 112]) expect(playGomoku(first, i)).toBe(first)
  expect(replayGomoku([112])).toEqual(first)
  expect(() => replayGomoku([112, 112])).toThrow("Invalid move history")
})

test("five in all four directions wins and prevents later moves", () => {
  for (const step of [1, 15, 16, 14]) {
    let game = newGomoku()
    const start = step === 14 ? 14 : 0
    for (let n = 0; n < 5; n++) {
      game = playGomoku(game, start + n * step)
      if (n < 4) game = playGomoku(game, 210 + n * 2)
    }
    expect(game.winner).toBe(1)
    expect(new Set(game.line)).toEqual(new Set(Array.from({ length: 5 }, (_, n) => start + n * step)))
    expect(playGomoku(game, 100)).toBe(game)
    expect(() => replayGomoku([...game.moves, 100])).toThrow()
  }
})

test("six stones joined at once wins; rows do not wrap", () => {
  const game = newGomoku()
  for (const i of [0, 1, 2, 4, 5]) game.cells[i] = 1
  expect(playGomoku(game, 3).line.length).toBe(6)
  const edge = newGomoku()
  for (const i of [12, 13, 14, 15]) edge.cells[i] = 1
  expect(playGomoku(edge, 16).winner).toBe(0)
})

test("full nonwinning board draws and prompt accurately encodes position", () => {
  const game = newGomoku()
  game.moves = Array.from({ length: 224 }, (_, i) => i)
  // Independent checkerboard of pairs avoids five along all four axes.
  game.cells = Array.from({ length: 225 }, (_, i) => (Math.floor(i / 15) + Math.floor(i % 15 / 2)) % 2 ? 2 : 1)
  game.cells[224] = 0
  game.turn = 2
  const result = playGomoku(game, 224)
  expect(result.draw).toBe(true)
  expect(result.winner).toBe(0)
  const text = gomokuPrompt(replayGomoku([0, 224]))
  expect(text).toContain("black (X)")
  expect(text).toContain("(1,1) (15,15)")
  expect(text).toContain(" 1 X . .")
})
