import type { usePlugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { ArcadeFrame } from "./frame"
import { newSnake, pauseSnake, speeds, stepSnake, toggleSnake, turnSnake, type Direction } from "./snake"

export function createSnake(context: ReturnType<typeof usePlugin>, exit: () => void, menu: () => void) {
  const [game, setGame] = createSignal(newSnake())
  const [speed, setSpeed] = createSignal(1)
  const [best, setBest] = createSignal(0)

  return function Snake() {
    const dimensions = useTerminalDimensions()
    const theme = createMemo(() => context.theme.surface("dialog"))
    // Native large dialog is 88 columns on OpenCode 2.2.4, constrained to terminal width - 2.
    const boardWidth = () => Math.max(6, Math.min(28, Math.floor((Math.min(88, dimensions().width - 2) - 6) / 2)))
    const boardHeight = () => Math.max(4, Math.min(12, dimensions().height - 14))
    const fits = createMemo(() => dimensions().width >= 20 && dimensions().height >= 18
      && game().width <= boardWidth() && game().height <= boardHeight())
    const running = createMemo(() => game().phase === "playing" && fits())
    const body = createMemo(() => new Set(game().snake.slice(1)))
    const restart = (nextSpeed = speed()) => {
      setSpeed(nextSpeed)
      setGame(newSnake(boardWidth(), boardHeight()))
    }
    const toggle = () => { if (fits()) setGame(toggleSnake) }
    const turn = (direction: Direction) => setGame((g) => turnSnake(g, direction))

    createEffect(() => {
      const width = boardWidth()
      const height = boardHeight()
      const g = game()
      if (g.phase === "ready" && (g.width !== width || g.height !== height)) setGame(newSnake(width, height))
      else if (!fits() && g.phase === "playing") setGame(pauseSnake)
    })

    createEffect(() => {
      const ms = speeds[speed()].ms
      if (!running()) return
      const timer = setInterval(() => setGame((g) => {
        const next = stepSnake(g)
        setBest((value) => Math.max(value, next.score))
        return next
      }), ms)
      onCleanup(() => clearInterval(timer))
    })
    // Leaving, closing or replacing the modal stops the timer and pauses this board.
    onCleanup(() => setGame(pauseSnake))

    const commands = [
      { id: "up", bind: "up,w,k", run: () => turn("up") },
      { id: "down", bind: "down,s,j", run: () => turn("down") },
      { id: "left", bind: "left,a,h", run: () => turn("left") },
      { id: "right", bind: "right,d,l", run: () => turn("right") },
      { id: "pause", bind: "return,space,p", run: toggle },
      { id: "reset", bind: "r", run: () => restart() },
      { id: "slow", bind: "1", run: () => restart(0) },
      { id: "normal", bind: "2", run: () => restart(1) },
      { id: "fast", bind: "3", run: () => restart(2) },
      { id: "menu", bind: "b,backspace", run: menu },
      { id: "exit", bind: "escape,q", run: exit },
    ].map((command) => ({ ...command, id: `moonvoid.arcade.snake.${command.id}` }))
    context.keymap.layer(() => ({ mode: "modal", priority: 100, commands, bindings: commands.map((c) => c.id) }))

    const status = () => !fits() ? "窗口已缩小，游戏已暂停。放大窗口继续，或 R 适配新棋盘。" : ({
      ready: "Enter 开始 · 边界可穿越，避开自己的身体",
      playing: "进行中",
      paused: "已暂停 · Enter / Space 继续",
      lost: "撞到了！R 再来一局",
      won: "填满棋盘，胜利！R 再来一局",
    })[game().phase]
    const headGlyph = () => ({ up: "↑ ", down: "↓ ", left: "← ", right: "→ " })[game().direction]

    return (
      <ArcadeFrame title="贪吃蛇" subtitle="Snake" height={game().height + 10} onClose={exit} onMenu={menu}
        status={<span style={{ fg: game().phase === "lost" ? theme().text.feedback.error.base : game().phase === "won" ? theme().text.feedback.success.base : theme().text.muted }}>{status()}</span>}
        footer={<>
          <text height={1} fg={theme().text.muted}>↑↓←→ / WASD / HJKL 转向  enter/space 暂停  r 重开</text>
          <text height={1} fg={theme().text.muted}>1/2/3 速度（新局）  b 游戏库  esc/q 关闭</text>
        </>}>
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between" marginTop={1}>
          <box flexDirection="row" gap={2}>
            <For each={speeds}>{(option, index) => (
              <text fg={index() === speed() ? theme().text.base : theme().text.muted}
                onMouseDown={() => restart(index())}>{index() + 1} {option.name}</text>
            )}</For>
          </box>
          <text fg={theme().text.muted}>得分 {game().score} · 最佳 {best()}</text>
        </box>
        <box flexGrow={1} minHeight={1} marginTop={1} alignItems="center" justifyContent="center">
          <Show when={fits()} fallback={<text fg={theme().text.muted}>放大窗口或按 R 调整棋盘</text>}>
            <box flexDirection="column" width={game().width * 2} height={game().height} flexShrink={0}>
              <For each={Array.from({ length: game().height }, (_, row) => row)}>{(row) => (
                <box flexDirection="row" height={1}>
                  <For each={Array.from({ length: game().width }, (_, column) => column)}>{(column) => {
                    const index = () => row * game().width + column
                    const head = () => index() === game().snake[0]
                    const occupied = () => head() || body().has(index())
                    return <text width={2} height={1}
                      fg={head() ? theme().background.base : theme().text.feedback.warning.base}
                      bg={occupied() ? theme().hue.accent[head() ? 100 : 300] : theme().background.raised.high}
                    >{head() ? headGlyph() : index() === game().food ? "● " : "  "}</text>
                  }}</For>
                </box>
              )}</For>
            </box>
          </Show>
        </box>
      </ArcadeFrame>
    )
  }
}
