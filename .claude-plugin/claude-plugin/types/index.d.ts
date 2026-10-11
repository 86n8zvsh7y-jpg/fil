export type Job = {
  id: string
  kind: 'tool' | 'agent'
  label: string
  /** Pour un sous-agent : son type (Explore, general-purpose...). */
  type: string | null
  /** Identifiant du sous-agent propriétaire ; null pour la boucle principale. */
  owner: string | null
  startedAt: number
  endedAt: number | null
  isFailed: boolean
}

export type Run = {
  startedAt: number
  endedAt: number | null
  reason: string | null
}

declare module 'claude-code' {
  interface PluginState {
    fil: { run: Run | null; jobs: Job[]; now: number; isHidden: boolean }
  }
}
