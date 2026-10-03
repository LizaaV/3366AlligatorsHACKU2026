// Regional language support. `ui: true` = interface translated; every language gets agent answers,
// WhatsApp replies and PDF exports in that language. Missing keys fall back to English.

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
  'nav.ask': 'Ask', 'nav.places': 'Places', 'nav.watches': 'Watches', 'nav.library': 'Library',
  'hero.eyebrow': 'Earth observation agent', 'hero.title': 'Ask the planet a question.',
  'hero.sub': 'Ask about any field, coast or city. The agent picks the satellites, cleans the images and returns an answer with proof you can keep watching.',
  'chat.placeholder': 'Ask about any place on Earth…', 'chat.try': 'Try asking', 'chat.place': 'Place', 'chat.noPlace': 'No place · general question',
  'cta.saveWatch': 'Keep watching', 'cta.export': 'Export', 'cta.expert': 'Ask an expert', 'cta.addPlace': 'Add place', 'cta.newWatch': 'New watch', 'cta.newSkill': 'Build a skill',
  'cta.askHere': 'Ask about this place', 'cta.explore': 'Library',
  'tier.free': 'Free', 'tier.paid': 'Paid',
  'places.title': 'Places', 'places.sub': 'Fields, plots, sites and water bodies you have saved. Pick one to ask about it.',
  'watches.title': 'Triggers', 'watches.sub': 'Things the agent looks out for on every new satellite pass, and tells you when they happen.',
  'library.title': 'Skills library', 'library.sub': 'Reproducible recipes that turn a question into satellite steps. Official skills are built and validated by Groundtruth.',
  'common.all': 'All',
  'nav.triggers': 'Triggers',
};

const de: Dict = {
  'nav.ask': 'Fragen', 'nav.places': 'Orte', 'nav.watches': 'Wachen', 'nav.library': 'Bibliothek',
  'hero.eyebrow': 'Erdbeobachtungs-Agent', 'hero.title': 'Stell dem Planeten eine Frage.',
  'hero.sub': 'Frag nach jedem Feld, jeder Küste oder Stadt. Der Agent wählt die Satelliten, bereinigt die Bilder und liefert eine Antwort mit Nachweis, die du weiter beobachten kannst.',
  'chat.placeholder': 'Frag nach einem Ort auf der Erde…', 'chat.try': 'Probier zum Beispiel', 'chat.place': 'Ort', 'chat.noPlace': 'Kein Ort · allgemeine Frage',
  'cta.saveWatch': 'Weiter beobachten', 'cta.export': 'Exportieren', 'cta.expert': 'Experten fragen', 'cta.addPlace': 'Ort hinzufügen', 'cta.newWatch': 'Neue Wache', 'cta.newSkill': 'Skill bauen',
  'cta.askHere': 'Zu diesem Ort fragen', 'cta.explore': 'Bibliothek', 'tier.free': 'Gratis', 'tier.paid': 'Kostenpflichtig',
  'places.title': 'Orte', 'places.sub': 'Gespeicherte Felder, Parzellen, Standorte und Gewässer. Wähle einen aus, um danach zu fragen.',
  'watches.title': 'Wachen', 'watches.sub': 'Fragen, die der Agent bei jedem neuen Satellitenüberflug erneut stellt – nach Thema sortiert.',
  'library.title': 'Skill-Bibliothek', 'library.sub': 'Reproduzierbare Rezepte, die eine Frage in Satellitenschritte übersetzen. Offizielle Skills sind von Groundtruth gebaut und validiert.',
  'common.all': 'Alle',
  'nav.triggers': 'Auslöser',
};

const es: Dict = {
  'nav.ask': 'Preguntar', 'nav.places': 'Lugares', 'nav.watches': 'Vigilancias', 'nav.library': 'Biblioteca',
  'hero.eyebrow': 'Agente de observación terrestre', 'hero.title': 'Hazle una pregunta al planeta.',
  'hero.sub': 'Pregunta por cualquier campo, costa o ciudad. El agente elige los satélites, limpia las imágenes y responde con pruebas que puedes seguir vigilando.',
  'chat.placeholder': 'Pregunta por cualquier lugar de la Tierra…', 'chat.try': 'Prueba a preguntar', 'chat.place': 'Lugar', 'chat.noPlace': 'Sin lugar · pregunta general',
  'cta.saveWatch': 'Seguir vigilando', 'cta.export': 'Exportar', 'cta.expert': 'Consultar a un experto', 'cta.addPlace': 'Añadir lugar', 'cta.newWatch': 'Nueva vigilancia', 'cta.newSkill': 'Crear skill',
  'cta.askHere': 'Preguntar por este lugar', 'cta.explore': 'Biblioteca', 'tier.free': 'Gratis', 'tier.paid': 'De pago',
  'places.title': 'Lugares', 'places.sub': 'Campos, parcelas, sitios y cuerpos de agua guardados. Elige uno para preguntar.',
  'watches.title': 'Vigilancias', 'watches.sub': 'Preguntas que el agente repite en cada nuevo paso de satélite, ordenadas por tema.',
  'library.title': 'Biblioteca de skills', 'library.sub': 'Recetas reproducibles que convierten una pregunta en pasos satelitales. Las oficiales las crea y valida Groundtruth.',
  'common.all': 'Todo',
  'nav.triggers': 'Disparadores',
};

const fr: Dict = {
  'nav.ask': 'Demander', 'nav.places': 'Lieux', 'nav.watches': 'Veilles', 'nav.library': 'Bibliothèque',
  'hero.eyebrow': "Agent d'observation de la Terre", 'hero.title': 'Posez une question à la planète.',
  'hero.sub': "Interrogez n'importe quel champ, côte ou ville. L'agent choisit les satellites, nettoie les images et répond avec des preuves que vous pouvez continuer à suivre.",
  'chat.placeholder': "Posez une question sur n'importe quel lieu…", 'chat.try': 'Essayez', 'chat.place': 'Lieu', 'chat.noPlace': 'Aucun lieu · question générale',
  'cta.saveWatch': 'Continuer à surveiller', 'cta.export': 'Exporter', 'cta.expert': 'Demander à un expert', 'cta.addPlace': 'Ajouter un lieu', 'cta.newWatch': 'Nouvelle veille', 'cta.newSkill': 'Créer un skill',
  'cta.askHere': 'Questionner ce lieu', 'cta.explore': 'Bibliothèque', 'tier.free': 'Gratuit', 'tier.paid': 'Payant',
  'places.title': 'Lieux', 'places.sub': "Champs, parcelles, sites et plans d'eau enregistrés. Choisissez-en un pour poser une question.",
  'watches.title': 'Veilles', 'watches.sub': "Questions que l'agent repose à chaque nouveau passage satellite, classées par thème.",
  'library.title': 'Bibliothèque de skills', 'library.sub': 'Recettes reproductibles qui transforment une question en étapes satellites. Les skills officiels sont validés par Groundtruth.',
  'common.all': 'Tous',
  'nav.triggers': 'Déclencheurs',
};

const pt: Dict = {
  'nav.ask': 'Perguntar', 'nav.places': 'Lugares', 'nav.watches': 'Vigias', 'nav.library': 'Biblioteca',
  'hero.eyebrow': 'Agente de observação da Terra', 'hero.title': 'Faça uma pergunta ao planeta.',
  'hero.sub': 'Pergunte sobre qualquer campo, costa ou cidade. O agente escolhe os satélites, limpa as imagens e responde com provas que você pode continuar a vigiar.',
  'chat.placeholder': 'Pergunte sobre qualquer lugar da Terra…', 'chat.try': 'Experimente perguntar', 'chat.place': 'Lugar', 'chat.noPlace': 'Sem lugar · pergunta geral',
  'cta.saveWatch': 'Continuar vigiando', 'cta.export': 'Exportar', 'cta.expert': 'Perguntar a um especialista', 'cta.addPlace': 'Adicionar lugar', 'cta.newWatch': 'Nova vigia', 'cta.newSkill': 'Criar skill',
  'cta.askHere': 'Perguntar sobre este lugar', 'cta.explore': 'Biblioteca', 'tier.free': 'Grátis', 'tier.paid': 'Pago',
  'places.title': 'Lugares', 'places.sub': 'Campos, lotes, locais e corpos d’água salvos. Escolha um para perguntar.',
  'watches.title': 'Vigias', 'watches.sub': 'Perguntas que o agente refaz a cada nova passagem de satélite, organizadas por tema.',
  'library.title': 'Biblioteca de skills', 'library.sub': 'Receitas reproduzíveis que transformam uma pergunta em etapas de satélite. Skills oficiais são validados pela Groundtruth.',
  'common.all': 'Todos',
  'nav.triggers': 'Gatilhos',
};

const hi: Dict = {
  'nav.ask': 'पूछें', 'nav.places': 'स्थान', 'nav.watches': 'निगरानी', 'nav.library': 'लाइब्रेरी',
  'hero.eyebrow': 'पृथ्वी अवलोकन एजेंट', 'hero.title': 'धरती से एक सवाल पूछिए।',
  'hero.sub': 'किसी भी खेत, तट या शहर के बारे में पूछें। एजेंट उपग्रह चुनता है, तस्वीरें साफ़ करता है और सबूत के साथ जवाब देता है।',
  'chat.placeholder': 'पृथ्वी पर किसी भी जगह के बारे में पूछें…', 'chat.try': 'यह पूछकर देखें', 'chat.place': 'स्थान', 'chat.noPlace': 'कोई स्थान नहीं · सामान्य सवाल',
  'cta.saveWatch': 'निगरानी जारी रखें', 'cta.export': 'निर्यात', 'cta.expert': 'विशेषज्ञ से पूछें', 'cta.addPlace': 'स्थान जोड़ें', 'cta.newWatch': 'नई निगरानी', 'cta.newSkill': 'स्किल बनाएं',
  'cta.askHere': 'इस स्थान के बारे में पूछें', 'cta.explore': 'लाइब्रेरी', 'tier.free': 'मुफ़्त', 'tier.paid': 'सशुल्क',
  'places.title': 'स्थान', 'places.sub': 'आपके सहेजे गए खेत, प्लॉट और जल स्रोत। पूछने के लिए एक चुनें।',
  'watches.title': 'निगरानी', 'watches.sub': 'सवाल जो एजेंट हर नए उपग्रह पास पर दोबारा पूछता है, विषय के अनुसार।',
  'library.title': 'स्किल लाइब्रेरी', 'library.sub': 'दोहराए जा सकने वाले तरीके जो सवाल को उपग्रह चरणों में बदलते हैं।',
  'common.all': 'सभी',
  'nav.triggers': 'ट्रिगर',
};

const sw: Dict = {
  'nav.ask': 'Uliza', 'nav.places': 'Maeneo', 'nav.watches': 'Ufuatiliaji', 'nav.library': 'Maktaba',
  'hero.eyebrow': 'Wakala wa kutazama Dunia', 'hero.title': 'Uliza sayari swali.',
  'hero.sub': 'Uliza kuhusu shamba, pwani au mji wowote. Wakala huchagua satelaiti, husafisha picha na kujibu kwa ushahidi.',
  'chat.placeholder': 'Uliza kuhusu mahali popote Duniani…', 'chat.try': 'Jaribu kuuliza', 'chat.place': 'Mahali', 'chat.noPlace': 'Hakuna mahali · swali la jumla',
  'cta.saveWatch': 'Endelea kufuatilia', 'cta.export': 'Hamisha', 'cta.expert': 'Uliza mtaalamu', 'cta.addPlace': 'Ongeza mahali', 'cta.newWatch': 'Ufuatiliaji mpya', 'cta.newSkill': 'Tengeneza ujuzi',
  'cta.askHere': 'Uliza kuhusu mahali hapa', 'cta.explore': 'Maktaba', 'tier.free': 'Bure', 'tier.paid': 'Kulipia',
  'places.title': 'Maeneo', 'places.sub': 'Mashamba, viwanja na maji uliyohifadhi. Chagua moja kuuliza.',
  'watches.title': 'Ufuatiliaji', 'watches.sub': 'Maswali ambayo wakala huuliza tena kila satelaiti inapopita.',
  'library.title': 'Maktaba ya ujuzi', 'library.sub': 'Mapishi yanayorudiwa yanayogeuza swali kuwa hatua za satelaiti.',
  'common.all': 'Zote',
  'nav.triggers': 'Vichochezi',
};

const ar: Dict = {
  'nav.ask': 'اسأل', 'nav.places': 'الأماكن', 'nav.watches': 'المراقبة', 'nav.library': 'المكتبة',
  'hero.eyebrow': 'وكيل رصد الأرض', 'hero.title': 'اسأل الكوكب سؤالاً.',
  'hero.sub': 'اسأل عن أي حقل أو ساحل أو مدينة. يختار الوكيل الأقمار الصناعية وينظف الصور ويجيب مع دليل يمكنك متابعته.',
  'chat.placeholder': 'اسأل عن أي مكان على الأرض…', 'chat.try': 'جرّب أن تسأل', 'chat.place': 'المكان', 'chat.noPlace': 'بدون مكان · سؤال عام',
  'cta.saveWatch': 'تابع المراقبة', 'cta.export': 'تصدير', 'cta.expert': 'اسأل خبيراً', 'cta.addPlace': 'أضف مكاناً', 'cta.newWatch': 'مراقبة جديدة', 'cta.newSkill': 'أنشئ مهارة',
  'cta.askHere': 'اسأل عن هذا المكان', 'cta.explore': 'المكتبة', 'tier.free': 'مجاني', 'tier.paid': 'مدفوع',
  'places.title': 'الأماكن', 'places.sub': 'الحقول والقطع والمواقع والمسطحات المائية المحفوظة.',
  'watches.title': 'المراقبة', 'watches.sub': 'أسئلة يعيد الوكيل طرحها مع كل مرور جديد للقمر الصناعي.',
  'library.title': 'مكتبة المهارات', 'library.sub': 'وصفات قابلة لإعادة الإنتاج تحول السؤال إلى خطوات بالأقمار الصناعية.',
  'common.all': 'الكل',
  'nav.triggers': 'المشغّلات',
};

const DICTS: Record<string, Dict> = { en, de, es, fr, pt, hi, sw, ar };

export const translate = (code: string, key: string) => DICTS[code]?.[key] ?? en[key] ?? key;
