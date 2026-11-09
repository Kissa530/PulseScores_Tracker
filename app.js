/**
 * PulseScores - Mobile-Optimized Instant Tracker
 * Architecture: Zero-dependency vanilla JS with local state, polling recovery, and localStorage.
 */

(function () {
  'use strict';

  // --- Configuration & Constants ---
  const STORAGE_KEY = 'pulsescores_favorite_team';
  const REFRESH_INTERVAL_LIVE = 15000; // 15 seconds during live games
  const REFRESH_INTERVAL_IDLE = 60000; // 60 seconds otherwise
  
  // Local State
  let favoriteTeamCode = localStorage.getItem(STORAGE_KEY) || '';
  let pollingTimer = null;
  let currentGamesData = [];

  // DOM Elements Cache
  const favoriteSelect = document.getElementById('favorite-select');
  const favoriteContainer = document.getElementById('favorite-game-container');
  const otherContainer = document.getElementById('other-games-container');
  const otherHeading = document.getElementById('other-games-heading');
  const lastUpdatedText = document.getElementById('last-updated-text');
  const statusDot = document.getElementById('status-dot');
  const refreshBtn = document.getElementById('manual-refresh-btn');
  const errorBanner = document.getElementById('error-banner');

  // --- Mock Data Provider (Simulating Free Public Sports API) ---
  // In production, swap fetchMockGames() with fetch('https://api.example.com/games/today')
  function fetchMockGames() {
    return new Promise((resolve, reject) => {
      // Simulate network latency (200-400ms) for fast mobile rendering
      setTimeout(() => {
        // 5% random failure rate to demonstrate quiet error recovery
        if (Math.random() < 0.05) {
          reject(new Error("Network connection timeout"));
          return;
        }

        const mockGames = [
          {
            id: 'g1',
            homeTeam: { code: 'BOS', name: 'Celtics', logo: '🏀' },
            awayTeam: { code: 'LAL', name: 'Lakers', logo: '🏀' },
            homeScore: 98,
            awayScore: 94,
            status: 'LIVE', // LIVE, UPCOMING, FINAL
            period: 'Q4 3:12',
            startTime: '7:30 PM ET'
          },
          {
            id: 'g2',
            homeTeam: { code: 'GSW', name: 'Warriors', logo: '🏀' },
            awayTeam: { code: 'PHX', name: 'Suns', logo: '🏀' },
            homeScore: 112,
            awayScore: 118,
            status: 'FINAL',
            period: 'Final',
            startTime: '5:00 PM ET'
          },
          {
            id: 'g3',
            homeTeam: { code: 'NYK', name: 'Knicks', logo: '🏀' },
            awayTeam: { code: 'MIA', name: 'Heat', logo: '🏀' },
            homeScore: 0,
            awayScore: 0,
            status: 'UPCOMING',
            period: 'Starts 8:00 PM ET',
            startTime: '8:00 PM ET'
          },
          {
            id: 'g4',
            homeTeam: { code: 'CHI', name: 'Bulls', logo: '🏀' },
            awayTeam: { code: 'MIL', name: 'Bucks', logo: '🏀' },
            homeScore: 45,
            awayScore: 52,
            status: 'LIVE',
            period: 'Halftime',
            startTime: '7:00 PM ET'
          }
        ];

        // Slight live score variation on each poll to simulate realtime motion
        const updatedGames = mockGames.map(game => {
          if (game.status === 'LIVE' && Math.random() > 0.4) {
            return {
              ...game,
              homeScore: game.homeScore + Math.floor(Math.random() * 3),
              awayScore: game.awayScore + Math.floor(Math.random() * 3)
            };
          }
          return game;
        });

        resolve(updatedGames);
      }, 300);
    });
  }

  // --- Rendering Functions ---

  function renderGameCard(game, isSpotlight = false) {
    const isHomeFav = game.homeTeam.code === favoriteTeamCode;
    const isAwayFav = game.awayTeam.code === favoriteTeamCode;

    const isLive = game.status === 'LIVE';
    const isFinal = game.status === 'FINAL';

    // Highlight winner scores if final
    const homeWinner = isFinal && game.homeScore > game.awayScore;
    const awayWinner = isFinal && game.awayScore > game.homeScore;

    return `
      <article class="game-card ${isSpotlight ? 'spotlight' : ''}" data-game-id="${game.id}">
        ${isSpotlight ? '<div class="spotlight-badge">⭐ Favorite</div>' : ''}
        
        <div class="game-header">
          <span class="game-status-badge ${game.status.toLowerCase()}">
            ${isLive ? '● LIVE' : game.status}
          </span>
          <span class="game-time-info">${game.period}</span>
        </div>

        <div class="teams-container">
          <!-- Home Team -->
          <div class="team-row">
            <div class="team-info">
              <span class="team-logo">${game.homeTeam.logo}</span>
              <span class="team-name ${isHomeFav ? 'is-favorite' : ''}">
                ${game.homeTeam.name}
              </span>
            </div>
            <span class="team-score ${isFinal ? (homeWinner ? 'winner' : 'loser') : ''}">
              ${game.status === 'UPCOMING' ? '-' : game.homeScore}
            </span>
          </div>

          <!-- Away Team -->
          <div class="team-row">
            <div class="team-info">
              <span class="team-logo">${game.awayTeam.logo}</span>
              <span class="team-name ${isAwayFav ? 'is-favorite' : ''}">
                ${game.awayTeam.name}
              </span>
            </div>
            <span class="team-score ${isFinal ? (awayWinner ? 'winner' : 'loser') : ''}">
              ${game.status === 'UPCOMING' ? '-' : game.awayScore}
            </span>
          </div>
        </div>
      </article>
    `;
  }

  function renderDashboard(games) {
    if (!games || games.length === 0) return;

    let favoriteGame = null;
    let otherGames = [];

    // Filter favorite team game if selected
    if (favoriteTeamCode) {
      favoriteGame = games.find(
        g => g.homeTeam.code === favoriteTeamCode || g.awayTeam.code === favoriteTeamCode
      );
      otherGames = games.filter(
        g => g.homeTeam.code !== favoriteTeamCode && g.awayTeam.code !== favoriteTeamCode
      );
    } else {
      otherGames = games;
    }

    // Render Spotlight Container
    if (favoriteTeamCode) {
      if (favoriteGame) {
        favoriteContainer.innerHTML = renderGameCard(favoriteGame, true);
      } else {
        favoriteContainer.innerHTML = `
          <div class="empty-spotlight">
            <span>No Game Today</span>
            Your team is off today. Check back tomorrow!
          </div>
        `;
      }
    } else {
      favoriteContainer.innerHTML = `
        <div class="empty-spotlight">
          <span>No Favorite Team Selected</span>
          Use the selector above to pin your team to the top!
        </div>
      `;
    }

    // Render Other Games Container
    otherHeading.textContent = favoriteTeamCode ? "Other Games Today" : "Today's Scoreboard";
    otherContainer.innerHTML = otherGames.map(game => renderGameCard(game, false)).join('');
  }

  // --- Data Fetching & State Updates ---

  async function loadScores(isManual = false) {
    if (isManual) {
      refreshBtn.classList.add('spinning');
    }

    try {
      const games = await fetchMockGames();
      currentGamesData = games;
      renderDashboard(games);
      
      // Update timestamps and hide errors on success
      const now = new Date();
      lastUpdatedText.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      errorBanner.classList.add('hidden');
      
      // Adjust polling rate depending on active live games
      const hasLiveGame = games.some(g => g.status === 'LIVE');
      scheduleNextPoll(hasLiveGame ? REFRESH_INTERVAL_LIVE : REFRESH_INTERVAL_IDLE);

    } catch (err) {
      // Quiet Failure Recovery: Show subtle banner, keep existing data intact
      console.warn("PulseScores Fetch warning:", err.message);
      errorBanner.classList.remove('hidden');
      scheduleNextPoll(REFRESH_INTERVAL_LIVE); // Retry sooner on failure
    } finally {
      if (isManual) {
        setTimeout(() => refreshBtn.classList.remove('spinning'), 300);
      }
    }
  }

  function scheduleNextPoll(intervalMs) {
    if (pollingTimer) clearTimeout(pollingTimer);
    pollingTimer = setTimeout(() => loadScores(false), intervalMs);
  }

  // --- Event Handlers & Persistence ---

  function setupEventListeners() {
    // Select team change handler
    favoriteSelect.addEventListener('change', (e) => {
      favoriteTeamCode = e.target.value;
      localStorage.setItem(STORAGE_KEY, favoriteTeamCode);
      renderDashboard(currentGamesData);
    });

    // Manual refresh click handler
    refreshBtn.addEventListener('click', () => {
      loadScores(true);
    });

    // Pause polling when tab is inactive to save battery/data
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (pollingTimer) clearTimeout(pollingTimer);
      } else {
        loadScores(false); // Refresh immediately when tab returns
      }
    });
  }

  // --- Initialization ---

  function init() {
    // Restore favorite team dropdown value if saved
    if (favoriteTeamCode) {
      favoriteSelect.value = favoriteTeamCode;
    }
    
    setupEventListeners();
    loadScores(false); // Initial instant fetch
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
