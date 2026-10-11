import { expect, mock, test } from 'claude-code/testing'

import { bar, formatDuration, labelOf } from './register'

test('le temps et la barre se formatent', () => {
  expect(formatDuration(0)).toBe('00:00')
  expect(formatDuration(83_000)).toBe('01:23')
  expect(formatDuration(3_725_000)).toBe('1:02:05')
  expect(bar(0.5, 10)).toBe('█████░░░░░')
  expect(bar(1, 4)).toBe('████')
  expect(labelOf('Bash', { command: 'npm   test' })).toBe('Bash · npm test')
  expect(labelOf('Agent', {})).toBe('Agent')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`la bande fil suit une tâche sur ${surface}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 })

    on('turn.start', () => ({ turnId: 't1' }))
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', async () => {
      await clock.sleep(5_000)

      return { result: 'ok' }
    })
    on('agent.list', () => ({ value: [] }) as never)
    on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)

    const props = { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 100 }
    const mounted = await $.ui.mount({ plugin: 'fil', surface, component: 'AbovePrompt', props })

    // Rien à montrer avant la première tâche.
    expect(await mounted.find({ type: 'Text', text: 'fil' })).toBeUndefined()

    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(3_000)

    const running = await $.ui.mount({ plugin: 'fil', surface, component: 'AbovePrompt', props })
    expect((await running.find({ type: 'Text', text: 'en cours' }))?.type).toBe('Text')
    expect((await running.find({ type: 'Text', text: '00:03' }))?.type).toBe('Text')

    await $.turn.complete({ text: 'fini', turnId: 't1', reason: 'answer' } as never)

    const finished = await $.ui.mount({ plugin: 'fil', surface, component: 'AbovePrompt', props })
    expect((await finished.find({ type: 'Text', text: 'terminé' }))?.type).toBe('Text')

    await finished.press({ key: 'close' })
    expect(await finished.find({ type: 'Text', text: 'terminé' })).toBeUndefined()
  })
}
