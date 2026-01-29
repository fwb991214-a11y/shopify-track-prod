const axios = require("axios");

const TRACK17_KEY = process.env.TRACK17_KEY;
const API_BASE_URL = "https://api.17track.net/track/v2.4";

/**
 * Map 17TRACK internal status codes to human readable strings
 * 0: Not Found, 10: In Transit, 20: Expired, 30: Ready for Pickup, 
 * 35: Undelivered, 40: Delivered, 50: Alert
 */
function getStatusText(code) {
  const statusMap = {
    0: "Not Found",
    10: "In Transit",
    20: "Expired",
    30: "Ready for Pickup",
    35: "Undelivered",
    40: "Delivered",
    50: "Alert"
  };
  return statusMap[code] || "Unknown";
}

/**
 * Register a tracking number with 17TRACK
 */
async function registerTracking(trackingNumber) {
  if (!TRACK17_KEY || TRACK17_KEY === "YOUR_17TRACK_KEY_HERE") {
    console.warn("⚠️ Missing TRACK17_KEY in .env");
    return { ok: false, error: "API Key not configured" };
  }

  try {
    const response = await axios.post(
      `${API_BASE_URL}/register`,
      [
        {
          number: trackingNumber
        }
      ],
      {
        headers: {
          "17token": TRACK17_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const data = response.data;
    if (data.code === 0 && data.data.accepted.length > 0) {
      return { ok: true };
    } else {
      // Check if it was rejected because it's already registered (Error -18019903 usually)
      const rejected = data.data.rejected || [];
      const isAlreadyRegistered = rejected.some(r => r.error && r.error.code === -18019903);
      
      if (isAlreadyRegistered) {
        return { ok: true };
      }
      
      return { ok: false, error: "Registration failed" };
    }
  } catch (error) {
    console.error("Error registering tracking:", error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Get tracking info from 17TRACK
 */
async function getTrackingInfo(tracking) {
  // Check for mock data trigger for testing
  if (tracking === "TEST123_MOCK") {
    return {
      ok: true,
      tracking,
      status: "In transit",
      carrier: "DemoCarrier",
      events: [
        { time: "2026-01-20 10:00", desc: "Label created" },
        { time: "2026-01-21 15:30", desc: "Picked up" },
        { time: "2026-01-23 09:10", desc: "In transit" }
      ]
    };
  }

  if (!TRACK17_KEY || TRACK17_KEY === "YOUR_17TRACK_KEY_HERE") {
    console.warn("⚠️ TRACK17_KEY not set. Returning error.");
    return { ok: false, error: "Tracking service not configured" };
  }

  try {
    // 1. Try to get tracking info
    let response = await axios.post(
      `${API_BASE_URL}/gettrackinfo`,
      [
        {
          number: tracking
        }
      ],
      {
        headers: {
          "17token": TRACK17_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    let trackData = null;

    // Check if we got data
    if (response.data.code === 0 && response.data.data.accepted.length > 0) {
      // 17TRACK V2.4 structure: accepted[0].track_info or accepted[0].track
      const item = response.data.data.accepted[0];
      trackData = item.track_info || item.track;
    } else {
      // 2. If not found, try to register
      console.log(`Tracking ${tracking} not found, attempting registration...`);
      const regResult = await registerTracking(tracking);
      
      if (regResult.ok) {
        // If registered successfully, return a "pending" state or try to fetch again
        // Usually fetching immediately might still yield empty results, so we return a "Just Registered" state
        return {
          ok: true,
          tracking,
          status: "Registered",
          carrier: "Detecting...",
          events: [
            {
              time: new Date().toLocaleString(),
              desc: "Tracking number registered. Please check back later for updates."
            }
          ]
        };
      } else {
         return { ok: false, error: "Tracking number not found and could not be registered." };
      }
    }

    // 3. Process the track data
    if (trackData) {
      // Parse V2.4 Structure
      let events = [];
      let status = "Unknown";
      let carrier = "Unknown";

      // Case 1: V2.4 Standard Structure (track_info)
      if (trackData.tracking && trackData.tracking.providers) {
          // Get events from first provider
          const providerData = trackData.tracking.providers[0];
          if (providerData && providerData.events) {
              events = providerData.events.map(e => ({
                  time: e.time_iso || e.time_utc || "",
                  desc: e.description || ""
              }));
          }
          
          if (providerData && providerData.provider) {
              carrier = providerData.provider.name || providerData.provider.alias || "Carrier ID: " + providerData.provider.key;
          }

          if (trackData.latest_status) {
              status = trackData.latest_status.status_description || trackData.latest_status.status || "Unknown";
          }
      } 
      // Case 2: Legacy/Minified Structure (fallback)
      else if (trackData.z0) {
          events = (trackData.z0 || []).map(e => ({
            time: e.a || "", 
            desc: e.z || ""
          }));
          status = getStatusText(trackData.e);
          carrier = "Carrier ID: " + trackData.w1;
      }

      return {
        ok: true,
        tracking,
        status: status,
        carrier: carrier,
        events: events
      };
    }

    return { ok: false };

  } catch (error) {
    console.error("Error fetching tracking info:", error.message);
    return { ok: false, error: "Service Error" };
  }
}

module.exports = { getTrackingInfo };
