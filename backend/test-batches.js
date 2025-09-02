const { firestore } = require('./config/firebase');

async function testBatches() {
  console.log('Testing batches collection...');
  
  try {
    // List all batches
    console.log('\n1. Listing all batches...');
    const batchesSnapshot = await firestore.collection('batches').get();
    console.log('Total batches found:', batchesSnapshot.size);
    
    batchesSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Batch ID: ${doc.id}`);
      console.log(`Title: ${data.title}`);
      console.log(`Course ID: ${data.courseId}`);
      console.log(`Status: ${data.status}`);
      console.log('---');
    });
    
    // Check courses collection
    console.log('\n2. Listing all courses...');
    const coursesSnapshot = await firestore.collection('courses').get();
    console.log('Total courses found:', coursesSnapshot.size);
    
    for (const courseDoc of coursesSnapshot.docs) {
      const courseData = courseDoc.data();
      console.log(`Course ID: ${courseDoc.id}`);
      console.log(`Title: ${courseData.title}`);
      
      // Check for batches subcollection
      const batchesSubcollection = await firestore.collection('courses').doc(courseDoc.id).collection('batches').get();
      console.log(`Batches in subcollection: ${batchesSubcollection.size}`);
      
      batchesSubcollection.forEach(batchDoc => {
        const batchData = batchDoc.data();
        console.log(`  - Batch ID: ${batchDoc.id}, Title: ${batchData.title}`);
      });
      console.log('---');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testBatches();