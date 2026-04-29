#!/usr/bin/env node

/*
 * Supabase AI Question Refill Agent
 *
 * Monitors per-category unplayed inventory and auto-generates batches when
 * unplayed active questions drop below threshold.
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-1.5-flash',
  AI_PROVIDER = OPENAI_API_KEY ? 'openai' : 'gemini',
  AI_THRESHOLD = '500',
  AI_BATCH_SIZE = '50',
  AI_POLL_INTERVAL_MS = '300000',
  AI_RUN_ONCE = 'false',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
if (AI_PROVIDER === 'openai' && !OPENAI_API_KEY) {
  throw new Error('AI_PROVIDER=openai but OPENAI_API_KEY is missing');
}
if (AI_PROVIDER === 'gemini' && !GEMINI_API_KEY) {
  throw new Error('AI_PROVIDER=gemini but GEMINI_API_KEY is missing');
}

const THRESHOLD = Number.parseInt(AI_THRESHOLD, 10);
const BATCH_SIZE = Number.parseInt(AI_BATCH_SIZE, 10);
const POLL_INTERVAL_MS = Number.parseInt(AI_POLL_INTERVAL_MS, 10);
const RUN_ONCE = AI_RUN_ONCE === 'true';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function log(msg, extra) {
  if (extra !== undefined) {
    console.log(`[ai-agent] ${msg}`, extra);
    return;
  }
  console.log(`[ai-agent] ${msg}`);
}

function fail(msg, extra) {
  if (extra !== undefined) {
    console.error(`[ai-agent] ${msg}`, extra);
    return;
  }
  console.error(`[ai-agent] ${msg}`);
}

function parseJsonLoose(rawText) {
  const trimmed = rawText.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error('Unable to parse JSON response from model');
}

function validateQuestions(payload) {
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error('Model response must be JSON object with items[]');
  }

  const normalized = payload.items.map((q) => {
    const question_text = String(q.question_text || '').trim();
    const correct_answer = String(q.correct_answer || '').trim();
    const explanation = q.explanation ? String(q.explanation).trim() : null;
    const difficulty = Number.parseInt(String(q.difficulty ?? 3), 10);

    if (question_text.length < 10 || question_text.length > 500) {
      throw new Error(`Invalid question_text length: ${question_text.length}`);
    }
    if (correct_answer.length < 1 || correct_answer.length > 200) {
      throw new Error(`Invalid correct_answer length: ${correct_answer.length}`);
    }
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      throw new Error(`Invalid difficulty: ${difficulty}`);
    }

    return {
      question_text,
      correct_answer,
      explanation,
      difficulty,
    };
  });

  if (normalized.length !== BATCH_SIZE) {
    throw new Error(`Expected exactly ${BATCH_SIZE} questions, got ${normalized.length}`);
  }

  return normalized;
}

async function generateWithOpenAI(categoryName) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: BATCH_SIZE,
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
    `Count: ${BATCH_SIZE}`,
    'Keep correct_answer concise and objective.',
    'Avoid duplicate topics or nearly identical phrasings.',
    'No markdown, no commentary, JSON only.',
  ].join('\n');

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
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned empty content');
  }

  return validateQuestions(JSON.parse(content));
}

async function generateWithGemini(categoryName) {
  const prompt = [
    'Return only valid JSON.',
    `Generate exactly ${BATCH_SIZE} multiplayer trivia questions for category: ${categoryName}.`,
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
    throw new Error(`Gemini error ${res.status}: ${text}`);
  }

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned empty content');
  }

  const parsed = parseJsonLoose(text);
  return validateQuestions(parsed);
}

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
      if (attempt >= retries) throw error;
      const jitter = Math.floor(Math.random() * 1000);
      const waitMs = Math.min(maxMs, baseMs * (2 ** attempt)) + jitter;
      fail(`${label} failed (attempt ${attempt + 1}/${retries + 1}): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function generateBatch(categoryName) {
  if (AI_PROVIDER === 'gemini') {
    return withBackoff(() => generateWithGemini(categoryName), {
      label: `gemini:${categoryName}`,
    });
  }
  return withBackoff(() => generateWithOpenAI(categoryName), {
    label: `openai:${categoryName}`,
  });
}

async function getUnplayedCount(categoryId) {
  const { count, error } = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId)
    .eq('is_active', true)
    .eq('times_served', 0);

  if (error) {
    throw error;
  }

  return count || 0;
}

async function insertBatch(categoryId, categoryName, items) {
  const batchId = crypto.randomUUID();

  const rows = items.map((q) => ({
    category_id: categoryId,
    question_text: q.question_text,
    correct_answer: q.correct_answer,
    explanation: q.explanation,
    difficulty: q.difficulty,
    language_code: 'en',
    is_active: true,
    generation_batch_id: batchId,
    source_model: AI_PROVIDER === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL,
    created_by: 'ai_agent',
  }));

  const { error } = await supabase
    .from('questions')
    .upsert(rows, { onConflict: 'category_id,question_hash', ignoreDuplicates: true });

  if (error) {
    throw error;
  }

  log(`Inserted batch for ${categoryName}: ${rows.length} rows`);
}

async function refillCategory(row) {
  const { category_id, name } = row;

  let unplayed = await getUnplayedCount(category_id);
  if (unplayed >= THRESHOLD) {
    return;
  }

  log(`Category ${name} below threshold (${unplayed}/${THRESHOLD}), generating...`);

  let stagnantBatches = 0;

  // Keep generating in fixed-size batches until threshold is met.
  while (unplayed < THRESHOLD) {
    const previous = unplayed;
    const generated = await generateBatch(name);
    await withBackoff(() => insertBatch(category_id, name, generated), {
      label: `insert:${name}`,
    });
    unplayed = await getUnplayedCount(category_id);
    log(`Category ${name} unplayed now: ${unplayed}`);

    if (unplayed <= previous) {
      stagnantBatches += 1;
      if (stagnantBatches >= 3) {
        fail(`Category ${name} did not grow after 3 batches; stopping to avoid infinite loop.`);
        break;
      }
    } else {
      stagnantBatches = 0;
    }
  }
}

async function runCycle() {
  const { data, error } = await supabase.rpc('question_inventory_by_category', {
    p_threshold: THRESHOLD,
  });

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    log('No categories require refill this cycle');
    return;
  }

  for (const row of data) {
    try {
      await refillCategory(row);
    } catch (e) {
      fail(`Refill failed for ${row.name}: ${e.message}`);
    }
  }
}

async function main() {
  log(
    `Starting AI agent with provider=${AI_PROVIDER}, threshold=${THRESHOLD}, batch=${BATCH_SIZE}, intervalMs=${POLL_INTERVAL_MS}`
  );

  if (RUN_ONCE) {
    await runCycle();
    log('Run once complete');
    return;
  }

  while (true) {
    const start = Date.now();
    try {
      await runCycle();
    } catch (e) {
      fail(`Cycle failed: ${e.message}`);
    }

    const elapsed = Date.now() - start;
    const waitMs = Math.max(1000, POLL_INTERVAL_MS - elapsed);
    log(`Sleeping ${waitMs}ms before next cycle`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

main().catch((e) => {
  fail(`Fatal error: ${e.message}`);
  process.exit(1);
});
