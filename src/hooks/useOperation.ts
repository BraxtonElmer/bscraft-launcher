import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { stageTitle } from '../lib/format'
import type {
  ActiveOperation,
  DownloadProgress,
  InstallProgress,
  OperationKind,
  SyncProgress,
  UpdateProgress,
  VerifyProgress,
} from '../types'

const BLANK: Omit<ActiveOperation, 'kind' | 'title'> = {
  detail: '',
  file: '',
  filePercent: 0,
  stepPercent: 0,
  speedBps: 0,
  filesDone: 0,
  filesTotal: 0,
  bytesDone: 0,
  bytesTotal: 0,
  step: 0,
  stepCount: 0,
  indeterminate: true,
}

/** Overall % each install step reports at the start of its phases (see commands/install.rs) */
const INSTALL_MILESTONES: Record<string, number[]> = {
  jre: [5, 90, 100],
  minecraft: [2, 5, 10, 40, 70, 100],
  forge: [5, 60, 100],
}

export interface OperationApi {
  operation: ActiveOperation | null
  begin: (kind: OperationKind, title: string, extra?: Partial<ActiveOperation>) => void
  patch: (patch: Partial<ActiveOperation>) => void
  end: () => void
}

/**
 * The single long-running task (install, sync, verify…) and its live progress.
 * Backend progress events only update an operation that has been started, so a
 * late event can't resurrect a finished one.
 */
export function useOperation(): OperationApi {
  const [operation, setOperation] = useState<ActiveOperation | null>(null)

  const begin = useCallback((kind: OperationKind, title: string, extra?: Partial<ActiveOperation>) => {
    setOperation({ ...BLANK, kind, title, ...extra })
  }, [])

  const patch = useCallback((p: Partial<ActiveOperation>) => {
    setOperation(prev => (prev ? { ...prev, ...p } : prev))
  }, [])

  const end = useCallback(() => setOperation(null), [])

  // Install steps report milestones (e.g. "Downloading libraries…" at 40%) and, in between,
  // the current phase's own 0–100% (a file download, libraries, assets). Phases are fitted
  // into the gap before the next milestone, and the bar never moves backwards within a step.
  const phase = useRef({ from: 0, to: 100 })
  const withinPhase = (percent: number) =>
    phase.current.from + ((phase.current.to - phase.current.from) * Math.min(100, Math.max(0, percent))) / 100
  const patchInstall = useCallback((p: Partial<ActiveOperation> & { stepPercent: number }) => {
    setOperation(prev => (prev ? { ...prev, ...p, stepPercent: Math.max(prev.stepPercent, p.stepPercent) } : prev))
  }, [])

  useEffect(() => {
    const subs = [
      listen<DownloadProgress>('download-progress', ({ payload: p }) => patchInstall({
        title: stageTitle(p.stage),
        detail: p.detail,
        file: p.file,
        filePercent: p.percent,
        stepPercent: withinPhase(p.percent),
        speedBps: p.speed_bps,
        bytesDone: p.downloaded,
        bytesTotal: p.total,
        filesDone: 0,
        filesTotal: 0,
        indeterminate: false,
      })),
      listen<InstallProgress>('install-progress', ({ payload: p }) => {
        const marks = INSTALL_MILESTONES[p.stage]
        if (marks) phase.current = { from: p.percent, to: marks.find(m => m > p.percent) ?? 100 }
        patchInstall({
          title: stageTitle(p.stage),
          detail: p.detail,
          file: '',
          stepPercent: marks ? p.percent : withinPhase(p.percent),
          speedBps: 0,
          bytesDone: 0,
          bytesTotal: 0,
          filesDone: p.files_done,
          filesTotal: p.files_total,
          indeterminate: false,
        })
      }),
      listen<SyncProgress>('sync-progress', ({ payload: p }) => patch({
        title: stageTitle(p.stage),
        detail: p.stage === 'downloading' ? 'Downloading' : p.stage === 'repairing' ? 'Repairing' : 'Checking files',
        file: p.file,
        stepPercent: p.overall_percent,
        speedBps: 0,
        bytesDone: 0,
        bytesTotal: 0,
        filesDone: p.files_done,
        filesTotal: p.files_total,
        indeterminate: false,
      })),
      listen<VerifyProgress>('verify-progress', ({ payload: p }) => patch({
        title: 'Verifying Files',
        // The file counts are shown separately, so don't repeat them in the detail line
        detail: p.files_total ? 'Checking modpack files' : p.detail,
        file: '',
        stepPercent: p.percent,
        filesDone: p.files_done ?? 0,
        filesTotal: p.files_total ?? 0,
        indeterminate: false,
      })),
      listen<UpdateProgress>('launcher-update-progress', ({ payload: p }) => patch({
        title: 'Updating Launcher',
        detail: 'Downloading update',
        stepPercent: p.percent,
        bytesDone: p.downloaded,
        bytesTotal: p.total ?? 0,
        indeterminate: p.total == null,
      })),
    ]
    return () => { subs.forEach(s => s.then(fn => fn())) }
  }, [patch, patchInstall])

  return { operation, begin, patch, end }
}
