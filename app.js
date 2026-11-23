/**
 * PulseScores - Live ESPN & Supabase Auth Tracker (Phase 1 + Phase 2)
 * Architecture: 7-Day ESPN Scoreboard & Summary APIs, All-Day Yesterday Rollover,
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
  const REFRESH_INTERVAL_MS = 30000;

  let favoriteTeamCode = normalizeCode(localStorage.getItem(STORAGE_KEY) || '');
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

  // --- Hydrate Dropdown Options with Team Emojis ---
  function hydrateFavoriteSelectEmojis() {
    if (!favoriteSelect) return;

    Array.from(favoriteSelect.options).forEach(option => {
      if (!option.value) return;
      const code = normalizeCode(option.value);
      const emoji = TEAM_EMOJIS[code];
      if (!emoji) return;

      const cleanLabel = option.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim();
      option.textContent = `${emoji} ${cleanLabel}`;
    });
  }

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

  function getQuarterValues(linescores = [], statusState = 'post', currentPeriod = 4) {
    const safeLines = Array.isArray(linescores) ? linescores : [];
    const totalPeriods = Math.max(4, Number(currentPeriod) || 0, safeLines.length);

    return Array.from({ length: totalPeriods }, (_, idx) => {
      const periodNum = idx + 1;
      const entry = safeLines[idx];
      const rawVal = entry?.displayValue ?? entry?.value;

      if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
        return String(rawVal);
      }

      if (statusState === 'in' && periodNum > Number(currentPeriod || 0)) {
        return '—';
      }

      return statusState === 'post' ? '0' : '-';
    });
  }

  function renderCardQuarterStrip(game) {
    if (game.status === 'UPCOMING') return '';

    const awayQuarters = getQuarterValues(game.away_linescores, game.statusState, game.periodNumber);
    const homeQuarters = getQuarterValues(game.home_linescores, game.statusState, game.periodNumber);
    const periodCount = Math.max(4, awayQuarters.length, homeQuarters.length);

    const headers = Array.from({ length: periodCount }, (_, i) => {
      if (i < 4) return `Q${i + 1}`;
      const otNum = i - 3;
      return otNum === 1 ? 'OT' : `OT${otNum}`;
    });

    const renderRow = (label, quarters) => `
      <div class="card-quarter-row">
        <span class="card-quarter-team">${label}</span>
        ${Array.from({ length: periodCount }, (_, idx) =>
          `<span class="card-quarter-val">${quarters[idx] ?? '-'}</span>`
        ).join('')}
      </div>
    `;

    return `
      <div class="card-quarters" aria-label="Quarter by quarter scores">
        <div class="card-quarter-row card-quarter-head">
          <span class="card-quarter-team"></span>
          ${headers.map(h => `<span class="card-quarter-val">${h}</span>`).join('')}
        </div>
        ${renderRow(game.away_team_code, awayQuarters)}
        ${renderRow(game.home_team_code, homeQuarters)}
      </div>
    `;
  }

  // --- Phase 2 Stat, Linescore & Injury Helpers ---
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

  function getInjuryStatusClass(statusText = '') {
    const normalized = statusText.toLowerCase();
    if (normalized.includes('out') || normalized.includes('susp')) {
      return 'out';
    }
    if (normalized.includes('prob') || normalized.includes('avail')) {
      return 'probable';
    }
    return 'questionable';
  }

  function renderLinescoreHtml(summaryData) {
    const headerComp = summaryData?.header?.competitions?.[0];
    const competitors = headerComp?.competitors || [];
    if (competitors.length < 2) return '';

    const gameState = headerComp?.status?.type?.state;
    const currentPeriod = Number(headerComp?.status?.period || 0);

    const away = competitors.find(c => c.homeAway === 'away') || competitors[0];
    const home = competitors.find(c => c.homeAway === 'home') || competitors[1];

    const awayLines = away.linescores || [];
    const homeLines = home.linescores || [];
    const periodCount = Math.max(4, currentPeriod, awayLines.length, homeLines.length);

    const periodHeaders = Array.from({ length: periodCount }, (_, i) => {
      if (i < 4) return `Q${i + 1}`;
      const otNum = i - 3;
      return otNum === 1 ? 'OT' : `OT${otNum}`;
    });

    const buildRow = (team) => {
      const code = normalizeCode(team.team?.abbreviation || '');
      const emoji = TEAM_EMOJIS[code] || '🏀';
      const lines = team.linescores || [];

      const cells = Array.from({ length: periodCount }, (_, idx) => {
        const periodNum = idx + 1;
        const entry = lines[idx];
        const rawVal = entry?.displayValue ?? entry?.value;

        if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          return `<td>${rawVal}</td>`;
        }

        if (gameState === 'in' && periodNum > currentPeriod) {
          return `<td>—</td>`;
        }

        return `<td>${gameState === 'post' ? '0' : '-'}</td>`;
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
                    const statusClass = getInjuryStatusClass(statusText);
                    const detailNote =
                      inj.shortComment ||
                      inj.details?.type ||
                      (inj.type?.description && inj.type.description !== statusText ? inj.type.description : '');

                    return `
                      <div class="injury-item">
                        <div class="injury-player-info">
                          <span class="injury-player-name">${playerName}</span>
                          ${detailNote ? `<span class="injury-detail">${detailNote}</span>` : ''}
                        </div>
                        <span class="injury-status ${statusClass}">${statusText}</span>
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
          favoriteTeamCode = normalizeCode(data.favorite_team);
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

  // --- Date Helpers ---
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
            home_linescores: home.linescores || [],
            away_team_code: awayCode,
            away_team_name: away.team.displayName,
            away_team_logo: TEAM_EMOJIS[awayCode] || '🏀',
            away_record: getTeamRecord(away),
            away_linescores: away.linescores || [],
            home_score: homeScore,
            away_score: awayScore,
            broadcast: getBroadcastLabel(comp),
            is_clutch: isClutchGame(event.status, homeScore, awayScore),
            status: status,
            statusState: state,
            periodNumber: Number(event.status?.period || 0),
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

      const headerComp = data?.header?.competitions?.[0];
      const headerComps = headerComp?.competitors || [];
      const awayHeader = headerComps.find(c => c.homeAway === 'away') || headerComps[0];
      const homeHeader = headerComps.find(c => c.homeAway === 'home') || headerComps[1];

      const playersData = data?.boxscore?.players;
      const hasBoxScore = Array.isArray(playersData) && playersData.length >= 2;

      const tabsContainer = boxscoreModal.querySelector('.boxscore-tabs');

      if (!hasBoxScore) {
        if (tabsContainer) tabsContainer.classList.add('hidden');
        boxscoreBody.innerHTML = renderPreGameSummaryHtml(data);
        return;
      }

      if (tabsContainer) tabsContainer.classList.remove('hidden');

      const awayTeamName =
        awayHeader?.team?.displayName ||
        playersData.find(p => p.homeAway === 'away')?.team?.displayName ||
        playersData[0]?.team?.displayName ||
        'Away Team';

      const homeTeamName =
        homeHeader?.team?.displayName ||
        playersData.find(p => p.homeAway === 'home')?.team?.displayName ||
        playersData[1]?.team?.displayName ||
        'Home Team';

      currentBoxScoreData = playersData;
      activeBoxScoreTeamIndex = 0;

      if (tabAway && tabHome) {
        tabAway.textContent = awayTeamName;
        tabHome.textContent = homeTeamName;
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
    const isUpcoming = game.status === 'UPCOMING';

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

    const awayRowHtml = `
      <div class="team-row">
        <div class="team-info">
          <span class="team-logo">${game.away_team_logo}</span>
          <div class="team-meta">
            <div class="team-name-line">
              <span class="team-name ${isAwayFav ? 'is-favorite' : ''}">
                ${game.away_team_name}
              </span>
              <span class="role-tag role-away">AWAY</span>
            </div>
            ${game.away_record ? `<span class="team-record">${game.away_record}</span>` : ''}
          </div>
        </div>
        <span class="team-score ${isFinal ? (awayWinner ? 'winner' : 'loser') : ''}">
          ${isUpcoming ? '-' : game.away_score}
        </span>
      </div>
    `;

    const homeRowHtml = `
      <div class="team-row">
        <div class="team-info">
          <span class="team-logo">${game.home_team_logo}</span>
          <div class="team-meta">
            <div class="team-name-line">
              <span class="team-name ${isHomeFav ? 'is-favorite' : ''}">
                ${game.home_team_name}
              </span>
              <span class="role-tag role-home">HOME</span>
            </div>
            ${game.home_record ? `<span class="team-record">${game.home_record}</span>` : ''}
          </div>
        </div>
        <span class="team-score ${isFinal ? (homeWinner ? 'winner' : 'loser') : ''}">
          ${isUpcoming ? '-' : game.home_score}
        </span>
      </div>
    `;

    return `
      <article class="game-card ${isSpotlight ? 'spotlight' : ''}" data-game-id="${game.id}" data-matchup="${matchupTitle}">
        <div class="game-card-header">
          <div class="badge-group">
            ${isSpotlight ? `<span class="favorite-badge">${badgeLabel}</span>` : ''}
            ${clutchBadge}
            ${broadcastBadge}
          </div>
          <span class="game-status-badge ${isLive ? 'live' : isFinal ? 'final' : 'upcoming'}">
            ${isLive ? '● LIVE' : isFinal ? 'FINAL' : 'UPCOMING'}
          </span>
        </div>

        <div class="matchup">
          ${awayRowHtml}
          ${homeRowHtml}
        </div>

        ${renderCardQuarterStrip(game)}

        <div class="game-card-footer">
          <span class="game-time">${displayPeriod}</span>
          <span class="boxscore-hint">Box Score →</span>
        </div>
      </article>
    `;
  }

  function renderDashboard(games) {
    renderFilterBar();

    if (!Array.isArray(games) || games.length === 0) {
      if (favoriteSection) favoriteSection.classList.add('hidden');
      if (otherContainer) {
        otherContainer.innerHTML = `<p class="loading-text">No NBA games found for this 7-day window.</p>`;
      }
      return;
    }

    // 1. Your Team Spotlight (Today's game first, otherwise All-Day Yesterday Rollover)
    let spotlightGame = null;
    if (favoriteTeamCode && favoriteSection && favoriteContainer) {
      const teamGames = games.filter(
        g => g.home_team_code === favoriteTeamCode || g.away_team_code === favoriteTeamCode
      );

      const todayGame = teamGames.find(g => g.dateGroup === 'today');
      const yesterdayGame = teamGames.find(g => g.dateGroup === 'yesterday');

      if (todayGame) {
        spotlightGame = todayGame;
        favoriteSection.classList.remove('hidden');
        favoriteContainer.innerHTML = renderGameCard(todayGame, true, '⭐ Favorite');
      } else if (yesterdayGame) {
        spotlightGame = yesterdayGame;
        favoriteSection.classList.remove('hidden');
        favoriteContainer.innerHTML = renderGameCard(yesterdayGame, true, '⭐ Favorite • Yesterday');
      } else {
        favoriteSection.classList.add('hidden');
        favoriteContainer.innerHTML = '';
      }
    } else if (favoriteSection) {
      favoriteSection.classList.add('hidden');
    }

    // 2. Apply Status & Slate Filters to Main Scoreboard Grid
    const filteredGames = games.filter(g => {
      if (spotlightGame && g.id === spotlightGame.id) return false;

      if (activeStatusFilter !== 'ALL' && g.status !== activeStatusFilter) {
        return false;
      }

      if (activeSlateFilter === 'TODAY' && g.dateGroup !== 'today') {
        return false;
      }
      if (activeSlateFilter === 'YESTERDAY' && g.dateGroup !== 'yesterday') {
        return false;
      }
      if (activeSlateFilter === 'UPCOMING' && g.dateGroup !== 'upcoming') {
        return false;
      }

      return true;
    });

    // Sort: LIVE first, then TODAY/UPCOMING chronologically, then YESTERDAY/PAST most recent first
    const statusPriority = { LIVE: 0, UPCOMING: 1, FINAL: 2 };
    filteredGames.sort((a, b) => {
      if (statusPriority[a.status] !== statusPriority[b.status]) {
        return statusPriority[a.status] - statusPriority[b.status];
      }
      return a.status === 'FINAL'
        ? b.startTimeMs - a.startTimeMs
        : a.startTimeMs - b.startTimeMs;
    });

    if (otherHeading) {
      const slateTitles = {
        ALL: 'Full Week Scoreboard',
        TODAY: "Today's Games",
        YESTERDAY: "Yesterday's Games",
        UPCOMING: 'Next 3 Days'
      };
      otherHeading.textContent = slateTitles[activeSlateFilter] || 'Scoreboard';
    }

    if (otherContainer) {
      if (filteredGames.length === 0) {
        otherContainer.innerHTML = `<p class="loading-text">No games match the selected filters.</p>`;
      } else {
        otherContainer.innerHTML = filteredGames.map(game => renderGameCard(game, false)).join('');
      }
    }

    // Bind Click Listeners for Box Score Modal
    document.querySelectorAll('.game-card').forEach(card => {
      card.addEventListener('click', () => {
        openBoxScoreModal(card.dataset.gameId, card.dataset.matchup);
      });
    });
  }

  // --- Event Listeners ---
  if (favoriteSelect) {
    favoriteSelect.addEventListener('change', async (e) => {
      favoriteTeamCode = normalizeCode(e.target.value);
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

  // Box Score Modal Events
  if (closeBoxscoreBtn) {
    closeBoxscoreBtn.addEventListener('click', () => boxscoreModal?.classList.add('hidden'));
  }

  if (boxscoreModal) {
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

  // Auth Modal Events
  if (authModalBtn) {
    authModalBtn.addEventListener('click', () => {
      isSignUpMode = false;
      if (authModalTitle) authModalTitle.textContent = 'Sign In to PulseScores';
      if (authSubmitBtn) authSubmitBtn.textContent = 'Sign In';
      if (authError) authError.classList.add('hidden');
      authModal?.classList.remove('hidden');
    });
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => authModal?.classList.add('hidden'));
  }

  if (authSwitchMode) {
    authSwitchMode.addEventListener('click', (e) => {
      e.preventDefault();
      isSignUpMode = !isSignUpMode;
      if (authModalTitle) {
        authModalTitle.textContent = isSignUpMode ? 'Create PulseScores Account' : 'Sign In to PulseScores';
      }
      if (authSubmitBtn) {
        authSubmitBtn.textContent = isSignUpMode ? 'Sign Up' : 'Sign In';
      }
      authSwitchMode.textContent = isSignUpMode
        ? 'Already have an account? Sign In'
        : "Don't have an account? Sign Up";
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = authEmailInput.value.trim();
      const password = authPasswordInput.value;

      if (authError) authError.classList.add('hidden');

      try {
        const { error } = isSignUpMode
          ? await supabaseClient.auth.signUp({ email, password })
          : await supabaseClient.auth.signInWithPassword({ email, password });

        if (error) throw error;
        authForm.reset();
        authModal?.classList.add('hidden');
      } catch (err) {
        if (authError) {
          authError.textContent = err.message;
          authError.classList.remove('hidden');
        }
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
    });
  }

  // --- Initialization ---
  hydrateFavoriteSelectEmojis();
  if (favoriteSelect && favoriteTeamCode) {
    favoriteSelect.value = favoriteTeamCode;
  }

  checkUserSession();
  fetchLiveGames();
  setInterval(() => fetchLiveGames(false), REFRESH_INTERVAL_MS);
})();
