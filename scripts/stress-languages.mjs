// Language stress test.
//
//   node scripts/stress-languages.mjs           all 13 languages, 3 scenarios
//   node scripts/stress-languages.mjs uk ko     just those
//
// Runs the same synthetic boards through the real tip pipeline in every
// language and checks the things that have actually gone wrong before, rather
// than eyeballing prose nobody on the team can read. Costs one API call per
// language per scenario, so it is a deliberate action, not part of a build.
import { liveTip, tipFault } from '../server/llm.js';

const LANGS = ['en', 'uk', 'ru', 'fr', 'de', 'es', 'pl', 'pt', 'tr', 'ko', 'zh', 'ja', 'vi'];

// Which script the answer must be written in. A tip that comes back in English
// when Korean was asked for is the single most visible failure, and it does not
// show up in any of the other checks.
const SCRIPT = {
  uk: /[Ѐ-ӿ]/, ru: /[Ѐ-ӿ]/,
  ko: /[가-힯]/, ja: /[぀-ヿ]/, zh: /[一-鿿]/,
};
// For Latin-script languages there is only one failure worth testing: the model
// answers in ENGLISH instead. A first attempt listed a handful of function
// words per language and demanded one of them appear, which failed three
// perfectly good tips — "Profite des 28 secondes de mort de Shaco" is French
// whether or not it happens to contain "tu" or "avec". So the test now looks
// for English rather than for the absence of a short wordlist.
const ENGLISH = /\b(the|your|you|with|before|they|their|and|now|while|keep|push|take)\b/gi;
function looksEnglish(text) {
  const words = text.split(/\s+/).length;
  const hits = (text.match(ENGLISH) || []).length;
  return hits / Math.max(words, 1) > 0.18;
}

// The local words for things that do NOT exist on the Howling Abyss. Taken from
// the same community glossaries as server/glossary.js.
const RIFT_ONLY = {
  en: /\b(jungle|jungler|dragon|drake|baron|ward|wards|recall|back to base)\b/i,
  // Word boundaries matter: without one, the Polish "las" (forest) matched
  // inside "zlassują" and failed a tip that never mentioned the jungle. The
  // Cyrillic ones need an explicit boundary too, since \b does not fire between
  // two Cyrillic letters the way the ASCII-only class expects.
  uk: /(^|[^а-яіїєґА-ЯІЇЄҐ'])(ліс|лісник|дракон|дрейк|барон|вард|підмітальник)[а-яіїєґ']*/i,
  ru: /(^|[^а-яёА-ЯЁ])(лес|лесник|дракон|дрейк|барон|вард)[а-яё]*/i,
  fr: /\b(jungle|jungler|drake|dragon|nash|baron|balise|ward)\w*/i,
  de: /\b(jungle|jungler|drache|drake|baron|ward)\w*/i,
  es: /\b(jungla|jungler|dragón|barón|guardián|centinela|ward)\w*/i,
  pl: /\b(jungl|las|leśnik|smok|baron|ward)\w*/i,
  pt: /\b(selva|caçador|dragão|barão|sentinela|ward)\w*/i,
  tr: /\b(orman|ormancı|ejder|baron|ward)\w*/i,
  ko: /(정글|드래곤|용|바론|와드|전령)/,
  zh: /(野区|打野|小龙|大龙|插眼|真眼|排眼)/,
  ja: /(ジャングル|ドラゴン|バロン|ワード)/,
  vi: /(đi rừng|rừng|rồng|baron|cắm mắt|mắt)/i,
};

const champ = (name, team, dead = false) => ({
  champion: name, position: '', isMe: false,
  k: 4, d: 5, a: 11, lvl: 13, dead, respawnIn: dead ? 28 : 0,
});

function board({ aram, me, myPos, allies, enemies, deadEnemy }) {
  const mkAlly = (n, pos, isMe = false) => ({ ...champ(n, 'ORDER'), position: pos, isMe });
  const mkFoe = (n, pos) => ({ ...champ(n, 'CHAOS', n === deadEnemy), position: pos });
  return {
    ctx: {
      phase: 'mid', aram, goldDiff: -2200,
      enemyDamage: { ad: 2, ap: 3 }, myArmor: 60, myMagicResist: 40,
      myHpPct: 62, myResourcePct: 45, ultLevel: 2,
      myItems: ["Luden's Companion", "Sorcerer's Shoes"],
      enemyBuilds: enemies.map(([n]) => ({ champion: n, items: ['Zhonya\'s Hourglass'] })),
      myCurrentGold: 1800, counter: null,
      deadEnemies: deadEnemy ? [{ champion: deadEnemy, respawnIn: 28 }] : [],
      dragons: { mine: 1, theirs: 2 }, barons: { mine: 0, theirs: 0 },
      turrets: { mine: 2, theirs: 3 }, inhibs: { mine: 0, theirs: 0 },
      myKills: 18, enemyKills: 24, teamItemGold: 26000, enemyItemGold: 28200,
      allies: allies.map(([n, p], i) => mkAlly(n, p, i === 0)),
      enemies: enemies.map(([n, p]) => mkFoe(n, p)),
      lanePartner: null, csTarget: aram ? 0 : 7,
      champBrief: '', myKP: 61,
      timeline: { recent: ['14:20 you killed ' + enemies[0][0]], sigSeq: 30, summary: 'even trades' },
    },
    me: {
      champion: me, role: myPos, level: 13,
      kills: 4, deaths: 5, assists: 11, cs: 90, csPerMin: 6, wardScore: aram ? 0 : 14, gold: 1800,
    },
  };
}

const SCENARIOS = [
  {
    name: 'Rift · support, enemy jungler dead',
    ...board({
      aram: false, me: 'Leona', myPos: 'UTILITY', deadEnemy: 'Shaco',
      allies: [['Leona', 'UTILITY'], ['Jinx', 'BOTTOM'], ['Zac', 'JUNGLE'], ['Yasuo', 'MIDDLE'], ['Garen', 'TOP']],
      enemies: [['Shaco', 'JUNGLE'], ['Jhin', 'BOTTOM'], ['Sett', 'TOP'], ['Ahri', 'MIDDLE'], ['Nami', 'UTILITY']],
    }),
  },
  {
    name: 'Rift · mid, nobody dead',
    ...board({
      aram: false, me: 'Orianna', myPos: 'MIDDLE', deadEnemy: null,
      allies: [['Orianna', 'MIDDLE'], ['Ezreal', 'BOTTOM'], ['Vi', 'JUNGLE'], ['Thresh', 'UTILITY'], ['Camille', 'TOP']],
      enemies: [['Zed', 'MIDDLE'], ['Caitlyn', 'BOTTOM'], ['Ornn', 'TOP'], ['Elise', 'JUNGLE'], ['Lulu', 'UTILITY']],
    }),
  },
  {
    name: 'ARAM · one lane, enemy carry dead',
    ...board({
      aram: true, me: 'Lux', myPos: 'MIDDLE', deadEnemy: 'Jhin',
      allies: [['Lux', 'MIDDLE'], ['Sett', 'MIDDLE'], ['Ezreal', 'MIDDLE'], ['Nami', 'MIDDLE'], ['Garen', 'MIDDLE']],
      enemies: [['Jhin', 'MIDDLE'], ['Ziggs', 'MIDDLE'], ['Sona', 'MIDDLE'], ['Darius', 'MIDDLE'], ['Veigar', 'MIDDLE']],
    }),
  },
];

const want = process.argv.slice(2).filter(a => LANGS.includes(a));
const langs = want.length ? want : LANGS;

const rows = [];
for (const sc of SCENARIOS) {
  const roster = [...sc.ctx.allies, ...sc.ctx.enemies].map(p => p.champion);
  const alive = sc.ctx.enemies.filter(e => !e.dead).map(e => e.champion);
  for (const lang of langs) {
    let tip = '', source = '', err = null;
    try {
      const r = await liveTip({
        me: sc.me, gameTimeSec: 900, role: sc.me.role, nudges: [],
        ctx: sc.ctx, lang, recentTips: [], overused: [],
      });
      tip = r.tip || '';
      source = r.source || 'template';
      if (!tip) err = 'no text (' + (r.why || r.code) + ')';
    } catch (e) {
      err = String(e.message).slice(0, 60);
    }

    const problems = [];
    if (err) problems.push(err);
    if (tip) {
      const f = tipFault(tip, sc.me.champion);
      if (f) problems.push(f.why);

      // Answered in the right language?
      const script = SCRIPT[lang];
      if (script && !script.test(tip)) problems.push('not written in ' + lang);
      else if (!script && lang !== 'en' && looksEnglish(tip)) problems.push('answered in English');

      // ARAM must never mention something that is not on that map.
      if (sc.ctx.aram && RIFT_ONLY[lang]?.test(tip)) {
        problems.push('rift-only: ' + tip.match(RIFT_ONLY[lang])[0]);
      }
      // Invented respawn window: a countdown on someone who is not dead. Naming
      // a past kill is fine and normal — "you cannot convert Zed's death into
      // pressure" refers to the timeline, and an earlier version of this check
      // wrongly failed it. What matters is a TIMER on a living champion.
      if (!sc.ctx.deadEnemies.length) {
        const timer = /\d+\s*(s\b|sec|сек|secondes?|segundos?|sekund|saniye|초|秒|giây)/i;
        const death = /(dead|мертв|мёртв|mort|tot|muerto|morto|nie żyje|ölü|죽|死|chết)/i;
        if (timer.test(tip) && death.test(tip)) {
          problems.push('invented a respawn timer — nobody is dead on this board');
        }
      }
      // Champion names must survive verbatim.
      const mangled = roster.filter(c => tip.includes(c.slice(0, 4)) && !tip.includes(c));
      if (mangled.length) problems.push('mangled name: ' + mangled[0]);
    }
    rows.push({ scenario: sc.name, lang, source, problems, tip });
    process.stdout.write(problems.length ? 'x' : '.');
  }
}
console.log('\n');

let failed = 0;
for (const sc of SCENARIOS) {
  console.log('── ' + sc.name);
  for (const r of rows.filter(r => r.scenario === sc.name)) {
    const ok = r.problems.length === 0;
    if (!ok) failed++;
    console.log('   ' + (ok ? 'ok  ' : 'FAIL') + ' ' + r.lang.padEnd(3) +
      (ok ? '' : '  ← ' + r.problems.join('; ')));
    if (!ok) console.log('        ' + r.tip.slice(0, 130));
  }
  console.log();
}
const sources = {};
for (const r of rows) sources[r.source] = (sources[r.source] || 0) + 1;
console.log('checked ' + rows.length + ' tips · sources: ' +
  Object.entries(sources).map(([k, v]) => k + ' ' + v).join(', '));
console.log(failed ? failed + ' FAILED' : 'all clean');
process.exit(failed ? 1 : 0);
