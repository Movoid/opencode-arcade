import { Plugin } from "@opencode/plugin"
import { GomokuBackend } from "./gomoku-backend"
import { isArcadeIsolation } from "./gomoku-isolation"
import { ArcadeRpc } from "./rpc"
import type { TurnInput } from "./gomoku-contract"

export default Plugin.define({
  id: "moonvoid.arcade",
  async setup(ctx) {
    if (isArcadeIsolation(ctx.location.directory)) return
    const backend = new GomokuBackend(ctx)
    await ctx.rpc.register(ArcadeRpc, {
      prepare: async (_input, context) => {
        try { return await backend.prepare() }
        catch (error) { return context.error("turn_failed", error instanceof Error ? error.message : String(error), null) }
      },
      turn: async (input, context) => {
        try { return await backend.turn(input as TurnInput, context.signal) }
        catch (error) { return context.error("turn_failed", error instanceof Error ? error.message : String(error), null) }
      },
      cancel: async (input) => { backend.cancel((input as { requestID: string }).requestID); return null },
    })
    return () => backend.dispose()
  },
})
