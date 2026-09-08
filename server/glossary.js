// Per-language terminology, kept out of llm.js because it grew past the point
// where it belonged inside a prompt file.
//
// Every entry below is how players in that region actually write, taken from
// community glossaries and guides rather than from translation instinct — the
// sources are listed in the commit that added them. The pattern is the same
// almost everywhere: the game's nouns are borrowed from English and inflected
// locally, while a handful of objectives get a native name. An earlier rule
// telling the model "no transliterated English" was therefore wrong in eleven
// languages at once, and produced textbook phrasing no player uses.
//
// Only terms that turn up in live tips are listed. A dictionary the coach never
// reaches for is prompt weight for nothing.

const TERMS = {
  uk: [
    'vision / vision score = огляд (NOT "візія", NOT "бачення"; uncountable — "огляду за хвилину", never "оглядів")',
    // Verbs are listed with the imperative the tip should actually use — given
    // only the dictionary form the model opened tips with "Ставити…".
    'ward = вард / варди; control ward = контрольний вард; to ward → command form "Постав вард" ' +
      '(never "Ставити"); sweep = чистити ворожі варди → "Почисти"',
    'lane = лінія; mid = мід; top = топ; wave = хвиля; minion = міньйон; to push = пушити',
    'jungle = ліс (NOT "джунгл"); jungler = лісник; camp = кемп; full clear = повний зачист лісу',
    'objective = об’єкт; spawn / respawn = поява / відродження (NOT "спавн"); pit = яма',
    'kill participation = участь у вбивствах; deaths per game = смертей за гру',
    'gold per minute = золота за хвилину; damage per minute = шкоди за хвилину; CS per minute = КС за хвилину',
    'trade = розмін; last-hit = добивати; back / recall = повернення на базу; roam = роум, роумити',
    'gank = ганк, ганкати; crowd control = контроль; cooldown = кулдаун; peel = прикривати',
    'shield = щит; heal = лікування; carry = керрі; front line = передня лінія; positioning = позиціювання',
    'ADC / bot carry = АДК (in Cyrillic, never "ADC"); support = сапорт; ultimate = ульта; dash = ривок',
    'inhibitor = інгібітор (NOT "інхібітор", NOT "інхіботор"); super minions = суперміньйони',
    'Baron buff = баф барона (NOT "баронський баф"); turret / tower = вежа; base = база; river = річка',
    // Borrowed forms players actually use at the keyboard.
    'Jungle buffs are named the way players say them: blue buff = блу баф, red buff = ред баф ' +
      '("синій баф" / "червоний баф" are also fine). Dragon = дракон or дрейк, both natural.',
    'Write a borrowed term FULLY in Cyrillic or not at all. "Baron-баф" and "Dragon-яма" are wrong ' +
      'in both directions: either "баф барона" and "яма Барона", or leave the proper name alone as ' +
      'its own Latin word. Never hyphenate the two alphabets together.',
    // Actual garbage this model has produced. Naming the exact mistake works
    // better than restating the rule it already broke.
    'NEVER write any of these, they are not Ukrainian words or are plain wrong: ' +
      '"воронка"/"воронок" (invented, vision is огляд) · "позивний" (meaningless here) · ' +
      '"ADC", "ADC-й" (write АДК) · "vs" (write "проти" or use a dash) · "спавн" (write поява) · ' +
      '"dmg", "gold", "CS per min", "GPM", "DPM" (write the stat out) · "візія"/"візій" (write огляд)',
    'Never glue an English word to a Ukrainian ending with a hyphen. Every noun must agree with ' +
      'its adjective in gender and number ("захисне вміння", never "захисний уміння").',
    'Champion names: copy them EXACTLY as the client spells them, in Latin letters, every time — ' +
      'Kai\'Sa, Kha\'Zix, Nunu & Willump. Never transliterate a champion name into Cyrillic and ' +
      'never mix alphabets inside one name.',
    'Fighting someone is "проти <Champion>" or "з <Champion>" — never "у <Champion>". ' +
      'Contesting an objective is "не борись за баф" / "не контестуй барона" — "оскаржувати" is a ' +
      'legal term and is wrong here.',
    'Neutral objectives have ONE name each, always the same one: Rift Herald = Вісник ' +
      '(never "Герольд"), Baron Nashor = Барон, Void Grubs = личинки, Elder Dragon = Старійшина, ' +
      'Rift Scuttler = краб. Jungle camps: Gromp, Krugs, Raptors, Wolves — keep these in English.',
    'Never put a Latin letter inside a Cyrillic word. Words like "міда", "барона", "дракона" end ' +
      'in the Cyrillic letter "а" — check every word ending before you output it.',
    'Trinkets are things you USE, never places and never adjectives. Write "почисти варди" or ' +
      '"почисти варди підмітальником", NEVER "почисти Oracle Lens огляд" or "яма Oracle Lens". ' +
      'An item name may never be glued to a location — the pit is "яма Барона", the river is "річка".',
  ],
  ru: [
    'Most terms are borrowed from English and declined in Russian — that is how players write.',
    'ward = вард / варды; control ward = контрольный вард; to ward → "Поставь вард"; sweep = "Снеси варды"',
    'vision = вижн or обзор; lane = лейн (топ / мид / бот); jungle = лес; jungler = лесник',
    'gank = ганк, ганкать; minions = минионы; wave = волна; last-hit = добивать; farm = фармить',
    'blue buff = синий баф or блю; red buff = красный баф or ред; dragon = дракон or дрейк',
    'Baron Nashor = Барон; Rift Herald = Вестник; objective = объект; pit = яма',
    'ultimate = ульта; recall = отход на базу; peel = прикрывать; turret = башня; inhibitor = ингибитор',
    'ADC = АДК or керри; support = саппорт; super minions = суперминьоны',
    'Champion and item names stay in Latin as their own word. Never hyphenate one onto a Cyrillic ' +
      'ending ("Baron-баф") and never put a Latin letter inside a Cyrillic word.',
  ],
  de: [
    'German players keep most English game nouns untranslated — use them, do not calque them.',
    'Keep in English: Ward, Control Ward, Gank / ganken, Jungle, Jungler, Lane, Buff, Roaming, ' +
      'Push, Farm, Wave, Peel, Poke, Recall, Ultimate (or Ulti), Objective',
    'German words that ARE the normal choice: Drache (dragon), Sicht (vision), Turm (turret), ' +
      'Basis (base), Busch (bush), Welle (wave, alongside "Wave")',
    'Baron Nashor = Baron; Rift Herald = Herold; blue buff = Blue Buff; red buff = Red Buff',
    'Address the player with "du" and the imperative: "Setz einen Ward", never the infinitive.',
  ],
  fr: [
    'ward = balise (or "ward", both used); control ward = balise rose or balise de contrôle; ' +
      'to ward → "Pose une balise"',
    'vision = vision; lane = lane or voie; jungle = jungle; jungler = jungler',
    'gank = gank, ganker; minions = sbires; wave = wave or vague; last-hit = last-hit, farmer',
    'dragon = drake or dragon; Baron Nashor = Nash or Baron; Rift Herald = Héraut; objective = objectif',
    'ultimate = ultime or ult; recall = rentrer / retour base; peel = protéger; turret = tourelle; ' +
      'inhibitor = inhibiteur; super minions = super sbires',
    'Address the player with "tu" and the imperative: "Pose une balise", never the infinitive.',
  ],
  es: [
    'ward = guardián or centinela ("ward" is also common); control ward = guardián de control',
    'vision = visión; lane = línea or carril; jungle = jungla; jungler = jungla or jungler',
    'gank = gankeo, gankear; minions = súbditos or esbirros; wave = oleada; last-hit = rematar, farmear',
    'dragon = dragón; Baron Nashor = Barón; Rift Herald = Heraldo; objective = objetivo',
    'blue buff = buff azul; red buff = buff rojo; ultimate = definitiva or ulti; recall = volver a base',
    'turret = torreta; inhibitor = inhibidor; super minions = súbditos supremos',
    'Address the player as "tú" and use the imperative: "Pon un guardián".',
  ],
  pl: [
    'English nouns are borrowed and DECLINED in Polish — "wardy", "gankować" are correct, not sloppy.',
    'ward = ward / wardy; control ward = control ward; to ward → "Postaw warda"; sweep = "Zbij wardy"',
    'vision = wizja; lane = linia; jungle = las or jungla; jungler = jungler or leśnik',
    'gank = gank, gankować; minions = miniony or stwory; wave = fala; last-hit = dobijać, farmić',
    'dragon = smok; Baron Nashor = baron; Rift Herald = Herold; objective = cel',
    'ultimate = ulti; recall = powrót do bazy; turret = wieża; inhibitor = inhibitor',
    'Address the player informally and use the imperative: "Postaw warda".',
  ],
  pt: [
    'ward = sentinela (or "ward"); control ward = sentinela de controlo',
    'vision = visão; lane = rota or lane; jungle = selva; jungler = caçador or jungler',
    'gank = gank, gankar; minions = tropas or minions; wave = wave or onda; last-hit = farmar',
    'dragon = dragão; Baron Nashor = Barão; Rift Herald = Arauto do Vale; objective = objetivo',
    'ultimate = ultimate or ult; recall = voltar à base; turret = torre; inhibitor = inibidor',
    'Address the player as "você" and use the imperative: "Coloque uma sentinela".',
  ],
  tr: [
    'ward = ward; control ward = kontrol wardı; to ward → "Ward bas"',
    'vision = görüş; lane = koridor; jungle = orman; jungler = ormancı',
    'gank = gank, gank atmak; minions = minyonlar; wave = dalga; last-hit = son vuruş, farm yapmak',
    'dragon = ejder; Baron Nashor = Baron; Rift Herald = Vadi Habercisi; objective = obje',
    'ultimate = ulti; recall = üsse dön; turret = kule; inhibitor = engelleyici',
    'Address the player informally ("sen") and use the imperative: "Ward bas".',
  ],
  ko: [
    'Korean has established Hangul forms — write these, not the English words.',
    'ward = 와드; control ward = 제어 와드; to ward → "와드 박아"; sweep = "와드 지워"',
    'vision = 시야; lane = 라인 (탑 / 미드 / 봇); jungle = 정글; jungler = 정글러',
    'gank = 갱킹, 갱; minions = 미니언; wave = 웨이브; last-hit = 막타; CS = CS',
    'dragon = 용 or 드래곤; Baron Nashor = 바론; Rift Herald = 전령; objective = 오브젝트',
    'ADC = 원딜 (never write "ADC"); support = 서폿; ultimate = 궁 or 궁극기; recall = 귀환',
    'turret = 포탑; inhibitor = 억제기; super minions = 슈퍼 미니언',
    'Use the plain informal ending, not polite -세요 forms: "와드 박아".',
  ],
  zh: [
    'ward = 眼 (placing one = 插眼); control ward = 真眼; sweeping = 排眼',
    'vision = 视野; lane = 路 (上路 / 中路 / 下路); jungle = 野区; jungler = 打野',
    'gank = gank or 抓人; minions = 小兵; wave = 兵线; last-hit = 补刀; farm = 发育',
    'dragon = 小龙; Baron Nashor = 大龙; Rift Herald = 峡谷先锋; objective = 资源',
    'ADC = ADC; support = 辅助; ultimate = 大招; recall = 回城; turret = 防御塔 or 塔; inhibitor = 水晶',
    'Write "gank" and "ADC" in Latin — Chinese players do. Do not invent Chinese spellings for them.',
  ],
  ja: [
    'Japanese uses katakana forms of the English terms — write those, not English spellings.',
    'ward = ワード; control ward = コントロールワード; to ward → "ワードを置け"',
    'vision = 視界; lane = レーン (トップ / ミッド / ボット); jungle = ジャングル; jungler = ジャングラー',
    'gank = ガンク; minions = ミニオン; wave = ウェーブ; last-hit = ラストヒット; CS = CS',
    'dragon = ドラゴン; Baron Nashor = バロン; Rift Herald = ヘラルド; objective = オブジェクト',
    'ADC = ADC; support = サポート; ultimate = ウルト; recall = リコール; turret = タワー; inhibitor = インヒビター',
    'peel = ピール; poke = ポーク; bait = ベイト. Use plain-form imperatives, not polite -ましょう.',
  ],
  vi: [
    'ward = mắt (placing one = cắm mắt); control ward = mắt kiểm soát; sweeper = mắt quét',
    'vision = tầm nhìn; lane = lane or đường; jungle = rừng; jungler = đi rừng',
    'gank = gank; minions = lính; wave = wave or lính; last-hit = farm, ăn lính',
    'dragon = rồng; Baron Nashor = Baron; Rift Herald = Sứ Giả Khe Nứt; objective = mục tiêu',
    'ADC = xạ thủ or ADC; support = hỗ trợ; ultimate = chiêu cuối; recall = về nhà',
    'turret = trụ; inhibitor = nhà lính; super minions = lính siêu cấp',
    'Address the player as "bạn" and use direct imperatives: "Cắm mắt ở sông".',
  ],
};

// Indented so each line reads as a bullet under "Terms:" in the prompt.
export const LANG_TERMS = Object.fromEntries(
  Object.entries(TERMS).map(([lang, lines]) => [lang, lines.map(l => '  ' + l).join('\n')])
);
