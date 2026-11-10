#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Fix Hostinger auto-deployment and verify it's working
    
.DESCRIPTION
    This script provides instructions and verification for fixing Hostinger auto-deployment.
    It cannot directly access Hostinger panel (requires authentication), but provides
    step-by-step guidance and automated verification after manual fix.
    
.NOTES
    Manual Step Required: Enable auto-deployment in Hostinger hPanel
    URL: https://hpanel.hostinger.com/websites/charts.fundedwealth.com/git
#>

Write-Host "🔍 Hostinger Auto-Deploy Fix Procedure" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host ""

# Step 1: Check current git status
Write-Host "📊 Current Repository Status:" -ForegroundColor Yellow
Write-Host ""
git log --oneline -3
Write-Host ""
$currentBranch = git branch --show-current
Write-Host "Current Branch: $currentBranch" -ForegroundColor Green
Write-Host ""

# Step 2: Provide manual instructions
Write-Host "⚠️  MANUAL ACTION REQUIRED:" -ForegroundColor Red
Write-Host ""
Write-Host "1. Open Brave browser (should already be open with Hostinger)" -ForegroundColor White
Write-Host "2. Navigate to: https://hpanel.hostinger.com/websites/charts.fundedwealth.com/git" -ForegroundColor White
Write-Host "3. Find repository: Adminfundedwealth/new-terminal" -ForegroundColor White
Write-Host "4. Click 'Auto-deployment' dropdown" -ForegroundColor White
Write-Host "5. Select: ENABLE / ON" -ForegroundColor White
Write-Host "6. Click 'Redeploy' button" -ForegroundColor White
Write-Host ""
Write-Host "Press any key after you've completed these steps..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
Write-Host ""

# Step 3: Create test commit
Write-Host "🧪 Creating test commit to verify auto-deployment..." -ForegroundColor Yellow
Write-Host ""

$testFile = "DEPLOYMENT_TEST_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
$testContent = @"
Auto-Deployment Test
====================
Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Purpose: Verify Hostinger webhook auto-deploy is working
Expected: This file should appear on charts.fundedwealth.com within 2 minutes

If you see this file on the live site, auto-deployment is WORKING! ✅
"@

$testContent | Out-File -FilePath $testFile -Encoding utf8

Write-Host "✅ Created test file: $testFile" -ForegroundColor Green
Write-Host ""

# Commit and push
Write-Host "📤 Committing and pushing test file..." -ForegroundColor Yellow
git add $testFile
git commit -m "test: Verify Hostinger auto-deploy webhook is working"

Write-Host ""
Write-Host "Pushing to origin/main..." -ForegroundColor Yellow
git push origin main

Write-Host ""
Write-Host "✅ Test commit pushed to GitHub" -ForegroundColor Green
Write-Host ""

# Step 4: Provide verification instructions
Write-Host "⏳ VERIFICATION STEPS:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Go to Hostinger deployments: https://hpanel.hostinger.com/websites/charts.fundedwealth.com/git" -ForegroundColor White
Write-Host "   - Look for new deployment in 'All deployments' section" -ForegroundColor White
Write-Host "   - Should appear within 30-60 seconds" -ForegroundColor White
Write-Host "   - Commit message: 'test: Verify Hostinger auto-deploy webhook is working'" -ForegroundColor White
Write-Host ""
Write-Host "2. Wait 2 minutes for deployment to complete" -ForegroundColor White
Write-Host ""
Write-Host "3. Check live site: https://charts.fundedwealth.com/$testFile" -ForegroundColor White
Write-Host "   - If file exists, auto-deployment is WORKING ✅" -ForegroundColor White
Write-Host "   - If 404 error, auto-deployment is STILL BROKEN ❌" -ForegroundColor White
Write-Host ""

# Wait timer
Write-Host "⏰ Waiting 2 minutes for deployment..." -ForegroundColor Yellow
for ($i = 120; $i -gt 0; $i--) {
    Write-Progress -Activity "Waiting for Hostinger deployment" -Status "$i seconds remaining" -PercentComplete ((120 - $i) / 120 * 100)
    Start-Sleep -Seconds 1
}
Write-Progress -Activity "Waiting for Hostinger deployment" -Completed

Write-Host ""
Write-Host "🔍 Checking if test file is live..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "https://charts.fundedwealth.com/$testFile" -UseBasicParsing -ErrorAction Stop
    
    if ($response.StatusCode -eq 200) {
        Write-Host ""
        Write-Host "✅ SUCCESS! Auto-deployment is WORKING!" -ForegroundColor Green
        Write-Host "✅ Test file found on live site" -ForegroundColor Green
        Write-Host "✅ Hostinger webhook is now properly configured" -ForegroundColor Green
        Write-Host ""
        Write-Host "🎉 Future commits to main branch will auto-deploy!" -ForegroundColor Cyan
        Write-Host ""
        
        # Clean up test file
        Write-Host "🧹 Cleaning up test file..." -ForegroundColor Yellow
        Remove-Item $testFile -Force
        git add $testFile
        git commit -m "chore: Remove deployment test file"
        git push origin main
        Write-Host "✅ Test file removed from repository" -ForegroundColor Green
        
        exit 0
    }
}
catch {
    Write-Host ""
    Write-Host "❌ FAILED: Test file NOT found on live site" -ForegroundColor Red
    Write-Host "❌ Auto-deployment is still NOT working" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Verify auto-deployment toggle is ON in Hostinger" -ForegroundColor White
    Write-Host "2. Check Hostinger deployment history for errors" -ForegroundColor White
    Write-Host "3. Verify branch is set to: main" -ForegroundColor White
    Write-Host "4. Check if webhook is configured in GitHub:" -ForegroundColor White
    Write-Host "   https://github.com/Adminfundedwealth/new-terminal/settings/hooks" -ForegroundColor White
    Write-Host ""
    
    exit 1
}
