/**
 * Memo classification via Sonnet.
 *
 * Called at ingest time to tag memos as events, tasks, reminders, or notes,
 * and to extract keywords that enrich Hindsight's semantic index.
 * Failures are non-blocking — returns a "note" classification on any error.
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export interface MemoClassification {
  type: "event" | "task" | "reminder" | "note";
  tags: string[];
  keywords: string[];
  extractedDate?: string;
  summary?: string;
}

const FALLBACK: MemoClassification = { type: "note", tags: [], keywords: [] };

export async function classifyMemo(
  content: string,
  apiKey: string,
): Promise<MemoClassification> {
  if (!apiKey) return FALLBACK;

  try {
    const resp = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `Classify this voice memo / note. Respond with ONLY valid JSON, no markdown fences.

Schema:
{"type":"event|task|reminder|note","tags":["action-needed"],"keywords":["word1","word2"],"extractedDate":"ISO 8601 if mentioned","summary":"one sentence"}

Type rules:
- event = has a specific date/time (graduation May 31, meeting at 3pm, dentist Tuesday)
- task = something to do without a fixed time. Key signals: "need to", "I need to remember to", "at some point", "don't forget", "make sure to", "should", "have to", "want to" + action verb
- reminder = factual info to remember, not directly actionable (account number, password, someone's preference, a fact)
- note = general thought, reflection, idea, observation with no clear action or date

Tag rules:
- Include "action-needed" in tags for event, task, and reminder. Omit only for pure notes.
- Short memos with vague future intent ("at some point later", "I need to remember") are tasks, not notes.

Keywords:
- Extract 3-8 topic keywords covering people, projects, concepts, companies, and actions mentioned.
- These are used for search indexing — be specific and useful, not generic.

Examples:
Memo: "At some point later I need to run the business ideas files through the critic prompt"
→ {"type":"task","tags":["action-needed"],"keywords":["business ideas","critic prompt","prompt evaluation","idea generation"],"summary":"Run business ideas files through the critic prompt to assess quality"}

Memo: "Carson's graduation is May 31st at 2pm at Riverside Elementary"
→ {"type":"event","tags":["action-needed"],"keywords":["Carson","graduation","Riverside Elementary"],"extractedDate":"2026-05-31T14:00:00","summary":"Carson's graduation at Riverside Elementary on May 31 at 2pm"}

Memo: "interesting thought about how the trading bot handles gaps in market data"
→ {"type":"note","tags":[],"keywords":["trading bot","market data","gaps","data handling"],"summary":"Reflection on trading bot behavior during market data gaps"}

Memo:
${content.slice(0, 2000)}`,
        }],
      }),
    });

    if (!resp.ok) {
      console.warn(`[classify] Sonnet API error: ${resp.status}`);
      return FALLBACK;
    }

    const data = (await resp.json()) as { content?: { text?: string }[] };
    const text = data.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text);

    return {
      type: ["event", "task", "reminder", "note"].includes(parsed.type) ? parsed.type : "note",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      ...(parsed.extractedDate ? { extractedDate: parsed.extractedDate } : {}),
      ...(parsed.summary ? { summary: parsed.summary } : {}),
    };
  } catch (err) {
    console.warn(`[classify] Failed: ${err instanceof Error ? err.message : err}`);
    return FALLBACK;
  }
}
