import { expect, test } from "bun:test"
import { pathToFileURL } from "node:url"
import { readFile } from "node:fs/promises"
import { GomokuBackend, registerGomokuGuards, type Pending } from "./gomoku-backend"
import type { ServerContext } from "./gomoku-isolation"
import { newGomoku } from "./gomoku"

function fake() {
  const hooks = new Map<string, (event: any) => unknown>(), tools = new Map<string, any>()
  const removed: string[] = [], deleted: string[] = [], created: any[] = [], switched: any[] = [], prompted: string[] = []
  let directory = "", loads = 0
  const mcps = new Map<string, unknown>([["config-mcp", {}], ["plugin-injected-mcp", {}]])
  const ctx = {
    get location() { return { directory } },
    plugin: { list: async ({ location }: any) => {
      if (!location) return { location: { directory: "/root-project" }, data: [{ id: "opencode.config.policy", source: { type: "builtin" } }, { id: "opencode.config.mcp", source: { type: "builtin" } }, { id: "global-compressor", source: { type: "package" } }] }
      loads++; directory = location.directory
      const bootstrap = await import(pathToFileURL(`${directory}/index.js`).href)
      await bootstrap.default.setup(ctx)
      return { location: { directory }, data: [{ id: bootstrap.default.id, state: { status: "active" } }] }
    } },
    mcp: {
      transform: async (edit: any) => { edit({ list: () => mcps.entries(), remove: (id: string) => { removed.push(id); mcps.delete(id) } }); return { dispose: async () => {} } },
      list: async () => ({ data: [...mcps], location: { directory } }),
    },
    model: { list: async () => ({ data: ["mock", "alternate"].map((id) => ({ id, providerID: "local", capabilities: { tools: true } })), location: { directory } }) },
    tool: {
      transform: async (edit: any) => {
        tools.set("bash", {}); tools.set("edit", {}); tools.set("mcp__injected", {})
        edit({ list: () => [...tools.keys()].map((id) => ({ id })), remove: (id: string) => tools.delete(id), add: (tool: any) => tools.set(tool.name, tool) })
        return { dispose: async () => tools.clear() }
      },
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return { dispose: async () => hooks.delete(name) } },
    },
    session: {
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return { dispose: async () => hooks.delete(name) } },
      create: async (input: any) => { created.push(input); return { ...input, location: { directory } } },
      switchModel: async (input: any) => { switched.push(input) },
      prompt: async ({ sessionID }: any) => {
        prompted.push(sessionID)
        const event = { sessionID, system: ["SECRET PROJECT INSTRUCTIONS"], messages: ["old chat"], tools: { gomoku_move: tools.get("gomoku_move"), bash: {}, mcp__injected: {} } }
        hooks.get("context")!(event)
        expect(Object.keys(event.tools)).toEqual(["gomoku_move"])
        expect(JSON.stringify(event)).not.toContain("SECRET PROJECT")
        await hooks.get("execute.before")!({ sessionID, tool: "gomoku_move" })
        await tools.get("gomoku_move").execute({ x: 8, y: 8, comment: "中心" }, { sessionID, signal: new AbortController().signal })
        expect(hooks.get("context")!(event)).toBeInstanceOf(Promise)
      },
      wait: async () => {},
      interrupt: async () => {},
      remove: async ({ sessionID }: any) => { deleted.push(sessionID) },
    },
  }
  return { ctx: ctx as unknown as ServerContext, hooks, tools, mcps, removed, deleted, created, switched, prompted, loads: () => loads }
}

test("reuse one session for many turns and new games, strip MCPs, one tool/request", async () => {
  const host = fake(), backend = new GomokuBackend(host.ctx)
  try {
    const isolated = await backend.prepare()
    const config = JSON.parse(await readFile(`${isolated.directory}/opencode.json`, "utf8"))
    expect(config.plugins).toEqual(["-*", "opencode.config.policy", isolated.directory])
    await host.ctx.plugin.list({ location: { directory: isolated.directory } })
    expect(await backend.prepare()).toEqual(isolated)
    for (let n = 0; n < 100; n++) expect(await backend.turn({ requestID: `turn${n}`, model: { providerID: "local", id: n % 2 ? "alternate" : "mock", ...(n % 2 ? { variant: "low" } : {}) }, moves: n % 2 ? [0] : [] })).toEqual({ x: 8, y: 8, comment: "中心" })
    expect(host.loads()).toBe(1)
    expect(host.removed).toEqual(["config-mcp", "plugin-injected-mcp"])
    expect(host.created.length).toBe(1)
    expect(host.deleted).toEqual([])
    expect(new Set(host.prompted)).toEqual(new Set([host.created[0].id]))
    expect(host.switched.length).toBe(100)
    expect(host.switched[1].model.id).toBe("alternate")
    expect(host.switched[1].model.variant).toBe("low")
    expect(host.switched[2].model.variant).toBeUndefined()
    expect(host.created[0].permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }, { action: "gomoku_move", resource: "*", effect: "allow" }])
    expect([...host.tools.keys()]).toEqual(["gomoku_move"])
  } finally { await backend.dispose(); expect(host.deleted).toEqual([]) }
})

test("guards reject native/unknown tools, stale, occupied, double and cancelled moves", async () => {
  const host = fake(), controller = new AbortController()
  const game = newGomoku(); game.cells[0] = 1
  const pending: Pending = { game, signal: controller.signal, requests: 0, closing: false, finish: () => {}, stopped: Promise.resolve() }
  const cleanup = await registerGomokuGuards(host.ctx, new Map([["turn", pending]]))
  try {
    const execute = host.tools.get("gomoku_move").execute
    const execution = { sessionID: "turn", signal: controller.signal }
    for (const tool of ["bash", "edit", "mcp__other"]) expect(() => host.hooks.get("execute.before")!({ sessionID: "turn", tool })).toThrow()
    await expect(execute({ x: 1, y: 1 }, execution)).rejects.toThrow("occupied")
    await expect(execute({ x: 16, y: 1 }, execution)).rejects.toThrow()
    await expect(execute({ x: 8, y: 8 }, { ...execution, sessionID: "unknown" })).rejects.toThrow()
    await execute({ x: 8, y: 8 }, execution)
    await expect(execute({ x: 9, y: 9 }, execution)).rejects.toThrow()
    pending.move = undefined; controller.abort()
    await expect(execute({ x: 9, y: 9 }, execution)).rejects.toThrow()
    const title = { result: "" }; host.hooks.get("title")!(title); expect(title.result).toBeTruthy()
    const retry = { decision: {} }; host.hooks.get("retry")!(retry); expect(retry.decision).toEqual({ retry: false })
    for (const hook of ["compaction", "generate"]) expect(() => host.hooks.get(hook)!({})).toThrow()
  } finally { await cleanup() }
})

test("cancellation waits for late prompt admission, then retries in the same session", async () => {
  const host = fake()
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const hold = new Promise<void>((resolve) => { release = resolve })
  const prompt = host.ctx.session.prompt
  let admissions = 0
  host.ctx.session.prompt = (async (input: any) => {
    if (++admissions === 1) { entered(); await hold; return }
    return prompt(input)
  }) as any
  const backend = new GomokuBackend(host.ctx)
  const isolated = await backend.prepare()
  await host.ctx.plugin.list({ location: { directory: isolated.directory } })
  const result = backend.turn({ requestID: "cancel", model: { providerID: "local", id: "mock" }, moves: [0] })
  await ready
  const rejected = result.catch((error) => error)
  backend.cancel("cancel")
  const retry = backend.turn({ requestID: "retry", model: { providerID: "local", id: "mock" }, moves: [0] })
  await Promise.resolve()
  expect(admissions).toBe(1)
  release()
  expect((await rejected).message).toContain("cancelled")
  expect(await retry).toEqual({ x: 8, y: 8, comment: "中心" })
  expect(host.created.length).toBe(1)
  expect(host.deleted).toEqual([])
  await backend.dispose()
})

test("prepare does not activate a Location through the bound server API", async () => {
  const host = fake(), backend = new GomokuBackend(host.ctx)
  try {
    await backend.prepare()
    expect(host.loads()).toBe(0)
    await expect(backend.turn({ requestID: "not-ready", model: { providerID: "local", id: "mock" }, moves: [0] })).rejects.toThrow("not been activated")
    expect(host.created.length).toBe(0)
  } finally { await backend.dispose() }
})

test("cancellation during creation keeps the created session for subsequent turns", async () => {
  const host = fake(), backend = new GomokuBackend(host.ctx)
  const isolated = await backend.prepare()
  await host.ctx.plugin.list({ location: { directory: isolated.directory } })
  const create = host.ctx.session.create
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const hold = new Promise<void>((resolve) => { release = resolve })
  host.ctx.session.create = (async (input: any) => { entered(); await hold; return create(input) }) as any
  const result = backend.turn({ requestID: "late-create", model: { providerID: "local", id: "mock" }, moves: [0] }).catch((error) => error)
  await ready
  backend.cancel("late-create")
  expect(host.deleted.length).toBe(0)
  release()
  expect((await result).message).toContain("cancelled")
  expect(host.created.length).toBe(1)
  expect(host.deleted).toEqual([])
  await backend.turn({ requestID: "after-create", model: { providerID: "local", id: "mock" }, moves: [] })
  expect(host.created.length).toBe(1)
  await backend.dispose()
})

test("never run concurrent turns or hand off the session until cancellation is idle", async () => {
  const host = fake(), backend = new GomokuBackend(host.ctx)
  const isolated = await backend.prepare()
  await host.ctx.plugin.list({ location: { directory: isolated.directory } })
  let waiting!: () => void, release!: () => void
  const ready = new Promise<void>((resolve) => { waiting = resolve })
  const hold = new Promise<void>((resolve) => { release = resolve })
  let waits = 0
  host.ctx.session.wait = (async () => {
    if (++waits <= 2) { waiting(); await hold }
  }) as any
  const first = backend.turn({ requestID: "first", model: { providerID: "local", id: "mock" }, moves: [0] }).catch((e) => e)
  await ready
  backend.cancel("first")
  const second = backend.turn({ requestID: "second", model: { providerID: "local", id: "mock" }, moves: [] })
  await Promise.resolve(); await Promise.resolve()
  expect(host.prompted.length).toBe(1)
  release()
  expect((await first).message).toContain("cancelled")
  await second
  expect(host.prompted.length).toBe(2)
  expect(host.created.length).toBe(1)
  await backend.dispose()
})

test("an aborted old tool execution cannot act as the new turn in a reused session", async () => {
  const host = fake(), old = new AbortController(), current = new AbortController()
  const pending: Pending = { game: newGomoku(), signal: current.signal, requests: 0, closing: false, finish: () => {}, stopped: Promise.resolve() }
  const cleanup = await registerGomokuGuards(host.ctx, new Map([["shared", pending]]))
  old.abort()
  try {
    const execute = host.tools.get("gomoku_move").execute
    await expect(execute({ x: 8, y: 8 }, { sessionID: "shared", signal: old.signal })).rejects.toThrow("Not an active")
    expect(pending.move).toBeUndefined()
    await execute({ x: 9, y: 9 }, { sessionID: "shared", signal: current.signal })
    expect(pending.move).toEqual({ x: 9, y: 9, comment: "" })
  } finally { await cleanup() }
})

test("failure to confirm idle blocks reuse without allocating a replacement session", async () => {
  const host = fake(), backend = new GomokuBackend(host.ctx)
  const isolated = await backend.prepare()
  await host.ctx.plugin.list({ location: { directory: isolated.directory } })
  host.ctx.session.interrupt = (async () => { throw new Error("connection lost") }) as any
  for (const requestID of ["first", "retry"]) await expect(backend.turn({ requestID, model: { providerID: "local", id: "mock" }, moves: [] })).rejects.toThrow("Cannot confirm")
  expect(host.created.length).toBe(1)
  expect(host.prompted.length).toBe(1)
  expect(host.deleted).toEqual([])
  await backend.dispose()
})

test("a failed model request and cancelled queued turn do not allocate new sessions", async () => {
  const host = fake(), backend = new GomokuBackend(host.ctx)
  const isolated = await backend.prepare()
  await host.ctx.plugin.list({ location: { directory: isolated.directory } })
  const prompt = host.ctx.session.prompt
  host.ctx.session.prompt = (async () => { throw new Error("provider unavailable") }) as any
  await expect(backend.turn({ requestID: "failure", model: { providerID: "local", id: "mock" }, moves: [] })).rejects.toThrow("provider unavailable")
  host.ctx.session.prompt = prompt
  const controller = new AbortController(); controller.abort(new Error("queued turn cancelled"))
  await expect(backend.turn({ requestID: "cancelled", model: { providerID: "local", id: "mock" }, moves: [] }, controller.signal)).rejects.toThrow("queued turn cancelled")
  await backend.turn({ requestID: "retry", model: { providerID: "local", id: "alternate" }, moves: [] })
  expect(host.created.length).toBe(1)
  expect(host.prompted.length).toBe(1)
  expect(host.deleted).toEqual([])
  await backend.dispose()
})

test("an ambiguous creation failure is cached instead of repeatedly creating sessions", async () => {
  const host = fake(), backend = new GomokuBackend(host.ctx)
  const isolated = await backend.prepare()
  await host.ctx.plugin.list({ location: { directory: isolated.directory } })
  let attempts = 0
  host.ctx.session.create = (async () => { attempts++; throw new Error("creation response lost") }) as any
  for (const requestID of ["first", "retry"]) await expect(backend.turn({ requestID, model: { providerID: "local", id: "mock" }, moves: [] })).rejects.toThrow("creation response lost")
  expect(attempts).toBe(1)
  expect(host.prompted).toEqual([])
  expect(host.deleted).toEqual([])
  await backend.dispose()
})

test("successful tool continuation parks dispatch without throwing a session failure", async () => {
  const host = fake(), controller = new AbortController()
  let finishes = 0, release!: () => void
  const stopped = new Promise<void>((resolve) => { release = resolve })
  const pending: Pending = { game: newGomoku(), signal: controller.signal, requests: 0, closing: false, finish: () => { finishes++ }, stopped }
  const cleanup = await registerGomokuGuards(host.ctx, new Map([["shared", pending]]))
  try {
    const event = { sessionID: "shared", system: [], messages: [], tools: { gomoku_move: host.tools.get("gomoku_move") } }
    host.hooks.get("context")!(event)
    await host.tools.get("gomoku_move").execute({ x: 8, y: 8 }, { sessionID: "shared", signal: controller.signal })
    const continuation = host.hooks.get("context")!(event)
    expect(continuation).toBe(stopped)
    expect(finishes).toBe(1)
    expect(pending.requests).toBe(1)
    let dispatched = false
    void Promise.resolve(continuation).then(() => { dispatched = true })
    await Promise.resolve()
    expect(dispatched).toBe(false)
    pending.closing = true
    expect(host.hooks.get("context")!(event)).toBe(stopped)
    release()
    await continuation
  } finally { await cleanup() }
})

test("backend interrupts a parked successful continuation before handing off the shared session", async () => {
  const host = fake(), backend = new GomokuBackend(host.ctx)
  const isolated = await backend.prepare()
  await host.ctx.plugin.list({ location: { directory: isolated.directory } })
  let interrupted = 0
  const prompt = host.ctx.session.prompt
  host.ctx.session.wait = (async () => { if (!interrupted) await new Promise<void>(() => {}) }) as any
  host.ctx.session.interrupt = (async () => { interrupted++ }) as any
  host.ctx.session.prompt = (async (input: any) => { await prompt(input) }) as any
  expect(await backend.turn({ requestID: "finish", model: { providerID: "local", id: "mock" }, moves: [] })).toEqual({ x: 8, y: 8, comment: "中心" })
  expect(interrupted).toBe(1)
  expect(host.created.length).toBe(1)
  expect(host.deleted).toEqual([])
  await backend.dispose()
})
