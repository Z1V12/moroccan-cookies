/* ============================================================================
   engine.js — מנוע הכמויות, התמהיל והתקציב.
   פונקציות טהורות בלבד: קלט → הצעה. אין כאן DOM ואין קריאות רשת.
   כל המספרים מגיעים מ-DATA.events / DATA.engine — אין מספר עסקי קשיח כאן.
   ============================================================================ */

const ENGINE = (() => {

  const E    = () => DATA.engine;
  const evOf = k => DATA.events.find(e => e.k === k) || DATA.events[0];
  const mOf  = (list, k, dflt) => { const x = E()[list].find(o => o.k === k); return x ? x.m : (dflt || 1); };

  const round = (n, step) => Math.round(Math.round(n / step) * step * 1e6) / 1e6;
  const ils   = n => "₪" + Math.round(n).toLocaleString("he-IL");

  const has = (c, tag) => (c.g || []).some(g => g.indexOf(tag) === 0);

  /* ---- מגבלות תזונה ---- */
  const DIET = {
    gluten: {label:"ללא גלוטן",  ok: c => has(c, "ללא גלוטן")},
    vegan:  {label:"טבעוני",     ok: c => has(c, "טבעוני")},
    parve:  {label:"פרווה",      ok: c => has(c, "פרווה")},
    nuts:   {label:"ללא אגוזים", ok: c => !/שקד|אגוז|פיסטוק|קשיו|בוטן/.test(c.al)},
    dairy:  {label:"ללא חלב",    ok: c => !/חלב|חמאה/.test(c.al)},
    eggs:   {label:"ללא ביצים",  ok: c => !/ביצ/.test(c.al)}
  };

  function filterCatalog(diet, hoursToEvent){
    const excluded = [], rushDropped = [];
    let list = DATA.cookies.slice();

    (diet || []).forEach(d => {
      const rule = DIET[d]; if (!rule) return;
      list = list.filter(c => {
        if (rule.ok(c)) return true;
        excluded.push({n:c.n, why:rule.label}); return false;
      });
    });

    if (hoursToEvent != null) {
      list = list.filter(c => {
        const need = c.prh || 48;
        if (need <= hoursToEvent) return true;
        rushDropped.push({n:c.n, need}); return false;
      });
    }
    return {list, excluded, rushDropped};
  }

  /* ---- שלב א׳-ג׳: כמה ק״ג באמת צריך ---- */
  function quantity(inp){
    const ev      = evOf(inp.eventType);
    const guests  = Math.max(1, +inp.guests || 0);
    const kidsPct = Math.min(1, Math.max(0, (+inp.kidsPct || 0) / 100));

    const adultEq = guests * (1 - kidsPct) + guests * kidsPct * E().kidsWeightFactor;

    const mults = {
      duration: mOf("duration", inp.duration),
      role:     mOf("role",     inp.role),
      seating:  mOf("seating",  inp.seating),
      daypart:  mOf("daypart",  inp.daypart)
    };
    // מקדמים מצטברים ולא מוכפלים — ארבע הכפלות מתפוצצות ומנפחות את הכמות פי שניים.
    // כל מקדם תורם את הסטייה שלו מ־1, והתוצאה חסומה בטווח שפוי.
    const raw  = 1 + (mults.duration-1) + (mults.role-1) + (mults.seating-1) + (mults.daypart-1);
    const lim  = E().multClamp || [0.65, 1.45];
    const mult = Math.min(lim[1], Math.max(lim[0], raw));

    const baseKg   = (ev.gpp * adultEq * mult) / 1000;
    const bufferKg = baseKg * ev.buffer;

    // רמת השולחן: מכפיל נפרד וסופי, כי זו העדפת הוצאה של הלקוח ולא
    // עובדה תפעולית על האירוע (בניגוד למקדמים למעלה). בררת המחדל
    // "standard" (1.0) שומרת על ההתנהגות הרגילה כשלא נשאלה השאלה.
    const levelMult = mOf("level", inp.level, 1);
    const kg = Math.max(E().roundToKg, round((baseKg + bufferKg) * levelMult, E().roundToKg));

    return {ev, guests, kidsPct, mults, mult, levelMult,
            baseKg:round(baseKg,0.1), bufferKg:round(bufferKg,0.1),
            bufferPct:Math.round(ev.buffer*100), kg};
  }

  /* ---- שלב ד׳: בניית התמהיל — נמכר רק בקרטונים שלמים, לא לפי משקל חופשי.
     במקום לחלק את הכמות לנתחים רציפים (1.65 ק״ג מזה, 1.65 מזה...) שאי
     אפשר בכלל לקנות, בונים את המגש קרטון-קרטון: כל קרטון שלם מתווסף
     למגש, וממשיכים להוסיף עד שהמשקל הכולל מגיע ליעד או עובר אותו —
     כי "פחות מדי" הוא הבעיה שהמנוע קיים כדי למנוע, לא "קצת יותר מדי". ---- */
  function buildMix(kg, guests, catalog, opts){
    opts = opts || {};
    const ev = opts.ev || DATA.events[0];

    const span  = ev.maxT - ev.minT;
    const scale = Math.min(1, Math.log10(Math.max(10, guests)) / 2.6);
    let nTypesTarget = Math.round(ev.minT + span * scale);
    // רמת "עשיר ומרשים" מקבלת גם עוד סוג, לא רק יותר משקל — אבל "קליל"
    // לא מקבל פחות סוגים: עם 7 מוצרים בלבד, פחות סוגים אילץ קרטון נוסף
    // של הפריט היקר ביותר כדי להשלים משקל, וזה הפך את הרמה הזולה ליקרה
    // יותר מהסטנדרטית — בדיוק ההפך ממה שהלקוח מצפה. אז "קליל" משפיע רק
    // על היעד במשקל (למטה) ועל העדפה למוצרים זולים יותר לק״ג (בציון).
    if (opts.level === "generous") nTypesTarget += 1;
    nTypesTarget = Math.max(1, Math.min(nTypesTarget, catalog.length));

    const avgPk = catalog.reduce((s,c) => s + (c.pk||0), 0) / (catalog.length || 1);
    const preferCheap   = opts.cheap || opts.level === "light";
    const preferPremium = opts.level === "generous";
    const scored = catalog.map(c => {
      let s = (c.pop || 3);
      if (c.tag === "נגמר ראשון") s *= E().popularBoost;
      if (opts.likes && opts.likes.indexOf(c.id) > -1) s *= 2;
      if (preferCheap && c.pk) s *= (avgPk / c.pk);
      // שולחן "עשיר ומרשים": מטים לפריטי הפרימיום (השקדים) במקום למחיר הזול
      if (preferPremium && c.pk) s *= (c.pk / avgPk);
      if (preferPremium && c.premium) s *= 1.6;
      return {c, s};
    }).sort((a,b) => b.s - a.s);

    // שלב 1: קרטון אחד מכל סוג, עד nTypesTarget סוגים — אבל לא מוסיפים
    // סוג חדש ברגע שהכמות כבר הגיעה ליעד (אין טעם לגוון מעבר למה שצריך)
    const order = [];
    if (E().balanceCats) {
      const seen = new Set();
      scored.forEach(x => { if (!seen.has(x.c.cat)) { seen.add(x.c.cat); order.push(x); } });
    }
    scored.forEach(x => { if (order.indexOf(x) === -1) order.push(x); });

    const chosen = []; // {c, cartons}
    let totalKg = 0;

    // פריטים שסומנו alwaysInclude (למשל מעורב מרציפן) נכנסים תמיד, כל עוד
    // עברו את סינון התזונה — קבועים בכל הזמנה לפי ההחלטה העסקית שלך,
    // לא מתחרים על ניקוד מול שאר הקטלוג
    catalog.filter(c => c.alwaysInclude).forEach(c => {
      if (chosen.some(x => x.c.id === c.id)) return;
      chosen.push({c, cartons:1});
      totalKg += c.cartonKg || 1;
    });

    for (const x of order) {
      if (chosen.some(ch => ch.c.id === x.c.id)) continue;   // כבר נכנס כ-alwaysInclude
      if (chosen.length >= nTypesTarget) break;
      if (chosen.length > 0 && totalKg >= kg) break;   // כבר הגענו ליעד — לא מגוונים סתם
      const ck = x.c.cartonKg || 1;
      chosen.push({c:x.c, cartons:1});
      totalKg += ck;
    }
    if (!chosen.length && order.length) {
      chosen.push({c:order[0].c, cartons:1});
      totalKg = order[0].c.cartonKg || 1;
    }

    // שלב 2: אם עדיין לא מספיק ק״ג, מוסיפים קרטונים נוספים לסוגים
    // שכבר נבחרו — מסתובבים ביניהם לפי סדר הניקוד, לא הכל על סוג אחד
    let guardIterations = 0;
    while (totalKg < kg && guardIterations < 200) {
      let addedThisRound = false;
      for (const x of chosen) {
        if (totalKg >= kg) break;
        const ck = x.c.cartonKg || 1;
        x.cartons += 1;
        totalKg += ck;
        addedThisRound = true;
        guardIterations++;
        if (totalKg >= kg) break;
      }
      if (!addedThisRound) break;
    }

    return chosen.map(x => {
      const itemKg = round(x.cartons * (x.c.cartonKg || 1), 1e-6);
      const price  = x.cartons * (x.c.cartonPrice != null ? x.c.cartonPrice : itemKg * (x.c.pk || 0));
      return {id:x.c.id, n:x.c.n, cat:x.c.cat, sh:x.c.sh, a:x.c.a, b:x.c.b,
              cartons:x.cartons, cartonKg:x.c.cartonKg || 1, cartonPrice:x.c.cartonPrice,
              kg:itemKg, units:Math.round(itemKg * (x.c.upk || 45)),
              price, pk:x.c.pk};
    });
  }

  /* ---- רצפת מחיר להזמנה: זה כלי שיווקי בשביל העסק, לא רק מחשבון חינמי
     ללקוח — הזמנה לא אמורה לצאת מתחת לסכום שהופך אותה לכדאית. מוסיפים
     קרטונים לפריטים שכבר בתמהיל (הזול ביותר קודם, כדי לא לנפח כמות
     סתם), ורק אם זה לא מספיק מוסיפים פריט זול נוסף מהקטלוג. ---- */
  function enforceMinOrder(items, catalog, minValue){
    if (!minValue) return items;
    let cost = items.reduce((s,i) => s + i.price, 0);
    if (cost >= minValue) return items;

    const byPrice = items.slice().sort((a,b) => (a.cartonPrice||a.price) - (b.cartonPrice||b.price));
    let guard = 0;
    while (cost < minValue && guard < 100){
      let added = false;
      for (const it of byPrice){
        if (cost >= minValue) break;
        const c = catalog.find(x => x.id === it.id);
        if (!c) continue;
        it.cartons += 1;
        it.kg    = round(it.cartons * (c.cartonKg || 1), 1e-6);
        it.units = Math.round(it.kg * (c.upk || 45));
        it.price = it.cartons * (c.cartonPrice != null ? c.cartonPrice : it.kg * (c.pk || 0));
        cost = items.reduce((s,i) => s + i.price, 0);
        added = true; guard++;
        if (cost >= minValue) break;
      }
      if (!added) break;
    }
    return items;
  }

  /* ---- שלב ה׳: התאמת תקציב ---- */
  // תמהיל מצומצם אמיתי: פחות סוגים, אותו משקל — כדי שהחלופה תהיה מספר ולא סיסמה
  function leanMix(q, guests, catalog, nTypes){
    const lean = Object.assign({}, q.ev, {minT:nTypes, maxT:nTypes});
    const items = buildMix(q.kg, guests, catalog, {ev:lean, cheap:true});
    return {items, cost: items.reduce((s,i) => s + i.price, 0), n: items.length};
  }

  function shortfall(q, items, cost, budget, guests, catalog){
    const affordableKg   = round(q.kg * (budget / cost), E().roundToKg);
    const guestsCovered  = Math.floor(guests * (budget / cost));
    const alts = [
      {t:"להישאר על הכמות הנכונה",
       d:`${q.kg} ק״ג · ${ils(cost)}. הפער מהתקציב: ${ils(cost-budget)}.`}
    ];

    // מציעים צמצום סוגים רק כשבאמת יש ממה לצמצם
    if (catalog && items.length > 2){
      const want = Math.max(2, Math.min(3, items.length - 1));
      const lean = leanMix(q, guests, catalog, want);
      if (lean.cost < cost){
        alts.push({t:`${lean.n} סוגים במקום ${items.length}, אותה כמות`,
          d:`${q.kg} ק״ג · ${ils(lean.cost)} — חוסך ${ils(cost - lean.cost)}. ` +
            `המגש פחות מגוון, אבל הכמות על השולחן לא יורדת בגרם.`});
      }
    }

    alts.push({t:"להתאים לתקציב",
       d:`${affordableKg} ק״ג בתוך ${ils(budget)} — מספיק בנוחות לכ־${guestsCovered} אורחים מתוך ${guests}, ` +
         `אבל דעו שזה פחות ממה שאני ממליץ.`});
    return {mode:"short", items, cost, budget, need:cost-budget, affordableKg, guestsCovered, alts,
      msg:`התקציב לא מכסה את הכמות שאני ממליץ עליה — הפער הוא ${ils(cost-budget)}. לא אגיד שזה מספיק כשזה לא, אז הנה שלוש דרכים אמיתיות:`};
  }

  function reconcileBudget(q, items, catalog, budget, guests){
    const cost = items.reduce((s,i) => s + i.price, 0);
    if (!budget || budget <= 0) return {mode:"none", items, cost};

    const gap = (cost - budget) / cost;

    if (gap <= 0) {
      const room = budget - cost;
      return {mode:"fits", items, cost, headroom:room,
        msg:`התקציב מכסה את הכמות המומלצת${room > cost*0.12 ? " ואפילו נשאר מקום להוסיף עוד סוג או שניים" : ""}.`};
    }

    if (gap <= E().budgetSoftGap) {
      const cheap     = buildMix(q.kg, guests, catalog, {ev:q.ev, cheap:true});
      const cheapCost = cheap.reduce((s,i) => s + i.price, 0);
      if (cheapCost <= budget * 1.02) {
        return {mode:"remixed", items:cheap, cost:cheapCost, saved:cost-cheapCost,
          msg:`שיניתי את התמהיל במקום להוריד כמות — אותם ${q.kg} ק״ג, ${ils(cost-cheapCost)} פחות. הכמות על השולחן נשארת בדיוק אותו דבר.`};
      }
      return shortfall(q, cheap, cheapCost, budget, guests, catalog);
    }
    return shortfall(q, items, cost, budget, guests, catalog);
  }

  /* ---- מגש הביטוח ---- */
  function backupTray(q, cost){
    const b = E().backup;
    if (!b.enabled || q.ev.risk < b.minRisk || q.guests < b.minGuests) return null;
    const kg = round(q.kg * b.sharePct, E().roundToKg);
    if (kg <= 0) return null;
    return {label:b.label, kg,
            price:Math.round(cost * b.sharePct * (1 - b.discountPct/100)),
            discountPct:b.discountPct, pitch:b.pitch};
  }

  function bufferStory(q, finalKg){
    if (!q.bufferPct) return "";
    const kg = finalKg != null ? finalKg : q.kg;
    return `לפי ${q.guests} אורחים החישוב היבש נותן ${q.baseKg} ק״ג. ` +
           `ב${q.ev.l} אנשים לוקחים בפועל בערך ${q.bufferPct}% יותר — לוקחים לילדים, לוקחים הביתה, ` +
           `וחצי מהמגש נעלם בעשרים הדקות הראשונות. לכן ההמלצה שלי היא ${kg} ק״ג.` +
           (q.ev.note ? " " + q.ev.note : "");
  }

  /* ---- נקודת הכניסה ---- */
  function recommend(inp){
    const q     = quantity(inp);
    const hours = (inp.hoursToEvent != null) ? inp.hoursToEvent : null;
    const f     = filterCatalog(inp.diet, hours);
    const warnings = [];

    if (f.list.length === 0) {
      // מפרידים בין "התאריך לא מאפשר" לבין "המגבלות התזונתיות לא מאפשרות" —
      // ללקוח יש מה לעשות עם כל אחת מהן, וזו לא אותה תשובה.
      const noDiet = filterCatalog(inp.diet, null).list;
      if (noDiet.length > 0 && hours != null) {
        const fastest = Math.min.apply(null, noDiet.map(c => c.prh || 48));
        return {ok:false, reason:"no-time", q, hours, fastest,
          msg:`נשארו ${Math.round(hours)} שעות עד האירוע, והעוגייה המהירה ביותר שלנו דורשת ${fastest} שעות הכנה. ` +
              "לא אמכור לכם משהו שלא נספיק לאפות כמו שצריך — אבל שלחו הודעה, לפעמים יש מגש מוכן או שאפשר להיערך."};
      }
      return {ok:false, reason:"no-catalog", q,
        msg:"עם צירוף המגבלות הזה לא נשאר לי מה להציע מהקטלוג — שווה לדבר איתנו ישירות, לרוב נמצא פתרון."};
    }
    if (f.rushDropped.length) {
      warnings.push({type:"rush",
        text:`התאריך קרוב, אז הוצאתי מהתמהיל את ${f.rushDropped.map(x=>x.n).join(", ")} — הן דורשות ${Math.max.apply(null, f.rushDropped.map(x=>x.need))} שעות הכנה.`});
    }
    if (f.excluded.length) {
      const uniq = f.excluded.map(x=>x.n).filter((v,i,a) => a.indexOf(v) === i);
      warnings.push({type:"diet", text:`בגלל המגבלות התזונתיות לא נכללו: ${uniq.join(", ")}.`});
    }
    if (hours != null && hours < E().leadTime.minHours) {
      warnings.push({type:"toolate",
        text:`${Math.round(hours)} שעות זה מאוד דחוף. שלחו הודעה — לפעמים מסתדרים, אבל אי אפשר להבטיח מראש.`});
    }

    let items    = buildMix(q.kg, q.guests, f.list, {ev:q.ev, likes:inp.likes, level:inp.level});
    items        = enforceMinOrder(items, f.list, E().minOrderValue);
    const budget = reconcileBudget(q, items, f.list, +inp.budget || 0, q.guests);
    items = budget.items;

    const cost  = budget.cost;
    const units = items.reduce((s,i) => s + i.units, 0);
    const kg    = round(items.reduce((s,i) => s + i.kg, 0), 0.05);

    return {ok:true, q, items, warnings, kg, units,
            perGuest: q.guests ? Math.round((units/q.guests)*10)/10 : 0,
            cost, pricePerGuest: q.guests ? cost/q.guests : 0,
            budget, backup: backupTray(q, cost),
            excluded:f.excluded, rushDropped:f.rushDropped,
            bufferStory: bufferStory(q, kg)};
  }

  return {recommend, quantity, buildMix, filterCatalog, DIET, ils, evOf};
})();

if (typeof module !== "undefined") module.exports = {ENGINE};
