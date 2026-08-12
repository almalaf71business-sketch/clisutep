# متطلبات YouTube OAuth والتكامل

تمت مراجعة توثيق Google الرسمي بتاريخ 12 أغسطس 2026.

- رفع الفيديو يتم عبر YouTube Data API باستخدام OAuth 2.0؛ ملف اعتماد تطبيق الويب يحتاج client_id وclient_secret وredirect URI.
- عملية الرفع تستخدم videos.insert، وتدعم العنوان والوصف والكلمات المفتاحية وفئة الفيديو وحالة الخصوصية.
- النشر الآمن المقترح يبدأ بحالة private أو unlisted، ولا يُنشر تلقائيًا دون موافقة المستخدم.
- Google توصي بتخزين client_secret.json في مكان آمن خارج شجرة المصدر وعدم كشف رموز المصادقة في الواجهة.
- لتطبيق الويب يجب تسجيل redirect URI معتمد في Google Cloud Console. ستحتاج النسخة المنشورة إلى عنوان callback ثابت خاص بالمشروع.
- النطاق الأصغر لرفع الفيديو هو https://www.googleapis.com/auth/youtube.upload. قراءة بيانات القناة أو إدارة أوسع قد تتطلب نطاقات إضافية، لذلك يجب طلب أقل صلاحيات ممكنة.

المصادر الرسمية:
- https://developers.google.com/youtube/v3/guides/uploading_a_video
- https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- https://developers.google.com/youtube/v3/docs/videos/insert
