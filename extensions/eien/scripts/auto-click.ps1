param(
  [string[]]$ButtonNames = @("Allow", "Allow Always", "Approve", "Accept", "Continue")
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$accepted = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($name in $ButtonNames) { [void]$accepted.Add($name) }

try {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )

  foreach ($window in $windows) {
    $processId = $window.Current.ProcessId
    if ($processId -le 0) { continue }
    $processName = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
    if ($processName -notin @("Code", "Code - Insiders")) { continue }

    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    )
    $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    foreach ($button in $buttons) {
      $name = $button.Current.Name
      if (-not $accepted.Contains($name) -or -not $button.Current.IsEnabled) { continue }
      $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invoke.Invoke()
      Write-Output ([pscustomobject]@{ clicked = $true; button = $name } | ConvertTo-Json -Compress)
      exit 0
    }
  }

  Write-Output '{"clicked":false,"reason":"button-not-found"}'
  exit 1
} catch {
  Write-Output ([pscustomobject]@{ clicked = $false; reason = $_.Exception.Message } | ConvertTo-Json -Compress)
  exit 2
}
