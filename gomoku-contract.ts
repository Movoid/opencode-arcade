export const MOVE_TOOL = "gomoku_move"
export type GomokuModel = { providerID: string; id: string; variant?: string }
export type MoveResult = { x: number; y: number; comment: string }
export type TurnInput = { requestID: string; model: GomokuModel; moves: number[] }
export const moveInput = {
  type: "object", properties: {
    x: { type: "integer", minimum: 1, maximum: 15 }, y: { type: "integer", minimum: 1, maximum: 15 },
    comment: { type: "string", maxLength: 120, description: "Optional brief Chinese comment" },
  }, required: ["x", "y"], additionalProperties: false,
} as const
