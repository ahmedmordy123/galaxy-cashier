; Galaxy Cashier — NSIS hooks
; Live DB + backups live under %ProgramData%\GalaxyCashier (NOT under $INSTDIR).
; Uninstall must NEVER delete data/ or backups/.

!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro customInstall
  ; Shortcuts for new-sale deep-link
  CreateShortCut "$DESKTOP\فاتورة مبيعات جديدة.lnk" "$INSTDIR\Galaxy Cashier.exe" "--sales" "$INSTDIR\Galaxy Cashier.exe" 0
  CreateShortCut "$SMPROGRAMS\جالاكسي كاشير\فاتورة مبيعات جديدة.lnk" "$INSTDIR\Galaxy Cashier.exe" "--sales" "$INSTDIR\Galaxy Cashier.exe" 0

  ; Machine-wide live data + backups (survives reinstall / uninstall)
  CreateDirectory "$COMMONPROGRAMDATA\GalaxyCashier"
  CreateDirectory "$COMMONPROGRAMDATA\GalaxyCashier\data"
  CreateDirectory "$COMMONPROGRAMDATA\GalaxyCashier\backups"

  ; ACL: SYSTEM+Administrators Full; Users Modify (cashier accounts can R/W)
  ; Inheritance removed so policy is explicit.
  nsExec::ExecToLog 'icacls "$COMMONPROGRAMDATA\GalaxyCashier" /inheritance:r /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" /grant:r "BUILTIN\Administrators:(OI)(CI)F" /grant:r "BUILTIN\Users:(OI)(CI)M"'
  Pop $0
  DetailPrint "icacls GalaxyCashier exit=$0"

  ; Marker so the app knows Setup prepared ProgramData
  FileOpen $1 "$COMMONPROGRAMDATA\GalaxyCashier\.setup-prepared" w
  FileWrite $1 "Galaxy Cashier Setup prepared ProgramData folders$\r$\n"
  FileClose $1
!macroend

!macro customUnInstall
  Delete "$DESKTOP\فاتورة مبيعات جديدة.lnk"
  RMDir /r "$SMPROGRAMS\جالاكسي كاشير"

  ; Explicitly DO NOT remove:
  ;   $COMMONPROGRAMDATA\GalaxyCashier\data
  ;   $COMMONPROGRAMDATA\GalaxyCashier\backups
  DetailPrint "Preserving $COMMONPROGRAMDATA\GalaxyCashier\data and backups"
!macroend
