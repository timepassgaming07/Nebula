#!/usr/bin/env node

/**
 * ====================================================
 * Nebula AI Question Refill Agent (Multi-Provider)
 * ====================================================
 *
 * Monitors per-category unplayed inventory and auto-generates
 * high-volume question batches (30-50 questions per API call) when
 * unplayed active questions drop below threshold.
 *
 * Provider Strategy (Fallback Chain):
 * 1. PRIMARY: Groq SDK (llama3-70b-8192, mixtral-8x7b-32768) - ultra-fast & cheap
 * 2. FALLBACK 1: OpenAI (gpt-4o-mini) - if Groq fails
 * 3. FALLBACK 2: Gemini (gemini-1.5-flash) - if both Groq and OpenAI fail
 *
 * Primary Features:
 * - Groq as primary: 10-15s cooldown between batches, aggressive batching
 * - Smart rate-limiting: 429 Exponential Backoff, per-provider delay
 * - High-volume batching: Single API call for 30-50 questions
 * - Bulk Supabase insert to minimize database connections
 * - Automatic provider fallback on repeated failures
 *
 * Environment:
 *   GROQ_API_KEY              - Groq API key (optional, but primary)
 *   GROQ_MODEL                - Model (default: llama3-70b-8192)
 *   OPENAI_API_KEY            - OpenAI API key (optional, fallback 1)
 *   OPENAI_MODEL              - Model (default: gpt-4o-mini)
 *   GEMINI_API_KEY            - Gemini API key (optional, fallback 2)
 *   GEMINI_MODEL              - Model (default: gemini-1.5-flash)
 *   SUPABASE_URL              - Supabase project URL (required)
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (required)
 *   AI_THRESHOLD              - Refill threshold (default: 500 unplayed questions)
 *   AI_BATCH_SIZE             - Questions per batch (default: 40)
 *   AI_COOLDOWN_MS            - Delay between batches (default: 12000ms = 12s)
 *   AI_POLL_INTERVAL_MS       - Polling interval (default: 300000ms = 5min)
 *   AI_RUN_ONCE               - Run once and exit (default: false)
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

// ========== CONFIG & VALIDATION ==========

const {
  GROQ_API_KEY,
  GROQ_MODEL = 'llama3-70b-8192',
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-1.5-flash',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  AI_THRESHOLD = '500',
  AI_BATCH_SIZE = '40',
  AI_COOLDOWN_MS = '12000',
  AI_POLL_INTERVAL_MS = '300000',
  AI_RUN_ONCE = 'false',
} = process.env;

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

// Check that at least one AI provider is configured
if (!GROQ_API_KEY && !OPENAI_API_KEY && !GEMINI_API_KEY) {
  throw new Error('At least one AI provider key must be set: GROQ_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY');
}

// Parse numeric config
const THRESHOLD = Number.parseInt(AI_THRESHOLD, 10);
const BATCH_SIZE = Number.parseInt(AI_BATCH_SIZE, 10);
const COOLDOWN_MS = Number.parseInt(AI_COOLDOWN_MS, 10);
const POLL_INTERVAL_MS = Number.parseInt(AI_POLL_INTERVAL_MS, 10);
const RUN_ONCE = AI_RUN_ONCE === 'true';

// Validate parsed values
if (!Number.isFinite(THRESHOLD) || THRESHOLD <= 0) {
  throw new Error('AI_THRESHOLD must be a positive integer');
}
if (!Number.isFinite(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 100) {
  throw new Error('AI_BATCH_SIZE must be between 1 and 100');
}
if (!Number.isFinite(COOLDOWN_MS) || COOLDOWN_MS < 0) {
  throw new Error('AI_COOLDOWN_MS must be a non-negative integer');
}

// ========== CLIENTS ==========

const groq = new Groq({ apiKey: GROQ_API_KEY });

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ========== LOGGING UTILITIES ==========

function log(msg, extra) {
  const timestamp = new Date().toISOString();
  if (extra !== undefined) {
    console.log(`[${timestamp}] [ai-agent] ${msg}`, extra);
    return;
  }
  console.log(`[${timestamp}] [ai-agent] ${msg}`);
}

function warn(msg, extra) {
  const timestamp = new Date().toISOString();
  if (extra !== undefined) {
    console.warn(`[${timestamp}] [ai-agent] WARNING: ${msg}`, extra);
    return;
  }
  console.warn(`[${timestamp}] [ai-agent] WARNING: ${msg}`);
}

function fail(msg, extra) {
  const timestamp = new Date().toISOString();
  if (extra !== undefined) {
    console.error(`[${timestamp}] [ai-agent] ERROR: ${msg}`, extra);
    return;
  }
  console.error(`[${timestamp}] [ai-agent] ERROR: ${msg}`);
}

// ========== JSON PARSING ==========

/**
 * Attempts to extract and parse JSON from model response.
 * Handles multiple formats: raw JSON, fenced JSON, partial JSON.
 */
function parseJsonResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Response must be a non-empty string');
  }

  const trimmed = rawText.trim();

  // Try direct JSON parse
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // Fall through to other strategies
    }
  }

  // Try markdown-fenced JSON
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (e) {
      // Fall through
    }
  }

  // Try extracting first {...} or [...]
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (e) {
      // Fall through
    }
  }

  // Last resort: try extracting first [...]
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    } catch (e) {
      // Fall through
    }
  }

  throw new Error('Unable to extract valid JSON from model response');
}

// ========== VALIDATION ==========

/**
 * Validates and normalizes a batch of questions from model output.
 * Enforces strict constraints on all fields.
 */
function validateQuestionBatch(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Model response must be a JSON object');
  }

  // Accept both "items" and "questions" keys for flexibility
  const items = payload.items || payload.questions;
  if (!Array.isArray(items)) {
    throw new Error(`Model response must contain 'items' or 'questions' array. Got: ${typeof items}`);
  }

  // Validate batch size
  if (items.length < 1) {
    throw new Error('Batch must contain at least 1 question');
  }
  if (items.length > BATCH_SIZE) {
    throw new Error(`Batch contains ${items.length} questions, expected <= ${BATCH_SIZE}`);
  }

  // Normalize and validate each question
  const normalized = items.map((q, index) => {
    if (!q || typeof q !== 'object') {
      throw new Error(`Question ${index} is not a valid object`);
    }

    const question_text = String(q.question_text || q.question || '').trim();
    const correct_answer = String(q.correct_answer || q.answer || '').trim();
    const explanation = q.explanation ? String(q.explanation).trim() : null;
    const difficulty = q.difficulty ? Number.parseInt(String(q.difficulty), 10) : 3;

    // Validate question_text
    if (question_text.length < 10) {
      throw new Error(`Question ${index}: text too short (min 10 chars)`);
    }
    if (question_text.length > 500) {
      throw new Error(`Question ${index}: text too long (max 500 chars, got ${question_text.length})`);
    }

    // Validate correct_answer
    if (correct_answer.length < 1) {
      throw new Error(`Question ${index}: answer cannot be empty`);
    }
    if (correct_answer.length > 200) {
      throw new Error(`Question ${index}: answer too long (max 200 chars, got ${correct_answer.length})`);
    }

    // Validate difficulty
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      throw new Error(`Question ${index}: difficulty must be 1-5, got ${difficulty}`);
    }

    return {
      question_text,
      correct_answer,
      explanation,
      difficulty,
    };
  });

  return normalized;
}

// ========== GROQ API INTEGRATION ==========

/**
 * Generates a batch of trivia questions using Groq.
 * Returns null if Groq is not configured or fails with retries exhausted.
 */
async function generateQuestionsWithGroq(categoryName) {
  if (!GROQ_API_KEY) {
    return null; // Groq not configured, skip to fallback
  }

  const systemPrompt = `You are a professional trivia question generator for a multiplayer party game.
Your task is to generate a batch of ${BATCH_SIZE} trivia questions for the category: ${categoryName}.

CRITICAL INSTRUCTIONS:
1. Generate EXACTLY ${BATCH_SIZE} questions in a single JSON response.
2. Each question must have unique content (no duplicates or paraphrases).
3. Questions must be challenging but fair - suitable for knowledgeable players.
4. Return STRICT JSON ONLY. No markdown, no commentary, no code blocks.
5. Use this exact JSON structure:
{
  "items": [
    {
      "question_text": "Clear, engaging question without answer hints?",
      "correct_answer": "Short, concise answer",
      "explanation": "Brief fact or reasoning (optional)",
      "difficulty": 3
    }
  ]
}`;

  const userPrompt = `Generate ${BATCH_SIZE} trivia questions for: ${categoryName}`;

  log(`Requesting ${BATCH_SIZE} questions from Groq (model: ${GROQ_MODEL}, category: ${categoryName})`);

  try {
    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 8000,
    });

    const content = response?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Groq returned empty response');
    }

    log(`Received response from Groq (${content.length} chars)`);

    const parsed = parseJsonResponse(content);
    const normalized = validateQuestionBatch(parsed);

    log(`✓ Groq: Validated ${normalized.length} questions for ${categoryName}`);
    return normalized;
  } catch (error) {
    if (error.status === 429) {
      warn(`Groq rate limit (429): ${error.message}`);
      throw new RateLimitError(`Groq 429: ${error.message}`, 429);
    }
    throw error;
  }
}

/**
 * Generates questions using OpenAI as fallback.
 * Returns null if OpenAI is not configured.
 */
async function generateQuestionsWithOpenAI(categoryName) {
  if (!OPENAI_API_KEY) {
    return null;
  }

  log(`Requesting ${BATCH_SIZE} questions from OpenAI (model: ${OPENAI_MODEL}, category: ${categoryName})`);

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: Math.max(1, Math.floor(BATCH_SIZE * 0.8)),
        maxItems: BATCH_SIZE,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question_text', 'correct_answer', 'difficulty'],
          properties: {
            question_text: { type: 'string', minLength: 10, maxLength: 500 },
            correct_answer: { type: 'string', minLength: 1, maxLength: 200 },
            explanation: { type: 'string', maxLength: 700 },
            difficulty: { type: 'integer', minimum: 1, maximum: 5 },
          },
        },
      },
    },
  };

  const prompt = [
    'Generate multiplayer trivia questions in strict JSON.',
    `Category: ${categoryName}`,
    `Target count: ${BATCH_SIZE}`,
    'Keep correct_answer concise and objective.',
    'Avoid duplicate topics or nearly identical phrasings.',
    'No markdown, no commentary, JSON only.',
  ].join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'trivia_batch',
            strict: true,
            schema,
          },
        },
        messages: [
          { role: 'system', content: 'You output strict JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) {
        throw new RateLimitError(`OpenAI 429: ${text}`, 429);
      }
      throw new Error(`OpenAI error ${res.status}: ${text}`);
    }

    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned empty content');
    }

    const parsed = JSON.parse(content);
    const normalized = validateQuestionBatch(parsed);

    log(`✓ OpenAI: Validated ${normalized.length} questions for ${categoryName}`);
    return normalized;
  } catch (error) {
    throw error;
  }
}

/**
 * Generates questions using Gemini as final fallback.
 * Returns null if Gemini is not configured.
 */
async function generateQuestionsWithGemini(categoryName) {
  if (!GEMINI_API_KEY) {
    return null;
  }

  log(`Requesting ${BATCH_SIZE} questions from Gemini (model: ${GEMINI_MODEL}, category: ${categoryName})`);

  const prompt = [
    'Return only valid JSON.',
    `Generate at least 1 and up to ${BATCH_SIZE} multiplayer trivia questions for category: ${categoryName}.`,
    'Use this JSON shape exactly:',
    '{"items":[{"question_text":"...","correct_answer":"...","explanation":"...","difficulty":3}]}',
    'Constraints:',
    '- question_text length 10..500',
    '- correct_answer length 1..200',
    '- difficulty integer 1..5',
    '- no duplicates',
    '- no markdown fences',
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) {
        throw new RateLimitError(`Gemini 429: ${text}`, 429);
      }
      throw new Error(`Gemini error ${res.status}: ${text}`);
    }

    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini returned empty content');
    }

    const parsed = parseJsonResponse(text);
    const normalized = validateQuestionBatch(parsed);

    log(`✓ Gemini: Validated ${normalized.length} questions for ${categoryName}`);
    return normalized;
  } catch (error) {
    throw error;
  }
}

// ========== PROVIDER FALLBACK CHAIN ==========

/**
 * Tries all configured providers in order: Groq → OpenAI → Gemini
 * If a provider fails with a rate limit, it will be retried by withBackoff().
 * Only advances to next provider on non-rate-limit errors.
 */
async function generateQuestionsWithFallback(categoryName) {
  const errors = [];

  // Try Groq first (primary)
  try {
    const result = await generateQuestionsWithGroq(categoryName);
    if (result) return result;
  } catch (error) {
    // If it's a rate limit, throw immediately (let withBackoff handle retry)
    if (error instanceof RateLimitError) {
      throw error;
    }
    // Otherwise, log and try next provider
    errors.push(`Groq: ${error.message}`);
    warn(`Groq failed, trying OpenAI fallback: ${error.message}`);
  }

  // Try OpenAI (fallback 1)
  try {
    const result = await generateQuestionsWithOpenAI(categoryName);
    if (result) return result;
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }
    errors.push(`OpenAI: ${error.message}`);
    warn(`OpenAI failed, trying Gemini fallback: ${error.message}`);
  }

  // Try Gemini (fallback 2)
  try {
    const result = await generateQuestionsWithGemini(categoryName);
    if (result) return result;
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }
    errors.push(`Gemini: ${error.message}`);
  }

  // All providers exhausted
  throw new Error(
    `All AI providers failed for ${categoryName}:\n${errors.map((e) => `  - ${e}`).join('\n')}`
  );
}

// ========== BACKOFF WITH 429 HANDLING ==========

/**
 * Retries an operation with exponential backoff.
 * Special handling for 429 errors: uses longer, more aggressive backoff.
 *
 * Backoff strategy:
 * - Standard errors: 1s, 2s, 4s, 8s, 16s, 30s (with jitter)
 * - 429 errors: 10s, 20s, 40s, 80s, ... (longer waiting)
 */
async function withBackoff(fn, options = {}) {
  const {
    retries = 6,
    baseMs = 1000,
    maxMs = 30000,
    label = 'operation',
  } = options;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      // If we've exhausted retries, throw the error
      if (attempt >= retries) {
        fail(`${label} failed after ${retries + 1} attempts: ${error.message}`);
        throw error;
      }

      // Determine wait time based on error type
      let waitMs;
      if (error instanceof RateLimitError && error.statusCode === 429) {
        // For 429: Use longer, more aggressive backoff (10s, 20s, 40s, ...)
        const jitter = Math.floor(Math.random() * 2000);
        waitMs = Math.min(maxMs, 10000 * (2 ** attempt)) + jitter;
        warn(
          `${label} hit rate limit (attempt ${attempt + 1}/${retries + 1}). ` +
          `Waiting ${waitMs}ms before retry...`
        );
      } else {
        // For other errors: Standard exponential backoff
        const jitter = Math.floor(Math.random() * 1000);
        waitMs = Math.min(maxMs, baseMs * (2 ** attempt)) + jitter;
        warn(`${label} failed (attempt ${attempt + 1}/${retries + 1}): ${error.message}. ` +
          `Retrying in ${waitMs}ms...`);
      }

      // Wait before retry
      await sleep(waitMs);
    }
  }
}

/**
 * Sleep helper for cleaner async/await code.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ========== SUPABASE OPERATIONS ==========

/**
 * Query unplayed question count for a category.
 */
async function getUnplayedCount(categoryId) {
  const { count, error } = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId)
    .eq('is_active', true)
    .eq('times_served', 0);

  if (error) {
    throw new Error(`Failed to count unplayed questions: ${error.message}`);
  }

  return count || 0;
}

/**
 * Bulk insert questions into Supabase.
 * Uses upsert to handle potential duplicates gracefully.
 */
async function insertQuestionBatch(categoryId, categoryName, items, sourceModel) {
  const batchId = crypto.randomUUID();

  // Transform items into database row format
  const rows = items.map((q) => ({
    category_id: categoryId,
    question_text: q.question_text,
    correct_answer: q.correct_answer,
    explanation: q.explanation,
    difficulty: q.difficulty,
    language_code: 'en',
    is_active: true,
    generation_batch_id: batchId,
    source_model: sourceModel || GROQ_MODEL,
    created_by: 'ai_agent',
    // Note: question_hash is computed by database trigger
  }));

  log(`Bulk inserting ${rows.length} questions for ${categoryName} (batchId: ${batchId}, model: ${sourceModel || GROQ_MODEL})`);

  const { data, error } = await supabase
    .from('questions')
    .upsert(rows, {
      onConflict: 'category_id,question_hash',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) {
    throw new Error(`Failed to insert questions: ${error.message}`);
  }

  const insertedCount = data?.length ?? 0;
  log(`Inserted ${insertedCount} of ${rows.length} questions for ${categoryName}`);

  return insertedCount;
}

// ========== CATEGORY REFILL LOGIC ==========

/**
 * Executes the refill strategy for a single category:
 * 1. Check current unplayed count
 * 2. If below threshold, generate a batch
 * 3. Insert and check if threshold now met
 * 4. Continue until threshold met or stagnation detected
 *
 * Cooldown: After each successful batch, wait COOLDOWN_MS before checking again.
 * This allows the Groq TPM bucket to refill and avoids hammering the API.
 */
async function refillCategory(row) {
  const { category_id, name } = row;

  let unplayed = await getUnplayedCount(category_id);
  if (unplayed >= THRESHOLD) {
    log(`Category ${name} has ${unplayed} unplayed (>= ${THRESHOLD}), no refill needed`);
    return;
  }

  log(`Category ${name} below threshold: ${unplayed}/${THRESHOLD}. Starting refill...`);

  let stagnantBatches = 0;
  let batchCount = 0;

  // Continue generating until threshold is met
  while (unplayed < THRESHOLD) {
    const previous = unplayed;

    try {
      // Generate batch via multi-provider fallback with backoff on 429
      const generated = await withBackoff(
        () => generateQuestionsWithFallback(name),
        { label: `generate:${name}`, retries: 5 }
      );

      // Insert batch with backoff (track which provider generated it)
      const inserted = await withBackoff(
        () => insertQuestionBatch(category_id, name, generated, 'multi-provider'),
        { label: `insert:${name}`, retries: 3 }
      );

      batchCount += 1;
      log(`${name} batch ${batchCount} complete: inserted ${inserted} questions`);

      // Query updated count
      unplayed = await getUnplayedCount(category_id);
      log(`${name} unplayed count after batch ${batchCount}: ${unplayed}`);

      // Check for stagnation (no growth)
      if (unplayed <= previous) {
        stagnantBatches += 1;
        if (stagnantBatches >= 3) {
          fail(`${name} did not grow after 3 batches. Stopping refill to avoid infinite loop.`);
          break;
        }
      } else {
        stagnantBatches = 0; // Reset counter on progress
      }

      // ========== RATE-LIMIT COOLDOWN ==========
      // After successful batch, pause before next request.
      // This allows the Groq TPM bucket to refill and respects rate limits.
      if (unplayed < THRESHOLD) {
        log(`Cooling down for ${COOLDOWN_MS}ms before next batch (respecting API TPM limits)...`);
        await sleep(COOLDOWN_MS);
      }
    } catch (error) {
      fail(`${name} batch ${batchCount + 1} failed: ${error.message}`);
      break;
    }
  }

  if (unplayed >= THRESHOLD) {
    log(`${name} refill complete: ${unplayed} unplayed questions (>= ${THRESHOLD})`);
  }
}

// ========== MAIN CYCLE ==========

/**
 * Runs one refill cycle:
 * 1. Query categories below threshold
 * 2. Refill each category one at a time
 * 3. Handle errors gracefully (log, continue to next category)
 */
async function runCycle() {
  log('Starting refill cycle...');

  // Query categories that need refill
  const { data, error } = await supabase.rpc('question_inventory_by_category', {
    p_threshold: THRESHOLD,
  });

  if (error) {
    fail(`Failed to fetch category inventory: ${error.message}`);
    throw error;
  }

  if (!data || data.length === 0) {
    log('No categories require refill this cycle');
    return;
  }

  log(`Found ${data.length} categories below threshold`);

  // Refill each category
  for (const row of data) {
    try {
      await refillCategory(row);
    } catch (error) {
      fail(`Refill failed for ${row.name}: ${error.message}`);
      // Continue to next category instead of crashing
    }
  }

  log('Cycle complete');
}

// ========== MAIN LOOP ==========

/**
 * Entry point: runs refill cycles in a continuous loop.
 * Respects POLL_INTERVAL_MS between cycles and handles fatal errors gracefully.
 */
async function main() {
  // Determine which providers are available
  const providers = [];
  if (GROQ_API_KEY) providers.push(`Groq(${GROQ_MODEL})`);
  if (OPENAI_API_KEY) providers.push(`OpenAI(${OPENAI_MODEL})`);
  if (GEMINI_API_KEY) providers.push(`Gemini(${GEMINI_MODEL})`);

  log(
    `Starting Nebula AI Agent (Multi-Provider Fallback)\n` +
    `  Providers: ${providers.join(' → ')}\n` +
    `  Batch size: ${BATCH_SIZE} questions\n` +
    `  Cooldown: ${COOLDOWN_MS}ms between batches\n` +
    `  Threshold: ${THRESHOLD} unplayed questions\n` +
    `  Poll interval: ${POLL_INTERVAL_MS}ms\n` +
    `  Run once: ${RUN_ONCE}`
  );

  if (RUN_ONCE) {
    try {
      await runCycle();
      log('Run-once mode: cycle complete, exiting');
    } catch (error) {
      fail(`Fatal error: ${error.message}`);
      process.exit(1);
    }
    return;
  }

  // Continuous polling loop
  let cycleCount = 0;
  while (true) {
    const start = Date.now();
    cycleCount += 1;

    try {
      log(`\n--- Cycle ${cycleCount} ---`);
      await runCycle();
    } catch (error) {
      fail(`Cycle failed: ${error.message}`);
    }

    const elapsed = Date.now() - start;
    const waitMs = Math.max(5000, POLL_INTERVAL_MS - elapsed); // Never sleep less than 5s
    log(`Cycle took ${elapsed}ms, sleeping ${waitMs}ms before next poll`);
    await sleep(waitMs);
  }
}

// ========== ENTRY ==========

main().catch((error) => {
  fail(`Unhandled fatal error: ${error.message}`);
  process.exit(1);
});
