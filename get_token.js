const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("=== Shopify Access Token Exchanger ===");
console.log("Please enter your credentials from the Partner Dashboard.\n");

rl.question('1. Shop Domain (e.g., my-store.myshopify.com): ', (shop) => {
  rl.question('2. Client ID: ', (clientId) => {
    rl.question('3. Client Secret: ', (clientSecret) => {
      
      // Clean up input
      const cleanShop = shop.replace('https://', '').replace(/\/$/, '');
      
      console.log(`\nRequesting token from https://${cleanShop}/admin/oauth/access_token ...`);

      axios.post(`https://${cleanShop}/admin/oauth/access_token`, {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      }, {
        headers: {
          'Content-Type': 'application/json' // The doc says x-www-form-urlencoded, but JSON often works too. Let's try standard JSON first.
        }
      })
      .then(response => {
        console.log("\n✅ SUCCESS! Here is your Access Token:");
        console.log("========================================");
        console.log(response.data.access_token);
        console.log("========================================");
        console.log("\nPlease copy this token and paste it into your .env file as SHOPIFY_ACCESS_TOKEN");
        rl.close();
      })
      .catch(error => {
        console.error("\n❌ ERROR: Failed to get token.");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data);
        } else {
            console.error(error.message);
        }
        
        // Retry with form-urlencoded if JSON failed (as per screenshot curl example)
        console.log("\nRetrying with x-www-form-urlencoded...");
        const params = new URLSearchParams();
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('grant_type', 'client_credentials');

        axios.post(`https://${cleanShop}/admin/oauth/access_token`, params)
        .then(response => {
            console.log("\n✅ SUCCESS! Here is your Access Token:");
            console.log("========================================");
            console.log(response.data.access_token);
            console.log("========================================");
            console.log("\nPlease copy this token and paste it into your .env file as SHOPIFY_ACCESS_TOKEN");
            rl.close();
        })
        .catch(err2 => {
            console.error("\n❌ RETRY FAILED too.");
             if (err2.response) {
                console.error("Status:", err2.response.status);
                console.error("Data:", err2.response.data);
            } else {
                console.error(err2.message);
            }
            rl.close();
        });
      });
    });
  });
});
