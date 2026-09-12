import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { usernameProblem } from '../lib/format'
import type { AccountStatus, ServerAccount } from '../types'

/**
 * The player's server login: whether a SimpleLogin password is saved on
 * this PC, and whether the server knows the name / accepts that password.
 */
export function useAccount(username: string) {
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null)
  const [server, setServer] = useState<ServerAccount | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const refreshLocal = useCallback(async () => {
    const s = await invoke<AccountStatus>('get_account_status')
    setPasswordSet(s.password_set)
    return s.password_set
  }, [])

  const checkServer = useCallback(async () => {
    if (usernameProblem(username)) { setServer(null); return }
    setChecking(true)
    setServerError(null)
    try {
      setServer(await invoke<ServerAccount>('check_server_account', { username }))
    } catch (e) {
      setServer(null)
      setServerError(String(e))
    } finally {
      setChecking(false)
    }
  }, [username])

  useEffect(() => { refreshLocal().catch(() => setPasswordSet(false)) }, [refreshLocal])

  // Re-check with the server when the name settles
  useEffect(() => {
    const t = window.setTimeout(() => { checkServer() }, 500)
    return () => window.clearTimeout(t)
  }, [checkServer])

  const savePassword = useCallback(async (password: string) => {
    await invoke('set_game_password', { password })
    await refreshLocal()
    await checkServer()
  }, [refreshLocal, checkServer])

  const revealPassword = useCallback(() => invoke<string | null>('reveal_game_password'), [])

  return { passwordSet, server, serverError, checking, savePassword, revealPassword, checkServer, refreshLocal }
}

export type AccountApi = ReturnType<typeof useAccount>
