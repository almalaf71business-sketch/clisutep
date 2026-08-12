import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { createVideo, getVideo, getVideoStats, listVideos, updateVideo, getYoutubeConnection } from "./db";
import { CONTENT_CATEGORIES, CONTENT_STATUSES, getNextStatus, isEgyptianArabic, isCompleteGeneratedContent } from "./content-workflow";

const categories = CONTENT_CATEGORIES;
const statuses = CONTENT_STATUSES;
const categorySchema = z.enum(categories);
const statusSchema = z.enum(statuses);
const contentInput = z.object({
  idea: z.string().min(3),
  topic: z.string().min(2),
  title: z.string().min(2),
  category: categorySchema,
  status: statusSchema.default("idea"),
  script: z.string().optional(),
  description: z.string().optional(),
  keywords: z.string().optional(),
  scheduledAt: z.coerce.date().optional().nullable(),
  publishSlot: z.string().optional().nullable(),
});
export const editableContentInput = contentInput.omit({ status: true }).strict();
export const createContentInput = contentInput.omit({ status: true }).strict();
export const contentListFilterInput = z.object({ status: statusSchema.optional(), category: categorySchema.optional(), search: z.string().optional(), dateFilter: z.enum(["all", "scheduled", "this_week"]).optional() }).optional();

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  youtube: router({
    status: protectedProcedure.query(({ ctx }) => getYoutubeConnection(ctx.user.id)),
  }),
  content: router({
    stats: protectedProcedure.query(({ ctx }) => getVideoStats(ctx.user.id)),
    list: protectedProcedure.input(contentListFilterInput).query(({ ctx, input }) => listVideos(ctx.user.id, input)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ ctx, input }) => getVideo(ctx.user.id, input.id)),
    create: protectedProcedure.input(createContentInput).mutation(({ ctx, input }) => createVideo({ ...input, userId: ctx.user.id, status: "idea", topic: input.topic })),
    update: protectedProcedure.input(z.object({ id: z.number(), data: editableContentInput.partial() })).mutation(({ ctx, input }) => updateVideo(ctx.user.id, input.id, input.data)),
    advance: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const current = await getVideo(ctx.user.id, input.id);
      if (!current) throw new Error("المحتوى غير موجود");
      const target = getNextStatus(current.status);
      if (!target) throw new Error("هذا المحتوى منشور بالفعل");
      return updateVideo(ctx.user.id, input.id, { status: target });
    }),
    generate: protectedProcedure.input(z.object({ idea: z.string().min(3), topic: z.string().min(2), category: categorySchema })).mutation(async ({ input }) => {
      const categoryLabel = { technology: "تكنولوجيا", ai: "ذكاء اصطناعي", useful_info: "معلومات مفيدة" }[input.category];
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "أنت كاتب محتوى مصري محترف لقناة دماغ مصري. اكتب باللهجة المصرية فقط، بأسلوب واضح وعملي، ومن دون فصحى رسمية أو ادعاءات غير مؤكدة. أعد JSON فقط." },
          { role: "user", content: `الفئة: ${categoryLabel}\\nالموضوع: ${input.topic}\\nالفكرة: ${input.idea}\nاكتب عنوانًا جذابًا، سكريبتًا لفيديو قصير من 60 إلى 90 ثانية، وصفًا، و8 كلمات مفتاحية باللهجة المصرية.` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "egyptian_video_content", strict: true, schema: { type: "object", properties: { title: { type: "string" }, script: { type: "string" }, description: { type: "string" }, keywords: { type: "string" } }, required: ["title", "script", "description", "keywords"], additionalProperties: false } } },
      });
      const raw = response.choices?.[0]?.message?.content;
      if (typeof raw !== "string") throw new Error("تعذر توليد المحتوى");
      const parsed = JSON.parse(raw) as { title: string; script: string; description: string; keywords: string };
      if (!isCompleteGeneratedContent(parsed)) throw new Error("التوليد رجّع بيانات ناقصة؛ جرّب توليد المحتوى تاني");
      const combined = `${parsed.title} ${parsed.script} ${parsed.description} ${parsed.keywords}`;
      if (!isEgyptianArabic(combined)) throw new Error("التوليد مش باللهجة المصرية الكفاية؛ جرّب توليد المحتوى تاني");
      return parsed;
    }),
  }),
});

export type AppRouter = typeof appRouter;
