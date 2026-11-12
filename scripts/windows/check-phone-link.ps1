# JARVIS - collects what's needed to see why Phone Link calls won't pair. Read-only: changes nothing.
# Usage: check-phone-link.cmd  (then copy the whole output back to Claude)
$ErrorActionPreference = 'SilentlyContinue'
function H($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }

H 'Windows'
$os = Get-CimInstance Win32_OperatingSystem
"$($os.Caption) $($os.Version) build $($os.BuildNumber)"
(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion

H 'Phone Link app'
$pl = Get-AppxPackage -Name Microsoft.YourPhone
if ($pl) { "installed: $($pl.Version)  status: $($pl.Status)" } else { 'NOT installed' }
"running: " + [bool](Get-Process -Name PhoneExperienceHost, YourPhone)

H 'Bluetooth radio'
Get-PnpDevice -Class Bluetooth | Where-Object { $_.FriendlyName -match 'Intel|Wireless Bluetooth|Realtek|MediaTek|Qualcomm|Broadcom' } | ForEach-Object { "$($_.FriendlyName)  status: $($_.Status)" }
$drv = Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -match 'Wireless Bluetooth' } | Select-Object -First 1
if ($drv) { "driver: $($drv.DriverVersion)  hardware: $($drv.HardWareID)" }
$radio = Get-PnpDevice -Class Bluetooth | Where-Object { $_.FriendlyName -match 'Wireless Bluetooth' } | Select-Object -First 1
if ($radio) {
  $lmp = (Get-PnpDeviceProperty -InstanceId $radio.InstanceId -KeyName 'DEVPKEY_Bluetooth_RadioLmpVersion').Data
  "LMP version: $lmp  (6 = Bluetooth 4.0, 7 = 4.1, 8 = 4.2, 9 = 5.0)"
}

H 'Bluetooth services'
Get-Service bthserv, BthAvctpSvc, BTAGService, BluetoothUserService_* | ForEach-Object { "$($_.Name): $($_.Status) ($($_.StartType))" }

H 'Paired devices'
Get-PnpDevice -Class Bluetooth | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_' } | ForEach-Object { "$($_.FriendlyName)  $($_.Status)" } | Sort-Object -Unique

H 'Hands-free (calls) parts'
Get-PnpDevice | Where-Object { $_.FriendlyName -match 'Hands-Free|Handsfree|Audio Gateway' } | ForEach-Object { "$($_.FriendlyName)  $($_.Status)" } | Sort-Object -Unique

H 'Discoverable'
$v = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters' -Name 'Discoverable' -ErrorAction SilentlyContinue).Discoverable
"Discoverable setting: $v"

H 'Recent Bluetooth errors (last 2 days)'
Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddDays(-2); Level = 1, 2, 3 } -MaxEvents 400 |
  Where-Object { $_.ProviderName -match 'BTH|Bluetooth' } | Select-Object -First 15 |
  ForEach-Object { "$($_.TimeCreated.ToString('MM-dd HH:mm'))  $($_.ProviderName)  $($_.Id)  $(($_.Message -split "`n")[0])" }

H 'Recent Phone Link errors'
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = (Get-Date).AddDays(-2); Level = 1, 2 } -MaxEvents 300 |
  Where-Object { $_.Message -match 'YourPhone|PhoneExperienceHost|Phone Link' } | Select-Object -First 10 |
  ForEach-Object { "$($_.TimeCreated.ToString('MM-dd HH:mm'))  $($_.ProviderName)  $(($_.Message -split "`n")[0])" }

Write-Host ''
Write-Host 'Done - copy everything above and paste it to Claude.' -ForegroundColor Green
