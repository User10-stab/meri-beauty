// Test script for rental request API
// Run with: node test-rental-request.js

const testData = {
  rentalType: "Fauteuil",
  startDate: "2024-12-20",
  endDate: "2024-12-31",
  commissionType: "PERCENTAGE",
  message: "Test demande via API"
};

console.log("Testing Rental Request API...");
console.log("Test data:", JSON.stringify(testData, null, 2));

// This is a manual test - you would need to:
// 1. Start your Next.js dev server: npm run dev
// 2. Test the API endpoint with curl or Postman:
// 
// curl -X POST http://localhost:3000/api/rental-requests \
//   -H "Content-Type: application/json" \
//   -d '{
//     "rentalType": "Fauteuil",
//     "startDate": "2024-12-20",
//     "endDate": "2024-12-31",
//     "commissionType": "PERCENTAGE",
//     "message": "Test demande"
//   }'
//
// 3. Or test the form directly in the browser at the BecomePartner section

console.log("\nTo test manually:");
console.log("1. Start dev server: npm run dev");
console.log("2. Go to http://localhost:3000 and find the 'Become Partner' section");
console.log("3. Fill out the form and click 'Envoyer ma demande'");
console.log("4. Check the browser console for any errors");
console.log("5. Check the database for the new rental request");