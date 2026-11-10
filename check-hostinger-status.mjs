#!/usr/bin/env node
/**
 * Check Hostinger Auto-Deploy Status via Web Fetch
 * This script attempts to verify if auto-deployment is enabled
 */

import https from 'https';

console.log('🔍 Checking Hostinger deployment status...\n');

// Try to fetch the Git settings page (will likely be blocked by Cloudflare)
const options = {
  hostname: 'hpanel.hostinger.com',
  path: '/websites/charts.fundedwealth.com/git',
  method: 'GET',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
};

const req = https.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 403) {
      console.log('\n❌ Cloudflare blocked the request (expected)');
      console.log('✅ Manual verification required - page should be open in Brave');
    } else {
      console.log('\nResponse length:', data.length);
      if (data.includes('auto-deploy') || data.includes('Auto-deployment')) {
        console.log('✅ Found auto-deployment settings in page');
      }
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.end();

// Also check if live site has latest commit
console.log('\n📍 Checking live site for current deployment...');
const liveOptions = {
  hostname: 'charts.fundedwealth.com',
  path: '/',
  method: 'GET',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
};

const liveReq = https.request(liveOptions, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Live site status: ${res.statusCode}`);
    console.log(`Content length: ${data.length} bytes`);
    
    // Check for indicators of recent deployment
    const hasRecentCode = data.includes('Option Chain') || data.includes('Futures');
    console.log(`Contains expected content: ${hasRecentCode ? '✅' : '❌'}`);
  });
});

liveReq.on('error', (e) => {
  console.error('Live site error:', e.message);
});

liveReq.end();
