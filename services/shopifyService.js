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
                if (prod.image && prod.image.src) {
                    // Update all line items with this product_id
                    Object.values(lineItemsMap).forEach(li => {
                        if (li.product_id === prod.id) {
                            li.image = prod.image.src;
                        }
                    });
                }
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

    // 4. Identify Unfulfilled or Non-tracked items (Optional)
    // For this specific request, we just want to show items per package.
    
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

module.exports = { getOrderByNameAndEmail };
