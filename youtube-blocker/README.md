# YouTube Guard – חסימת youtube.com עם YouTube Kids פתוח

מערכת לחסימת `youtube.com` במחשב Windows, כש-`youtubekids.com` נשאר פתוח, עם שליטה מרחוק (דף ווב / n8n / API), הפעלה וכיבוי מיידיים ולוח זמנים.

שתי אפשרויות מימוש. שתיהן משתמשות באותו **שרת בקרה** (`control-server`), שרץ ב-Docker ומחזיק את המצב הרצוי:

```
            ┌──────────── שרת בקרה (Docker, :8088) ─────────────┐
 n8n / דפדפן│  מצב: חסום/פתוח · לוח זמנים · "פתח ל-30 דק׳"       │
 / curl ───▶│  REST API + דף שליטה בעברית                         │
            └───────┬───────────────────────────────┬────────────┘
     אפשרות 1       │ AdGuard API                   │ long-poll   אפשרות 2
                    ▼                               ▼
          ┌──────────────────┐              ┌─────────────────────┐
          │ AdGuard Home DNS │◀── DNS ──    │ סוכן Windows Service │
          │ חוקים לפי IP     │   מחשב       │ hosts / Firewall     │
          └──────────────────┘              └─────────────────────┘
```

## איזו אפשרות לבחור?

| | אפשרות 1 – AdGuard Home | אפשרות 2 – סוכן במחשב |
|---|---|---|
| התקנה על המחשב | רק שינוי DNS | Node.js + שירות Windows |
| עובד מחוץ לבית (לפטופ) | לא | כן (לפי מצב אחרון שהתקבל) |
| זמן תגובה להפעלה | עד כמה דקות (מטמון DNS של Windows ושל הדפדפן) | 1–2 שניות (מנקה מטמון DNS מקומי) |
| מכשירים נוספים ברשת | כן, כל מכשיר לפי IP | רק מחשבים שמותקן עליהם הסוכן |
| עמידות לעקיפה | ילד עם הרשאת מנהל יכול לשנות DNS | ילד עם הרשאת מנהל יכול לעצור שירות; עריכת hosts מתוקנת אוטומטית תוך 30 שנ׳ |

**ההמלצה:** למחשב אחד בבית – **אפשרות 2**. אם יש כמה מכשירים – אפשרות 1. הכי חזק – שתיהן יחד (אותו שרת בקרה מפעיל את שתיהן).

> **למה לא משתמשים בחסימה המובנית "YouTube" של AdGuard?** כי היא חוסמת גם את `googlevideo.com` ו-`ytimg.com`, ומשם YouTube Kids מזרים את הסרטונים והתמונות. לכן חוסמים רק את הדומיינים של האתר עצמו: `youtube.com` (כולל כל תת-הדומיינים), `youtu.be` ו-`youtube-nocookie.com`.

## מבנה התיקייה

```
youtube-blocker/
├── control-server/            שרת הבקרה המשותף (Node.js בלי תלויות)
│   ├── src/server.js          REST API + long-poll + סנכרון AdGuard
│   ├── src/store.js           מצב, מצב זמני (override), שמירה לקובץ
│   ├── src/schedule.js        לוגיקת לוח זמנים (כולל חלונות שחוצים חצות)
│   ├── src/adguard.js         לקוח AdGuard Home API
│   ├── src/adguard-cli.js     הפעלה/כיבוי ישירים של AdGuard משורת הפקודה
│   └── public/index.html      דף שליטה (עברית, מותאם לנייד)
├── option1-adguard/
│   ├── docker-compose.yml     AdGuard Home + שרת בקרה
│   ├── adguard-rules.txt      החוקים לשימוש ידני
│   ├── n8n/                   שני תהליכי n8n לייבוא
│   └── windows/set-dns.ps1    הפניית ה-DNS במחשב + ביטול DoH בדפדפנים
└── option2-agent/
    ├── docker-compose.yml     שרת בקרה בלבד
    ├── agent/                 הסוכן ל-Windows (node-windows)
    └── windows/install.ps1    התקנה כשירות בלחיצה אחת
```

---

## שלב משותף: הכנת סיסמאות (טוקנים)

על השרת (Linux) מייצרים שני טוקנים אקראיים:

```bash
openssl rand -hex 24   # ADMIN_TOKEN – לשליטה (דף הניהול, n8n)
openssl rand -hex 24   # AGENT_TOKEN – לסוכן במחשב (קריאת מצב בלבד)
```

הסוכן מקבל רק את `AGENT_TOKEN`, שמאפשר לקרוא מצב ולא לשנות אותו. גם אם הילד מגיע לטוקן הזה, הוא לא יכול לפתוח את החסימה בעזרתו.

---

## אפשרות 1: AdGuard Home (DNS)

### 1. נותנים למחשב IP קבוע
בראוטר מגדירים **DHCP Reservation** למחשב (לדוגמה `192.168.1.50`). החוקים ב-AdGuard מזהים את המחשב לפי ה-IP.

### 2. מרימים את הקונטיינרים
```bash
cd youtube-blocker/option1-adguard
cp .env.example .env
nano .env        # ADMIN_TOKEN, ADGUARD_PASSWORD, ADGUARD_CLIENTS=192.168.1.50
docker compose up -d adguardhome
```

> **פורט 53 תפוס?** ב-Ubuntu, `systemd-resolved` מחזיק את פורט 53. מוסיפים את השורה `DNSStubListener=no` לקובץ `/etc/systemd/resolved.conf` ומריצים `sudo systemctl restart systemd-resolved`.
>
> **Docker Desktop (Windows/Mac):** שם AdGuard רואה את כל הבקשות מכתובת אחת, וחוקי `$client` לא יעבדו. צריך להריץ על שרת Linux.

### 3. אשף ההתקנה של AdGuard
פותחים את `http://<IP-השרת>:3000`:
- **Admin Web Interface** → פורט **80** (בתוך הקונטיינר. מבחוץ הוא ממופה ל-8080).
- **DNS server** → פורט **53**.
- שם משתמש וסיסמה – אותם ערכים שהוכנסו ל-`.env`.

### 4. מפעילים את שרת הבקרה
```bash
docker compose up -d --build control-server
docker compose logs -f control-server   # מחכים לשורה: [adguard] rules updated
```
שרת הבקרה כותב את החוקים לבלוק מסומן בתוך *Filters → Custom filtering rules* ומעדכן רק אותו. חוקים אחרים שיש שם לא נפגעים. כך החוקים נראים במצב חסום:
```
! >>> youtube-guard (managed automatically - do not edit) >>>
||youtube.com^$client=192.168.1.50
||youtu.be^$client=192.168.1.50
||youtube-nocookie.com^$client=192.168.1.50
@@||youtubekids.com^$client=192.168.1.50
@@||accounts.youtube.com^$client=192.168.1.50
! <<< youtube-guard <<<
```
`||youtube.com^` חוסם גם את `www.`, `m.`, `music.` ו-`studio.`. החריגה ל-`accounts.youtube.com` משאירה את ההתחברות לחשבון Google עובדת (גם ב-YouTube Kids).

### 5. מפנים את המחשב ל-AdGuard
יש שתי דרכים:
- **בראוטר (מומלץ):** מגדירים את ה-IP של השרת כשרת ה-DNS ב-DHCP. בגלל חוקי `$client`, רק המחשב המוגבל נחסם.
- **במחשב עצמו:** מריצים PowerShell כמנהל:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\set-dns.ps1 -DnsServer 192.168.1.10
  # אם הראוטר מחלק גם DNS ב-IPv6:
  powershell -ExecutionPolicy Bypass -File .\set-dns.ps1 -DnsServer 192.168.1.10 -DisableIPv6
  ```
  הסקריפט גם מבטל ב-Policy את ה-DNS-over-HTTPS של Chrome, Edge, Brave ו-Firefox. בלי זה הדפדפן יכול לעקוף את AdGuard.

### 6. בדיקה
```powershell
nslookup youtube.com        # במצב חסום: 0.0.0.0
nslookup youtubekids.com    # כתובת אמיתית
```

### 7. שליטה
- **דף שליטה:** `http://<IP-השרת>:8088` → מכניסים את `ADMIN_TOKEN`.
- **בלי שרת הבקרה (ישירות מול AdGuard):**
  ```bash
  docker compose exec control-server node src/adguard-cli.js block    # או allow / status
  ```
- **n8n:** בהמשך המסמך.

### מבנה ה-API של AdGuard (למי שרוצה לכתוב בעצמו)
| פעולה | קריאה |
|---|---|
| קריאת החוקים | `GET /control/filtering/status` → השדה `user_rules` (מערך) |
| כתיבת החוקים | `POST /control/filtering/set_rules` עם `{"rules": ["...", "..."]}` |
| אימות | Basic Auth עם המשתמש והסיסמה של AdGuard |

`set_rules` מחליף את **כל** רשימת החוקים, ולכן תמיד קוראים קודם, מעדכנים רק את הבלוק המסומן וכותבים בחזרה. ככה עובדים `src/adguard.js` ותהליך ה-n8n הישיר.

---

## אפשרות 2: סוכן Windows (Node.js)

### מה הסוכן עושה
- רץ כ-**Windows Service** בהרשאות SYSTEM (נוצר עם node-windows), עולה עם Windows ומופעל מחדש אם הוא קורס.
- **תקשורת:** Long-polling מול שרת הבקרה. הבקשה נשארת פתוחה עד 25 שניות וחוזרת **מיד** כשהמצב משתנה. התוצאה היא תגובה בזמן אמת בלי לפתוח פורט במחשב של הילד, וזה עובד גם מאחורי NAT.
- **חסימה בקובץ hosts:** הסוכן מוסיף בלוק מסומן עם `0.0.0.0` ו-`::` לכל תת-דומיין של YouTube, ואז מריץ `ipconfig /flushdns`. `youtubekids.com` לא נכלל בבלוק.
- **Windows Firewall:**
  - *DoH guard* (פעיל כברירת מחדל): חוסם את פורט 853 ואת שרתי DNS-over-HTTPS הציבוריים (Google, Cloudflare, Quad9 ואחרים), כדי שאי אפשר יהיה לעקוף את קובץ ה-hosts.
  - *חסימת IP של יוטיוב* (`"method": "firewall"` או `"both"`, **ניסיוני**): ה-Firewall מבין רק כתובות IP, ויוטיוב רץ על אותן כתובות של Google שמשמשות גם את YouTube Kids. חסימה כזו כנראה תחסום גם את Kids. מתאים רק למי שרוצה לחסום הכל.
- **תיקון עצמי:** כל 30 שניות הסוכן בודק את קובץ ה-hosts ומחזיר את החסימה אם מישהו מחק אותה.
- **בלי חיבור לשרת:** ממשיך לפי המצב האחרון שהתקבל (`offlineFallback: "last"`). אם עוד לא התקבל מצב, הוא **חוסם**.
- **דיווח:** שולח heartbeat לשרת, ודף השליטה מציג מתי המחשב נראה לאחרונה ובאיזה מצב הוא.

### 1. שרת הבקרה (על השרת המקומי)
```bash
cd youtube-blocker/option2-agent
cp .env.example .env && nano .env      # ADMIN_TOKEN + AGENT_TOKEN
docker compose up -d --build
curl http://localhost:8088/healthz     # {"ok":true}
```

### 2. התקנה על מחשב ה-Windows
1. מתקינים **Node.js LTS** (גרסה 20 ומעלה) מ-nodejs.org.
2. מעתיקים למחשב את התיקייה `youtube-blocker/option2-agent`.
3. פותחים PowerShell **כמנהל**:
   ```powershell
   cd C:\path\to\option2-agent\windows
   powershell -ExecutionPolicy Bypass -File .\install.ps1 `
     -ServerUrl http://192.168.1.10:8088 -AgentToken <AGENT_TOKEN>
   ```
   הסקריפט:
   - מעתיק את הסוכן ל-`C:\ProgramData\YouTubeGuard`
   - מריץ `npm install`
   - יוצר `config.json`
   - רושם את השירות `YouTubeGuard` ומפעיל אותו
   - נועל את התיקייה כך שרק SYSTEM ומנהלים יכולים לגשת אליה
4. בדיקה:
   ```powershell
   Get-Service YouTubeGuard
   Get-Content C:\ProgramData\YouTubeGuard\logs\agent.log -Tail 20
   ```
   בדף השליטה המחשב אמור להופיע תחת "מחשבים מחוברים".

### הגדרות (`config.json`)
| שדה | ברירת מחדל | הסבר |
|---|---|---|
| `serverUrl` | – | כתובת שרת הבקרה |
| `agentToken` | – | הטוקן `AGENT_TOKEN` |
| `method` | `hosts` | `hosts` / `firewall` / `both` |
| `dohGuard` | `true` | חוקי Firewall נגד DNS מוצפן ציבורי |
| `enforceBrowserPolicies` | `true` | מבטל ב-Policy את ה-DoH בדפדפנים |
| `offlineFallback` | `last` | מה עושים כשאין חיבור לשרת: `last` / `block` / `allow` |
| `killBrowsersOnBlock` | `false` | סוגר את הדפדפנים ברגע החסימה, כדי שטאב יוטיוב פתוח לא ימשיך לנגן |
| `enforceSeconds` | `30` | כל כמה שניות מתקנים את קובץ ה-hosts |
| `blockDomains` | רשימת יוטיוב | דומיינים לחסימה (בלי wildcards) |

אחרי שינוי בהגדרות: `Restart-Service YouTubeGuard`.

### הסרה
```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveFiles
```
ההסרה מנקה גם את קובץ ה-hosts, את חוקי ה-Firewall ואת ה-Policies.

---

## API של שרת הבקרה

כל הקריאות דורשות את הכותרת `Authorization: Bearer <ADMIN_TOKEN>`.

| פעולה | קריאה | גוף (JSON) |
|---|---|---|
| מצב מלא | `GET /api/status` | – |
| חסום לזמן מוגבל | `POST /api/block` | `{"minutes": 120}` |
| פתח לזמן מוגבל | `POST /api/allow` | `{"minutes": 30}` |
| ביטול שינוי זמני | `POST /api/auto` | – |
| מצב קבוע | `POST /api/mode` | `{"mode": "schedule" \| "block" \| "allow"}` |
| קריאת לוח זמנים | `GET /api/schedule` | – |
| עדכון לוח זמנים | `PUT /api/schedule` | ראו למטה |
| סנכרון AdGuard מיידי | `POST /api/adguard/sync` | – |

קריאות של הסוכן (עם `AGENT_TOKEN`): `GET /api/agent/state?since=<version>&wait=25` ו-`POST /api/agent/heartbeat`.

דוגמאות:
```bash
T=<ADMIN_TOKEN>; S=http://192.168.1.10:8088
curl -X POST $S/api/allow -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"minutes":30}'
curl -X POST $S/api/auto  -H "Authorization: Bearer $T"
curl        $S/api/status -H "Authorization: Bearer $T"
```

### לוח זמנים
```json
{
  "timezone": "Asia/Jerusalem",
  "default": "block",
  "windows": [
    { "label": "אחרי הצהריים", "days": [0,1,2,3,4], "from": "16:00", "to": "17:30" },
    { "label": "שישי",          "days": [5],         "from": "10:00", "to": "12:00" }
  ]
}
```
- `days`: 0 = ראשון, 6 = שבת.
- `default: "block"` = חסום כל הזמן, חוץ מהחלונות. `default: "allow"` = פתוח, חוץ מהחלונות.
- חלון שבו `from` מאוחר מ-`to` (למשל `22:00`–`07:00`) נמשך עד אחרי חצות.
- סדר העדיפויות: **שינוי זמני** (block/allow לכמה דקות) → **מצב קבוע** (block/allow) → **לוח זמנים**.

את לוח הזמנים אפשר לערוך גם ישירות בדף השליטה.

---

## n8n

בתיקייה `option1-adguard/n8n` יש שני תהליכים לייבוא (*Workflows → Import from File*):

1. **`youtube-guard-remote-control.json`** – Webhook ‏`GET /webhook/youtube?action=allow&minutes=30` שמעביר את הפעולה לשרת הבקרה. מתאים לשתי האפשרויות.
   - פעולות: `block`, `allow`, `auto`, `always_block`, `always_allow`, `schedule`, `status`
   - אחרי הייבוא: מחליפים את `192.168.1.10` ואת `REPLACE_WITH_ADMIN_TOKEN` (עדיף דרך Header Auth Credential), ומגדירים אימות על ה-Webhook עצמו.
   - אפשר לחבר אותו לבוט טלגרם או וואטסאפ, לקיצור דרך באייפון וכדומה.
2. **`youtube-guard-adguard-direct.json`** – לאפשרות 1 **בלי** שרת הבקרה. Schedule כל דקה → חישוב המצב לפי לוח זמנים שמוגדר בקוד → `GET /control/filtering/status` → מיזוג החוקים → `POST /control/filtering/set_rules` (רק אם משהו השתנה).
   - אחרי הייבוא: יוצרים Basic Auth Credential עם המשתמש של AdGuard, ומעדכנים את ה-IP של השרת, את ה-IP של המחשב ואת לוח הזמנים בצמתי ה-Code.
   - **לא מריצים אותו ביחד עם שרת הבקרה**, כי שניהם כותבים לאותו בלוק חוקים.

---

## מגבלות ועקיפות – חשוב לדעת

- **טאב פתוח:** סרטון שכבר מתנגן יכול להמשיך עד שהדף נטען מחדש, כי חיבור קיים לא נחתך. באפשרות 2 אפשר להגדיר `killBrowsersOnBlock: true`.
- **מטמון DNS:** באפשרות 1 החסימה נכנסת לתוקף אחרי שפג תוקף הרשומה במטמון של Windows והדפדפן (בדרך כלל עד כמה דקות). באפשרות 2 זה מיידי.
- **הרשאות מנהל:** חשבון של ילד צריך להיות **משתמש רגיל** (Standard User). מנהל יכול לשנות DNS, לעצור שירות או לערוך את קובץ ה-hosts.
- **VPN, פרוקסי, Tor, נקודה חמה מהטלפון:** עוקפים חסימת DNS. אפשרות 2 עם קובץ hosts עמידה יותר, כי היא פועלת במחשב עצמו.
- **IPv6:** באפשרות 1, אם הראוטר מחלק שרת DNS ב-IPv6, צריך להגדיר אותו גם ב-AdGuard או להשתמש ב-`-DisableIPv6`.
- **YouTube Kids:** נטען מ-`youtubekids.com`, ואת הסרטונים מזרים מ-`googlevideo.com`. אם בעתיד משהו ב-Kids ייחסם, בודקים בלוג השאילתות של AdGuard (*Query Log*) איזה דומיין נחסם, ומוסיפים אותו ל-`ALLOW_DOMAINS`.
- **אפליקציית YouTube מה-Store / PWA:** משתמשת באותם דומיינים ונחסמת באותה צורה.

## פיתוח ובדיקות
```bash
cd control-server && npm test              # לוח זמנים, AdGuard (מול שרת דמה), API מקצה לקצה
cd option2-agent/agent && node --test       # לוגיקת hosts
```
