import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Job, Run } from '../types'

const run = atom({ plugin: 'fil', key: 'run' } as const, null)
const jobs = atom({ plugin: 'fil', key: 'jobs' } as const, [])
const now = atom({ plugin: 'fil', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'fil', key: 'isHidden' } as const, false)

const pad = (n: number) => String(n).padStart(2, '0')

export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export const labelOf = (tool: string, args: Record<string, unknown>): string => {
  const raw = args.description ?? args.command ?? args.file_path ?? args.pattern ?? args.url ?? args.query ?? ''
  const text = String(raw).replace(/\s+/g, ' ').trim()

  return text === '' ? tool : `${tool} · ${text.slice(0, 40)}`
}

export const bar = (ratio: number, width: number): string => {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

let timer: Timer | undefined

const stop = () => {
  timer?.cancel()
  timer = undefined
}

// Lit la liste des sous-agents du moteur et tient `jobs` à jour.
const sync = async ($: EngineInterface) => {
  const t = await $.clock.now()
  const agents = await $.agent.list()

  await update($, jobs, list => {
    const out: Job[] = [...list]

    for (const a of agents) {
      const isActive = a.status === 'pending' || a.status === 'running' || a.status === 'waiting'
      const isFailed = a.status === 'failed' || a.status === 'killed'
      const i = out.findIndex(j => j.id === a.id)

      if (i === -1) {
        if (isActive) {
          out.push({
            id: a.id,
            kind: 'agent',
            label: a.description || a.name || a.type,
            type: a.type,
            owner: a.parentId ?? null,
            startedAt: t,
            endedAt: null,
            isFailed: false,
          })
        }
      } else if (!isActive && out[i]!.endedAt === null) {
        out[i] = { ...out[i]!, endedAt: t, isFailed }
      }
    }

    return out
  })
  await update($, now, () => t)

  const current = await read($, run)
  const hasOpenJob = (await read($, jobs)).some(j => j.endedAt === null)

  if (current !== null && current.endedAt !== null && !hasOpenJob) {
    stop()
  }
}

const start = ($: EngineInterface) => {
  if (timer === undefined) {
    timer = $.clock.every(1000, () => sync($))
  }
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    const t = await $.clock.now()
    const fresh: Run = { startedAt: t, endedAt: null, reason: null }

    await update($, run, () => fresh)
    // Une nouvelle tâche repart de zéro ; seuls les sous-agents encore actifs restent.
    await update($, jobs, list => list.filter(j => j.kind === 'agent' && j.endedAt === null))
    await update($, isHidden, () => false)
    await update($, now, () => t)
    start($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent') {
      return next(e)
    }

    const t = await $.clock.now()
    const id = e.tool_use_id
    const args = e as unknown as Record<string, unknown>
    const job: Job = {
      id,
      kind: 'tool',
      label: labelOf(e.tool, args),
      type: null,
      owner: e.agentId ?? null,
      startedAt: t,
      endedAt: null,
      isFailed: false,
    }

    if ((await read($, run)) === null) {
      await update($, run, () => ({ startedAt: t, endedAt: null, reason: null }))
    }

    await update($, jobs, list => [...list, job].slice(-200))
    start($)

    const result = await next(e)
    const end = await $.clock.now()
    const isFailed = result.deny !== undefined || (result as { isError?: boolean }).isError === true

    await update($, jobs, list => list.map(j => (j.id === id ? { ...j, endedAt: end, isFailed } : j)))
    await update($, now, () => end)

    return result
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    start($)
    await sync($)

    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const fields = e as unknown as { agentId?: string; reason?: string }

    if (fields.agentId === undefined) {
      const t = await $.clock.now()

      await update($, run, r => (r === null ? r : { ...r, endedAt: t, reason: fields.reason ?? 'answer' }))
      await update($, jobs, list => list.map(j => (j.kind === 'tool' && j.endedAt === null ? { ...j, endedAt: t } : j)))
      await update($, now, () => t)
      await sync($)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, run)

    if (e.props.hasSurvey || r === null || (await read($, isHidden))) {
      return next(e)
    }

    const list = await read($, jobs)
    const t = Math.max(await read($, now), r.startedAt)
    const isRunning = r.endedAt === null
    const end = r.endedAt ?? t

    const total = list.length
    const done = list.filter(j => j.endedAt !== null).length
    const ratio = isRunning ? (total === 0 ? 0 : Math.min(done / total, 0.95)) : 1

    const tone = isRunning ? 'claude' : r.reason === 'answer' ? 'success' : r.reason === 'aborted' ? 'warning' : 'error'
    const status = isRunning ? 'en cours' : r.reason === 'answer' ? 'terminé' : r.reason === 'aborted' ? 'interrompu' : 'erreur'
    const width = Math.max(10, Math.min(32, e.props.bodyColumns - 48))

    const { Box, Text, Button } = $.ui.resolve(e)

    const mainSteps = list.filter(j => j.kind === 'tool' && j.owner === null && j.endedAt === null).slice(-3)
    const agents = list.filter(j => j.kind === 'agent')

    const rows = []

    for (const step of mainSteps) {
      rows.push(
        <Box flexDirection="row" gap={1}>
          <Text color="claude">▸</Text>
          <Text wrap="truncate-end">{step.label}</Text>
          <Text dimColor>{formatDuration(t - step.startedAt)}</Text>
        </Box>,
      )
    }

    if (isRunning && mainSteps.length === 0 && agents.every(a => a.endedAt !== null)) {
      rows.push(
        <Text dimColor>▸ réflexion…</Text>,
      )
    }

    for (const agent of agents) {
      const children = list.filter(j => j.kind === 'tool' && j.owner === agent.id)
      const childrenDone = children.filter(j => j.endedAt !== null).length
      const current = children.filter(j => j.endedAt === null).slice(-1)[0]
      const isOpen = agent.endedAt === null
      const icon = isOpen ? '◆' : agent.isFailed ? '✖' : '✔'
      const color = isOpen ? 'claude' : agent.isFailed ? 'error' : 'success'
      const detail = `${formatDuration((agent.endedAt ?? t) - agent.startedAt)} · ${childrenDone}/${children.length} étapes`

      rows.push(
        <Box flexDirection="row" gap={1}>
          <Text color={color}>{icon}</Text>
          <Text wrap="truncate-end">
            {agent.type ?? 'agent'} · {agent.label}
          </Text>
          <Text dimColor>{detail}</Text>
          {current === undefined ? null : (
            <Text dimColor wrap="truncate-end">
              {current.label}
            </Text>
          )}
        </Box>,
      )
    }

    const budget = Math.max(0, e.props.maxRows - 1)
    const shown = rows.slice(0, budget)
    const hidden = rows.length - shown.length

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold color={tone}>
            fil
          </Text>
          <Text color={tone}>{formatDuration(end - r.startedAt)}</Text>
          <Text color={tone}>{bar(ratio, width)}</Text>
          <Text dimColor>
            {done}/{total} · {status}
          </Text>
          <Button key="close" label="Fermer" onPress={() => update($, isHidden, () => true)} />
        </Box>
        {shown}
        {hidden > 0 ? <Text dimColor>+{hidden} autres</Text> : null}
      </Box>
    )
  })
}
