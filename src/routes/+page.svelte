<script>
  import { onMount } from 'svelte';

  // --- GAME STATE ---
  let guessCount = 0;
  let gameStatus = 'playing'; 
  let currentInput = "";
  let searchResults = [];
  let searchTimeout;
  let isDarkMode = true;
  let isLoading = true; 

  // NEW: Variables for the Share feature
  let dayNumber = 1;
  let shareButtonText = "📋 Share Results";

  import { PUBLIC_TMDB_KEY } from '$env/static/public';
  const apiKey = PUBLIC_TMDB_KEY;

  let dailyShow = null;

  // --- SVELTE MAGIC: Reactive Declarations ---
  $: maxSeason = dailyShow ? Math.max(...dailyShow.chartData.map(d => d.season)) : 0;
  $: maxEpisode = dailyShow ? Math.max(...dailyShow.chartData.map(d => d.episode)) : 0;
  
  $: seasonList = Array.from({ length: maxSeason }, (_, i) => i + 1);
  $: episodeList = Array.from({ length: maxEpisode }, (_, i) => i + 1);
  
  $: ratingMap = dailyShow ? dailyShow.chartData.reduce((map, d) => {
    map[`${d.season}-${d.episode}`] = d.rating;
    return map;
  }, {}) : {};

// NEW: Instead of a manual list, we will store our 365+ IDs here
  let automatedShowPool = [];

  async function getAutomatedDailyShow() {
    // 1. Calculate the 'Day Offset' from your launch date
    const launchDate = new Date("2026-03-01T00:00:00Z");
    const today = new Date();
    const diffTime = today - launchDate;
    const dayIndex = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    
    // Update the global dayNumber for the Share button
    dayNumber = dayIndex + 1;

    try {
      // 2. Fetch the top 400 shows (20 pages of 20 results each)
      // We only do this once to populate our year-long pool
      let showIds = [];
      for (let i = 1; i <= 20; i++) {
        const res = await fetch(`https://api.themoviedb.org/3/tv/top_rated?api_key=${apiKey}&language=en-US&page=${i}`);
        const data = await res.json();
        if (data.results) {
          showIds = [...showIds, ...data.results.map(show => show.id)];
        }
      }

      // 3. Pick today's ID from the list
      // The modulo (%) ensures if you run out of shows, it loops back to the best one
      const todaysId = showIds[dayIndex % showIds.length];
      
      // 4. Load the data for that show
      loadDailyShow(todaysId);

    } catch (error) {
      console.error("Error building automated show pool:", error);
      // Fallback to a classic if the top_rated fetch fails
      loadDailyShow(1396); 
    }
  }

  onMount(() => {
    if (typeof document !== 'undefined') {
      document.body.style.backgroundColor = isDarkMode ? '#121212' : '#f9fafb';
    }
    // Call the new automated function instead of the manual one
    getAutomatedDailyShow(); 
  });

  // --- TMDB FETCHING ---
  async function loadDailyShow(tmdbId) {
    try {
      const showRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}`);
      const showData = await showRes.json();

      let fetchedChartData = [];

      for (let s = 1; s <= showData.number_of_seasons; s++) {
        const seasonRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${s}?api_key=${apiKey}`);
        const seasonData = await seasonRes.json();

        if (seasonData.episodes) {
          seasonData.episodes.forEach(ep => {
            if (ep.vote_average > 0) {
              fetchedChartData.push({
                season: s,
                episode: ep.episode_number,
                rating: ep.vote_average
              });
            }
          });
        }
      }

      dailyShow = {
        title: showData.name,
        hints: {
          network: showData.networks.length > 0 ? showData.networks[0].name : "Unknown",
          genre: showData.genres.map(g => g.name).join(", "),
          releaseYears: `${showData.first_air_date.substring(0,4)} - ${showData.status === "Ended" && showData.last_air_date ? showData.last_air_date.substring(0,4) : "Present"}`
        },
        chartData: fetchedChartData
      };

      isLoading = false;

    } catch (error) {
      console.error("Failed to load show data:", error);
      alert("Uh oh! Could not load today's show. Check your API key or internet connection.");
      isLoading = false;
    }
  }

  onMount(() => {
    if (typeof document !== 'undefined') {
      document.body.style.backgroundColor = isDarkMode ? '#121212' : '#f9fafb';
    }
    const todaysId = getTodaysShowId();
    loadDailyShow(todaysId); 
  });

  // --- UI & GAME LOGIC ---
  function getRatingColor(rating) {
    if (rating >= 9.7) return '#3b82f6'; 
    if (rating >= 9.0) return '#2e7d32'; 
    if (rating >= 8.0) return '#4caf50'; 
    if (rating >= 7.0) return '#fbc02d'; 
    if (rating >= 6.0) return '#f57c00'; 
    return '#d32f2f';                    
  }

  function toggleTheme() {
    isDarkMode = !isDarkMode;
    if (typeof document !== 'undefined') {
      document.body.style.backgroundColor = isDarkMode ? '#121212' : '#f9fafb';
    }
  }

  async function searchTMDB(query) {
    if (query.length < 2) { searchResults = []; return; }
    const url = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=en-US&page=1`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.results) {
        searchResults = data.results.slice(0, 5); 
      } else {
        searchResults = [];
      }
    } catch (error) { console.error("Error fetching data:", error); }
  }

  function handleInput(event) {
    currentInput = event.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { searchTMDB(currentInput); }, 300); 
  }

  function selectShow(showName) {
    currentInput = showName;
    searchResults = []; 
  }

  function handleGuess() {
    if (gameStatus !== 'playing' || isLoading || !dailyShow || currentInput.trim() === "") return;
    
    if (currentInput.toLowerCase() === dailyShow.title.toLowerCase()) {
      gameStatus = 'won';
    } else {
      guessCount += 1;
      if (guessCount >= 6) gameStatus = 'lost';
    }
    currentInput = ""; 
    searchResults = []; 
  }

  // NEW: The Share Function!
  function shareResults() {
    const finalScore = gameStatus === 'won' ? guessCount + 1 : 'X';
    let emojiBoxes = '';
    
    // Loop 6 times to build the boxes
    for (let i = 0; i < 6; i++) {
      if (i < guessCount) {
        emojiBoxes += '🟥'; // Wrong guesses
      } else if (i === guessCount && gameStatus === 'won') {
        emojiBoxes += '🟩'; // The winning guess
      } else {
        emojiBoxes += '⬛'; // Unused guesses
      }
    }

    const shareText = `ShowGraph #${dayNumber} 📺\nScore: ${finalScore}/6\n${emojiBoxes}\nPlay at: localhost:5173`;

    // Copies to the user's clipboard
    navigator.clipboard.writeText(shareText).then(() => {
      shareButtonText = "✅ Copied!";
      // Reset the button text after 2 seconds
      setTimeout(() => { shareButtonText = "📋 Share Results"; }, 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      shareButtonText = "❌ Error";
    });
  }
</script>

<div class="theme-wrapper {isDarkMode ? 'dark-theme' : 'light-theme'}">
  <div class="game-container">
    
    <header class="game-header">
      <h1>ShowGraph</h1>
      <button class="theme-btn" on:click={toggleTheme}>
        {isDarkMode ? '☀️ Light' : '🌙 Dark'}
      </button>
    </header>

    {#if isLoading}
      <div style="padding: 50px; text-align: center;">
        <h2>Loading today's puzzle... 📺</h2>
      </div>
    {:else}
      <div class="heatmap-wrapper">
        <div class="heatmap">
          <div class="heatmap-row">
            <div class="heatmap-cell empty"></div>
            {#each seasonList as s}
              <div class="heatmap-cell header">S{s}</div>
            {/each}
          </div>
          {#each episodeList as e}
            <div class="heatmap-row">
              <div class="heatmap-cell header">E{e}</div>
              {#each seasonList as s}
                {@const rating = ratingMap[s + '-' + e]}
                {#if rating}
                  <div class="heatmap-cell rating-box" style="background-color: {getRatingColor(rating)};">
                    {rating.toFixed(1)}
                  </div>
                {:else} 
                  <div class="heatmap-cell empty"></div>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      </div>
      
      <div class="hint-box">
        <h3>Hints:</h3>
        {#if guessCount >= 2} <p><strong>Network:</strong> {dailyShow.hints.network}</p> {/if}
        {#if guessCount >= 4} <p><strong>Genre:</strong> {dailyShow.hints.genre}</p> {/if}
        {#if guessCount >= 5} <p><strong>Release Run:</strong> {dailyShow.hints.releaseYears}</p> {/if}
      </div>

      {#if gameStatus === 'won'}
        <div class="end-screen">
          <h2>🎉 You Win! The show was {dailyShow.title}!</h2>
          <p>Guessed in {guessCount + 1} tries.</p>
          <button class="share-btn" on:click={shareResults}>{shareButtonText}</button>
        </div>
      {/if}

      {#if gameStatus === 'lost'}
        <div class="end-screen">
          <h2>Game Over. 😢 The show was {dailyShow.title}.</h2>
          <button class="share-btn" on:click={shareResults}>{shareButtonText}</button>
        </div>
      {/if}

      {#if gameStatus === 'playing'}
        <p class="guess-counter">Guesses remaining: {6 - guessCount}</p>
        
        <div class="input-row">
          <div class="search-container">
              <input 
                type="text" 
                class="search-input"
                value={currentInput} 
                on:input={handleInput} 
                placeholder="Search for a TV show..." 
              />
              {#if searchResults.length > 0}
                <ul class="dropdown-list">
                  {#each searchResults as result}
                    <li on:click={() => selectShow(result.name)} class="dropdown-item">
                      <strong>{result.name}</strong> 
                      {#if result.first_air_date} <span class="year-text">({result.first_air_date.substring(0,4)})</span> {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
          </div>
          <button class="submit-btn" on:click={handleGuess}>Submit Guess</button>
        </div>
      {/if}
    {/if}

  </div>
</div>

<style>
  /* --- GLOBALS --- */
  :global(body) {
    margin: 0;
    padding: 0;
    background-color: #121212; 
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  .theme-wrapper {
    min-height: 100vh;
    width: 100%;
    display: flex;
    justify-content: center;
    background-color: var(--bg-color);
    color: var(--text-color);
    transition: background-color 0.3s ease, color 0.3s ease;
  }

  .dark-theme {
    --bg-color: #121212;
    --text-color: #f5f5f5;
    --heatmap-bg: #1e1e1e;
    --input-bg: #333;
    --input-border: #444;
    --dropdown-hover: #444;
    --btn-bg: #4caf50;
    --btn-text: #fff;
    --share-bg: #3b82f6; /* Blue share button */
  }

  .light-theme {
    --bg-color: #f9fafb;
    --text-color: #111827;
    --heatmap-bg: #ffffff;
    --input-bg: #ffffff;
    --input-border: #d1d5db;
    --dropdown-hover: #f3f4f6;
    --btn-bg: #3b82f6;
    --btn-text: #fff;
    --share-bg: #10b981; /* Green share button */
  }

  /* ... Keep all your other CSS exactly the same ... */

  .game-container { width: 100%; max-width: 600px; padding: 20px; display: flex; flex-direction: column; align-items: center; }
  .game-header { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 20px; border-bottom: 1px solid var(--input-border); padding-bottom: 10px; }
  .theme-btn { background: transparent; border: 1px solid var(--input-border); color: var(--text-color); padding: 6px 12px; border-radius: 20px; cursor: pointer; font-size: 14px; transition: background-color 0.2s; }
  .theme-btn:hover { background-color: var(--input-border); }
  
  .heatmap-wrapper { background-color: var(--heatmap-bg); padding: 20px; border-radius: 12px; display: inline-block; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); transition: background-color 0.3s ease; max-width: 100%; overflow-x: auto; }
  .heatmap { display: flex; flex-direction: column; gap: 4px; }
  .heatmap-row { display: flex; gap: 4px; }
  .heatmap-cell { width: 40px; height: 35px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; border-radius: 4px; min-width: 40px; }
  .heatmap-cell.header { color: #888; font-weight: normal; font-size: 12px; }
  .heatmap-cell.empty { background-color: transparent; }
  .rating-box { color: white; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); }

  .hint-box { width: 100%; text-align: left; margin-bottom: 20px; }
  .guess-counter { font-weight: bold; margin-bottom: 10px; }

  .input-row { display: flex; gap: 10px; width: 100%; max-width: 450px; margin-bottom: 20px; }
  .search-container { position: relative; flex: 1; }
  .search-input { width: 100%; height: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--input-border); background-color: var(--input-bg); color: var(--text-color); font-size: 16px; }
  .dropdown-list { position: absolute; background-color: var(--input-bg); border: 1px solid var(--input-border); border-radius: 6px; width: 100%; padding: 0; margin: 4px 0 0 0; list-style: none; z-index: 10; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2); overflow: hidden; }
  .dropdown-item { padding: 10px; cursor: pointer; border-bottom: 1px solid var(--input-border); transition: background-color 0.2s; }
  .dropdown-item:last-child { border-bottom: none; }
  .dropdown-item:hover { background-color: var(--dropdown-hover); }
  .year-text { font-size: 0.8em; color: #888; }
  .submit-btn { background-color: var(--btn-bg); color: var(--btn-text); border: none; padding: 10px 20px; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; transition: opacity 0.2s; white-space: nowrap; }
  .submit-btn:hover { opacity: 0.9; }

  /* NEW: End screen styling and share button */
  .end-screen {
    text-align: center;
    margin-top: 10px;
  }

  .share-btn {
    background-color: var(--share-bg);
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    margin-top: 15px;
    transition: transform 0.1s, opacity 0.2s;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
  }

  .share-btn:hover { opacity: 0.9; }
  .share-btn:active { transform: scale(0.97); } /* Gives a satisfying little "click" animation */
</style>