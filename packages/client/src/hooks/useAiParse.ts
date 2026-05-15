import { useMutation } from '@tanstack/react-query';
import {
  parseNaturalLanguage, type AIParseRequest, type AIParseResponse,
} from '../services/aiParse';

// Wraps the /api/ai/parse POST as a mutation. The response is a union — a
// successful `result` or a server-issued `clarification` (model asked the
// user a question). Both flow through `data` on the mutation; the caller
// switches on `data.kind`.
export function useAiParse() {
  return useMutation<AIParseResponse, Error, AIParseRequest>({
    mutationFn: (req) => parseNaturalLanguage(req),
  });
}
