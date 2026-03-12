// src/routes/+page.server.js
import { kv } from '@vercel/kv';

export async function load() {
    try {
        // Grab the list of shows from our database
        let shows = await kv.get('teledle_master_pool');
        if (shows) {
            return { masterShowPool: shows };
        }
    } catch (e) {
        console.log("Local Database not connected yet, using fallback.");
    }
    
    // Emergency Fallback if the database is empty
    return { masterShowPool: [1396, 2316, 66732, 1399, 60059] };
}