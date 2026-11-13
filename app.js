/**
 * PulseScores - Live ESPN & Supabase Auth Tracker
 * Architecture: Live ESPN Scoreboard API, LocalStorage, Auto-Refresh, and Supabase Auth.
 */

(function () {
  'use strict';

  // --- Supabase Configuration ---
  const SUPABASE_URL = 'https://dmaoawahyxtprjmcwgvd.supabase.co'; 
  const SUPABASE_ANON_KEY = 'sb_publishable_y3nA3bEJt1VjirXJ2QWy-Q_XOzMkNrx';
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- Live ESPN API & Team Mapping ---
  const ESPN_NBA_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

  const TEAM_EMOJIS = {
    ATL: '🦅', BOS: '☘️', BKN: '🗽', CHA: '🐝', CHI: '🐂',
    CLE: '⚔️', DAL: '🐴', DEN: '⛏️', DET: '⚙️', GSW: '🌉',
    HOU: '🚀', IND: '🏎️', LAC: '⛵', LAL: '👑', MEM: '🐻',
    MIA: '🔥', MIL: '🦌', MIN: '🐺', NOP: '⚜️', NYK: '🗽',
    OKC: '⚡', ORL: '✨', PHI: '🔔', PHX: '☀️', POR: '🌹',
    SAC: '👑', SAS: '🤠', TOR: '🦖', UTA: '🎷', WAS: '🧙'
  };

  // Normalize ESPN abbreviations to match your 30-team HTML <select> values
  const CODE_MAP = {
  ATL: 'ATL',
  BOS: 'BOS',
  BKN: 'BKN',
  CHA: 'CHA',
  CHI: 'CHI',
  CLE: 'CLE',
  DAL: 'DAL',
  DEN: 'DEN',
  DET: 'DET',
  GS: 'GSW',   // ESPN sometimes returns 'GS'
  GSW: 'GSW',
  HOU: 'HOU',
  IND: 'IND',
  LAC: 'LAC',
  LAL: 'LAL',
  MEM: 'MEM',
  MIA: 'MIA',
  MIL: 'MIL',
  MIN: 'MIN',
  NO: 'NOP',   // ESPN sometimes returns 'NO'
  NOP: 'NOP',
  NY: 'NYK',   // ESPN sometimes returns 'NY'
  NYK: 'NYK',
  OKC: 'OKC',
  ORL: 'ORL',
  PHI: 'PHI',
  PHX: 'PHX',
  POR: 'POR',
  SAC: 'SAC',
  SA: 'SAS',   // ESPN sometimes returns 'SA'
  SAS: 'SAS',
  TOR: 'TOR',
  UTA: 'UTA',
  UTAH: 'UTA', // ESPN sometimes returns 'UTAH'
  WAS: 'WAS',
  WSH: 'WAS'   // ESPN sometimes returns 'WSH'
  };

  function normalizeCode(abbr) {
    return CODE_MAP[abbr] || abbr;
  }

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
  const statusDot = document.getElementById('status-dot');

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
  const authSwitchMode = document.getElementById('auth-switch-mode');

  // --- Live Data Fetching from ESPN ---
  async function fetchLiveGames(isManual = false) {
    if (isManual) {
      refreshBtn.classList.add('spinning');
    }

    try {
      const response = await fetch(ESPN_NBA_URL);
      if (!response.ok) throw new Error(`ESPN API Error: ${response.status}`);
      const data = await response.json();

      const events = data.events || [];
      currentGamesData = events.map(event => {
        const comp = event.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');

        const homeCode = normalizeCode(home.team.abbreviation);
        const awayCode = normalizeCode(away.team.abbreviation);

        const state = event.status.type.state; // 'pre', 'in', or 'post'
        let status = 'UPCOMING';
        if (state === 'in') status = 'LIVE';
        if (state === 'post') status = 'FINAL';

        return {
          id: event.id,
          home_team_code: homeCode,
          home_team_name: home.team.displayName,
          home_team_logo: TEAM_EMOJIS[homeCode] || '🏀',
          away_team_code: awayCode,
          away_team_name: away.team.displayName,
          away_team_logo: TEAM_EMOJIS[awayCode] || '🏀',
          home_score: parseInt(home.score || '0', 10),
          away_score: parseInt(away.score || '0', 10),
          status: status,
          period: event.status.type.shortDetail,
          start_time: event.status.type.shortDetail
        };
      });

      renderDashboard(currentGamesData);

      const now = new Date();
      lastUpdatedText.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      errorBanner.classList.add('hidden');
      if (statusDot) statusDot.classList.add('live');
    } catch (err) {
      console.warn("Live score fetch warning:", err.message);
      errorBanner.classList.remove('hidden');
      if (statusDot) statusDot.classList.remove('live');
    } finally {
      if (isManual) {
        setTimeout(() => refreshBtn.classList.remove('spinning'), 300);
      }
    }
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
    otherContainer.innerHTML = otherGames.length > 0
      ? otherGames.map(game => renderGameCard(game, false)).join('')
      : `<div class="empty-spotlight"><span>No Other Games Scheduled Today</span></div>`;
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    favoriteSelect.addEventListener('change', (e) => {
      favoriteTeamCode = e.target.value;
      localStorage.setItem(STORAGE_KEY, favoriteTeamCode);
      renderDashboard(currentGamesData);
    });

    refreshBtn.addEventListener('click', () => {
      fetchLiveGames(true);
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

    // Event delegation so the Sign Up / Sign In toggle link keeps working after re-render
    authSwitchMode.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'toggle-mode-link') {
        e.preventDefault();
        isSignUpMode = !isSignUpMode;
        authModalTitle.textContent = isSignUpMode ? 'Create Account' : 'Welcome to PulseScores';
        authSubmitBtn.textContent = isSignUpMode ? 'Sign Up' : 'Sign In';
        authSwitchMode.innerHTML = isSignUpMode 
          ? `Already have an account? <a href="#" id="toggle-mode-link">Sign In</a>`
          : `Don't have an account? <a href="#" id="toggle-mode-link">Sign Up</a>`;
        authError.classList.add('hidden');
      }
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
    fetchLiveGames(false);

    // Automatically poll live scores every 30 seconds
    setInterval(() => fetchLiveGames(false), 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();




