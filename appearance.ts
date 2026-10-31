import type { Cell, Game } from "./game"

export function cellAppearance(cell: Cell, index: number, game: Pick<Game, "phase" | "exploded">): {
  label: string
  tone: "hidden" | "flag" | "mine" | "empty" | number
} {
  if (game.phase === "lost" && cell.mine) {
    return { label: index === game.exploded ? " X " : " * ", tone: "mine" }
  }
  if (game.phase === "lost" && cell.flag && !cell.mine) {
    return { label: " ! ", tone: "flag" }
  }
  if (cell.flag) return { label: " F ", tone: "flag" }
  // Closed cells must reveal neither mine placement nor their adjacent count.
  if (!cell.open) return { label: " · ", tone: "hidden" }
  return { label: cell.adjacent ? ` ${cell.adjacent} ` : "   ", tone: cell.adjacent || "empty" }
}
