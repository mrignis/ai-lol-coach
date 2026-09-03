// What is THIS champion's job in a fight?
//
// The role brief alone was giving Leona enchanter advice: "UTILITY" says to
// peel for the ADC, so a 40-minute game kept telling an engage tank to stand
// behind Jinx while the player was the one starting every fight. Role says
// where you stand on the map; it does not say what you are for.
//
// Positions come from the Live API, so the only thing missing is the champion's
// subclass — and that cannot be read off Data Dragon tags, which file Leona and
// Lulu both as "Support". Hence a curated table. It is deliberately small:
// only distinctions that change the ADVICE are worth encoding.

const ENGAGE_SUPPORT = /^(leona|nautilus|alistar|rakan|thresh|blitzcrank|pyke|rell|maokai|amumu|galio|sett|shen|zac|neeko)$/i;
const ENCHANTER = /^(soraka|yuumi|lulu|janna|nami|sona|milio|renata glasc|karma|seraphine|taric|ivern|bard)$/i;
const POKE_SUPPORT = /^(brand|zyra|xerath|vel'koz|swain|morgana|zilean|lux|hwei|senna|ashe|caitlyn)$/i;

const FARM_SCALER = /^(karthus|master yi|kayle|shyvana|fiddlesticks|evelynn|kindred|graves|nasus|veigar|kassadin|smolder|aurelion sol|twitch|vayne|jinx|kog'maw|azir)$/i;
const EARLY_SKIRMISH = /^(elise|lee sin|nidalee|rengar|kha'zix|xin zhao|jarvan iv|vi|diana|warwick|olaf|udyr|talon|zed|qiyana|pantheon|renekton|lucian|draven|pyke)$/i;
const OBJECTIVE_TANK = /^(sejuani|rammus|nunu & willump|skarner|volibear|trundle|ornn|sion|malphite|zac|amumu|maokai)$/i;

const SPLIT_PUSHER = /^(fiora|camille|jax|tryndamere|yorick|nasus|trundle|riven|irelia|gwen|olaf|kayle|sett)$/i;
const ASSASSIN = /^(zed|talon|katarina|akali|fizz|leblanc|qiyana|kha'zix|rengar|evelynn|naafiri|ekko|nocturne|shaco|yone|akshan)$/i;
const CONTROL_MAGE = /^(orianna|viktor|syndra|azir|anivia|vel'koz|xerath|lux|hwei|zoe|taliyah|cassiopeia|malzahar|ryze|veigar|swain|seraphine|neeko|ziggs)$/i;

// Each brief exists to make the coach say something DIFFERENT from the role
// default, so the ones that contradict it say so out loud.
const BRIEFS = {
  engageSupport:
    'CHAMPION ROLE — ENGAGE SUPPORT. This player STARTS fights; they are the initiator, not a ' +
    'bodyguard. Do NOT tell them to stand behind their carry and peel — that is enchanter advice ' +
    'and it is wrong for this champion. Coach the engage instead: which target to open on, whether ' +
    'their team is close enough to follow, when to hold the engage because a key enemy cooldown is ' +
    'up, and how to get vision before the fight so they can start it on their terms. Their deaths ' +
    'are only a problem when they engage with nobody following.',
  enchanter:
    'CHAMPION ROLE — ENCHANTER SUPPORT. This player does NOT start fights: they keep the carry ' +
    'alive through one. Coach positioning behind the front line, holding a shield/heal or the ' +
    'ultimate for the enemy engage rather than spending it early, who on their team most needs the ' +
    'peel right now, and vision that stops the enemy engaging in the first place.',
  pokeSupport:
    'CHAMPION ROLE — POKE / MAGE SUPPORT. They win by chipping the enemy down before a fight starts ' +
    'and by landing one key spell, not by initiating and not by pure healing. Coach zoning and ' +
    'poke before an objective, saving the point-and-click control for the enemy engage, and staying ' +
    'at maximum range.',
  farmScaler:
    'CHAMPION ROLE — SCALING FARMER. This champion is weak now and wins later; the play is usually ' +
    'to take farm and objectives, not the fight in front of them. Do not push them into early ' +
    'skirmishes they lose. Coach what to farm, which objective to trade for, and which specific ' +
    'power spike (item or level) changes what they can do.',
  earlySkirmish:
    'CHAMPION ROLE — EARLY SKIRMISHER. Their advantage is NOW and it decays; a passive minute is a ' +
    'wasted one. Coach where the next fight can be forced, which enemy is currently killable, and ' +
    'the timer that opens the window. If they fall behind, coach the fastest way back onto the map, ' +
    'not farming until late.',
  objectiveTank:
    'CHAMPION ROLE — OBJECTIVE TANK. They start fights and soak damage for the team; their value is ' +
    'in what they enable, not what they kill. Coach the engage, objective setup, and being in front ' +
    'of the carries. A low KDA is not itself a problem for this champion.',
  splitPusher:
    'CHAMPION ROLE — SPLIT PUSHER. They win a sidelane 1v1 that their team cannot; grouping for ' +
    'every fight wastes them. Coach which sidelane to pressure, when the map makes that safe, and ' +
    'when to actually join the team instead.',
  assassin:
    'CHAMPION ROLE — ASSASSIN. They kill one isolated target, not a grouped team. Do not coach them ' +
    'to fight in the front. Coach finding a carry who has stepped away from the group, the flank ' +
    'route, and the cooldown or ward that makes it survivable.',
  controlMage:
    'CHAMPION ROLE — CONTROL MAGE. Their job is damage and zone control from range. Coach where to ' +
    'stand so they can hit the front without being reachable, holding their control spell for the ' +
    'enemy engage, and using wave control to leave for an objective safely.',
  marksman:
    'CHAMPION ROLE — MARKSMAN. They are the sustained damage and the most killable player in a ' +
    'fight. They never initiate. Coach positioning last into a fight, what to hit when the front ' +
    'line is in the way, and when to take a sidelane instead of grouping.',
};

/**
 * @param champion  champion name as the client spells it
 * @param position  TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY (may be empty)
 * @param champs    Data Dragon map from getChampions(), used only as a fallback
 */
export function championBrief(champion, position, champs) {
  const name = String(champion || '');
  if (!name) return '';

  // Support subclass first: this is the split the role brief gets wrong, and
  // the one the player actually complained about.
  if (position === 'UTILITY') {
    if (ENGAGE_SUPPORT.test(name)) return BRIEFS.engageSupport;
    if (ENCHANTER.test(name)) return BRIEFS.enchanter;
    if (POKE_SUPPORT.test(name)) return BRIEFS.pokeSupport;
  }
  if (position === 'JUNGLE') {
    if (OBJECTIVE_TANK.test(name)) return BRIEFS.objectiveTank;
    if (FARM_SCALER.test(name)) return BRIEFS.farmScaler;
    if (EARLY_SKIRMISH.test(name)) return BRIEFS.earlySkirmish;
  }
  if (position === 'TOP' && SPLIT_PUSHER.test(name)) return BRIEFS.splitPusher;
  if (position === 'BOTTOM') return BRIEFS.marksman;
  if (ASSASSIN.test(name)) return BRIEFS.assassin;
  if (CONTROL_MAGE.test(name)) return BRIEFS.controlMage;

  // Nothing curated — fall back to Data Dragon's tags, which are coarse but
  // still better than treating every champion in a position the same way.
  const tags = champs?.[name]?.tags || [];
  if (tags.includes('Marksman')) return BRIEFS.marksman;
  if (tags.includes('Assassin')) return BRIEFS.assassin;
  if (tags.includes('Mage')) return BRIEFS.controlMage;
  if (tags.includes('Tank')) return BRIEFS.objectiveTank;
  return '';
}
