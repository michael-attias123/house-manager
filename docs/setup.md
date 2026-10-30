# הקמה והעלאה לאוויר (הכל בחינם)

המדריך לוקח בערך 30 דקות, ועושים אותו פעם אחת. בסופו תהיה לכם כתובת קבועה לאפליקציה, ותוכלו להתקין אותה בטלפון.

| רכיב | שירות | עלות |
|---|---|---|
| מסד נתונים, התחברות וסנכרון בזמן אמת | [Supabase](https://supabase.com) – Free | חינם (500MB) |
| אחסון האתר | [Cloudflare Pages](https://pages.cloudflare.com) | חינם |
| טעינת מחירים יומית, בדיקות והעברת שינויי מבנה (migrations) | GitHub Actions | חינם |

---

## ניהול ההגדרות כקוד (מומלץ)

את ההגדרות של Cloudflare, Supabase ו-GitHub אפשר לנהל כקוד, בתיקייה [`infra/`](../infra/README.md). כל שינוי הוא PR, ה-PR מציג מראש בדיוק מה ישתנה, ואחרי merge השינוי מוחל לבד. ערך שגוי, כמו `VAPID_SUBJECT` בלי `mailto:`, נעצר לפני שהוא מגיע לשירות.

ההקמה הראשונה (bootstrap) היא כמה טוקנים, מפתח הצפנה ומקום לשמירת המצב, לפי [infra/BOOTSTRAP.md](../infra/BOOTSTRAP.md). אחריה, ההגדרות שבשלבים 1–3 ושלבי הדשבורד בסעיף 5 (המשתנים ב-Cloudflare, הסודות של הפונקציה וה-Vault ב-Supabase, וה-Secrets ב-GitHub) מנוהלים מתוך `infra/`. שינוי ידני בדשבורד של הגדרה כזו יחזור לערך שבקוד ב-apply הבא.

השלבים הידניים בהמשך נשארים כגיבוי, וגם להקמה בלי `infra/`. ידניים בכל מקרה: יצירת החשבונות והפרויקט ב-Supabase, ה-OAuth client וה-Test users ב-Google Cloud, יצירת מפתחות VAPID, ורשימת ההרשמה וההרשאות שבתוך האפליקציה.

---

## 1. יצירת פרויקט ב-Supabase

1. נרשמים ב-[supabase.com](https://supabase.com) ולוחצים **New project**.
   - **Region:** `Central EU (Frankfurt)`, הכי קרוב לישראל.
   - **Database password:** בוחרים סיסמה חזקה ושומרים אותה. נצטרך אותה בשלב 3.
2. אחרי שהפרויקט מוכן, לוחצים **Connect** (למעלה) ומעתיקים את הכתובת שמופיעה תחת **Session pooler**:
   ```
   postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```
   מחליפים את `[YOUR-PASSWORD]` בסיסמה. זו הכתובת `SUPABASE_DB_URL`.
   > חשוב להעתיק את **Session pooler** ולא את Direct connection. החיבור הישיר עובד רק ב-IPv6, ו-GitHub Actions לא תומך בזה.
3. ב-**Project Settings → API Keys** מעתיקים שני ערכים:
   - **Project URL**: `https://<ref>.supabase.co`
   - **Publishable key**: מתחיל ב-`sb_publishable_`. בפרויקט ישן משתמשים ב-`anon` key.

### כניסה עם Google

נכנסים לאפליקציה עם חשבון Google, בלי סיסמאות ובלי מיילים. ההגדרה נעשית פעם אחת, ולוקחת בערך 10 דקות.

**ב-Google Cloud:**

1. נכנסים ל-[console.cloud.google.com](https://console.cloud.google.com) עם חשבון Google, ויוצרים פרויקט חדש (למשל `house-manager`).
2. **APIs & Services → OAuth consent screen** (או **Google Auth Platform → Branding**):
   - **App name:** `ניהול הבית`, ומייל לתמיכה (המייל שלך).
   - **Audience:** `External`.
   - תחת **Test users** מוסיפים את המייל שלך ואת המייל של יהלי.
   > כל עוד האפליקציה במצב "Testing", רק המיילים ברשימה הזו יכולים להיכנס. לשניכם זה מושלם, ואין צורך באישור מ-Google. ההגבלה הזו נעלמת אם לוחצים **Publish app**, ולכן יש גם הגבלה במסד הנתונים (סוף שלב 3).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - **Application type:** `Web application`.
   - **Authorized redirect URIs:** מוסיפים `https://<ref>.supabase.co/auth/v1/callback`. ה-`<ref>` הוא מזהה הפרויקט שמופיע ב-Project URL משלב 3 למעלה.
   - לוחצים **Create** ומעתיקים את ה-**Client ID** ואת ה-**Client secret**.

**ב-Supabase:**

4. **Authentication → Sign In / Providers → Google**: מפעילים, מדביקים את ה-Client ID וה-Client secret, ושומרים.
5. **Authentication → URL Configuration**:
   - **Site URL:** הכתובת של האתר שלכם משלב 2, בצורה `https://<your-app>.pages.dev`.
   - **Redirect URLs:** מוסיפים `https://<your-app>.pages.dev/**`, `https://*.<your-app>.pages.dev/**` (לגרסאות תצוגה מקדימה) ו-`http://localhost:5173/**`.

   > ⚠️ מעתיקים את הכתובת **המדויקת** ש-Cloudflare מציג אחרי הפריסה. אם השם תפוס, Cloudflare מוסיף סיומת (למשל `house-manager-9y8.pages.dev`). כתובת לא נכונה כאן תשלח אתכם אחרי ההתחברות לאתר של מישהו אחר.

> את Site URL אפשר למלא רק אחרי שלב 2, כשיש כתובת לאתר. אפשר לחזור לכאן אחר כך.

---

## 2. העלאת האתר ל-Cloudflare Pages

1. ב-[dash.cloudflare.com](https://dash.cloudflare.com) נכנסים ל-**Workers & Pages** ולוחצים **Create application**.
2. בוחרים בלשונית **Pages**. ברירת המחדל שנפתחת היא Workers, וקל לפספס. אם הלשונית לא מופיעה, יש בתחתית הדף קישור "Looking to deploy Pages? Get started".
3. בוחרים **Connect to Git** (או **Import an existing Git repository**), מחברים את GitHub, בוחרים את הריפו `house-manager` ולוחצים **Begin setup**.
4. נפתח המסך **Set up builds and deployments**. ממלאים בו:
   | שדה | ערך |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | `pnpm build` |
   | Build output directory | `dist` |
   | Root directory | `web`. השדה מוסתר: פותחים את **Root directory (advanced)** |
5. באותו מסך, פותחים את **Environment variables (advanced)** ומוסיפים:
   | משתנה | ערך |
   |---|---|
   | `VITE_SUPABASE_URL` | ה-Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | ה-Publishable key |
   | `NODE_VERSION` | `22` |
6. לוחצים **Save and Deploy**. מעכשיו כל merge ל-`main` מעלה גרסה חדשה, וכל PR מקבל כתובת תצוגה מקדימה משלו.

**אם הפרויקט כבר נוצר:** בדף הפרויקט, **Settings → Build** להגדרות ה-build, ו-**Settings → Variables and Secrets** למשתנים. אחרי שינוי נכנסים ל-**Deployments** ולוחצים **Retry deployment** על הפריסה האחרונה, כי משתנים חדשים נכנסים רק בבנייה הבאה.

**אם בטעות נוצר Worker ולא Pages:** בדף של Worker אין את השדות האלה. הכי פשוט למחוק אותו ולהתחיל שוב משלב 2.

> מעדיפים Vercel או Netlify? גם הם חינמיים, וההגדרות זהות: תיקייה `web`, פקודה `pnpm build`, תוצר `dist`, ואותם משתני סביבה.

---

## 3. חיבור GitHub ל-Supabase

ב-GitHub נכנסים ל-**Settings → Secrets and variables → Actions → New repository secret** ומוסיפים:

| Secret | ערך |
|---|---|
| `SUPABASE_DB_URL` | כתובת ה-Session pooler משלב 1, כולל הסיסמה |

אחר כך, בלשונית **Actions**:

1. **Database migrations → Run workflow**. הפעולה יוצרת את כל הטבלאות. היא תרוץ שוב לבד בכל פעם שקובץ ב-`supabase/migrations` משתנה ב-`main`.
2. **Supermarket prices → Run workflow**. הפעולה טוענת את המחירים הראשונים. מכאן היא רצה כל בוקר ב-06:17.
3. **Places to go out → Run workflow**. הפעולה טוענת את הברים, המסעדות ובתי הקפה של באר שבע מ-OpenStreetMap למסך "יוצאים". מכאן היא רצה כל יום ראשון ב-08:37.

> אפשרות בלי GitHub: ב-Supabase פותחים את **SQL Editor** ומריצים את הקבצים ב-`supabase/migrations` לפי הסדר.

### מי יכול להירשם

בלי הגבלה, כל חשבון Google יכול ליצור משתמש באפליקציה. הנתונים שלכם מוגנים בכל מקרה, אבל עדיף לסגור את ההרשמה לכתובות שלכם. אחרי שה-migrations רצו, פותחים ב-Supabase את **SQL Editor** ומריצים, עם הכתובות שלכם באותיות קטנות:

```sql
insert into public.allowed_emails (email) values ('you@gmail.com'), ('partner@gmail.com');
```

מרגע שיש ברשימה כתובת אחת לפחות, רק הכתובות שבה יכולות ליצור משתמש. כתובת אחרת תקבל במסך הכניסה את ההודעה "הכתובת הזו לא מורשית להיכנס לאפליקציה".

- **הצגת הרשימה:** `select * from public.allowed_emails;`
- **הסרת כתובת:** `delete from public.allowed_emails where email = 'old@gmail.com';`. הבדיקה נעשית רק כשנוצר משתמש חדש, אז אם כבר נוצר משתמש לכתובת הזו, מוחקים גם אותו (ראו בהמשך).
- **רשימה ריקה** פותחת את ההרשמה לכולם. כך פרויקט חדש לא ננעל לפני שמוסיפים כתובות.
- **משתמשים שנוצרו לפני הרשימה** נשארים, ואת המיותרים מוחקים ב-Supabase, ב-**Authentication → Users**, או בלשונית **משתמשים** במסך הניהול.

אחרי שמקבלים הרשאת ניהול (הסעיף הבא), את כל זה אפשר לעשות גם מתוך האפליקציה, בלי SQL.

> ה-**Test users** של Google מגבילים רק כל עוד ה-**Publishing status** של האפליקציה הוא `Testing` (ב-**Google Auth Platform → Audience**). אחרי Publish כל חשבון Google יכול להיכנס, ולכן ההגבלה נעשית כאן, במסד הנתונים.

### הרשאת ניהול

מסך הניהול מראה את רשימת ההרשמה, את כל הבתים ואת כל המשתמשים באפליקציה, ואת עדכוני המחירים. רק חשבון שמופיע בטבלה `public.app_admins` רואה אותו. ההרשאה ניתנת רק ב-SQL, ואי אפשר לקבל אותה מתוך האפליקציה.

1. נכנסים לאפליקציה פעם אחת עם חשבון ה-Google שלכם, כדי שהמשתמש ייווצר.
2. ב-Supabase פותחים את **SQL Editor** ומריצים, עם הכתובת שלכם:
   ```sql
   insert into public.app_admins (user_id) select id from auth.users where email = 'you@gmail.com';
   ```
   לא צריך לדעת את ה-user id, כי השאילתה מוצאת אותו לפי הכתובת. אם בכל זאת רוצים לראות אותו: ב-**Authentication → Users**, בעמודה **UID**, או עם `select id, email from auth.users;`.
3. בודקים שזה עבד: `select * from public.app_admins;` מחזירה שורה עם ה-id שלכם. אם ה-insert החזיר `INSERT 0 0`, עוד לא נכנסתם לאפליקציה עם הכתובת הזו, או שיש בה טעות.
4. מרעננים את האפליקציה. בתחתית **עוד → הגדרות** מופיע הכרטיס **ניהול האפליקציה**, וממנו נכנסים למסך.

להסרת הרשאה: `delete from public.app_admins where user_id = (select id from auth.users where email = 'you@gmail.com');`.

מה יש במסך:

- **הרשמה:** הוספה והסרה של כתובות ברשימת ההרשמה. כשהרשימה ריקה, הוספת הכתובת הראשונה מוסיפה גם את הכתובת שלכם, כדי שלא תינעלו בחוץ. את הכתובת שלכם אי אפשר להסיר, וגם לא לרוקן את הרשימה מכאן. הסרה חוסמת רק הרשמה חדשה: חשבון שכבר נוצר ממשיך לעבוד עד שמוחקים אותו.
- **בתים:** כל הבתים, מי חבר בכל אחד וכמה רשומות יש בו. בית שאין בו אף חשבון פעיל מסומן "אין חשבון פעיל".
  - **הסרה מהבית:** אם נרשמו על השם הוצאות, העברות, תשלומי חשבונות או מטלות שבוצעו, השם נשאר בבית בלי חשבון, עם אותה יתרה. אם לא נרשם עליו כלום, הוא יוצא מהבית, והחלוקה בין הנשארים מתאזנת. בשני המקרים קוד ההזמנה של הבית מתחלף.
  - **מחיקת הבית:** מוחקת את הבית עם כל הרשימות, ההוצאות, החשבונות והמטלות שלו, בלי אפשרות לשחזר. את הבית שלכם אי אפשר למחוק מכאן.
- **משתמשים:** כל החשבונות, מתי נוצרו ומתי נכנסו לאחרונה. מחיקת חשבון מוציאה אותו מכל הבתים לפי אותו כלל, וכך גם מחיקה ב-**Authentication → Users**. הכתובת נשארת ברשימת ההרשמה, אז כדי לחסום הרשמה מחדש מסירים אותה גם בלשונית **הרשמה**. את החשבון שלכם, או חשבון עם הרשאת ניהול, אי אפשר למחוק מכאן.
- **מחירים:** עשרת העדכונים האחרונים, כמה סניפים ומוצרים נטענו בכל אחד, ואילו סניפים נכשלו.

> חשבון שנמחק יכול להישאר מחובר עד שהחיבור שלו פג (בדרך כלל עד שעה), אבל כבר אין לו גישה לאף בית.

---

## 4. התקנה בטלפון

- **iPhone:** פותחים את הכתובת ב-Safari, לוחצים על כפתור השיתוף ובוחרים **הוספה למסך הבית**.
- **Android:** פותחים ב-Chrome, לוחצים על תפריט ⋮ ובוחרים **התקנת אפליקציה**.

אחד מכם יוצר את "הבית". השני נכנס ובוחר **הצטרפות עם קוד**. את הקוד מוצאים במסך **עוד → הגדרות**, ויש שם גם כפתור שיתוף.

---

## 5. התראות בטלפון (רשות)

תזכורות לחשבונות ולמטלות, מה שבן/בת הזוג רשמו, וסיכום שבועי, גם כשהאפליקציה סגורה. ההתראות נשלחות דרך Supabase (Edge Function ו-`pg_net`, שניהם בחינם), וההגדרה נעשית פעם אחת. עד שמסיימים אותה, הכרטיס **התראות** בהגדרות מציג "התראות עוד לא הוגדרו".

| התראה | מה מקבלים | מתי |
|---|---|---|
| **חשבונות** | "ארנונה ₪612 בעוד 3 ימים", "חשמל לתשלום היום" (לא להוראות קבע), "הוראת קבע נרשמה: נטפליקס ₪55" | ב-08:00, וכשהוראת קבע נרשמת |
| **מטלות** | "היום: הוצאת זבל, שטיפת רצפה": מה שמוטל עליכם היום (או באיחור), או על כולם | ב-08:00 |
| **פעולות של בן/בת הזוג** | הוצאה שיש לכם חלק בה, העברה אליכם, קנייה שהסתיימה. לא על מה שאתם עצמכם רשמתם, ולא על ייבוא מ-Splitwise | מיד |
| **סיכום שבועי** | "השבוע הוצאתם ₪1,240 · יתרה לטובת יהלי ₪80" | ביום שישי ב-09:00 |
| **ניהול** (רק למנהלים) | טעינת המחירים נכשלה, או הסתיימה רק בחלקה | כשזה קורה |

כל ההתראות כבויות עד שבוחרים אותן. בין 22:00 ל-07:00 לא נשלחות התראות, ומה שקרה בלילה מגיע ב-07:30.

**1. מפתחות VAPID.** במחשב עם Node.js מריצים:
```bash
npx web-push generate-vapid-keys
```
מתקבלים שני מפתחות: **Public Key** ו-**Private Key**. את הפרטי לא שומרים בריפו ולא שולחים לאף אחד.

**2. Cloudflare Pages.** בפרויקט, **Settings → Variables and Secrets**, מוסיפים את `VITE_VAPID_PUBLIC_KEY` עם ה-Public Key, ואז ב-**Deployments** לוחצים **Retry deployment** על הפריסה האחרונה.

**3. Supabase.**
1. **Edge Functions → Secrets** (או **Project Settings → Edge Functions**), מוסיפים ארבעה ערכים:
   | Secret | ערך |
   |---|---|
   | `VAPID_PUBLIC_KEY` | ה-Public Key |
   | `VAPID_PRIVATE_KEY` | ה-Private Key |
   | `VAPID_SUBJECT` | `mailto:you@example.com`, עם המייל שלכם. שירותי ההתראות של Apple ו-Google פונים אליו אם יש בעיה |
   | `PUSH_SECRET` | מחרוזת אקראית ארוכה, למשל הפלט של `openssl rand -hex 32` |
2. **SQL Editor**: שומרים ב-Vault את כתובת הפונקציה ואת אותו `PUSH_SECRET`, כדי שמסד הנתונים יוכל לקרוא לה. ה-`<ref>` הוא מזהה הפרויקט (מה-Project URL):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-push', 'push_function_url');
   select vault.create_secret('<PUSH_SECRET>', 'push_secret');
   ```
   לשינוי ערך מאוחר יותר: `select vault.update_secret(id, '<new value>') from vault.secrets where name = 'push_secret';`.
3. **Database → Extensions**: בודקים ש-`pg_net` ו-`pg_cron` מופעלים. ה-migration מנסה להפעיל אותם לבד. אם `pg_cron` הופעל רק אחרי שה-migrations רצו, מריצים ב-SQL Editor:
   ```sql
   select cron.schedule('queue-notifications', '1 * * * *', 'select public.queue_scheduled_notifications()');
   select cron.schedule('send-push', '*/10 * * * *', 'select public.request_push_send()');
   ```

**4. GitHub**, כדי שהפונקציה `send-push` תעלה לבד. ב-**Settings → Secrets and variables → Actions** מוסיפים:
| Secret | ערך |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | טוקן מ-[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) (**Generate new token**) |
| `SUPABASE_PROJECT_REF` | ה-`<ref>` של הפרויקט |

ואז **Actions → Database migrations → Run workflow**. מעכשיו הפונקציה מתעדכנת בכל שינוי ב-`supabase/functions` ב-`main`.

> בלי GitHub: `npx supabase functions deploy send-push --project-ref <ref> --no-verify-jwt` מתוך תיקיית הריפו (דורש `npx supabase login`). מסד הנתונים קורא לפונקציה עם `PUSH_SECRET` ולא עם התחברות של משתמש, ולכן **Verify JWT** חייב להיות כבוי. אם הפונקציה נוצרה בעורך של Supabase, מכבים אותו בהגדרות שלה.

**5. בכל טלפון.**
- **iPhone:** התראות עובדות רק מהאייקון במסך הבית (שלב 4), וב-iOS 16.4 ומעלה. בלשונית ספארי רגילה הכרטיס יסביר איך להתקין.
- נכנסים ל-**עוד → הגדרות → התראות**, לוחצים **הפעלת התראות בטלפון הזה** ומאשרים.
- בוחרים אילו התראות לקבל. הבחירה חלה על כל המכשירים שלכם, וההפעלה עצמה נעשית בכל טלפון בנפרד.
- לוחצים **שליחת התראת בדיקה**. ההתראה אמורה להגיע תוך כמה שניות.

---

## 6. אם רשת מסוימת לא נטענת

חלק מאתרי המחירים חוסמים גישה מחוץ לישראל, והשרתים של GitHub נמצאים בחו"ל. ביומן של **Supermarket prices** אפשר לראות אילו רשתות נכשלו. החלופה היא להריץ את הטעינה ממחשב בבית, ל-Python 3.12:

```bash
cd ingest
python3.12 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
export SUPABASE_DB_URL="postgresql://..."   # Windows: set SUPABASE_DB_URL=postgresql://...
python -m house_ingest run --chains rami_levy,osher_ad
```

כדי שזה ירוץ כל יום:
- **Windows:** ב-Task Scheduler יוצרים משימה יומית שמריצה את הפקודה האחרונה.
- **Mac/Linux:** מוסיפים שורת `cron`.

שתי פקודות שימושיות:
- `python -m house_ingest discover`: מציגה אילו סניפים נמצאו בבאר שבע בכל רשת, בלי לכתוב כלום.
- `python -m house_ingest run --dry-run`: מורידה ומפענחת קבצים, אבל לא כותבת למסד הנתונים.

הרשתות והעיר מוגדרות ב-`ingest/config.yaml`. אפשר להוסיף רשת, להחליף עיר, או "לנעוץ" סניפים מסוימים.

### רשימת "חבר טעמים"

המקומות שמכבדים את כרטיס "חבר טעמים" נכנסו פעם אחת, מייצוא ידני של עמוד האיתור באתר חבר (`supabase/migrations/20261103000100_hever_teamim.sql`). האתר דורש התחברות וחוסם גישה אוטומטית, ולכן אין טעינה קבועה. כדי לרענן:

1. במחשב, מחוברים לאתר חבר, נכנסים לעמוד האיתור של חבר טעמים, פותחים F12 ← **Network**, ובוחרים באר שבע.
2. בבקשה שחזרה עם רשימת המסעדות: קליק ימני ← **Copy response**, ושומרים לקובץ `hever.json`.
3. `python scripts/hever-to-sql.py hever.json > rows.sql` מדפיס את השורות למיגרציה חדשה, באותו מבנה כמו הקיימת. הקובץ עצמו לא נשמר בריפו.

---

## 7. פיתוח מקומי

```bash
cd web
pnpm install
cp .env.example .env.local   # ממלאים את שני הערכים משלב 1
pnpm dev                     # http://localhost:5173
```

אפשר גם להריץ Supabase מקומי (דורש Docker): `npx supabase start`, ואז `npx supabase db reset`. בקובץ `.env.local` שמים את הכתובת והמפתח המקומיים שהפקודה מדפיסה.

הבדיקות:
- `pnpm test`: בדיקות הלוגיקה.
- `./scripts/db-test.sh`: הרצת ה-migrations ובדיקות ההרשאות על Postgres זמני.

---

## פתרון תקלות

- **"Could not find the table … in the schema cache"**: ה-migrations עוד לא רצו. מריצים את **Database migrations** בלשונית Actions.
- **לבחור דרך אחת להריץ migrations.** אם הרצתם קבצים ידנית ב-SQL Editor, הפעולה ב-GitHub תנסה להריץ אותם שוב ותיכשל. ממשיכים באותה דרך שבה התחלתם.
- **הוראות קבע לא נרשמות לבד**: הרישום האוטומטי משתמש ב-`pg_cron`. אם ההפעלה שלו ב-migration לא הצליחה, מפעילים ב-Supabase את **Integrations → Cron**, ואז מריצים ב-SQL Editor:
  ```sql
  select cron.schedule('auto-pay-due-bills', '15 4 * * *', 'select public.auto_pay_due_bills()');
  ```
- **Google מציג שגיאה בכניסה**:
  - `redirect_uri_mismatch`: הכתובת ב-Authorized redirect URIs לא זהה ל-`https://<ref>.supabase.co/auth/v1/callback`.
  - "Access blocked" / "app has not completed verification": המייל לא נמצא ברשימת Test users.
  - "הכתובת הזו לא מורשית להיכנס לאפליקציה": הכתובת לא נמצאת ב-`public.allowed_emails`. מוסיפים אותה לפי "מי יכול להירשם" בשלב 3, באותיות קטנות, או במסך הניהול, ומנסים שוב.
- **הכרטיס "ניהול האפליקציה" לא מופיע בהגדרות**: בודקים ש-`select * from public.app_admins;` מחזירה את ה-id שלכם (ראו "הרשאת ניהול" בשלב 3), ומרעננים את האפליקציה.
- **מחיקת חשבון ממסך הניהול נכשלת**: מוחקים אותו ב-Supabase, ב-**Authentication → Users**. הבתים שלו מתעדכנים באותו אופן.
  - חוזרים לאתר אבל לא מחוברים: כתובת האתר חסרה ב-Redirect URLs ב-Supabase.
  - אחרי Google מגיעים לאתר אחר: ה-Site URL או ה-Redirect URLs ב-Supabase לא תואמים לכתובת שלכם. מתקנים לפי שלב 1, ואז נכנסים לאפליקציה ולוחצים **יציאה מהחשבון** בהגדרות. היציאה מבטלת את כל החיבורים הקיימים, כולל זה שנשלח לאתר האחר.
- **ספארי מציג "Response served by service worker has redirections"**: העותק השמור של האפליקציה נמחק. ספארי מוחק נתוני אתר אחרי תקופה בלי ביקור. הגרסה הנוכחית כבר לא נתקעת על זה, ופתיחה אחת מעדכנת מכשיר שנתקע. אם זה ממשיך:
  1. הגדרות ← אפליקציות ← Safari ← מתקדם ← נתוני אתרים, ומוחקים את `pages.dev`.
  2. מוחקים את האייקון ממסך הבית.
  3. פותחים את האתר בספארי ומוסיפים אותו שוב למסך הבית.
- **הכניסה לא מצליחה, או חוזרת למסך הכניסה**: במסך הכניסה מופיעה הסיבה, ומתחתיה תג קצר באנגלית (למשל `no code verifier · home-screen app`). את התג הזה כדאי לשלוח כשמדווחים על הבעיה. הסיבות הנפוצות:
  - `no code verifier`: החזרה מ-Google הגיעה לחלון אחר מזה שבו הכניסה התחילה. באייפון זה קורה כשמתחילים מהאייקון במסך הבית, ו-iOS מחזיר את הכניסה לספארי. אפשר לבדוק אם הכניסה עובדת מלשונית ספארי רגילה. אם כן, הבעיה היא באפליקציה המותקנת, והפתרון הוא כניסה עם קוד במייל במקום Google.
  - `storage blocked`: בספארי פעילה ההגדרה „חסימת כל העוגיות” (הגדרות ← אפליקציות ← Safari). מכבים אותה.
  - `not on allowed_emails`: הכתובת לא ברשימת המורשים. ההסבר בשלב 3, "מי יכול להירשם".
  - **Google מציג `disallowed_useragent`**: הקישור נפתח בתוך אפליקציה כמו אינסטגרם. פותחים אותו בספארי.
  - **Google מציג `access_denied` או "Access blocked"**: אפליקציית Google במצב Testing, והחשבון לא ב-Test users.
- **התראות לא מגיעות**:
  1. ב-Supabase, **Edge Functions → send-push → Logs**: כל קריאה מסתיימת בשורה `send-push: N done, M to retry`. אם אין שם כלום, מסד הנתונים לא קורא לפונקציה (שלב 3 בסעיף 5).
  2. ב-SQL Editor, מה מחכה לשליחה ומה נכשל:
     ```sql
     select * from notification_outbox order by created_at desc limit 20;
     ```
     - **אין שורות**: ההתראה כבויה בהגדרות, או שהטלפון לא רשום. בודקים עם `select * from notification_prefs;` ו-`select user_id, user_agent, last_success_at from push_subscriptions;`.
     - **`sent_at` ריק ו-`attempts` = 0**: הפונקציה לא נקראה. בודקים שה-Vault מכיל את שני הערכים ו-`pg_net` מופעל, ואת תשובות הקריאות: `select status_code, content from net._http_response order by created desc limit 5;`. `401` אומר ש-`PUSH_SECRET` ב-Vault שונה מזה שבסודות של הפונקציה, ו-`404` אומר שהכתובת שגויה או שהפונקציה לא עלתה.
     - **`last_error`**: מה ששירות ההתראות ענה. `403` אחרי החלפת מפתחות VAPID: מפעילים מחדש בכל טלפון. `expired`: ההתראה חיכתה יותר מיממה ולא נשלחה.
     - **`send_after` בעתיד**: שעות שקטות, היא תצא ב-07:30.
  3. **אייפון**: ההתראות צריכות להיות מותרות ב-**הגדרות ← הודעות ← הבית**, והאפליקציה צריכה להיפתח מהאייקון.
- **הכרטיס "התראות" אומר "התראות עוד לא הוגדרו"**: חסר `VITE_VAPID_PUBLIC_KEY` ב-Cloudflare Pages, או שלא הייתה פריסה מאז שהוסף (סעיף 5, שלב 2).
- **השוואת הסלים ריקה**: בודקים ביומן של **Supermarket prices** אילו רשתות נכשלו. אם חלקן נחסמו, עוברים לסעיף 6.
