import { usePlugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, type JSX } from "solid-js"

export function ArcadeFrame(props: {
  title: string
  subtitle: string
  height: number
  onClose: () => void
  onMenu?: () => void
  children: JSX.Element
  status?: JSX.Element
  footer: JSX.Element
}) {
  const context = usePlugin()
  const dimensions = useTerminalDimensions()
  const theme = createMemo(() => context.theme.surface("dialog"))
  return (
    <box flexDirection="column" height={Math.max(10, Math.min(props.height, dimensions().height - 4))}
      paddingLeft={3} paddingRight={3} paddingBottom={1}>
      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={2}>
          <text fg={theme().text.base}><b>{props.title}</b></text>
          <text fg={theme().text.muted} onMouseUp={props.onMenu}>{props.onMenu ? "‹ arcade" : props.subtitle}</text>
        </box>
        <text fg={theme().text.muted} onMouseUp={props.onClose}>esc</text>
      </box>
      {props.children}
      <text height={1} flexShrink={0} marginTop={1} fg={theme().text.muted}>{props.status}</text>
      <box flexDirection="column" height={2} flexShrink={0} marginTop={1}>
        {props.footer}
      </box>
    </box>
  )
}
