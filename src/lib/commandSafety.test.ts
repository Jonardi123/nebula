import { describe, expect, it } from 'vitest'
import { classifyCommand, classifyTool, toolNeedsApproval } from './commandSafety'

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

describe('classifyTool', () => {
  it('blocks private and local web fetches', () => {
    expect(classifyTool('web_fetch', { url: 'http://localhost:1234' }).level).toBe('blocked')
    expect(classifyTool('web_fetch', { url: 'http://10.0.0.1/api' }).level).toBe('blocked')
    expect(classifyTool('web_fetch', { url: 'http://127.0.0.1:47631' }).level).toBe('blocked')
  })

  it('marks suspicious URLs for approval', () => {
    expect(classifyTool('web_fetch', { url: 'https://example.com/download/payload' }).level).toBe('needs_approval')
  })

  it('allows safe public fetches', () => {
    expect(classifyTool('web_fetch', { url: 'https://docs.example.com/guide' }).level).toBe('safe')
  })

  it('classifies web search as safe', () => {
    expect(classifyTool('web_search', {}).level).toBe('safe')
  })

  it('always blocks screen capture for approval', () => {
    expect(classifyTool('capture_screen', {}).level).toBe('needs_approval')
  })

  it('requires approval for all file-write tools', () => {
    for (const tool of ['write_file', 'create_file', 'append_file']) {
      expect(classifyTool(tool, {}).level).toBe('needs_approval')
    }
  })

  it('classifies known app launches as safe and unknown as high risk', () => {
    expect(classifyTool('open_app', { app: 'notepad' }).level).toBe('safe')
    expect(classifyTool('open_app', { app: 'unknown-app' }).level).toBe('high_risk')
  })
})
