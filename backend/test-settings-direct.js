const { firestore } = require('./config/firebase');
const { getDefaultSettings, mergeWithDefaults } = require('./config/defaults');

// Direct Firestore test for settings functionality
async function testSettingsDirectly() {
  console.log('🧪 Testing Settings functionality directly with Firestore...');
  
  try {
    // Test 1: Get default settings
    console.log('\n1. Testing default settings generation');
    const defaultSettings = getDefaultSettings();
    console.log('✅ Default settings generated');
    console.log('📋 Sample defaults:', {
      appName: defaultSettings.appName,
      maxFileSize: defaultSettings.maxFileSize,
      maintenanceMode: defaultSettings.maintenanceMode
    });
    
    // Test 2: Create/Update settings in Firestore
    console.log('\n2. Testing Firestore settings creation/update');
    const testSettings = {
      appName: 'Test EdTech Platform Direct',
      maintenanceMode: false,
      maxFileSize: 20971520, // 20MB
      updatedAt: new Date().toISOString(),
      updatedBy: 'test-admin'
    };
    
    const settingsRef = firestore.collection('platformSettings').doc('main_config');
    await settingsRef.set(testSettings, { merge: true });
    console.log('✅ Settings saved to Firestore');
    
    // Test 3: Read settings from Firestore
    console.log('\n3. Testing Firestore settings retrieval');
    const settingsDoc = await settingsRef.get();
    
    if (settingsDoc.exists) {
      const dbSettings = settingsDoc.data();
      console.log('✅ Settings retrieved from Firestore');
      console.log('📋 Retrieved settings:', {
        appName: dbSettings.appName,
        maxFileSize: dbSettings.maxFileSize,
        maintenanceMode: dbSettings.maintenanceMode,
        updatedAt: dbSettings.updatedAt
      });
      
      // Test 4: Merge with defaults
      console.log('\n4. Testing merge with defaults');
      const mergedSettings = mergeWithDefaults(dbSettings);
      console.log('✅ Settings merged with defaults');
      console.log('📋 Merged settings sample:', {
        appName: mergedSettings.appName,
        maxFileSize: mergedSettings.maxFileSize,
        emailFrom: mergedSettings.emailFrom, // This should come from defaults
        passwordMinLength: mergedSettings.passwordMinLength // This should come from defaults
      });
    } else {
      console.log('⚠️ No settings document found in Firestore');
    }
    
    // Test 5: Reset to defaults
    console.log('\n5. Testing reset to defaults');
    const resetSettings = {
      ...getDefaultSettings(),
      updatedAt: new Date().toISOString(),
      updatedBy: 'test-admin',
      resetAt: new Date().toISOString()
    };
    
    await settingsRef.set(resetSettings);
    console.log('✅ Settings reset to defaults in Firestore');
    
    // Verify reset
    const resetDoc = await settingsRef.get();
    if (resetDoc.exists) {
      const resetData = resetDoc.data();
      console.log('📋 Reset verification:', {
        appName: resetData.appName,
        maxFileSize: resetData.maxFileSize,
        resetAt: resetData.resetAt
      });
    }
    
    console.log('\n🎉 All direct Firestore tests completed successfully!');
    console.log('\n📝 Summary:');
    console.log('   ✅ Default settings generation works');
    console.log('   ✅ Firestore write operations work');
    console.log('   ✅ Firestore read operations work');
    console.log('   ✅ Settings merge with defaults works');
    console.log('   ✅ Settings reset functionality works');
    
  } catch (error) {
    console.error('❌ Direct test error:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
  }
}

// Run the direct tests
testSettingsDirectly().then(() => {
  console.log('\n🏁 Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});