# Smart App Control — لماذا لا يفتح المثبّت؟

## ما الذي يحدث؟

**Smart App Control (SAC)** في ويندوز 11 يمنع تشغيل ملفات **غير موقّعة رقمياً** (مثل `Galaxy Cashier Setup.exe` و `CASR.exe` بعد البناء بدون شهادة).

هذا **ليس عطل في البرنامج** — ويندوز يعتبر أي `.exe` جديد من مطوّر غير موثّق **غير موثوق** حتى يُوقَّع بش sertificat Code Signing.

> **SmartScreen** («More info → Run anyway») ≠ **Smart App Control**.  
> SAC أشد: غالباً **لا يوجد** زر «تشغيل على أي حال» للملف نفسه.

---

## للعميل (حل مؤقت — للتجربة أو محل واحد)

**الخيار 1 — إيقاف SAC (الأcommon للمحلات)**

1. **الإعدادات** → **الخصوصية والأمان** → **أمان Windows**
2. **التحكم في التطبيقات والمتصفح** → **Smart App Control**
3. اختر **Off** (إيقاف)

⚠️ بعد إيقاف SAC **لا يمكن** إعادة تشغيله بسهولة على نفس الجهاز (سياسة مايكروسوft). استخدمه فقط إذا العميل موافق.

**الخيار 2 — جهاز بدون SAC**

- بعض أجهزة ويندوز 11 Pro/Home **بدون** SAC مفعّل (Evaluation mode أو إعداد مصنع).
- جرّب التثبيت على جهاز آخر للتأكد أن الملف سليم.

**الخيار 3 — انتظر الحل الدائم**

- Galaxy Digital توزّع نسخة **موقّعة رقمياً** (انظر أدناه).

---

## لـ Galaxy Digital (الحل الدائم للتوزيع)

### 1. شهادة Code Signing (موصى به)

اشتري **Authenticode** certificate من:

- Sectigo / DigiCert / SSL.com (Standard OV أو EV)

بعد الحصول على `.pfx`:

1. وقّع المثبّت و `CASR.exe` / `Galaxy Cashier.exe` بـ **signtool** (Windows SDK)
2. أو اربط الشهادة في **electron-builder** (`certificateFile` + `certificatePassword`)

ثم أعد البناء — SAC و SmartScreen يثقان تدريجياً بالملف.

### 2. بناء المثبّت الصحيح

تأكد أن الملف المُرسَل هو:

`Galaxy Cashier Setup 1.0.0.exe`

وليس ملف `.7z` أو portable قديم باسم `CASR 1.0.0.exe` فقط.

```powershell
cd E:\CASR\apps\desktop
powershell -ExecutionPolicy Bypass -File build-installer.ps1
```

### 3. سمعة مايكروسوفت (بطيء)

رفع الملف لعدد كافٍ من المستخدمين + توقيع يساعد على **Reputation** — لكن **لا تعتمد** عليه وحدك مع SAC.

---

## ملخص

| الوضع | النتيجة |
|--------|---------|
| exe **بدون توقيع** + SAC **On** | ❌ غالباً لا يفتح / blocked |
| exe **بدون توقيع** + SAC **Off** | ✅ يعمل (تجريب / محلات محدودة) |
| exe **موقّع** Code Signing | ✅ مناسب للعملاء |

---

## دعم العميل — جملة جاهزة

«البرنامج جديد ولم يُوقَّع بعد من مايكروسوфт. إمّا نوقّف Smart App Control مؤقتاً للتثبيت، أو نوفّر لكم نسخة موقّعة من Galaxy Digital.»
