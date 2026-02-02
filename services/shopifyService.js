const axios = require('axios');

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN; // e.g., "my-store.myshopify.com"
const API_VERSION = '2024-01';

/**
 * Get order details by Name (e.g. #1001) and Email
 */
async function getOrderByNameAndEmail(orderName, email) {
    // 1. Mock Data for demonstration if no token provided or specific test case
    if (!SHOPIFY_ACCESS_TOKEN || orderName === '#155420') {
        if (!SHOPIFY_ACCESS_TOKEN) {
            console.warn("⚠️ SHOPIFY_ACCESS_TOKEN not set. Returning Mock Data.");
        }
        return getMockOrder(orderName);
    }

    if (!SHOP_DOMAIN) {
        return { ok: false, error: "Shop Domain not configured" };
    }

    try {
        const cleanDomain = SHOP_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const url = `https://${cleanDomain}/admin/api/${API_VERSION}/orders.json?status=any&name=${encodeURIComponent(orderName)}`;
        
        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        const orders = response.data.orders;
        
        // Find the specific order that matches email (case insensitive)
        const order = orders.find(o => 
            (o.email && o.email.toLowerCase() === email.toLowerCase()) || 
            (o.contact_email && o.contact_email.toLowerCase() === email.toLowerCase())
        );

        if (!order) {
            return { ok: false, error: "Order not found or email does not match." };
        }

        // We need to fetch product images separately or rely on what's available
        // Usually line_items in Order API don't have full image URLs, just product_id/variant_id.
        // For better UX, let's fetch product images if possible, or just use placeholders.
        // To keep it simple and fast, we will try to match line items to fulfillments.
        
        return await processOrderData(order, cleanDomain, SHOPIFY_ACCESS_TOKEN);

    } catch (error) {
        console.error("Shopify API Error:", error.response?.data || error.message);
        return { ok: false, error: "Failed to fetch order from Shopify." };
    }
}

/**
 * Process Shopify Order Object into our App's Internal Format
 */
async function processOrderData(order, shopDomain, token) {
    // Helper to get image URL (basic implementation)
    // Ideally we would batch fetch products, but for MVP we might skip or do simple lookup
    // If we have access to the Product API, we can fetch images.
    
    // 1. Extract Line Items map for easy lookup
    const lineItemsMap = {};
    order.line_items.forEach(item => {
        lineItemsMap[item.id] = {
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            currency: order.currency,
            product_id: item.product_id,
            variant_id: item.variant_id,
            image: null // To be filled
        };
    });

    // 2. Fetch Images (Optional Enhancement)
    // Collect all product IDs
    const productIds = [...new Set(order.line_items.map(item => item.product_id).filter(Boolean))];
    
    if (productIds.length > 0) {
        try {
            const idsString = productIds.join(',');
            const productsUrl = `https://${shopDomain}/admin/api/${API_VERSION}/products.json?ids=${idsString}&fields=id,image,images`;
            
            const prodResponse = await axios.get(productsUrl, {
                headers: {
                    'X-Shopify-Access-Token': token,
                    'Content-Type': 'application/json'
                }
            });

            const products = prodResponse.data.products || [];
            
            // Map product images back to line items
            products.forEach(prod => {
                // Find matching line items
                Object.values(lineItemsMap).forEach(li => {
                    // Use String comparison to be safe (API sometimes returns numbers, sometimes strings)
                    if (String(li.product_id) === String(prod.id)) {
                        
                        // 1. Try to find Variant Image first
                        let variantImage = null;
                        if (li.variant_id && prod.images && prod.images.length > 0) {
                             const vImg = prod.images.find(img => img.variant_ids && img.variant_ids.includes(li.variant_id));
                             if (vImg) {
                                 variantImage = vImg.src;
                             }
                        }

                        // 2. Fallback to Main Product Image
                        if (variantImage) {
                            li.image = variantImage;
                        } else if (prod.image && prod.image.src) {
                            li.image = prod.image.src;
                        }
                    }
                });
            });
            
        } catch (error) {
            if (error.response && error.response.status === 403) {
                console.warn("⚠️ Failed to fetch product images. Missing Scope? Ensure 'read_products' is added to your API Scopes.");
                console.warn("Details:", JSON.stringify(error.response.data));
            } else {
                console.warn("Failed to fetch product images:", error.message);
            }
            // Continue without images rather than failing the whole request
        }
    }
    
    // 3. Process Fulfillments (Packages)
    // First, map existing fulfillments to packages
    const packages = order.fulfillments.map((f, index) => {
        // Find which items are in this fulfillment
        const packageItems = f.line_items.map(li => {
            const originalItem = lineItemsMap[li.id];
            return {
                ...originalItem,
                quantity: li.quantity // Use the quantity in this specific shipment
            };
        });

        return {
            id: f.id,
            name: `Package #${index + 1}`,
            tracking_number: f.tracking_number,
            tracking_company: f.tracking_company,
            tracking_url: f.tracking_url,
            status: f.shipment_status || 'fulfilled',
            items: packageItems // Attach items specifically to this package
        };
    }).filter(p => p.tracking_number);

    // 4. Handle Unfulfilled / Partial Items
    // Calculate what has been fulfilled so far
    const fulfilledCounts = {};
    packages.forEach(pkg => {
        pkg.items.forEach(item => {
            fulfilledCounts[item.id] = (fulfilledCounts[item.id] || 0) + item.quantity;
        });
    });

    // Determine remaining unfulfilled items
    const unfulfilledItems = [];
    Object.values(lineItemsMap).forEach(item => {
        const fulfilledQty = fulfilledCounts[item.id] || 0;
        const remainingQty = item.quantity - fulfilledQty;
        
        if (remainingQty > 0) {
            unfulfilledItems.push({
                ...item,
                quantity: remainingQty
            });
        }
    });

    // If we have unfulfilled items, create a "Processing" package
    if (unfulfilledItems.length > 0) {
        packages.push({
            id: 'unfulfilled-group',
            name: `Package #${packages.length + 1} (Processing)`,
            tracking_number: 'Processing',
            tracking_company: 'N/A',
            tracking_url: null,
            status: 'ordered', // This maps to "We have received your order..." in frontend
            items: unfulfilledItems
        });
    }

    // Return all items for the "Order Info" summary if needed, or just let the frontend handle it.
    
    // Return all items for the "Order Info" summary if needed, or just let the frontend handle it.
    const allItems = Object.values(lineItemsMap);

    return {
        ok: true,
        order: {
            id: order.id,
            name: order.name,
            email: order.email,
            created_at: order.created_at,
            destination: order.shipping_address ? order.shipping_address.country : 'Unknown',
            items: allItems, // Full list
            packages: packages // Packages with their specific items
        }
    };
}

/**
 * Mock Data Generator
 */
function getMockOrder(orderName) {
    const item1 = {
        id: 101,
        name: "Tesla Model Y Wheel Rims Touch Up Paint",
        quantity: 1,
        price: "24.99",
        currency: "USD",
        image: "https://placehold.co/60x60?text=Paint"
    };
    
    const item2 = {
        id: 102,
        name: "Tesla Model 3/Y/X/S Mini Emergency Car Hammer - Silver",
        quantity: 1,
        price: "11.99",
        currency: "USD",
        image: "https://placehold.co/60x60?text=Hammer"
    };
    
    const item3 = {
        id: 103,
        name: "Tesla Model 3/Y/X/S Mini Emergency Car Hammer - Red",
        quantity: 1,
        price: "11.99",
        currency: "USD",
        image: "https://placehold.co/60x60?text=RedHammer"
    };

    return {
        ok: true,
        order: {
            id: 123456789,
            name: orderName || "#EVO7103",
            email: "schulerts@pm.me",
            created_at: new Date().toISOString(),
            destination: "United States",
            items: [item1, item2, item3], // Total items
            packages: [
                {
                    name: "Package #1",
                    tracking_number: "YT2602400702022310",
                    tracking_company: "YunExpress",
                    status: "in_transit",
                    items: [item1] // Only item 1 is in Package 1
                },
                {
                    name: "Package #2",
                    tracking_number: "US8849201923",
                    tracking_company: "USPS",
                    status: "delivered",
                    items: [item2, item3] // Items 2 & 3 are in Package 2
                }
            ]
        }
    };
}

/**
 * Find Order by Tracking Number using GraphQL API
 */
async function findOrderByTrackingNumber(trackingNumber) {
    if (!SHOPIFY_ACCESS_TOKEN || !SHOP_DOMAIN) {
        // Fallback for mock data testing
        if (trackingNumber === 'YT2602400702022310') {
             return getMockOrder('#EVO7103');
        }
        return { ok: false, error: "Shopify Configuration Missing" };
    }

    const cleanDomain = SHOP_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const graphqlUrl = `https://${cleanDomain}/admin/api/${API_VERSION}/graphql.json`;

    // GraphQL Query: Search orders by tracking number
    // We search for the tracking number directly in the query field which performs a broad search
    const query = `
    {
      orders(first: 1, query: "${trackingNumber}") {
        edges {
          node {
            id
            name
            email
            createdAt
            shippingAddress {
              country
            }
            currencyCode
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  originalUnitPrice
                  variant {
                    id
                    image {
                      url
                    }
                  }
                  product {
                    id
                  }
                }
              }
            }
            fulfillments(first: 10) {
              id
              trackingInfo(first: 10) {
                number
                company
                url
              }
              fulfillmentLineItems(first: 50) {
                edges {
                  node {
                    lineItem {
                      id
                    }
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    }
    `;

    try {
        console.log(`[Shopify GraphQL] Searching for tracking number: ${trackingNumber}`);
        const response = await axios.post(graphqlUrl, { query }, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        const data = response.data.data;
        
        // Log raw response for debugging if needed (can be removed later)
        // console.log("[Shopify GraphQL] Response:", JSON.stringify(data, null, 2));

        if (!data || !data.orders || data.orders.edges.length === 0) {
            console.warn(`[Shopify GraphQL] No order found for ${trackingNumber}`);
            return { ok: false, error: "No order found with this tracking number." };
        }

        console.log(`[Shopify GraphQL] Found order: ${data.orders.edges[0].node.name}`);

        // Convert GraphQL response to our internal format
        const node = data.orders.edges[0].node;
        
        // 1. Map Line Items
        const lineItemsMap = {};
        node.lineItems.edges.forEach(({ node: item }) => {
            // GraphQL ID is like "gid://shopify/LineItem/12345", we need just "12345" for mapping if needed, 
            // but for display we just need data.
            const cleanId = item.id.split('/').pop();
            lineItemsMap[item.id] = {
                id: cleanId,
                name: item.title,
                quantity: item.quantity,
                price: item.originalUnitPrice,
                currency: node.currencyCode,
                image: item.variant && item.variant.image ? item.variant.image.url : null
            };
        });

        // 2. Map Fulfillments (Packages)
        const packages = node.fulfillments.map((f, index) => {
             // Find tracking info that matches our search (or first one)
             const trackingInfo = f.trackingInfo.find(t => t.number === trackingNumber) || f.trackingInfo[0] || {};
             
             // Map items in this fulfillment
             const packageItems = f.fulfillmentLineItems.edges.map(({ node: fli }) => {
                 const originalItem = lineItemsMap[fli.lineItem.id];
                 return {
                     ...originalItem,
                     quantity: fli.quantity
                 };
             }).filter(item => item.name); // Filter out any undefined

             return {
                 id: f.id,
                 name: `Package #${index + 1}`,
                 tracking_number: trackingInfo.number,
                 tracking_company: trackingInfo.company,
                 tracking_url: trackingInfo.url,
                 status: 'fulfilled', // Basic status, detailed one comes from 17Track later
                 items: packageItems
             };
        }).filter(p => p.tracking_number); // Only packages with tracking

        // Filter packages to ONLY return the one matching the requested tracking number?
        // Or return all packages in that order? 
        // Requirement: "Is it our website order... show logistics info... and order products"
        // Usually better to show the specific package focused, but having context of full order is fine.
        // Let's filter to ensure we highlight the right one or at least validate it exists.
        
        const targetPackage = packages.find(p => p.tracking_number === trackingNumber);
        if (!targetPackage) {
             // Should theoretically not happen if GraphQL search worked, but possible if partial match
             return { ok: false, error: "Tracking number not found in order fulfillments." };
        }

        const allItems = Object.values(lineItemsMap);

        return {
            ok: true,
            order: {
                id: node.id,
                name: node.name,
                email: node.email,
                created_at: node.createdAt,
                destination: node.shippingAddress ? node.shippingAddress.country : 'Unknown',
                items: allItems,
                packages: packages // Return all packages so user can see full order context if needed
            }
        };

    } catch (error) {
        console.error("Shopify GraphQL Error:", error.response?.data || error.message);
        return { ok: false, error: "Failed to verify tracking number." };
    }
}

module.exports = { getOrderByNameAndEmail, findOrderByTrackingNumber };
