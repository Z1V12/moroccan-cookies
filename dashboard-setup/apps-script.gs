/* ============================================================================
   apps-script.gs — הקוד שמקבל נתוני שיחות/לידים מהאתר ורושם אותם בגיליון.
   הדבק אותו ב-Google Sheets ← תוספים ← Apps Script (ראה README.md לצעדים).
   אפס עלות, אפס שרת שאתה צריך לתחזק — הכל רץ על שרתי גוגל בחינם.
   ============================================================================ */

const SHEET_NAME = "leads";

function doPost(e) {
  const sheet = getSheet_();
  const d = JSON.parse(e.postData.contents);

  sheet.appendRow([
    new Date(),                 // חותמת זמן
    d.src || "",                // מקור (direct/fb/wa)
    d.eventType || "",
    d.guests || "",
    d.level || "",
    d.diet || "",
    d.kg || "",
    d.cost || "",
    d.done ? "כן" : "לא",       // האם השיחה הגיעה עד הצעה מלאה
    d.clickedWhatsApp ? "כן" : "לא"  // האם לחץ "המשך סגירה עם נציג"
  ]);

  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
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
