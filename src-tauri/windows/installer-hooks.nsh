; Hooks for the Windows installer (bundle.windows.nsis.installerHooks in tauri.conf.json)

!macro NSIS_HOOK_POSTINSTALL
  ; Windows remembers icons by file path, so after an update or reinstall the shortcuts
  ; and taskbar kept showing the old one. Tell the shell to refresh its icons.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The game (Java, Minecraft, the modpack, settings) lives in %APPDATA%\BSCraft, not in the
  ; app data folders Tauri clears. Take it along when the player ticks "Delete the application
  ; data", never while updating. (The launcher's own Uninstall in Settings can keep worlds.)
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\BSCraft"
  ${EndIf}
!macroend
