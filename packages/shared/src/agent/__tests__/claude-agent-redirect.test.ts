import { describe, expect, it, mock } from 'bun:test'
import { ClaudeAgent } from '../claude-agent.ts'
import { AbortReason } from '../backend/types.ts'

// Regression test for the craft-agents mid-stream "Steer immediately" bug.
//
// Claude cannot reliably steer an in-flight turn. The previous best-effort
// approach stashed the message and tried to inject it via the next PreToolUse
// hook's additionalContext. Two failure modes were observed in production:
//   1. It corrupted the SDK resume state — subsequent turns logged
//      "completed without assistant response" (empty turns). See session
//      260529-young-glen: steer at 09:14:51, then empty turns at 09:17/09:20.
//   2. When no tool fired before the turn ended, the steer became
//      `steer_undelivered` and was re-queued with a malformed shape (just
//      `{ message }`, dropping the already-created message's id), producing a
//      duplicate/phantom user message on replay.
//
// The robust contract: redirect() must abort the in-flight query and return
// false, so the session layer queues the message with its full shape (id +
// attachments + options) and replays it as a clean fresh turn — the same path
// used by UserStop and source-activated auto-retry. "Steer immediately" then
// means exactly what the user expects: interrupt now, handle my message now.

describe('ClaudeAgent.redirect (mid-stream steer)', () => {
  it('aborts the in-flight query with Redirect and returns false', () => {
    const abort = mock((_reason?: unknown) => {})
    const agent = Object.create(ClaudeAgent.prototype) as any

    agent.currentQuery = { interrupt: mock(async () => {}) }
    agent.currentQueryAbortController = { abort }
    agent.lastAbortReason = null
    agent.debug = mock((_message: string) => {})

    const steered = agent.redirect('handle my new message now')

    // false => SessionManager queues the message (full shape) + sets
    // wasInterrupted, then replays it after the abort drains the turn.
    expect(steered).toBe(false)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(abort).toHaveBeenCalledWith(AbortReason.Redirect)
    expect(agent.lastAbortReason).toBe(AbortReason.Redirect)
  })

  it('returns false when there is no active query (cold redirect)', () => {
    const agent = Object.create(ClaudeAgent.prototype) as any

    agent.currentQuery = null
    agent.currentQueryAbortController = null
    agent.lastAbortReason = null
    agent.debug = mock((_message: string) => {})

    const steered = agent.redirect('no live turn to steer')

    expect(steered).toBe(false)
    expect(agent.lastAbortReason).toBe(AbortReason.Redirect)
  })
})
