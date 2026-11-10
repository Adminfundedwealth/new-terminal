# Hostinger Auto-Deployment Fix and Verification Script
# This script guides through enabling auto-deployment and verifies it works

param(
    [switch]$SkipManualStep = $false
)

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  HOSTINGER AUTO-DEPLOYMENT FIX & VERIFICATION" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Open Hostinger page
Write-Host "[STEP 1] Opening Hostinger Git settings page..." -ForegroundColor Yellow
Start-Process "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" -ArgumentList "https://hpanel.hostinger.com/websites/charts.fundedwealth.com/git"
Start-Sleep -Seconds 3
Write-Host "  Done - Page should be open in Brave" -ForegroundColor Green
Write-Host ""

if (-not $SkipManualStep) {
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "  ACTION REQUIRED - PLEASE COMPLETE THESE STEPS:" -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "In the Brave browser window that just opened:" -ForegroundColor Yellow
    Write-Host "  1. Find the Auto-deployment dropdown (next to repository name)"
    Write-Host "  2. Click it and select: ON or ENABLED"
    Write-Host "  3. Click the purple REDEPLOY button"
    Write-Host "  4. Wait for deployment to show Success status"
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "Press ENTER after you have completed these steps..." -ForegroundColor Yellow
    $null = Read-Host
}

Write-Host ""
Write-Host "[STEP 2] Creating test commit to verify auto-deployment..." -ForegroundColor Yellow

# Create test file
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$testFile = "DEPLOYMENT_TEST_$timestamp.txt"
$testContent = @"
Auto-deployment verification test
Created: $(Get-Date)
Commit: Test auto-deploy after enabling Hostinger webhook
Expected: This file should appear on live site within 60 seconds
"@

$testContent | Out-File -FilePath $testFile -Encoding utf8
Write-Host "  Created test file: $testFile" -ForegroundColor Green

# Commit and push
git add $testFile | Out-Null
git commit -m "test: Verify Hostinger auto-deploy webhook is working" | Out-Null
Write-Host "  Committed test file" -ForegroundColor Green

Write-Host "  Pushing to GitHub main branch..." -ForegroundColor Yellow
git push origin main 2>&1 | Out-Null
Write-Host "  Pushed to main branch" -ForegroundColor Green
Write-Host ""

# Wait and verify
Write-Host "[STEP 3] Monitoring for auto-deployment..." -ForegroundColor Yellow
Write-Host "  This will check if the test file appears on the live site"
Write-Host "  Checking every 10 seconds for up to 2 minutes..."
Write-Host ""

$maxWaitSeconds = 120
$checkInterval = 10
$elapsed = 0
$deployed = $false

while ($elapsed -lt $maxWaitSeconds) {
    Start-Sleep -Seconds $checkInterval
    $elapsed += $checkInterval
    
    $progress = [math]::Round(($elapsed / $maxWaitSeconds) * 100)
    Write-Host "  [$elapsed / $maxWaitSeconds seconds - $progress%] Checking..." -ForegroundColor Gray -NoNewline
    
    try {
        $response = Invoke-WebRequest -Uri "https://charts.fundedwealth.com/$testFile" -Method Head -ErrorAction Stop -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $deployed = $true
            Write-Host " FOUND!" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host " Not yet..." -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  VERIFICATION RESULTS" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

if ($deployed) {
    Write-Host "SUCCESS - AUTO-DEPLOYMENT IS WORKING!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Results:" -ForegroundColor Green
    Write-Host "  - Test file appeared on live site in $elapsed seconds"
    Write-Host "  - Auto-deployment is properly configured"
    Write-Host "  - Future commits to main will auto-deploy"
    Write-Host "  - Webhook is functioning correctly"
    Write-Host ""
    
    # Clean up test file
    Write-Host "[STEP 4] Cleaning up test file..." -ForegroundColor Yellow
    git rm $testFile | Out-Null
    git commit -m "chore: Remove deployment test file" | Out-Null
    git push origin main 2>&1 | Out-Null
    Write-Host "  Test file removed" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  TASK COMPLETE - AUTODEPLOY FIXED AND VERIFIED" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    
    return $true
    
} else {
    Write-Host "FAILED - AUTO-DEPLOYMENT NOT WORKING" -ForegroundColor Red
    Write-Host ""
    Write-Host "The test file did not appear after $maxWaitSeconds seconds." -ForegroundColor Red
    Write-Host ""
    Write-Host "Possible issues:" -ForegroundColor Yellow
    Write-Host "  1. Auto-deployment toggle was not enabled in Hostinger"
    Write-Host "  2. Redeploy button was not clicked"
    Write-Host "  3. Deployment is still in progress (check Hostinger panel)"
    Write-Host "  4. Webhook URL mismatch between Hostinger and GitHub"
    Write-Host "  5. Wrong branch configured in Hostinger (should be: main)"
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Go to Hostinger Git settings and verify auto-deployment is ON"
    Write-Host "  2. Check deployment history for errors"
    Write-Host "  3. Run this script again: .\fix-autodeploy-and-verify.ps1"
    Write-Host ""
    Write-Host "Test file left in repository for debugging: $testFile" -ForegroundColor Yellow
    
    return $false
}
