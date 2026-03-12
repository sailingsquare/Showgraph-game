import { json } from '@sveltejs/kit';
import { createClient } from '@vercel/kv';
import { env } from '$env/dynamic/public';
// CHANGED: Back to the KV keys that are actually in your .env file!
import { KV_REST_API_URL, KV_REST_API_TOKEN } from '$env/static/private';

const kv = createClient({
    url: KV_REST_API_URL,
    token: KV_REST_API_TOKEN
});

export async function GET() {
    const apiKey = env.PUBLIC_TMDB_KEY;
    const allowedRegions = ["US", "JP", "KR", "GB", "IN", "FR", "DE", "MX", "BR"];
    const excludedGenres = [10763, 10767]; // News & Talk Shows

    try {
        let showIds = [];
        for (let i = 1; i <= 20; i++) {
            const res = await fetch(`https://api.themoviedb.org/3/tv/top_rated?api_key=${apiKey}&language=en-US&page=${i}`);
            const data = await res.json();
            
            if (data.results) {
                const filteredShows = data.results.filter(show => {
                    const isAllowedRegion = show.origin_country && show.origin_country.some(country => allowedRegions.includes(country));
                    const isNotNewsOrTalk = !show.genre_ids.some(id => excludedGenres.includes(id));
                    return isAllowedRegion && isNotNewsOrTalk;
                });
                showIds = [...showIds, ...filteredShows.map(show => show.id)];
            }
        }
        
        // Remove duplicates and sort by ID
        showIds = [...new Set(showIds)].sort((a, b) => a - b);
        
        // Save the master list to the Vercel KV Database
        await kv.set('teledle_master_pool', showIds);

        return json({ success: true, totalShows: showIds.length, message: "Database successfully updated for the year!" });
    } catch (error) {
        return json({ success: false, error: error.message }, { status: 500 });
    }
}