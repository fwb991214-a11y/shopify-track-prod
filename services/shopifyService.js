const axios = require('axios');

const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

/**
 * Verify order exists and belongs to email, then retrieve tracking number.
 * @param {string} orderName - Order name (e.g. "1001" or "#1001")
 * @param {string} email - Customer email
 */
async function getTrackingFromOrder(orderName, email) {
  if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    console.error("⚠️ Missing Shopify credentials (SHOPIFY_SHOP_DOMAIN, SHOPIFY_ACCESS_TOKEN) in .env");
    // For development/demo purposes, if credentials are missing, we might want to fail gracefully
    // But since this is a strict requirement, we return error.
    return { ok: false, error: "System configuration error: Missing Shopify API credentials." };
  }

  // Ensure order name format. If user enters "1001", query "1001". 
  // Shopify search "name:1001" matches "#1001".
  const query = `name:${orderName} AND email:${email}`;

  const graphqlQuery = `
    query($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            id
            name
            email
            displayFulfillmentStatus
            fulfillments {
              trackingInfo {
                number
                company
                url
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/graphql.json`,
      {
        query: graphqlQuery,
        variables: { query }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        }
      }
    );

    if (response.data.errors) {
        console.error("Shopify GraphQL Errors:", JSON.stringify(response.data.errors));
        return { ok: false, error: "Error querying store data." };
    }

    const orders = response.data.data.orders.edges;
    if (orders.length === 0) {
      return { ok: false, error: "Order not found or email does not match." };
    }

    const order = orders[0].node;
    const fulfillments = order.fulfillments || [];

    // Find the first valid tracking number
    let trackingNumber = null;
    let carrier = null;

    for (const fulfillment of fulfillments) {
      if (fulfillment.trackingInfo && fulfillment.trackingInfo.length > 0) {
        // We take the first tracking number found
        trackingNumber = fulfillment.trackingInfo[0].number;
        carrier = fulfillment.trackingInfo[0].company;
        break; 
      }
    }

    if (!trackingNumber) {
      return { ok: false, error: "This order has not been shipped yet." };
    }

    return { ok: true, trackingNumber, carrier };

  } catch (error) {
    console.error("Shopify API Exception:", error.response ? error.response.data : error.message);
    return { ok: false, error: "Failed to verify order details." };
  }
}

module.exports = { getTrackingFromOrder };
