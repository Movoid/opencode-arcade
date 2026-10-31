import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import type { Plugin } from "@opencode/plugin"

export type ServerContext = Parameters<Plugin.Plugin["setup"]>[0]
type Activation = (context: ServerContext) => Promise<() => Promise<void>>
const KEY = "moonvoid.arcade.isolation.v1"
type Registry = Map<string, { directory: string; activate: Activation }>
const global = globalThis as typeof globalThis & { [key: symbol]: Registry }
const registry = global[Symbol.for(KEY)] ??= new Map()

export function isArcadeIsolation(directory: string) {
  return [...registry.values()].some((entry) => entry.directory === directory)
}

// Reuse the Location, remove plugin-added MCPs too. See reviewer issues #52/#73.
// Nothing is removed from the user's operational Location.
export async function createArcadeIsolation(activate: Activation, builtinIDs: string[]) {
  const parent = join(tmpdir(), "opencode")
  await mkdir(parent, { recursive: true })
  const directory = resolve(await mkdtemp(join(parent, "arcade-gomoku-")))
  const key = randomUUID(), pluginID = `moonvoid.arcade.isolation.${key}`
  registry.set(key, { directory, activate })
  const source = `export default { id: ${JSON.stringify(pluginID)}, async setup(ctx) {
    await ctx.mcp.transform(editor => { for (const [name] of editor.list()) editor.remove(name) });
    const entry = globalThis[Symbol.for(${JSON.stringify(KEY)})]?.get(${JSON.stringify(key)});
    if (!entry || entry.directory !== ctx.location.directory) throw new Error("Arcade isolation is no longer active");
    return entry.activate(ctx);
  } };`
  await writeFile(join(directory, "index.js"), source, { flag: "wx", mode: 0o600 })
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: pluginID, private: true, type: "module", exports: "./index.js" }), { flag: "wx", mode: 0o600 })
  // Third-party HTTP/context hooks can append prompts after our context hook.
  // Keep host-built providers/policy, not operational plugins or MCP loaders.
  await writeFile(join(directory, "opencode.json"), JSON.stringify({ plugins: ["-*", ...builtinIDs.filter((id) => id !== "opencode.config.mcp" && id !== "opencode.warming"), directory] }, null, 2), { flag: "wx", mode: 0o600 })
  // Keep this tiny MCP-excluding bootstrap: the host may cache/reload the Location.
  // It contains no credentials, boards or prompts. Never recursively delete it.
  return { directory, pluginID, release: () => registry.delete(key) }
}
