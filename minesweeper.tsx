import type { usePlugin } from "@opencode/plugin/tui"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js"
import { chord, levels, newGame, reveal, toggleFlag } from "./game"
import { cellAppearance } from "./appearance"
import { ArcadeFrame } from "./frame"

export function createMinesweeper(context: ReturnType<typeof usePlugin>, exit: () => void, menu: () => void) {
    const [game, setGame] = createSignal(newGame())
    const [cursor, setCursor] = createSignal(0)
    const [level, setLevel] = createSignal(0)
    const difficultyNames = ["简单", "普通", "困难"]

    function reset(nextLevel = level()) {
      const spec = levels[nextLevel]
      setLevel(nextLevel)
      setGame(newGame(spec.width, spec.height, spec.mines))
      setCursor(0)
    }

    function Board() {
      const dimensions = useTerminalDimensions()
      // Use the host's dialog surface, just like Blindfold's native prompt.
      // Read tokens inside reactive computations so theme changes apply live.
      const theme = createMemo(() => context.theme.surface("dialog"))
      let scroll: ScrollBoxRenderable | undefined
      const cellWidth = () => Math.max(2, Math.min(3, Math.floor((Math.min(88, dimensions().width - 2) - 7) / game().width)))
      const [clock, setClock] = createSignal(Date.now())
      const tick = setInterval(() => setClock(Date.now()), 500)
      onCleanup(() => clearInterval(tick))
      const move = (dx: number, dy: number) => {
        const g = game()
        const x = Math.max(0, Math.min(g.width - 1, cursor() % g.width + dx))
        const y = Math.max(0, Math.min(g.height - 1, Math.floor(cursor() / g.width) + dy))
        setCursor(y * g.width + x)
      }
      const commands = [
        { id: "up", bind: "up,w,k", run: () => move(0, -1) },
        { id: "down", bind: "down,s,j", run: () => move(0, 1) },
        { id: "left", bind: "left,a,h", run: () => move(-1, 0) },
        { id: "right", bind: "right,d,l", run: () => move(1, 0) },
        { id: "reveal", bind: "return,space", run: () => setGame((g) => reveal(g, cursor())) },
        { id: "flag", bind: "f", run: () => setGame((g) => toggleFlag(g, cursor())) },
        { id: "chord", bind: "c", run: () => setGame((g) => chord(g, cursor())) },
        { id: "reset", bind: "r", run: () => reset() },
        { id: "easy", bind: "1", run: () => reset(0) },
        { id: "normal", bind: "2", run: () => reset(1) },
        { id: "hard", bind: "3", run: () => reset(2) },
        { id: "exit", bind: "escape,q", run: exit },
        { id: "menu", bind: "b,backspace", run: menu },
      ].map((entry) => ({ ...entry, id: `moonvoid.arcade.minesweeper.${entry.id}` }))
      context.keymap.layer(() => ({
        mode: "modal",
        priority: 100,
        commands,
        bindings: commands.map((entry) => entry.id),
      }))
      createEffect(() => {
        const row = Math.floor(cursor() / game().width)
        if (!scroll || scroll.viewport.height < 1) return
        if (row < scroll.scrollTop) scroll.scrollTo(row)
        else if (row >= scroll.scrollTop + scroll.viewport.height) {
          scroll.scrollTo(row - scroll.viewport.height + 1)
        }
        const column = (cursor() % game().width) * cellWidth()
        if (column < scroll.scrollLeft) scroll.scrollTo({ x: column, y: scroll.scrollTop })
        else if (column + cellWidth() > scroll.scrollLeft + scroll.viewport.width) {
          scroll.scrollTo({ x: column + cellWidth() - scroll.viewport.width, y: scroll.scrollTop })
        }
      })

      const elapsed = () => {
        const g = game()
        return g.startedAt === null ? 0 : Math.max(0, Math.floor(((g.endedAt ?? clock()) - g.startedAt) / 1000))
      }
      const remaining = () => game().mines - game().cells.filter((cell) => cell.flag).length
      const status = () => ({
        ready: "首次翻开及周围八格无雷",
        playing: "排雷中",
        won: "扫雷成功！R 再来一局",
        lost: "踩雷了。R 重新开始",
      })[game().phase]
      const ink = (appearance: ReturnType<typeof cellAppearance>) => {
        if (typeof appearance.tone === "number") {
          return theme().categorical[(appearance.tone - 1) % theme().categorical.length][200]
        }
        if (appearance.tone === "flag") return theme().text.feedback.warning.base
        if (appearance.tone === "mine") return theme().text.feedback.error.base
        return theme().text.muted
      }

      return (
        <ArcadeFrame title="扫雷" subtitle="Minesweeper" height={game().height + 10} onClose={exit} onMenu={menu}
          status={<span style={{ fg: game().phase === "won" ? theme().text.feedback.success.base : game().phase === "lost" ? theme().text.feedback.error.base : theme().text.muted }}>{status()}</span>}
          footer={<>
            <text height={1} fg={theme().text.muted}>↑↓←→ 移动  enter 翻开  f 插旗  c 连开</text>
            <text height={1} fg={theme().text.muted}>r 重开  b 游戏库  esc/q 关闭  ·  鼠标左翻 / 右旗</text>
          </>}>
          <box height={1} flexShrink={0} marginTop={1} flexDirection="row" justifyContent="space-between">
            <box flexDirection="row" gap={2}>
              <For each={difficultyNames}>{(name, index) => (
                <text fg={level() === index() ? theme().text.base : theme().text.muted}
                  onMouseDown={() => reset(index())}>{index() + 1} {name}</text>
              )}</For>
            </box>
            <text fg={theme().text.muted}>余雷 {remaining()} · {elapsed()}s</text>
          </box>
          <scrollbox ref={scroll} flexGrow={1} minHeight={1} marginTop={1} scrollX scrollY
            contentOptions={{ alignItems: "center", minWidth: "100%" }}>
            <box flexDirection="column" width={game().width * cellWidth()}>
              <For each={Array.from({ length: game().height }, (_, y) => y)}>{(y) => (
                <box flexDirection="row" height={1}>
                  <For each={Array.from({ length: game().width }, (_, x) => x)}>{(x) => {
                    const index = () => y * game().width + x
                    const cell = () => game().cells[index()]
                    const appearance = () => cellAppearance(cell(), index(), game())
                    return (
                      <text width={cellWidth()} height={1}
                        fg={cursor() === index() ? theme().text.base : ink(appearance())}
                        bg={cursor() === index() ? theme().background.raised.max : cell().open ? theme().background.base : theme().background.raised.high}
                        onMouseDown={(event) => {
                          if (event.button !== 0 && event.button !== 2) return
                          event.stopPropagation()
                          setCursor(index())
                          setGame((g) => event.button === 2 ? toggleFlag(g, index()) : reveal(g, index()))
                        }}
                      >{cellWidth() === 2 ? appearance().label.trim().padEnd(2) : appearance().label}</text>
                    )
                  }}</For>
                </box>
              )}</For>
            </box>
          </scrollbox>
        </ArcadeFrame>
      )
    }

    return Board
}
