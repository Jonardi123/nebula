import { describe, expect, it } from 'vitest'
import { AgentRunController, throwIfRunCancelled } from './agentRun'

describe('AgentRunController', () => {
  it('settles cancellation and rejects late work', () => {
    const run = new AgentRunController()
    run.start()
    run.cancel('user')
    expect(run.snapshot()).toMatchObject({ status: 'stopped', cancellationReason: 'user' })
    expect(() => throwIfRunCancelled(run.signal)).toThrow(/cancelled/i)
  })

  it('does not turn a completed run into a stopped run', () => {
    const run = new AgentRunController()
    run.start()
    run.complete()
    run.cancel('superseded')
    expect(run.status).toBe('completed')
  })
})
