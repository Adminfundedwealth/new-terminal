#!/usr/bin/env node
/**
 * Check GitHub Webhooks for Hostinger Auto-Deployment
 * Uses GitHub API to investigate webhook configuration
 */

import https from 'https';

const REPO_OWNER = 'Adminfundedwealth';
const REPO_NAME = 'new-terminal';

// Check if GITHUB_TOKEN is available in environment
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

console.log('🔍 GitHub Webhook Investigation');
console.log('================================\n');
console.log(`Repository: ${REPO_OWNER}/${REPO_NAME}\n`);

// Function to make GitHub API request
function githubApiRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: path,
            method: 'GET',
            headers: {
                'User-Agent': 'Node.js Webhook Checker',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        if (GITHUB_TOKEN) {
            options.headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
            console.log('✅ Using authenticated API request (GITHUB_TOKEN found)\n');
        } else {
            console.log('⚠️  No GITHUB_TOKEN found - using unauthenticated request (rate limited)\n');
        }

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else if (res.statusCode === 403) {
                    reject(new Error('Authentication required - webhook settings need repo admin access'));
                } else if (res.statusCode === 404) {
                    reject(new Error('Repository not found or no access'));
                } else {
                    reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.end();
    });
}

// Main investigation
(async () => {
    try {
        console.log('📡 Fetching webhooks from GitHub...\n');
        
        const webhooks = await githubApiRequest(`/repos/${REPO_OWNER}/${REPO_NAME}/hooks`);
        
        console.log(`Found ${webhooks.length} webhook(s)\n`);
        console.log('================================\n');
        
        if (webhooks.length === 0) {
            console.log('❌ NO WEBHOOKS CONFIGURED');
            console.log('\nThis explains why auto-deployment is not working!');
            console.log('\nROOT CAUSE IDENTIFIED:');
            console.log('  - No webhook configured in GitHub');
            console.log('  - Hostinger cannot receive push notifications');
            console.log('  - Commits to main branch do not trigger deployment');
            console.log('\nSOLUTION:');
            console.log('  1. Get webhook URL from Hostinger Git settings');
            console.log('  2. Add webhook to GitHub repository settings');
            console.log('  3. Configure: Content type = application/json, Event = push');
            process.exit(1);
        }
        
        // Analyze each webhook
        for (let i = 0; i < webhooks.length; i++) {
            const hook = webhooks[i];
            console.log(`Webhook #${i + 1}:`);
            console.log(`  ID: ${hook.id}`);
            console.log(`  URL: ${hook.config.url}`);
            console.log(`  Active: ${hook.active ? '✅ YES' : '❌ NO'}`);
            console.log(`  Events: ${hook.events.join(', ')}`);
            console.log(`  Content Type: ${hook.config.content_type || 'not set'}`);
            console.log(`  Last Response: ${hook.last_response ? hook.last_response.status : 'No deliveries yet'}`);
            
            // Check if this is a Hostinger webhook
            if (hook.config.url && (hook.config.url.includes('hostinger') || hook.config.url.includes('hpanel'))) {
                console.log(`  🎯 TYPE: Hostinger deployment webhook`);
                
                if (!hook.active) {
                    console.log(`\n❌ ISSUE FOUND: Webhook is INACTIVE`);
                    console.log(`   This webhook exists but is disabled!`);
                }
                
                if (hook.last_response) {
                    const statusCode = hook.last_response.code;
                    const statusMessage = hook.last_response.message;
                    
                    console.log(`\n  Last Delivery Status:`);
                    console.log(`    Code: ${statusCode}`);
                    console.log(`    Message: ${statusMessage}`);
                    
                    if (statusCode === 200) {
                        console.log(`    ✅ Last delivery was successful`);
                    } else if (statusCode === 404) {
                        console.log(`    ❌ ISSUE: Webhook URL not found (404)`);
                        console.log(`    The webhook URL may have changed in Hostinger`);
                    } else if (statusCode >= 500) {
                        console.log(`    ❌ ISSUE: Hostinger server error (${statusCode})`);
                        console.log(`    Problem on Hostinger side`);
                    }
                }
            } else {
                console.log(`  TYPE: Other webhook (not Hostinger)`);
            }
            
            console.log('');
        }
        
        // Summary
        console.log('================================');
        console.log('SUMMARY & RECOMMENDATIONS');
        console.log('================================\n');
        
        const hostingerWebhooks = webhooks.filter(h => 
            h.config.url && (h.config.url.includes('hostinger') || h.config.url.includes('hpanel'))
        );
        
        if (hostingerWebhooks.length === 0) {
            console.log('❌ No Hostinger webhook found');
            console.log('\nAction required:');
            console.log('  1. Get webhook URL from Hostinger Git settings page');
            console.log('  2. Add it to GitHub webhooks programmatically or manually');
        } else {
            const activeHostingerWebhooks = hostingerWebhooks.filter(h => h.active);
            
            if (activeHostingerWebhooks.length > 0) {
                console.log('✅ Active Hostinger webhook(s) found');
                console.log('\nIf auto-deployment still not working, the issue is likely:');
                console.log('  - Auto-deployment toggle is OFF in Hostinger');
                console.log('  - Wrong branch configured in Hostinger');
                console.log('  - Recent webhook deliveries are failing (check above)');
            } else {
                console.log('⚠️  Hostinger webhook exists but is INACTIVE');
                console.log('\nAction required:');
                console.log('  1. Reactivate webhook in GitHub settings');
                console.log('  2. Or delete and recreate with correct URL from Hostinger');
            }
        }
        
    } catch (error) {
        console.log('❌ ERROR:', error.message);
        console.log('\nThis usually means:');
        console.log('  - GITHUB_TOKEN not set or invalid');
        console.log('  - No repository admin access');
        console.log('  - Rate limit exceeded (unauthenticated requests)');
        console.log('\nTo fix:');
        console.log('  1. Set GITHUB_TOKEN environment variable with repo admin token');
        console.log('  2. Or manually check: https://github.com/Adminfundedwealth/new-terminal/settings/hooks');
        process.exit(1);
    }
})();
