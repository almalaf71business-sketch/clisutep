export const CONTENT_CATEGORIES = ["technology", "ai", "useful_info"] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];
export const CONTENT_STATUSES = ["idea", "draft", "review", "ready", "published"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

const nextStatus: Record<ContentStatus, ContentStatus | null> = {
  idea: "draft",
  draft: "review",
  review: "ready",
  ready: "published",
  published: null,
};

export function getNextStatus(status: ContentStatus) {
  return nextStatus[status];
}

export function isEgyptianArabic(text: string) {
  return /(إيه|عايز|عاوز|دلوقتي|كده|ممكن|خلينا|بتاع|جامد|ليه|ازاي|هت|مش)/.test(text);
}

export function isCompleteGeneratedContent(value: { title?: string; script?: string; description?: string; keywords?: string }) {
  return [value.title, value.script, value.description, value.keywords].every(item => typeof item === "string" && item.trim().length > 0);
}
