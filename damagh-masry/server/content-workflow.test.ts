import { describe, expect, it } from "vitest";
import { CONTENT_CATEGORIES, CONTENT_STATUSES, getNextStatus, isEgyptianArabic, isCompleteGeneratedContent } from "./content-workflow";
import { contentListFilterInput, createContentInput, editableContentInput } from "./routers";

describe("content workflow", () => {
  it("keeps the official categories fixed", () => {
    expect(CONTENT_CATEGORIES).toEqual(["technology", "ai", "useful_info"]);
  });

  it("moves through the required status order only", () => {
    expect(CONTENT_STATUSES).toEqual(["idea", "draft", "review", "ready", "published"]);
    expect(getNextStatus("idea")).toBe("draft");
    expect(getNextStatus("draft")).toBe("review");
    expect(getNextStatus("review")).toBe("ready");
    expect(getNextStatus("ready")).toBe("published");
    expect(getNextStatus("published")).toBeNull();
  });

  it("rejects direct status injection at create and update boundaries", () => {
    const base = { idea: "فكرة عن تطبيق مفيد", topic: "تطبيقات", title: "عنوان مفيد", category: "technology" as const };
    expect(createContentInput.safeParse({ ...base, status: "ready" }).success).toBe(false);
    expect(editableContentInput.safeParse({ status: "published" }).success).toBe(false);
  });

  it("accepts the complete list filter contract", () => {
    expect(contentListFilterInput.parse({ status: "review", category: "ai", dateFilter: "this_week", search: "أداة" })).toEqual({ status: "review", category: "ai", dateFilter: "this_week", search: "أداة" });
    expect(() => contentListFilterInput.parse({ status: "invalid" })).toThrow();
  });

  it("accepts all generated fields at create and update boundaries", () => {
    const generated = { idea: "فكرة عن أداة", topic: "أدوات", title: "عنوان جامد", category: "technology" as const, script: "إيه رأيك نجرب الأداة دي دلوقتي؟", description: "وصف مفيد", keywords: "أدوات, تكنولوجيا" };
    expect(createContentInput.safeParse(generated).success).toBe(true);
    expect(editableContentInput.safeParse(generated).success).toBe(true);
  });

  it("requires the complete generated content payload", () => {
    const complete = { title: "عنوان جامد", script: "إيه رأيك نجرب ده دلوقتي؟", description: "وصف مفيد", keywords: "ذكاء اصطناعي, أدوات" };
    expect(isCompleteGeneratedContent(complete)).toBe(true);
    expect(isCompleteGeneratedContent({ ...complete, script: "" })).toBe(false);
    expect(isCompleteGeneratedContent({ title: complete.title, description: complete.description })).toBe(false);
  });

  it("accepts Egyptian colloquial signals and rejects generic formal text", () => {
    expect(isEgyptianArabic("إيه رأيك نجرب الأداة دي دلوقتي؟")).toBe(true);
    expect(isEgyptianArabic("هذا نص رسمي باللغة العربية الفصحى")).toBe(false);
  });
});
