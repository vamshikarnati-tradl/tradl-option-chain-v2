import { useMutation } from '@tanstack/react-query';
import { parseNaturalLanguage, type AIParseRequest, type AIParseResult } from '../services/aiParse';

// Wraps the /api/ai/parse POST as a mutation. We use the mutation surface
// (rather than a query) because parsing is a user-triggered side-effecty
// action with no cache value — each prompt is unique.
export function useAiParse() {
  return useMutation<AIParseResult, Error, AIParseRequest>({
    mutationFn: (req) => parseNaturalLanguage(req),
  });
}
