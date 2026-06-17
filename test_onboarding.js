/**
 * 🛰️ test_onboarding.js
 * Developer Testing Utility Script
 * Simulates an HR coordinator logging employee privacy consent options.
 */
async function runMockOnboardingTest() {
  console.log("⏳ Initializing mock compliance submission test...");

  // We use user_id: 1, which corresponds to the initial records we seeded into the database
  const mockPayload = {
    user_id: 1,
    consent_type: "APP_MONITORING",
    consent_given: true
  };

  try {
    // Make an asynchronous HTTP POST request to your live local Express server
    const response = await fetch("http://localhost:5000/api/v1/compliance/consent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(mockPayload)
    });

    const result = await response.json();

    if (response.ok && result.success) {
      console.log("\n🟢 TEST SUCCESSFUL!");
      console.log("Message from Server:", result.message);
      console.log("Saved Registry Record:", result.data);
    } else {
      console.log("\n🔴 TEST FAILED!");
      console.log("Server Error Details:", result.error || result);
    }

  } catch (error) {
    console.error("\n🔴 NETWORK ERROR: Could not connect to the Express server.");
    console.error("Make sure your server is actively running by executing 'node server.js' first!");
    console.error("Details:", error.message);
  }
}

// Execute the test function
runMockOnboardingTest();