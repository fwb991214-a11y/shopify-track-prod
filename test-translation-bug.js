require('dotenv').config();
const { getTrackingInfo } = require('./services/trackingService');

async function test() {
    console.log("Testing translation for YT2602900702800649 to 'fr'...");
    try {
        const result = await getTrackingInfo('YT2602900702800649', 'fr');
        console.log("Result OK:", result.ok);
        if (result.events && result.events.length > 0) {
            console.log("First Event:", result.events[0]);
        } else {
            console.log("No events found.");
        }
    } catch (e) {
        console.error("Test Failed:", e);
    }
}

test();