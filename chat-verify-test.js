/* ============================================================================
   chat.js — יועץ המגשים. ניהול שיחה + ממשק.
   בלי AI חיצוני: NLU מקומי + מנוע חוקים + תסריט שיחה.
   אפס בקשות רשת, אפס עלות חודשית.
   ============================================================================ */

const CHAT = (() => {

  const q  = s => document.querySelector(s);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls)  e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const ils  = n => "₪" + Math.round(n).toLocaleString("he-IL");
  const esc  = t => String(t).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

  /* ---- מצב השיחה ---- */
  const KEY = "mc_chat_v1";
  let S = null;

  const blank = () => ({
    slots: {eventType:null, guests:null, budget:null, hours:null,
            duration:null, role:null, seating:null, daypart:null, level:null,
            kidsPct:null, diet:null, likes:[]},
    log: [], step: 0, done: false, src: srcParam(), started: Date.now()
  });

  function srcParam(){
    const m = location.search.match(/[?&]src=([a-z]+)/i);
    return m ? m[1].toLowerCase() : "direct";
  }

  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){}
  }
  function load(){
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      // שיחה בת יותר מ-14 יום כבר לא רלוונטית
      if (!v.started || Date.now() - v.started > 14*864e5) return null;
      return v;
    } catch(e){ return null; }
  }

  /* ---- שאלות התסריט ---- */
  const STEPS = [
    {slot:"eventType", q:["איזה אירוע אתם עושים?","ספרו לי על האירוע — מה חוגגים?"],
     chips: () => DATA.events.filter(e => e.k !== "gift").map(e => ({t:e.l, v:e.k}))},

    {slot:"guests", q:["כמה אורחים בערך?","כמה אנשים מוזמנים? מספר גס מספיק לי."],
     chips: () => [30,60,100,150,250,400].map(n => ({t:n + " אורחים", v:n}))},

    {slot:"level", q:["איזה שולחן אתם רוצים — קליל וחסכוני, סטנדרטי, או עשיר ומרשים? זה גם משפיע על הכמות שאמליץ."],
     chips: () => DATA.engine.level.map(r => ({t:r.l, v:r.k}))},

    {slot:"hours", q:["מתי האירוע?","באיזה תאריך זה?"],
     chips: () => [{t:"בעוד שבוע", v:168}, {t:"בעוד שבועיים", v:336},
                   {t:"בעוד חודש", v:720}, {t:"עוד לא סגור", v:-1}]},

    {slot:"budget", q:["יש תקציב שאתם רוצים לא לחרוג ממנו? (אפשר גם לדלג)"],
     chips: () => [{t:"עוד לא יודע", v:-1}, {t:"עד ₪800", v:800},
                   {t:"עד ₪1,500", v:1500}, {t:"עד ₪3,000", v:3000}]},

    {slot:"diet", q:["יש מגבלות תזונה שחשוב שאדע? (גלוטן, טבעוני, אלרגיות)"],
     chips: () => [{t:"אין מגבלות", v:"none"}, {t:"ללא גלוטן", v:"gluten"},
                   {t:"טבעוני", v:"vegan"}, {t:"ללא אגוזים", v:"nuts"}],
     multi: true}
  ];

  const nextStep = () => STEPS.find(s => {
    const v = S.slots[s.slot];
    return v === null || v === undefined;
  });

  // כמה שאלות כבר נענו — כדי להראות פס התקדמות במקום חקירה בלי סוף
  function updateProgress(){
    if (!progressBar || !S) return;
    const filled = STEPS.filter(st => {
      const v = S.slots[st.slot];
      return st.slot === "diet" ? Array.isArray(v) : (v !== null && v !== undefined);
    }).length;
    const pct = S.done ? 100 : Math.round((filled / STEPS.length) * 100);
    progressBar.style.width = pct + "%";
    progressEl.classList.toggle("done", !!S.done);
  }

  // הרמז "אפשר גם לכתוב חופשי" נעלם אחרי ההודעה הראשונה של הלקוח —
  // מי שכבר הקליד פעם אחת לא צריך תזכורת שוב
  function hideHint(){ if (hintEl) hintEl.classList.add("hidden"); }

  /* ==========================================================================
     שכבת הידע — כל תשובה נגזרת מ-DATA, כדי שעדכון מחיר במסך הניהול
     ישתקף מיד גם בצ'אט. אין כאן טקסטים שמשכפלים נתונים.
     ========================================================================== */
  const list = a => a.join(", ");

  const KNOW = {
    price(p){
      if (p.cookie){
        const c = p.cookie;
        return `${c.n} — ${c.p} לק״ג, ${c.u}. ${c.s}`;
      }
      const lo = Math.min.apply(null, DATA.cookies.map(c => c.pk));
      const hi = Math.max.apply(null, DATA.cookies.map(c => c.pk));
      const packs = DATA.packs.map(k => `${k.name} ${k.unit} — ${ils(k.price)}`);
      return `המחיר לק״ג נע בין ${ils(lo)} ל-${ils(hi)}, תלוי בעוגייה — המטוגנות זולות יותר, ` +
             `עוגיות השקדים יקרות יותר.<br>המגשים המוכנים: ${list(packs)}.<br>` +
             `תנו לי אירוע ומספר אורחים ואבנה לכם הצעה מדויקת עם מחיר.`;
    },

    quantity(){
      return "זו בדיוק השאלה שאני קיים בשבילה. הכלל הוא לא מספר קבוע — הוא תלוי בסוג האירוע, " +
             "כמה זמן הוא נמשך, ואם יש עוד קינוחים על השולחן. תגידו לי אירוע ומספר אורחים ואחשב לכם.";
    },

    kosher(){
      const f = DATA.faqs.find(x => /כשר/.test(x[0]));
      return f ? f[1] : "אופים במטבח כשר בהשגחה.";
    },

    gluten(){
      const ok = DATA.cookies.filter(c => (c.g||[]).some(g => g.indexOf("ללא גלוטן") === 0));
      if (!ok.length) return "כרגע אין לנו עוגייה ללא גלוטן בקטלוג — שווה לשאול אותנו ישירות.";
      return `ללא גלוטן יש: ${list(ok.map(c => c.n))}.<br>` +
             `חשוב שתדעו: המטבח מטפל בקמח ובאגוזים, אז אין הפרדה מלאה למי שיש לו רגישות חמורה.`;
    },

    vegan(){
      const ok = DATA.cookies.filter(c => (c.g||[]).some(g => g.indexOf("טבעוני") === 0));
      return ok.length
        ? `טבעוניות: ${list(ok.map(c => c.n))}. אפשר לבנות מגש שלם רק מהן.`
        : "אין לנו כרגע גרסה טבעונית מלאה בקטלוג.";
    },

    allergy(p){
      if (p.cookie) return `${p.cookie.n}: ${p.cookie.al}`;
      const noNuts = DATA.cookies.filter(c => !/שקד|אגוז|בוטן/.test(c.al));
      return `בלי אגוזים ושקדים: ${list(noNuts.map(c => c.n))}.<br>` +
             `לכל עוגייה בקטלוג רשומים האלרגנים המלאים — ואם יש אלרגיה חמורה, ` +
             `כדאי לדבר איתנו לפני ההזמנה כי המטבח משותף.`;
    },

    delivery(){
      const f = DATA.faqs.find(x => /משלוח|משלמים/.test(x[0]));
      return (f ? f[1] + "<br>" : "") + `אנחנו מגיעים ל: ${list(DATA.biz.areas)}.`;
    },

    lead(){
      const f = DATA.faqs.find(x => /מראש/.test(x[0]));
      const fastest = Math.min.apply(null, DATA.cookies.map(c => c.prh || 48));
      return (f ? f[1] : "") + `<br>הזמן המינימלי לעוגייה הכי מהירה שלנו הוא ${fastest} שעות.`;
    },

    storage(){
      const f = DATA.faqs.find(x => /שומרים/.test(x[0]));
      const longest = DATA.cookies.slice().sort((a,b) => (b.kp||"").length - (a.kp||"").length)[0];
      return (f ? f[1] : "") + (longest ? `<br>לדוגמה, ${longest.n} נשמרת ${longest.kp}.` : "");
    },

    design(){
      const f = DATA.faqs.find(x => /צבע/.test(x[0]));
      return f ? f[1] : "מתאימים את המגש לצבעי האירוע.";
    },

    payment(){
      const f = DATA.faqs.find(x => /משלמים/.test(x[0]));
      return f ? f[1] : `מקדמה של ${DATA.biz.depositPct}% לתפיסת התאריך, השאר במסירה.`;
    },

    recommend(){
      const stars = DATA.cookies.filter(c => c.tag).slice(0,3);
      const src = stars.length ? stars : DATA.cookies.slice(0,3);
      return `אם אתם שואלים אותי:<br>` +
             src.map(c => `<b>${c.n}</b> — ${c.s}`).join("<br>") +
             `<br>אבל ההמלצה האמיתית תלויה באירוע שלכם. בואו נבנה מגש.`;
    },

    cookie(p){
      const c = p.cookie;
      return `<b>${c.n}</b> (${c.r})<br>${c.d}<br>` +
             `מרקם: ${c.tx} · נשמרת ${c.kp} · ${c.u} · ${c.p} לק״ג<br>` +
             `<span class="warn-inline">אלרגנים: ${c.al}</span>`;
    },

    // התשובה ללקוח שרוצה להוריד כמות — הבעיה העסקית שהמערכת נבנתה בשבילה
    cheaper(){
      return "אני מבין, ואני גם לא אנסה למכור לכם יותר ממה שצריך. " +
             "רק שתדעו מה קורה בפועל: מגש שנגמר באמצע האירוע הוא הדבר היחיד שאורחים זוכרים ממנו. " +
             "אנשים לוקחים הרבה יותר ממה שמחשבים — לוקחים לילדים, לוקחים הביתה, וחוזרים שוב.<br><br>" +
             "אז במקום להוריד כמות, אני מעדיף לשנות תמהיל: אותו משקל בדיוק על השולחן, " +
             "עם יותר משקל בסוגים הזולים יותר לק״ג. המחיר יורד, הכמות לא.<br>" +
             "תנו לי תקציב ואראה לכם בדיוק איך זה נראה.";
    }
  };

  /* ==========================================================================
     ממשק ההודעות
     ========================================================================== */
  let feed, input, chipbox, panel, progressEl, progressBar, hintEl, homeEl, formEl;
  let lastDividerTs = null;
  const GROUP_GAP  = 45 * 1000;   // הודעות מאותו צד בפער קטן מזה נדבקות
  const DIVIDER_GAP = 3 * 60 * 1000; // מפריד שעה חדש רק כשעבר פער אמיתי

  const fmtTime = ts => new Date(ts).toLocaleTimeString("he-IL", {hour:"2-digit", minute:"2-digit"});

  // מוסיף שורת שעה ממורכזת כשעבר מספיק זמן מאז ההודעה הקודמת — בדיוק כמו
  // שאפליקציית הודעות אמיתית לא מציגה שעה על כל הודעה, רק כשיש פער
  function maybeDivider(ts){
    if (lastDividerTs != null && ts - lastDividerTs < DIVIDER_GAP) return;
    lastDividerTs = ts;
    feed.appendChild(el("div", "time-div", `<span>${fmtTime(ts)}</span>`));
  }

  // עובר על כל ההודעות בסדר שלהן וקובע אילו רצופות מאותו צד (מודבקות,
  // בלי רווח וכמעט בלי עיגול בפינה המשותפת) ואיזו היא האחרונה בכל צרור
  // (מקבלת את ה"זנב" — הפינה החדה שמצביעה לכיוון השולחח)
  function relayout(){
    const kids = [...feed.children].filter(k => k.classList.contains("msg"));
    let prevRole = null, prevTs = null;
    kids.forEach(k => {
      const role = k.dataset.role, ts = +k.dataset.ts;
      const grouped = prevRole === role && prevTs != null && (ts - prevTs) < GROUP_GAP;
      k.classList.toggle("grouped", grouped);
      prevRole = role; prevTs = ts;
    });
    kids.forEach((k,i) => {
      const next = kids[i+1];
      const lastOfRun = !next || !next.classList.contains("grouped") || next.dataset.role !== k.dataset.role;
      k.classList.toggle("tail", lastOfRun);
    });
  }

  function bubble(who, html, opts){
    opts = opts || {};
    const ts = opts.ts || Date.now();
    if (!opts.noDivider) maybeDivider(ts);
    const b = el("div", "msg " + who);
    b.dataset.role = who; b.dataset.ts = ts;
    b.innerHTML = `<div class="b">${html}</div>`;
    feed.appendChild(b);
    relayout();
    if (!opts.quiet) feed.scrollTop = feed.scrollHeight;
    return b;
  }

  // הקלדה מדורגת — נותנת תחושה חיה בלי שום שירות חיצוני.
  // rich=true: תוכן עם עיצוב עצמאי (כרטיס, תיבת חלופות, כפתורים) —
  // מקבל עטיפה שקופה במקום בועת צ'אט, כמו הודעות עם תוכן מובנה באמת
  function bot(html, delay, rich){
    return new Promise(res => {
      const t = el("div", "msg bot typing", '<div class="b"><i></i><i></i><i></i></div>');
      feed.appendChild(t);
      feed.scrollTop = feed.scrollHeight;
      const ms = delay != null ? delay : Math.min(900, 260 + String(html).length * 4);
      setTimeout(() => {
        t.remove();
        const ts = Date.now();
        const b = bubble(rich ? "bot rich" : "bot", html, {ts});
        S.log.push({r:"bot", t:html, ts, rich:!!rich});
        res(b);
      }, ms);
    });
  }

  function chips(items, opts){
    opts = opts || {};
    chipbox.innerHTML = "";
    if (!items || !items.length) { chipbox.classList.remove("on"); return; }
    chipbox.classList.add("on");

    if (!opts.multi){
      items.forEach(it => {
        const b = el("button", "qchip", esc(it.t));
        b.onclick = () => { chipbox.innerHTML = ""; chipbox.classList.remove("on"); say(it.t, it.v); };
        chipbox.appendChild(b);
      });
      return;
    }

    // בחירה מרובה: "none"/-1 הוא בלעדי ומגיש מיד, כל השאר מסתמנים
    // ומחכים ל"המשך" — כדי שאפשר יהיה לבחור כמה מגבלות בבת אחת
    const selected = new Set();
    const draw = () => {
      chipbox.innerHTML = "";
      items.forEach(it => {
        const exclusive = it.v === "none" || it.v === -1;
        const b = el("button", "qchip" + (selected.has(it.v) ? " on" : ""), esc(it.t));
        b.onclick = () => {
          if (exclusive){ chipbox.innerHTML = ""; chipbox.classList.remove("on"); say(it.t, it.v); return; }
          selected.has(it.v) ? selected.delete(it.v) : selected.add(it.v);
          draw();
        };
        chipbox.appendChild(b);
      });
      if (selected.size){
        const vals   = [...selected];
        const labels = items.filter(it => selected.has(it.v)).map(it => it.t).join(", ");
        const done = el("button", "qchip done", "המשך ✓");
        done.onclick = () => { chipbox.innerHTML = ""; chipbox.classList.remove("on"); say(labels, vals); };
        chipbox.appendChild(done);
      }
    };
    draw();
  }

  /* ==========================================================================
     קליטת קלט: קודם סופגים ישויות, אחר כך עונים, ואז ממשיכים בתסריט
     ========================================================================== */

  // ערך שהגיע מלחיצה על כפתור — ידוע ומדויק, לא צריך ניחוש
  // שאלנו רק על סוג האירוע — role/duration/seating מוסקים מתוכו במקום
  // להישאל בנפרד, כדי לא להטריח את הלקוח בשאלות שהתשובה עליהן כמעט תמיד
  // ידועה מראש לפי סוג האירוע (חינה = עוגיות במרכז, השקה = עוד קינוחים...)
  function applyEventDefaults(k){
    const ev = DATA.events.find(e => e.k === k);
    if (!ev) return;
    S.slots.role     = ev.dRole     || "main";
    S.slots.duration = ev.dDuration || "mid";
    S.slots.seating  = ev.dSeating  || "stand";
  }

  function absorbChip(v){
    const step = nextStep();
    if (!step) return false;
    if (step.slot === "diet"){
      if (v === "none" || v === -1) S.slots.diet = [];
      else S.slots.diet = Array.isArray(v) ? v : [v];
      return true;
    }
    if (v === -1) { S.slots[step.slot] = 0; return true; }
    S.slots[step.slot] = v;
    if (step.slot === "eventType") applyEventDefaults(v);
    return true;
  }

  // "יש לכם ללא גלוטן?" היא שאלה, לא הצהרה על מגבלה.
  // בלי ההבחנה הזו כל בירור סקרנות היה הופך למגבלה תזונתית שמצמצמת את הקטלוג.
  const QWORDS = ["יש לכמ","האמ","מה ","כמה ","איך ","אפשר ","האמ ","יש לכ"];
  function isQuestion(raw, p){
    if (String(raw).indexOf("?") > -1) return true;
    return QWORDS.some(w => p.norm.indexOf(NLU.norm(w)) === 0 || p.norm.indexOf(" " + NLU.norm(w)) > -1);
  }

  // "אין מגבלות" / "בלי אלרגיות" — הצהרה מפורשת שאין מה לסנן
  const NO_LIMITS = /אינ מגבלו|בלי מגבלו|אינ אלרגי|בלי אלרגי|אינ בעיו|הכל בסדר|הכל אפשרי/;

  // התאמת טקסט חופשי לאפשרויות של השאלה הנוכחית — לקוח שמקליד
  // "יש עוד קינוחים" צריך להתקדם בדיוק כמו לקוח שלחץ על הכפתור
  function scoreOption(optText, p){
    let sc = 0;
    const fw = NLU.forms(p.raw);
    NLU.words(optText).forEach(part => {
      if (part.length < 3) return;
      fw.forEach(v => { if (v.indexOf(part) > -1) sc++; });
    });
    return sc;
  }

  // בדיקת התאמה מול אפשרויות שאלה יחידה, עם סף נתון.
  // תשובה קצרה כמו "בופה" או "כל הערב" מכילה לעיתים רק מילה משמעותית אחת —
  // לכן הסף לשאלה הנוכחית נמוך משמעותית מהסף לשאלות עתידיות שטרם נשאלו.
  function bestOptionFor(step, p, threshold){
    if (!step || !step.chips) return null;
    let best = null, bestScore = 0;
    step.chips().filter(o => typeof o.v === "string").forEach(o => {
      const sc = scoreOption(o.t, p);
      if (sc > bestScore){ bestScore = sc; best = o; }
    });
    return bestScore >= threshold ? best : null;
  }

  // סורק את כל השאלות שטרם נענו, לא רק את הנוכחית — סף גבוה כדי למנוע
  // התאמות שווא לשאלה שהלקוח לא מתכוון בכלל לענות עליה עכשיו
  function matchAnyOption(p){
    let best = null, bestScore = 0;
    STEPS.forEach(step => {
      const cur = S.slots[step.slot];
      if (cur !== null && cur !== undefined) return;      // כבר נענתה
      if (!step.chips) return;
      step.chips().filter(o => typeof o.v === "string").forEach(o => {
        const sc = scoreOption(o.t, p);
        if (sc > bestScore){ bestScore = sc; best = {step, opt:o}; }
      });
    });
    return bestScore >= 2 ? best : null;
  }

  // ערך שהגיע מטקסט חופשי — סופגים כל מה שזוהה, לא רק את השאלה הנוכחית
  function absorbText(p){
    const s = S.slots;
    let got = false;
    const asking = isQuestion(p.raw, p);

    if (NO_LIMITS.test(p.norm)){ s.diet = []; got = true; }
    const hasDiet = Array.isArray(s.diet) && s.diet.length > 0;

    if (p.event && !s.eventType){ s.eventType = p.event.k; applyEventDefaults(p.event.k); got = true; }
    if (p.hours != null && s.hours == null){ s.hours = p.hours; got = true; }
    if (p.diet.length && !hasDiet && !asking){ s.diet = p.diet; got = true; }
    if (p.cookie && s.likes.indexOf(p.cookie.id) === -1 && /רוצה|אוהב|חייב|תוסיף/.test(p.norm)){
      s.likes.push(p.cookie.id); got = true;
    }

    // מספרים: מפרידים אורחים מתקציב לפי גודל והקשר
    p.numbers.forEach(n => {
      const money = /שח|שקל|תקציב|₪|עד/.test(p.norm);
      if (money && n >= 200 && s.budget == null){ s.budget = n; got = true; return; }
      if (!money && n > 0 && n <= 2000 && s.guests == null){ s.guests = n; got = true; return; }
      if (n >= 200 && s.budget == null && s.guests != null){ s.budget = n; got = true; }
    });

    // תשובה חופשית — קודם בודקים אם היא עונה על השאלה שממש נשאלה (סף נמוך,
    // כי "בופה" או "כל הערב" הם תשובות לגיטימיות של מילה אחת), ורק אם לא
    // מתאימה שם בודקים אם היא בכלל ענתה מראש על שאלה אחרת שטרם הגיעה אליה
    if (!got && !asking){
      const step = nextStep();
      const direct = bestOptionFor(step, p, 1);
      if (direct){
        S.slots[step.slot] = direct.v; got = true;
        if (step.slot === "eventType") applyEventDefaults(direct.v);
      }
      const m = !got ? matchAnyOption(p) : null;
      if (m){
        S.slots[m.step.slot] = m.opt.v; got = true;
        if (m.step.slot === "eventType") applyEventDefaults(m.opt.v);
      }
      else if (step && step.slot === "diet" && p.intent === "no"){ S.slots.diet = []; got = true; }
      else if (step && step.slot === "budget" &&
               (p.intent === "no" || /לא יודע|לא סגור|אינ.*תקציב|בלי תקציב|לא הגדרתי|גמיש/.test(p.norm))){
        S.slots.budget = 0; got = true;
      }
      else if (step && step.slot === "hours" && /לא סגור|לא יודע|עוד לא/.test(p.norm)){
        S.slots.hours = 0; got = true;
      }
    }

    return got;
  }

  // האם השאלה של המשתמש היא שאלת ידע שצריך לענות עליה עכשיו
  function answerFor(p){
    const i = p.intent;
    if (p.cookie && (i === null || i === "recommend" || i === "storage" || i === "allergy" || i === "price")) {
      if (i === "price")   return KNOW.price(p);
      if (i === "allergy") return KNOW.allergy(p);
      return KNOW.cookie(p);
    }
    if (KNOW[i]) return KNOW[i](p);
    return null;
  }

  /* ==========================================================================
     לולאת השיחה
     ========================================================================== */
  let busy = false;

  async function say(text, chipValue){
    if (busy || !String(text).trim()) return;
    busy = true;
    hideHint();
    const meTs = Date.now();
    bubble("me", esc(text), {ts:meTs});
    S.log.push({r:"me", t:text, ts:meTs});
    input.value = "";
    chips([]);

    const p = NLU.parse(text);

    if (p.intent === "restart"){ await reset(); busy = false; return; }
    if (p.intent === "human"){ await handoff(); busy = false; return; }

    const asking = (chipValue === undefined) && isQuestion(text, p);

    let filled = false;
    if (chipValue !== undefined) filled = absorbChip(chipValue);
    else filled = absorbText(p);

    // שאלת ידע שנשאלה תוך כדי — עונים ואז חוזרים בדיוק לאותה נקודה.
    // הודעה שרק מילאה פרט (כמו "התקציב 2500") לא מקבלת הרצאה מיותרת.
    const ans = answerFor(p);
    const isPureQuestion = !!ans && (asking || !filled);

    if (isPureQuestion) await bot(ans);
    else if (!filled && p.intent === "thanks") await bot(pick(["בכיף 🙂","שמח לעזור.","בשמחה."]));
    else if (!filled && p.intent === "greet")  await bot(pick(["היי! 👋","שלום, בואו נתחיל."]));
    else if (!filled && !ans) await fallback(p);

    await advance(isPureQuestion);
    updateProgress();
    save();
    busy = false;
  }

  // התסריט ממשיך מהמקום שבו נעצר. מה שכבר נאמר לא נשאל שוב.
  async function advance(afterQuestion){
    const step = nextStep();
    if (!step){ await propose(); return; }
    const lead = afterQuestion ? pick(["ועכשיו, ","נחזור רגע — ","אז ",""]) : "";
    await bot(lead + pick(step.q));
    chips(step.chips(), {multi: !!step.multi});
  }

  // אין התאמה? לא אומרים "לא הבנתי" ונעצרים — מציעים דרכים להמשיך
  async function fallback(p){
    const step = nextStep();
    const opts = [];
    if (step) opts.push({t:"בוא נמשיך", v:undefined});
    opts.push({t:"כמה זה עולה?", v:undefined});
    opts.push({t:"כמה צריך לאירוע שלי?", v:undefined});
    opts.push({t:DATA.texts.handoff, v:undefined});
    await bot(DATA.texts.fallback + " אפשר לשאול אותי על מחירים, כמויות, כשרות, גלוטן, " +
              "אלרגיות, משלוח, זמני הכנה או על עוגייה מסוימת.");
  }

  /* ==========================================================================
     דיווח לידים לגיליון (Google Sheets דרך Apps Script) — אופציונלי לגמרי.
     כל עוד DATA.biz.leadsEndpoint ריק, שום דבר לא נשלח לשום מקום — האתר
     ממשיך לעבוד בדיוק כמו קודם, אפס שינוי בהתנהגות. text/plain בכוונה:
     Apps Script קורא את הגוף הגולמי בכל מקרה, וזה חוסך CORS preflight
     שנכשל מול כתובות exec של Apps Script.
     ========================================================================== */
  function logLead(payload){
    const url = DATA.biz && DATA.biz.leadsEndpoint;
    if (!url) return;
    try {
      fetch(url, {
        method: "POST", mode: "no-cors",
        headers: {"Content-Type": "text/plain;charset=utf-8"},
        body: JSON.stringify(Object.assign({src:S.src}, payload))
      }).catch(() => {});
    } catch(e){}
  }

  async function handoff(){
    const t = transcript();
    const s = S.slots;
    logLead({eventType:s.eventType, guests:s.guests, level:s.level,
              diet:(s.diet||[]).join(","), done:false, clickedWhatsApp:true});
    await bot(`בטח. הנה קיצור דרך — הלחיצה פותחת וואטסאפ עם כל מה שדיברנו עד עכשיו, ` +
              `כדי שלא תצטרכו לכתוב הכול מחדש.` +
              `<div class="cta-row"><a class="btn btn-p btn-sm" target="_blank" rel="noopener" href="${wa(t)}">פתיחת וואטסאפ</a></div>`);
  }

  async function reset(){
    S = blank();
    save();
    feed.innerHTML = "";
    lastDividerTs = null;
    updateProgress();
    if (hintEl) hintEl.classList.remove("hidden");
    await bot("התחלנו מחדש 🙂");
    await advance();
  }

  // אישור התחלה-מחדש בתוך הצ'אט עצמו, בלי חלון confirm() נטיבי של הדפדפן
  // שמרגיש זר לאפליקציה ולא ניתן לעיצוב
  function confirmRestart(){
    const html = `<div class="warn-box">
      <b>להתחיל שיחה חדשה?</b><br>
      <span style="color:var(--muted);font-size:13.5px">כל מה שדיברנו עד עכשיו יימחק.</span>
      <div class="cta-row" style="margin-top:10px">
        <button class="btn btn-p btn-sm" onclick="CHAT.reset()">כן, להתחיל מחדש</button>
        <button class="btn btn-s btn-sm" onclick="this.closest('.msg').remove()">לא, להמשיך</button>
      </div>
    </div>`;
    bot(html, 150, true);
  }

  function transcript(){
    const s = S.slots;
    const ev = s.eventType ? ENGINE.evOf(s.eventType).l : "לא צוין";
    return `היי! דיברתי עם היועץ באתר.\n\n` +
           `אירוע: ${ev}\n` +
           `אורחים: ${s.guests || "לא צוין"}\n` +
           (s.budget ? `תקציב: ${ils(s.budget)}\n` : "") +
           ((s.diet && s.diet.length) ? `מגבלות: ${s.diet.map(d => ENGINE.DIET[d].label).join(", ")}\n` : "") +
           `\nאשמח שתחזרו אליי.`;
  }

  /* ==========================================================================
     כרטיס ההצעה
     ========================================================================== */
  let lastResult = null;

  async function propose(){
    const s = S.slots;
    const r = ENGINE.recommend({
      eventType: s.eventType, guests: s.guests, budget: s.budget,
      hoursToEvent: (s.hours && s.hours > 0) ? s.hours : null,
      duration: s.duration, role: s.role, seating: s.seating, level: s.level,
      daypart: s.daypart, kidsPct: s.kidsPct, diet: s.diet || [], likes: s.likes
    });
    lastResult = r;
    S.done = true;
    updateProgress();

    if (!r.ok){
      logLead({eventType:s.eventType, guests:s.guests, level:s.level,
                diet:(s.diet||[]).join(","), done:false, clickedWhatsApp:false});
      await bot(r.msg + `<div class="cta-row"><a class="btn btn-p btn-sm" target="_blank" rel="noopener" href="${wa(transcript())}">לדבר איתנו בוואטסאפ</a></div>`);
      return;
    }

    logLead({eventType:s.eventType, guests:s.guests, level:s.level,
              diet:(s.diet||[]).join(","), kg:r.kg, cost:r.cost,
              done:true, clickedWhatsApp:false});

    await bot("רגע, מחשב לכם את זה…", 500);

    const gap = '<div style="height:8px"></div>';
    await bot(card(r), 750, true);

    // תקציב, אזהרות ומגש ביטוח — כולם הערות על אותה הצעה, מתקבצים לבלוק אחד
    const extras = [];
    if (r.budget.msg) extras.push(budgetBlock(r));
    if (r.warnings.length){
      extras.push(`<div class="warn-box">${r.warnings.map(w => `⚠ ${w.text}`).join("<br>")}</div>`);
    }
    if (r.backup) extras.push(backupBlock(r));
    if (extras.length) await bot(extras.join(gap), 400, true);

    await bot(ctaBlock(r), 250, true);
    chips([{t:"לשנות משהו", v:undefined}, {t:"למה דווקא הכמות הזאת?", v:undefined},
           {t:"אפשר יותר זול?", v:undefined}]);
  }

  function card(r){
    const rows = r.items.map(item => `
      <tr>
        <td class="ic">${svg(item.sh, item.a, item.b)}</td>
        <td class="nm">${item.n}</td>
        <td class="kg">${item.cartons} ${item.cartons>1?"קרטונים":"קרטון"}</td>
        <td class="un">${item.kg} ק״ג</td>
      </tr>`).join("");

    return `<div class="prop">
      <div class="prop-top">
        <div><small>כמות מומלצת</small><b>${r.kg} ק״ג</b></div>
        <div><small>לכל אורח</small><b>${r.perGuest}</b></div>
      </div>
      <table class="prop-mix">${rows}</table>
      <div class="prop-sum">
        <span>מחיר משוער</span>
        <b class="prop-sum-price">${ils(r.cost)}</b>
      </div>
      <div class="prop-fine">${ils(r.pricePerGuest)} לאורח · ${DATA.texts.disclaimer}</div>
    </div>`;
  }

  function budgetBlock(r){
    const b = r.budget;
    if (b.mode === "short"){
      return `<div class="alt-box"><p>${b.msg}</p>` +
        b.alts.map((a,i) => `<div class="alt"><b>${i+1}. ${a.t}</b><span>${a.d}</span></div>`).join("") +
        `</div>`;
    }
    return `<div class="ok-box">${b.msg}</div>`;
  }

  function backupBlock(r){
    const b = r.backup;
    return `<div class="backup-box">
      <b>${b.label} — ${b.kg} ק״ג ב-${ils(b.price)} <small>(${b.discountPct}% הנחה)</small></b>
      <span>${b.pitch}</span>
    </div>`;
  }

  function ctaBlock(r){
    return `<div class="cta-row">
      <a class="btn btn-p btn-sm" target="_blank" rel="noopener" href="${wa(orderText(r))}" onclick="CHAT.logWhatsAppClick()">המשך סגירה עם נציג</a>
      <button class="btn btn-s btn-sm" onclick="CHAT.share()">שיתוף ההצעה</button>
    </div>`;
  }

  // נקרא מה-onclick של כפתור הוואטסאפ בכרטיס ההצעה — לא חוסם את הפתיחה
  // (הקישור עצמו ממשיך כרגיל), רק שולח עדכון שהליד "חם": הגיע להצעה וגם לחץ
  function logWhatsAppClick(){
    const s = S.slots;
    logLead({eventType:s.eventType, guests:s.guests, level:s.level,
              diet:(s.diet||[]).join(","),
              kg: lastResult && lastResult.ok ? lastResult.kg : "",
              cost: lastResult && lastResult.ok ? lastResult.cost : "",
              done: !!(lastResult && lastResult.ok), clickedWhatsApp:true});
  }

  /* ---- הסיכום שנשלח אליך בוואטסאפ ---- */
  function orderText(r){
    const s = S.slots;
    const L = [];
    L.push("היי! בניתי הצעה ביועץ באתר 🍪");
    L.push("");
    L.push(`אירוע: ${r.q.ev.l}`);
    L.push(`אורחים: ${s.guests}`);
    if (s.hours > 0) L.push(`מתי: בעוד כ-${Math.round(s.hours/24)} ימים`);
    if (s.budget)    L.push(`תקציב: ${ils(s.budget)}`);
    if (s.diet && s.diet.length) L.push(`מגבלות: ${s.diet.map(d => ENGINE.DIET[d].label).join(", ")}`);
    L.push("");
    L.push(`כמות מומלצת: ${r.kg} ק״ג (${r.units} יחידות, ${r.perGuest} לאורח)`);
    L.push("");
    L.push("התמהיל:");
    r.items.forEach(i => L.push(`• ${i.n} — ${i.cartons} ${i.cartons>1?"קרטונים":"קרטון"} (${i.kg} ק״ג)`));
    L.push("");
    L.push(`מחיר משוער: ${ils(r.cost)}`);
    if (r.backup) L.push(`+ ${r.backup.label}: ${r.backup.kg} ק״ג ב-${ils(r.backup.price)}`);
    L.push("");
    L.push(`(הגעתי מ: ${S.src})`);
    return L.join("\n");
  }

  /* ==========================================================================
     שיתוף ההצעה — כל הבחירות נדחסות ל-hash של הכתובת.
     הלקוח שולח לבן/בת הזוג, והם רואים בדיוק את אותה הצעה. אפס שרת, אפס עלות.
     ========================================================================== */
  function encodeState(){
    const s = S.slots;
    const packed = [s.eventType||"", s.guests||"", s.budget||"", s.hours||"",
                    s.duration||"", s.role||"", s.seating||"", (s.diet||[]).join("+"),
                    s.level||""].join("~");
    return encodeURIComponent(packed);
  }

  function decodeState(h){
    const a = decodeURIComponent(h).split("~");
    if (a.length < 8) return null;
    return {eventType:a[0]||null, guests:+a[1]||null, budget:+a[2]||null, hours:+a[3]||null,
            duration:a[4]||null, role:a[5]||null, seating:a[6]||null, daypart:null,
            kidsPct:null, diet:a[7]?a[7].split("+"):[], level:a[8]||null, likes:[]};
  }

  async function share(){
    const url = location.origin + location.pathname + "#p=" + encodeState();
    let ok = false;
    if (navigator.share){
      try { await navigator.share({title:"ההצעה שלנו", url}); ok = true; } catch(e){}
    }
    if (!ok && navigator.clipboard){
      try { await navigator.clipboard.writeText(url); ok = true;
            await bot("הקישור הועתק ✓ אפשר לשלוח אותו למי שצריך לאשר — הוא יראה בדיוק את אותה הצעה.");
      } catch(e){}
    }
    if (!ok) await bot(`הקישור להצעה:<br><span class="link-box">${esc(url)}</span>`);
  }

  /* ==========================================================================
     אתחול
     ========================================================================== */
  function greeting(){
    const t = DATA.texts;
    if (S.src === "fb" || S.src === "facebook") return t.greetFb;
    if (S.src === "wa") return t.greetWa;
    return t.greetDefault;
  }

  async function start(){
    const shared = location.hash.match(/#p=(.+)/);
    const saved  = load();

    if (shared){
      S = blank();
      const st = decodeState(shared[1]);
      if (st) S.slots = st;
      hideHint();
      await bot("קיבלתם הצעה משותפת — הנה היא, עם המחירים המעודכנים.");
      await propose();
      save();
      return;
    }

    if (saved && saved.log && saved.log.length > 2){
      S = saved;
      hideHint();
      // משחזרים את השיחה כדי שלקוח שחזר לא יתחיל מאפס. הודעות ישנות בלי
      // חותמת זמן (משיחה שנשמרה לפני הגרסה הזו) מקבלות זמן קרוב זה לזה
      // כדי שיתקבצו יחד במקום לפזר מפרידי שעה מיותרים.
      let synthTs = Date.now() - S.log.length * 1000;
      S.log.forEach(m => {
        const ts = m.ts || (synthTs += 1000);
        const who = m.r === "me" ? "me" : (m.rich ? "bot rich" : "bot");
        bubble(who, m.r === "me" ? esc(m.t) : m.t, {ts, quiet:true});
      });
      feed.scrollTop = feed.scrollHeight;
      updateProgress();
      await bot(S.done ? "חזרתם 🙂 ההצעה שלכם עדיין כאן. רוצים לשנות משהו?"
                       : "המשכנו מאיפה שעצרנו.");
      if (!S.done) { const st = nextStep(); if (st) chips(st.chips(), {multi: !!st.multi}); }
      return;
    }

    S = blank();
    updateProgress();
    await bot(greeting());
    await advance();
    save();
  }

  function open(){
    panel.classList.add("open");
    document.body.classList.add("chat-open");
    if (!feed.children.length) start();
    setTimeout(() => input.focus(), 250);
  }
  function close(){
    panel.classList.remove("open");
    document.body.classList.remove("chat-open");
  }

  // מעבר ממסך הבית לשיחה החיה: חושפים את פס ההודעות ואת שדה הקלט
  function enterChat(){
    if (homeEl) homeEl.hidden = true;
    feed.hidden = false;
    if (formEl) formEl.hidden = false;
  }

  // כל כפתור במסך הבית נכנס לשיחה ומיד שואל את השאלה שהוא הבטיח —
  // לא רק "פותח צ'אט ריק" אלא ממשיך בדיוק לאן שהלקוח ציפה
  async function goFromHome(kind){
    enterChat();
    await start();
    if (kind === "price") await say("כמה עולה?");
    else if (kind === "diet") await say("יש ללא גלוטן או טבעוני?");
    else if (kind === "human") await say("אני רוצה לדבר עם בן אדם");
    setTimeout(() => input.focus(), 200);
  }

  function wireHome(){
    const startBtn = q("#homeStart");
    if (startBtn) startBtn.onclick = () => goFromHome("calc");
    document.querySelectorAll(".starter").forEach(b => {
      b.onclick = () => goFromHome(b.dataset.starter);
    });
  }

  function init(){
    panel      = q("#chatPanel");
    feed       = q("#chatFeed");
    input      = q("#chatInput");
    chipbox    = q("#chatChips");
    progressEl = q("#chatProgress");
    progressBar= q("#chatProgressBar");
    hintEl     = q("#chatHint");
    homeEl     = q("#chatHome");
    formEl     = q("#chatForm");
    if (!panel) return;

    formEl.addEventListener("submit", e => { e.preventDefault(); say(input.value); });

    // מצב עצמאי: יש כפתור פתיחה/סגירה — פאנל צף מעל דף אחר
    const openBtn  = q("#chatOpen");
    const closeBtn = q("#chatClose");
    if (openBtn && closeBtn){
      openBtn.onclick  = open;
      closeBtn.onclick = close;
      document.querySelectorAll("[data-chat-open]").forEach(b => b.addEventListener("click", e => {
        e.preventDefault(); open();
      }));
      addEventListener("keydown", e => { if (e.key === "Escape" && panel.classList.contains("open")) close(); });
      if (location.hash.indexOf("#p=") === 0) open();
      return;
    }

    // מצב מסך מלא: אין כפתורים — הצ'אט הוא כל האתר, פתוח תמיד
    panel.classList.add("open");
    document.body.classList.add("chat-open");

    // הגעה מקישור הצעה משותפת, או המשך שיחה שכבר התקדמה — נכנסים ישר
    // לשיחה, בלי מסך בית. מסך הבית הוא רק לביקור ראשון אמיתי.
    const shared      = location.hash.indexOf("#p=") === 0;
    const saved       = load();
    const hasProgress = !!(saved && saved.log && saved.log.length > 2);

    if (shared || hasProgress){
      enterChat();
      start();
      setTimeout(() => input.focus(), 300);
    } else if (homeEl) {
      homeEl.hidden = false;
      wireHome();
    } else {
      enterChat();
      start();
      setTimeout(() => input.focus(), 300);
    }
  }

  return {init, open, close, say, share, reset, confirmRestart, logWhatsAppClick, get state(){ return S; }};
})();

document.addEventListener("DOMContentLoaded", CHAT.init);
// VERIFY_TOKEN_998877
