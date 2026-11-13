/**
 * PulseScores - Supabase Connected Tracker
 * Architecture: Supabase Client, LocalStorage, Realtime sync, and Auth.
 */

(function () {
  'use strict';

  // --- Supabase Configuration ---
  // Replace these placeholders with your actual Supabase project URL and anon public key in v1
  const SUPABASE_URL = SUPABASE_URL; 
  const SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- Constants & State ---
  const STORAGE_KEY = 'pulsescores_favorite_team';
  let favoriteTeamCode = localStorage.getItem(STORAGE_KEY) || '';
  let currentGamesData = [];
  let currentUser = null;
  let isSignUpMode = false;

  // --- DOM Elements Cache ---
  const favoriteSelect = document.getElementById('favorite-select');
  const favoriteContainer = document.getElementById('favorite-game-container');
  const otherContainer = document.getElementById('other-games-container');
  const otherHeading = document.getElementById('other-games-heading');
  const lastUpdatedText = document.getElementById('last-updated-text');
  const refreshBtn = document.getElementById('manual-refresh-btn');
  const errorBanner = document.getElementById('error-banner');

  // Auth DOM Elements
  const authModalBtn = document.getElementById('auth-modal-btn');
  const authModal = document.getElementById('auth-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const authForm = document.getElementById('auth-form');
  const authEmailInput = document.getElementById('auth-email');
  const authPasswordInput = document.getElementById('auth-password');
  const authSubmitBtn = document.getElementById('auth-submit-btn');
  const authModalTitle = document.getElementById('auth-modal-title');
  const authError = document.getElementById('auth-error');
  const toggleModeLink = document.getElementById('toggle-mode-link');
  const authSwitchMode = document.getElementById('auth-switch-mode');

  // --- Data Fetching from Supabase ---
  async function fetchGamesFromSupabase(isManual = false) {
    if (isManual) {
      refreshBtn.classList.add('spinning');
    }

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

  // --- Supabase Realtime Subscription ---
  function setupRealtimeSubscription() {
    supabaseClient
      .channel('public:games')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        fetchGamesFromSupabase(false);
      })
      .subscribe();
  }

  // --- Authentication Management ---
  async function checkUserSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    handleUserSessionChange(session?.user || null);

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      handleUserSessionChange(session?.user || null);
    });
  }

  function handleUserSessionChange(user) {
    currentUser = user;
    if (user) {
      authModalBtn.textContent = 'Sign Out';
      authModal.classList.add('hidden');
    } else {
      authModalBtn.textContent = 'Sign In';
    }
  }

  // --- Rendering Functions ---
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
          <span class="game-status-badge ${game.status.toLowerCase()}">
            ${isLive ? '● LIVE' : game.status}
          </span>
          <span class="game-time-info">${game.period}</span>
        </div>

        <div class="teams-container">
          <div class="team-row">
            <div class="team-info">
              <span class="team-logo">${game.home_team_logo}</span>
              <span class="team-name ${isHomeFav ? 'is-favorite' : ''}">
                ${game.home_team_name}
              </span>
            </div>
            <span class="team-score ${isFinal ? (homeWinner ? 'winner' : 'loser') : ''}">
              ${game.status === 'UPCOMING' ? '-' : game.home_score}
            </span>
          </div>

          <div class="team-row">
            <div class="team-info">
              <span class="team-logo">${game.away_team_logo}</span>
              <span class="team-name ${isAwayFav ? 'is-favorite' : ''}">
                ${game.away_team_name}
              </span>
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
      favoriteGame = games.find(
        g => g.home_team_code === favoriteTeamCode || g.away_team_code === favoriteTeamCode
      );
      otherGames = games.filter(
        g => g.home_team_code !== favoriteTeamCode && g.away_team_code !== favoriteTeamCode
      );
    } else {
      otherGames = games;
    }

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

    otherHeading.textContent = favoriteTeamCode ? "Other Games Today" : "Today's Scoreboard";
    otherContainer.innerHTML = otherGames.map(game => renderGameCard(game, false)).join('');
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    favoriteSelect.addEventListener('change', (e) => {
      favoriteTeamCode = e.target.value;
      localStorage.setItem(STORAGE_KEY, favoriteTeamCode);
      renderDashboard(currentGamesData);
    });

    refreshBtn.addEventListener('click', () => {
      fetchGamesFromSupabase(true);
    });

    // Auth Modal Triggers
    authModalBtn.addEventListener('click', () => {
      if (currentUser) {
        supabaseClient.auth.signOut();
      } else {
        authModal.classList.remove('hidden');
      }
    });

    closeModalBtn.addEventListener('click', () => {
      authModal.classList.add('hidden');
    });

    toggleModeLink.addEventListener('click', (e) => {
      e.preventDefault();
      isSignUpMode = !isSignUpMode;
      authModalTitle.textContent = isSignUpMode ? 'Create Account' : 'Welcome to PulseScores';
      authSubmitBtn.textContent = isSignUpMode ? 'Sign Up' : 'Sign In';
      authSwitchMode.innerHTML = isSignUpMode 
        ? `Already have an account? <a href="#" id="toggle-mode-link">Sign In</a>`
        : `Don't have an account? <a href="#" id="toggle-mode-link">Sign Up</a>`;
      authError.classList.add('hidden');
    });

    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError.classList.add('hidden');
      authSubmitBtn.textContent = 'Processing...';

      const email = authEmailInput.value;
      const password = authPasswordInput.value;
      let error = null;

      if (isSignUpMode) {
        const res = await supabaseClient.auth.signUp({ email, password });
        error = res.error;
        if (!error) {
          alert('Account created! You can now sign in.');
        }
      } else {
        const res = await supabaseClient.auth.signInWithPassword({ email, password });
        error = res.error;
      }

      if (error) {
        authError.textContent = error.message;
        authError.classList.remove('hidden');
        authSubmitBtn.textContent = isSignUpMode ? 'Sign Up' : 'Sign In';
      } else {
        authForm.reset();
        authModal.classList.add('hidden');
        authSubmitBtn.textContent = isSignUpMode ? 'Sign Up' : 'Sign In';
      }
    });
  }

  // --- Initialization ---
  function init() {
    if (favoriteTeamCode) {
      favoriteSelect.value = favoriteTeamCode;
    }
    
    setupEventListeners();
    checkUserSession();
    fetchGamesFromSupabase(false);
    setupRealtimeSubscription();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();




