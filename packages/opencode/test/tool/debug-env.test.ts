import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { LSP } from "../../src/lsp"
import { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"
import { Instruction } from "../../src/session/instruction"
import { Truncate } from "../../src/tool"
import { ReadTool } from "../../src/tool/read"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderTest } from "../fake/provider"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const visionModel = ProviderTest.model({
  capabilities: {
    toolcall: true,
    attachment: true,
    reasoning: false,
    temperature: true,
    interleaved: false,
    input: { text: true, image: true, audio: false, video: false, pdf: true },
    output: { text: true, image: false, audio: false, video: false, pdf: false },
  },
})
const visionProvider = ProviderTest.fake({ model: visionModel })

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    Truncate.defaultLayer,
    visionProvider.layer,
  ),
)

describe("debug env permission", () => {
  it.live("print what happens", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(dir, ".env"), "content"))

      return yield* provideInstance(dir)(
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const info = yield* agent.get("build")
          const readRules = info.permission.filter((r: any) => r.permission === "read")
          console.log(`[debug] read rules:`, JSON.stringify(readRules))

          let asked = false
          const next = {
            ...ctx,
            ask: (req: any) =>
              Effect.sync(() => {
                console.log("[debug] ask CALLED permission:", req.permission, "patterns:", req.patterns)
                for (const pattern of req.patterns) {
                  const rule = Permission.evaluate(req.permission, pattern, info.permission)
                  console.log("[debug]   evaluate =>", JSON.stringify(rule))
                  if (rule.action === "ask" && req.permission === "read") asked = true
                }
              }),
          }

          const tool = yield* ReadTool
          const inited = yield* tool.init()
          const res = yield* inited.execute({ file_path: path.join(dir, ".env") }, next as any)
          console.log("[debug] output head:", JSON.stringify((res as any).output?.slice(0, 80)))
          console.log("[debug] asked =", asked)
          expect(asked).toBe(true)
        }),
      )
    }),
  )
})
