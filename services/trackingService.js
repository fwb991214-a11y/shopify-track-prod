const axios = require("axios");
const { translate } = require('google-translate-api-x');

const TRACK17_KEY = process.env.TRACK17_KEY;
const API_BASE_URL = "https://api.17track.net/track/v2.4";

const LANG_MAP = {
  1033: 'en',
  2052: 'zh-CN',
  1036: 'fr',
  1034: 'es',
  1031: 'de',
  1040: 'it',
  1041: 'ja'
};

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
 * Helper to fetch data once
 */
async function fetchFrom17Track(tracking) {
    const response = await axios.post(
      `${API_BASE_URL}/gettrackinfo`,
      [{ number: tracking }],
      {
        headers: {
          "17token": TRACK17_KEY,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data;
}

/**
 * Sleep helper
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Change tracking information (e.g., language)
 */
async function changeTrackingInfo(trackingNumber, langCode) {
  if (!TRACK17_KEY || TRACK17_KEY === "YOUR_17TRACK_KEY_HERE") {
    return { ok: false, error: "API Key not configured" };
  }

  try {
    const response = await axios.post(
      `${API_BASE_URL}/changeinfo`,
      [
        {
          number: trackingNumber,
          lang: langCode
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
      return { ok: false, error: "Change info failed" };
    }
  } catch (error) {
    console.error("Error changing tracking info:", error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Detect language from events
 */
function detectLanguage(events) {
  if (!events || !Array.isArray(events) || events.length === 0) return 'Unknown';
  
  for (const event of events) {
    const text = (event.desc || event.description || "") + (event.location || "");
    if (!text) continue;
    
    if (/[\u4e00-\u9fa5]/.test(text)) return 'Chinese';
    if (/[а-яА-Я]/.test(text)) return 'Russian';
    if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'Japanese';
  }
  
  return 'English';
}

/**
 * Get tracking info from 17TRACK
 */
async function getTrackingInfo(tracking, lang = null) {
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
    // If language is specified, try to update it first
    if (lang) {
        await changeTrackingInfo(tracking, lang);
        // Add a small delay to ensure update propagates
        await delay(500); 
    }

    // 1. First attempt to get tracking info
    let data = await fetchFrom17Track(tracking);
    let trackData = null;

    // Check if we got data immediately
    if (data.code === 0 && data.data.accepted.length > 0) {
      const item = data.data.accepted[0];
      trackData = item.track_info || item.track;
    } 
    else {
      // 2. If not found, try to register
      console.log(`Tracking ${tracking} not found, attempting registration...`);
      const regResult = await registerTracking(tracking);
      
      if (regResult.ok) {
        // Registration successful. Now we poll for a few seconds.
        console.log("Registration success. Polling for data update...");
        
        // Try up to 3 times, waiting 1s, 2s, 2s
        const waitTimes = [1000, 2000, 2000]; 
        
        for (const wait of waitTimes) {
            await delay(wait);
            console.log(`Polling 17TRACK after ${wait}ms...`);
            
            data = await fetchFrom17Track(tracking);
            if (data.code === 0 && data.data.accepted.length > 0) {
                 const item = data.data.accepted[0];
                 // Ensure we actually have meaningful events
                 const info = item.track_info || item.track;
                 if (info && info.tracking && info.tracking.providers && info.tracking.providers[0].events.length > 0) {
                     trackData = info;
                     console.log("Got data after polling!");
                     break;
                 }
            }
        }
        
        // If still no data after polling, return the "Registered" state
        if (!trackData) {
             return {
              ok: true,
              tracking,
              status: "Registered",
              carrier: "Detecting...",
              events: [
                {
                  time: new Date().toLocaleString(),
                  desc: "Tracking number registered. System is retrieving details from carrier..."
                }
              ]
            };
        }

      } else {
         return { ok: false, error: "Tracking number not found and could not be registered." };
      }
    }

    // 3. Process the track data (if we have it)
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
                  desc: e.description || "",
                  location: e.location || ""
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

      // Detect original language before translation
      let originalLang = detectLanguage(events);

      // Apply Google Translation if requested
      const targetLang = (typeof LANG_MAP !== 'undefined' && LANG_MAP[lang]) ? LANG_MAP[lang] : lang;
      
      console.log(`Checking translation: lang=${lang}, target=${targetLang}`);
      if (targetLang) {
          console.log(`Translating events to ${targetLang}...`);
          events = await translateEvents(events, targetLang);
      }

      return {
        ok: true,
        tracking,
        status: status,
        carrier: carrier,
        events: events,
        original_language: originalLang
      };
    }

    return { ok: false };

  } catch (error) {
    console.error("Error fetching tracking info:", error.message);
    return { ok: false, error: "Service Error" };
  }
}

async function translateEvents(events, targetLang) {
  if (!events || !Array.isArray(events) || events.length === 0) return events;
  
  // Create an array of promises to translate descriptions and locations in parallel
  const promises = events.map(async (event) => {
    let newEvent = { ...event };
    try {
      // Handle 'description' or 'desc' field
      const textToTranslate = event.description || event.desc;
      if (textToTranslate && textToTranslate.trim()) {
        const res = await translate(textToTranslate, { to: targetLang });
        if (event.description) newEvent.description = res.text;
        if (event.desc) newEvent.desc = res.text;
      }
      
      if (event.location && event.location.trim()) {
         const res = await translate(event.location, { to: targetLang });
         newEvent.location = res.text;
      }
    } catch (e) {
      console.error("Translation failed for event:", e.message);
    }
    return newEvent;
  });

  return Promise.all(promises);
}

module.exports = { getTrackingInfo };
