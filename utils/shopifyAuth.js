const crypto = require('crypto');

/**
 * Verify Shopify App Proxy HMAC Signature
 * Docs: https://shopify.dev/docs/apps/online-store/app-proxies#signature-calculation
 */
function verifyShopifySignature(query, sharedSecret) {
    if (!sharedSecret || sharedSecret === 'YOUR_CLIENT_SECRET_HERE') {
        console.warn('⚠️ SHOPIFY_APP_SECRET not configured. Skipping signature verification.');
        return true; // Fail open for dev, or return false for security
    }

    // 1. Extract signature
    const { signature, ...params } = query;

    if (!signature) {
        return false;
    }

    // 2. Sort keys and create query string
    const sortedKeys = Object.keys(params).sort();
    const message = sortedKeys.map(key => {
        // Shopify handles array params differently, but for proxy it's usually flat
        return `${key}=${Array.isArray(params[key]) ? params[key].join(',') : params[key]}`;
    }).join('');

    // 3. Calculate HMAC
    const generatedSignature = crypto
        .createHmac('sha256', sharedSecret)
        .update(message)
        .digest('hex');

    // 4. Compare
    // Use timingSafeEqual to prevent timing attacks
    try {
        return crypto.timingSafeEqual(
            Buffer.from(generatedSignature),
            Buffer.from(signature)
        );
    } catch (e) {
        return false;
    }
}

module.exports = { verifyShopifySignature };
