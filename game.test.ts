import { describe, expect, test } from "bun:test"
import { chord, levels, neighbors, newGame, reveal, toggleFlag, type Game } from "./game"

function rng(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function fixture(): Game {
  const g = newGame(4, 4, 2)
  g.phase = "playing"
  g.startedAt = 1000
  g.cells[0].mine = true
  g.cells[3].mine = true
  for (let i = 0; i < g.cells.length; i++) {
    g.cells[i].adjacent = neighbors(g, i).filter((n) => g.cells[n].mine).length
  }
  return g
}

describe("Minesweeper rules", () => {
  test("fresh board is unplanted; flagging never starts the clock", () => {
    const g = newGame()
    const flagged = toggleFlag(g, 0)
    expect(g.cells[0].flag).toBe(false)
    expect(flagged.cells[0].flag).toBe(true)
    expect(flagged.phase).toBe("ready")
    expect(flagged.startedAt).toBeNull()
    expect(flagged.cells.some((c) => c.mine)).toBe(false)
    expect(reveal(flagged, 0)).toBe(flagged)
    expect(toggleFlag(flagged, 0).cells[0].flag).toBe(false)
  })

  test("neighbors don't wrap at board edges", () => {
    const g = newGame()
    expect(neighbors(g, 0)).toEqual([1, 9, 10])
    expect(neighbors(g, 8)).toEqual([7, 16, 17])
    expect(neighbors(g, 40)).toHaveLength(8)
    expect(neighbors(g, 80)).toEqual([70, 71, 79])
  })

  test("500 reproducible boards: first-click safe zone, exact mine count, correct numbers", () => {
    for (let seed = 0; seed < 500; seed++) {
      const spec = levels[seed % levels.length]
      const original = newGame(spec.width, spec.height, spec.mines)
      const first = (seed * 37) % original.cells.length
      const g = reveal(original, first, rng(seed), 1234)
      expect(g.cells.filter((c) => c.mine)).toHaveLength(spec.mines)
      expect(g.phase).not.toBe("lost")
      expect(g.startedAt).toBe(1234)
      expect(g.cells[first].open).toBe(true)
      for (const n of [first, ...neighbors(g, first)]) expect(g.cells[n].mine).toBe(false)
      for (let i = 0; i < g.cells.length; i++) {
        expect(g.cells[i].adjacent).toBe(neighbors(g, i).filter((n) => g.cells[n].mine).length)
      }
      expect(original.phase).toBe("ready")
      expect(original.cells.every((c) => !c.mine && !c.open)).toBe(true)
    }
  })

  test("flood fill doesn't open flags", () => {
    let g = fixture()
    g = toggleFlag(g, 15)
    g = reveal(g, 14, Math.random, 2000)
    expect(g.cells[15].flag).toBe(true)
    expect(g.cells[15].open).toBe(false)
    expect(g.phase).toBe("playing")
    expect(g.cells[14].open).toBe(true)
  })

  test("mine hit loses, freezes clock and blocks further actions", () => {
    const g = reveal(fixture(), 0, Math.random, 2500)
    expect(g.phase).toBe("lost")
    expect(g.exploded).toBe(0)
    expect(g.endedAt).toBe(2500)
    expect(reveal(g, 15)).toBe(g)
    expect(toggleFlag(g, 15)).toBe(g)
    expect(chord(g, 1)).toBe(g)
  })

  test("opening all safe cells wins and marks mines", () => {
    let g = fixture()
    for (let i = 0; i < g.cells.length; i++) if (!g.cells[i].mine) g = reveal(g, i, Math.random, 3000)
    expect(g.phase).toBe("won")
    expect(g.endedAt).toBe(3000)
    expect(g.cells.filter((c) => c.mine).every((c) => c.flag)).toBe(true)
    expect(reveal(g, 0)).toBe(g)
    expect(toggleFlag(g, 0)).toBe(g)
  })

  test("chord requires adjacent flag count to match the number", () => {
    const g = reveal(fixture(), 1)
    expect(chord(g, 1)).toBe(g)
    const next = chord(toggleFlag(g, 0), 1, 4000)
    expect(next.cells[2].open).toBe(true)
    expect(next.cells[4].open).toBe(true)
    expect(next.phase).not.toBe("lost")
    expect(g.cells[2].open).toBe(false)
  })

  test("wrong flags with matching count can cause a chord explosion", () => {
    const g = toggleFlag(reveal(fixture(), 1), 2)
    const next = chord(g, 1, 5000)
    expect(next.phase).toBe("lost")
    expect(next.exploded).toBe(0)
    expect(next.endedAt).toBe(5000)
  })

  test("revealing an already-open number chords", () => {
    const g = toggleFlag(reveal(fixture(), 1), 0)
    expect(reveal(g, 1, Math.random, 6000)).toEqual(chord(g, 1, 6000))
  })

  test("invalid indices and invalid board sizes", () => {
    const g = newGame()
    expect(reveal(g, -1)).toBe(g)
    expect(reveal(g, 81)).toBe(g)
    expect(toggleFlag(g, 81)).toBe(g)
    expect(chord(g, -1)).toBe(g)
    expect(() => newGame(1, 9, 1)).toThrow()
    expect(() => newGame(9, 9, 73)).toThrow()
    expect(() => newGame(9.5, 9, 10)).toThrow()
  })
})
