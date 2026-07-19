import { describe, expect, it } from 'vitest'
import { publicRunStageForStatus, publicRunStageLabel } from './publicRunStage'

describe('public run stages', () => {
  it.each([
    ['loading_model', 'Preparing'],
    ['switching_model', 'Preparing'],
    ['thinking', 'Reading context'],
    ['running_tool', 'Using a tool'],
    ['reviewing', 'Checking the answer'],
    ['idle', 'Ready'],
  ] as const)('maps %s to %s', (status, label) => {
    expect(publicRunStageLabel(publicRunStageForStatus(status))).toBe(label)
  })
})
