const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const config = require('../config');
const logger = require('../utils/logger');

function safeJsonFromModelText(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Empty AI response');
  }

  let text = content.trim();

  // Strip markdown fences if present
  if (text.startsWith('```')) {
    text = text.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
  }

  // Fast path: full JSON
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Extract the first {...} block (common when models add prose)
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1).trim();
    return JSON.parse(candidate);
  }

  throw new Error('AI response was not valid JSON');
}

// Lazy-init AI clients so missing keys don't crash at import time
let _openai = null;
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: config.openai.apiKey,
      timeout: config.openai.timeoutMs,
      maxRetries: 0,
    });
  }
  return _openai;
}

let _gemini = null;
function getGemini() {
  if (!_gemini) {
    _gemini = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return _gemini;
}

let _groq = null;
function getGroq() {
  if (!_groq) {
    _groq = new Groq({ apiKey: config.groq.apiKey });
  }
  return _groq;
}

// Provider priority order — tries each in sequence until one works
function getProviderOrder() {
  const primary = config.aiProvider || 'gemini';
  const all = ['gemini', 'groq', 'openai'];
  // Put primary first, then the rest
  const order = [primary, ...all.filter(p => p !== primary)];
  // Only include providers that have API keys configured
  return order.filter(p => {
    if (p === 'gemini') return !!config.gemini.apiKey;
    if (p === 'groq') return !!config.groq.apiKey;
    if (p === 'openai') return !!config.openai.apiKey;
    return false;
  });
}

// In-memory cache of recently used questions to avoid duplicates
const recentQuestions = new Set();
const MAX_CACHE_SIZE = 500;

// Circuit breaker state
const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED', // CLOSED (normal), OPEN (failing), HALF_OPEN (testing)
  threshold: 5,
  resetTimeMs: 60000, // 1 minute
};

function checkCircuitBreaker() {
  if (circuitBreaker.state === 'OPEN') {
    if (Date.now() - circuitBreaker.lastFailure > circuitBreaker.resetTimeMs) {
      circuitBreaker.state = 'HALF_OPEN';
      return true; // Allow one test request
    }
    return false;
  }
  return true;
}

function recordSuccess() {
  circuitBreaker.failures = 0;
  circuitBreaker.state = 'CLOSED';
}

function recordFailure() {
  circuitBreaker.failures++;
  circuitBreaker.lastFailure = Date.now();
  if (circuitBreaker.failures >= circuitBreaker.threshold) {
    circuitBreaker.state = 'OPEN';
    logger.warn('Circuit breaker OPEN - falling back to static questions', {
      failures: circuitBreaker.failures,
    });
  }
}

const CATEGORIES = [
  'weird history facts',
  'bizarre science',
  'strange world records',
  'unusual animal facts',
  'weird food origins',
  'surprising celebrity facts',
  'strange laws around the world',
  'obscure geography',
  'bizarre inventions',
  'unusual traditions',
  'funny language facts',
  'strange sports',
  'weird psychology facts',
  'surprising technology history',
  'unusual space facts',
];

// ==================== GENRE / DECK SYSTEM ====================
// Each genre has its own curated prompt that generates extremely tough,
// niche questions so the game is fun and bluffing is viable.

const GENRES = {
  'is-that-a-fact': {
    name: 'Is That a Fact?',
    emoji: '🤯',
    description: 'Obscure, mind-blowing true facts no one believes',
    prompt: `Generate an extremely obscure, mind-blowing trivia fact that sounds fake but is true. The question should be so weird that players will think ANY answer could be real. Pick from the most niche corners of knowledge — medieval punishments, deep-sea biology, ancient civilizations, quantum physics oddities, microbe behaviors, etc.
Requirements:
- VERY HARD — only 1 in 20 people would know this
- The real answer must sound as absurd as any fake answer
- Short answer (1-5 words)`,
  },
  'word-up': {
    name: 'Word Up!',
    emoji: '📖',
    description: 'Guess real definitions of bizarre real words',
    prompt: `Generate a question about an extremely rare, bizarre English word (or borrowed word used in English). Ask "What does the word [WORD] mean?" — pick words that are real but sound completely made up, like 'callipygian', 'sgiomlaireachd', 'lethologica', 'kakorrhaphiophobia', 'snollygoster', 'borborygmus', 'collywobbles', 'widdershins', 'bumbershoot', 'flibbertigibbet', 'gardyloo', 'kerfuffle', 'lollygag', 'malarkey', 'mumpsimus', etc. DO NOT reuse common ones — find truly obscure words.
Requirements:
- The word must be REAL and in a dictionary
- VERY HARD — almost no one will know
- Answer should be the actual definition in 1-5 words`,
  },
  'movie-bluff': {
    name: 'Movie Bluff',
    emoji: '🎬',
    description: 'Insanely obscure movie and TV trivia',
    prompt: `Generate an extremely obscure movie or TV show trivia question. Dig deep — behind-the-scenes secrets, original casting choices, deleted scenes, prop origins, production disasters, hidden easter eggs, banned episodes, original titles of famous movies, actors who turned down iconic roles, etc.
Requirements:
- VERY HARD — even movie buffs will struggle
- Not the usual "who directed X" — make it deeply niche
- Short answer (1-5 words)`,
  },
  'search-history': {
    name: 'Search History',
    emoji: '🕵️',
    description: 'Chaotic internet culture and "why did I google that" trivia',
    prompt: `Generate a hilarious but real trivia question inspired by internet search behavior, meme rabbit holes, cursed autocomplete facts, weirdly common "how do I..." queries, forgotten early-web lore, and bizarre tech myths people still search.
Requirements:
- VERY HARD — should stump most internet natives
- Keep it clean and party-safe
- Short answer (1-5 words)`,
  },
  'adulting-101': {
    name: 'Adulting 101',
    emoji: '🧾',
    description: 'Funny real-world life-skill and grown-up chaos trivia',
    prompt: `Generate an obscure trivia question around adulthood chaos: taxes, leases, insurance oddities, office etiquette disasters, household hacks, budgeting myths, legal fine print, and life admin mistakes.
Requirements:
- VERY HARD but funny
- Keep it light and non-explicit
- Short answer (1-5 words)`,
  },
  'science-friction': {
    name: 'Science Friction',
    emoji: '🔬',
    description: 'Wild science facts that defy belief',
    prompt: `Generate a mind-bending science trivia question from the weirdest edges of physics, chemistry, biology, astronomy, or neuroscience. Think: parasites that control host behavior, impossible-sounding chemical reactions, paradoxes in quantum mechanics, extremophile organisms, strange astronomical phenomena, bizarre medical conditions, etc.
Requirements:
- VERY HARD — requires deep science knowledge
- The answer should sound unbelievable
- Short answer (1-5 words)`,
  },
  'history-hysteria': {
    name: 'History Hysteria',
    emoji: '⏳',
    description: 'Absurd true stories from history',
    prompt: `Generate a trivia question about an absurd, unbelievable but TRUE historical event or fact. Think: bizarre wars (like the Emu War), ridiculous laws from history, strange deaths of historical figures, weird traditions of ancient civilizations, absurd diplomatic incidents, forgotten inventions, bizarre historical coincidences, etc.
Requirements:
- VERY HARD — even history nerds will be stumped
- The true answer should sound more fake than any bluff
- Short answer (1-5 words)`,
  },
  'animal-planet': {
    name: 'Animal Planet',
    emoji: '🦎',
    description: 'Insane animal facts you won\'t believe',
    prompt: `Generate a deeply obscure animal kingdom trivia question. Go beyond common facts — ask about bizarre mating rituals, insane defense mechanisms, strange symbiotic relationships, record-breaking animal feats, weird animal anatomy, animals with superpowers (magnetoreception, electroreception), bizarre parasites, extinct creature abilities, etc.
Requirements:
- VERY HARD — even zoologists might pause
- The real answer should be wilder than fiction
- Short answer (1-5 words)`,
  },
  'around-the-world': {
    name: 'Around the World',
    emoji: '🌍',
    description: 'Bizarre geography and cultural facts',
    prompt: `Generate an extremely obscure geography or world culture trivia question. Ask about: countries with bizarre laws still on the books, the world's most remote/unusual places, strange national records, bizarre cultural practices that outsiders find unbelievable, weird city names, unusual borders/enclaves, extreme geographic facts, etc.
Requirements:
- VERY HARD — even well-traveled people won't know
- Short answer (1-5 words)`,
  },
  'food-for-thought': {
    name: 'Food for Thought',
    emoji: '🍕',
    description: 'Weird origins and facts about food',
    prompt: `Generate an extremely obscure food and drink trivia question. Dig into: bizarre origins of common foods, strange ingredients in everyday products, food banned in certain countries, weird culinary traditions, the science behind cooking that sounds fake, bizarre food records, historical food scandals, foods that were invented by accident, etc.
Requirements:
- VERY HARD — foodies will be stumped
- The truth should sound as fake as any bluff
- Short answer (1-5 words)`,
  },
  'tech-talk': {
    name: 'Tech Talk',
    emoji: '💻',
    description: 'Mind-blowing tech and internet history',
    prompt: `Generate an extremely obscure technology or internet history trivia question. Ask about: original names/purposes of now-famous tech products, bizarre early internet history, strange patents filed by big companies, deleted features from popular apps, first versions of technologies, programming language origin stories, tech company rivalries, bizarre tech failures, etc.
Requirements:
- VERY HARD — even tech enthusiasts will struggle
- Short answer (1-5 words)`,
  },
  'body-of-knowledge': {
    name: 'Body of Knowledge',
    emoji: '🧠',
    description: 'Bizarre human body and psychology facts',
    prompt: `Generate an extremely obscure human body or psychology trivia question. Ask about: bizarre medical conditions with funny names, weird things the brain does, organs most people don't know about, strange reflexes, body facts that sound fake, psychological phenomena with names, bizarre historical medical treatments, human body records, etc.
Requirements:
- VERY HARD — even med students will think twice
- Short answer (1-5 words)`,
  },
  'music-mayhem': {
    name: 'Music Mayhem',
    emoji: '🎵',
    description: 'Deep-cut music trivia across all genres',
    prompt: `Generate an extremely obscure music trivia question spanning any genre or era. Ask about: hidden messages in songs, bizarre origin stories of famous songs, musicians' strange pre-fame jobs, instruments most people have never heard of, music theory oddities, banned/controversial songs, one-hit-wonder backstories, bizarre concert incidents, etc.
Requirements:
- VERY HARD — even music nerds will be challenged
- Short answer (1-5 words)`,
  },
  'sports-nuts': {
    name: 'Sports Nuts',
    emoji: '⚽',
    description: 'Obscure and hilarious sports trivia',
    prompt: `Generate an extremely obscure sports trivia question from any sport worldwide. Ask about: bizarre rules most fans don't know, strange Olympic events that no longer exist, ridiculous sports records, athlete superstitions, sports that sound made up but are real, legendary blunders, bizarre match outcomes, weird sports origins, etc.
Requirements:
- VERY HARD — even sports fanatics will be stumped
- Short answer (1-5 words)`,
  },
};

// Export for use by frontend (genre list endpoint)
function getGenreList() {
  return Object.entries(GENRES).map(([id, g]) => ({
    id,
    name: g.name,
    emoji: g.emoji,
    description: g.description,
  }));
}

const GAME_MODE_PROMPTS = {
  classic: `You are a trivia game question generator for a bluffing party game (like Psych!). GENRE_INSTRUCTIONS

The question must be EXTREMELY DIFFICULT — we want players to have NO idea and be forced to make up convincing bluffs. Easy questions ruin the game.

CATEGORY_HINT

Respond in STRICT JSON format only:
{"question": "your question here?", "correct_answer": "short answer here"}`,

  rapid: `You are a trivia question generator for a rapid-fire bluffing game. GENRE_INSTRUCTIONS

Make the question HARD but answerable in 1-2 words. Players should NOT know the answer easily.

CATEGORY_HINT

Respond in STRICT JSON format only:
{"question": "your question here?", "correct_answer": "one or two word answer"}`,

  meme: `You are a comedy writer for a party game. GENRE_INSTRUCTIONS

Generate a funny fill-in-the-blank or "what would happen if" prompt within the genre theme. Make it hilarious but HARD to guess the real answer.

CATEGORY_HINT

Respond in STRICT JSON format only:
{"question": "your funny prompt here?", "correct_answer": "the funniest real answer"}`,
};

// Fallback questions in case AI API fails — organized by genre with TOUGH questions
const FALLBACK_QUESTIONS = {
  'is-that-a-fact': [
    { question: "What is the only letter that doesn't appear in any U.S. state name?", correct_answer: "Q" },
    { question: "In 1932, Australia fought and lost a 'war' against what animal?", correct_answer: "Emus" },
    { question: "What was the shortest war in history, lasting only 38-45 minutes?", correct_answer: "Anglo-Zanzibar War" },
    { question: "What common kitchen item was originally sold as wallpaper cleaner?", correct_answer: "Play-Doh" },
    { question: "The inventor of the Pringles can is buried in one. What was his name?", correct_answer: "Fredric Baur" },
    { question: "Oxford University is older than what ancient civilization?", correct_answer: "Aztec Empire" },
    { question: "Nintendo was originally founded in 1889 to sell what product?", correct_answer: "Playing cards" },
    { question: "What fruit was genetically modified to create the modern banana?", correct_answer: "None — they're sterile clones" },
  ],
  'word-up': [
    { question: "What does the word 'callipygian' mean?", correct_answer: "Having beautiful buttocks" },
    { question: "What does the word 'borborygmus' mean?", correct_answer: "Stomach rumbling" },
    { question: "What does the word 'defenestration' mean?", correct_answer: "Throwing out a window" },
    { question: "What does the word 'petrichor' mean?", correct_answer: "Smell of rain on dry earth" },
    { question: "What does the word 'sonder' mean?", correct_answer: "Realizing everyone has complex lives" },
    { question: "What does the word 'kerfuffle' mean?", correct_answer: "A commotion or fuss" },
    { question: "What does the word 'snollygoster' mean?", correct_answer: "A dishonest politician" },
    { question: "What does the word 'lethologica' mean?", correct_answer: "Inability to recall a word" },
  ],
  'movie-bluff': [
    { question: "What was the original title of the movie 'Alien'?", correct_answer: "Star Beast" },
    { question: "Who was originally cast as the Terminator before Arnold Schwarzenegger?", correct_answer: "O.J. Simpson" },
    { question: "What famous movie prop was sold for $2 at a yard sale in 1994?", correct_answer: "Rosebud sled" },
    { question: "In 'The Wizard of Oz,' what was used for the Tin Man's tears?", correct_answer: "Chocolate syrup" },
    { question: "Which famous actor turned down the role of Neo in The Matrix?", correct_answer: "Will Smith" },
    { question: "What was the first movie to show a toilet on screen?", correct_answer: "Psycho" },
    { question: "In 'E.T.', what candy did they use after M&M's turned them down?", correct_answer: "Reese's Pieces" },
    { question: "What was 'Back to the Future' almost called instead?", correct_answer: "Spaceman from Pluto" },
  ],
  'search-history': [
    { question: "What was the first YouTube video ever uploaded titled?", correct_answer: "Me at the zoo" },
    { question: "The phrase 'let me Google that for you' inspired what sarcastic website acronym?", correct_answer: "LMGTFY" },
    { question: "Which old browser feature was famous for saying 'You have mail!'?", correct_answer: "AOL" },
    { question: "What 2000s typo became a meme after users meant to type 'pwned'?", correct_answer: "Owned" },
    { question: "Which search engine's name comes from a misspelling of 'googol'?", correct_answer: "Google" },
    { question: "What does '404' originally refer to on the web?", correct_answer: "Page not found" },
    { question: "Which social platform started as a check-in app called Burbn?", correct_answer: "Instagram" },
    { question: "What internet abbreviation means 'too long; didn't read'?", correct_answer: "TL;DR" },
  ],
  'adulting-101': [
    { question: "What is the common budgeting rule split by needs/wants/savings called?", correct_answer: "50/30/20 rule" },
    { question: "What credit term describes your used credit divided by total limit?", correct_answer: "Credit utilization" },
    { question: "What document proves your landlord received your security deposit terms?", correct_answer: "Deposit receipt" },
    { question: "What insurance term is the amount you pay before coverage kicks in?", correct_answer: "Deductible" },
    { question: "What tax form do U.S. employers send workers each January?", correct_answer: "W-2" },
    { question: "What emergency fund target is commonly recommended for adults?", correct_answer: "3-6 months expenses" },
    { question: "What appliance should be descaled regularly to avoid mineral buildup?", correct_answer: "Coffee maker" },
    { question: "What fee can trigger if your checking account drops below zero?", correct_answer: "Overdraft fee" },
  ],
  'science-friction': [
    { question: "What animal can survive in the vacuum of space?", correct_answer: "Tardigrade" },
    { question: "How many times heavier than air is the densest element, osmium?", correct_answer: "22 times" },
    { question: "The human body contains enough carbon to make how many pencils?", correct_answer: "About 9,000" },
    { question: "What percentage of the universe is made up of ordinary matter?", correct_answer: "About 5%" },
    { question: "Hot water freezes faster than cold water. What is this effect called?", correct_answer: "Mpemba effect" },
    { question: "What color would the sunset be on Mars?", correct_answer: "Blue" },
    { question: "A teaspoon of a neutron star would weigh about how much?", correct_answer: "6 billion tons" },
    { question: "What parasite can control the behavior of its ant host?", correct_answer: "Lancet liver fluke" },
  ],
  'history-hysteria': [
    { question: "Cleopatra lived closer in time to the Moon landing or the building of the Great Pyramid?", correct_answer: "Moon landing" },
    { question: "What did ancient Romans use as mouthwash?", correct_answer: "Urine" },
    { question: "In 1518, hundreds of people in Strasbourg couldn't stop doing what?", correct_answer: "Dancing" },
    { question: "What was ketchup originally sold as in the 1830s?", correct_answer: "Medicine" },
    { question: "Which pope declared war on cats in the 13th century?", correct_answer: "Pope Gregory IX" },
    { question: "King Henry VIII employed a person with what bizarre job title?", correct_answer: "Groom of the Stool" },
    { question: "What city was founded because of a coin toss?", correct_answer: "Portland, Oregon" },
    { question: "Napoleon was once attacked by a horde of what animals?", correct_answer: "Rabbits" },
  ],
  'animal-planet': [
    { question: "What animal has 32 brains?", correct_answer: "Leech" },
    { question: "What is the only mammal that can truly fly?", correct_answer: "Bat" },
    { question: "A group of flamingos is called what?", correct_answer: "A flamboyance" },
    { question: "What animal sleeps with one eye open and half its brain awake?", correct_answer: "Dolphin" },
    { question: "The fingerprints of what animal are virtually indistinguishable from human ones?", correct_answer: "Koala" },
    { question: "What creature's heart is located in its head?", correct_answer: "Shrimp" },
    { question: "Cows have best friends and get stressed when separated. What hormone rises?", correct_answer: "Cortisol" },
    { question: "What animal kills more people per year than sharks, lions, and wolves combined?", correct_answer: "Mosquito" },
  ],
  'around-the-world': [
    { question: "What is the only country in the world with a non-rectangular flag?", correct_answer: "Nepal" },
    { question: "In which country is it illegal to own just one guinea pig?", correct_answer: "Switzerland" },
    { question: "What country has more pyramids than Egypt?", correct_answer: "Sudan" },
    { question: "There is a village in Norway called what that has just one letter?", correct_answer: "Å" },
    { question: "What country's national anthem has no official lyrics?", correct_answer: "Spain" },
    { question: "Which country has the world's longest place name with 85 letters?", correct_answer: "Thailand (Bangkok)" },
    { question: "In what country can you find a lake called 'Lake Disappointment'?", correct_answer: "Australia" },
    { question: "What African country has exactly 13 months in its calendar?", correct_answer: "Ethiopia" },
  ],
  'food-for-thought': [
    { question: "What popular cereal was originally called 'Elijah's Manna'?", correct_answer: "Post Grape-Nuts" },
    { question: "Ranch dressing was invented for what purpose?", correct_answer: "Dude ranch workers' meals" },
    { question: "Peanuts are not nuts. What are they?", correct_answer: "Legumes" },
    { question: "What food survived a trip to the Titanic's ocean floor perfectly preserved?", correct_answer: "Worcestershire sauce" },
    { question: "Figs may contain dead wasps inside them. What is this process called?", correct_answer: "Fig-wasp mutualism" },
    { question: "The most expensive spice in the world by weight is what?", correct_answer: "Saffron" },
    { question: "What common fruit is a member of the rose family?", correct_answer: "Apple" },
    { question: "German chocolate cake is not from Germany. Where does the name come from?", correct_answer: "Sam German (a person)" },
  ],
  'tech-talk': [
    { question: "What was Google's original name before it became Google?", correct_answer: "BackRub" },
    { question: "The first computer bug was an actual bug. What kind?", correct_answer: "A moth" },
    { question: "What was YouTube's original concept before becoming a video platform?", correct_answer: "Video dating website" },
    { question: "Nokia started in 1865 as what type of company?", correct_answer: "Paper mill" },
    { question: "What was Amazon's original name before Jeff Bezos changed it?", correct_answer: "Cadabra" },
    { question: "The Firefox logo doesn't actually depict a fox. What animal is it?", correct_answer: "Red panda" },
    { question: "What was the first item ever sold on eBay?", correct_answer: "Broken laser pointer" },
    { question: "How many daily Google searches were there in 1998 when it launched?", correct_answer: "About 10,000" },
  ],
  'body-of-knowledge': [
    { question: "How many times does the average person's heart beat in a lifetime?", correct_answer: "About 2.5 billion" },
    { question: "What is the only body part that is fully grown at birth?", correct_answer: "Eyes" },
    { question: "Humans share approximately what percentage of DNA with bananas?", correct_answer: "About 60%" },
    { question: "The human nose can detect over how many different scents?", correct_answer: "1 trillion" },
    { question: "What is the medical term for brain freeze?", correct_answer: "Sphenopalatine ganglioneuralgia" },
    { question: "The strongest muscle in the human body (by weight) is what?", correct_answer: "Masseter (jaw muscle)" },
    { question: "Babies are born with approximately how many bones?", correct_answer: "About 270" },
    { question: "What organ can regenerate itself even if 75% is removed?", correct_answer: "Liver" },
  ],
  'music-mayhem': [
    { question: "What famous song was written in the bathroom of a recording studio?", correct_answer: "Respect (by Otis Redding)" },
    { question: "What musical instrument was invented by accident in the 1930s?", correct_answer: "Electric guitar" },
    { question: "Led Zeppelin's 'Stairway to Heaven' never reached what milestone?", correct_answer: "Released as a single" },
    { question: "What pop star's real first name is Robyn?", correct_answer: "Rihanna" },
    { question: "The longest officially released song is over 13 hours. Who made it?", correct_answer: "Bull of Heaven" },
    { question: "What instrument does the word 'piano' literally mean in Italian?", correct_answer: "Soft" },
    { question: "What famous band was originally named 'The Quarrymen'?", correct_answer: "The Beatles" },
    { question: "Jimi Hendrix, Janis Joplin, and Kurt Cobain all died at what age?", correct_answer: "27" },
  ],
  'sports-nuts': [
    { question: "What Olympic sport involves athletes sweeping ice with brooms?", correct_answer: "Curling" },
    { question: "In golf, what is a score of three under par called?", correct_answer: "Albatross" },
    { question: "What sport was played on the moon by astronaut Alan Shepard?", correct_answer: "Golf" },
    { question: "Tug of war was an Olympic sport until what year?", correct_answer: "1920" },
    { question: "What is the only sport to have been played on the moon?", correct_answer: "Golf" },
    { question: "In baseball, the distance between bases is exactly how many feet?", correct_answer: "90 feet" },
    { question: "What country invented the sport of badminton?", correct_answer: "India" },
    { question: "The first FIFA World Cup was held in 1930 in what country?", correct_answer: "Uruguay" },
  ],
};

// Flat fallback pool for random/no-genre
const GENERAL_FALLBACK = [
  { question: "What is the national animal of Scotland?", correct_answer: "Unicorn" },
  { question: "What was the first toy advertised on TV?", correct_answer: "Mr. Potato Head" },
  { question: "What is the fear of long words called?", correct_answer: "Hippopotomonstrosesquippedaliophobia" },
  { question: "How many years did the Hundred Years' War last?", correct_answer: "116 years" },
  { question: "What color is a hippo's sweat?", correct_answer: "Pink" },
  { question: "What was Buzz Aldrin's mother's maiden name?", correct_answer: "Moon" },
  { question: "What fruit is the most popular and most consumed in the world?", correct_answer: "Banana" },
  { question: "What animal can't stick out its tongue?", correct_answer: "Crocodile" },
  { question: "Which planet rains diamonds?", correct_answer: "Neptune" },
  { question: "A jiffy is an actual unit of time. How long is it?", correct_answer: "1/100th of a second" },
];

// Track used fallback indices per genre to avoid repeats within a session
const fallbackUsed = new Map();

function getFallbackQuestion(genre = null) {
  const pool = (genre && FALLBACK_QUESTIONS[genre]) ? FALLBACK_QUESTIONS[genre] : GENERAL_FALLBACK;
  const genreKey = genre || '_general';

  if (!fallbackUsed.has(genreKey)) fallbackUsed.set(genreKey, new Set());
  const used = fallbackUsed.get(genreKey);

  // Reset if all used
  if (used.size >= pool.length) used.clear();

  // Pick random unused
  let idx;
  do {
    idx = Math.floor(Math.random() * pool.length);
  } while (used.has(idx));
  used.add(idx);

  const question = pool[idx];
  return {
    ...question,
    category: genre ? (GENRES[genre]?.name || 'fallback') : 'fallback',
    genre: genre || 'random',
    gameMode: 'classic',
  };
}

async function generateQuestion(gameMode = 'classic', genre = null, _retryCount = 0) {
  const MAX_RETRIES = config.openai.maxRetries;

  // Circuit breaker check
  if (!checkCircuitBreaker()) {
    logger.debug('Circuit breaker open, using fallback');
    return getFallbackQuestion(genre);
  }

  // Build genre-specific prompt
  const genreData = genre && GENRES[genre] ? GENRES[genre] : null;
  const genreInstructions = genreData
    ? genreData.prompt
    : 'Generate a fun, obscure trivia question that most people won\'t know the answer to.';

  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const categoryHint = genreData ? '' : `Category hint: ${category}`;

  const promptTemplate = GAME_MODE_PROMPTS[gameMode] || GAME_MODE_PROMPTS.classic;
  const prompt = promptTemplate
    .replace('GENRE_INSTRUCTIONS', genreInstructions)
    .replace('CATEGORY_HINT', categoryHint);

  const systemInstruction = 'You are a trivia question generator. Always respond with valid JSON only. No markdown, no code blocks, just raw JSON.';

  // Try each AI provider in order until one works
  const providers = getProviderOrder();
  let lastError = null;

  for (const provider of providers) {
    try {
      let content;
      if (provider === 'gemini') {
        content = await _callGemini(systemInstruction, prompt);
      } else if (provider === 'groq') {
        content = await _callGroq(systemInstruction, prompt);
      } else {
        content = await _callOpenAI(systemInstruction, prompt);
      }

      if (!content) {
        logger.warn(`${provider} returned empty response, trying next provider`);
        continue;
      }

      const parsed = safeJsonFromModelText(content);

      if (!parsed.question || !parsed.correct_answer) {
        logger.warn(`${provider} returned invalid format, trying next provider`);
        continue;
      }

      // Check for duplicates
      const questionKey = parsed.question.toLowerCase().trim();
      if (recentQuestions.has(questionKey)) {
        logger.debug(`Duplicate from ${provider}, trying next`);
        continue;
      }

      // Add to cache
      recentQuestions.add(questionKey);
      if (recentQuestions.size > MAX_CACHE_SIZE) {
        const firstKey = recentQuestions.values().next().value;
        recentQuestions.delete(firstKey);
      }

      recordSuccess();
      logger.info(`Question generated via ${provider}`);

      return {
        question: parsed.question,
        correct_answer: parsed.correct_answer,
        category: genreData ? genreData.name : category,
        genre: genre || 'random',
        gameMode,
      };
    } catch (error) {
      lastError = error;
      logger.warn(`${provider} failed: ${error.message}, trying next provider`);
      continue;
    }
  }

  // All providers failed
  recordFailure();
  logger.error('All AI providers failed', {
    error: lastError?.message,
    retryCount: _retryCount,
    providers: providers.join(','),
  });

  // Retry once with backoff before giving up
  if (_retryCount < MAX_RETRIES) {
    const delay = Math.min(1000 * Math.pow(2, _retryCount), 5000);
    await new Promise(resolve => setTimeout(resolve, delay));
    return generateQuestion(gameMode, genre, _retryCount + 1);
  }

  return getFallbackQuestion(genre);
}

// ============ Provider-specific call functions ============

async function _callGemini(systemInstruction, prompt) {
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const model = getGemini().getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 200,
      responseMimeType: 'application/json',
    },
  });

  return result.response.text().trim();
}

async function _callGroq(systemInstruction, prompt) {
  const modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const response = await getGroq().chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ],
    max_tokens: 200,
    temperature: 0.9,
  });

  return response.choices[0]?.message?.content?.trim();
}

async function _callOpenAI(systemInstruction, prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.openai.timeoutMs);

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ],
    max_tokens: 200,
    temperature: 0.9,
    response_format: { type: 'json_object' },
  }, { signal: controller.signal });

  clearTimeout(timeoutId);
  return response.choices[0]?.message?.content?.trim();
}

async function moderateContent(text) {
  try {
    const response = await getOpenAI().moderations.create({ input: text });
    return { flagged: response.results[0]?.flagged || false };
  } catch (error) {
    logger.error('Content moderation failed', { error: error.message });
    return { flagged: false }; // Allow through if moderation fails
  }
}

async function moderatePlayerAnswer(answer) {
  if (!answer || typeof answer !== 'string') return { flagged: true };
  if (answer.length > 100) return { flagged: true };
  return moderateContent(answer);
}

module.exports = {
  generateQuestion,
  moderateContent,
  moderatePlayerAnswer,
  getGenreList,
  GENRES,
};
