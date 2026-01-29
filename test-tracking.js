require("dotenv").config();
const { getTrackingInfo } = require("./services/trackingService");

async function test() {
  console.log("--- Testing Mock Data ---");
  const mockResult = await getTrackingInfo("TEST123_MOCK");
  console.log("Mock Result:", JSON.stringify(mockResult, null, 2));

  console.log("\n--- Testing Real API (Expect Error if no Key) ---");
  const realResult = await getTrackingInfo("1234567890");
  console.log("Real Result:", JSON.stringify(realResult, null, 2));
}

test();
