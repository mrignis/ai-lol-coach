// Reads the enemy team's ACTUAL items and turns them into one counter-build
// sentence for the live coach.
//
// The model was already given every item on the board, but it almost never
// turned that into "buy X": itemisation is not in its priority list, and item
// names are easy to misread mid-sentence (it once suggested an item the player
// was already holding). So the read is computed here, deterministically — the
// model receives a finished fact and only has to decide WHEN to say it.
//
// Deliberately conservative: a threat is reported only when the enemy has
// really committed to it (two or more items, or a champion whose whole kit is
// that threat) AND the player has no answer yet. Advice to buy something you
// already counter is worse than silence.

const has = (items, patterns) => items.some(i => patterns.some(p => p.test(i)));
const countHits = (items, patterns) => items.filter(i => patterns.some(p => p.test(i))).length;

// Items that make a champion hard to kill through healing/shielding. The
// component-level entries matter: Grievous is worth buying the moment the
// enemy starts the item, not once it is finished.
// Only real lifesteal, omnivamp or heal/shield power belongs here. Regeneration
// and generic tank items do NOT: Warmog's and Sunfire on an Ornn once made this
// call for Grievous Wounds, when the actual answer to that build is percent-max-
// health damage.
const HEAL_ITEMS = [
  /bloodthirster/i, /ravenous hydra/i, /immortal shieldbow/i, /blade of the ruined king/i,
  /sundered sky/i, /riftmaker/i, /vampiric scepter/i, /sanguine blade/i,
  /bloodsong/i, /moonstone/i, /redemption/i, /ardent censer/i, /staff of flowing water/i,
  /echoes of helia/i, /dream maker/i, /forbidden idol/i,
];
// Champions whose sustain is the kit, not the build — Grievous is correct
// against them even on an empty inventory. Deliberately limited to drain tanks
// and healing enchanters: bruisers with lane sustain (Renekton, Irelia, Darius)
// would otherwise trip this at minute three in every single game.
const HEAL_CHAMPS = /^(soraka|yuumi|vladimir|aatrox|sylas|swain|dr\.? ?mundo|volibear|warwick|briar|nasus|zac|maokai|seraphine|milio|taric|sona|nami|senna|ivern)$/i;
const GRIEVOUS = [
  /executioner/i, /mortal reminder/i, /morellonomicon/i, /oblivion orb/i,
  /chempunk/i, /thornmail/i, /bramble vest/i, /phreakish/i,
];

// Crit/AD carry commitment → armour is the answer, and armour is cheap early.
const CRIT_ITEMS = [
  /infinity edge/i, /essence reaver/i, /navori/i, /collector/i, /rapid firecannon/i,
  /runaan/i, /phantom dancer/i, /statikk/i, /zeal/i, /noonquiver/i, /kraken slayer/i,
  /lord dominik/i, /mortal reminder/i, /bloodthirster/i, /yun tal/i,
];
const ARMOUR = [
  /cloth armor/i, /chain vest/i, /bramble vest/i, /thornmail/i, /frozen heart/i,
  /randuin/i, /sunfire/i, /dead man/i, /zhonya/i, /plated steelcaps/i, /iceborn/i,
  /guardian angel/i, /warden/i, /steelcaps/i, /anathema/i,
];

// AP commitment → magic resist.
const AP_ITEMS = [
  /rabadon/i, /luden/i, /shadowflame/i, /horizon focus/i, /void staff/i, /liandry/i,
  /blackfire/i, /malignance/i, /riftmaker/i, /cryptbloom/i, /stormsurge/i,
  /needlessly large rod/i, /amplifying tome/i, /lich bane/i, /nashor/i, /zhonya/i,
];
const MR = [
  /null-magic mantle/i, /negatron/i, /spectre's cowl/i, /kaenic/i, /rookern/i,
  /force of nature/i, /spirit visage/i, /banshee/i, /maw of malmortius/i,
  /wit's end/i, /mercury's treads/i, /mercurial/i, /abyssal mask/i, /hexdrinker/i,
  /verdant barrier/i, /jak'sho/i, /unending despair/i,
];

// A stacked-HP frontline cannot be killed with flat damage — you need %max HP
// or armour penetration, and which one depends on YOUR damage type.
const HP_ITEMS = [
  /warmog/i, /sunfire/i, /jak'sho/i, /heartsteel/i, /titanic hydra/i, /frozen heart/i,
  /randuin/i, /dead man/i, /thornmail/i, /kaenic/i, /rookern/i, /force of nature/i,
  /unending despair/i, /hollow radiance/i, /bramble vest/i, /giant's belt/i, /kindlegem/i,
];
const SHRED_AD = [/blade of the ruined king/i, /lord dominik/i, /black cleaver/i, /serylda/i, /terminus/i];
const SHRED_AP = [/liandry/i, /void staff/i, /demonic embrace/i, /blackfire/i, /cryptbloom/i];

/**
 * @param enemyBuilds [{ champion, items: [displayName] }]
 * @param myItems     [displayName]
 * @param myDamage    'AP' | 'AD'
 * @returns { threat, buy, text } | null
 */
export function counterBuild({ enemyBuilds = [], myItems = [], myDamage = 'AD' } = {}) {
  const findings = [];

  // ── healing ──
  const healers = enemyBuilds.filter(e =>
    HEAL_CHAMPS.test(e.champion || '') || countHits(e.items || [], HEAL_ITEMS) >= 1);
  if (healers.length && !has(myItems, GRIEVOUS)) {
    findings.push({
      // Two healers, or one that has actually built for it, outranks a defensive
      // item: Grievous is cheap and nothing else replaces it.
      weight: healers.length >= 2 ? 100 : 70,
      threat: `${healers.map(h => h.champion).join(' and ')} ${healers.length > 1 ? 'heal' : 'heals'} through your damage`,
      buy: 'Grievous Wounds — the cheap component (Executioner\'s Calling, Oblivion Orb or Bramble Vest) already cuts the healing',
    });
  }

  // ── physical damage ──
  const critters = enemyBuilds.filter(e => countHits(e.items || [], CRIT_ITEMS) >= 2);
  if (critters.length && !has(myItems, ARMOUR)) {
    findings.push({
      weight: 80,
      threat: `${critters.map(c => c.champion).join(' and ')} ${critters.length > 1 ? 'are' : 'is'} building crit and you have no armour item`,
      buy: 'armour — Chain Vest or Plated Steelcaps is enough to change the trade',
    });
  }

  // ── magic damage ──
  const mages = enemyBuilds.filter(e => countHits(e.items || [], AP_ITEMS) >= 2);
  if (mages.length && !has(myItems, MR)) {
    findings.push({
      weight: 80,
      threat: `${mages.map(m => m.champion).join(' and ')} ${mages.length > 1 ? 'are' : 'is'} stacking AP and you have no magic resist`,
      buy: 'magic resist — Null-Magic Mantle or Mercury\'s Treads first, then a full item',
    });
  }

  // ── stacked health ──
  const tanks = enemyBuilds.filter(e => countHits(e.items || [], HP_ITEMS) >= 2);
  const shred = myDamage === 'AP' ? SHRED_AP : SHRED_AD;
  if (tanks.length && !has(myItems, shred)) {
    findings.push({
      weight: 60,
      threat: `${tanks.map(t => t.champion).join(' and ')} stacked health, so your flat damage does not go through`,
      buy: myDamage === 'AP'
        ? 'percent-health magic damage — Liandry\'s Torment, or Void Staff once they buy magic resist'
        : 'percent-health or armour penetration — Blade of the Ruined King, or Lord Dominik\'s Regards',
    });
  }

  if (!findings.length) return null;
  findings.sort((a, b) => b.weight - a.weight);
  const top = findings[0];
  return { ...top, text: `${top.threat}. Answer: ${top.buy}.` };
}
