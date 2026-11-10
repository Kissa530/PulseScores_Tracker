/**
 * PulseScores - Mobile-Optimized Instant Tracker
 * Architecture: Zero-dependency vanilla JS with local state, polling recovery, and localStorage.
 */
(function () {
  'use strict';

  // --- Supabase Configuration ---
  const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
  const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const STORAGE_KEY = 'pulsescores_favorite_team';
  let favoriteTeamCode = localStorage.getItem(STORAGE_KEY) || '';
  let currentGamesData = [];

  // DOM Elements Cache
  const favoriteSelect = document.getElementById('favorite-select');
  const favoriteContainer = document.getElementById('favorite-game-container');
  const otherContainer = document.getElementById('other-games-container');
  const otherHeading = document.getElementById('other-games-heading');
  const lastUpdatedText = document.getElementById('last-updated-text');
  const refreshBtn = document.getElementById('manual-refresh-btn');
  const errorBanner = document.getElementById('error-banner');

  // --- Fetch Games from Supabase Database ---
  async function fetchGamesFromSupabase(isManual = false) {
    if (isManual) refreshBtn.classList.add('spinning');

    try {
      const { data, error } = await supabaseClient
        .from('games')
        .select('*');

      if (error) throw error;

      currentGamesData = data || [];
      renderDashboard(currentGamesData);

      const now = new Date();
      lastUpdatedText.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      errorBanner.classList.add('hidden');
    } catch (err) {
      console.warn("Supabase fetch warning:", err.message);
      errorBanner.classList.remove('hidden');
    } finally {
      if (isManual) {
        setTimeout(() => refreshBtn.classList.remove('spinning'), 300);
      }
    }
  }

  // --- Set Up Supabase Realtime Subscription ---
  function setupRealtimeSubscription() {
    supabaseClient
      .channel('public:games')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, (payload) => {
        // Instantly catch updates pushed from your backend/edge function
        fetchGamesFromSupabase(false);
      })
      .subscribe();
  }

  // --- Rendering & Event Handling ---
  function renderGameCard(game, isSpotlight = false) {
    const isHomeFav = game.home_team_code === favoriteTeamCode;
    const isAwayFav = game.away_team_code === favoriteTeamCode;
    const isLive = game.status === 'LIVE';
    const isFinal = game.status === 'FINAL';

    const homeWinner = isFinal && game.home_score > game.away_score;
    const awayWinner = isFinal && game.away_score > game.home_score;

    return `
      <article class="game-card ${isSpotlight ? 'spotlight' : ''}">
        ${isSpotlight ? '<div class="spotlight-badge">⭐ Favorite</div>' : ''}
        <div class="game-header">
          <span class="game-status-badge ${game.status.toLowerCase()}">${isLive ? '● LIVE' : game.status}</span>
          <span class="game-time-info">${game.period}</span>
        </div>
        <div class="teams-container">
          <div class="team-row">
            <div class="team-info">
              <span class="team-logo">${game.home_team_logo}</span>
              <span class="team-name ${isHomeFav ? 'is-favorite' : ''}">${game.home_team_name}</span>
            </div>
            <span class="team-score ${isFinal ? (homeWinner ? 'winner' : 'loser') : ''}">
              ${game.status === 'UPCOMING' ? '-' : game.home_score}
            </span>
          </div>
          <div class="team-row">
            <div class="team-info">
              <span class="team-logo">${game.away_team_logo}</span>
              <span class="team-name ${isAwayFav ? 'is-favorite' : ''}">${game.away_team_name}</span>
            </div>
            <span class="team-score ${isFinal ? (awayWinner ? 'winner' : 'loser') : ''}">
              ${game.status === 'UPCOMING' ? '-' : game.away_score}
            </span>
          </div>
        </div>
      </article>
    `;
  }

  function renderDashboard(games) {
    if (!games) return;
    let favoriteGame = null;
    let otherGames = [];

    if (favoriteTeamCode) {
      favoriteGame = games.find(g => g.home_team_code === favoriteTeamCode || g.away_team_code === favoriteTeamCode);
      otherGames = games.filter(g => g.home_team_code !== favoriteTeamCode && g.away_team_code !== favoriteTeamCode);
    } else {
      otherGames = games;
    }

    if (favoriteTeamCode) {
      favoriteContainer.innerHTML = favoriteGame ? renderGameCard(favoriteGame, true) : `<div class="empty-spotlight"><span>No Game Today</span>Your team is off today.</div>`;
    } else {
      favoriteContainer.innerHTML = `<div class="empty-spotlight"><span>No Favorite Team Selected</span>Select a team above!</div>`;
    }

    otherHeading.textContent = favoriteTeamCode ? "Other Games Today" : "Today's Scoreboard";
    otherContainer.innerHTML = otherGames.map(g => renderGameCard(g, false)).join('');
  }

  function init() {
    if (favoriteTeamCode) favoriteSelect.value = favoriteTeamCode;

    favoriteSelect.addEventListener('change', (e) => {
      favoriteTeamCode = e.target.value;
      localStorage.setItem(STORAGE_KEY, favoriteTeamCode);
      renderDashboard(currentGamesData);
    });

    refreshBtn.addEventListener('click', () => fetchGamesFromSupabase(true));

    fetchGamesFromSupabase(false);
    setupRealtimeSubscription();
  }

  document.addEventListener('DOMContentLoaded', init);
})();




