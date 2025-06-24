# Quick Installation Guide

## Prerequisites

1. A modern web browser (Chrome, Firefox, Edge, or Safari)
2. A userscript manager extension:
   - **Recommended**: [Tampermonkey](https://www.tampermonkey.net/)
   - Alternative: [Violentmonkey](https://violentmonkey.github.io/)
   - Firefox only: [Greasemonkey](https://www.greasespot.net/)

## Step-by-Step Installation

### 1. Install Userscript Manager

Click the link for your browser:
- [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- [Safari](https://apps.apple.com/us/app/tampermonkey/id1482490089)

### 2. Install the Script

1. Copy all content from `chatgpt-exporter.user.js`
2. Click the Tampermonkey icon in your browser
3. Select "Create a new script"
4. Delete any existing code
5. Paste the copied code
6. Press `Ctrl+S` (or `Cmd+S` on Mac) to save

### 3. Verify Installation

1. Go to [ChatGPT](https://chatgpt.com)
2. Open browser console (`F12` → Console tab)
3. Paste and run the test script from `test-exporter.js`
4. Check that all tests pass

### 4. Using the Exporter

1. Look for the **"Export All"** button in the ChatGPT sidebar
2. Click to open the export dialog
3. Select conversations to export
4. Choose your export format
5. Click "Export Selected"

## Troubleshooting

### "Export All" button not appearing
- Refresh the page
- Check that the userscript is enabled in Tampermonkey
- Make sure you're on chatgpt.com (not chat.openai.com)

### Authentication errors
- Log out and log back into ChatGPT
- Clear cookies for chatgpt.com
- Disable other ChatGPT extensions temporarily

### Export fails or stops
- Check browser console for errors
- Try exporting fewer conversations
- Ensure stable internet connection

### Rate limiting issues
- The script includes automatic rate limiting
- If you still get errors, increase the delay in CONFIG

## Quick Test

Run this in the browser console to check if everything is working:

```javascript
// Quick test - should show your auth status
fetch('https://chatgpt.com/backend-api/accounts/check', {credentials: 'include'})
  .then(r => r.json())
  .then(d => console.log('Account:', d.account_plan || 'Free'));
```

## Need Help?

1. Run the full test script (`test-exporter.js`)
2. Check the browser console for errors
3. Review the README.md for detailed information
4. Open an issue on GitHub with:
   - Browser and version
   - Userscript manager and version
   - Console error messages
   - Test script results
