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
app.use("/apps/track", express.static(path.join(__dirname, "public"))); // 本地开发兼容：/apps/track/* 静态资源

// --- Local Dev Alias ---
// Redirect /apps/track to /proxy/track so "Back" buttons work locally
app.get("/apps/track", (req, res) => {
  const query = req._parsedUrl.search || "";
  res.redirect("/proxy/track" + query);
});


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
const { getOrderByNameAndEmail, findOrderByTrackingNumber } = require("./services/shopifyService");
const { verifyShopifySignature } = require("./utils/shopifyAuth");
const logDebug = require('./logger');

const SHOPIFY_APP_SECRET = process.env.SHOPIFY_APP_SECRET;

app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

app.get(["/proxy/track", "/proxy"], async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const { tracking, order, email } = req.query;
  
  // 1. Security Check
  const isShopifyRequest = verifyShopifySignature(req.query, SHOPIFY_APP_SECRET);
  if (!isShopifyRequest) {
      logDebug("⚠️ Signature verification failed");
  } else {
      logDebug("✅ Signature verified");
  }

  // 2. Determine Mode
  const isOrderSearch = order && email;
  const isTrackingSearch = !!tracking;

  // If no search params, show Unified Page (initially just search form)
  if (!isOrderSearch && !isTrackingSearch) {
    return res.render("track", { 
        order: null, 
        packages: [], 
        isSearch: false,
        query: req.query 
    });
  }

  try {
    let viewData = {
        order: null,
        packages: [],
        isSearch: true,
        query: req.query
    };

    if (isOrderSearch) {
        // --- Order Mode ---
        console.log(`Searching for Order: ${order}, Email: ${email}`);
        const orderResult = await getOrderByNameAndEmail(order, email);
        
        if (!orderResult.ok) {
            return res.render("error", { message: orderResult.error || "Order not found" });
        }

        viewData.order = orderResult.order;
        
        // Fetch tracking for all packages in parallel
        // Note: viewData.order.packages already has basic info, we need to enrich it with 17TRACK data
        const enrichedPackages = await Promise.all(viewData.order.packages.map(async (pkg) => {
            if (pkg.tracking_number) {
                const trackInfo = await getTrackingInfo(pkg.tracking_number);
                if (trackInfo.ok) {
                    return {
                        ...pkg,
                        status: trackInfo.status,
                        carrier: trackInfo.carrier,
                        events: trackInfo.events || []
                    };
                }
            }
            return { ...pkg, events: [] };
        }));

        viewData.packages = enrichedPackages;

    } else {
        // --- Tracking Number Mode ---
        console.log(`Searching for Tracking: ${tracking}`);
        
        // 1. Verify if this tracking number belongs to our shop
        const orderResult = await findOrderByTrackingNumber(tracking);
        
        if (!orderResult.ok) {
            // Not found in our system -> Block access
            return res.render("error", { message: "We could not find an order with this tracking number in our system." });
        }

        // 2. Found Order! Set it to viewData
        viewData.order = orderResult.order;
        
        // 3. Get Logistics Info from 17Track
        const trackInfo = await getTrackingInfo(tracking);
        
        // 4. Construct Package Data
        // If 17Track fails or returns nothing, we still show the order info but with empty events
        let pkgStatus = 'fulfilled';
        let pkgEvents = [];
        let pkgCarrier = 'Unknown';
        let pkgOriginalLang = 'Unknown';
        
        if (trackInfo && trackInfo.ok) {
            pkgStatus = trackInfo.status;
            pkgEvents = trackInfo.events || [];
            pkgCarrier = trackInfo.carrier;
            pkgOriginalLang = trackInfo.original_language;
        }

        // Find the specific package in the order that matches this tracking number
        // to display the correct items in the UI
        const matchedPackage = viewData.order.packages.find(p => p.tracking_number === tracking) || viewData.order.packages[0];

        viewData.packages = [{
            ...matchedPackage, // Inherit items and name from Shopify Data
            carrier: pkgCarrier || matchedPackage.tracking_company,
            status: pkgStatus,
            events: pkgEvents,
            original_language: pkgOriginalLang
        }];
    }

    // Check if we have any data to show
    if (viewData.packages.length === 0 && !viewData.order) {
        return res.render("error", { message: "No tracking information found." });
    }

    res.render("track", viewData);

  } catch (err) {
    console.error("Server Error:", err);
    res.render("error", {
      message: "System Error. Please try again later."
    });
  }
});

// New route for translating tracking info
app.post("/proxy/translate-track", express.json(), async (req, res) => {
  const { tracking, lang } = req.body;
  if (!tracking || !lang) {
    return res.json({ ok: false, error: "Missing tracking number or language code" });
  }

  try {
    // 1. Verify if this tracking number belongs to our shop (security check)
    // We reuse findOrderByTrackingNumber to ensure user has right to access this tracking info
    // However, for performance, we might skip this if session is already validated or if we trust the tracking number from frontend context.
    // For now, let's just proceed to get tracking info with language.
    
    // 2. Get Translated Info
    // Note: 17Track language codes: English=1033, Simple Chinese=2052, etc.
    // We expect frontend to send the correct code (string or int).
    const trackInfo = await getTrackingInfo(tracking, lang);
    
    res.json(trackInfo);
  } catch (error) {
    console.error("Translation Error:", error);
    res.json({ ok: false, error: "Translation failed" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
