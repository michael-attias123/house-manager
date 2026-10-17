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

### התחברות עם קוד במייל

באפליקציה שמותקנת על מסך הבית, קישור קסם ("magic link") נפתח בדפדפן ולא באפליקציה. לכן ההתחברות היא בקוד בן 6 ספרות שמגיע במייל:

1. נכנסים ל-**Authentication → Emails → Templates → Magic Link**.
2. מחליפים את תוכן התבנית ב:
   ```html
   <h2>קוד הכניסה שלך</h2>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   <p>או <a href="{{ .ConfirmationURL }}">כניסה בקישור</a></p>
   ```
3. ב-**Authentication → URL Configuration**:
   - **Site URL:** כתובת האתר משלב 2, למשל `https://house-manager.pages.dev`.
   - **Redirect URLs:** מוסיפים `https://house-manager.pages.dev/**`, `https://*.house-manager.pages.dev/**` (לגרסאות תצוגה מקדימה) ו-`http://localhost:5173/**`.

> שירות המייל המובנה של Supabase מוגבל לכמה מיילים בשעה. זה מספיק לשני אנשים. אם צריך יותר, אפשר לחבר SMTP חינמי (למשל Resend) ב-**Authentication → Emails → SMTP Settings**.

### כניסה עם Google (רשות)

1. ב-[Google Cloud Console](https://console.cloud.google.com/apis/credentials) נכנסים ל-**Create credentials → OAuth client ID → Web application**.
2. ב-**Authorized redirect URIs** מוסיפים: `https://<ref>.supabase.co/auth/v1/callback`
3. מעתיקים את ה-Client ID וה-Client secret ל-Supabase, תחת **Authentication → Sign In / Providers → Google**, ומפעילים.

---

## 2. העלאת האתר ל-Cloudflare Pages

1. ב-[dash.cloudflare.com](https://dash.cloudflare.com) בוחרים **Workers & Pages → Create → Pages → Connect to Git**, ומחברים את הריפו `house-manager`.
2. הגדרות build:
   | שדה | ערך |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `None` |
   | Root directory | `web` |
   | Build command | `pnpm build` |
   | Build output directory | `dist` |
3. ב-**Environment variables** מוסיפים:
   | משתנה | ערך |
   |---|---|
   | `VITE_SUPABASE_URL` | ה-Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | ה-Publishable key |
   | `NODE_VERSION` | `22` |
4. לוחצים **Save and Deploy**. מעכשיו כל merge ל-`main` מעלה גרסה חדשה, וכל PR מקבל כתובת תצוגה מקדימה משלו.

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
- **הקוד לא מגיע במייל**: בודקים בתיקיית הספאם. אם זה לא שם, בודקים ב-**Authentication → Logs** אם נחסמתם ממגבלת המיילים, ומחכים שעה.
- **השוואת הסלים ריקה**: בודקים ביומן של **Supermarket prices** אילו רשתות נכשלו. אם חלקן נחסמו, עוברים לסעיף 5.
