const express = require("express");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;

// 调试中间件：打印所有请求详情
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.path}`);
  console.log("Query:", req.query);
  next();
});

/**
 * =========================
 * 基础配置
 * =========================
 */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/proxy", express.static(path.join(__dirname, "public"))); // 兼容 Shopify Proxy 路径


/**
 * Root test
 */
app.get("/", (req, res) => {
  res.send("NODE ROOT OK");
});

/**
 * =========================
 * App Proxy 页面（HTML UI）
 * Shopify: /apps/track?tracking=XXX
 * 实际:   /proxy/track
 * =========================
 */
const { getTrackingInfo } = require("./services/trackingService");
const { verifyShopifySignature } = require("./utils/shopifyAuth");
const logDebug = require('./logger');

const SHOPIFY_APP_SECRET = process.env.SHOPIFY_APP_SECRET;
app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});
app.get("/proxy/track", async (req, res) => {

   res.setHeader("Content-Type", "text/html; charset=utf-8");
  const tracking = req.query.tracking;
  logDebug(`Incoming request for tracking: ${tracking}`);

  // 1. Security Check: Verify request is from Shopify
  // Note: Localhost testing won't have a valid Shopify signature usually.
  const isShopifyRequest = verifyShopifySignature(req.query, SHOPIFY_APP_SECRET);
  
  // If you want to enforce this strictly in production:
  // if (!isShopifyRequest && process.env.NODE_ENV === 'production') {
  //    return res.status(403).send("Unauthorized");
  // }
  // For now, we just log it
  if (!isShopifyRequest) {
      logDebug("⚠️ Request signature verification failed (not from Shopify Proxy?)");
  } else {
      logDebug("✅ Request signature verified as authentic Shopify Proxy");
  }

  if (!tracking) {
    return res.render("search");
  }

  try {
    // 2. Proceed to fetch tracking info
    const data = await getTrackingInfo(tracking);
    console.log(`[DEBUG] Service returned:`, JSON.stringify(data, null, 2));
    logDebug(`Service returned: ${JSON.stringify(data)}`);

    if (!data || !data.ok) {
      return res.render("error", {
        message: data.error || "Tracking number not found or not yet available."
      });
    }

    res.render("track", {
      tracking: data.tracking,
      status: data.status,
      carrier: data.carrier,
      events: data.events || []
    });
  } catch (err) {
    res.render("error", {
      message: "Service temporarily unavailable. Please try again later."
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
