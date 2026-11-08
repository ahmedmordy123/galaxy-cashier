; Extra desktop + Start Menu shortcuts for "new sale" deep-link
!macro customInstall
  CreateShortCut "$DESKTOP\فاتورة مبيعات جديدة.lnk" "$INSTDIR\Galaxy Cashier.exe" "--sales" "$INSTDIR\Galaxy Cashier.exe" 0
  CreateShortCut "$SMPROGRAMS\جالاكسي كاشير\فاتورة مبيعات جديدة.lnk" "$INSTDIR\Galaxy Cashier.exe" "--sales" "$INSTDIR\Galaxy Cashier.exe" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\فاتورة مبيعات جديدة.lnk"
  Delete "$SMPROGRAMS\جالاكسي كاشير\فاتورة مبيعات جديدة.lnk"
!macroend
