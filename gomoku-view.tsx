import type { usePlugin } from "@opencode/plugin/tui"
import type { ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js"
import { ArcadeFrame } from "./frame"
import { newGomoku, playGomoku } from "./gomoku"
import type { GomokuModel, MoveResult } from "./gomoku-contract"
import { ArcadeRpc } from "./rpc"

const errorText = (error: unknown) => typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)

export function createGomoku(context: ReturnType<typeof usePlugin>, exit: () => void, menu: () => void, reopen: () => void) {
  const [game, setGame] = createSignal(newGomoku())
  const [human, setHuman] = createSignal<1 | 2>(1)
  const [cursor, setCursor] = createSignal(112)
  const [model, setModel] = createSignal<GomokuModel>()
  const [thinking, setThinking] = createSignal(false)
  const [message, setMessage] = createSignal("你执黑先手。M 可选择对手模型。")
  let request: { id: string; controller: AbortController } | undefined
  let revision = 0, disposed = false
  const location = () => context.location ?? context.data.location.default()

  function cancel() {
    revision++
    const current = request
    request = undefined
    setThinking(false)
    if (!current) return
    current.controller.abort()
    void context.client.rpc(ArcadeRpc).cancel({ requestID: current.id }, { location: location() }).catch(() => {})
    setMessage("已停止思考。T 让对手继续。")
  }

  async function think() {
    const g = game(), selected = model()
    if (thinking() || g.winner || g.draw || g.turn === human()) return
    if (!selected) { setMessage("请按 M 选择对手模型。"); return }
    const current = { id: crypto.randomUUID(), controller: new AbortController() }
    const version = revision
    request = current
    setThinking(true)
    setMessage("对手思考中…… Esc 关闭会停止请求。")
    try {
      const options = { location: location(), signal: current.controller.signal }
      const isolated = await context.client.rpc(ArcadeRpc).prepare({}, options)
      const deadline = Date.now() + 15_000
      for (;;) {
        current.controller.signal.throwIfAborted()
        const plugins = await context.client.plugin.list({ location: { directory: isolated.directory } }, { signal: current.controller.signal })
        if (plugins.location.directory !== isolated.directory) throw new Error("Host did not select the Gomoku Location")
        const bootstrap = plugins.data.find((p) => p.id === isolated.pluginID)
        if (bootstrap?.state.status === "failed") throw new Error(`Arcade isolation failed: ${bootstrap.state.error}`)
        if (bootstrap?.state.status === "active") break
        if (Date.now() >= deadline) throw new Error("Arcade isolation did not activate")
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const result = await context.client.rpc(ArcadeRpc).turn({ requestID: current.id, model: selected, moves: g.moves }, { location: location(), signal: current.controller.signal }) as MoveResult
      if (disposed || revision !== version || request !== current) return
      const index = (result.y - 1) * 15 + result.x - 1
      const next = playGomoku(game(), index)
      if (next === game()) throw new Error("模型返回了无效位置。T 重试。")
      setGame(next)
      setMessage(result.comment || `对手落在 (${result.x}, ${result.y})。轮到你了。`)
    } catch (error) {
      if (revision === version && request === current) setMessage(`${errorText(error)} · T 重试`)
    } finally {
      if (request === current) { request = undefined; setThinking(false) }
    }
  }

  function reset(side = human()) {
    cancel()
    setHuman(side)
    setGame(newGomoku())
    setCursor(112)
    setMessage(side === 1 ? "新局开始，你执黑先手。" : "你执白后手。T 让对手先下。")
    if (side === 2) void think()
  }

  async function chooseModel() {
    cancel()
    try {
      const available = (await context.client.model.list({ location: location() })).data.filter((m) => (!m.type || m.type === "chat") && m.capabilities.tools)
      const options = available.map((m) => ({ title: m.name, description: m.id, category: m.providerID, value: `${m.providerID}\n${m.id}` }))
      const previous = model()
      const selection = await context.ui.dialog.select({ title: "五子棋 · 选择对手模型", current: previous ? `${previous.providerID}\n${previous.id}` : undefined, options })
      if (disposed) return
      if (selection) {
        const [providerID, id] = selection.split("\n")
        setModel({ providerID, id })
        setMessage(`对手已切换为 ${id}。`)
      }
      reopen()
    } catch (error) { if (!disposed) { setMessage(errorText(error)); reopen() } }
  }

  function Board() {
    const theme = createMemo(() => context.theme.surface("dialog"))
    let scroll: ScrollBoxRenderable | undefined
    if (!model()) {
      const selected = context.ui.model.current()
      if (selected) setModel({ providerID: selected.providerID, id: selected.modelID, ...(selected.variant ? { variant: selected.variant } : {}) })
    }
    onCleanup(cancel)
    // Reopening never automatically spends tokens. Only a move/new game/T does.
    const move = (dx: number, dy: number) => setCursor((i) => Math.max(0, Math.min(14, Math.floor(i / 15) + dy)) * 15 + Math.max(0, Math.min(14, i % 15 + dx)))
    const place = (index = cursor()) => {
      if (thinking() || game().turn !== human()) return
      const next = playGomoku(game(), index)
      if (next === game()) return
      setGame(next)
      if (!next.winner && !next.draw) void think()
    }
    const commands = [
      { id: "up", bind: "up,w,k", run: () => move(0, -1) },
      { id: "down", bind: "down,j", run: () => move(0, 1) },
      { id: "left", bind: "left,a,h", run: () => move(-1, 0) },
      { id: "right", bind: "right,d,l", run: () => move(1, 0) },
      { id: "place", bind: "return,space", run: () => place() },
      { id: "model", bind: "m", run: chooseModel },
      { id: "reset", bind: "r", run: () => reset() },
      { id: "side", bind: "x", run: () => reset(human() === 1 ? 2 : 1) },
      { id: "retry", bind: "t", run: think },
      { id: "stop", bind: "s", run: cancel },
      { id: "menu", bind: "b,backspace", run: menu },
      { id: "exit", bind: "escape,q", run: exit },
    ].map((c) => ({ ...c, id: `moonvoid.arcade.gomoku.${c.id}` }))
    context.keymap.layer(() => ({ mode: "modal", priority: 100, commands, bindings: commands.map((c) => c.id) }))
    createEffect(() => {
      const row = Math.floor(cursor() / 15) + 1
      if (!scroll || scroll.viewport.height < 1) return
      if (row < scroll.scrollTop) scroll.scrollTo(row)
      else if (row >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(row - scroll.viewport.height + 1)
    })
    const status = () => game().winner ? (game().winner === human() ? "你赢了！R 再来一局" : "对手赢了。R 再战") : game().draw ? "平局！" : thinking() ? "对手思考中 · 会消耗所选模型额度" : game().turn === human() ? "轮到你落子" : "T 让对手继续"
    return (
      <ArcadeFrame title="五子棋" subtitle="Gomoku · AI" height={27} onClose={exit} onMenu={menu} status={status()}
        footer={<><text height={1} fg={theme().text.muted}>↑↓←→ 移动 enter 落子  m 模型  r 新局  x 换边</text><text height={1} fg={theme().text.muted}>t 重试  s 停止  b 游戏库  esc/q 关闭</text></>}>
        <text height={1} flexShrink={0} marginTop={1} fg={theme().text.muted}>你 {human() === 1 ? "● 黑" : "○ 白"} · 对手 {model()?.id ?? "未选择（按 M）"}</text>
        <scrollbox ref={scroll} flexGrow={1} minHeight={1} marginTop={1} scrollY contentOptions={{ alignItems: "center", minWidth: "100%" }}>
          <box flexDirection="column" width={48}>
            <text height={1} fg={theme().text.muted}>   {Array.from({ length: 15 }, (_, x) => String(x + 1).padStart(2).padEnd(3)).join("")}</text>
            <For each={Array.from({ length: 15 }, (_, y) => y)}>{(y) => <box flexDirection="row" height={1}>
              <text width={3} fg={theme().text.muted}>{String(y + 1).padStart(2)} </text>
              <For each={Array.from({ length: 15 }, (_, x) => x)}>{(x) => {
                const index = y * 15 + x
                return <text width={3} height={1}
                  fg={game().line.includes(index) ? theme().text.feedback.success.base : game().cells[index] === 1 ? theme().text.base : theme().hue.accent[200]}
                  bg={cursor() === index ? theme().background.raised.max : game().moves.at(-1) === index ? theme().background.raised.high : undefined}
                  onMouseDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); setCursor(index); place(index) }}>
                  {game().cells[index] === 1 ? " ● " : game().cells[index] === 2 ? " ○ " : cursor() === index ? " + " : " · "}
                </text>
              }}</For>
            </box>}</For>
          </box>
        </scrollbox>
        <text height={1} flexShrink={0} fg={theme().text.muted}>{message().replace(/[\r\n\t]/g, " ")}</text>
      </ArcadeFrame>
    )
  }
  return { Board, dispose: () => { disposed = true; cancel() } }
}
