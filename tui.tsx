import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, For, Match, Switch } from "solid-js"
import { ArcadeFrame } from "./frame"
import { createMinesweeper } from "./minesweeper"
import { createSnake } from "./snake-view"

type Screen = "menu" | "minesweeper" | "snake"

export default Plugin.define({
  id: "moonvoid.arcade",
  setup(context) {
    const [screen, setScreen] = createSignal<Screen>("menu")
    let dialogOpen = false
    const close = () => { if (dialogOpen) context.ui.dialog.clear() }
    const menu = () => setScreen("menu")
    const Minesweeper = createMinesweeper(context, close, menu)
    const Snake = createSnake(context, close, menu)

    function Menu() {
      const theme = createMemo(() => context.theme.surface("dialog"))
      const [selected, setSelected] = createSignal(0)
      const games = [
        { title: "扫雷", subtitle: "Minesweeper", description: "翻开格子，避开地雷。没有提示功能。", screen: "minesweeper" },
        { title: "贪吃蛇", subtitle: "Snake", description: "吃掉食物，穿越边界，不要咬到自己。", screen: "snake" },
      ] as const
      const commands = [
        { id: "up", bind: "up,w,k", run: () => setSelected(0) },
        { id: "down", bind: "down,s,j", run: () => setSelected(1) },
        { id: "open", bind: "return,space", run: () => setScreen(games[selected()].screen) },
        { id: "mines", bind: "1", run: () => setScreen("minesweeper") },
        { id: "snake", bind: "2", run: () => setScreen("snake") },
        { id: "close", bind: "escape,q", run: close },
      ].map((c) => ({ ...c, id: `moonvoid.arcade.menu.${c.id}` }))
      context.keymap.layer(() => ({ mode: "modal", priority: 100, commands, bindings: commands.map((c) => c.id) }))
      return (
        <ArcadeFrame title="Arcade" subtitle="小游戏" height={16} onClose={close}
          status="纯本地 · 不调用模型 · 不影响后台任务"
          footer={<>
            <text height={1} fg={theme().text.muted}>↑↓ 选择  enter 打开  1 扫雷  2 贪吃蛇</text>
            <text height={1} fg={theme().text.muted}>esc/q 关闭  ·  游戏内按 b 回到这里</text>
          </>}>
          <box flexDirection="column" flexGrow={1} justifyContent="center" gap={1}>
            <For each={games}>{(game, index) => (
              <box flexDirection="column" height={3} paddingLeft={2} paddingRight={2}
                backgroundColor={selected() === index() ? theme().background.raised.high : undefined}
                onMouseOver={() => setSelected(index())} onMouseUp={() => setScreen(game.screen)}>
                <text fg={theme().text.base}>{selected() === index() ? "›" : " "} {index() + 1}  <b>{game.title}</b>  <span style={{ fg: theme().text.muted }}>{game.subtitle}</span></text>
                <text fg={theme().text.muted}>     {game.description}</text>
              </box>
            )}</For>
          </box>
        </ArcadeFrame>
      )
    }

    function open(next: Screen) {
      setScreen(next)
      if (dialogOpen) return
      dialogOpen = true
      context.ui.dialog.show(() => (
        <Switch>
          <Match when={screen() === "menu"}><Menu /></Match>
          <Match when={screen() === "minesweeper"}><Minesweeper /></Match>
          <Match when={screen() === "snake"}><Snake /></Match>
        </Switch>
      ), () => { dialogOpen = false })
      context.ui.dialog.set({ size: "large", centered: true })
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        { id: "moonvoid.arcade.open", title: "Arcade · 游戏库", group: "Arcade", palette: true, slash: { name: "arcade" }, run: () => open("menu") },
        { id: "moonvoid.arcade.minesweeper.open", title: "Minesweeper · 扫雷", group: "Arcade", palette: true, slash: { name: "minesweeper", aliases: ["mines"] }, run: () => open("minesweeper") },
        { id: "moonvoid.arcade.snake.open", title: "Snake · 贪吃蛇", group: "Arcade", palette: true, slash: { name: "snake" }, run: () => open("snake") },
      ],
    }))
    return close
  },
})
