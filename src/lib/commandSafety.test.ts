import { describe, expect, it } from 'vitest'
import { classifyCommand, toolNeedsApproval } from './commandSafety'

describe('Black Matter execution policy', () => {
  it('asks for every command in approval mode', () => {
    expect(toolNeedsApproval('approval', 'run_command', classifyCommand('git status'))).toBe(true)
  })

  it('runs safe commands automatically in safe mode', () => {
    expect(toolNeedsApproval('safe', 'run_command', classifyCommand('npm test'))).toBe(false)
    expect(toolNeedsApproval('safe', 'run_command', classifyCommand('npm install'))).toBe(true)
  })

  it('runs known app launches in safe mode but not unknown app paths', () => {
    expect(toolNeedsApproval('safe', 'open_app', { level: 'safe', reason: 'known app', requiresTypedConfirm: false })).toBe(false)
    expect(toolNeedsApproval('safe', 'open_app', { level: 'high_risk', reason: 'unknown path', requiresTypedConfirm: true })).toBe(true)
  })

  it('permanently blocks hidden PowerShell execution', () => {
    expect(classifyCommand('powershell -WindowStyle Hidden -Command echo hi').level).toBe('blocked')
  })

  it('does not turn catastrophic commands into approvable commands', () => {
    const result = classifyCommand('format C:')
    expect(result.level).toBe('blocked')
    expect(toolNeedsApproval('full', 'run_command', result)).toBe(false)
  })
})
