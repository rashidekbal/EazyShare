; eazyShare custom NSIS installer script
; Runs firewall cleanup on uninstall

!macro customUnInstall
  ; Remove firewall rules when user uninstalls
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="eazyShare-HTTP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="eazyShare-WS"'
!macroend
