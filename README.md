# موقع تحميل فيديو فيسبوك (بنغالي)

## التشغيل
1. ثبّت Node.js (الإصدار 18 أو أحدث).
2. في مجلد المشروع: `npm start` ثم افتح http://localhost:3000
(لا توجد حزم تحتاج تثبيت).

## النشر
- أي استضافة Node.js (VPS أو Render أو Railway). أمر التشغيل: `npm start`. المتغير PORT اختياري.
- ضع الموقع خلف HTTPS (Nginx أو Cloudflare).

## قبل النشر
- استبدل `https://example.com` بنطاقك في `public/sitemap.xml` و`public/robots.txt` وفي وسوم canonical.
- استبدل `contact@example.com` و`dmca@example.com` ببريدك (في ملفات privacy/dmca/contact).

## هيكل الملفات
- `server.js`: الخادم وواجهة API (`/api/info` لاستخراج الروابط، و`/api/download` لتنزيل الفيديو عبر الخادم).
- `public/`: صفحات HTML و`css/style.css` و`js/app.js`.

## ملاحظات
- يعمل مع الفيديوهات العامة فقط. فيسبوك يغيّر صفحاته من وقت لآخر، فإن توقف الاستخراج عدّل دالة `info` في `server.js` (قوائم المفاتيح داخل `pick`).
- الحد الأقصى 20 طلبًا في الدقيقة لكل IP.
- الأداة للاستخدام الشخصي. راجع شروط فيسبوك والقوانين المحلية قبل أي استخدام تجاري.
