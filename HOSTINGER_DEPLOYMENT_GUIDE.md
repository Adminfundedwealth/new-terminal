# Hostinger Deployment Guide - FundedWealth Terminal

## Quick Deployment Steps

### 1. Build the Application Locally

The application has already been built successfully. The production files are in the `dist/` folder.

```bash
# The build was completed successfully:
# ✓ 2467 modules transformed
# ✓ built in 1m 14s
```

### 2. Access Hostinger hPanel

1. Go to: https://hpanel.hostinger.com
2. Log in with your Hostinger credentials
3. Select the website: **charts.fundedwealth.com**

### 3. Deploy the Built Files

#### Option A: Using File Manager (Recommended)

1. In hPanel, go to **Files** → **File Manager**
2. Navigate to the public_html directory (or your site's root directory)
3. **Backup existing files first** (download or create a backup)
4. Delete old files (keep .htaccess if it exists)
5. Upload all files from the local `dist/` folder:
   - Upload `index.html`
   - Upload the `assets/` folder (contains all CSS/JS bundles)
   - Ensure all files are in the root, not in a subfolder

#### Option B: Using FTP/SFTP

1. Get FTP credentials from hPanel → **Files** → **FTP Accounts**
2. Connect using FileZilla or any FTP client:
   - Host: ftp.charts.fundedwealth.com (or IP from hPanel)
   - Username: [from hPanel]
   - Password: [from hPanel]
   - Port: 21 (FTP) or 22 (SFTP)
3. Navigate to public_html
4. Upload all files from `dist/` folder

#### Option C: Using Git Deployment (if configured)

1. In hPanel, check if Git deployment is enabled
2. If yes, simply push to the connected repository
3. Hostinger will auto-deploy from the configured branch

### 4. Verify Deployment

After uploading, verify the site:

1. Clear browser cache (Ctrl+Shift+Delete)
2. Visit: https://charts.fundedwealth.com
3. Check browser console for errors (F12)
4. Verify the commit hash or version number appears

### 5. Test the Approved Stocks Implementation

Once deployed, test these pages:

#### Test Stocks Page
- URL: https://charts.fundedwealth.com/stocks
- **Expected:** Shows exactly 200 approved NSE stocks
- **Verify:** Search works, no random stocks

#### Test Futures Page
- URL: https://charts.fundedwealth.com/futures
- **Expected:** Only futures for approved underlyings
- **Verify:** All contracts valid, correct expiry dates

#### Test Option Chain
- URL: https://charts.fundedwealth.com/option-chain
- **Expected:** Underlying dropdown shows approved symbols only
- **Verify:** Options load correctly with Dhan data

---

## Current Deployment Status

### Local Build Status: ✅ COMPLETE
- TypeScript: ✅ No errors
- Linting: ✅ Passed
- Tests: ✅ Passed
- Production Build: ✅ Complete (1m 14s)
- Files Ready: ✅ `dist/` folder contains all assets

### Git Repository: ✅ UP TO DATE
- Latest Commit: c585749
- Branch: main
- Files Pushed: ✅ All changes committed and pushed

### Hostinger Deployment: ⏳ MANUAL ACTION REQUIRED
- Build files ready in `dist/` folder
- Need to upload to Hostinger via hPanel or FTP
- Site: https://charts.fundedwealth.com

---

## Troubleshooting

### If the site shows old version after deployment:

1. **Clear Hostinger Cache:**
   - In hPanel → **Advanced** → **Clear Cache**
   - Wait 2-3 minutes for cache to clear

2. **Check .htaccess file:**
   - Ensure it doesn't have aggressive caching rules
   - Recommended .htaccess for SPA:
   ```apache
   <IfModule mod_rewrite.c>
     RewriteEngine On
     RewriteBase /
     RewriteRule ^index\.html$ - [L]
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /index.html [L]
   </IfModule>
   
   # Disable caching for HTML
   <FilesMatch "\.(html)$">
     Header set Cache-Control "no-cache, no-store, must-revalidate"
     Header set Pragma "no-cache"
     Header set Expires 0
   </FilesMatch>
   ```

3. **Verify file upload:**
   - Check File Manager in hPanel
   - Ensure all files from `dist/` are present
   - Check file sizes match local build

4. **Check browser cache:**
   - Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
   - Or use Incognito/Private mode

### If stocks still show random list:

1. **Verify deployment:**
   - Check that new files were actually uploaded
   - Look for the new `approvedInstruments-*.js` file in assets folder
   - Check network tab (F12) to see which JS files are loading

2. **Check for build errors:**
   - Review browser console (F12) for errors
   - Check if all asset files are loading (not 404)

3. **Verify environment:**
   - The site should load the built `dist/index.html`
   - React app should bootstrap correctly
   - No build-time environment variables are required for this feature

---

## Quick Verification Commands

### Check if site is loading new code:
```bash
# Check the main JS bundle hash
curl -I https://charts.fundedwealth.com/assets/index-*.js | grep ETag

# View the deployed index.html
curl https://charts.fundedwealth.com/index.html
```

### Check Git status:
```bash
git log --oneline -5
# Should show:
# c585749 docs: Add approved instruments implementation documentation
# 8ed5994 feat: Add canonical approved 200 NSE stocks universe
```

---

## Files to Deploy

These files from the `dist/` folder need to be on Hostinger:

```
dist/
├── index.html                           # Main HTML entry point
├── assets/
│   ├── index-*.css                      # Main CSS bundle
│   ├── index-*.js                       # Main JS bundle
│   ├── vendor-react-*.js                # React vendor bundle
│   ├── vendor-charts-*.js               # Charts vendor bundle
│   ├── vendor-ui-*.js                   # UI vendor bundle
│   ├── client-*.js                      # Client bundle
│   ├── approvedInstruments-*.js         # NEW: Approved stocks data
│   └── [other asset files]
```

**Total size:** ~2.5 MB (all assets combined)

---

## Post-Deployment Verification Checklist

Once files are uploaded to Hostinger:

- [ ] Site loads at https://charts.fundedwealth.com
- [ ] No console errors in browser (F12)
- [ ] Navigate to /stocks - shows 200 approved stocks
- [ ] Search for "HDFC" - returns HDFCBANK from approved list
- [ ] Navigate to /futures - shows only valid futures
- [ ] Navigate to /option-chain - shows approved underlyings
- [ ] Dhan live quotes load correctly
- [ ] TradingView charts load correctly
- [ ] Watchlist functionality works
- [ ] All navigation links work

---

## Need Help?

### Hostinger Support
- Live Chat: Available 24/7 in hPanel
- Support Email: support@hostinger.com
- Knowledge Base: support.hostinger.com

### Common Issues
1. **404 errors on routes:** Add .htaccess with SPA rewrite rules
2. **Blank page:** Check browser console for JS errors
3. **Old version showing:** Clear Hostinger cache + browser cache
4. **Files not uploading:** Check disk space quota in hPanel

---

**Ready to Deploy!** 🚀

All code changes are complete. Just upload the `dist/` folder to Hostinger and verify.
