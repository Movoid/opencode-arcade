import { Rpc } from "@opencode/plugin/rpc"
import { moveInput } from "./gomoku-contract"

export const ArcadeRpc = Rpc.define({
  id: "moonvoid.arcade",
  methods: {
    prepare: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "object", properties: { directory: { type: "string" }, pluginID: { type: "string" } }, required: ["directory", "pluginID"], additionalProperties: false },
      errors: { turn_failed: { type: "null" } },
    },
    turn: {
      input: { type: "object", properties: {
        requestID: { type: "string", minLength: 1, maxLength: 100 },
        model: { type: "object", properties: { providerID: { type: "string" }, id: { type: "string" }, variant: { type: "string" } }, required: ["providerID", "id"], additionalProperties: false },
        moves: { type: "array", maxItems: 225, items: { type: "integer", minimum: 0, maximum: 224 } },
      }, required: ["requestID", "model", "moves"], additionalProperties: false },
      output: { ...moveInput, required: ["x", "y", "comment"] },
      errors: { turn_failed: { type: "null" } },
    },
    cancel: { input: { type: "object", properties: { requestID: { type: "string" } }, required: ["requestID"], additionalProperties: false }, output: { type: "null" } },
  },
  events: {},
})
