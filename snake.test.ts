import { describe, expect, test } from "bun:test"
import { newSnake, pauseSnake, stepSnake, toggleSnake, turnSnake, type SnakeGame } from "./snake"

function fixture(overrides: Partial<SnakeGame> = {}): SnakeGame {
  return { ...newSnake(6, 4, () => 0), phase: "playing", snake: [8, 7, 6], food: 23, ...overrides }
}

describe("Snake rules", () => {
  test("new board is ready, food is off the snake, and invalid sizes are rejected", () => {
    const game = newSnake()
    expect(game.phase).toBe("ready")
    expect(game.snake).toHaveLength(3)
    expect(game.snake.includes(game.food!)).toBe(false)
    expect(() => newSnake(5, 4)).toThrow()
    expect(() => newSnake(6, 3)).toThrow()
    expect(() => newSnake(6.5, 4)).toThrow()
  })

  test("start, pause, resume and stopped phases never advance accidentally", () => {
    let game = newSnake()
    expect(stepSnake(game)).toBe(game)
    game = toggleSnake(game)
    expect(game.phase).toBe("playing")
    const paused = pauseSnake(game)
    expect(paused.phase).toBe("paused")
    expect(stepSnake(paused)).toBe(paused)
    expect(pauseSnake(paused)).toBe(paused)
    expect(toggleSnake(paused).phase).toBe("playing")
    expect(toggleSnake(game).phase).toBe("paused")
    for (const phase of ["lost", "won"] as const) {
      const stopped = { ...game, phase }
      expect(stepSnake(stopped)).toBe(stopped)
      expect(toggleSnake(stopped)).toBe(stopped)
      expect(turnSnake(stopped, "up")).toBe(stopped)
    }
  })

  test("movement is immutable and preserves length without food", () => {
    const game = fixture()
    const next = stepSnake(game)
    expect(next.snake).toEqual([9, 8, 7])
    expect(next.score).toBe(0)
    expect(next.food).toBe(23)
    expect(game.snake).toEqual([8, 7, 6])
  })

  test("eating grows exactly once and respawns food in an empty cell", () => {
    const game = fixture({ food: 9 })
    for (let seed = 0; seed < 100; seed++) {
      const next = stepSnake(game, () => seed / 100)
      expect(next.snake).toEqual([9, 8, 7, 6])
      expect(next.score).toBe(1)
      expect(next.snake.includes(next.food!)).toBe(false)
      expect(next.food!).toBeGreaterThanOrEqual(0)
      expect(next.food!).toBeLessThan(24)
    }
  })

  test("opposite turns are rejected and quick inputs execute at most one turn per tick", () => {
    const game = fixture()
    expect(turnSnake(game, "left")).toBe(game)
    expect(turnSnake(game, "right")).toBe(game)
    const queued = turnSnake(turnSnake(game, "up"), "left")
    expect(queued.turns).toEqual(["up", "left"])
    expect(turnSnake(queued, "down")).toBe(queued)
    expect(turnSnake(turnSnake(game, "up"), "down").turns).toEqual(["up"])
    const next = stepSnake(queued)
    expect(next.snake[0]).toBe(2)
    expect(next.direction).toBe("up")
    expect(next.turns).toEqual(["left"])
    expect(stepSnake(next).snake[0]).toBe(1)
  })

  test("all four edges wrap to the opposite side without losing or changing the other coordinate", () => {
    for (const [snake, direction, head] of [
      [[11, 10, 9], "right", 6],
      [[6, 7, 8], "left", 11],
      [[2, 8, 14], "up", 20],
      [[20, 14, 8], "down", 2],
    ] as const) {
      const game = fixture({ snake: [...snake], direction })
      const next = stepSnake(game)
      expect(next.phase).toBe("playing")
      expect(next.snake).toEqual([head, ...snake.slice(0, -1)])
      expect(next.direction).toBe(direction)
      expect(next.score).toBe(0)
      expect(next.food).toBe(game.food)
      expect(game.snake).toEqual([...snake])
    }
  })

  test("wrapping onto food grows and scores normally", () => {
    const game = fixture({ snake: [11, 10, 9], food: 6 })
    const next = stepSnake(game, () => 0)
    expect(next.snake).toEqual([6, 11, 10, 9])
    expect(next.score).toBe(1)
    expect(next.phase).toBe("playing")
    expect(next.food).not.toBeNull()
    expect(next.snake.includes(next.food!)).toBe(false)
    expect(game.snake).toEqual([11, 10, 9])
  })

  test("wrapping into the body loses but wrapping into the vacating tail is legal", () => {
    const game = fixture({ snake: [11, 10, 4, 3, 2, 1, 0, 6, 7] })
    expect(stepSnake(game).phase).toBe("lost")
    const tailMove = fixture({ snake: [11, 10, 4, 3, 2, 1, 0, 6] })
    const next = stepSnake(tailMove)
    expect(next.phase).toBe("playing")
    expect(next.snake).toEqual([6, 11, 10, 4, 3, 2, 1, 0])
    expect(new Set(next.snake).size).toBe(next.snake.length)
  })

  test("repeated horizontal and vertical laps stay on the board", () => {
    for (const [width, height] of [[6, 4], [7, 5], [28, 12]]) {
      for (const direction of ["right", "left", "up", "down"] as const) {
        const horizontal = direction === "right" || direction === "left"
        const stride = horizontal ? 1 : width
        const snake = direction === "right" || direction === "down"
          ? [2 * stride, stride, 0] : [0, stride, 2 * stride]
        let game = fixture({ width, height, snake, direction, food: width * height - 1 })
        const lap = horizontal ? width : height
        for (let tick = 1; tick <= lap * 20; tick++) {
          game = stepSnake(game)
          expect(game.phase).toBe("playing")
          expect(game.snake).toHaveLength(3)
          expect(new Set(game.snake).size).toBe(3)
          expect(game.snake.every((cell) => cell >= 0 && cell < width * height)).toBe(true)
          if (tick % lap === 0) expect(game.snake).toEqual(snake)
        }
      }
    }
  })

  test("body collision loses but moving into the vacating tail is legal", () => {
    const game = fixture({ snake: [8, 7, 13, 14, 15, 9], direction: "down" })
    expect(stepSnake(game).phase).toBe("lost")
    const tailMove = fixture({ snake: [8, 7, 13, 14], direction: "down" })
    expect(stepSnake(tailMove).snake).toEqual([14, 8, 7, 13])
    expect(stepSnake(tailMove).phase).toBe("playing")
  })

  test("filling the board wins without spawning food or moving again", () => {
    const game = fixture({ snake: Array.from({ length: 23 }, (_, i) => i), direction: "right", food: 23 })
    // Head at 22, food at 23; all other cells already occupied.
    game.snake = [22, ...Array.from({ length: 22 }, (_, i) => i)]
    const won = stepSnake(game)
    expect(won.phase).toBe("won")
    expect(won.snake).toHaveLength(24)
    expect(new Set(won.snake).size).toBe(24)
    expect(won.food).toBeNull()
    expect(stepSnake(won)).toBe(won)
  })

  test("seeded play preserves occupancy, score and immutable snapshots", () => {
    const directions = ["up", "down", "left", "right"] as const
    for (let seed = 1; seed <= 100; seed++) {
      let state = seed
      const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
      }
      let game = toggleSnake(newSnake(12, 8, random))
      for (let tick = 0; tick < 200; tick++) {
        game = turnSnake(game, directions[Math.floor(random() * 4)])
        const previous = JSON.stringify(game)
        const next = stepSnake(game, random)
        expect(JSON.stringify(game)).toBe(previous)
        expect(new Set(next.snake).size).toBe(next.snake.length)
        expect(next.snake.length).toBe(next.score + 3)
        expect(next.snake.every((cell) => cell >= 0 && cell < next.width * next.height)).toBe(true)
        expect(next.food === null || !next.snake.includes(next.food)).toBe(true)
        if (next.phase === "lost") break
        game = next
      }
    }
  })
})
