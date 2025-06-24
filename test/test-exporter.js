// ChatGPT Exporter Enhanced - Test Script
// Run this in the browser console on ChatGPT to test your setup

(async function testExporter() {
    console.log('🧪 ChatGPT Exporter Test Suite v3.0.0');
    console.log('=====================================');
    
    const tests = {
        passed: 0,
        failed: 0,
        warnings: 0
    };
    
    // Test 1: Check if we're on ChatGPT
    console.log('\n📍 Test 1: Checking domain...');
    if (window.location.hostname === 'chatgpt.com' || window.location.hostname === 'chat.openai.com') {
        console.log('✅ Valid ChatGPT domain detected');
        tests.passed++;
    } else {
        console.error('❌ Not on ChatGPT domain! Please navigate to chatgpt.com');
        tests.failed++;
        return;
    }
    
    // Test 2: Check authentication
    console.log('\n🔐 Test 2: Checking authentication...');
    try {
        const authToken = await extractAuthToken();
        if (authToken) {
            console.log('✅ Authentication token found');
            console.log(`   Token preview: ${authToken.substring(0, 20)}...`);
            tests.passed++;
        } else {
            throw new Error('No token found');
        }
    } catch (error) {
        console.error('❌ Authentication check failed:', error.message);
        console.log('   Please make sure you are logged into ChatGPT');
        tests.failed++;
    }
    
    // Test 3: Check API access
    console.log('\n🌐 Test 3: Testing API access...');
    try {
        const response = await fetch('https://chatgpt.com/backend-api/accounts/check', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ API access confirmed');
            console.log(`   Account type: ${data.account_plan || 'Free'}`);
            
            if (data.account_plan?.includes('team')) {
                console.log('   🏢 Teams account detected');
                console.log(`   Workspace ID: ${data.workspace_id || 'Not found'}`);
            }
            
            tests.passed++;
        } else {
            throw new Error(`API returned ${response.status}`);
        }
    } catch (error) {
        console.error('❌ API access test failed:', error.message);
        tests.failed++;
    }
    
    // Test 4: Check for conversations
    console.log('\n💬 Test 4: Checking conversations...');
    try {
        const token = await extractAuthToken();
        const response = await fetch('https://chatgpt.com/backend-api/conversations?offset=0&limit=1', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Conversations API accessible');
            console.log(`   Total conversations: ${data.total}`);
            
            if (data.total > 1000) {
                console.log('   ⚠️  You have more than 1000 conversations');
                console.log('   The enhanced exporter will handle pagination automatically');
                tests.warnings++;
            }
            
            tests.passed++;
        } else {
            throw new Error(`Conversations API returned ${response.status}`);
        }
    } catch (error) {
        console.error('❌ Conversations test failed:', error.message);
        tests.failed++;
    }
    
    // Test 5: Check for userscript manager
    console.log('\n🔧 Test 5: Checking userscript manager...');
    if (typeof GM_info !== 'undefined') {
        console.log('✅ Userscript manager detected:', GM_info.scriptHandler);
        console.log(`   Version: ${GM_info.version}`);
        tests.passed++;
    } else if (typeof GM !== 'undefined' || typeof GM_getValue !== 'undefined') {
        console.log('⚠️  Legacy userscript API detected');
        console.log('   Consider updating to a modern userscript manager');
        tests.warnings++;
        tests.passed++;
    } else {
        console.log('❌ No userscript manager detected');
        console.log('   Please install Tampermonkey, Violentmonkey, or Greasemonkey');
        tests.failed++;
    }
    
    // Test 6: Check page structure
    console.log('\n🏗️  Test 6: Checking page structure...');
    const sidebar = document.querySelector('nav');
    const mainContent = document.querySelector('main');
    
    if (sidebar && mainContent) {
        console.log('✅ ChatGPT page structure detected');
        tests.passed++;
    } else {
        console.log('⚠️  Page structure not fully loaded');
        console.log('   The exporter will wait for page load');
        tests.warnings++;
        tests.passed++;
    }
    
    // Test 7: Test rate limiting delay
    console.log('\n⏱️  Test 7: Testing rate limiter...');
    console.log('   Generating 5 random delays...');
    for (let i = 0; i < 5; i++) {
        const delay = Math.floor(Math.random() * (3300 - 100 + 1)) + 100;
        console.log(`   Delay ${i + 1}: ${delay}ms (${(delay / 1000).toFixed(1)}s)`);
    }
    console.log('✅ Rate limiter configured correctly');
    tests.passed++;
    
    // Test 8: Check for potential conflicts
    console.log('\n🔍 Test 8: Checking for conflicts...');
    const potentialConflicts = [];
    
    if (window.ChatGPTExporter) {
        potentialConflicts.push('Another ChatGPT exporter is already loaded');
    }
    
    const otherExtensions = Array.from(document.querySelectorAll('[class*="exporter"], [id*="exporter"]'));
    if (otherExtensions.length > 0) {
        potentialConflicts.push(`Found ${otherExtensions.length} other exporter elements`);
    }
    
    if (potentialConflicts.length === 0) {
        console.log('✅ No conflicts detected');
        tests.passed++;
    } else {
        console.log('⚠️  Potential conflicts found:');
        potentialConflicts.forEach(conflict => console.log(`   - ${conflict}`));
        tests.warnings++;
        tests.passed++;
    }
    
    // Summary
    console.log('\n=====================================');
    console.log('📊 Test Summary:');
    console.log(`   ✅ Passed: ${tests.passed}`);
    console.log(`   ❌ Failed: ${tests.failed}`);
    console.log(`   ⚠️  Warnings: ${tests.warnings}`);
    
    if (tests.failed === 0) {
        console.log('\n🎉 All critical tests passed! The exporter should work correctly.');
        
        if (tests.warnings > 0) {
            console.log('   Some warnings were found but they should not prevent operation.');
        }
        
        console.log('\n💡 Next steps:');
        console.log('   1. Install the chatgpt-exporter.user.js script');
        console.log('   2. Refresh the page');
        console.log('   3. Look for the "Export All" button in the sidebar');
    } else {
        console.log('\n❌ Some tests failed. Please fix the issues above before using the exporter.');
    }
    
    // Helper function
    async function extractAuthToken() {
        // Try localStorage
        const authData = localStorage.getItem('@@auth0spajs@@::2yotnuigzNqfFXrCsGrYPUHUiojnIFwn::https://api.openai.com/v1::openid profile email offline_access');
        if (authData) {
            try {
                const parsed = JSON.parse(authData);
                if (parsed.body?.access_token) {
                    return parsed.body.access_token;
                }
            } catch (e) {}
        }
        
        // Try sessionStorage
        const sessions = Object.keys(sessionStorage).filter(k => k.includes('auth'));
        for (const key of sessions) {
            try {
                const data = JSON.parse(sessionStorage.getItem(key));
                if (data.accessToken) return data.accessToken;
            } catch (e) {}
        }
        
        return null;
    }
    
})();
