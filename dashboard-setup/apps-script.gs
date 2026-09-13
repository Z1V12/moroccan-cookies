/* ============================================================================
   apps-script.gs — הקוד שמקבל נתוני שיחות/לידים מהאתר ורושם אותם בגיליון.
   הדבק אותו ב-Google Sheets ← תוספים ← Apps Script (ראה README.md לצעדים).
   אפס עלות, אפס שרת שאתה צריך לתחזק — הכל רץ על שרתי גוגל בחינם.

   ⚠ הערה חשובה על אבטחה: doPost חייב להישאר פתוח לכולם כי הוא נקרא מקוד
   ציבורי (assets/chat.js) שכל אחד יכול לראות ב-view-source של האתר — אין
   דרך "לחסום" אותו בלי שרת אמצעי, וזה לא ייחודי לכלי הזה, זה נכון לכל
   Web App ציבורי. לכן ההגנה כאן היא בקצה הקבלה: תיקוף קפדני של הקלט
   (בלי HTML, בלי ערכים לא צפויים, בלי הצפה) ולא ניסיון "להסתיר" את הכתובת.
   doGet לעומת זאת חשוף רק דרך הדאשבורד שלך — לכן הוא כן מוגן במפתח סודי
   שרק אתה יודע, כדי שמתחרה שדולה את הכתובת מקוד המקור לא יוכל לקרוא את
   כל נתוני העסק שלך (כמויות, מחירים, קצב לידים).
   ============================================================================ */

const SHEET_NAME = "leads";
const EVENT_TYPES = ["henna","engage","wedding","shabbat","bar","brit","birthday","launch","home","gift"];
const LEVELS = ["light","standard","generous"];
const MAX_STR = 40;          // אורך מקסימלי לכל שדה טקסט חופשי (src / diet)
const RATE_LIMIT_PER_MIN = 30; // תקרה גלובלית — בולמת הצפה אוטומטית, לא מזהה משתמש בודד

/* מנקה כל תו שיכול לשמש להזרקת HTML/סקריפט אם מישהו יפתח את הגיליון
   כדף אינטרנט (Publish to web) או ייבא אותו לכלי אחר, ומגביל אורך */
function sanitizeStr_(v){
  return String(v == null ? "" : v).replace(/[<>]/g, "").slice(0, MAX_STR);
}
function sanitizeNum_(v, max){
  const n = Number(v);
  if (!isFinite(n) || n < 0) return "";
  return Math.min(n, max);
}

function withinRateLimit_(){
  const cache = CacheService.getScriptCache();
  const key = "hits_" + Math.floor(Date.now() / 60000); // דלי לפי הדקה הנוכחית
  const count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 90);
  return count <= RATE_LIMIT_PER_MIN;
}

function doPost(e) {
  if (!withinRateLimit_()) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:"rate_limited"}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  let d;
  try { d = JSON.parse(e.postData.contents); } catch(err) { d = {}; }

  const eventType = EVENT_TYPES.indexOf(d.eventType) > -1 ? d.eventType : "";
  const level     = LEVELS.indexOf(d.level) > -1 ? d.level : "";

  const sheet = getSheet_();
  sheet.appendRow([
    new Date(),                       // חותמת זמן
    sanitizeStr_(d.src),               // מקור (direct/fb/wa)
    eventType,                         // רק מתוך הרשימה הסגורה — לא טקסט חופשי
    sanitizeNum_(d.guests, 5000),
    level,                              // רק מתוך הרשימה הסגורה
    sanitizeStr_(d.diet),
    sanitizeNum_(d.kg, 2000),
    sanitizeNum_(d.cost, 200000),
    d.done ? "כן" : "לא",              // האם השיחה הגיעה עד הצעה מלאה
    d.clickedWhatsApp ? "כן" : "לא"    // האם לחץ "המשך סגירה עם נציג"
  ]);

  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}

/* קריאה מוגנת במפתח: הגדר DASHBOARD_KEY אחד ב-Project Settings ← Script
   Properties (ערך אקראי משלך), והוסף ?key=הערך-שלך לכתובת שתדביק בדאשבורד.
   בלי המפתח הנכון אף אחד לא יכול לקרוא את נתוני העסק שלך, גם אם ימצא את
   הכתובת. אם לא הגדרת מפתח בכלל, doGet ימשיך לעבוד בלי בדיקה (תאימות
   לאחור) — אבל מומלץ מאוד להגדיר אחד. */
function doGet(e) {
  const requiredKey = PropertiesService.getScriptProperties().getProperty("DASHBOARD_KEY");
  if (requiredKey && (e.parameter.key !== requiredKey)) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:"unauthorized"}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift() || [];

  const items = rows.map(r => ({
    ts: r[0], src: r[1], eventType: r[2], guests: r[3], level: r[4],
    diet: r[5], kg: r[6], cost: r[7], done: r[8] === "כן", clickedWhatsApp: r[9] === "כן"
  }));

  // סיכום מוכן מראש כדי שהדאשבורד לא יצטרך לחשב הכל בצד הלקוח
  const total = items.length;
  const completed = items.filter(i => i.done).length;
  const leads = items.filter(i => i.clickedWhatsApp).length;
  const totalRevenuePotential = items.filter(i => i.done).reduce((s,i) => s + (+i.cost || 0), 0);
  const byEvent = {};
  items.forEach(i => { if (i.eventType) byEvent[i.eventType] = (byEvent[i.eventType]||0) + 1; });

  const summary = {
    total, completed, leads,
    completionRate: total ? Math.round((completed/total)*100) : 0,
    totalRevenuePotential,
    avgOrderValue: completed ? Math.round(totalRevenuePotential/completed) : 0,
    byEvent,
    recent: items.slice(-50).reverse()   // 50 השיחות האחרונות, החדש קודם
  };

  return ContentService.createTextOutput(JSON.stringify(summary))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["חותמת זמן","מקור","סוג אירוע","אורחים","רמה","תזונה","קג","מחיר","הושלם","לחץ וואטסאפ"]);
  }
  return sheet;
}
