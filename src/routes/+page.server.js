import { createClient } from '@vercel/kv';
// CHANGED: Back to the KV keys here too!
import { KV_REST_API_URL, KV_REST_API_TOKEN } from '$env/static/private';

const kv = createClient({
    url: KV_REST_API_URL,
    token: KV_REST_API_TOKEN
});

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
    
    // Emergency Fallback
    return { masterShowPool: [1396, 2316, 66732, 1399, 60059] };
}