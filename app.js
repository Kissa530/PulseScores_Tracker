/**
 * PulseScores - Live ESPN & Supabase Auth Tracker (Phase 1 + Phase 2)
 * Architecture: 7-Day ESPN Scoreboard & Summary APIs, 3:00 PM Last-Night Rollover,
 * LocalStorage, Auto-Refresh, Status/Slate Filtering, Linescores, Stat Milestones,
 * Pre-Game Injuries, and Supabase Auth + Profile Sync.
 */

(function () {
  'use strict';

  // --- Supabase Configuration ---
  const SUPABASE_URL = 'https://dmaoawahyxtprjmcwgvd.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_y3nA3bEJt1VjirXJ2QWy-Q_XOzMkNrx';
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- Live ESPN APIs & Team Mapping ---
  const ESPN_NBA_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
  const ESPN_SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

  const TEAM_EMOJIS = {
    ATL: '🦅', BOS: '☘️', BKN: '🥅', CHA: '🐝', CHI: '🐂',
    CLE: '⚔️', DAL: '🐴', DEN: '⛏️', DET: '⚙️', GSW: '🌉',
    HOU: '🚀', IND: '🏎️', LAC: '⛵', LAL: '💜', MEM: '🐻',
    MIA: '🔥', MIL: '🦌', MIN: '🐺', NOP: '⚜️', NYK: '🗽',
    OKC: '⚡', ORL: '✨', PHI: '🔔', PHX: '☀️', POR: '🌹',
    SAC: '👑', SAS: '🤠', TOR: '🦖', UTA: '🎷', WAS: '🏛️'
  };

  const CODE_MAP = {
    ATL: 'ATL', BOS: 'BOS', BKN: 'BKN', CHA: 'CHA', CHI: 'CHI',
    CLE: 'CLE', DAL: 'DAL', DEN: 'DEN', DET: 'DET', GS: 'GSW',
    GSW: 'GSW', HOU: 'HOU', IND: 'IND', LAC: 'LAC', LAL: 'LAL',
    MEM: 'MEM', MIA: 'MIA', MIL: 'MIL', MIN: 'MIN', NO: 'NOP',
    NOP: 'NOP', NY: 'NYK', NYK: 'NYK', OKC: 'OKC', ORL: 'ORL',
    PHI: 'PHI', PHX: 'PHX', POR: 'POR', SAC: 'SAC', SA: 'SAS',
    SAS: 'SAS', TOR: 'TOR', UTA: 'UTA', UTAH: 'UTA', WAS: 'WAS', WSH: 'WAS'
  };

  function normalizeCode(abbr) {
    return CODE_MAP[abbr] || abbr;
  }

  // --- Constants & State ---
  const STORAGE_KEY = 'pulsescores_favorite_team';
  const PLAYERS_STORAGE_KEY = 'pulsescores_fav_players';

  let favoriteTeamCode = localStorage.getItem(STORAGE_KEY) || '';
  let favoritePlayers = JSON.parse(localStorage.getItem(PLAYERS_STORAGE_KEY) || '[]');
  let currentGamesData = [];
  let currentSummaryData = null;
  let currentBoxScoreData = null;
  let activeBoxScoreTeamIndex = 0;
  let currentUser = null;
  let isSignUpMode = false;

  // Filter State
  let activeStatusFilter = 'ALL'; // ALL | LIVE | FINAL | UPCOMING
  let activeSlateFilter = 'ALL';  // ALL | TODAY | YESTERDAY | UPCOMING

  // --- DOM Elements Cache ---
  const favoriteSelect = document.getElementById('favorite-select');
  const favoriteSection = document.getElementById('favorite-section');
  const favoriteContainer = document.getElementById('favorite-game-container');
  const otherContainer = document.getElementById('other-games-container');
  const otherHeading = document.getElementById('other-games-heading');
  const lastUpdatedText = document.getElementById('last-updated-text');
  const refreshBtn = document.getElementById('manual-refresh-btn');
  const errorBanner = document.getElementById('error-banner');
  const statusDot = document.getElementById('status-dot');

  // Auth DOM Elements
  const authModalBtn = document.getElementById('auth-modal-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const authModal = document.getElementById('auth-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const authForm = document.getElementById('auth-form');
  const authEmailInput = document.getElementById('auth-email');
  const authPasswordInput = document.getElementById('auth-password');
  const authSubmitBtn = document.getElementById('auth-submit-btn');
  const authModalTitle = document.getElementById('auth-modal-title');
  const authError = document.getElementById('auth-error');
  const authSwitchMode = document.getElementById('auth-switch-mode');

  // Box Score DOM Elements
  const boxscoreModal = document.getElementById('boxscore-modal');
  const closeBoxscoreBtn = document.getElementById('close-boxscore-btn');
  const boxscoreModalTitle = document.getElementById('boxscore-modal-title');
  const boxscoreBody = document.getElementById('boxscore-body');
  const tabAway = document.getElementById('tab-away');
  const tabHome = document.getElementById('tab-home');

  // --- Phase 1 Metadata Extraction Helpers ---
  function getTeamRecord(competitor) {
    const overall = competitor?.records?.find(r => r.type === 'total' || r.name === 'overall');
    return overall?.summary || '';
  }

  function getBroadcastLabel(comp) {
    const names = (comp?.broadcasts || [])
      .flatMap(b => b.names || [])
      .filter(Boolean);
    return names[0] || '';
  }

  function isClutchGame(statusObj, homeScore, awayScore) {
    const state = statusObj?.type?.state;
    const period = Number(statusObj?.period || 0);
    const diff = Math.abs(homeScore - awayScore);
    return state === 'in' && period >= 4 && diff <= 5;
  }

  // --- Phase 2 Stat & Linescore Helpers ---
  function getDoubleDoubleBadge(pts, reb, ast, stl, blk) {
    const doubleCats = [pts, reb, ast, stl, blk].filter(n => n >= 10).length;
    if (doubleCats >= 3) {
      return `<span class="milestone-badge td">TD</span>`;
    }
    if (doubleCats >= 2) {
      return `<span class="milestone-badge dd">DD</span>`;
    }
    return '';
  }

  function renderLinescoreHtml(summaryData) {
    const headerComp = summaryData?.header?.competitions?.[0];
    const competitors = headerComp?.competitors || [];
    if (competitors.length < 2) return '';

    const away = competitors.find(c => c.homeAway === 'away') || competitors[0];
    const home = competitors.find(c => c.homeAway === 'home') || competitors[1];

    const awayLines = away.linescores || [];
    const homeLines = home.linescores || [];
    const periodCount = Math.max(4, awayLines.length, homeLines.length);

    const periodHeaders = Array.from({ length: periodCount }, (_, i) =>
      i < 4 ? `Q${i + 1}` : `OT${periodCount > 5 ? i - 3 : ''}`
    );

    const buildRow = (team) => {
      const code = normalizeCode(team.team?.abbreviation || '');
      const emoji = TEAM_EMOJIS[code] || '🏀';
      const lines = team.linescores || [];
      const cells = Array.from({ length: periodCount }, (_, idx) => {
        const val = lines[idx]?.value;
        return `<td>${val !== undefined ? val : '-'}</td>`;
      }).join('');

      return `
        <tr>
          <td>${emoji} ${code}</td>
          ${cells}
          <td class="linescore-total">${team.score ?? '-'}</td>
        </tr>
      `;
    };

    return `
      <div class="linescore-card">
        <table class="linescore-table">
          <thead>
            <tr>
              <th>Team</th>
              ${periodHeaders.map(h => `<th>${h}</th>`).join('')}
              <th>T</th>
            </tr>
          </thead>
          <tbody>
            ${buildRow(away)}
            ${buildRow(home)}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPreGameSummaryHtml(summaryData) {
    const injuries = summaryData?.injuries || [];
    if (!injuries.length) {
      return `<p class="loading-text">Pre-game matchup — no injury report entries listed yet.</p>`;
    }

    return `
      <div class="pregame-grid">
        ${injuries
          .map(teamGroup => {
            const teamName = teamGroup.team?.displayName || 'Team';
            const items = teamGroup.injuries || [];
            const listHtml = items.length
              ? items
                  .map(inj => {
                    const playerName = inj.athlete?.displayName || 'Player';
                    const statusText = inj.status || inj.type?.description || 'Questionable';
                    return `
                      <div class="injury-item">
                        <span>${playerName}</span>
                        <span class="injury-status">${statusText}</span>
                      </div>
                    `;
                  })
                  .join('')
              : `<div class="injury-item"><span>No reported injuries</span></div>`;

            return `
              <div class="pregame-card">
                <h4>${teamName} Injury Report</h4>
                ${listHtml}
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  // --- Cloud Profile Sync (Supabase) ---
  async function loadUserProfile(userId) {
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('favorite_team, favorite_players')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        if (data.favorite_team) {
          favoriteTeamCode = data.favorite_team;
          localStorage.setItem(STORAGE_KEY, favoriteTeamCode);
          if (favoriteSelect) favoriteSelect.value = favoriteTeamCode;
        } else if (favoriteTeamCode) {
          await saveUserFavoriteTeam(favoriteTeamCode);
        }

        if (Array.isArray(data.favorite_players)) {
          favoritePlayers = data.favorite_players;
          localStorage.setItem(PLAYERS_STORAGE_KEY, JSON.stringify(favoritePlayers));
        } else if (favoritePlayers.length > 0) {
          await saveUserFavoritePlayers(favoritePlayers);
        }

        renderDashboard(currentGamesData);
      }
    } catch (err) {
      console.warn('Could not load cloud profile:', err.message);
    }
  }

  async function saveUserFavoriteTeam(teamCode) {
    if (!currentUser) return;

    try {
      const { error } = await supabaseClient
        .from('profiles')
        .upsert(
          {
            id: currentUser.id,
            favorite_team: teamCode,
            favorite_teams: teamCode ? [teamCode] : [],
            updated_at: new Date().toISOString()
          },
          { onConflict: 'id' }
        );

      if (error) throw error;
    } catch (err) {
      console.warn('Could not sync favorite team to cloud:', err.message);
    }
  }

  async function saveUserFavoritePlayers(playersList) {
    if (!currentUser) return;

    try {
      const { error } = await supabaseClient
        .from('profiles')
        .upsert(
          {
            id: currentUser.id,
            favorite_players: playersList,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'id' }
        );

      if (error) throw error;
    } catch (err) {
      console.warn('Could not sync favorite players to cloud:', err.message);
    }
  }

  // --- Date & Rollover Helpers ---
  function formatDateYYYYMMDD(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  function getFullWeekDateStrings() {
    const dates = [];
    for (let i = -3; i <= 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      dates.push(formatDateYYYYMMDD(d));
    }
    return dates;
  }

  function isBeforeThreePM() {
    return new Date().getHours() < 15;
  }

  // --- Live Data Fetching from ESPN (Full Week) ---
  async function fetchLiveGames(isManual = false) {
    if (isManual && refreshBtn) {
      refreshBtn.classList.add('spinning');
    }

    try {
      const dateStrs = getFullWeekDateStrings();

      const fetchPromises = dateStrs.map(dateStr =>
        fetch(`${ESPN_NBA_URL}?dates=${dateStr}`)
          .then(res => {
            if (!res.ok) throw new Error(`ESPN API Error: ${res.status}`);
            return res.json();
          })
          .catch(() => ({ events: [] }))
      );

      const results = await Promise.all(fetchPromises);

      const nowDate = new Date();
      const todayStr = formatDateYYYYMMDD(nowDate);

      const yesterdayDate = new Date();
      yesterdayDate.setDate(nowDate.getDate() - 1);
      const yesterdayStr = formatDateYYYYMMDD(yesterdayDate);

      const allEvents = [];

      results.forEach((data, index) => {
        const dateStr = dateStrs[index];
        const events = data.events || [];

        let dateCategory = 'other';
        if (dateStr === todayStr) {
          dateCategory = 'today';
        } else if (dateStr === yesterdayStr) {
          dateCategory = 'yesterday';
        } else if (dateStr < todayStr) {
          dateCategory = 'past';
        } else {
          dateCategory = 'upcoming';
        }

        events.forEach(event => {
          const comp = event.competitions[0];
          const home = comp.competitors.find(c => c.homeAway === 'home');
          const away = comp.competitors.find(c => c.homeAway === 'away');

          const homeCode = normalizeCode(home.team.abbreviation);
          const awayCode = normalizeCode(away.team.abbreviation);

          const state = event.status.type.state;
          let status = 'UPCOMING';
          if (state === 'in') status = 'LIVE';
          if (state === 'post') status = 'FINAL';

          const homeScore = parseInt(home.score || '0', 10);
          const awayScore = parseInt(away.score || '0', 10);

          const gameDate = new Date(event.date);
          const dateLabel = gameDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

          allEvents.push({
            id: event.id,
            dateGroup: dateCategory,
            dateString: dateStr,
            dateLabel: dateLabel,
            startTimeMs: gameDate.getTime(),
            home_team_code: homeCode,
            home_team_name: home.team.displayName,
            home_team_logo: TEAM_EMOJIS[homeCode] || '🏀',
            home_record: getTeamRecord(home),
            away_team_code: awayCode,
            away_team_name: away.team.displayName,
            away_team_logo: TEAM_EMOJIS[awayCode] || '🏀',
            away_record: getTeamRecord(away),
            home_score: homeScore,
            away_score: awayScore,
            broadcast: getBroadcastLabel(comp),
            is_clutch: isClutchGame(event.status, homeScore, awayScore),
            status: status,
            period: event.status.type.shortDetail,
            start_time: event.status.type.shortDetail
          });
        });
      });

      currentGamesData = allEvents;
      renderDashboard(currentGamesData);

      const now = new Date();
      if (lastUpdatedText) {
        lastUpdatedText.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      }
      if (errorBanner) errorBanner.classList.add('hidden');
      if (statusDot) statusDot.classList.add('live');
    } catch (err) {
      console.warn('Live score fetch warning:', err.message);
      if (errorBanner) errorBanner.classList.remove('hidden');
      if (statusDot) statusDot.classList.remove('live');
    } finally {
      if (isManual && refreshBtn) {
        setTimeout(() => refreshBtn.classList.remove('spinning'), 300);
      }
    }
  }

  // --- Box Score & Player Stat Lines (Phase 2 Enhanced) ---
  async function openBoxScoreModal(gameId, matchupTitle) {
    if (!boxscoreModal) return;

    boxscoreModalTitle.textContent = `${matchupTitle} — Box Score`;
    boxscoreBody.innerHTML = `<p class="loading-text">Fetching game details...</p>`;
    boxscoreModal.classList.remove('hidden');

    try {
      const response = await fetch(`${ESPN_SUMMARY_URL}?event=${gameId}`);
      if (!response.ok) throw new Error('Failed to load game summary');

      const data = await response.json();
      currentSummaryData = data;
      const playersData = data?.boxscore?.players;

      if (!playersData || playersData.length < 2) {
        boxscoreBody.innerHTML = renderPreGameSummaryHtml(data);
        return;
      }

      currentBoxScoreData = playersData;
      activeBoxScoreTeamIndex = 0;

      if (tabAway && tabHome) {
        tabAway.textContent = playersData[0].team.displayName;
        tabHome.textContent = playersData[1].team.displayName;
        tabAway.classList.add('active');
        tabHome.classList.remove('active');
      }

      renderBoxScoreTable(0);
    } catch (err) {
      console.error('Box score error:', err);
      boxscoreBody.innerHTML = `<p class="loading-text">Unable to load box score right now.</p>`;
    }
  }

  function renderBoxScoreTable(teamIndex) {
    const teamStats = currentBoxScoreData?.[teamIndex]?.statistics?.[0];
    const linescoreHtml = renderLinescoreHtml(currentSummaryData);

    if (!teamStats || !teamStats.athletes || teamStats.athletes.length === 0) {
      boxscoreBody.innerHTML = `${linescoreHtml}${renderPreGameSummaryHtml(currentSummaryData)}`;
      return;
    }

    const labels = teamStats.labels || [];
    const athletes = teamStats.athletes;

    const ptsIdx = labels.indexOf('PTS');
    const rebIdx = labels.indexOf('REB');
    const astIdx = labels.indexOf('AST');
    const stlIdx = labels.indexOf('STL');
    const blkIdx = labels.indexOf('BLK');

    const parseNum = (stats, idx) => {
      if (idx === -1 || !stats || stats[idx] === undefined) return 0;
      const n = parseFloat(String(stats[idx]).replace(/[^\d.-]/g, ''));
      return Number.isNaN(n) ? 0 : n;
    };

    let topPtsVal = -1;
    let topRebVal = -1;
    let topAstVal = -1;

    athletes.forEach(entry => {
      if (entry.didNotPlay || !entry.stats?.length) return;
      topPtsVal = Math.max(topPtsVal, parseNum(entry.stats, ptsIdx));
      topRebVal = Math.max(topRebVal, parseNum(entry.stats, rebIdx));
      topAstVal = Math.max(topAstVal, parseNum(entry.stats, astIdx));
    });

    const displayCols = [
      { label: 'MIN', idx: labels.indexOf('MIN') },
      { label: 'PTS', idx: ptsIdx },
      { label: 'REB', idx: rebIdx },
      { label: 'AST', idx: astIdx },
      { label: 'FG', idx: labels.indexOf('FG') },
      { label: '3PT', idx: labels.indexOf('3PT') },
      { label: '+/-', idx: labels.indexOf('+/-') }
    ].filter(col => col.idx !== -1);

    let html = `
      ${linescoreHtml}
      <div class="stats-table-wrapper">
        <table class="stats-table">
          <thead>
            <tr>
              <th>Player</th>
              ${displayCols.map(c => `<th>${c.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    athletes.forEach(entry => {
      const athlete = entry.athlete;
      const stats = entry.stats || [];
      const isFollowed = favoritePlayers.some(p => p.id === athlete.id);
      const starIcon = isFollowed ? '⭐' : '☆';
      const safeName = (athlete.displayName || '').replace(/"/g, '&quot;');

      if (entry.didNotPlay || stats.length === 0) {
        html += `
          <tr class="${isFollowed ? 'followed-player' : ''}">
            <td>
              <div class="player-cell">
                <button class="star-player-btn" data-id="${athlete.id}" data-name="${safeName}" title="Track Player">${starIcon}</button>
                <span>${athlete.shortName || athlete.displayName}</span>
                <span class="player-pos">${athlete.position?.abbreviation || ''}</span>
              </div>
            </td>
            <td colspan="${displayCols.length}" style="text-align: center; color: var(--text-muted);">DNP - ${entry.reason || 'Coach Decision'}</td>
          </tr>
        `;
        return;
      }

      const pts = parseNum(stats, ptsIdx);
      const reb = parseNum(stats, rebIdx);
      const ast = parseNum(stats, astIdx);
      const stl = parseNum(stats, stlIdx);
      const blk = parseNum(stats, blkIdx);

      const milestoneBadge = getDoubleDoubleBadge(pts, reb, ast, stl, blk);
      const leaderTags = [
        pts > 0 && pts === topPtsVal ? `<span class="leader-tag">PTS</span>` : '',
        reb > 0 && reb === topRebVal ? `<span class="leader-tag">REB</span>` : '',
        ast > 0 && ast === topAstVal ? `<span class="leader-tag">AST</span>` : ''
      ].join('');

      html += `
        <tr class="${isFollowed ? 'followed-player' : ''}">
          <td>
            <div class="player-cell">
              <button class="star-player-btn" data-id="${athlete.id}" data-name="${safeName}" title="Track Player">${starIcon}</button>
              <span>${athlete.shortName || athlete.displayName}</span>
              <span class="player-pos">${athlete.position?.abbreviation || ''}</span>
              ${milestoneBadge}
              ${leaderTags}
            </div>
          </td>
          ${displayCols.map(c => `<td>${stats[c.idx] ?? '-'}</td>`).join('')}
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    boxscoreBody.innerHTML = html;

    boxscoreBody.querySelectorAll('.star-player-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavoritePlayer(btn.dataset.id, btn.dataset.name);
      });
    });
  }

  async function toggleFavoritePlayer(playerId, playerName) {
    const exists = favoritePlayers.some(p => p.id === playerId);

    if (exists) {
      favoritePlayers = favoritePlayers.filter(p => p.id !== playerId);
    } else {
      favoritePlayers.push({ id: playerId, name: playerName });
    }

    localStorage.setItem(PLAYERS_STORAGE_KEY, JSON.stringify(favoritePlayers));
    renderBoxScoreTable(activeBoxScoreTeamIndex);

    if (currentUser) {
      await saveUserFavoritePlayers(favoritePlayers);
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

    let userBadge = document.getElementById('user-status-badge');
    if (!userBadge && authModalBtn?.parentNode) {
      userBadge = document.createElement('span');
      userBadge.id = 'user-status-badge';
      userBadge.style.cssText = 'font-size: 0.8rem; color: #10b981; font-weight: 600; background: rgba(16, 185, 129, 0.12); padding: 0.35rem 0.65rem; border-radius: 9999px; white-space: nowrap; margin-right: 0.5rem; display: inline-flex; align-items: center;';
      authModalBtn.parentNode.insertBefore(userBadge, authModalBtn);
    }

    if (user) {
      const displayName = user.email ? user.email.split('@')[0] : 'Signed In';
      if (userBadge) {
        userBadge.textContent = `● ${displayName}`;
        userBadge.classList.remove('hidden');
      }
      if (authModalBtn) authModalBtn.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (authModal) authModal.classList.add('hidden');
      loadUserProfile(user.id);
    } else {
      if (userBadge) userBadge.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.add('hidden');
      if (authModalBtn) authModalBtn.classList.remove('hidden');
    }
  }

  // --- Filter Bar Renderer ---
  function renderFilterBar() {
    if (!favoriteSection || !favoriteSection.parentNode) return;

    let filterBar = document.getElementById('scoreboard-filter-bar');
    if (!filterBar) {
      filterBar = document.createElement('div');
      filterBar.id = 'scoreboard-filter-bar';
      filterBar.className = 'filter-bar';
      favoriteSection.parentNode.insertBefore(filterBar, favoriteSection);
    }

    const statusOptions = [
      { key: 'ALL', label: 'All' },
      { key: 'LIVE', label: 'Live' },
      { key: 'UPCOMING', label: 'Upcoming' },
      { key: 'FINAL', label: 'Final' }
    ];

    const slateOptions = [
      { key: 'ALL', label: 'Full Week' },
      { key: 'TODAY', label: 'Today' },
      { key: 'YESTERDAY', label: 'Yesterday' },
      { key: 'UPCOMING', label: 'Next 3 Days' }
    ];

    filterBar.innerHTML = `
      <div class="filter-group" role="group" aria-label="Filter by status">
        <span class="filter-label">Status</span>
        ${statusOptions
          .map(
            opt => `<button type="button" class="filter-pill ${activeStatusFilter === opt.key ? 'active' : ''}" data-filter-type="status" data-filter-val="${opt.key}">${opt.label}</button>`
          )
          .join('')}
      </div>
      <div class="filter-group" role="group" aria-label="Filter by slate">
        <span class="filter-label">Slate</span>
        ${slateOptions
          .map(
            opt => `<button type="button" class="filter-pill ${activeSlateFilter === opt.key ? 'active' : ''}" data-filter-type="slate" data-filter-val="${opt.key}">${opt.label}</button>`
          )
          .join('')}
      </div>
    `;

    filterBar.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.filterType;
        const val = btn.dataset.filterVal;
        if (type === 'status') activeStatusFilter = val;
        if (type === 'slate') activeSlateFilter = val;
        renderDashboard(currentGamesData);
      });
    });
  }

  // --- Rendering Functions ---
  function renderGameCard(game, isSpotlight = false, badgeOverride = '') {
    const isHomeFav = game.home_team_code === favoriteTeamCode;
    const isAwayFav = game.away_team_code === favoriteTeamCode;
    const isLive = game.status === 'LIVE';
    const isFinal = game.status === 'FINAL';

    const homeWinner = isFinal && game.home_score > game.away_score;
    const awayWinner = isFinal && game.away_score > game.home_score;
    const matchupTitle = `${game.away_team_code} @ ${game.home_team_code}`;
    const displayPeriod = game.dateGroup !== 'today' ? `${game.dateLabel} • ${game.period}` : game.period;
    const badgeLabel = badgeOverride || '⭐ Favorite';

    const clutchBadge = game.is_clutch
      ? `<span class="game-status-badge clutch">🔥 CLUTCH</span>`
      : '';
    const broadcastBadge = game.broadcast
      ? `<span class="broadcast-pill">${game.broadcast}</span>`
      : '';

    return `
      <article class="game-card ${isSpotlight ? 'spotlight' : ''}" data-game-id="${game.id}" data-matchup="${matchupTitle}">
        ${isSpotlight ? `<div class="spotlight-badge">${badgeLabel}</div>` : ''}

        <div class="game-header">
          <div class="header-badges">
            <span class="game-status-badge ${game.status.toLowerCase()}">
              ${isLive ? '● LIVE' : game.status}
            </span>
            ${clutchBadge}
            ${broadcastBadge}
          </div>
          <span class="game-time-info">${displayPeriod}</span>
        </div>

        <div class="teams-container">
          <div class="team-row">
            <div class="team-info">
              <span class="team-logo">${game.home_team_logo}</span>
              <div class="team-meta">
                <span class="team-name ${isHomeFav ? 'is-favorite' : ''}">
                  ${game.home_team_name}
                </span>
                ${game.home_record ? `<span class="team-record">${game.home_record}</span>` : ''}
              </div>
            </div>
            <span class="team-score ${isFinal ? (homeWinner ? 'winner' : 'loser') : ''}">
              ${game.status === 'UPCOMING' ? '-' : game.home_score}
            </span>
          </div>

          <div class="team-row">
            <div class="team-info">
              <span class="team-logo">${game.away_team_logo}</span>
              <div class="team-meta">
                <span class="team-name ${isAwayFav ? 'is-favorite' : ''}">
                  ${game.away_team_name}
                </span>
                ${game.away_record ? `<span class="team-record">${game.away_record}</span>` : ''}
              </div>
            </div>
            <span class="team-score ${isFinal ? (awayWinner ? 'winner' : 'loser') : ''}">
              ${game.status === 'UPCOMING' ? '-' : game.away_score}
            </span>
          </div>
        </div>

        <div class="game-card-footer">View Box Score &amp; Stats &rarr;</div>
      </article>
    `;
  }

  function renderDashboard(games) {
    if (!games) return;

    renderFilterBar();

    const matchesStatus = game =>
      activeStatusFilter === 'ALL' || game.status === activeStatusFilter;

    // Today's games respond to Status and Today/Full Week slate filters
    const allowToday = activeSlateFilter === 'ALL' || activeSlateFilter === 'TODAY';
    const todayGames = allowToday
      ? games.filter(g => g.dateGroup === 'today' && matchesStatus(g))
      : [];

    // Past 3 days and upcoming 3 days always show all teams & statuses
    // unless the user specifically selects Today, Yesterday, or Next 3 Days on Slate
    const rawYesterday = games.filter(g => g.dateGroup === 'yesterday');
    const rawOlderPast = games.filter(g => g.dateGroup === 'past');
    const rawUpcoming = games.filter(g => g.dateGroup === 'upcoming');

    const showLastNight = isBeforeThreePM();
    const lastNightGames =
      showLastNight && (activeSlateFilter === 'ALL' || activeSlateFilter === 'YESTERDAY')
        ? rawYesterday
        : [];

    const recentPastGames =
      activeSlateFilter === 'TODAY' || activeSlateFilter === 'UPCOMING'
        ? []
        : showLastNight
          ? rawOlderPast
          : [...rawOlderPast, ...rawYesterday];

    const upcomingGames =
      activeSlateFilter === 'TODAY' || activeSlateFilter === 'YESTERDAY'
        ? []
        : rawUpcoming;

    let favoriteGame = null;
    let isFavFromLastNight = false;
    let otherTodayGames = [];

    if (favoriteTeamCode) {
      favoriteGame = todayGames.find(
        g => g.home_team_code === favoriteTeamCode || g.away_team_code === favoriteTeamCode
      );

      if (!favoriteGame && showLastNight && allowToday) {
        favoriteGame = rawYesterday.find(
          g => g.home_team_code === favoriteTeamCode || g.away_team_code === favoriteTeamCode
        );
        if (favoriteGame) isFavFromLastNight = true;
      }

      otherTodayGames = todayGames.filter(
        g => g.home_team_code !== favoriteTeamCode && g.away_team_code !== favoriteTeamCode
      );
    } else {
      otherTodayGames = todayGames;
    }

    if (favoriteContainer) {
      if (favoriteTeamCode) {
        if (favoriteGame) {
          const badge = isFavFromLastNight ? '⭐ Favorite • Last Night' : '⭐ Favorite';
          favoriteContainer.innerHTML = renderGameCard(favoriteGame, true, badge);
        } else {
          favoriteContainer.innerHTML = `
            <div class="empty-spotlight">
              <span>No Matching Game Today</span>
              Your team either has the day off or is hidden by the active filter.
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
    }

    if (otherHeading) {
      otherHeading.textContent = favoriteTeamCode ? "Other Games Today" : "Today's Scoreboard";
    }
    if (otherContainer) {
      otherContainer.innerHTML = otherTodayGames.length > 0
        ? otherTodayGames.map(game => renderGameCard(game, false)).join('')
        : `<div class="empty-spotlight"><span>No Other Games Matching Filter Today</span></div>`;
    }

    let weekSection = document.getElementById('full-week-section');
    if (!weekSection && otherContainer?.parentNode?.parentNode) {
      weekSection = document.createElement('div');
      weekSection.id = 'full-week-section';
      weekSection.style.marginTop = '2.5rem';

      weekSection.innerHTML = `
        <div id="last-night-wrapper" style="display: none; margin-bottom: 2rem;">
          <div class="section-label" style="margin-bottom: 0.75rem;">Last Night's Finals</div>
          <div class="games-grid" id="last-night-games-container"></div>
        </div>

        <div class="section-label" style="margin-bottom: 0.75rem;">Recent Results (Past 3 Days)</div>
        <div class="games-grid" id="past-games-container" style="margin-bottom: 2rem;"></div>

        <div class="section-label" style="margin-bottom: 0.75rem;">Upcoming Matchups (Next 3 Days)</div>
        <div class="games-grid" id="upcoming-games-container"></div>
      `;
      otherContainer.parentNode.parentNode.appendChild(weekSection);
    }

    const lastNightWrapper = document.getElementById('last-night-wrapper');
    const lastNightContainer = document.getElementById('last-night-games-container');

    if (lastNightWrapper && lastNightContainer) {
      if (showLastNight && lastNightGames.length > 0) {
        lastNightWrapper.style.display = 'block';
        lastNightContainer.innerHTML = lastNightGames
          .map(game => renderGameCard(game, false))
          .join('');
      } else {
        lastNightWrapper.style.display = 'none';
        lastNightContainer.innerHTML = '';
      }
    }

    const pastContainer = document.getElementById('past-games-container');
    if (pastContainer) {
      pastContainer.innerHTML = recentPastGames.length > 0
        ? recentPastGames
            .sort((a, b) => b.dateString.localeCompare(a.dateString))
            .map(game => renderGameCard(game, false))
            .join('')
        : `<div class="empty-spotlight"><span>No Recent Games</span></div>`;
    }

    const upcomingContainer = document.getElementById('upcoming-games-container');
    if (upcomingContainer) {
      upcomingContainer.innerHTML = upcomingGames.length > 0
        ? upcomingGames
            .sort((a, b) => a.dateString.localeCompare(b.dateString))
            .map(game => renderGameCard(game, false))
            .join('')
        : `<div class="empty-spotlight"><span>No Upcoming Games Scheduled</span></div>`;
    }
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    if (favoriteSelect) {
      favoriteSelect.value = favoriteTeamCode;
      favoriteSelect.addEventListener('change', async (e) => {
        favoriteTeamCode = e.target.value;
        localStorage.setItem(STORAGE_KEY, favoriteTeamCode);
        renderDashboard(currentGamesData);
        if (currentUser) {
          await saveUserFavoriteTeam(favoriteTeamCode);
        }
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => fetchLiveGames(true));
    }

    document.addEventListener('click', (e) => {
      const card = e.target.closest('.game-card');
      if (card && card.dataset.gameId) {
        openBoxScoreModal(card.dataset.gameId, card.dataset.matchup || 'Game');
      }
    });

    if (closeBoxscoreBtn && boxscoreModal) {
      closeBoxscoreBtn.addEventListener('click', () => boxscoreModal.classList.add('hidden'));
      boxscoreModal.addEventListener('click', (e) => {
        if (e.target === boxscoreModal) boxscoreModal.classList.add('hidden');
      });
    }

    if (tabAway && tabHome) {
      tabAway.addEventListener('click', () => {
        activeBoxScoreTeamIndex = 0;
        tabAway.classList.add('active');
        tabHome.classList.remove('active');
        renderBoxScoreTable(0);
      });

      tabHome.addEventListener('click', () => {
        activeBoxScoreTeamIndex = 1;
        tabHome.classList.add('active');
        tabAway.classList.remove('active');
        renderBoxScoreTable(1);
      });
    }

    if (authModalBtn && authModal) {
      authModalBtn.addEventListener('click', () => {
        isSignUpMode = false;
        authModalTitle.textContent = 'Sign In to PulseScores';
        authSubmitBtn.textContent = 'Sign In';
        authSwitchMode.textContent = 'Sign Up';
        authError.classList.add('hidden');
        authModal.classList.remove('hidden');
      });
    }

    if (closeModalBtn && authModal) {
      closeModalBtn.addEventListener('click', () => authModal.classList.add('hidden'));
      authModal.addEventListener('click', (e) => {
        if (e.target === authModal) authModal.classList.add('hidden');
      });
    }

    if (authSwitchMode) {
      authSwitchMode.addEventListener('click', (e) => {
        e.preventDefault();
        isSignUpMode = !isSignUpMode;
        authModalTitle.textContent = isSignUpMode ? 'Create PulseScores Account' : 'Sign In to PulseScores';
        authSubmitBtn.textContent = isSignUpMode ? 'Create Account' : 'Sign In';
        authSwitchMode.textContent = isSignUpMode ? 'Sign In' : 'Sign Up';
        authError.classList.add('hidden');
      });
    }

    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = authEmailInput.value.trim();
        const password = authPasswordInput.value;
        authError.classList.add('hidden');
        authSubmitBtn.disabled = true;

        try {
          if (isSignUpMode) {
            const { error } = await supabaseClient.auth.signUp({ email, password });
            if (error) throw error;
            authError.textContent = 'Check your email to confirm your account, or sign in if already confirmed.';
            authError.classList.remove('hidden');
          } else {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
          }
        } catch (err) {
          authError.textContent = err.message;
          authError.classList.remove('hidden');
        } finally {
          authSubmitBtn.disabled = false;
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
      });
    }
  }

  // --- Initialization ---
  async function init() {
    setupEventListeners();
    await checkUserSession();
    await fetchLiveGames(false);
    setInterval(() => fetchLiveGames(false), 30000);
  }

  init();
})();
