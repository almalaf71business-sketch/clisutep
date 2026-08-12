# ربط YouTube من Codespaces

هذه الأداة تستخدم ملف Web OAuth Client نفسه، وتفتح رابط Google في المتصفح ثم تستقبل callback داخل Codespaces. لا تضع ملف JSON أو أي رمز داخل Git.

## التجهيز مرة واحدة

1. انسخ ملف OAuth JSON إلى Codespaces باسم `youtube-oauth-web-client.json` داخل مجلد `damagh-masry/automation` أو شغّل السكريبت مع `YOUTUBE_OAUTH_CLIENT_FILE` بمسار الملف.
2. افتح منفذ Codespaces الذي سيشغّل عليه السكريبت، وليكن `3000`، واجعله **Public**.
3. انسخ رابط المنفذ العام وأضف `/oauth2callback` إليه. مثال:

```text
https://YOUR-CODESPACE-3000.app.github.dev/oauth2callback
```

4. أضف رابط callback نفسه حرفيًا إلى Google Cloud داخل Web OAuth Client تحت **Authorized redirect URIs**.

## التشغيل

من داخل `damagh-masry` شغّل:

```bash
PORT=3000 OAUTH_REDIRECT_URI='https://YOUR-CODESPACE-3000.app.github.dev/oauth2callback' \
node automation/oauth_codespaces.mjs
```

سيطبع السكريبت رابط تسجيل Google. افتحه، واختر الحساب الذي يملك قناة «دماغ مصري»، ثم وافق على صلاحية:

```text
https://www.googleapis.com/auth/youtube.upload
```

بعد العودة إلى Codespaces سيطبع السكريبت قيمة `refresh_token` مرة واحدة في الطرفية. لا تشاركها ولا تحفظها في ملف.

## حفظ الرمز

ضع القيمة في GitHub Repository Secret بالاسم:

```text
YOUTUBE_REFRESH_TOKEN
```

ويجب أن تكون قيم `GOOGLE_YOUTUBE_CLIENT_ID` و`GOOGLE_YOUTUBE_CLIENT_SECRET` في GitHub من نفس ملف Web OAuth Client. بعد الحفظ شغّل Workflow «دماغ مصري - Generate and upload private video». الرفع مضبوط على `Private`.

## ملاحظات أمان

ملف OAuth JSON و`refresh_token` أسرار. لا ترفعهما إلى GitHub، ولا تضعهما في Issues أو Chat أو logs. إذا ظهر رمز في السجل أو أُرسل بالخطأ، أبطله من إعدادات صلاحيات حساب Google وأنشئ رمزًا جديدًا.
