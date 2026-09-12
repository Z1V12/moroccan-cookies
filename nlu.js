/* ============================================================================
   nlu.js — הבנת עברית חופשית, בלי שום שירות חיצוני.
   נרמול טקסט → זיהוי מספרים → זיהוי ישויות → דירוג כוונות.
   הכל רץ בדפדפן, אפס בקשות רשת, אפס עלות.
   ============================================================================ */

const NLU = (() => {

  /* ---- נרמול ---- */
  const FINALS = {"ך":"כ","ם":"מ","ן":"נ","ף":"פ","ץ":"צ"};

  function norm(t){
    return (t||"")
      .replace(/[֑-ׇ]/g,"")                 // ניקוד וטעמים
      .replace(/["“”״׳'`]/g,"")  // מרכאות, גרש וגרשיים
      .replace(/[־–—]/g,"-")           // מקפים
      .replace(/[.,!?;:()\[\]{}]/g," ")
      .replace(/\s+/g," ")
      .trim()
      .toLowerCase()
      .split("").map(ch => FINALS[ch] || ch).join("");
  }

  // הסרת קידומות (ו/ה/ב/ל/ש/כ/מ) — רק כשנשארת מילה בעלת אורך סביר
  function stem(w){
    let x = w;
    for (let i = 0; i < 2; i++){
      if (x.length > 3 && "והבלשכמ".indexOf(x[0]) > -1) x = x.slice(1); else break;
    }
    return x;
  }
  const words = t => norm(t).split(" ").filter(Boolean);
  const stems = t => words(t).map(stem);
  // כל מילה של המשתמש בשתי צורות: כפי שנכתבה, ואחרי הסרת קידומות.
  // "הגזל" צריך להתאים ל-"גזל", אבל "הובלה" אסור שיתאים ל-"בלה".
  const forms = t => words(t).map(w => (w === stem(w) ? [w] : [w, stem(w)]));
  const hit = (fs2, term, fuzzy) =>
    fs2.some(v => v === term) || (fuzzy && fs2.some(v => near(v, term)));

  /* ---- מרחק לוינשטיין לסובלנות לשגיאות כתיב ---- */
  function lev(a,b){
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    let prev = Array.from({length:b.length+1}, (_,i) => i);
    for (let i = 1; i <= a.length; i++){
      const cur = [i];
      for (let j = 1; j <= b.length; j++){
        cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // האם המילה מתאימה למונח, עם סובלנות שגדלה עם אורך המילה
  function near(w, term){
    if (w === term) return true;
    // הכלה נחשבת רק כשהמונח ארוך מספיק והמילה באמת מכילה אותו
    if (term.length >= 5 && w.length >= term.length && w.indexOf(term) > -1) return true;
    // סובלנות שגיאות רק במילים ארוכות: ב-4 אותיות "חברה" ו-"העברה" נראות זהות
    // במרחק 1 וזה יצר זיהוי כוונה שגוי, לכן מתחת ל-5 אותיות דורשים התאמה מדויקת
    const tol = term.length <= 4 ? 0 : term.length <= 6 ? 1 : 2;
    return lev(w, term) <= tol;
  }

  /* ---- מספרים בעברית ---- */
  const NUM = {
    "אפס":0,"אחד":1,"אחת":1,"שני":2,"שנים":2,"שתי":2,"שתים":2,"שלוש":3,"שלושה":3,
    "ארבע":4,"ארבעה":4,"חמש":5,"חמישה":5,"שש":6,"שישה":6,"שבע":7,"שבעה":7,
    "שמונה":8,"תשע":9,"תשעה":9,"עשר":10,"עשרה":10,"עשרים":20,"שלושים":30,
    "ארבעים":40,"חמישים":50,"שישים":60,"שבעים":70,"שמונים":80,"תשעים":90,
    "מאה":100,"מאתים":200,"מאתיים":200,"אלף":1000,"אלפיים":2000,
    "שלוש מאות":300,"ארבע מאות":400,"חמש מאות":500,
    "שש מאות":600,"שבע מאות":700,"שמונה מאות":800,"תשע מאות":900
  };

  // הטבלה נבנית מחדש מנורמלת. בלי זה אות סופית מפילה כל התאמה: norm הופכת
  // "מאתיים" ל-"מאתיימ" והמפתח המקורי כבר לא נמצא.
  const NUMN = {};
  Object.keys(NUM).forEach(k => { NUMN[norm(k)] = NUM[k]; });

  // כל המספרים בטקסט לפי הסדר. תומך ב-180, 180-200, כמאתיים, מאה וחמישים
  function numbers(t){
    const n = norm(t);
    const out = [];

    // טווח "180-200" הופך לממוצע, והקצוות לא נספרים שוב כמספרים נפרדים
    const skip = [];
    n.replace(/(\d+)\s*-\s*(\d+)/g, (m,a,b) => {
      out.push(Math.round((+a + +b)/2)); skip.push(+a, +b); return " ";
    });

    (n.match(/\d[\d,]*/g) || []).forEach(x => {
      const v = +x.replace(/,/g,"");
      if (!isNaN(v) && out.indexOf(v) === -1 && skip.indexOf(v) === -1) out.push(v);
    });

    const ws = n.split(" ");
    let acc = 0, seen = false;
    ws.forEach((w,i) => {
      // מפשיטים קידומות נפוצות: למאה, כמאתיים, ומאה, בשלושים
      const bare = w.replace(/^[ולכבמה]/,"");
      const pair = bare + " " + (ws[i+1] || "");
      const v = (NUMN[pair] != null) ? NUMN[pair]
              : (NUMN[bare] != null) ? NUMN[bare]
              : NUMN[w];
      if (v != null){ acc += v; seen = true; }
      else if (seen && w !== "ו"){ if (acc) out.push(acc); acc = 0; seen = false; }
    });
    if (acc && out.indexOf(acc) === -1) out.push(acc);

    return out;
  }

  /* ---- מילון כוונות ---- */
  const INTENTS = [
    {k:"price",     w:["מחיר","כמה עולה","עולה","עלות","תקציב","כסף","שח","שקל","יקר","זול","הצעת מחיר","תמחור"]},
    {k:"quantity",  w:["כמה","כמות","מספיק","יספיק","קילו","קג","גרם","יחידות","לאדם","לאורח"]},
    {k:"kosher",    w:["כשר","כשרות","השגחה","בדץ","רבנות","פרווה","חלבי","בשרי","פסח"]},
    {k:"gluten",    w:["גלוטן","צליאק","קמח"]},
    {k:"vegan",     w:["טבעוני","טבעונית","ויגן","צמחוני","בלי ביצים","ללא ביצים"]},
    {k:"allergy",   w:["אלרגיה","אלרגי","אגוזים","שקדים","בוטנים","שומשום","רגישות","אלרגנים"]},
    {k:"delivery",  w:["משלוח","שליח","הובלה","איסוף","להגיע","כתובת","אזור","עד הבית","מגיעים"]},
    {k:"lead",      w:["מתי","זמן","מראש","דחוף","מחר","היום","שבוע","ימים","זמינות","תאריך פנוי"]},
    {k:"storage",   w:["לשמור","שמירה","מקפיא","מקרר","טרי","מתקלקל","נשמר","מחזיק"]},
    {k:"design",    w:["עיצוב","צבע","צבעים","מגש","סרט","שילוט","נראה","מעוצב","תמונה","תמונות"]},
    {k:"payment",   w:["תשלום","לשלם","ביט","אשראי","מזומן","מקדמה","העברה","חשבונית"]},
    {k:"recommend", w:["ממליץ","המלצה","הכי טעים","מה כדאי","מה לקחת","מה שווה","פופולרי"]},
    {k:"cheaper",   w:["להוריד","לחסוך","זול יותר","פחות","להקטין","לצמצם","יותר מדי","גבוה מדי","לקצץ"]},
    {k:"human",     w:["לדבר","טלפון","בן אדם","נציג","להתקשר","וואטסאפ","ווצאפ","וצאפ"]},
    {k:"greet",     w:["שלום","היי","הי","בוקר טוב","ערב טוב","אהלן","מה נשמע","הלו"]},
    {k:"thanks",    w:["תודה","מעולה","סבבה","מדהים","יופי","אחלה","תותח"]},
    {k:"yes",       w:["כן","בטח","אוקיי","אוקי","יאללה","קדימה","נשמע טוב","בסדר","סגור"]},
    {k:"no",        w:["לא","אין","בלי","לא צריך","לא רוצה"]},
    {k:"restart",   w:["מהתחלה","להתחיל מחדש","לאפס","טעות","לשנות"]}
  ];

  function intents(t){
    const fw  = forms(t);
    const raw = norm(t);
    const hits = [];
    INTENTS.forEach(it => {
      let score = 0;
      it.w.forEach(term => {
        const tn = norm(term);
        if (tn.indexOf(" ") > -1){ if (raw.indexOf(tn) > -1) score += 2; return; }
        fw.forEach(v => {
          if (hit(v, tn, false)) score += 2;
          else if (hit(v, tn, true)) score += 1;
        });
      });
      if (score) hits.push({k:it.k, score});
    });
    return hits.sort((a,b) => b.score - a.score);
  }
  const topIntent = t => { const h = intents(t); return h.length ? h[0].k : null; };

  /* ---- ישויות ---- */
  // מילים שמופיעות בשמות אבל לא מזהות עוגייה בפני עצמן
  const WEAK = ["אל","בנת","שקדימ","קוקוס","תמרימ","חמאה","גריבה"];

  function cookie(t){
    const fw = forms(t);
    let best = null, bestScore = 0;
    DATA.cookies.forEach(c => {
      [c.n, c.r].filter(Boolean).forEach(nm => {
        let sc = 0;
        words(nm).forEach(part => {
          if (part.length < 3) return;
          const weak  = WEAK.indexOf(part) > -1;
          const exact = part.length < 4;                // חלק קצר: רק התאמה מדויקת
          fw.forEach(v => {
            if (hit(v, part, false)) sc += weak ? 1 : 3;
            else if (!weak && !exact && hit(v, part, true)) sc += 2;
          });
        });
        if (sc > bestScore){ bestScore = sc; best = c; }
      });
    });
    // דורשים התאמה ייחודית אחת לפחות, לא צירוף מקרי של מילים גנריות
    return bestScore >= 2 ? best : null;
  }

  const EVENT_WORDS = {
    henna:["חינה","חינא","חנה"], engage:["אירוסין","אירוסים","ארוסין"],
    wedding:["חתונה","חתנה","נישואין"], shabbat:["שבת חתן","שבת חתם"],
    bar:["בר מצווה","בת מצווה","מצווה","בר מצוה"], brit:["ברית","בריתה","בריט"],
    birthday:["יום הולדת","הולדת"], launch:["השקה","עסקי","כנס","אירוע חברה","משרד"],
    home:["אירוח","בבית","משפחה"], gift:["מתנה","מגש קטן"]
  };

  function eventType(t){
    const fw = forms(t), raw = norm(t);
    let best = null, bestScore = 0;
    DATA.events.forEach(ev => {
      let sc = 0;
      (EVENT_WORDS[ev.k] || []).concat([ev.l]).forEach(term => {
        const tn = norm(term);
        if (tn.indexOf(" ") > -1){ if (raw.indexOf(tn) > -1) sc += 3; return; }
        fw.forEach(v => {
          if (hit(v, tn, false)) sc += 2;
          else if (hit(v, tn, true)) sc += 1;
        });
      });
      if (sc > bestScore){ bestScore = sc; best = ev; }
    });
    return bestScore > 0 ? best : null;
  }

  const DIET_WORDS = {
    gluten:["גלוטן","צליאק","ללא גלוטן"], vegan:["טבעוני","ויגן","טבעונית"],
    parve:["פרווה","פרוה"], nuts:["אגוזים","אלרגיה לאגוזים","בוטנים"],
    dairy:["ללא חלב","בלי חלב","לקטוז"], eggs:["ללא ביצים","בלי ביצים"]
  };

  function diet(t){
    const found = [], raw = norm(t), fw = forms(t);
    Object.keys(DIET_WORDS).forEach(k => {
      DIET_WORDS[k].forEach(term => {
        const tn = norm(term);
        if (tn.indexOf(" ") > -1){
          if (raw.indexOf(tn) > -1 && found.indexOf(k) === -1) found.push(k);
          return;
        }
        fw.forEach(v => { if (hit(v, tn, true) && found.indexOf(k) === -1) found.push(k); });
      });
    });
    return found;
  }

  // תאריך → כמה שעות נותרו. תומך במחר, בעוד שבועיים, 15.3, 15/3/2026
  const NIKUD   = /[\u0591-\u05C7]/g;
  const MULTIWS = /\s+/g;

  // תאריך → כמה שעות נותרו. תומך במחר, בעוד שבועיים, 15.3, 15/3/2026
  function whenHours(t){
    // נרמול ייעודי: משמר נקודות ולוכסנים (norm המלאה הורסת "15.11"),
    // ולא ממפה אותיות סופיות (אחרת "שבועיים" לא יתאים לביטוי שבמילון).
    // עוטפים ברווחים כי \b של JS לא מזהה גבול מילה בעברית —
    // אותיות עבריות אינן \w, ולכן /\bמחר\b/ פשוט לעולם לא מתאים.
    const raw = " " + (t||"").replace(NIKUD,"")
                             .replace(/[,!?;:()]/g," ")
                             .replace(MULTIWS," ").trim() + " ";
    const H = 24;

    if (/ מחרתיים | מחרתים /.test(raw)) return 52;
    if (/ מחר /.test(raw))              return 28;
    if (/ היום /.test(raw))             return 8;
    if (/ שבועיים /.test(raw))          return 14 * H;
    if (/ חודשיים /.test(raw))          return 60 * H;

    let m = raw.match(/בעוד \s*(\d+)\s*(ימים|יום|שבועות|שבוע|חודשים|חודש)/);
    if (m){
      const n = +m[1];
      if (/יום|ימים/.test(m[2])) return n * H;
      if (/שבוע/.test(m[2]))     return n * 7 * H;
      return n * 30 * H;
    }
    if (/ בעוד שבוע /.test(raw)) return 7 * H;
    if (/ בעוד חודש /.test(raw)) return 30 * H;

    m = raw.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
    if (m){
      const now = new Date();
      const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
      const d = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && d < now) d.setFullYear(y + 1);
      const hrs = (d - now) / 36e5;
      if (hrs > 0 && hrs < 24 * 400) return Math.round(hrs);
    }
    return null;
  }

  /* ---- קריאה אחת שמחזירה את כל מה שזוהה בהודעה ---- */
  function parse(t){
    return {
      raw:     t,
      norm:    norm(t),
      intents: intents(t),
      intent:  topIntent(t),
      numbers: numbers(t),
      cookie:  cookie(t),
      event:   eventType(t),
      diet:    diet(t),
      hours:   whenHours(t)
    };
  }

  return {norm, stem, words, stems, forms, lev, near, numbers, intents, topIntent,
          cookie, eventType, diet, whenHours, parse, INTENTS};
})();

if (typeof module !== "undefined") module.exports = {NLU};
