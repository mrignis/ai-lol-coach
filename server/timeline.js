// Running match narrative.
//
// The coach used to see only a snapshot ("you are 6k behind"), which is why it
// felt slow and went vague in the late game: a snapshot cannot tell you that
// the enemy just took Baron, or that you have died twice in the last two
// minutes. This module diffs consecutive live readings and keeps a short log of
// what actually HAPPENED, so the advice can respond to the flow of the game.

const MAX_EVENTS = 40;      // plenty for a narrative, bounded memory
const RECENT_WINDOW = 120;  // seconds counted as "just happened"

// One state per game; keyed by the game's start so a new match resets cleanly.
let current = null;

const mmss = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

function reset(key) {
  // `seq` counts every event ever logged this game and is never trimmed.
  // The events array is capped, so its length stops changing after MAX_EVENTS
  // and anything using it to detect "something happened" goes deaf — which is
  // what silenced the event-driven tips ~15 minutes into a game.
  // `sigSeq` counts only events that can change what the player should DO.
  // Buying an item was 28% of all events in a recorded game and refreshed the
  // tip every time, spending a third of a scarce daily token budget on advice
  // that had no reason to change.
  current = { key, events: [], lastSeen: {}, lastEventTime: 0, seq: 0, sigSeq: 0 };
}

// Riot's event list is authoritative for kills/objectives, so we consume it
// rather than trying to infer those from score deltas.
function ingestRiotEvents(riotEvents, me, teamOf) {
  const out = [];
  for (const e of riotEvents) {
    if (e.EventTime <= current.lastEventTime) continue; // already logged
    const mine = n => teamOf[n] && teamOf[n] === teamOf[me];
    switch (e.EventName) {
      case 'ChampionKill': {
        const who = e.KillerName === me ? 'YOU killed' : e.VictimName === me ? 'YOU DIED to' : null;
        if (who) out.push({ t: e.EventTime, text: `${who} ${e.KillerName === me ? e.VictimName : e.KillerName}` });
        else out.push({ t: e.EventTime, text: `${mine(e.KillerName) ? 'ally' : 'enemy'} kill: ${e.KillerName} killed ${e.VictimName}` });
        break;
      }
      case 'DragonKill':
        out.push({ t: e.EventTime, text: `${mine(e.KillerName) ? 'YOUR TEAM' : 'ENEMY'} took ${e.DragonType || ''} dragon`.replace(/\s+/g, ' ') });
        break;
      case 'BaronKill':
        out.push({ t: e.EventTime, text: `${mine(e.KillerName) ? 'YOUR TEAM' : 'ENEMY'} took BARON` });
        break;
      case 'HeraldKill':
        out.push({ t: e.EventTime, text: `${mine(e.KillerName) ? 'YOUR TEAM' : 'ENEMY'} took Herald` });
        break;
      case 'TurretKilled':
        out.push({ t: e.EventTime, text: `${/T1/.test(e.TurretKilled || '') === (teamOf[me] === 'CHAOS') ? 'YOUR TEAM' : 'ENEMY'} destroyed a turret` });
        break;
      case 'InhibKilled':
        out.push({ t: e.EventTime, text: `${/T1/.test(e.InhibKilled || '') === (teamOf[me] === 'CHAOS') ? 'YOUR TEAM' : 'ENEMY'} destroyed an inhibitor` });
        break;
      case 'FirstBrick':
      case 'FirstBlood':
        break; // covered by the kill/turret entries above
      default:
        break;
    }
    current.lastEventTime = Math.max(current.lastEventTime, e.EventTime);
  }
  return out;
}

// Things Riot does not emit as events but that matter to coaching: the player
// buying an item, levelling their ultimate, or their gold piling up unspent.
function diffPlayerState(now, gameTime) {
  const out = [];
  const prev = current.lastSeen;
  if (prev.items) {
    const bought = (now.items || []).filter(i => !prev.items.includes(i));
    if (bought.length) out.push({ t: gameTime, text: `you bought ${bought.join(', ')}` });
  }
  if (prev.ultLevel != null && now.ultLevel > prev.ultLevel && now.ultLevel === 1) {
    out.push({ t: gameTime, text: 'you unlocked your ultimate' });
  }
  current.lastSeen = { items: [...(now.items || [])], ultLevel: now.ultLevel };
  return out;
}

/**
 * Feed one live reading; returns the narrative to show the model.
 * @returns {{recent: string[], all: string[], summary: string}}
 */
export function track({ gameTime, riotEvents, meName, teamOf, playerState }) {
  // A shorter clock than last time means a different match.
  const key = `${meName}`;
  if (!current || current.key !== key || gameTime < current.lastEventTime - 60) reset(key);

  const fresh = [
    ...ingestRiotEvents(riotEvents || [], meName, teamOf || {}),
    ...diffPlayerState(playerState || {}, gameTime),
  ].sort((a, b) => a.t - b.t);

  current.events.push(...fresh);
  current.seq += fresh.length;
  // A purchase or an ultimate unlock is worth logging for the narrative, but
  // it is not a reason to spend an AI call.
  current.sigSeq += fresh.filter(e => !/you bought|unlocked your ultimate/.test(e.text)).length;
  if (current.events.length > MAX_EVENTS) current.events = current.events.slice(-MAX_EVENTS);

  const recent = current.events
    .filter(e => gameTime - e.t <= RECENT_WINDOW)
    .map(e => `${mmss(e.t)} ${e.text}`);

  return {
    recent,
    seq: current.seq,        // every event, monotonic
    sigSeq: current.sigSeq,  // only events worth a fresh tip — diff THIS one
    all: current.events.map(e => `${mmss(e.t)} ${e.text}`),
    // A compact read of momentum: who has been winning the last two minutes.
    summary: momentum(gameTime),
  };
}

function momentum(gameTime) {
  const window = current.events.filter(e => gameTime - e.t <= RECENT_WINDOW);
  if (!window.length) return 'quiet last 2 minutes — nothing happened';
  let good = 0, bad = 0;
  for (const e of window) {
    if (/YOU killed|YOUR TEAM|ally kill/.test(e.text)) good++;
    if (/YOU DIED|ENEMY|enemy kill/.test(e.text)) bad++;
  }
  if (good > bad) return `last 2 minutes went YOUR way (${good} good vs ${bad} bad events)`;
  if (bad > good) return `last 2 minutes went BADLY (${bad} bad vs ${good} good events) — stabilise before forcing anything`;
  return 'last 2 minutes traded evenly';
}

export function resetTimeline() { current = null; }
