# הקמה והעלאה לאוויר (הכל בחינם)

המדריך לוקח בערך 30 דקות, ועושים אותו פעם אחת. בסופו תהיה לכם כתובת קבועה לאפליקציה, ותוכלו להתקין אותה בטלפון.

| רכיב | שירות | עלות |
|---|---|---|
| מסד נתונים, התחברות וסנכרון בזמן אמת | [Supabase](https://supabase.com) – Free | חינם (500MB) |
| אחסון האתר | [Cloudflare Pages](https://pages.cloudflare.com) | חינם |
| טעינת מחירים יומית, בדיקות והעברת שינויי מבנה (migrations) | GitHub Actions | חינם |

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
   > כל עוד האפליקציה במצב "Testing", רק המיילים ברשימה הזו יכולים להיכנס. לשניכם זה מושלם, ואין צורך באישור מ-Google.
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

> אפשרות בלי GitHub: ב-Supabase פותחים את **SQL Editor** ומריצים את הקבצים ב-`supabase/migrations` לפי הסדר.

---

## 4. התקנה בטלפון

- **iPhone:** פותחים את הכתובת ב-Safari, לוחצים על כפתור השיתוף ובוחרים **הוספה למסך הבית**.
- **Android:** פותחים ב-Chrome, לוחצים על תפריט ⋮ ובוחרים **התקנת אפליקציה**.

אחד מכם יוצר את "הבית". השני נכנס ובוחר **הצטרפות עם קוד**. את הקוד מוצאים במסך **עוד → הגדרות**, ויש שם גם כפתור שיתוף.

---

## 5. אם רשת מסוימת לא נטענת

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

---

## 6. פיתוח מקומי

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
  - חוזרים לאתר אבל לא מחוברים: כתובת האתר חסרה ב-Redirect URLs ב-Supabase.
  - אחרי Google מגיעים לאתר אחר: ה-Site URL או ה-Redirect URLs ב-Supabase לא תואמים לכתובת שלכם. מתקנים לפי שלב 1, ואז נכנסים לאפליקציה ולוחצים **יציאה מהחשבון** בהגדרות. היציאה מבטלת את כל החיבורים הקיימים, כולל זה שנשלח לאתר האחר.
- **באייפון, האפליקציה המותקנת לא נשארת מחוברת אחרי Google**: נכנסים פעם אחת דרך ספארי, ואז מוסיפים שוב למסך הבית. אם זה עדיין לא עובד, אפשר להוסיף חזרה כניסה עם קוד במייל.
- **השוואת הסלים ריקה**: בודקים ביומן של **Supermarket prices** אילו רשתות נכשלו. אם חלקן נחסמו, עוברים לסעיף 5.
