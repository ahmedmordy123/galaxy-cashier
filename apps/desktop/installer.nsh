; Galaxy Cashier — NSIS hooks
; Live DB + backups under %PROGRAMDATA%\GalaxyCashier (NOT under $INSTDIR).
; Uninstall must NEVER delete data/ or backups/.
;
; NOTE: Do not write "$COMMONAPPDATA\Subdir" — this makensis treats "\" as part of
; the variable name (warning 6000). Always ReadEnvStr PROGRAMDATA into a register first.

!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro customInstall
  ; Shortcuts for new-sale deep-link
  CreateShortCut "$DESKTOP\فاتورة مبيعات جديدة.lnk" "$INSTDIR\Galaxy Cashier.exe" "--sales" "$INSTDIR\Galaxy Cashier.exe" 0
  CreateShortCut "$SMPROGRAMS\جالاكسي كاشير\فاتورة مبيعات جديدة.lnk" "$INSTDIR\Galaxy Cashier.exe" "--sales" "$INSTDIR\Galaxy Cashier.exe" 0

  ; Resolve ProgramData without broken $COMMONAPPDATA\... concatenation
  ReadEnvStr $R9 PROGRAMDATA
  ${If} $R9 == ""
    StrCpy $R9 "C:\ProgramData"
  ${EndIf}
  StrCpy $R8 "$R9\GalaxyCashier"
  StrCpy $R7 "$R8\data"
  StrCpy $R6 "$R8\backups"

  ; Machine-wide live data + backups (survives reinstall / uninstall)
  CreateDirectory "$R8"
  CreateDirectory "$R7"
  CreateDirectory "$R6"

  ; ACL inside the installer (not deferred to first app launch):
  ; SYSTEM + Administrators = Full; BUILTIN\Users = Modify
  ; (OI)(CI) so new files (-wal/-shm/backups) inherit write for any cashier account.
  ; /T propagates to existing children.
  nsExec::ExecToLog 'icacls "$R8" /inheritance:r /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" /grant:r "BUILTIN\Administrators:(OI)(CI)F" /grant:r "BUILTIN\Users:(OI)(CI)M" /T'
  Pop $0
  DetailPrint "icacls GalaxyCashier (root+/T) exit=$0"
  nsExec::ExecToLog 'icacls "$R7" /inheritance:e /grant:r "BUILTIN\Users:(OI)(CI)M"'
  Pop $0
  DetailPrint "icacls data exit=$0"
  nsExec::ExecToLog 'icacls "$R6" /inheritance:e /grant:r "BUILTIN\Users:(OI)(CI)M"'
  Pop $0
  DetailPrint "icacls backups exit=$0"

  ; Marker so the app knows Setup prepared ProgramData (+ ACL)
  FileOpen $1 "$R8\.setup-prepared" w
  FileWrite $1 "Galaxy Cashier Setup prepared ProgramData folders + ACL$\r$\n"
  FileClose $1
!macroend

!macro customUnInstall
  Delete "$DESKTOP\فاتورة مبيعات جديدة.lnk"
  RMDir /r "$SMPROGRAMS\جالاكسي كاشير"

  ; Explicitly DO NOT remove ProgramData GalaxyCashier data or backups.
  DetailPrint "Preserving ProgramData GalaxyCashier data and backups"
!macroend
