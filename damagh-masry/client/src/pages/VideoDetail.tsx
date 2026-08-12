import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, ChevronLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export default function VideoDetail() {
  const [, params] = useRoute("/videos/:id");
  const [, navigate] = useLocation();
  const id = Number(params?.id);
  const query = trpc.content.get.useQuery({ id }, { enabled: Number.isFinite(id) });
  const utils = trpc.useUtils();
  const update = trpc.content.update.useMutation({ onSuccess: () => { utils.content.get.invalidate({ id }); toast.success("اتحفظت التعديلات"); } });
  const advance = trpc.content.advance.useMutation({ onSuccess: () => { utils.content.get.invalidate({ id }); toast.success("اتنقل للمرحلة اللي بعدها"); } });
  const [draft, setDraft] = useState<any>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [uploading, setUploading] = useState(false);
  const value = draft ?? query.data;
  if (query.isLoading) return <div className="grid min-h-screen place-items-center"><Loader2 className="animate-spin text-[#ef6f51]" /></div>;
  if (!value) return <div className="grid min-h-screen place-items-center">الفيديو مش موجود.</div>;

  const save = () => update.mutate({ id, data: { idea: value.idea, topic: value.topic, title: value.title, category: value.category, script: value.script, description: value.description, keywords: value.keywords, scheduledAt: value.scheduledAt ? new Date(value.scheduledAt) : null, publishSlot: value.publishSlot } });
  const uploadToYoutube = async () => {
    if (!videoFile) return toast.error("اختار ملف فيديو الأول");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("video", videoFile);
      form.append("videoId", String(id));
      form.append("privacyStatus", privacyStatus);
      if (value.scheduledAt) form.append("publishAt", new Date(value.scheduledAt).toISOString());
      const response = await fetch("/api/youtube/upload", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "فشل الرفع");
      toast.success(payload.scheduled ? "اترفع واتجدول على YouTube" : "اترفع الفيديو على YouTube");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "حصلت مشكلة في الرفع");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#f6f7f4] p-5 text-[#17241f] md:p-10">
      <div className="mx-auto max-w-4xl">
        <Button variant="ghost" onClick={() => navigate("/")} className="mb-6"><ArrowRight className="ml-2" size={17} /> رجوع للاستوديو</Button>
        <div className="mb-8 flex items-end justify-between"><div><p className="text-sm font-bold text-[#ef6f51]">VIDEO DETAIL</p><h1 className="mt-2 text-4xl font-black">تفاصيل الفيديو</h1></div><span className="rounded-full bg-[#edf0e8] px-4 py-2 text-sm font-bold">{value.status}</span></div>
        <Card className="border-0 shadow-[0_10px_35px_rgba(39,55,45,.07)]">
          <CardHeader><CardTitle>محتوى الفيديو</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <Input value={value.title} onChange={e => setDraft({ ...value, title: e.target.value })} placeholder="العنوان" />
            <Input value={value.topic} onChange={e => setDraft({ ...value, topic: e.target.value })} placeholder="الموضوع" />
            <Textarea value={value.idea} onChange={e => setDraft({ ...value, idea: e.target.value })} placeholder="الفكرة" />
            <Textarea value={value.script ?? ""} onChange={e => setDraft({ ...value, script: e.target.value })} className="min-h-64" placeholder="السكريبت باللهجة المصرية" />
            <Textarea value={value.description ?? ""} onChange={e => setDraft({ ...value, description: e.target.value })} placeholder="الوصف" />
            <Input value={value.keywords ?? ""} onChange={e => setDraft({ ...value, keywords: e.target.value })} placeholder="الكلمات المفتاحية" />
            <div className="grid gap-4 md:grid-cols-2"><Input type="datetime-local" value={value.scheduledAt ? new Date(value.scheduledAt).toISOString().slice(0, 16) : ""} onChange={e => setDraft({ ...value, scheduledAt: e.target.value ? new Date(e.target.value) : null })} /><Input value={value.publishSlot ?? ""} onChange={e => setDraft({ ...value, publishSlot: e.target.value })} placeholder="مكان النشر" /></div>
            <div className="rounded-2xl bg-[#f6f7f4] p-4"><p className="mb-3 text-sm font-bold">رفع وجدولة على YouTube</p><div className="grid gap-3 md:grid-cols-[1fr_180px_auto]"><input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e => setVideoFile(e.target.files?.[0] ?? null)} className="rounded-lg border border-[#dfe5df] bg-white p-2 text-sm" /><select value={privacyStatus} onChange={e => setPrivacyStatus(e.target.value)} className="rounded-lg border border-[#dfe5df] bg-white px-3 text-sm"><option value="private">خاص</option><option value="unlisted">غير مدرج</option><option value="public">عام</option></select><Button disabled={uploading} onClick={uploadToYoutube} className="bg-[#ef6f51] text-white">{uploading ? <Loader2 className="animate-spin" /> : "ارفع الفيديو"}</Button></div><p className="mt-2 text-xs text-[#7b8982]">لو فيه موعد مجدول فوق، هيتبعت لـ YouTube كموعد نشر. الافتراضي خاص للحماية.</p></div>
            <div className="flex flex-wrap gap-3"><Button onClick={save} className="bg-[#17241f] text-white"><Save className="ml-2" size={16} /> حفظ التعديلات</Button>{value.status !== "published" && <Button variant="outline" onClick={() => advance.mutate({ id })} className="border-[#ef6f51] text-[#c84d36]">المرحلة التالية <ChevronLeft className="mr-2" size={16} /></Button>}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
