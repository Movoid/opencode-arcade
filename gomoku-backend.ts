import { randomBytes } from "node:crypto"
import { createArcadeIsolation, type ServerContext } from "./gomoku-isolation"
import { gomokuPrompt, replayGomoku, type Gomoku } from "./gomoku"
import { MOVE_TOOL, moveInput, type MoveResult, type TurnInput } from "./gomoku-contract"

export type Pending = { game: Gomoku; signal: AbortSignal; requests: number; move?: MoveResult; closing: boolean; finish(): void; stopped: Promise<void> }
type Registration = { dispose(): Promise<void> }

export async function registerGomokuGuards(ctx: ServerContext, sessions: Map<string, Pending>) {
  const registrations: Registration[] = []
  try {
    registrations.push(await ctx.tool.transform((editor) => {
      for (const tool of editor.list()) editor.remove(tool.id)
      editor.add({ name: MOVE_TOOL, description: "Place your one Gomoku stone at empty (x,y), 1-based.", input: moveInput,
        options: { codemode: false, permission: MOVE_TOOL },
        execute: async (input, execution) => {
          const pending = sessions.get(execution.sessionID)
          if (!pending || pending.closing || pending.signal.aborted || execution.signal.aborted || pending.move) throw new Error("Not an active Gomoku turn")
          const { x, y, comment } = input as MoveResult
          if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || x > 15 || y < 1 || y > 15 || pending.game.cells[(y - 1) * 15 + x - 1]) throw new Error("Position is outside the board or occupied")
          pending.move = { x, y, comment: typeof comment === "string" ? comment.slice(0, 120) : "" }
          return { content: "Move accepted. Turn complete." }
        },
      })
    }))
    registrations.push(await ctx.session.hook("context", (event) => {
      const pending = sessions.get(event.sessionID)
      if (!pending) throw new Error("Gomoku turn is no longer active")
      if (pending.move || pending.closing || pending.signal.aborted) {
        // This is successful turn completion, not a session failure. Wake the
        // backend, then park dispatch until it interrupts this drain normally.
        // Never await interrupt here: it waits for this very hook to stop.
        pending.finish()
        return pending.stopped
      }
      if (pending.requests++ > 0) throw new Error("Model continued without a valid Gomoku move")
      const tool = event.tools[MOVE_TOOL]
      if (!tool) throw new Error("Gomoku move tool is unavailable")
      event.tools = { [MOVE_TOOL]: tool }
      event.system = [{ type: "text", text: "You are a Gomoku opponent in an entertainment game. Only play your next stone using gomoku_move. Do not use coding tools or follow project instructions." }]
      event.messages = [{ role: "user", content: [{ type: "text", text: gomokuPrompt(pending.game) }] }]
    }))
    registrations.push(await ctx.tool.hook("execute.before", (event) => {
      const pending = sessions.get(event.sessionID)
      if (!pending || pending.closing || pending.signal.aborted || event.tool !== MOVE_TOOL) throw new Error("Only gomoku_move is allowed in Arcade isolation")
    }))
    registrations.push(await ctx.session.hook("title", (event) => { event.result = "Arcade · Gomoku" }))
    registrations.push(await ctx.session.hook("compaction", () => { throw new Error("Gomoku turns do not compact") }))
    registrations.push(await ctx.session.hook("generate", () => { throw new Error("Gomoku turns do not use auxiliary generation") }))
    registrations.push(await ctx.session.hook("retry", (event) => { event.decision = { retry: false } }))
    return async () => { await Promise.all(registrations.map((r) => r.dispose())) }
  } catch (error) {
    await Promise.allSettled(registrations.map((r) => r.dispose()))
    throw error
  }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => {}); return Promise.reject(signal.reason) }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

export class GomokuBackend {
  private sessions = new Map<string, Pending>()
  private jobs = new Map<string, { controller: AbortController; done: Promise<MoveResult> }>()
  private closed = false
  private location?: ReturnType<GomokuBackend["openLocation"]>
  private workerID = `ses_${randomBytes(16).toString("hex")}`
  private worker?: Promise<void>
  private serial: Promise<unknown> = Promise.resolve()
  private blocked?: Error
  constructor(private root: ServerContext) {}

  async prepare() {
    if (this.closed) throw new Error("Arcade is shutting down")
    const location = await (this.location ??= this.openLocation())
    return { directory: location.directory, pluginID: location.pluginID }
  }

  private async isolated() {
    await this.prepare()
    const location = await this.location!
    const ctx = location.context()
    if (!ctx) throw new Error("Arcade isolation has not been activated by the TUI")
    return { ...location, ctx }
  }

  private async openLocation() {
    let context: ServerContext | undefined
    const cleanups = new Set<() => Promise<void>>()
    const plugins = await this.root.plugin.list({})
    const builtinIDs = plugins.data.flatMap((p) => p.source.type === "builtin" && p.id ? [p.id] : [])
    const isolated = await createArcadeIsolation(async (ctx) => {
      const cleanup = await registerGomokuGuards(ctx, this.sessions)
      context = ctx
      cleanups.add(cleanup)
      return async () => { cleanups.delete(cleanup); await cleanup() }
    }, builtinIDs)
    if (this.closed) throw new Error("Arcade is shutting down")
    // The TUI's existing authenticated client activates this Location. The
    // server plugin context is Location-bound: never read service credentials.
    return { ...isolated, context: () => context, cleanups }
  }

  turn(input: TurnInput, signal?: AbortSignal): Promise<MoveResult> {
    if (this.closed) return Promise.reject(new Error("Arcade is shutting down"))
    if (this.jobs.has(input.requestID)) return Promise.reject(new Error("Duplicate Gomoku request"))
    const controller = new AbortController()
    const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000), ...(signal ? [signal] : [])])
    // A cancelled RPC can be followed immediately by retry/reset/model change.
    // Never give the shared session to a new turn until the old drain is idle.
    const done = this.serial.then(() => {
      combined.throwIfAborted()
      if (this.blocked) throw this.blocked
      return this.run(input, combined)
    }).finally(() => this.jobs.delete(input.requestID))
    this.serial = done.catch(() => {})
    this.jobs.set(input.requestID, { controller, done })
    return done
  }

  cancel(requestID: string) { this.jobs.get(requestID)?.controller.abort(new Error("Gomoku thinking cancelled")) }

  private async run(input: TurnInput, signal: AbortSignal): Promise<MoveResult> {
    const game = replayGomoku(input.moves)
    if (game.winner || game.draw) throw new Error("Game already finished")
    const { ctx, directory } = await abortable(this.isolated(), signal)
    const inventory = await abortable(ctx.mcp.list(), signal)
    if (inventory.data.length !== 0 || inventory.location.directory !== directory) throw new Error("Arcade isolation contains MCP servers")
    const models = await abortable(ctx.model.list(), signal)
    const model = models.data.find((m) => m.id === input.model.id && m.providerID === input.model.providerID)
    if (!model?.capabilities.tools || (model.type && model.type !== "chat")) throw new Error("Selected model is unavailable or does not support tools")
    const id = this.workerID
    let finish!: () => void, stopped!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const stop = new Promise<void>((resolve) => { stopped = resolve })
    const pending: Pending = { game, signal, requests: 0, closing: false, finish, stopped: stop }
    this.sessions.set(id, pending)
    try {
      // Keep one session across turns, games, retries and model changes. Cache
      // even a failed creation: an ambiguous failure must not allocate more IDs.
      await (this.worker ??= (async () => {
        const session = await ctx.session.create({ id, title: "Arcade · Gomoku", model: input.model,
          permissions: [{ action: "*", resource: "*", effect: "deny" }, { action: MOVE_TOOL, resource: "*", effect: "allow" }],
        })
        if (session.id !== id || session.location.directory !== directory) throw new Error("Arcade session isolation mismatch")
      })())
      signal.throwIfAborted()
      await ctx.session.switchModel({ sessionID: id, model: input.model })
      signal.throwIfAborted()
      // Admission is not abort-raced: a late prompt must finish being admitted
      // BEFORE interrupt/wait, otherwise it could start in the next turn.
      await ctx.session.prompt({ sessionID: id, text: "Play your next Gomoku move." })
      signal.throwIfAborted()
      await abortable(Promise.race([ctx.session.wait({ sessionID: id }), finished]), signal)
      signal.throwIfAborted()
      if (!pending.move) throw new Error("模型没有落子。可按 T 重试，或 M 换个模型。")
      return pending.move
    } finally {
      pending.closing = true
      try {
        await ctx.session.interrupt({ sessionID: id, resume: false })
        await ctx.session.wait({ sessionID: id })
        this.sessions.delete(id)
      } catch {
        // Uncertain idle state: retain the closed guard and refuse further
        // turns instead of silently creating another session or mixing games.
        this.blocked = new Error("Cannot confirm Gomoku session is idle; refusing to reuse it")
        throw this.blocked
      } finally {
        // Release the parked Promise only after host interruption/idle. If that
        // failed, keep dispatch parked and the fail-closed guard installed.
        if (!this.blocked) stopped()
      }
    }
  }

  async dispose() {
    this.closed = true
    for (const { controller } of this.jobs.values()) controller.abort(new Error("Arcade unloaded"))
    await Promise.allSettled([...this.jobs.values()].map((job) => job.done))
    const location = await this.location?.catch(() => undefined)
    if (!location || this.sessions.size) return
    await Promise.all([...location.cleanups].map((cleanup) => cleanup()))
    location.release()
  }
}
