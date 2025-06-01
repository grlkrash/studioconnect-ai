// test_bcrypt.ts
import bcrypt from 'bcrypt';

async function testBcryptFunctionality() {
  const plaintextPassword = 'password123';
  const saltRounds = 10; // Standard salt rounds

  try {
    console.log(`Attempting to hash the password: "${plaintextPassword}" with ${saltRounds} salt rounds...`);
    const generatedHash = await bcrypt.hash(plaintextPassword, saltRounds);
    console.log('--------------------------------------------------------------------');
    console.log('NEWLY GENERATED HASH (use this one!):', generatedHash);
    console.log(`Length of newly generated hash: ${generatedHash.length}`);
    console.log('--------------------------------------------------------------------');

    console.log(`\nComparing plaintext "${plaintextPassword}" with this newly generated hash...`);
    const isMatchWithNewHash = await bcrypt.compare(plaintextPassword, generatedHash);
    console.log('Match result with NEWLY generated hash:', isMatchWithNewHash); // This MUST be true

    // For comparison, let's re-test the hash we've been struggling with:
    const problematicKnownHash = "$2b$10$KFX9Z5vG1ONvZ3pL7dZ8A.J0sU84w6KzSBc.gYmY0kDoN9S3NqU/S";
    console.log(`\nComparing plaintext "${plaintextPassword}" with the known problematic hash...`);
    console.log(`Problematic Hash: "${problematicKnownHash}"`);
    const isMatchWithProblematicHash = await bcrypt.compare(plaintextPassword, problematicKnownHash);
    console.log('Match result with KNOWN PROBLEMATIC hash:', isMatchWithProblematicHash); // This is the one that was false

  } catch (error) {
    console.error('Error during bcrypt test:', error);
  }
}

testBcryptFunctionality(); 