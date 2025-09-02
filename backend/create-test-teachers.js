const admin = require('firebase-admin');
const { serviceAccount } = require('./config/firebase.js');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

async function createTestTeachers() {
  try {
    console.log('Creating test teachers...');
    
    const teachers = [
      {
        email: 'teacher1@example.com',
        password: 'teacher123',
        displayName: 'Dr. Rajesh Kumar',
        role: 'teacher'
      },
      {
        email: 'teacher2@example.com', 
        password: 'teacher123',
        displayName: 'Prof. Priya Sharma',
        role: 'teacher'
      },
      {
        email: 'teacher3@example.com',
        password: 'teacher123', 
        displayName: 'Dr. Amit Singh',
        role: 'teacher'
      }
    ];

    for (const teacherData of teachers) {
      try {
        // Create user
        const userRecord = await admin.auth().createUser({
          email: teacherData.email,
          password: teacherData.password,
          displayName: teacherData.displayName,
          emailVerified: true
        });

        // Set custom claims for role
        await admin.auth().setCustomUserClaims(userRecord.uid, {
          role: teacherData.role
        });

        console.log(`✅ Created teacher: ${teacherData.displayName} (${teacherData.email})`);
      } catch (error) {
        if (error.code === 'auth/email-already-exists') {
          console.log(`⚠️  Teacher already exists: ${teacherData.email}`);
          // Update role for existing user
          const existingUser = await admin.auth().getUserByEmail(teacherData.email);
          await admin.auth().setCustomUserClaims(existingUser.uid, {
            role: teacherData.role
          });
          console.log(`✅ Updated role for: ${teacherData.email}`);
        } else {
          console.error(`❌ Error creating teacher ${teacherData.email}:`, error.message);
        }
      }
    }

    console.log('\n🎉 Test teachers creation completed!');
    
    // Verify teachers were created
    const listUsersResult = await admin.auth().listUsers(100);
    const teachers_created = listUsersResult.users.filter(user => user.customClaims?.role === 'teacher');
    console.log(`\n📊 Total teachers in database: ${teachers_created.length}`);
    teachers_created.forEach(teacher => {
      console.log(`   - ${teacher.displayName || teacher.email} (${teacher.email})`);
    });
    
  } catch (error) {
    console.error('❌ Error creating test teachers:', error);
  }
}

createTestTeachers().then(() => {
  console.log('\n✅ Script completed');
  process.exit(0);
}).catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});