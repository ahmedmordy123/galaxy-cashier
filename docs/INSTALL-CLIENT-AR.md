# تثبيت جالاكسي كاشير على ويندوز (للعميل)

## ما الذي تستلمه؟

ملف واحد اسمه تقريباً:

**`Galaxy Cashier Setup 1.0.0.exe`**

(من مجلد `apps\desktop\dist\` بعد البناء عند Galaxy Digital)

---

## خطوات التثبيت (Next → Next)

1. دبل-كليك على **`Galaxy Cashier Setup … .exe`**
2. **Smart App Control (ويندوز 11):** إذا ظهر أن التطبيق **محظور** ولا يوجد «تشغيل» — راجع **`docs/SMART-APP-CONTROL-AR.md`** (إيقاف SAC مؤقتاً أو استخدام نسخة موقّعة).
3. **SmartScreen** (تنبيه مختلف): **More info** → **Run anyway** إن ظهر.
4. إذا طلب **صلاحية المدير (UAC)** → **Yes** (مرة واحدة أثناء التثبيت فقط)
5. في المعالج:
   - **Next**
   - (اختياري) غيّر مجلد التثبيت أو اترك الافتراضي → **Next**
   - **Install**
   - **Finish** (يمكن تشغيل البرنامج مباشرة)

6. بعد التثبيت: أيقونة **جالاكسي كاشير** على **سطح المكتب** وفي **قائمة ابدأ**

---

## التشغيل اليومي

- **دبل-كليك** على الأيقونة — **بدون** فتح Chrome أو Edge
- شاشة تحميل قصيرة ثم تسجيل الدخول
- الدخول الافتراضي أول مرة: `admin` / `admin123` — **غيّر كلمة المرور فوراً**

---

## للفريق التقني (Galaxy Digital) — بناء ملف التثبيت

```powershell
cd E:\CASR
npm install
cd apps\desktop
powershell -ExecutionPolicy Bypass -File build-installer.ps1
```

الملف الجاهز للعميل: `apps\desktop\dist\Galaxy Cashier Setup 1.0.0.exe`

نسخة portable (بدون معالج تثبيت): `npm run build:portable` من `apps\desktop` بعد `build.ps1`.

---

## إزالة التثبيت

**إعدادات ويندوز → التطبيقات → Galaxy Cashier — جالاكسي كاشير → Uninstall**

البيانات تبقى في `%AppData%\CASR\` ما لم تُحذف يدوياً.
