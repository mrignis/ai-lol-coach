// Lightweight i18n for the UI chrome. Languages cover the major LoL regions.
// The AI coach text is localized separately (the LLM is told to reply in the
// chosen language); the offline template + live nudges stay English for now.
const LANG_NAMES = {
  en: 'English', uk: 'Українська', fr: 'Français', de: 'Deutsch', es: 'Español',
  pl: 'Polski', pt: 'Português (BR)', ru: 'Русский', tr: 'Türkçe',
  ko: '한국어', zh: '中文', ja: '日本語', vi: 'Tiếng Việt',
};

// English name of each language — used to instruct the LLM which language to reply in.
const LANG_LLM = {
  en: 'English', uk: 'Ukrainian', fr: 'French', de: 'German', es: 'Spanish',
  pl: 'Polish', pt: 'Brazilian Portuguese', ru: 'Russian', tr: 'Turkish',
  ko: 'Korean', zh: 'Simplified Chinese', ja: 'Japanese', vi: 'Vietnamese',
};

const LANGS = {
  en: {
    tagline: 'Reads your last 20 ranked games and tells you the 3 things <em>you</em> should fix.',
    liveLink: '⚡ Live in-game companion (beta)',
    placeholder: 'Name#TAG  (e.g. Faker#KR1)',
    analyze: 'Analyze', wrLabel: 'win rate · last', fixesTitle: 'Your 3 things to fix',
    target: 'target', lastPre: 'Last', lastPost: 'games',
    footer: 'Official Riot API · post-game coaching only · not affiliated with Riot Games',
    coachLocal: 'coach text generated locally (LLM offline — start Ollama for richer advice)',
    coachBy: 'coach text by', roleMixed: '⚠ You play several roles, so numbers are blended — read the advice against your main role.',
    noRanked: 'ℹ No ranked games found — analyzing your most recent games of any queue.',
    errFormat: 'Enter your Riot ID as Name#TAG (e.g. Faker#KR1).', errServer: 'Could not reach the server. Is it running?',
    errFail: 'Analysis failed.', unranked: 'Unranked', mostly: 'mostly', csm: 'cs/m',
    win: 'Win', loss: 'Loss', remake: 'remake', onTrack: "You're on track — keep doing what you're doing. 👍",
    loading: ['finding your account…', 'reading your last 20 games…', 'crunching your numbers…', 'comparing you to your rank…', 'writing your coaching…'],
    roles: { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' },
    liveTitle: 'Live Companion', liveTagline: 'In-game nudges from the official Live Client Data API · <em>informational only</em>',
    rankTier: 'Your rank tier:', tierLow: 'Iron–Silver', tierMid: 'Gold–Plat', tierHigh: 'Emerald+',
    waiting: 'Waiting for a game… launch League and load into a match.', detected: 'Game detected — loading player data…',
    noServer: 'Cannot reach the coach server. Is it running?', rightNow: 'Right now',
    statKDA: 'KDA', statCS: 'CS', statVision: 'Vision', statGold: 'Gold', backLink: '← post-game analysis',
    liveFooter: 'ToS-safe: read-only, no automation. Show this on a 2nd monitor or in windowed mode.',
  },
  uk: {
    tagline: 'Аналізує твої останні 20 ранкед-ігор і каже 3 речі, які <em>тобі</em> варто виправити.',
    liveLink: '⚡ Live-компаньйон у грі (бета)',
    placeholder: 'Нік#ТЕГ  (напр. Faker#KR1)',
    analyze: 'Аналіз', wrLabel: 'вінрейт · останні', fixesTitle: 'Твої 3 речі для виправлення',
    target: 'ціль', lastPre: 'Останні', lastPost: 'ігор',
    footer: 'Офіційне Riot API · лише післяматчевий коучинг · не пов’язано з Riot Games',
    coachLocal: 'текст згенеровано локально (LLM вимкнено — запусти Ollama для кращих порад)',
    coachBy: 'коучинг від', roleMixed: '⚠ Ти граєш кілька ролей, тож числа усереднені — читай поради під свою основну роль.',
    noRanked: 'ℹ Ранкед-ігор не знайдено — аналізую останні ігри будь-якого режиму.',
    errFormat: 'Введи Riot ID як Нік#ТЕГ (напр. Faker#KR1).', errServer: 'Не вдалося зв’язатися з сервером. Він запущений?',
    errFail: 'Аналіз не вдався.', unranked: 'Без рангу', mostly: 'переважно', csm: 'кс/хв',
    win: 'Перемога', loss: 'Поразка', remake: 'ремейк', onTrack: 'Ти в нормі — продовжуй у тому ж дусі. 👍',
    loading: ['шукаю твій акаунт…', 'читаю останні 20 ігор…', 'рахую твої числа…', 'порівнюю з твоїм рангом…', 'пишу коучинг…'],
    roles: { TOP: 'Топ', JUNGLE: 'Ліс', MIDDLE: 'Мід', BOTTOM: 'АДК', UTILITY: 'Сапорт' },
    liveTitle: 'Live-компаньйон', liveTagline: 'Підказки в грі з офіційного Live Client Data API · <em>лише інформаційно</em>',
    rankTier: 'Твій ранг:', tierLow: 'Залізо–Срібло', tierMid: 'Золото–Платина', tierHigh: 'Смарагд+',
    waiting: 'Очікую гру… запусти League і зайди в матч.', detected: 'Гру виявлено — завантажую дані…',
    noServer: 'Немає зв’язку із сервером коуча. Він запущений?', rightNow: 'Просто зараз',
    statKDA: 'KDA', statCS: 'КС', statVision: 'Віжн', statGold: 'Золото', backLink: '← післяматчевий аналіз',
    liveFooter: 'Безпечно за ToS: лише читання, без автоматизації. Відкривай на 2-му моніторі або у вікні.',
  },
  fr: {
    tagline: 'Analyse tes 20 dernières parties classées et te dit les 3 choses que <em>tu</em> dois corriger.',
    liveLink: '⚡ Compagnon en jeu (bêta)',
    placeholder: 'Nom#TAG  (ex. Faker#KR1)',
    analyze: 'Analyser', wrLabel: 'victoires · sur', fixesTitle: 'Tes 3 points à corriger',
    target: 'cible', lastPre: 'Dernières', lastPost: 'parties',
    footer: 'API Riot officielle · coaching post-partie uniquement · non affilié à Riot Games',
    coachLocal: 'texte généré localement (LLM hors ligne — lance Ollama pour de meilleurs conseils)',
    coachBy: 'coaching par', roleMixed: '⚠ Tu joues plusieurs rôles, les chiffres sont donc mélangés — lis les conseils selon ton rôle principal.',
    noRanked: 'ℹ Aucune partie classée trouvée — analyse de tes parties récentes, tous modes confondus.',
    errFormat: 'Entre ton Riot ID au format Nom#TAG (ex. Faker#KR1).', errServer: 'Impossible de joindre le serveur. Est-il lancé ?',
    errFail: 'Échec de l’analyse.', unranked: 'Non classé', mostly: 'surtout', csm: 'cs/min',
    win: 'Victoire', loss: 'Défaite', remake: 'remake', onTrack: 'Tu es sur la bonne voie — continue comme ça. 👍',
    loading: ['recherche de ton compte…', 'lecture de tes 20 parties…', 'calcul de tes stats…', 'comparaison avec ton rang…', 'rédaction du coaching…'],
    roles: { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' },
    liveTitle: 'Compagnon en direct', liveTagline: 'Conseils en jeu via l’API Live Client Data officielle · <em>à titre informatif</em>',
    rankTier: 'Ton palier :', tierLow: 'Fer–Argent', tierMid: 'Or–Platine', tierHigh: 'Émeraude+',
    waiting: 'En attente d’une partie… lance League et rejoins un match.', detected: 'Partie détectée — chargement des données…',
    noServer: 'Serveur du coach injoignable. Est-il lancé ?', rightNow: 'Maintenant',
    statKDA: 'KDA', statCS: 'CS', statVision: 'Vision', statGold: 'Or', backLink: '← analyse post-partie',
    liveFooter: 'Conforme aux CGU : lecture seule, aucune automatisation. À afficher sur un 2e écran ou en fenêtré.',
  },
  de: {
    tagline: 'Analysiert deine letzten 20 Ranked-Spiele und nennt die 3 Dinge, die <em>du</em> verbessern solltest.',
    liveLink: '⚡ Live-Begleiter im Spiel (Beta)',
    placeholder: 'Name#TAG  (z. B. Faker#KR1)',
    analyze: 'Analysieren', wrLabel: 'Siegrate · letzte', fixesTitle: 'Deine 3 Baustellen',
    target: 'Ziel', lastPre: 'Letzte', lastPost: 'Spiele',
    footer: 'Offizielle Riot-API · nur Nachbesprechung · nicht mit Riot Games verbunden',
    coachLocal: 'Text lokal erzeugt (LLM offline — starte Ollama für bessere Tipps)',
    coachBy: 'Coaching von', roleMixed: '⚠ Du spielst mehrere Rollen, daher sind die Werte gemischt — lies die Tipps für deine Hauptrolle.',
    noRanked: 'ℹ Keine Ranked-Spiele gefunden — analysiere deine letzten Spiele aller Modi.',
    errFormat: 'Gib deine Riot-ID als Name#TAG ein (z. B. Faker#KR1).', errServer: 'Server nicht erreichbar. Läuft er?',
    errFail: 'Analyse fehlgeschlagen.', unranked: 'Unranked', mostly: 'meist', csm: 'CS/min',
    win: 'Sieg', loss: 'Niederlage', remake: 'Remake', onTrack: 'Du bist auf Kurs — mach genau so weiter. 👍',
    loading: ['suche dein Konto…', 'lese deine letzten 20 Spiele…', 'berechne deine Werte…', 'vergleiche mit deinem Rang…', 'schreibe dein Coaching…'],
    roles: { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' },
    liveTitle: 'Live-Begleiter', liveTagline: 'Hinweise im Spiel über die offizielle Live-Client-Data-API · <em>nur zur Info</em>',
    rankTier: 'Dein Rang:', tierLow: 'Eisen–Silber', tierMid: 'Gold–Platin', tierHigh: 'Smaragd+',
    waiting: 'Warte auf ein Spiel… starte League und lade in ein Match.', detected: 'Spiel erkannt — lade Spielerdaten…',
    noServer: 'Coach-Server nicht erreichbar. Läuft er?', rightNow: 'Jetzt gerade',
    statKDA: 'KDA', statCS: 'CS', statVision: 'Sicht', statGold: 'Gold', backLink: '← Nachbesprechung',
    liveFooter: 'ToS-konform: nur Lesen, keine Automatik. Auf 2. Monitor oder im Fenstermodus anzeigen.',
  },
  es: {
    tagline: 'Analiza tus últimas 20 partidas clasificatorias y te dice las 3 cosas que <em>tú</em> debes mejorar.',
    liveLink: '⚡ Compañero en partida (beta)',
    placeholder: 'Nombre#TAG  (ej. Faker#KR1)',
    analyze: 'Analizar', wrLabel: 'victorias · últimas', fixesTitle: 'Tus 3 cosas a mejorar',
    target: 'objetivo', lastPre: 'Últimas', lastPost: 'partidas',
    footer: 'API oficial de Riot · solo análisis post-partida · sin afiliación con Riot Games',
    coachLocal: 'texto generado localmente (LLM sin conexión — inicia Ollama para mejores consejos)',
    coachBy: 'coaching de', roleMixed: '⚠ Juegas varios roles, así que los números están mezclados — lee los consejos según tu rol principal.',
    noRanked: 'ℹ No hay partidas clasificatorias — analizando tus partidas recientes de cualquier cola.',
    errFormat: 'Introduce tu Riot ID como Nombre#TAG (ej. Faker#KR1).', errServer: 'No se pudo conectar con el servidor. ¿Está en marcha?',
    errFail: 'Falló el análisis.', unranked: 'Sin clasificar', mostly: 'sobre todo', csm: 'cs/min',
    win: 'Victoria', loss: 'Derrota', remake: 'remake', onTrack: 'Vas bien — sigue así. 👍',
    loading: ['buscando tu cuenta…', 'leyendo tus últimas 20 partidas…', 'calculando tus números…', 'comparando con tu rango…', 'escribiendo tu coaching…'],
    roles: { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Medio', BOTTOM: 'ADC', UTILITY: 'Support' },
    liveTitle: 'Compañero en directo', liveTagline: 'Consejos en partida vía la API oficial Live Client Data · <em>solo informativo</em>',
    rankTier: 'Tu rango:', tierLow: 'Hierro–Plata', tierMid: 'Oro–Platino', tierHigh: 'Esmeralda+',
    waiting: 'Esperando una partida… abre League y entra a un match.', detected: 'Partida detectada — cargando datos…',
    noServer: 'No se pudo conectar con el servidor del coach. ¿Está en marcha?', rightNow: 'Ahora mismo',
    statKDA: 'KDA', statCS: 'CS', statVision: 'Visión', statGold: 'Oro', backLink: '← análisis post-partida',
    liveFooter: 'Seguro según ToS: solo lectura, sin automatización. Muéstralo en un 2.º monitor o en ventana.',
  },
  pl: {
    tagline: 'Analizuje twoje ostatnie 20 gier rankingowych i wskazuje 3 rzeczy, które <em>ty</em> powinieneś poprawić.',
    liveLink: '⚡ Towarzysz w grze (beta)',
    placeholder: 'Nick#TAG  (np. Faker#KR1)',
    analyze: 'Analizuj', wrLabel: 'winrate · ostatnie', fixesTitle: 'Twoje 3 rzeczy do poprawy',
    target: 'cel', lastPre: 'Ostatnie', lastPost: 'gier',
    footer: 'Oficjalne API Riot · tylko coaching po grze · brak powiązania z Riot Games',
    coachLocal: 'tekst wygenerowany lokalnie (LLM offline — uruchom Ollamę dla lepszych porad)',
    coachBy: 'coaching od', roleMixed: '⚠ Grasz na kilku pozycjach, więc liczby są uśrednione — czytaj porady pod swoją główną rolę.',
    noRanked: 'ℹ Brak gier rankingowych — analizuję ostatnie gry z dowolnej kolejki.',
    errFormat: 'Wpisz Riot ID jako Nick#TAG (np. Faker#KR1).', errServer: 'Nie można połączyć z serwerem. Czy działa?',
    errFail: 'Analiza nie powiodła się.', unranked: 'Bez rangi', mostly: 'głównie', csm: 'cs/min',
    win: 'Wygrana', loss: 'Przegrana', remake: 'remake', onTrack: 'Jesteś na dobrej drodze — tak trzymaj. 👍',
    loading: ['szukam twojego konta…', 'czytam ostatnie 20 gier…', 'liczę twoje statystyki…', 'porównuję z twoją rangą…', 'piszę coaching…'],
    roles: { TOP: 'Top', JUNGLE: 'Las', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Wsparcie' },
    liveTitle: 'Towarzysz na żywo', liveTagline: 'Wskazówki w grze z oficjalnego Live Client Data API · <em>tylko informacyjnie</em>',
    rankTier: 'Twoja ranga:', tierLow: 'Żelazo–Srebro', tierMid: 'Złoto–Platyna', tierHigh: 'Szmaragd+',
    waiting: 'Czekam na grę… uruchom League i wejdź do meczu.', detected: 'Wykryto grę — ładuję dane…',
    noServer: 'Brak połączenia z serwerem coacha. Czy działa?', rightNow: 'Teraz',
    statKDA: 'KDA', statCS: 'CS', statVision: 'Wizja', statGold: 'Złoto', backLink: '← analiza po grze',
    liveFooter: 'Zgodne z ToS: tylko odczyt, bez automatyzacji. Pokaż na 2. monitorze lub w oknie.',
  },
  pt: {
    tagline: 'Analisa suas últimas 20 partidas ranqueadas e diz as 3 coisas que <em>você</em> deve melhorar.',
    liveLink: '⚡ Companheiro em jogo (beta)',
    placeholder: 'Nome#TAG  (ex. Faker#KR1)',
    analyze: 'Analisar', wrLabel: 'vitórias · últimas', fixesTitle: 'Suas 3 coisas para melhorar',
    target: 'alvo', lastPre: 'Últimas', lastPost: 'partidas',
    footer: 'API oficial da Riot · apenas coaching pós-jogo · sem afiliação com a Riot Games',
    coachLocal: 'texto gerado localmente (LLM offline — inicie o Ollama para dicas melhores)',
    coachBy: 'coaching por', roleMixed: '⚠ Você joga várias rotas, então os números estão misturados — leia as dicas pela sua rota principal.',
    noRanked: 'ℹ Nenhuma partida ranqueada encontrada — analisando suas partidas recentes de qualquer fila.',
    errFormat: 'Digite seu Riot ID como Nome#TAG (ex. Faker#KR1).', errServer: 'Não foi possível conectar ao servidor. Ele está rodando?',
    errFail: 'A análise falhou.', unranked: 'Sem elo', mostly: 'na maioria', csm: 'cs/min',
    win: 'Vitória', loss: 'Derrota', remake: 'remake', onTrack: 'Você está no caminho certo — continue assim. 👍',
    loading: ['procurando sua conta…', 'lendo suas últimas 20 partidas…', 'calculando seus números…', 'comparando com seu elo…', 'escrevendo seu coaching…'],
    roles: { TOP: 'Top', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'ADC', UTILITY: 'Suporte' },
    liveTitle: 'Companheiro ao vivo', liveTagline: 'Dicas em jogo via a API oficial Live Client Data · <em>apenas informativo</em>',
    rankTier: 'Seu elo:', tierLow: 'Ferro–Prata', tierMid: 'Ouro–Platina', tierHigh: 'Esmeralda+',
    waiting: 'Aguardando uma partida… abra o League e entre em um jogo.', detected: 'Partida detectada — carregando dados…',
    noServer: 'Sem conexão com o servidor do coach. Ele está rodando?', rightNow: 'Agora',
    statKDA: 'KDA', statCS: 'CS', statVision: 'Visão', statGold: 'Ouro', backLink: '← análise pós-jogo',
    liveFooter: 'Seguro pelos ToS: só leitura, sem automação. Mostre em um 2º monitor ou em janela.',
  },
  ru: {
    tagline: 'Анализирует твои последние 20 ранговых игр и называет 3 вещи, которые <em>тебе</em> стоит исправить.',
    liveLink: '⚡ Живой компаньон в игре (бета)',
    placeholder: 'Ник#ТЕГ  (напр. Faker#KR1)',
    analyze: 'Анализ', wrLabel: 'винрейт · последние', fixesTitle: 'Твои 3 вещи для исправления',
    target: 'цель', lastPre: 'Последние', lastPost: 'игр',
    footer: 'Официальный Riot API · только послематчевый разбор · не связано с Riot Games',
    coachLocal: 'текст сгенерирован локально (LLM выключен — запусти Ollama для лучших советов)',
    coachBy: 'разбор от', roleMixed: '⚠ Ты играешь несколько ролей, поэтому числа усреднены — читай советы под свою основную роль.',
    noRanked: 'ℹ Ранговых игр не найдено — анализирую последние игры любого режима.',
    errFormat: 'Введи Riot ID как Ник#ТЕГ (напр. Faker#KR1).', errServer: 'Не удалось связаться с сервером. Он запущен?',
    errFail: 'Анализ не удался.', unranked: 'Без ранга', mostly: 'в основном', csm: 'кс/мин',
    win: 'Победа', loss: 'Поражение', remake: 'ремейк', onTrack: 'Ты в порядке — продолжай в том же духе. 👍',
    loading: ['ищу твой аккаунт…', 'читаю последние 20 игр…', 'считаю твои числа…', 'сравниваю с твоим рангом…', 'пишу разбор…'],
    roles: { TOP: 'Топ', JUNGLE: 'Лес', MIDDLE: 'Мид', BOTTOM: 'АДК', UTILITY: 'Саппорт' },
    liveTitle: 'Живой компаньон', liveTagline: 'Подсказки в игре из официального Live Client Data API · <em>только для информации</em>',
    rankTier: 'Твой ранг:', tierLow: 'Железо–Серебро', tierMid: 'Золото–Платина', tierHigh: 'Изумруд+',
    waiting: 'Ожидаю игру… запусти League и зайди в матч.', detected: 'Игра найдена — загружаю данные…',
    noServer: 'Нет связи с сервером коуча. Он запущен?', rightNow: 'Прямо сейчас',
    statKDA: 'KDA', statCS: 'КС', statVision: 'Обзор', statGold: 'Золото', backLink: '← послематчевый разбор',
    liveFooter: 'Безопасно по ToS: только чтение, без автоматизации. Открывай на 2-м мониторе или в окне.',
  },
  tr: {
    tagline: 'Son 20 dereceli maçını analiz eder ve <em>senin</em> düzeltmen gereken 3 şeyi söyler.',
    liveLink: '⚡ Oyun içi asistan (beta)',
    placeholder: 'İsim#TAG  (örn. Faker#KR1)',
    analyze: 'Analiz Et', wrLabel: 'galibiyet · son', fixesTitle: 'Düzeltmen gereken 3 şey',
    target: 'hedef', lastPre: 'Son', lastPost: 'maç',
    footer: 'Resmî Riot API · yalnızca maç sonrası koçluk · Riot Games ile bağlantılı değildir',
    coachLocal: 'metin yerel olarak üretildi (LLM çevrimdışı — daha iyi tavsiye için Ollama’yı başlat)',
    coachBy: 'koçluk:', roleMixed: '⚠ Birden fazla rolde oynuyorsun, bu yüzden sayılar karışık — tavsiyeleri ana rolüne göre oku.',
    noRanked: 'ℹ Dereceli maç bulunamadı — herhangi bir moddaki son maçların analiz ediliyor.',
    errFormat: 'Riot ID’ni İsim#TAG olarak gir (örn. Faker#KR1).', errServer: 'Sunucuya ulaşılamadı. Çalışıyor mu?',
    errFail: 'Analiz başarısız.', unranked: 'Derecesiz', mostly: 'çoğunlukla', csm: 'cs/dk',
    win: 'Galibiyet', loss: 'Mağlubiyet', remake: 'remake', onTrack: 'İyi gidiyorsun — böyle devam et. 👍',
    loading: ['hesabın aranıyor…', 'son 20 maçın okunuyor…', 'sayıların hesaplanıyor…', 'rütbenle karşılaştırılıyor…', 'koçluğun yazılıyor…'],
    roles: { TOP: 'Üst', JUNGLE: 'Orman', MIDDLE: 'Orta', BOTTOM: 'ADC', UTILITY: 'Destek' },
    liveTitle: 'Canlı Asistan', liveTagline: 'Resmî Live Client Data API üzerinden oyun içi ipuçları · <em>yalnızca bilgi amaçlı</em>',
    rankTier: 'Rütben:', tierLow: 'Demir–Gümüş', tierMid: 'Altın–Platin', tierHigh: 'Zümrüt+',
    waiting: 'Bir maç bekleniyor… League’i aç ve maça gir.', detected: 'Maç algılandı — veriler yükleniyor…',
    noServer: 'Koç sunucusuna ulaşılamadı. Çalışıyor mu?', rightNow: 'Şu anda',
    statKDA: 'KDA', statCS: 'CS', statVision: 'Görüş', statGold: 'Altın', backLink: '← maç sonrası analiz',
    liveFooter: 'ToS’a uygun: yalnızca okuma, otomasyon yok. 2. ekranda veya pencere modunda göster.',
  },
  ko: {
    tagline: '최근 랭크 20게임을 분석해 <em>당신</em>이 고쳐야 할 3가지를 알려줍니다.',
    liveLink: '⚡ 인게임 컴패니언 (베타)',
    placeholder: '이름#태그  (예: Faker#KR1)',
    analyze: '분석', wrLabel: '승률 · 최근', fixesTitle: '고쳐야 할 3가지',
    target: '목표', lastPre: '최근', lastPost: '게임',
    footer: '공식 Riot API · 경기 후 코칭 전용 · Riot Games와 무관',
    coachLocal: '로컬에서 생성된 텍스트 (LLM 오프라인 — 더 나은 조언을 원하면 Ollama 실행)',
    coachBy: '코칭:', roleMixed: '⚠ 여러 라인을 플레이해서 수치가 섞여 있어요 — 주 라인 기준으로 조언을 읽으세요.',
    noRanked: 'ℹ 랭크 게임이 없어요 — 큐 상관없이 최근 게임을 분석합니다.',
    errFormat: 'Riot ID를 이름#태그 형식으로 입력하세요 (예: Faker#KR1).', errServer: '서버에 연결할 수 없습니다. 실행 중인가요?',
    errFail: '분석 실패.', unranked: '언랭', mostly: '주로', csm: 'CS/분',
    win: '승리', loss: '패배', remake: '리메이크', onTrack: '잘하고 있어요 — 지금처럼 계속하세요. 👍',
    loading: ['계정을 찾는 중…', '최근 20게임 읽는 중…', '수치 계산 중…', '티어와 비교 중…', '코칭 작성 중…'],
    roles: { TOP: '탑', JUNGLE: '정글', MIDDLE: '미드', BOTTOM: '원딜', UTILITY: '서포터' },
    liveTitle: '라이브 컴패니언', liveTagline: '공식 Live Client Data API 기반 인게임 조언 · <em>참고용</em>',
    rankTier: '당신의 티어:', tierLow: '아이언–실버', tierMid: '골드–플래', tierHigh: '에메랄드+',
    waiting: '게임 대기 중… League를 실행하고 경기에 입장하세요.', detected: '게임 감지 — 플레이어 데이터 로딩 중…',
    noServer: '코치 서버에 연결할 수 없습니다. 실행 중인가요?', rightNow: '지금',
    statKDA: 'KDA', statCS: 'CS', statVision: '시야', statGold: '골드', backLink: '← 경기 후 분석',
    liveFooter: 'ToS 준수: 읽기 전용, 자동화 없음. 두 번째 모니터나 창 모드에서 보세요.',
  },
  zh: {
    tagline: '分析你最近 20 场排位赛，告诉你<em>需要</em>改进的 3 件事。',
    liveLink: '⚡ 游戏内助手（测试版）',
    placeholder: '名称#TAG（例如 Faker#KR1）',
    analyze: '分析', wrLabel: '胜率 · 最近', fixesTitle: '你需要改进的 3 点',
    target: '目标', lastPre: '最近', lastPost: '场',
    footer: '官方 Riot API · 仅赛后指导 · 与 Riot Games 无关',
    coachLocal: '文本在本地生成（LLM 离线 — 启动 Ollama 获得更好的建议）',
    coachBy: '指导来自', roleMixed: '⚠ 你打多个位置，所以数据是混合的 — 请按主位置来看建议。',
    noRanked: 'ℹ 未找到排位赛 — 正在分析你最近的任意模式对局。',
    errFormat: '请以 名称#TAG 格式输入 Riot ID（例如 Faker#KR1）。', errServer: '无法连接服务器，它在运行吗？',
    errFail: '分析失败。', unranked: '无段位', mostly: '主要', csm: '补刀/分',
    win: '胜利', loss: '失败', remake: '重开', onTrack: '你状态不错 — 继续保持。👍',
    loading: ['正在查找你的账号…', '正在读取最近 20 场…', '正在计算数据…', '正在与你的段位对比…', '正在撰写指导…'],
    roles: { TOP: '上单', JUNGLE: '打野', MIDDLE: '中单', BOTTOM: 'ADC', UTILITY: '辅助' },
    liveTitle: '实时助手', liveTagline: '基于官方 Live Client Data API 的游戏内提示 · <em>仅供参考</em>',
    rankTier: '你的段位：', tierLow: '黑铁–白银', tierMid: '黄金–铂金', tierHigh: '翡翠+',
    waiting: '等待对局… 启动 League 并进入一场比赛。', detected: '检测到对局 — 正在加载玩家数据…',
    noServer: '无法连接教练服务器，它在运行吗？', rightNow: '此刻',
    statKDA: 'KDA', statCS: '补刀', statVision: '视野', statGold: '金币', backLink: '← 赛后分析',
    liveFooter: '符合服务条款：只读，无自动化。请在第二显示器或窗口模式下显示。',
  },
  ja: {
    tagline: '直近20戦のランクを分析し、<em>あなた</em>が直すべき3つを教えます。',
    liveLink: '⚡ ゲーム内コンパニオン（ベータ）',
    placeholder: '名前#TAG（例: Faker#KR1）',
    analyze: '分析', wrLabel: '勝率 · 直近', fixesTitle: '直すべき3つのこと',
    target: '目標', lastPre: '直近', lastPost: '戦',
    footer: '公式 Riot API · 試合後コーチングのみ · Riot Games とは無関係',
    coachLocal: 'テキストはローカル生成（LLM オフライン — より良い助言には Ollama を起動）',
    coachBy: 'コーチング:', roleMixed: '⚠ 複数ロールをプレイしているため数値は混合です — メインロール基準で助言を読んでください。',
    noRanked: 'ℹ ランク戦が見つかりません — 任意のキューの直近試合を分析します。',
    errFormat: 'Riot ID を 名前#TAG の形式で入力してください（例: Faker#KR1）。', errServer: 'サーバーに接続できません。起動していますか？',
    errFail: '分析に失敗しました。', unranked: 'ランクなし', mostly: '主に', csm: 'CS/分',
    win: '勝利', loss: '敗北', remake: 'リメイク', onTrack: '順調です — その調子で。👍',
    loading: ['アカウントを検索中…', '直近20戦を読込中…', '数値を計算中…', 'ランクと比較中…', 'コーチングを作成中…'],
    roles: { TOP: 'トップ', JUNGLE: 'ジャングル', MIDDLE: 'ミッド', BOTTOM: 'ADC', UTILITY: 'サポート' },
    liveTitle: 'ライブコンパニオン', liveTagline: '公式 Live Client Data API によるゲーム内アドバイス · <em>参考情報のみ</em>',
    rankTier: 'あなたのランク:', tierLow: 'アイアン–シルバー', tierMid: 'ゴールド–プラチナ', tierHigh: 'エメラルド+',
    waiting: '試合を待機中… League を起動して試合に入ってください。', detected: '試合を検出 — プレイヤーデータを読込中…',
    noServer: 'コーチサーバーに接続できません。起動していますか？', rightNow: '今',
    statKDA: 'KDA', statCS: 'CS', statVision: '視界', statGold: 'ゴールド', backLink: '← 試合後の分析',
    liveFooter: 'ToS 準拠: 読み取り専用、自動化なし。第2モニターまたはウィンドウモードで表示。',
  },
  vi: {
    tagline: 'Phân tích 20 trận xếp hạng gần nhất và chỉ ra 3 điều <em>bạn</em> cần sửa.',
    liveLink: '⚡ Trợ thủ trong trận (beta)',
    placeholder: 'Tên#TAG  (vd. Faker#KR1)',
    analyze: 'Phân tích', wrLabel: 'tỉ lệ thắng · gần nhất', fixesTitle: '3 điều bạn cần sửa',
    target: 'mục tiêu', lastPre: '', lastPost: 'trận gần nhất',
    footer: 'API Riot chính thức · chỉ huấn luyện sau trận · không liên kết với Riot Games',
    coachLocal: 'văn bản tạo cục bộ (LLM ngoại tuyến — chạy Ollama để có lời khuyên tốt hơn)',
    coachBy: 'huấn luyện bởi', roleMixed: '⚠ Bạn chơi nhiều vị trí nên số liệu bị trộn — hãy đọc lời khuyên theo vị trí chính.',
    noRanked: 'ℹ Không có trận xếp hạng — đang phân tích các trận gần đây ở mọi chế độ.',
    errFormat: 'Nhập Riot ID dạng Tên#TAG (vd. Faker#KR1).', errServer: 'Không thể kết nối máy chủ. Nó có đang chạy không?',
    errFail: 'Phân tích thất bại.', unranked: 'Chưa xếp hạng', mostly: 'chủ yếu', csm: 'lính/phút',
    win: 'Thắng', loss: 'Thua', remake: 'chơi lại', onTrack: 'Bạn đang đi đúng hướng — cứ tiếp tục nhé. 👍',
    loading: ['đang tìm tài khoản…', 'đang đọc 20 trận gần nhất…', 'đang tính số liệu…', 'đang so với bậc rank…', 'đang viết lời khuyên…'],
    roles: { TOP: 'Đường trên', JUNGLE: 'Đi rừng', MIDDLE: 'Đường giữa', BOTTOM: 'Xạ thủ', UTILITY: 'Hỗ trợ' },
    liveTitle: 'Trợ thủ trực tiếp', liveTagline: 'Gợi ý trong trận qua Live Client Data API chính thức · <em>chỉ để tham khảo</em>',
    rankTier: 'Bậc rank của bạn:', tierLow: 'Sắt–Bạc', tierMid: 'Vàng–Bạch Kim', tierHigh: 'Lục Bảo+',
    waiting: 'Đang chờ một trận… mở League và vào trận đấu.', detected: 'Đã phát hiện trận — đang tải dữ liệu…',
    noServer: 'Không thể kết nối máy chủ coach. Nó có đang chạy không?', rightNow: 'Ngay bây giờ',
    statKDA: 'KDA', statCS: 'CS', statVision: 'Tầm nhìn', statGold: 'Vàng', backLink: '← phân tích sau trận',
    liveFooter: 'An toàn theo ToS: chỉ đọc, không tự động hóa. Hiển thị trên màn hình thứ 2 hoặc chế độ cửa sổ.',
  },
};

// Extra keys (nav, news, saved accounts) merged into every language below.
const EXTRA = {
  en: { navHome: 'Home', navBot: 'Live Bot', newsTitle: 'League news', patch: 'Patch', freeRotation: 'Free rotation', saveTip: 'Save this account', savedTitle: 'Saved', more: 'More' },
  uk: { navHome: 'Головна', navBot: 'Бот у грі', newsTitle: 'Новини League', patch: 'Патч', freeRotation: 'Безкоштовна ротація', saveTip: 'Зберегти акаунт', savedTitle: 'Збережені', more: 'Більше' },
  fr: { navHome: 'Accueil', navBot: 'Bot live', newsTitle: 'Actus League', patch: 'Patch', freeRotation: 'Rotation gratuite', saveTip: 'Enregistrer ce compte', savedTitle: 'Enregistrés', more: 'Plus' },
  de: { navHome: 'Start', navBot: 'Live-Bot', newsTitle: 'League-News', patch: 'Patch', freeRotation: 'Gratis-Rotation', saveTip: 'Konto speichern', savedTitle: 'Gespeichert', more: 'Mehr' },
  es: { navHome: 'Inicio', navBot: 'Bot en vivo', newsTitle: 'Noticias de League', patch: 'Parche', freeRotation: 'Rotación gratis', saveTip: 'Guardar esta cuenta', savedTitle: 'Guardados', more: 'Más' },
  pl: { navHome: 'Główna', navBot: 'Bot na żywo', newsTitle: 'Wiadomości League', patch: 'Patch', freeRotation: 'Darmowa rotacja', saveTip: 'Zapisz konto', savedTitle: 'Zapisane', more: 'Więcej' },
  pt: { navHome: 'Início', navBot: 'Bot ao vivo', newsTitle: 'Notícias de League', patch: 'Patch', freeRotation: 'Rotação grátis', saveTip: 'Salvar esta conta', savedTitle: 'Salvos', more: 'Mais' },
  ru: { navHome: 'Главная', navBot: 'Бот в игре', newsTitle: 'Новости League', patch: 'Патч', freeRotation: 'Бесплатная ротация', saveTip: 'Сохранить аккаунт', savedTitle: 'Сохранённые', more: 'Больше' },
  tr: { navHome: 'Ana Sayfa', navBot: 'Canlı Bot', newsTitle: 'League haberleri', patch: 'Yama', freeRotation: 'Ücretsiz rotasyon', saveTip: 'Bu hesabı kaydet', savedTitle: 'Kayıtlı', more: 'Daha' },
  ko: { navHome: '홈', navBot: '라이브 봇', newsTitle: 'League 소식', patch: '패치', freeRotation: '무료 로테이션', saveTip: '이 계정 저장', savedTitle: '저장됨', more: '더보기' },
  zh: { navHome: '主页', navBot: '实时助手', newsTitle: 'League 资讯', patch: '版本', freeRotation: '免费轮换', saveTip: '保存此账号', savedTitle: '已保存', more: '更多' },
  ja: { navHome: 'ホーム', navBot: 'ライブボット', newsTitle: 'League ニュース', patch: 'パッチ', freeRotation: '無料ローテ', saveTip: 'このアカウントを保存', savedTitle: '保存済み', more: 'もっと見る' },
  vi: { navHome: 'Trang chủ', navBot: 'Bot trực tiếp', newsTitle: 'Tin tức League', patch: 'Bản vá', freeRotation: 'Tướng miễn phí', saveTip: 'Lưu tài khoản này', savedTitle: 'Đã lưu', more: 'Thêm' },
};
for (const l in EXTRA) Object.assign(LANGS[l], EXTRA[l]);

// AI live-recommendation strings.
const AI_STR = {
  en: { aiTitle: 'AI recommendation', aiWait: 'reading the game…' },
  uk: { aiTitle: 'AI-рекомендація', aiWait: 'читаю гру…' },
  fr: { aiTitle: 'Recommandation IA', aiWait: 'analyse de la partie…' },
  de: { aiTitle: 'KI-Empfehlung', aiWait: 'lese das Spiel…' },
  es: { aiTitle: 'Recomendación IA', aiWait: 'leyendo la partida…' },
  pl: { aiTitle: 'Rekomendacja AI', aiWait: 'czytam grę…' },
  pt: { aiTitle: 'Recomendação da IA', aiWait: 'lendo a partida…' },
  ru: { aiTitle: 'AI-рекомендация', aiWait: 'читаю игру…' },
  tr: { aiTitle: 'AI önerisi', aiWait: 'oyun okunuyor…' },
  ko: { aiTitle: 'AI 추천', aiWait: '게임 분석 중…' },
  zh: { aiTitle: 'AI 建议', aiWait: '正在读取对局…' },
  ja: { aiTitle: 'AI おすすめ', aiWait: '試合を分析中…' },
  vi: { aiTitle: 'Gợi ý AI', aiWait: 'đang đọc trận đấu…' },
};
for (const l in AI_STR) Object.assign(LANGS[l], AI_STR[l]);

// Weakness metric labels (the backend sends English; we relabel on the client).
const METRIC_LABELS = {
  en: { csPerMin: 'CS per min', visPerMin: 'Vision / min', kp: 'Kill participation', deaths: 'Deaths per game', goldPerMin: 'Gold / min', dmgPerMin: 'Damage / min' },
  uk: { csPerMin: 'КС за хв', visPerMin: 'Огляд за хв', kp: 'Участь у вбивствах', deaths: 'Смертей за гру', goldPerMin: 'Золото за хв', dmgPerMin: 'Шкода за хв' },
  fr: { csPerMin: 'CS par min', visPerMin: 'Vision par min', kp: 'Participation aux kills', deaths: 'Morts par partie', goldPerMin: 'Or par min', dmgPerMin: 'Dégâts par min' },
  de: { csPerMin: 'CS pro Min', visPerMin: 'Sicht pro Min', kp: 'Kill-Beteiligung', deaths: 'Tode pro Spiel', goldPerMin: 'Gold pro Min', dmgPerMin: 'Schaden pro Min' },
  es: { csPerMin: 'CS por min', visPerMin: 'Visión por min', kp: 'Participación en asesinatos', deaths: 'Muertes por partida', goldPerMin: 'Oro por min', dmgPerMin: 'Daño por min' },
  pl: { csPerMin: 'CS na min', visPerMin: 'Wizja na min', kp: 'Udział w zabójstwach', deaths: 'Śmierci na grę', goldPerMin: 'Złoto na min', dmgPerMin: 'Obrażenia na min' },
  pt: { csPerMin: 'CS por min', visPerMin: 'Visão por min', kp: 'Participação em abates', deaths: 'Mortes por partida', goldPerMin: 'Ouro por min', dmgPerMin: 'Dano por min' },
  ru: { csPerMin: 'КС в мин', visPerMin: 'Обзор в мин', kp: 'Участие в убийствах', deaths: 'Смертей за игру', goldPerMin: 'Золото в мин', dmgPerMin: 'Урон в мин' },
  tr: { csPerMin: 'Dakika başı CS', visPerMin: 'Dakika başı görüş', kp: 'Kill katılımı', deaths: 'Maç başı ölüm', goldPerMin: 'Dakika başı altın', dmgPerMin: 'Dakika başı hasar' },
  ko: { csPerMin: '분당 CS', visPerMin: '분당 시야', kp: '킬 관여', deaths: '게임당 데스', goldPerMin: '분당 골드', dmgPerMin: '분당 피해량' },
  zh: { csPerMin: '每分钟补刀', visPerMin: '每分钟视野', kp: '参团率', deaths: '场均死亡', goldPerMin: '每分钟金币', dmgPerMin: '每分钟伤害' },
  ja: { csPerMin: '分間CS', visPerMin: '分間視界', kp: 'キル関与', deaths: '試合平均デス', goldPerMin: '分間ゴールド', dmgPerMin: '分間ダメージ' },
  vi: { csPerMin: 'CS mỗi phút', visPerMin: 'Tầm nhìn mỗi phút', kp: 'Tham gia hạ gục', deaths: 'Số lần chết mỗi trận', goldPerMin: 'Vàng mỗi phút', dmgPerMin: 'Sát thương mỗi phút' },
};

// ── runtime ───────────────────────────────────────────────────────────
let _lang = localStorage.getItem('lolcoach_lang');
if (!_lang || !LANGS[_lang]) {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  _lang = LANGS[nav] ? nav : 'en';
}

function getLang() { return _lang; }
function setLang(l) { if (LANGS[l]) { _lang = l; localStorage.setItem('lolcoach_lang', l); } }
function llmLang() { return LANG_LLM[_lang] || 'English'; }

function t(key) {
  const L = LANGS[_lang] || LANGS.en;
  return key in L ? L[key] : (key in LANGS.en ? LANGS.en[key] : key);
}
function tRole(r) {
  const L = LANGS[_lang] || LANGS.en;
  return (L.roles && L.roles[r]) || LANGS.en.roles[r] || r;
}
function tMetric(key) {
  const L = METRIC_LABELS[_lang] || METRIC_LABELS.en;
  return L[key] || METRIC_LABELS.en[key] || key;
}

// Fill every element carrying data-i18n / data-i18n-ph with the current language.
function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t(el.getAttribute('data-i18n'));
    if (el.hasAttribute('data-i18n-html')) el.innerHTML = v;
    else el.textContent = v;
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-ph'));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.documentElement.lang = _lang;
}

// Build the shared language dropdown; fires 'langchange' when the user switches.
function buildLangSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = Object.entries(LANG_NAMES).map(([k, name]) => `<option value="${k}">${name}</option>`).join('');
  sel.value = _lang;
  sel.addEventListener('change', () => {
    setLang(sel.value);
    applyStatic();
    document.dispatchEvent(new Event('langchange'));
  });
}
