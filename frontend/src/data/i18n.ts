// Regional language support. `ui: true` = interface translated; every language can be chosen as
// the agent's answer language. Missing keys fall back to English.

export interface Lang { code: string; name: string; english: string; region: string; ui: boolean; rtl?: boolean; }

export const LANGS: Lang[] = [
  { code: 'en', name: 'English', english: 'English', region: 'Global', ui: true },
  { code: 'de', name: 'Deutsch', english: 'German', region: 'Europe', ui: true },
  { code: 'es', name: 'Español', english: 'Spanish', region: 'Americas · Europe', ui: true },
  { code: 'fr', name: 'Français', english: 'French', region: 'Europe · Africa', ui: true },
  { code: 'pt', name: 'Português', english: 'Portuguese', region: 'Americas · Africa', ui: true },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', region: 'South Asia', ui: true },
  { code: 'sw', name: 'Kiswahili', english: 'Swahili', region: 'East Africa', ui: true },
  { code: 'ar', name: 'العربية', english: 'Arabic', region: 'Middle East · North Africa', ui: true, rtl: true },
  { code: 'gu', name: 'ગુજરાતી', english: 'Gujarati', region: 'South Asia', ui: false },
  { code: 'mr', name: 'मराठी', english: 'Marathi', region: 'South Asia', ui: false },
  { code: 'bn', name: 'বাংলা', english: 'Bengali', region: 'South Asia', ui: false },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil', region: 'South Asia', ui: false },
  { code: 'te', name: 'తెలుగు', english: 'Telugu', region: 'South Asia', ui: false },
  { code: 'pa', name: 'ਪੰਜਾਬੀ', english: 'Punjabi', region: 'South Asia', ui: false },
  { code: 'ur', name: 'اردو', english: 'Urdu', region: 'South Asia', ui: false, rtl: true },
  { code: 'ha', name: 'Hausa', english: 'Hausa', region: 'West Africa', ui: false },
  { code: 'yo', name: 'Yorùbá', english: 'Yoruba', region: 'West Africa', ui: false },
  { code: 'am', name: 'አማርኛ', english: 'Amharic', region: 'East Africa', ui: false },
  { code: 'tr', name: 'Türkçe', english: 'Turkish', region: 'Europe · Asia', ui: false },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', region: 'Southeast Asia', ui: false },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese', region: 'Southeast Asia', ui: false },
  { code: 'th', name: 'ไทย', english: 'Thai', region: 'Southeast Asia', ui: false },
  { code: 'fil', name: 'Filipino', english: 'Filipino', region: 'Southeast Asia', ui: false },
  { code: 'zh', name: '中文', english: 'Chinese', region: 'East Asia', ui: false },
  { code: 'ja', name: '日本語', english: 'Japanese', region: 'East Asia', ui: false },
];

type Dict = Record<string, string>;

const en: Dict = {
  'nav.ask': 'Ask', 'nav.places': 'Places', 'nav.library': 'Library',
  'hero.eyebrow': 'Connecting satellites to you', 'hero.title': 'Ask the planet a question.',
  'hero.sub': 'Ask about any place on Earth in plain language. The agent reads free satellite data and answers with evidence: before-and-after images, a timeline and the numbers behind it.',
  'chat.placeholder': 'Ask about any place on Earth…', 'chat.try': 'Try asking', 'chat.place': 'Place', 'chat.noPlace': 'No place · general question', 'cta.addPlace': 'Add place',
  'places.title': 'Places', 'places.sub': 'Fields, plots, sites and water bodies you have saved. Pick one to ask about it.',
  'watches.title': 'Triggers', 'watches.sub': 'Questions saved to re-check a place. Automatic re-checks are not running yet, so ask again any time to update one.',
  'library.title': 'Skills library', 'library.sub': 'Reproducible recipes that turn a question into satellite steps. Ready skills run today; concepts show what is planned.',
  'nav.triggers': 'Triggers',
  'nav.account': 'Account', 'nav.language': 'Language', 'nav.main': 'Main',
};

const de: Dict = {
  'nav.ask': 'Fragen', 'nav.places': 'Orte', 'nav.library': 'Bibliothek',
  'hero.eyebrow': 'Satelliten, verbunden mit dir', 'hero.title': 'Stell dem Planeten eine Frage.',
  'hero.sub': 'Frag in einfacher Sprache nach jedem Ort der Erde. Der Agent liest freie Satellitendaten und antwortet mit Belegen: Vorher-nachher-Bilder, eine Zeitleiste und die Zahlen dahinter.',
  'chat.placeholder': 'Frag nach einem Ort auf der Erde…', 'chat.try': 'Probier zum Beispiel', 'chat.place': 'Ort', 'chat.noPlace': 'Kein Ort · allgemeine Frage', 'cta.addPlace': 'Ort hinzufügen',
  'places.title': 'Orte', 'places.sub': 'Gespeicherte Felder, Parzellen, Standorte und Gewässer. Wähle einen aus, um danach zu fragen.',
  'watches.title': 'Auslöser', 'watches.sub': 'Bedingungen, die der Agent bei jedem neuen Satellitenüberflug prüft – du erfährst, sobald eine eintritt.',
  'library.title': 'Skill-Bibliothek', 'library.sub': 'Reproduzierbare Rezepte, die eine Frage in Satellitenschritte übersetzen. Offizielle Skills sind von Constellation gebaut und validiert.',
  'nav.triggers': 'Auslöser',
  'nav.account': 'Konto', 'nav.language': 'Sprache', 'nav.main': 'Hauptmenü',
};

const es: Dict = {
  'nav.ask': 'Preguntar', 'nav.places': 'Lugares', 'nav.library': 'Biblioteca',
  'hero.eyebrow': 'Conectando los satélites contigo', 'hero.title': 'Hazle una pregunta al planeta.',
  'hero.sub': 'Pregunta en lenguaje sencillo por cualquier lugar de la Tierra. El agente lee datos satelitales gratuitos y responde con pruebas: imágenes de antes y después, una línea de tiempo y las cifras.',
  'chat.placeholder': 'Pregunta por cualquier lugar de la Tierra…', 'chat.try': 'Prueba a preguntar', 'chat.place': 'Lugar', 'chat.noPlace': 'Sin lugar · pregunta general', 'cta.addPlace': 'Añadir lugar',
  'places.title': 'Lugares', 'places.sub': 'Campos, parcelas, sitios y cuerpos de agua guardados. Elige uno para preguntar.',
  'watches.title': 'Disparadores', 'watches.sub': 'Condiciones que el agente comprueba en cada nuevo paso de satélite, y te avisa cuando se cumplen.',
  'library.title': 'Biblioteca de skills', 'library.sub': 'Recetas reproducibles que convierten una pregunta en pasos satelitales. Las oficiales las crea y valida Constellation.',
  'nav.triggers': 'Disparadores',
  'nav.account': 'Cuenta', 'nav.language': 'Idioma', 'nav.main': 'Principal',
};

const fr: Dict = {
  'nav.ask': 'Demander', 'nav.places': 'Lieux', 'nav.library': 'Bibliothèque',
  'hero.eyebrow': 'Les satellites, connectés à vous', 'hero.title': 'Posez une question à la planète.',
  'hero.sub': 'Interrogez n\'importe quel lieu sur Terre en langage courant. L\'agent lit des données satellites gratuites et répond avec des preuves : images avant/après, chronologie et chiffres.',
  'chat.placeholder': "Posez une question sur n'importe quel lieu…", 'chat.try': 'Essayez', 'chat.place': 'Lieu', 'chat.noPlace': 'Aucun lieu · question générale', 'cta.addPlace': 'Ajouter un lieu',
  'places.title': 'Lieux', 'places.sub': "Champs, parcelles, sites et plans d'eau enregistrés. Choisissez-en un pour poser une question.",
  'watches.title': 'Déclencheurs', 'watches.sub': 'Conditions que l\'agent vérifie à chaque nouveau passage satellite, et vous prévient quand l\'une est remplie.',
  'library.title': 'Bibliothèque de skills', 'library.sub': 'Recettes reproductibles qui transforment une question en étapes satellites. Les skills officiels sont validés par Constellation.',
  'nav.triggers': 'Déclencheurs',
  'nav.account': 'Compte', 'nav.language': 'Langue', 'nav.main': 'Principal',
};

const pt: Dict = {
  'nav.ask': 'Perguntar', 'nav.places': 'Lugares', 'nav.library': 'Biblioteca',
  'hero.eyebrow': 'Conectando satélites a você', 'hero.title': 'Faça uma pergunta ao planeta.',
  'hero.sub': 'Pergunte em linguagem simples sobre qualquer lugar da Terra. O agente lê dados de satélite gratuitos e responde com provas: imagens de antes e depois, uma linha do tempo e os números.',
  'chat.placeholder': 'Pergunte sobre qualquer lugar da Terra…', 'chat.try': 'Experimente perguntar', 'chat.place': 'Lugar', 'chat.noPlace': 'Sem lugar · pergunta geral', 'cta.addPlace': 'Adicionar lugar',
  'places.title': 'Lugares', 'places.sub': 'Campos, lotes, locais e corpos d’água salvos. Escolha um para perguntar.',
  'watches.title': 'Gatilhos', 'watches.sub': 'Condições que o agente verifica a cada nova passagem de satélite, avisando quando uma é atendida.',
  'library.title': 'Biblioteca de skills', 'library.sub': 'Receitas reproduzíveis que transformam uma pergunta em etapas de satélite. Skills oficiais são validados pela Constellation.',
  'nav.triggers': 'Gatilhos',
  'nav.account': 'Conta', 'nav.language': 'Idioma', 'nav.main': 'Principal',
};

const hi: Dict = {
  'nav.ask': 'पूछें', 'nav.places': 'स्थान', 'nav.library': 'लाइब्रेरी',
  'hero.eyebrow': 'उपग्रहों को आपसे जोड़ते हुए', 'hero.title': 'धरती से एक सवाल पूछिए।',
  'hero.sub': 'पृथ्वी पर किसी भी जगह के बारे में सरल भाषा में पूछें। एजेंट मुफ़्त उपग्रह डेटा पढ़ता है और सबूत के साथ जवाब देता है: पहले-बाद की तस्वीरें, समयरेखा और आँकड़े।',
  'chat.placeholder': 'पृथ्वी पर किसी भी जगह के बारे में पूछें…', 'chat.try': 'यह पूछकर देखें', 'chat.place': 'स्थान', 'chat.noPlace': 'कोई स्थान नहीं · सामान्य सवाल', 'cta.addPlace': 'स्थान जोड़ें',
  'places.title': 'स्थान', 'places.sub': 'आपके सहेजे गए खेत, प्लॉट और जल स्रोत। पूछने के लिए एक चुनें।',
  'watches.title': 'ट्रिगर', 'watches.sub': 'शर्तें जिन्हें एजेंट हर नए उपग्रह पास पर जाँचता है, और पूरी होने पर आपको बताता है।',
  'library.title': 'स्किल लाइब्रेरी', 'library.sub': 'दोहराए जा सकने वाले तरीके जो सवाल को उपग्रह चरणों में बदलते हैं।',
  'nav.triggers': 'ट्रिगर',
  'nav.account': 'खाता', 'nav.language': 'भाषा', 'nav.main': 'मुख्य',
};

const sw: Dict = {
  'nav.ask': 'Uliza', 'nav.places': 'Maeneo', 'nav.library': 'Maktaba',
  'hero.eyebrow': 'Kuunganisha satelaiti nawe', 'hero.title': 'Uliza sayari swali.',
  'hero.sub': 'Uliza kuhusu mahali popote Duniani kwa lugha rahisi. Wakala husoma data ya bure ya satelaiti na kujibu kwa ushahidi: picha za kabla na baada, mfuatano wa wakati na takwimu.',
  'chat.placeholder': 'Uliza kuhusu mahali popote Duniani…', 'chat.try': 'Jaribu kuuliza', 'chat.place': 'Mahali', 'chat.noPlace': 'Hakuna mahali · swali la jumla', 'cta.addPlace': 'Ongeza mahali',
  'places.title': 'Maeneo', 'places.sub': 'Mashamba, viwanja na maji uliyohifadhi. Chagua moja kuuliza.',
  'watches.title': 'Vichochezi', 'watches.sub': 'Masharti ambayo wakala hukagua kila satelaiti inapopita, na kukujulisha yanapotimia.',
  'library.title': 'Maktaba ya ujuzi', 'library.sub': 'Mapishi yanayorudiwa yanayogeuza swali kuwa hatua za satelaiti.',
  'nav.triggers': 'Vichochezi',
  'nav.account': 'Akaunti', 'nav.language': 'Lugha', 'nav.main': 'Kuu',
};

const ar: Dict = {
  'nav.ask': 'اسأل', 'nav.places': 'الأماكن', 'nav.library': 'المكتبة',
  'hero.eyebrow': 'نصل الأقمار الصناعية بك', 'hero.title': 'اسأل الكوكب سؤالاً.',
  'hero.sub': 'اسأل عن أي مكان على الأرض بلغة بسيطة. يقرأ الوكيل بيانات الأقمار الصناعية المجانية ويجيب بأدلة: صور قبل وبعد، وخط زمني، والأرقام.',
  'chat.placeholder': 'اسأل عن أي مكان على الأرض…', 'chat.try': 'جرّب أن تسأل', 'chat.place': 'المكان', 'chat.noPlace': 'بدون مكان · سؤال عام', 'cta.addPlace': 'أضف مكاناً',
  'places.title': 'الأماكن', 'places.sub': 'الحقول والقطع والمواقع والمسطحات المائية المحفوظة.',
  'watches.title': 'المشغّلات', 'watches.sub': 'شروط يتحقق منها الوكيل مع كل مرور جديد للقمر الصناعي، ويخبرك عند تحققها.',
  'library.title': 'مكتبة المهارات', 'library.sub': 'وصفات قابلة لإعادة الإنتاج تحول السؤال إلى خطوات بالأقمار الصناعية.',
  'nav.triggers': 'المشغّلات',
  'nav.account': 'الحساب', 'nav.language': 'اللغة', 'nav.main': 'الرئيسية',
};

const DICTS: Record<string, Dict> = { en, de, es, fr, pt, hi, sw, ar };

export const translate = (code: string, key: string) => DICTS[code]?.[key] ?? en[key] ?? key;
