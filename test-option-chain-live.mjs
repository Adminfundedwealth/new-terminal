/**
 * Live Production Test for Option Chain Navigation
 * Tests Chart/Buy/Sell actions from Option Chain
 */

import { chromium } from 'playwright';

(async () => {
  console.log('🚀 Starting Option Chain Navigation Test on Production...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000 // Slow down for visibility
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    // 1. Navigate to production site
    console.log('📡 Navigating to https://charts.fundedwealth.com...');
    await page.goto('https://charts.fundedwealth.com', { waitUntil: 'networkidle' });
    
    const title = await page.title();
    console.log(`✅ Page loaded: ${title}\n`);
    
    // 2. Navigate to Option Chain
    console.log('📊 Navigating to Option Chain...');
    await page.click('a[href="/option-chain"]');
    await page.waitForTimeout(3000);
    
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    // 3. Check if Option Chain loaded
    const optionChainVisible = await page.locator('text=NIFTY').first().isVisible();
    console.log(`Option Chain visible: ${optionChainVisible}\n`);
    
    // 4. Take screenshot of Option Chain
    await page.screenshot({ path: 'option-chain-before-deployment.png', fullPage: true });
    console.log('📸 Screenshot saved: option-chain-before-deployment.png\n');
    
    // 5. Check for action buttons in strike column
    console.log('🔍 Checking for Chart/Buy/Sell buttons...');
    
    const chartButtons = await page.locator('button:has-text("📊")').count();
    const buyButtons = await page.locator('button:has-text("🔼")').count();
    const sellButtons = await page.locator('button:has-text("🔽")').count();
    
    console.log(`Chart buttons found: ${chartButtons}`);
    console.log(`Buy buttons found: ${buyButtons}`);
    console.log(`Sell buttons found: ${sellButtons}\n`);
    
    if (chartButtons > 0 && buyButtons > 0 && sellButtons > 0) {
      console.log('✅ NEW IMPLEMENTATION DETECTED - Action buttons are present!');
      
      // Test clicking a Chart button
      console.log('\n🧪 Testing Chart navigation...');
      const firstChartBtn = page.locator('button:has-text("📊")').first();
      await firstChartBtn.click();
      await page.waitForTimeout(2000);
      
      const afterChartUrl = page.url();
      console.log(`After Chart click: ${afterChartUrl}`);
      
      if (afterChartUrl.includes('/charts')) {
        console.log('✅ Chart navigation WORKS - redirected to Charts tab');
      } else {
        console.log('❌ Chart navigation FAILED - did not redirect to Charts');
      }
      
      // Go back
      await page.goBack();
      await page.waitForTimeout(2000);
      
      // Test clicking a Buy button
      console.log('\n🧪 Testing Buy navigation...');
      const firstBuyBtn = page.locator('button:has-text("🔼")').first();
      await firstBuyBtn.click();
      await page.waitForTimeout(2000);
      
      const afterBuyUrl = page.url();
      console.log(`After Buy click: ${afterBuyUrl}`);
      
      if (afterBuyUrl.includes('/orders') || afterBuyUrl.includes('action=BUY')) {
        console.log('✅ Buy navigation WORKS - opened Buy ticket');
      } else if (afterBuyUrl.includes('/strategy-builder')) {
        console.log('⚠️  Buy navigation redirected to Strategy Builder (OLD BEHAVIOR)');
      } else {
        console.log(`❌ Buy navigation unexpected: ${afterBuyUrl}`);
      }
      
    } else {
      console.log('⚠️  OLD IMPLEMENTATION - Action buttons NOT found');
      console.log('📋 This means the new deployment has not been applied yet.\n');
    }
    
    // 6. Summary
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Site: ${currentUrl}`);
    console.log(`Chart buttons: ${chartButtons > 0 ? '✅ Found' : '❌ Not found'}`);
    console.log(`Buy buttons: ${buyButtons > 0 ? '✅ Found' : '❌ Not found'}`);
    console.log(`Sell buttons: ${sellButtons > 0 ? '✅ Found' : '❌ Not found'}`);
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'error-screenshot.png' });
  } finally {
    await browser.close();
    console.log('\n✅ Browser closed. Test complete.');
  }
})();
