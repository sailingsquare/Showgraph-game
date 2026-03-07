<script>
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { fade } from 'svelte/transition';
  import confetti from 'canvas-confetti';

  // --- GAME STATE ---
  let guessCount = 0;
  let gameStatus = 'playing'; 
  let currentInput = "";
  let searchResults = [];
  let searchTimeout;
  let isDarkMode = true;
  let isLoading = true; 
  let shareButtonText = "📋 Share Results";
  
  // Instructions State
  let showInstructions = false;
  
  // Tracking past guesses
  let pastGuesses = [];

  const apiKey = env.PUBLIC_TMDB_KEY; 

  let dailyShow = null;

  // --- ARCHIVE STATE ---
  let currentView = 'game'; 
  let realTodayNumber = 1;  
  let activeDayNumber = 1;  
  let allShowIds = [];      
  let playerSaves = {};     

  // --- SVELTE MAGIC: Reactive Declarations ---
  $: maxSeason = dailyShow ? Math.max(...dailyShow.chartData.map(d => d.season)) : 0;
  $: maxEpisode = dailyShow ? Math.max(...dailyShow.chartData.map(d => d.episode)) : 0;
  
  $: seasonList = Array.from({ length: maxSeason }, (_, i) => i + 1);
  $: episodeList = Array.from({ length: maxEpisode }, (_, i) => i + 1);
  
  $: ratingMap = dailyShow ? dailyShow.chartData.reduce((map, d) => {
    map[`${d.season}-${d.episode}`] = d.rating;
    return map;
  }, {}) : {};

  // --- CONFETTI LOGIC ---
  function triggerConfetti() {
    if (typeof window !== 'undefined') {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#4caf50', '#3b82f6', '#fbc02d', '#ffffff']
      });
    }
  }

  // --- INSTRUCTIONS LOGIC ---
  function toggleInstructions() {
    showInstructions = !showInstructions;
    if (showInstructions && typeof window !== 'undefined') {
      localStorage.setItem('showgraph_seen_rules', 'true');
    }
  }

  // --- SAVE / LOAD LOGIC ---
  function saveGameState() {
    if (typeof window !== 'undefined') {
      playerSaves[activeDayNumber] = {
        guessCount: guessCount,
        gameStatus: gameStatus,
        pastGuesses: pastGuesses 
      };
      localStorage.setItem('showgraph_saves_v2', JSON.stringify(playerSaves));
    }
  }

  function loadAllSaves() {
    if (typeof window !== 'undefined') {
      if (!localStorage.getItem('showgraph_seen_rules')) {
        showInstructions = true;
        localStorage.setItem('showgraph_seen_rules', 'true');
      }

      const oldSave = localStorage.getItem('showgraph_save');
      if (oldSave) {
        try {
          const parsedOld = JSON.parse(oldSave);
          if (parsedOld.dayNumber) {
            playerSaves[parsedOld.dayNumber] = { 
              guessCount: parsedOld.guessCount, 
              gameStatus: parsedOld.gameStatus,
              pastGuesses: [] 
            };
          }
          localStorage.removeItem('showgraph_save');
        } catch(e) {}
      }

      const savedData = localStorage.getItem('showgraph_saves_v2');
      if (savedData) {
        try {
          playerSaves = JSON.parse(savedData);
        } catch (e) {
          console.error("Failed to parse save data", e);
        }
      }
    }
  }

  function applyDayState(day) {
    if (playerSaves[day]) {
      guessCount = playerSaves[day].guessCount;
      gameStatus = playerSaves[day].gameStatus;
      pastGuesses = playerSaves[day].pastGuesses || []; 
    } else {
      guessCount = 0;
      gameStatus = 'playing';
      pastGuesses = []; 
    }
  }

  // --- AUTOMATED ENGINE ---
  async function initGameEngine() {
    loadAllSaves();

    const launchDate = new Date(2026, 2, 1); 
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = today.getTime() - launchDate.getTime();
    realTodayNumber = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);

    const allowedRegions = ["US", "JP", "KR", "GB", "IN", "FR", "DE", "MX", "BR"];
    const excludedGenres = [10763, 10767];

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
      
      allShowIds = showIds;
      playSpecificDay(realTodayNumber);

    } catch (error) {
      console.error("Error building show pool:", error);
      allShowIds = [1396]; 
      playSpecificDay(realTodayNumber);
    }
  }

  async function playSpecificDay(dayTarget) {
    isLoading = true;
    currentView = 'game';
    activeDayNumber = dayTarget;
    currentInput = "";
    searchResults = [];
    
    applyDayState(activeDayNumber);
    
    const todaysId = allShowIds[(activeDayNumber - 1) % allShowIds.length];
    await loadDailyShow(todaysId);
  }

  async function loadDailyShow(tmdbId) {
    try {
      const showRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}&append_to_response=credits,keywords`);
      const showData = await showRes.json();
      let fetchedChartData = [];

      for (let s = 1; s <= showData.number_of_seasons; s++) {
        const seasonRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${s}?api_key=${apiKey}`);
        const seasonData = await seasonRes.json();
        
        if (seasonData.episodes) {
          seasonData.episodes.forEach((ep, index) => {
            if (ep.vote_average > 0) {
              fetchedChartData.push({ 
                season: s, 
                episode: index + 1, 
                rating: ep.vote_average 
              });
            }
          });
        }
      }

      const mainActorName = showData.credits && showData.credits.cast.length > 0 
        ? showData.credits.cast[0].name 
        : "Unknown";
        
      const topKeywords = showData.keywords && showData.keywords.results.length > 0
        ? showData.keywords.results.slice(0, 3).map(k => k.name).join(", ")
        : "None";

      dailyShow = {
        title: showData.name,
        hints: {
          network: showData.networks.length > 0 ? showData.networks[0].name : "Unknown",
          genre: showData.genres.map(g => g.name).join(", "),
          releaseYears: `${showData.first_air_date.substring(0,4)} - ${showData.status === "Ended" && showData.last_air_date ? showData.last_air_date.substring(0,4) : "Present"}`,
          totalReviews: showData.vote_count.toLocaleString(),
          mainActor: mainActorName,
          keywords: topKeywords
        },
        chartData: fetchedChartData
      };
      
      isLoading = false;
    } catch (error) {
      console.error("Failed to load show data:", error);
      isLoading = false;
    }
  }

  onMount(() => {
    if (typeof document !== 'undefined') {
      document.body.style.backgroundColor = isDarkMode ? '#121212' : '#f9fafb';
    }
    initGameEngine(); 
  });

  // --- GAME LOGIC ---
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

  function toggleView() {
    currentView = currentView === 'game' ? 'archive' : 'game';
  }

  async function searchTMDB(query) {
    if (query.length < 2) { searchResults = []; return; }
    const url = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=en-US&page=1`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.results) { searchResults = data.results.slice(0, 5); }
    } catch (error) { console.error("Error searching:", error); }
  }

  function handleInput(event) {
    currentInput = event.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { searchTMDB(currentInput); }, 300); 
  }

  function handleKeydown(event) {
    if (event.key === 'Enter') {
      handleGuess();
    }
  }

  function selectShow(showName) {
    currentInput = showName;
    searchResults = []; 
  }

  function handleGuess() {
    if (gameStatus !== 'playing' || isLoading || !dailyShow || currentInput.trim() === "") return;
    
    pastGuesses = [...pastGuesses, currentInput];

    if (currentInput.toLowerCase() === dailyShow.title.toLowerCase()) {
      gameStatus = 'won';
      triggerConfetti(); 
    } else {
      guessCount += 1;
      if (guessCount >= 6) gameStatus = 'lost';
    }
    
    saveGameState();
    
    currentInput = ""; 
    searchResults = []; 
  }

  function shareResults() {
    const finalScore = gameStatus === 'won' ? guessCount + 1 : 'X';
    let emojiBoxes = '';
    
    for (let i = 0; i < 6; i++) {
      if (i < guessCount) emojiBoxes += '🟥';
      else if (i === guessCount && gameStatus === 'won') emojiBoxes += '🟩';
      else emojiBoxes += '⬛';
    }
    
    // CHANGED: Now says Teledle instead of ShowGraph
    const shareText = `Teledle #${activeDayNumber} 📺\nScore: ${finalScore}/6\n${emojiBoxes}\nPlay at: https://showgraph-game.vercel.app/`;
    
    navigator.clipboard.writeText(shareText).then(() => {
      shareButtonText = "✅ Copied!";
      setTimeout(() => { shareButtonText = "📋 Share Results"; }, 2000);
    });
  }
</script>

<div class="theme-wrapper {isDarkMode ? 'dark-theme' : 'light-theme'}">
  
  {#if showInstructions}
    <div class="modal-backdrop" on:click={toggleInstructions} in:fade={{ duration: 200 }}>
      <div class="modal-content" on:click|stopPropagation>
        <h2>How to Play Teledle 📺</h2>
        <p>Guess the hidden TV show based solely on the IMDb ratings of its episodes!</p>
        
        <ul class="instructions-list">
          <li><strong>The Heatmap:</strong> Each row is a season, and each box is an episode.</li>
          <li><strong>The Colors:</strong> The colors represent the average rating:
            <div class="legend-row">
              <span class="legend-box" style="background-color: #d32f2f;">&lt; 6.0</span>
              <span class="legend-box" style="background-color: #f57c00;">6.0+</span>
              <span class="legend-box" style="background-color: #fbc02d;">7.0+</span>
              <span class="legend-box" style="background-color: #4caf50;">8.0+</span>
              <span class="legend-box" style="background-color: #2e7d32;">9.0+</span>
              <span class="legend-box" style="background-color: #3b82f6;">9.7+</span>
            </div>
          </li>
          <li><strong>Hints:</strong> You have 6 tries. Every incorrect guess unlocks a new hint about the show.</li>
          <li><strong>New Games:</strong> A new puzzle unlocks every day at midnight!</li>
        </ul>

        <button class="submit-btn" style="width: 100%; margin-top: 15px;" on:click={toggleInstructions}>Let's Play!</button>
      </div>
    </div>
  {/if}

  <div class="game-container">
    <header class="game-header">
      <div class="header-titles">
        <h1>Teledle</h1>
        <span class="day-badge">Day #{activeDayNumber}</span>
      </div>
      <div class="header-actions">
        <button class="theme-btn icon-btn" on:click={toggleInstructions} title="How to Play">❓</button>
        <button class="theme-btn" on:click={toggleView}>
          {currentView === 'game' ? '📚 Past Puzzles' : '🎮 Back to Game'}
        </button>
        <button class="theme-btn icon-btn" on:click={toggleTheme}>
          {isDarkMode ? '☀️' : '🌙'}
        </button>
      </div>
    </header>

    {#if isLoading}
      <div class="loading-state">
        <h2>Loading puzzle... 📺</h2>
      </div>
    {:else if currentView === 'archive'}
      <div class="archive-container" in:fade={{ duration: 200 }}>
        <h2>Puzzle Archive</h2>
        <p>Catch up on past TV shows you might have missed.</p>
        
        <div class="archive-grid">
          {#each Array.from({ length: realTodayNumber }, (_, i) => i + 1) as day}
            {@const save = playerSaves[day]}
            <button 
              class="archive-btn {save ? save.gameStatus : 'unplayed'} {day === activeDayNumber ? 'active-puzzle' : ''}" 
              on:click={() => playSpecificDay(day)}
            >
              <div class="archive-day">Day {day}</div>
              <div class="archive-status">
                {#if save && save.gameStatus === 'won'} 🟩
                {:else if save && save.gameStatus === 'lost'} 🟥
                {:else if save && save.gameStatus === 'playing'} 🔄
                {:else} ⬜ {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>

    {:else}
      <div class="heatmap-wrapper" in:fade={{ duration: 200 }}>
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
        <h3>Hints</h3>
        <div class="hints-grid">
          <div class="hint-card">
            <span class="hint-label">Release Run</span>
            <span class="hint-value">{dailyShow.hints.releaseYears}</span>
          </div>
          <div class="hint-card">
            <span class="hint-label">Total Reviews</span>
            <span class="hint-value">{dailyShow.hints.totalReviews}</span>
          </div>

          {#if guessCount >= 1 || gameStatus !== 'playing'} 
            <div class="hint-card" in:fade={{ duration: 600 }}>
              <span class="hint-label">Genre</span>
              <span class="hint-value">{dailyShow.hints.genre}</span>
            </div>
          {/if}
          
          {#if guessCount >= 2 || gameStatus !== 'playing'} 
            <div class="hint-card" in:fade={{ duration: 600 }}>
              <span class="hint-label">Original Airing Network</span>
              <span class="hint-value">{dailyShow.hints.network}</span>
            </div>
          {/if}

          {#if guessCount >= 3 || gameStatus !== 'playing'} 
            <div class="hint-card" in:fade={{ duration: 600 }}>
              <span class="hint-label">Main Actor</span>
              <span class="hint-value">{dailyShow.hints.mainActor}</span>
            </div>
          {/if}

          {#if guessCount >= 4 || gameStatus !== 'playing'} 
            <div class="hint-card" in:fade={{ duration: 600 }}>
              <span class="hint-label">Keywords</span>
              <span class="hint-value" style="text-transform: capitalize;">{dailyShow.hints.keywords}</span>
            </div>
          {/if}
        </div>
      </div>

      {#if pastGuesses.length > 0}
        <div class="past-guesses-container" in:fade={{ duration: 300 }}>
          <h4>Your Guesses</h4>
          <ul class="guesses-list">
            {#each pastGuesses as guess, index}
              <li class="guess-item">
                <span class="guess-icon">
                  {#if index === pastGuesses.length - 1 && gameStatus === 'won'}
                    ✅
                  {:else}
                    ❌
                  {/if}
                </span>
                <span class="guess-text">{guess}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if gameStatus !== 'playing'}
        <div class="end-screen">
          {#if gameStatus === 'won'}
            <h2>🎉 You Win! The show was {dailyShow.title}!</h2>
            <p>Guessed in {guessCount + 1} tries.</p>
          {:else}
            <h2>Game Over. 😢 The show was {dailyShow.title}.</h2>
          {/if}
          <button class="share-btn" on:click={shareResults}>{shareButtonText}</button>
          
          {#if activeDayNumber < realTodayNumber}
             <button class="next-btn" on:click={() => playSpecificDay(activeDayNumber + 1)}>⏭️ Next Puzzle</button>
          {/if}
        </div>
      {:else}
        <p class="guess-counter">Guesses remaining: {6 - guessCount}</p>
        
        <div class="input-row">
          <div class="search-container">
              <input 
                type="text" 
                class="search-input" 
                value={currentInput} 
                on:input={handleInput} 
                on:keydown={handleKeydown}
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

  /* --- THEME COLORS --- */
  .dark-theme {
    --bg-color: #121212;
    --text-color: #f5f5f5;
    --heatmap-bg: #1e1e1e;
    --input-bg: #333;
    --input-border: #444;
    --dropdown-hover: #444;
    --btn-bg: #4caf50;
    --btn-text: #fff;
    --share-bg: #3b82f6; 
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
    --share-bg: #10b981; 
  }

  /* --- LAYOUT --- */
  .game-container {
    width: 100%;
    max-width: 600px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .game-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--input-border);
    padding-bottom: 15px;
  }

  .header-titles {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .day-badge {
    background-color: var(--input-border);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 0.8em;
    font-weight: bold;
    color: var(--text-color);
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .theme-btn {
    background: transparent;
    border: 1px solid var(--input-border);
    color: var(--text-color);
    padding: 6px 12px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 14px;
    transition: background-color 0.2s;
  }

  .icon-btn {
    padding: 6px 10px;
  }

  .theme-btn:hover {
    background-color: var(--input-border);
  }

  /* --- MODAL (HOW TO PLAY) --- */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    padding: 20px;
    box-sizing: border-box;
  }

  .modal-content {
    background-color: var(--bg-color);
    color: var(--text-color);
    padding: 30px;
    border-radius: 12px;
    max-width: 450px;
    width: 100%;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    border: 1px solid var(--input-border);
  }

  .modal-content h2 {
    margin-top: 0;
    margin-bottom: 10px;
  }

  .instructions-list {
    line-height: 1.6;
    padding-left: 20px;
    margin-bottom: 25px;
  }

  .instructions-list li {
    margin-bottom: 10px;
  }

  .legend-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .legend-box {
    color: white;
    font-size: 0.8em;
    font-weight: bold;
    padding: 4px 8px;
    border-radius: 4px;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
  }

  /* --- ARCHIVE UI --- */
  .archive-container {
    width: 100%;
    text-align: center;
  }

  .archive-container p {
    color: #888;
    margin-bottom: 20px;
  }

  .archive-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 12px;
    width: 100%;
  }

  .archive-btn {
    background-color: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--text-color);
    padding: 15px 10px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    transition: transform 0.1s, box-shadow 0.2s;
  }

  .archive-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  }

  .archive-btn.active-puzzle {
    border: 2px solid var(--btn-bg);
  }

  .archive-day {
    font-weight: bold;
    font-size: 0.9em;
  }

  .archive-status {
    font-size: 1.2em;
  }

  /* --- HEATMAP --- */
  .heatmap-wrapper {
    background-color: var(--heatmap-bg);
    padding: 20px;
    border-radius: 12px;
    margin-bottom: 20px;
    max-width: 100%;
    overflow-x: auto;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  }
  
  .heatmap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .heatmap-row {
    display: flex;
    gap: 4px;
  }
  
  .heatmap-cell {
    width: 40px;
    height: 35px;
    min-width: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 14px;
    border-radius: 4px;
  }
  
  .heatmap-cell.header {
    color: #888;
    font-size: 12px;
    font-weight: normal;
  }
  
  .heatmap-cell.empty {
    background-color: transparent;
  }
  
  .rating-box {
    color: white;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
  }

  /* --- HINTS UI --- */
  .hint-box {
    width: 100%;
    max-width: 500px;
    margin-bottom: 20px;
    text-align: center;
  }
  
  .hint-box h3 {
    margin-bottom: 15px;
    color: var(--text-color);
  }

  .hints-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr); 
    gap: 12px;
  }

  .hint-card {
    background-color: var(--input-bg);
    border: 1px solid var(--input-border);
    padding: 16px;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  }

  .hint-label {
    font-size: 0.75em;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }

  .hint-value {
    font-size: 1em;
    font-weight: bold;
    color: var(--text-color);
  }

  @media (max-width: 400px) {
    .hints-grid {
      grid-template-columns: 1fr; 
    }
  }

  /* --- PAST GUESSES UI --- */
  .past-guesses-container {
    width: 100%;
    max-width: 450px;
    margin-bottom: 20px;
    text-align: left;
    background-color: var(--heatmap-bg);
    padding: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    border: 1px solid var(--input-border);
  }

  .past-guesses-container h4 {
    margin: 0 0 10px 0;
    color: var(--text-color);
    font-size: 0.9em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--input-border);
    padding-bottom: 5px;
  }

  .guesses-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .guess-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95em;
    color: var(--text-color);
    background-color: var(--input-bg);
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid var(--input-border);
  }

  .guess-icon {
    font-size: 0.9em;
  }

  .guess-text {
    font-weight: 500;
  }

  /* --- UI ELEMENTS --- */
  .guess-counter {
    font-weight: bold;
    margin-bottom: 10px;
  }

  .input-row {
    display: flex;
    gap: 10px;
    width: 100%;
    max-width: 450px;
    margin-bottom: 20px;
  }
  
  .search-container {
    position: relative;
    flex: 1;
  }
  
  .search-input {
    width: 100%;
    height: 100%;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--input-border);
    background-color: var(--input-bg);
    color: var(--text-color);
    font-size: 16px;
    box-sizing: border-box;
  }

  .dropdown-list {
    position: absolute;
    background-color: var(--input-bg);
    border: 1px solid var(--input-border);
    width: 100%;
    list-style: none;
    padding: 0;
    z-index: 10;
    margin-top: 4px;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
  }
  
  .dropdown-item {
    padding: 10px;
    cursor: pointer;
    border-bottom: 1px solid var(--input-border);
    transition: background-color 0.2s;
  }
  
  .dropdown-item:last-child {
    border-bottom: none;
  }
  
  .dropdown-item:hover {
    background-color: var(--dropdown-hover);
  }

  .year-text {
    font-size: 0.8em;
    color: #888;
  }

  .submit-btn {
    background-color: var(--btn-bg);
    color: var(--btn-text);
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    font-weight: bold;
    font-size: 16px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.2s;
  }
  
  .submit-btn:hover {
    opacity: 0.9;
  }

  .loading-state {
    padding: 50px;
    text-align: center;
  }
  
  .end-screen {
    text-align: center;
  }
  
  .share-btn, .next-btn {
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    margin: 15px 5px 0 5px;
    transition: transform 0.1s, opacity 0.2s;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
  }

  .share-btn {
    background-color: var(--share-bg);
  }
  
  .next-btn {
    background-color: var(--input-border);
    color: var(--text-color);
  }
  
  .share-btn:hover, .next-btn:hover { opacity: 0.9; }
  .share-btn:active, .next-btn:active { transform: scale(0.97); }

  /* --- MOBILE RESPONSIVE LAYOUT --- */
  @media (max-width: 500px) {
    .game-header {
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .header-titles {
      width: 100%;
      justify-content: center;
    }
    .header-actions {
      width: 100%;
      justify-content: center;
      flex-wrap: wrap; 
    }
    
    .hints-grid {
      grid-template-columns: 1fr; 
    }

    .input-row {
      flex-direction: column;
      align-items: stretch;
    }
    .submit-btn {
      width: 100%;
      padding: 15px 20px; 
    }
  }
</style>