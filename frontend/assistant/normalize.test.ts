import { describe, expect, it } from 'vitest'
import { normalizeAssistantEnvelope } from './normalize'
import { tryParseAssistantEnvelope } from './schema'

describe('assistant envelope', () => {
  it('parses assistant.v1 payloads and normalizes them into existing UI blocks', () => {
    const envelope = tryParseAssistantEnvelope(JSON.stringify({
      version: 'assistant.v1',
      state: 'ok',
      provider: 'claude',
      content: {
        title: 'Build plan',
        summary: 'Ready to implement.',
        blocks: [
          { type: 'markdown', text: 'Start with the frontend contract.' },
          { type: 'list', items: ['Extract blocks', 'Add schema'], ordered: true },
          {
            type: 'steps',
            items: [
              { title: 'Extract assistant model', status: 'done' },
              { title: 'Wire structured results', status: 'doing', body: 'Use sync path first' },
            ],
          },
          {
            type: 'kv',
            items: [
              { label: 'Provider', value: 'claude' },
            ],
          },
        ],
        data: {
          session: 'session-9',
        },
      },
    }))

    expect(envelope).not.toBeNull()
    expect(normalizeAssistantEnvelope(envelope!)).toEqual([
      { type: 'text', content: '## Build plan' },
      { type: 'text', content: 'Ready to implement.' },
      { type: 'text', content: 'Start with the frontend contract.' },
      { type: 'text', content: '1. Extract blocks\n2. Add schema' },
      {
        type: 'tasklist',
        tasks: [
          { id: 'step-1', title: 'Extract assistant model', status: 'done' },
          { id: 'step-2', title: 'Wire structured results', description: 'Use sync path first', status: 'running' },
        ],
      },
      {
        type: 'table',
        headers: ['Label', 'Value'],
        rows: [['Provider', 'claude']],
      },
      {
        type: 'json',
        label: 'Data',
        data: { session: 'session-9' },
      },
    ])
  })

  it('returns null for plain text that is not an assistant envelope', () => {
    expect(tryParseAssistantEnvelope('hello world')).toBeNull()
  })
})
