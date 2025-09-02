const { firestore } = require('./config/firebase');

async function testFirestoreSubjects() {
  console.log('Testing Firestore subjects collection...');
  
  const batchId = 'uwOrbZPZRRttGAVOBXLK';
  
  try {
    // Check if batch exists
    console.log('\n1. Checking if batch exists...');
    const batchDoc = await firestore.collection('batches').doc(batchId).get();
    console.log('Batch exists:', batchDoc.exists);
    if (batchDoc.exists) {
      console.log('Batch data:', batchDoc.data());
    }
    
    // Query subjects for this batch
    console.log('\n2. Querying subjects for batch...');
    const subjectsQuery = await firestore.collection('subjects')
      .where('batchId', '==', batchId)
      .get();
    
    console.log('Subjects found:', subjectsQuery.size);
    
    subjectsQuery.forEach(doc => {
      console.log('Subject ID:', doc.id);
      console.log('Subject data:', doc.data());
      console.log('---');
    });
    
    // List all subjects in the collection
    console.log('\n3. Listing all subjects in collection...');
    const allSubjects = await firestore.collection('subjects').get();
    console.log('Total subjects in collection:', allSubjects.size);
    
    allSubjects.forEach(doc => {
      const data = doc.data();
      console.log(`Subject: ${data.title} (Batch: ${data.batchId})`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testFirestoreSubjects();