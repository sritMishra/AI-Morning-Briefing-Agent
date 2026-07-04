import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import { env } from '../config/env.js';

/**
 * Provider abstraction.
 *
 * The rest of the app asks for `fastModel()` (cheap per-item summarising) or
 * `smartModel()` (the single, higher-reasoning "rank my day" pass) and never
 * cares which vendor is behind it.
 *
 * Switching to Anthropic later is a drop-in:
 *   1. npm i @ai-sdk/anthropic
 *   2. set ANTHROPIC_API_KEY and LLM_PROVIDER=anthropic
 *   3. uncomment the anthropic branch below
 * Every call site (generateObject / generateText) stays identical.
 */
function model(id: string): LanguageModel {
  switch (env.LLM_PROVIDER) {
    case 'openai':
      return openai(id);
    // case 'anthropic': {
    //   const { anthropic } = await import('@ai-sdk/anthropic');
    //   return anthropic(id);
    // }
    default:
      return openai(id);
  }
}

export const fastModel = (): LanguageModel => model(env.LLM_MODEL_FAST);
export const smartModel = (): LanguageModel => model(env.LLM_MODEL_SMART);
