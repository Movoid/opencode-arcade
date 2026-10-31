import { describe, expect, test } from "bun:test"
import { cellAppearance } from "./appearance"
import { levels, newGame, reveal } from "./game"

describe("No hidden-cell information leaks", () => {
  test("all closed dots have the same label and color regardless of mines or adjacent numbers", () => {
    for (const phase of ["ready", "playing"] as const) {
      for (const mine of [false, true]) {
        for (let adjacent = 0; adjacent <= 8; adjacent++) {
          expect(cellAppearance({ mine, adjacent, open: false, flag: false }, 0, { phase, exploded: null }))
            .toEqual({ label: " · ", tone: "hidden" })
        }
      }
    }
  })

  test("flags don't disclose whether a player's guess is correct", () => {
    for (const mine of [false, true]) {
      for (let adjacent = 0; adjacent <= 8; adjacent++) {
        expect(cellAppearance({ mine, adjacent, open: false, flag: true }, 0, { phase: "playing", exploded: null }))
          .toEqual({ label: " F ", tone: "flag" })
      }
    }
  })

  test("a planted board has identical dots on every unrevealed, unflagged cell", () => {
    for (const spec of levels) {
      let seed = 42
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
      }
      const g = reveal(newGame(spec.width, spec.height, spec.mines), 0, random, 1000)
      const hidden = g.cells.filter((cell) => !cell.open)
      expect(hidden.some((cell) => cell.mine)).toBe(true)
      expect(hidden.some((cell) => !cell.mine)).toBe(true)
      for (let index = 0; index < g.cells.length; index++) {
        if (!g.cells[index].open) {
          expect(cellAppearance(g.cells[index], index, g)).toEqual({ label: " · ", tone: "hidden" })
        }
      }
    }
  })

  test("only opened cells expose numbers and their theme color categories", () => {
    const g = { phase: "playing" as const, exploded: null }
    expect(cellAppearance({ mine: false, adjacent: 0, open: true, flag: false }, 0, g).label).toBe("   ")
    expect(cellAppearance({ mine: false, adjacent: 1, open: true, flag: false }, 0, g))
      .toEqual({ label: " 1 ", tone: 1 })
    expect(cellAppearance({ mine: false, adjacent: 2, open: true, flag: false }, 0, g))
      .toEqual({ label: " 2 ", tone: 2 })
    expect(cellAppearance({ mine: false, adjacent: 3, open: true, flag: false }, 0, g))
      .toEqual({ label: " 3 ", tone: 3 })
  })

  test("mine locations and incorrect flags are revealed only after losing", () => {
    const g = { phase: "lost" as const, exploded: 4 }
    const mine = { mine: true, adjacent: 1, open: false, flag: false }
    expect(cellAppearance(mine, 4, g)).toEqual({ label: " X ", tone: "mine" })
    expect(cellAppearance(mine, 5, g)).toEqual({ label: " * ", tone: "mine" })
    expect(cellAppearance({ mine: false, adjacent: 1, open: false, flag: true }, 0, g).label).toBe(" ! ")
  })
})
